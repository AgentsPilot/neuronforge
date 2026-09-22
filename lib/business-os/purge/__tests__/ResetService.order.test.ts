/**
 * The Reset sequence — ORDER and REFUSAL semantics.
 *
 * The single most important property of slice 2 is not that it deletes: it is
 * that everything which can refuse runs BEFORE the first thing that cannot be
 * undone. This suite asserts that order directly, by recording each repository
 * call as it happens.
 *
 * ── Why these are mocked, and what that does NOT prove ─────────────────────
 * supabase-js has no working `fetch` under this repo's Jest environment (it
 * fails with `TypeError: fetch failed` even though the identical query returns
 * 200 from plain Node). So the repository is mocked here, and this suite proves
 * the ORCHESTRATION — sequencing, short-circuiting, what is reported — and
 * nothing about the database. The database side is covered by the `tsx`
 * harness and the live route; see the test plan in the workplan.
 */

const calls: string[] = [];

const repo = {
  purgeFunctionExists: jest.fn(),
  resolveConnectAccounts: jest.fn(),
  countLocalBlockingState: jest.fn(),
  readAllRows: jest.fn(),
  writeSnapshot: jest.fn(),
  readSnapshot: jest.fn(),
  executePurge: jest.fn(),
  removeStorageUnderUser: jest.fn(),
};

jest.mock('@/lib/repositories/BusinessPurgeRepository', () => ({
  businessPurgeRepository: new Proxy(
    {},
    {
      get: (_t, prop: string) => (...args: unknown[]) => {
        calls.push(prop);
        return (repo as Record<string, jest.Mock>)[prop](...args);
      },
    }
  ),
}));

const auditLog = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrailService: { getInstance: () => ({ log: auditLog }) },
}));

import { runReset } from '../ResetService';

const USER = '00000000-0000-0000-0000-000000000001';
const run = () => runReset({ userId: USER, actorEmail: 'test@example.com', correlationId: 'corr-1' });

/** Everything clear, snapshot verifies, commit succeeds, storage clean. */
function happyPath() {
  repo.purgeFunctionExists.mockResolvedValue(true);
  repo.resolveConnectAccounts.mockResolvedValue([]);
  repo.countLocalBlockingState.mockResolvedValue([
    { condition: 'C1', table: 'payment_plan_subscriptions', statuses: [], label: 'x', count: 0 },
    { condition: 'C2', table: 'payment_transactions', statuses: [], label: 'x', count: 0 },
    { condition: 'C2', table: 'payment_refunds', statuses: [], label: 'x', count: 0 },
    { condition: 'C3', table: 'payment_invoices', statuses: [], label: 'x', count: 0 },
  ]);
  repo.readAllRows.mockResolvedValue({ rows: [] });
  repo.writeSnapshot.mockResolvedValue(undefined);
  // Read-back must return exactly what was written. Capture and echo it.
  let written = '';
  repo.writeSnapshot.mockImplementation(async (_b: string, _p: string, body: string) => {
    written = body;
  });
  repo.readSnapshot.mockImplementation(async () => written);
  repo.executePurge.mockResolvedValue({
    result: {
      ok: true,
      user_id: USER,
      level: 'reset',
      options: {},
      counts: { crm_contacts: 3 },
      total_rows: 3,
      table_count: 53,
      committed_at: '2026-09-16T00:00:00Z',
      duration_ms: 12,
    },
  });
  repo.removeStorageUnderUser.mockResolvedValue({ bucket: 'x', deleted: 0, failed: [], truncated: false });
}

beforeEach(() => {
  calls.length = 0;
  jest.clearAllMocks();
  auditLog.mockResolvedValue(undefined);
});

describe('Reset — ordering', () => {
  it('runs probe -> guard -> snapshot -> commit -> storage, in that order', async () => {
    happyPath();
    const outcome = await run();

    expect(outcome.status).toBe('completed');

    const first = (name: string) => calls.indexOf(name);
    expect(first('purgeFunctionExists')).toBeGreaterThanOrEqual(0);
    expect(first('purgeFunctionExists')).toBeLessThan(first('resolveConnectAccounts'));
    expect(first('resolveConnectAccounts')).toBeLessThan(first('countLocalBlockingState'));
    expect(first('countLocalBlockingState')).toBeLessThan(first('writeSnapshot'));
    expect(first('writeSnapshot')).toBeLessThan(first('readSnapshot'));
    expect(first('readSnapshot')).toBeLessThan(first('executePurge'));
    expect(first('executePurge')).toBeLessThan(first('removeStorageUnderUser'));
  });
});

describe('Reset — refuses BEFORE writing a snapshot', () => {
  it('when the RPC is not applied: no guard, no snapshot, no commit', async () => {
    // The state of production until the service-role key is rotated. A run
    // that snapshotted and THEN found the function missing would have written
    // the most sensitive object this system produces, for nothing.
    happyPath();
    repo.purgeFunctionExists.mockResolvedValue(false);

    const outcome = await run();

    expect(outcome).toMatchObject({ status: 'refused', reason: 'rpc_not_applied', snapshotWritten: false, rowsDeleted: 0 });
    expect(calls).not.toContain('resolveConnectAccounts');
    expect(calls).not.toContain('writeSnapshot');
    expect(calls).not.toContain('executePurge');
  });

  it('when the RPC state is unknown: refuses rather than assuming', async () => {
    happyPath();
    repo.purgeFunctionExists.mockResolvedValue(null);

    const outcome = await run();

    expect(outcome).toMatchObject({ status: 'refused', reason: 'rpc_state_unknown' });
    expect(calls).not.toContain('writeSnapshot');
  });

  it('when a Stripe Connect account exists (SA-S5 control 1)', async () => {
    happyPath();
    repo.resolveConnectAccounts.mockResolvedValue([{ accountId: 'acct_1', source: 'stripe_connect_accounts' }]);

    const outcome = await run();

    expect(outcome).toMatchObject({ status: 'refused', reason: 'stripe_connected', snapshotWritten: false });
    expect(calls).not.toContain('countLocalBlockingState');
    expect(calls).not.toContain('writeSnapshot');
  });

  it('when the Connect lookup FAILS — a failed read is not a "no"', async () => {
    happyPath();
    repo.resolveConnectAccounts.mockRejectedValue(new Error('network'));

    const outcome = await run();

    expect(outcome).toMatchObject({ status: 'refused', reason: 'stripe_unreadable' });
    expect(calls).not.toContain('writeSnapshot');
  });

  it('when local blocking state exists (control 2), with NO Stripe at all', async () => {
    // The case control 1 cannot see: a manual invoice left `sent`.
    happyPath();
    repo.countLocalBlockingState.mockResolvedValue([
      { condition: 'C1', table: 'payment_plan_subscriptions', statuses: [], label: 'plans', count: 0 },
      { condition: 'C2', table: 'payment_transactions', statuses: [], label: 'payments', count: 0 },
      { condition: 'C2', table: 'payment_refunds', statuses: [], label: 'refunds', count: 0 },
      { condition: 'C3', table: 'payment_invoices', statuses: [], label: 'unpaid invoice(s)', count: 2 },
    ]);

    const outcome = await run();

    expect(outcome).toMatchObject({ status: 'refused', reason: 'local_blocking', snapshotWritten: false });
    expect(calls).not.toContain('writeSnapshot');
  });

  it('when a local blocking read fails — refuses rather than reading it as zero', async () => {
    happyPath();
    repo.countLocalBlockingState.mockResolvedValue([
      { condition: 'C1', table: 'payment_plan_subscriptions', statuses: [], label: 'x', count: null, error: 'boom' },
      { condition: 'C2', table: 'payment_transactions', statuses: [], label: 'x', count: 0 },
      { condition: 'C2', table: 'payment_refunds', statuses: [], label: 'x', count: 0 },
      { condition: 'C3', table: 'payment_invoices', statuses: [], label: 'x', count: 0 },
    ]);

    const outcome = await run();

    expect(outcome).toMatchObject({ status: 'refused', reason: 'local_unreadable' });
    expect(calls).not.toContain('writeSnapshot');
  });
});

describe('Reset — AC-35: no verified snapshot, no delete', () => {
  it('aborts with zero rows deleted when the write fails', async () => {
    happyPath();
    repo.writeSnapshot.mockRejectedValue(new Error('storage down'));

    const outcome = await run();

    expect(outcome).toMatchObject({ status: 'refused', reason: 'snapshot_failed', rowsDeleted: 0 });
    expect(calls).not.toContain('executePurge');
  });

  it('aborts when the write succeeds but the READ-BACK does not match', async () => {
    // The case a 200 from the storage API would hide.
    happyPath();
    repo.readSnapshot.mockResolvedValue('{"truncated":true}');

    const outcome = await run();

    expect(outcome).toMatchObject({ status: 'refused', reason: 'snapshot_failed', snapshotWritten: true });
    expect(calls).not.toContain('executePurge');
  });
});

describe('Reset — commit and storage semantics', () => {
  it('reports a failed commit as zero rows deleted, and names the snapshot that survives', async () => {
    happyPath();
    repo.executePurge.mockResolvedValue({ result: null, error: 'constraint violation' });

    const outcome = await run();

    expect(outcome).toMatchObject({ status: 'refused', reason: 'commit_failed', rowsDeleted: 0, snapshotWritten: true });
    expect(calls).not.toContain('removeStorageUnderUser');
  });

  it('reports already_running from the advisory lock without touching storage', async () => {
    happyPath();
    repo.executePurge.mockResolvedValue({ result: { ok: false, reason: 'already_running', user_id: USER } });

    const outcome = await run();

    expect(outcome).toMatchObject({ status: 'refused', reason: 'already_running' });
    expect(calls).not.toContain('removeStorageUnderUser');
  });

  it('a storage failure after commit does NOT fail the run — it is reported as residue (FR-22)', async () => {
    happyPath();
    repo.removeStorageUnderUser.mockResolvedValue({
      bucket: 'contact-documents',
      deleted: 1,
      failed: [{ path: 'u/c/file.pdf', reason: 'locked' }],
      truncated: false,
    });

    const outcome = await run();

    expect(outcome.status).toBe('completed');
    if (outcome.status === 'completed') {
      expect(outcome.residue.length).toBeGreaterThan(0);
      expect(outcome.rows.total).toBe(3);
    }
  });
});

describe('Reset — audit (FR-20, AC-18)', () => {
  it('audits a refusal', async () => {
    happyPath();
    repo.purgeFunctionExists.mockResolvedValue(false);

    await run();

    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'BUSINESS_DATA_PURGE_BLOCKED', entityId: USER })
    );
  });

  it('audits the OUTCOME of a completed reset, not just the intent', async () => {
    happyPath();

    await run();

    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'BUSINESS_DATA_PURGED',
        details: expect.objectContaining({ rowsDeleted: 3, snapshotPath: expect.any(String) }),
      })
    );
  });
});
