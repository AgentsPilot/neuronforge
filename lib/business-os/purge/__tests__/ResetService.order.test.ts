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
  introspectSchema: jest.fn(),
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

import { runPurgeCommit, runReset, commitResultNotes } from '../ResetService';
import { descriptorsForRun } from '../descriptors';
import { checkDeleteGraph } from '../deleteGraph';
import type { PurgeOptions } from '../types';

const USER = '00000000-0000-0000-0000-000000000001';
const run = () => runReset({ userId: USER, actorEmail: 'test@example.com', correlationId: 'corr-1' });

const OFF: PurgeOptions = { integrations: false, agents: false, activityHistory: false };
const purge = (options: Partial<PurgeOptions> = {}) =>
  runPurgeCommit({
    userId: USER,
    actorEmail: 'test@example.com',
    correlationId: 'corr-1',
    level: 'purge',
    options: { ...OFF, ...options },
  });

/**
 * A clean live graph: one FK whose parent is in no run, no triggers. Non-empty
 * on purpose — an empty FK list is `unreadable` (C-5), never clean.
 */
const CLEAN_GRAPH = {
  data: {
    columns: [],
    foreign_keys: [{ constraint_name: 'synthetic_fkey', table_name: 'synthetic_child', references: 'synthetic_parent', on_delete: 'a' }],
    triggers: [],
  },
  error: null,
};

/** Everything clear, snapshot verifies, commit succeeds, storage clean. */
function happyPath() {
  repo.purgeFunctionExists.mockResolvedValue(true);
  repo.introspectSchema.mockResolvedValue(CLEAN_GRAPH);
  repo.resolveConnectAccounts.mockResolvedValue([]);
  repo.countLocalBlockingState.mockResolvedValue([
    { condition: 'C1', table: 'payment_plan_subscriptions', statuses: [], label: 'x', count: 0 },
    { condition: 'C2', table: 'payment_transactions', statuses: [], label: 'x', count: 0 },
    { condition: 'C2', table: 'payment_refunds', statuses: [], label: 'x', count: 0 },
    { condition: 'C3', table: 'payment_invoices', statuses: [], label: 'x', count: 0 },
  ]);
  // Three rows in one table, so the snapshot count (the truth, OQ-4) and the
  // RPC count below agree.
  repo.readAllRows.mockImplementation(async (d: { table: string }) => ({
    rows: d.table === 'crm_contacts' ? [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }] : [],
  }));
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
  // Recorded in the same call log, so "audit after commit" is assertable.
  auditLog.mockImplementation(async () => {
    calls.push('audit');
  });
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

// ────────────────────────────────────────────────────────────────────────────
// Purge slice 3b — the Purge level, the opt-in extras and the delete-graph
// pre-check. Same mocked repository; the graph check itself runs for real
// (`runDeleteGraphCheck` -> mocked `introspectSchema` -> real `checkDeleteGraph`).
// ────────────────────────────────────────────────────────────────────────────

describe('Purge — inactive proof: rpc_not_applied comes FIRST (§6.3)', () => {
  it('with the function absent, nothing else runs: no graph read, guard, snapshot, commit or storage', async () => {
    happyPath();
    repo.purgeFunctionExists.mockResolvedValue(false);

    const outcome = await purge({ integrations: true, activityHistory: true });

    expect(outcome).toMatchObject({ status: 'refused', reason: 'rpc_not_applied', snapshotWritten: false });
    expect(calls.filter((c) => c !== 'audit')).toEqual(['purgeFunctionExists']);
  });

  it('even agents: true reports rpc_not_applied first, not its own refusal', async () => {
    happyPath();
    repo.purgeFunctionExists.mockResolvedValue(false);

    const outcome = await purge({ agents: true });

    expect(outcome).toMatchObject({ status: 'refused', reason: 'rpc_not_applied' });
  });
});

describe('Purge — the agents option is refused for good (OQ-1 = (c), SA C-4)', () => {
  it('refuses agents: true with its own code EVEN WHEN the live graph is clean, before guard and snapshot', async () => {
    happyPath(); // CLEAN_GRAPH: the graph would say ok
    const outcome = await purge({ agents: true });

    expect(outcome).toMatchObject({
      status: 'refused',
      reason: 'agents_option_refused',
      snapshotWritten: false,
      rowsDeleted: 0,
    });
    // Refused on its own terms: the graph is not even read.
    expect(calls).not.toContain('introspectSchema');
    expect(calls).not.toContain('resolveConnectAccounts');
    expect(calls).not.toContain('writeSnapshot');
    expect(calls).not.toContain('executePurge');
  });

  it('refuses on Reset too — the option is refused at every level', async () => {
    happyPath();
    const outcome = await runPurgeCommit({
      userId: USER,
      actorEmail: null,
      correlationId: 'c',
      level: 'reset',
      options: { ...OFF, agents: true },
    });
    expect(outcome).toMatchObject({ status: 'refused', reason: 'agents_option_refused' });
  });

  it('defence in depth: a graph mirroring M-5 also refuses the agents run (no live DB)', () => {
    // M-5's shape: deleting the agents root cascades into tables no run lists
    // (16 `never` + 3 unclassified live). Synthetic child names; the run is
    // the real descriptor set.
    const run = descriptorsForRun('purge', { ...OFF, agents: true });
    const root = run.find((d) => d.area === 'agents' && d.scope.kind === 'user_id' && d.order >= 500);
    expect(root).toBeDefined();
    const result = checkDeleteGraph({
      run,
      foreignKeys: [
        { constraint_name: 'm5_never_child_fkey', table_name: 'synthetic_never_child', references: root!.table, on_delete: 'c' },
        { constraint_name: 'm5_unclassified_fkey', table_name: 'synthetic_unclassified', references: root!.table, on_delete: 'c' },
      ],
      triggers: [],
    });
    expect(result.status).toBe('refused');
    expect(result.unlistedCascadeChildren.map((e) => e.child)).toEqual(['synthetic_never_child', 'synthetic_unclassified']);
  });
});

describe('Purge — delete-graph pre-check (after the probe, before the guard)', () => {
  const refusingGraph = () => {
    // A cascade child of a run table that the run does not list.
    const parent = descriptorsForRun('purge', OFF)[0].table;
    return {
      data: {
        columns: [],
        foreign_keys: [{ constraint_name: 'leak_fkey', table_name: 'synthetic_kept_table', references: parent, on_delete: 'c' }],
        triggers: [],
      },
      error: null,
    };
  };

  it('a refusing graph stops the run before the guard and the snapshot', async () => {
    happyPath();
    repo.introspectSchema.mockResolvedValue(refusingGraph());

    const outcome = await purge();

    expect(outcome).toMatchObject({ status: 'refused', reason: 'delete_graph_refused', snapshotWritten: false });
    expect(calls.indexOf('purgeFunctionExists')).toBeLessThan(calls.indexOf('introspectSchema'));
    expect(calls).not.toContain('resolveConnectAccounts');
    expect(calls).not.toContain('writeSnapshot');
    expect(calls).not.toContain('executePurge');
  });

  it('C-4: outside development the client gets counts only, no child-table names', async () => {
    happyPath();
    repo.introspectSchema.mockResolvedValue(refusingGraph());

    const outcome = await purge();

    expect(JSON.stringify(outcome)).not.toContain('synthetic_kept_table');
    expect(JSON.stringify(outcome)).not.toContain('leak_fkey');
    expect(outcome.status === 'refused' && outcome.detail).toEqual({
      status: 'refused',
      blockingOrderViolations: 0,
      unlistedCascadeChildren: 1,
      unreviewedDeleteTriggers: 0,
    });
    // The audit row (server-side) keeps the full verdict.
    const blocked = auditLog.mock.calls.find((c) => c[0].action === 'BUSINESS_DATA_PURGE_BLOCKED');
    expect(JSON.stringify(blocked?.[0].details.detail)).toContain('synthetic_kept_table');
  });

  it('C-4: in development the names are returned for debugging', async () => {
    const env = process.env as Record<string, string | undefined>;
    const was = env.NODE_ENV;
    env.NODE_ENV = 'development';
    try {
      happyPath();
      repo.introspectSchema.mockResolvedValue(refusingGraph());
      const outcome = await purge();
      expect(JSON.stringify(outcome)).toContain('synthetic_kept_table');
    } finally {
      env.NODE_ENV = was;
    }
  });

  it('C-5 (commit half): an unreadable schema is a refusal, never treated as clean', async () => {
    happyPath();
    repo.introspectSchema.mockResolvedValue({ data: null, error: new Error('permission denied for function') });

    const outcome = await purge();

    expect(outcome).toMatchObject({ status: 'refused', reason: 'delete_graph_unreadable', snapshotWritten: false });
    expect(JSON.stringify(outcome)).not.toContain('permission denied');
    expect(calls).not.toContain('writeSnapshot');
    expect(calls).not.toContain('executePurge');
  });

  it('C-5: a payload with no triggers key, or an empty FK list, is also a refusal', async () => {
    happyPath();
    repo.introspectSchema.mockResolvedValue({ data: { columns: [], foreign_keys: CLEAN_GRAPH.data.foreign_keys }, error: null });
    expect(await purge()).toMatchObject({ reason: 'delete_graph_unreadable' });

    repo.introspectSchema.mockResolvedValue({ data: { columns: [], foreign_keys: [], triggers: [] }, error: null });
    expect(await purge()).toMatchObject({ reason: 'delete_graph_unreadable' });
    expect(calls).not.toContain('executePurge');
  });

  it('a read that throws is a refusal, not a crash', async () => {
    happyPath();
    repo.introspectSchema.mockRejectedValue(new Error('socket hang up'));
    expect(await purge()).toMatchObject({ status: 'refused', reason: 'delete_graph_unreadable' });
  });
});

describe('Purge — order, run contents and extras', () => {
  it('runs probe -> graph -> guard -> snapshot -> commit -> storage -> audit', async () => {
    happyPath();
    const outcome = await purge();

    expect(outcome.status).toBe('completed');
    const first = (name: string) => calls.indexOf(name);
    expect(first('purgeFunctionExists')).toBe(0);
    expect(first('introspectSchema')).toBeGreaterThan(first('purgeFunctionExists'));
    expect(first('resolveConnectAccounts')).toBeGreaterThan(first('introspectSchema'));
    expect(first('writeSnapshot')).toBeGreaterThan(first('countLocalBlockingState'));
    expect(first('executePurge')).toBeGreaterThan(first('readSnapshot'));
    expect(first('removeStorageUnderUser')).toBeGreaterThan(first('executePurge'));
    expect(first('audit')).toBeGreaterThan(first('executePurge'));
  });

  it.each([
    ['reset', OFF],
    ['purge', OFF],
    ['purge', { ...OFF, integrations: true }],
    ['purge', { ...OFF, activityHistory: true }],
    ['purge', { ...OFF, integrations: true, activityHistory: true }],
  ] as const)('%s %j: executePurge receives exactly descriptorsForRun, in order', async (level, options) => {
    happyPath();
    await runPurgeCommit({ userId: USER, actorEmail: null, correlationId: 'c', level, options });

    const sent = repo.executePurge.mock.calls[0][0];
    expect(sent).toMatchObject({ userId: USER, level, options });
    expect(sent.tables.map((t: { table: string }) => t.table)).toEqual(descriptorsForRun(level, options).map((d) => d.table));
  });

  it('business_profiles is the last table of a Purge and absent from a Reset (F-SA-3 band)', async () => {
    happyPath();
    await purge();
    const purgeTables = repo.executePurge.mock.calls[0][0].tables.map((t: { table: string }) => t.table);
    expect(purgeTables[purgeTables.length - 1]).toBe('business_profiles');

    jest.clearAllMocks();
    happyPath();
    await run();
    const resetTables = repo.executePurge.mock.calls[0][0].tables.map((t: { table: string }) => t.table);
    expect(resetTables).not.toContain('business_profiles');
  });

  it('AC-31/AC-32: with every option off, Purge still removes channel connections but no opt-in table', async () => {
    happyPath();
    await purge();
    const tables: string[] = repo.executePurge.mock.calls[0][0].tables.map((t: { table: string }) => t.table);
    const optIns = descriptorsForRun('purge', { integrations: true, agents: true, activityHistory: true })
      .filter((d) => d.level.startsWith('optional:'))
      .map((d) => d.table);
    expect(optIns.length).toBeGreaterThan(0);
    expect(tables.filter((t) => optIns.includes(t))).toEqual([]);
    expect(tables).toContain('channel_connections');
    expect(tables).not.toContain('profiles');
  });

  it('AC-33 (ordering half): with integrations on, the connections are read by the guard BEFORE the commit deletes them', async () => {
    happyPath();
    await purge({ integrations: true });

    const tables: string[] = repo.executePurge.mock.calls[0][0].tables.map((t: { table: string }) => t.table);
    expect(tables).toContain('plugin_connections');
    expect(calls.indexOf('resolveConnectAccounts')).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf('resolveConnectAccounts')).toBeLessThan(calls.indexOf('executePurge'));
  });

  it('activityHistory: the audit record of this run is written AFTER the commit, and carries level + options (FR-20)', async () => {
    happyPath();
    await purge({ activityHistory: true });

    expect(calls.lastIndexOf('audit')).toBeGreaterThan(calls.indexOf('executePurge'));
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'BUSINESS_DATA_PURGED',
        details: expect.objectContaining({
          level: 'purge',
          options: { integrations: false, agents: false, activityHistory: true },
        }),
      })
    );
  });

  it('a refusal audit carries level and options too', async () => {
    happyPath();
    repo.purgeFunctionExists.mockResolvedValue(false);
    await purge({ integrations: true });
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'BUSINESS_DATA_PURGE_BLOCKED',
        details: expect.objectContaining({
          level: 'purge',
          options: { integrations: true, agents: false, activityHistory: false },
        }),
      })
    );
  });

  it('only the three known option keys reach the RPC and the audit row', async () => {
    happyPath();
    await runPurgeCommit({
      userId: USER,
      actorEmail: null,
      correlationId: 'c',
      level: 'purge',
      options: { ...OFF, injected: true } as unknown as PurgeOptions,
    });
    expect(repo.executePurge.mock.calls[0][0].options).toEqual(OFF);
  });
});

describe('Purge — result notes (FR-24, FR-25, AC-32, AC-42)', () => {
  it('a completed Purge carries the subdomain, new-code and channel notes', async () => {
    happyPath();
    const outcome = await purge();
    expect(outcome.status).toBe('completed');
    const text = outcome.status === 'completed' ? outcome.notes.join('\n') : '';
    expect(text).toMatch(/subdomain has been released/i);
    expect(text).toMatch(/NEW public code/);
    expect(text).toMatch(/trial does not restart/i);
    expect(text).toMatch(/Channel connections were removed/);
    expect(text).toMatch(/FR-24/);
  });

  it('a Reset carries the FR-24 note only — it releases nothing', () => {
    const notes = commitResultNotes('reset', OFF);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/FR-24/);
  });

  it('the opt-in notes appear only when the option was on', () => {
    expect(commitResultNotes('purge', OFF).join(' ')).not.toMatch(/Integrations were disconnected|Activity history/);
    const both = commitResultNotes('purge', { ...OFF, integrations: true, activityHistory: true }).join(' ');
    expect(both).toMatch(/Integrations were disconnected/);
    expect(both).toMatch(/audit record of THIS run/);
  });
});

describe('Purge — counts and error text (SA OQ-4, F-1)', () => {
  it('reports snapshot counts as rows removed and RPC counts as diagnostics', async () => {
    happyPath();
    repo.executePurge.mockResolvedValue({
      result: {
        ok: true,
        user_id: USER,
        level: 'purge',
        options: OFF,
        counts: { crm_contacts: 1 },
        total_rows: 1,
        table_count: 70,
        committed_at: '2026-10-05T00:00:00Z',
        duration_ms: 5,
      },
    });
    const outcome = await purge();
    expect(outcome).toMatchObject({ status: 'completed', rows: { total: 3 }, rpcRows: { total: 1 } });
  });

  it('a failed commit does not return the raw database error outside development', async () => {
    happyPath();
    repo.executePurge.mockResolvedValue({ result: null, error: 'purge_business_data: refusing cascade from secret_table' });
    const outcome = await purge();
    expect(outcome).toMatchObject({ status: 'refused', reason: 'commit_failed', snapshotWritten: true });
    expect(JSON.stringify(outcome)).not.toContain('secret_table');
  });

  it('a failed snapshot does not return the raw storage error outside development', async () => {
    happyPath();
    repo.writeSnapshot.mockRejectedValue(new Error('bucket policy xyz-internal'));
    const outcome = await purge();
    expect(outcome).toMatchObject({ status: 'refused', reason: 'snapshot_failed' });
    expect(JSON.stringify(outcome)).not.toContain('xyz-internal');
  });
});

describe('SA G-3 — local_unreadable keeps raw read text off the client', () => {
  const unreadable = () => [
    { condition: 'C1', table: 'payment_plan_subscriptions', statuses: [], label: 'x', count: null, error: 'boom' },
    { condition: 'C2', table: 'payment_transactions', statuses: [], label: 'x', count: 0 },
    { condition: 'C2', table: 'payment_refunds', statuses: [], label: 'x', count: 0 },
    { condition: 'C3', table: 'payment_invoices', statuses: [], label: 'x', count: 0 },
  ];

  it('outside development the message carries no table or error text; the audit row keeps the reason', async () => {
    happyPath();
    repo.countLocalBlockingState.mockResolvedValue(unreadable());

    const outcome = await purge();

    expect(outcome).toMatchObject({ status: 'refused', reason: 'local_unreadable' });
    expect(JSON.stringify(outcome)).not.toContain('payment_plan_subscriptions');
    const blocked = auditLog.mock.calls.find((c) => c[0].action === 'BUSINESS_DATA_PURGE_BLOCKED');
    expect(JSON.stringify(blocked?.[0].details.detail)).toContain('payment_plan_subscriptions');
  });

  it('in development the raw reason is appended', async () => {
    const env = process.env as Record<string, string | undefined>;
    const was = env.NODE_ENV;
    env.NODE_ENV = 'development';
    try {
      happyPath();
      repo.countLocalBlockingState.mockResolvedValue(unreadable());
      const outcome = await purge();
      expect(outcome.status === 'refused' && outcome.message).toContain('payment_plan_subscriptions');
    } finally {
      env.NODE_ENV = was;
    }
  });
});
