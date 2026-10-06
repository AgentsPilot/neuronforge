/**
 * Admin delete AD-2a (T6; SA AC2-1, AC2-2, T-4, T-7): the ADMIN arm of
 * `runPurgeCommit`. A separate file on purpose: `ResetService.order.test.ts`
 * (the internal surface) must pass with zero `-` lines (workplan R-6).
 *
 * Proves: the 3b order is kept and the gate sits between the verified
 * snapshot and the RPC; the gate is verdict-only and fails closed; the
 * delegated audit writes NO row; every engine call takes the TARGET id and the
 * admin id reaches no repository write; on a database without the function
 * nothing below the probe runs (the inactive proof, I-9).
 *
 * The repository is mocked (no working fetch under this Jest env), as in the
 * order suite: this proves orchestration, nothing about the database.
 */

const calls: string[] = [];
const args: Record<string, unknown[][]> = {};

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
      get: (_t, prop: string) => (...a: unknown[]) => {
        calls.push(prop);
        (args[prop] ??= []).push(a);
        return (repo as Record<string, jest.Mock>)[prop](...a);
      },
    }
  ),
}));

const auditLog = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrailService: { getInstance: () => ({ log: auditLog }) },
}));

import { runPurgeCommit, type PreCommitGate } from '../ResetService';
import type { PurgeOptions } from '../types';

const TARGET = '22222222-2222-4222-8222-222222222222';
const ADMIN = '11111111-1111-4111-8111-111111111111';
const OPTIONS: PurgeOptions = { integrations: true, agents: false, activityHistory: false };

const CLEAN_GRAPH = {
  data: {
    columns: [],
    foreign_keys: [{ constraint_name: 'synthetic_fkey', table_name: 'synthetic_child', references: 'synthetic_parent', on_delete: 'a' }],
    triggers: [],
  },
  error: null,
};

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
  repo.readAllRows.mockImplementation(async (d: { table: string }) => ({
    rows: d.table === 'crm_contacts' ? [{ id: 'c1' }, { id: 'c2' }] : [],
  }));
  let written = '';
  repo.writeSnapshot.mockImplementation(async (_b: string, _p: string, body: string) => {
    written = body;
  });
  repo.readSnapshot.mockImplementation(async () => written);
  repo.executePurge.mockResolvedValue({
    result: {
      ok: true,
      user_id: TARGET,
      level: 'purge',
      options: {},
      counts: { crm_contacts: 2 },
      total_rows: 2,
      table_count: 60,
      committed_at: '2026-10-06T00:00:00Z',
      duration_ms: 9,
    },
  });
  repo.removeStorageUnderUser.mockResolvedValue({ bucket: 'x', deleted: 0, failed: [], truncated: false });
}

const gate = jest.fn<ReturnType<PreCommitGate>, []>();

const adminRun = (options: PurgeOptions = OPTIONS) =>
  runPurgeCommit({
    surface: 'admin',
    userId: TARGET,
    actor: { id: ADMIN },
    correlationId: 'corr-admin',
    level: 'purge',
    options,
    preCommitGate: gate,
  });

beforeEach(() => {
  calls.length = 0;
  for (const k of Object.keys(args)) delete args[k];
  jest.clearAllMocks();
  gate.mockReset().mockImplementation(async () => {
    calls.push('gate');
    return { ok: true };
  });
});

describe('inactive proof (I-9): the function is not applied', () => {
  it('rpc_not_applied; no graph, guard, snapshot, gate, RPC or storage; no audit row (delegated)', async () => {
    repo.purgeFunctionExists.mockResolvedValue(false);
    const outcome = await adminRun();
    expect(outcome).toMatchObject({ status: 'refused', reason: 'rpc_not_applied', snapshotWritten: false, rowsDeleted: 0 });
    expect(calls).toEqual(['purgeFunctionExists']);
    expect(gate).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('agents: true is refused on the admin arm too, before any read', async () => {
    repo.purgeFunctionExists.mockResolvedValue(true);
    const outcome = await adminRun({ ...OPTIONS, agents: true });
    expect(outcome).toMatchObject({ status: 'refused', reason: 'agents_option_refused' });
    expect(gate).not.toHaveBeenCalled();
    expect(calls).not.toContain('writeSnapshot');
  });
});

describe('order: snapshot → gate → RPC → storage (SA T-4)', () => {
  it('runs the gate after the verified snapshot and before the RPC, and the RPC exactly once', async () => {
    happyPath();
    const outcome = await adminRun();
    expect(outcome.status).toBe('completed');
    const at = (n: string) => calls.indexOf(n);
    expect(at('purgeFunctionExists')).toBeLessThan(at('introspectSchema'));
    expect(at('countLocalBlockingState')).toBeLessThan(at('writeSnapshot'));
    expect(at('readSnapshot')).toBeLessThan(at('gate'));
    expect(at('gate')).toBeLessThan(at('executePurge'));
    expect(at('executePurge')).toBeLessThan(at('removeStorageUnderUser'));
    expect(gate).toHaveBeenCalledTimes(1);
    expect(repo.executePurge).toHaveBeenCalledTimes(1);
  });

  it('the gate takes no arguments (verdict only, AC2-2)', async () => {
    happyPath();
    await adminRun();
    expect(gate.mock.calls[0]).toEqual([]);
  });
});

describe('the gate fails closed (AC2-2)', () => {
  it('a refusal: precommit_refused, snapshot reported, no RPC, no storage', async () => {
    happyPath();
    gate.mockResolvedValue({ ok: false, message: 'A billing row turned active.', detail: { refusals: ['R-3:applies'] } });
    const outcome = await adminRun();
    expect(outcome).toMatchObject({ status: 'refused', reason: 'precommit_refused', snapshotWritten: true });
    if (outcome.status !== 'refused') return;
    expect(outcome.message).toContain('A billing row turned active.');
    expect(outcome.detail).toMatchObject({ gate: { refusals: ['R-3:applies'] } });
    expect(repo.executePurge).not.toHaveBeenCalled();
    expect(repo.removeStorageUnderUser).not.toHaveBeenCalled();
  });

  it('a throw: precommit_refused, no RPC', async () => {
    happyPath();
    gate.mockRejectedValue(new Error('boom'));
    const outcome = await adminRun();
    expect(outcome).toMatchObject({ status: 'refused', reason: 'precommit_refused', snapshotWritten: true });
    expect(repo.executePurge).not.toHaveBeenCalled();
  });

  it('anything but { ok: true }: precommit_refused, no RPC', async () => {
    happyPath();
    for (const bad of [undefined, null, {}, { ok: 'yes' }, { ok: 1 }]) {
      gate.mockResolvedValueOnce(bad as never);
      const outcome = await adminRun();
      expect(outcome).toMatchObject({ status: 'refused', reason: 'precommit_refused' });
    }
    expect(repo.executePurge).not.toHaveBeenCalled();
  });

  it('an unconfirmed write-ahead row: audit_unavailable, no RPC', async () => {
    happyPath();
    gate.mockResolvedValue({ ok: false, reason: 'audit_unavailable', message: 'Could not record the deletion.' });
    const outcome = await adminRun();
    expect(outcome).toMatchObject({ status: 'refused', reason: 'audit_unavailable', snapshotWritten: true });
    expect(repo.executePurge).not.toHaveBeenCalled();
  });
});

describe('outcomes on the admin arm', () => {
  it('already_running from the RPC is returned for the composition to map to R-7', async () => {
    happyPath();
    repo.executePurge.mockResolvedValue({ result: { ok: false, reason: 'already_running' } });
    const outcome = await adminRun();
    expect(outcome).toMatchObject({ status: 'refused', reason: 'already_running', snapshotWritten: true });
  });

  it('a refused outcome carries auditDetail for the composition; the internal arm never does', async () => {
    happyPath();
    repo.executePurge.mockResolvedValue({ result: null, error: 'tx failed' });
    const outcome = await adminRun();
    expect(outcome).toMatchObject({ status: 'refused', reason: 'commit_failed' });
    if (outcome.status !== 'refused') return;
    expect(outcome.auditDetail).toMatchObject({ error: 'tx failed' });
  });

  it('delegated: no audit row is written by the orchestrator, on success or refusal', async () => {
    happyPath();
    await adminRun();
    gate.mockResolvedValue({ ok: false, message: 'x' });
    await adminRun();
    expect(auditLog).not.toHaveBeenCalled();
  });
});

describe('tenant pin (tenant-isolation-guard)', () => {
  it('every engine call takes the TARGET id; the admin id reaches no repository call except the snapshot context', async () => {
    happyPath();
    await adminRun();
    expect(args.executePurge[0][0]).toMatchObject({ userId: TARGET });
    for (const call of args.removeStorageUnderUser) expect(call[1]).toBe(TARGET);
    expect(args.resolveConnectAccounts[0][0]).toBe(TARGET);
    expect(args.countLocalBlockingState[0][0]).toBe(TARGET);

    for (const [name, list] of Object.entries(args)) {
      if (name === 'writeSnapshot') continue;
      expect(JSON.stringify(list)).not.toContain(ADMIN);
    }
    // The snapshot artefact records the admin's id (no email) as its context, and is written under the target.
    const [, snapshotPath, body] = args.writeSnapshot[0] as [string, string, string];
    expect(snapshotPath).toContain(TARGET);
    expect(snapshotPath).not.toContain(ADMIN);
    const parsed = JSON.parse(body);
    expect(JSON.stringify(parsed)).toContain(ADMIN);
    expect(body).not.toMatch(/actorEmail/);
  });
});
