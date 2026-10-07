/**
 * Admin delete AD-2a (T9): the commit composition (workplan §2.5, §6.2; SA
 * AC2-2, AC2-4, AC2-6, AC2-7, AC2-8, T-1).
 *
 * The token is REAL (signed with a test key); the orchestrator is mocked with
 * a stand-in that honours the admin arm's contract (it calls the gate and
 * only "deletes" on `{ ok: true }`), so the composition's own order, refusals,
 * audit rows and tenant scoping are what is proven here. The orchestrator's
 * real admin arm is proven by `ResetService.adminSurface.test.ts`.
 */

const logged: unknown[] = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const rec = (...args: unknown[]) => {
      logged.push(args);
    };
    const l: Record<string, unknown> = { info: rec, warn: rec, error: rec, debug: rec };
    l.child = () => l;
    return l;
  };
  return { createLogger: () => make() };
});
jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

const mockFindUserIdentity = jest.fn();
jest.mock('@/lib/repositories/AuthAccountRepository', () => ({
  authAccountRepository: { findUserIdentity: (...a: unknown[]) => mockFindUserIdentity(...a) },
}));

const mockFindProfile = jest.fn();
jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: { findByUserId: (...a: unknown[]) => mockFindProfile(...a) },
}));

const mockRevoke = jest.fn();
const mockCountPending = jest.fn();
jest.mock('@/lib/repositories/BusinessOsInviteRepository', () => ({
  businessOsInviteRepository: {
    revokePendingForIssuerAccountByAdmin: (...a: unknown[]) => mockRevoke(...a),
    countPendingForIssuerAccountByAdmin: (...a: unknown[]) => mockCountPending(...a),
  },
}));

const mockReadAdminStatus = jest.fn();
const mockGather = jest.fn();
jest.mock('../adminDeletionFacts', () => ({
  readAdminStatus: (...a: unknown[]) => mockReadAdminStatus(...a),
  gatherAdminDeletionLaterFacts: (...a: unknown[]) => mockGather(...a),
}));

const mockWriteNow = jest.fn();
jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrailService: { getInstance: () => ({ writeNow: (...a: unknown[]) => mockWriteNow(...a) }) },
}));

const mockLogAndFlush = jest.fn();
jest.mock('@/lib/audit/boundedAuditFlush', () => ({
  logAndFlush: (...a: unknown[]) => mockLogAndFlush(...a),
}));

const order: string[] = [];
const mockRunPurgeCommit = jest.fn();
jest.mock('../ResetService', () => ({
  runPurgeCommit: (...a: unknown[]) => mockRunPurgeCommit(...a),
}));

// The preview module is imported for its constants only; stub its heavy graph.
jest.mock('../PreviewService', () => ({ buildPurgePreview: jest.fn() }));

import { commitAdminDeletion, ADMIN_DELETE_INVITE_REVOKE_REASON } from '../AdminDeletionCommit';
import { ADMIN_DELETION_GATE_VERSION, ADMIN_DELETION_OPTIONS } from '../AdminDeletionPreview';
import { mintPreviewToken, PREVIEW_TOKEN_TTL_MS, type PreviewTokenInput } from '../previewToken';
import type { AdminDeletionLaterFacts } from '../adminDeletionRefusals';

const KEY = 'test-service-role-key-0123456789-abcdefghijklmnop';
const ADMIN = { id: '11111111-1111-4111-8111-111111111111', email: 'ops@example.com' };
const TARGET = '22222222-2222-4222-8222-222222222222';
const EMAIL = 'planted.owner@example.com';
const BUSINESS = 'Planted Bakery Name';
const FINGERPRINT = 'a'.repeat(64);

const clearLater = (): AdminDeletionLaterFacts => ({
  billing: { test: { row: null }, live: { row: null } },
  connectAccounts: 0,
  localBlocking: { outcome: 'clear' },
  schema: { status: 'ok', unclassified: [], missingDeletable: [] },
  deleteGraph: { status: 'ok' },
});
const gathered = (later: Partial<AdminDeletionLaterFacts> = {}, fingerprint: string | null = FINGERPRINT) => ({
  later: { ...clearLater(), ...later },
  schema: { status: 'ok', unclassified: [], missingDeletable: [], missingNever: [], tenantTables: [], fingerprint },
});

const tokenInput = (o: Partial<PreviewTokenInput> = {}): PreviewTokenInput => ({
  surface: 'admin',
  actorId: ADMIN.id,
  targetId: TARGET,
  level: 'purge',
  options: { ...ADMIN_DELETION_OPTIONS },
  confirmKind: 'business name',
  gateVersion: ADMIN_DELETION_GATE_VERSION,
  schemaFingerprint: FINGERPRINT,
  correlationId: 'corr-preview',
  ...o,
});

const COMPLETED = {
  status: 'completed',
  correlationId: 'corr-commit',
  level: 'purge',
  options: { ...ADMIN_DELETION_OPTIONS },
  snapshotPath: `${TARGET}/snap.json`,
  rows: { total: 5, byTable: { crm_contacts: 5 } },
  rpcRows: { total: 5, byTable: { crm_contacts: 5 } },
  storage: [{ bucket: 'b', deleted: 1, failed: [] }],
  residue: [],
  notes: ['n'],
  committedAt: '2026-10-06T00:00:00Z',
  durationMs: 10,
};

/** A stand-in that honours the admin arm's contract: gate, then "RPC" only on { ok: true }. */
function orchestratorCallsGate() {
  mockRunPurgeCommit.mockImplementation(async (p: { preCommitGate: () => Promise<{ ok: boolean; reason?: string; message?: string }> }) => {
    order.push('snapshot');
    let v: { ok: boolean; reason?: string; message?: string };
    try {
      v = await p.preCommitGate();
    } catch {
      v = { ok: false };
    }
    if (v.ok !== true) {
      return { status: 'refused', correlationId: 'corr-commit', reason: v.reason ?? 'precommit_refused', message: v.message ?? 'x', snapshotWritten: true, rowsDeleted: 0 };
    }
    order.push('executePurge');
    return COMPLETED;
  });
}

const run = (o: Partial<{ token: string; confirmText: string }> = {}) =>
  commitAdminDeletion({
    admin: ADMIN,
    targetId: TARGET,
    token: o.token ?? mintPreviewToken(tokenInput()),
    confirmText: o.confirmText ?? BUSINESS,
    correlationId: 'corr-commit',
  });

const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const prevSwitch = process.env.ADMIN_BUSINESS_DELETE_ENABLED;
afterAll(() => {
  if (prevKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
  if (prevSwitch === undefined) delete process.env.ADMIN_BUSINESS_DELETE_ENABLED;
  else process.env.ADMIN_BUSINESS_DELETE_ENABLED = prevSwitch;
});

beforeEach(() => {
  jest.clearAllMocks();
  logged.length = 0;
  order.length = 0;
  process.env.SUPABASE_SERVICE_ROLE_KEY = KEY;
  process.env.ADMIN_BUSINESS_DELETE_ENABLED = 'true';
  mockFindUserIdentity.mockResolvedValue({ data: { id: TARGET, email: EMAIL, createdAt: null }, error: null });
  mockFindProfile.mockResolvedValue({ data: { company_name: BUSINESS }, error: null });
  // The actor is an admin; the target is not.
  mockReadAdminStatus.mockImplementation(async (u: { id: string }) => u.id === ADMIN.id);
  mockGather.mockResolvedValue(gathered());
  mockWriteNow.mockImplementation(async (entry: { action: string }) => {
    order.push(`writeNow:${entry.action}`);
    return { written: true };
  });
  mockLogAndFlush.mockResolvedValue(undefined);
  mockRevoke.mockImplementation(async () => {
    order.push('revoke');
    return { data: 2, error: null };
  });
  mockCountPending.mockResolvedValue({ data: 1, error: null });
  orchestratorCallsGate();
});

const blockedRow = () => mockLogAndFlush.mock.calls[0]?.[0];

function expectAdminOwned(entry: Record<string, unknown>) {
  expect(entry).toMatchObject({ entityType: 'user', entityId: TARGET, userId: ADMIN.id, actorId: ADMIN.id });
}

describe('the off switch comes first (BQ-1, SA AC2-6)', () => {
  it('off: 409 admin_delete_disabled, before the token is verified and before any read; one blocked row', async () => {
    process.env.ADMIN_BUSINESS_DELETE_ENABLED = 'false';
    delete process.env.SUPABASE_SERVICE_ROLE_KEY; // would be a 500 if the token were looked at
    const outcome = await run({ token: 'anything.at-all' });
    expect(outcome).toMatchObject({ kind: 'refused', httpStatus: 409, code: 'admin_delete_disabled', snapshotWritten: false });
    expect(mockFindUserIdentity).not.toHaveBeenCalled();
    expect(mockRunPurgeCommit).not.toHaveBeenCalled();
    expect(mockLogAndFlush).toHaveBeenCalledTimes(1);
    expectAdminOwned(blockedRow());
    expect(blockedRow()).toMatchObject({ action: 'BUSINESS_DATA_PURGE_BLOCKED', severity: 'warning', details: { reason: 'admin_delete_disabled', surface: 'admin' } });
  });

  it('unset is off', async () => {
    delete process.env.ADMIN_BUSINESS_DELETE_ENABLED;
    expect(await run()).toMatchObject({ code: 'admin_delete_disabled' });
  });
});

describe('the token (AC-A6, C-7)', () => {
  it('missing key: 500 token_key_unavailable, never a bypass', async () => {
    const token = mintPreviewToken(tokenInput());
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(await run({ token })).toMatchObject({ httpStatus: 500, code: 'token_key_unavailable' });
    expect(mockRunPurgeCommit).not.toHaveBeenCalled();
  });

  it.each([
    ['another target', { targetId: '33333333-3333-4333-8333-333333333333' }, 400, 'token_target'],
    ['another admin', { actorId: '44444444-4444-4444-8444-444444444444' }, 400, 'token_actor'],
    ['other options', { options: { integrations: false, agents: false, activityHistory: false } }, 400, 'token_options'],
    ['another surface', { surface: 'customer' as const }, 400, 'token_surface'],
    ['an old gate version', { gateVersion: ADMIN_DELETION_GATE_VERSION + 1 }, 409, 'token_gate_version'],
  ])('a token for %s: %s, nothing read, one blocked row', async (_l, override, status, code) => {
    const outcome = await run({ token: mintPreviewToken(tokenInput(override)) });
    expect(outcome).toMatchObject({ kind: 'refused', httpStatus: status, code });
    expect(mockFindUserIdentity).not.toHaveBeenCalled();
    expect(mockRunPurgeCommit).not.toHaveBeenCalled();
    expectAdminOwned(blockedRow());
  });

  it('an expired token: 409 token_expired', async () => {
    const token = mintPreviewToken(tokenInput(), Date.now() - PREVIEW_TOKEN_TTL_MS - 60_000);
    expect(await run({ token })).toMatchObject({ httpStatus: 409, code: 'token_expired' });
  });

  it('garbage: 400 token_malformed', async () => {
    expect(await run({ token: 'not-a-token' })).toMatchObject({ httpStatus: 400, code: 'token_malformed' });
  });
});

describe('identity and the fresh admin re-check (AC2-7)', () => {
  it('404 / 500 on the identity read', async () => {
    mockFindUserIdentity.mockResolvedValueOnce({ data: null, error: null });
    expect(await run()).toMatchObject({ httpStatus: 404, code: 'user_not_found' });
    mockFindUserIdentity.mockResolvedValueOnce({ data: null, error: new Error('x') });
    expect(await run()).toMatchObject({ httpStatus: 500, code: 'identity_read_failed' });
  });

  it('the actor is re-checked FRESH; not an admin (or unknown) is 403', async () => {
    mockReadAdminStatus.mockResolvedValue(null);
    expect(await run()).toMatchObject({ httpStatus: 403, code: 'actor_not_admin' });
    expect(mockReadAdminStatus).toHaveBeenCalledWith(ADMIN, { fresh: true });
    expect(mockRunPurgeCommit).not.toHaveBeenCalled();
  });

  it('R-2 on the target, fresh: an admin target refuses 409 with the list', async () => {
    mockReadAdminStatus.mockResolvedValue(true);
    const outcome = await run();
    expect(outcome).toMatchObject({ httpStatus: 409, code: 'refused' });
    expect(mockReadAdminStatus).toHaveBeenCalledWith({ id: TARGET, email: EMAIL }, { fresh: true });
    if (outcome.kind !== 'refused') return;
    expect(outcome.refusals?.find((r) => r.id === 'R-2')?.status).toBe('applies');
  });
});

describe('the typed confirmation (FR-A6, AC-A7, AC2-8)', () => {
  it('a wrong name: 400, the orchestrator never runs, a blocked row', async () => {
    expect(await run({ confirmText: 'Some Other Shop' })).toMatchObject({ httpStatus: 400, code: 'confirmation_mismatch', expectedKind: 'business name' });
    expect(mockRunPurgeCommit).not.toHaveBeenCalled();
    expect(mockLogAndFlush).toHaveBeenCalledTimes(1);
  });

  it('case and whitespace do not matter', async () => {
    expect(await run({ confirmText: '  planted   BAKERY name ' })).toMatchObject({ kind: 'completed' });
  });

  it('a profile read error: 500, never the email fallback', async () => {
    mockFindProfile.mockResolvedValue({ data: null, error: new Error('db') });
    expect(await run({ confirmText: EMAIL })).toMatchObject({ httpStatus: 500, code: 'confirmation_unverified' });
    expect(mockRunPurgeCommit).not.toHaveBeenCalled();
  });

  it('the kind changed since the preview (name → email): 409, the token is void', async () => {
    mockFindProfile.mockResolvedValue({ data: null, error: null });
    expect(await run({ confirmText: EMAIL })).toMatchObject({ httpStatus: 409, code: 'confirmation_kind_changed' });
  });
});

describe('evaluation 1 (FR-A7)', () => {
  it('a blocking refusal: 409 with every refusal, nothing run', async () => {
    mockGather.mockResolvedValue(gathered({ connectAccounts: 1 }));
    const outcome = await run();
    expect(outcome).toMatchObject({ httpStatus: 409, code: 'refused' });
    if (outcome.kind !== 'refused') return;
    expect(outcome.refusals?.find((r) => r.id === 'R-5')?.status).toBe('applies');
    expect(mockRunPurgeCommit).not.toHaveBeenCalled();
  });

  it('a different fingerprint: 409 schema_changed, nothing run', async () => {
    mockGather.mockResolvedValue(gathered({}, 'b'.repeat(64)));
    expect(await run()).toMatchObject({ httpStatus: 409, code: 'schema_changed' });
    expect(mockRunPurgeCommit).not.toHaveBeenCalled();
  });

  it('an unreadable fingerprint: schema_changed (never a pass)', async () => {
    mockGather.mockResolvedValue(gathered({}, null));
    expect(await run()).toMatchObject({ code: 'schema_changed' });
  });
});

describe('the orchestrator and the gate (FR-A7 evaluation 2, AC-A8, AC2-3, AC2-4)', () => {
  it('the target is userId, the admin the actor, the options fixed, and a gate is passed (tenant pin)', async () => {
    await run();
    const [params] = mockRunPurgeCommit.mock.calls[0];
    expect(params).toMatchObject({
      surface: 'admin',
      userId: TARGET,
      actor: { id: ADMIN.id },
      level: 'purge',
      options: { integrations: true, agents: false, activityHistory: false },
    });
    expect(typeof params.preCommitGate).toBe('function');
  });

  it('on prod today: rpc_not_applied is a 409 with a blocked row; no write-ahead, no invite revoke', async () => {
    mockRunPurgeCommit.mockResolvedValue({ status: 'refused', correlationId: 'c', reason: 'rpc_not_applied', message: 'not applied', snapshotWritten: false, rowsDeleted: 0, auditDetail: { internal: 'x' } });
    const outcome = await run();
    expect(outcome).toMatchObject({ httpStatus: 409, code: 'rpc_not_applied', snapshotWritten: false });
    expect(mockWriteNow).not.toHaveBeenCalled();
    expect(mockRevoke).not.toHaveBeenCalled();
    expect(blockedRow().details.detail).toEqual({ internal: 'x' });
    // The orchestrator's audit detail never reaches the response.
    expect(JSON.stringify(outcome)).not.toContain('internal');
  });

  it('AC-A8: a fact flips between evaluation 1 and 2 → refused, no write-ahead, no RPC', async () => {
    mockGather.mockResolvedValueOnce(gathered()).mockResolvedValueOnce(
      gathered({ billing: { test: { row: { status: 'active', stripeSubscriptionId: 's', endedAt: null } }, live: { row: null } } })
    );
    const outcome = await run();
    expect(outcome).toMatchObject({ code: 'precommit_refused', snapshotWritten: true });
    expect(order).not.toContain('executePurge');
    expect(mockWriteNow).not.toHaveBeenCalled();
    expect(blockedRow().details.evaluation2).toContain('R-3:applies');
  });

  it('evaluation 2 re-checks the actor and the target fresh', async () => {
    await run();
    const freshCalls = mockReadAdminStatus.mock.calls.filter((c) => c[1]?.fresh === true);
    expect(freshCalls.length).toBe(4); // actor + target, at step 7 and in the gate
    expect(mockGather).toHaveBeenCalledTimes(2);
  });

  it('a fingerprint drift at evaluation 2 → refused, no RPC', async () => {
    mockGather.mockResolvedValueOnce(gathered()).mockResolvedValueOnce(gathered({}, 'c'.repeat(64)));
    expect(await run()).toMatchObject({ code: 'precommit_refused' });
    expect(order).not.toContain('executePurge');
  });

  it('an unconfirmed write-ahead row → audit_unavailable, no RPC', async () => {
    mockWriteNow.mockResolvedValue({ written: false });
    expect(await run()).toMatchObject({ code: 'audit_unavailable', snapshotWritten: true });
    expect(order).not.toContain('executePurge');
  });

  it('AC-A11: already_running from the RPC → R-7 applies, a blocked row', async () => {
    mockRunPurgeCommit.mockResolvedValue({ status: 'refused', correlationId: 'c', reason: 'already_running', message: 'busy', snapshotWritten: true, rowsDeleted: 0 });
    const outcome = await run();
    expect(outcome).toMatchObject({ httpStatus: 409, code: 'already_running' });
    if (outcome.kind !== 'refused') return;
    expect(outcome.refusals?.find((r) => r.id === 'R-7')?.status).toBe('applies');
    expect(blockedRow().details.refusals).toContain('R-7:applies');
  });
});

describe('a completed deletion', () => {
  it('order: write-ahead (confirmed) → RPC → invite revoke → outcome row (confirmed)', async () => {
    const outcome = await run();
    expect(outcome.kind).toBe('completed');
    expect(order).toEqual([
      'snapshot',
      'writeNow:BUSINESS_DELETION_STARTED',
      'executePurge',
      'revoke',
      'writeNow:BUSINESS_DATA_PURGED',
    ]);
  });

  it('both rows are admin-owned (T-1 A); none lands on the target; severities as §2.3', async () => {
    await run();
    expect(mockWriteNow).toHaveBeenCalledTimes(2);
    for (const [entry] of mockWriteNow.mock.calls) {
      expectAdminOwned(entry);
      expect(entry.severity).toBe('critical');
      expect(entry.details).toMatchObject({ surface: 'admin', targetId: TARGET, correlationId: 'corr-commit', previewCorrelationId: 'corr-preview' });
    }
    expect(mockWriteNow.mock.calls[0][0].details.evaluation1).toEqual(expect.arrayContaining(['R-1:clear', 'R-8:clear']));
    expect(mockWriteNow.mock.calls[0][0].details.evaluation2).toEqual(expect.arrayContaining(['R-1:clear']));
  });

  it('revokes the TARGET’s pending invites, by the admin, with the fixed reason; reports the mid-signup count (BQ-3)', async () => {
    const outcome = await run();
    expect(mockRevoke).toHaveBeenCalledWith(
      expect.objectContaining({ issuerAccountId: TARGET, adminId: ADMIN.id, reason: ADMIN_DELETE_INVITE_REVOKE_REASON })
    );
    expect(ADMIN_DELETE_INVITE_REVOKE_REASON.length).toBeGreaterThanOrEqual(3);
    expect(mockCountPending).toHaveBeenCalledWith(TARGET);
    if (outcome.kind !== 'completed') throw new Error('expected completed');
    expect(outcome.result.invites).toEqual({ revoked: 2, skippedMidSignup: 1 });
    expect(outcome.result.auditRecorded).toBe(true);
    expect(outcome.result.kept.join(' ')).toContain('agents');
  });

  it('an invite revoke failure is residue; the outcome is still completed', async () => {
    mockRevoke.mockResolvedValue({ data: null, error: new Error('db') });
    const outcome = await run();
    if (outcome.kind !== 'completed') throw new Error('expected completed');
    expect(outcome.result.invites.revoked).toBeNull();
    expect(outcome.result.residue.some((r) => r.startsWith('Invites:'))).toBe(true);
    // SA comment 1 (Low): after a failed revoke the pending count is not "mid-signup",
    // so it is reported as unknown and the count query is never run.
    expect(outcome.result.invites.skippedMidSignup).toBeNull();
    expect(mockCountPending).not.toHaveBeenCalled();
  });

  it('a revoke that returns no count (data: null, no error) is treated as failed: residue, no count query (QA)', async () => {
    mockRevoke.mockResolvedValue({ data: null, error: null });
    const outcome = await run();
    if (outcome.kind !== 'completed') throw new Error('expected completed');
    expect(outcome.result.invites).toEqual({ revoked: null, skippedMidSignup: null });
    expect(outcome.result.residue.some((r) => r.startsWith('Invites:'))).toBe(true);
    expect(mockCountPending).not.toHaveBeenCalled();
  });

  it('a count read error after a successful revoke: revoked is kept, skippedMidSignup is null (QA)', async () => {
    mockCountPending.mockResolvedValue({ data: null, error: new Error('db') });
    const outcome = await run();
    if (outcome.kind !== 'completed') throw new Error('expected completed');
    expect(outcome.result.invites).toEqual({ revoked: 2, skippedMidSignup: null });
  });

  it('an unconfirmed outcome row is reported (auditRecorded: false), never hidden', async () => {
    mockWriteNow.mockResolvedValueOnce({ written: true }).mockResolvedValueOnce({ written: false });
    const outcome = await run();
    if (outcome.kind !== 'completed') throw new Error('expected completed');
    expect(outcome.result.auditRecorded).toBe(false);
  });
});

describe('logs carry ids, codes and counts only (AC2-11, C-12)', () => {
  it('no email, business name or token in any logger argument, on success and refusal', async () => {
    const token = mintPreviewToken(tokenInput());
    await commitAdminDeletion({ admin: ADMIN, targetId: TARGET, token, confirmText: BUSINESS, correlationId: 'c1' });
    await commitAdminDeletion({ admin: ADMIN, targetId: TARGET, token, confirmText: 'wrong', correlationId: 'c2' });
    const text = JSON.stringify(logged);
    expect(text).not.toContain(EMAIL);
    expect(text).not.toContain(ADMIN.email);
    expect(text).not.toContain(BUSINESS);
    expect(text).not.toContain(token);
    // Control: the recorder captured both runs (ids ride on the child logger's bindings).
    expect(text).toContain('Admin deletion completed');
    expect(text).toContain('confirmation_mismatch');
  });
});

describe('source bounds (SA AC2-2, B-1)', () => {
  const fs = jest.requireActual<typeof import('fs')>('fs');
  const path = jest.requireActual<typeof import('path')>('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'AdminDeletionCommit.ts'), 'utf8');
  const code = src.replace(/^[ \t]*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

  it('the gate reads the shared helpers and writes only the write-ahead row', () => {
    const gate = code.slice(code.indexOf('export function buildPreCommitGate('), code.indexOf('export async function commitAdminDeletion('));
    expect(gate.length).toBeGreaterThan(100);
    expect(gate.match(/\.writeNow\(/g)).toHaveLength(1);
    expect(gate).toContain('BUSINESS_DELETION_STARTED');
    expect(gate).not.toMatch(/Repository\b|\.update\(|\.insert\(|\.delete\(|\.upsert\(|\.rpc\(|logAndFlush|runPurgeCommit|executePurge/);
  });

  it('imports no Supabase client and no entitlements module', () => {
    expect(src).not.toMatch(/supabase(Server|Client|ServerAuth)|@supabase\//);
    expect(src).not.toMatch(/business-os\/entitlements/);
  });

  it('calls no destructive engine method itself: deletion lives in the one orchestrator', () => {
    expect(code).not.toMatch(/\b(executePurge|removeStorageUnderUser|writeVerifiedSnapshot|writeSnapshot)\s*\(/);
  });

  it('sends no email (FR-A13)', () => {
    expect(code).not.toMatch(/sendEmail|resend|nodemailer|EmailService/i);
  });
});
