/**
 * Admin delete AD-1b (T10): the admin deletion preview composition.
 *
 * `buildPurgePreview`, the reconciler, `decideLocalPrecondition` and the
 * evaluator are REAL; the repositories underneath are spied or faked. So the
 * "nothing is deleted" assertion (AC-A2 code half, SC-9, SA D-2) runs over the
 * real preview path: every destructive method of `BusinessPurgeRepository`
 * and the snapshot writer is spied, and none may be reached.
 *
 * Also: R-1 / R-2 stop counting (SC-3), the fixed level and options (SC-2),
 * an unreadable schema is R-8 `unverified` while the counts still render (SA
 * further condition 3), an identity read failure is `identity_error` (SA D-1),
 * and no logger argument carries the email or the business name (SC-10).
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

const mockCheckAdminStatus = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: { getInstance: () => ({ checkAdminStatus: (...a: unknown[]) => mockCheckAdminStatus(...a) }) },
}));

const mockFindUserIdentity = jest.fn();
jest.mock('@/lib/repositories/AuthAccountRepository', () => ({
  authAccountRepository: { findUserIdentity: (...a: unknown[]) => mockFindUserIdentity(...a) },
}));

const mockFindByUser = jest.fn();
jest.mock('@/lib/repositories/BusinessOsBillingAccountRepository', () => ({
  businessOsBillingAccountRepository: { findByUser: (...a: unknown[]) => mockFindByUser(...a) },
}));

const mockFindProfile = jest.fn();
jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: { findByUserId: (...a: unknown[]) => mockFindProfile(...a) },
}));

const mockWriteVerifiedSnapshot = jest.fn();
jest.mock('../SnapshotWriter', () => ({
  writeVerifiedSnapshot: (...a: unknown[]) => mockWriteVerifiedSnapshot(...a),
}));

import { businessPurgeRepository } from '@/lib/repositories/BusinessPurgeRepository';
import * as PreviewServiceModule from '../PreviewService';
import { PURGE_DESCRIPTORS } from '../descriptors';
import { LOCAL_BLOCKING_CONDITIONS } from '../localPrecondition';
import { ADMIN_DELETION_OPTIONS, buildAdminDeletionPreview } from '../AdminDeletionPreview';

const ADMIN = '11111111-1111-4111-8111-111111111111';
const TARGET = '22222222-2222-4222-8222-222222222222';
const EMAIL = 'planted.owner@example.com';
const BUSINESS = 'Planted Bakery Name';
const CORRELATION = 'corr-ad1b';

/** Destructive or whole-row methods: none may be called by a preview. */
const DESTRUCTIVE = ['executePurge', 'removeStorageUnderUser', 'writeSnapshot', 'readAllRows'] as const;

const spies: Record<string, jest.SpyInstance> = {};

function okSchema() {
  return {
    data: { columns: PURGE_DESCRIPTORS.map((d) => ({ table_name: d.table, column_name: 'id' })), foreign_keys: [] },
    error: null,
  };
}

beforeEach(() => {
  jest.restoreAllMocks();
  logged.length = 0;
  mockCheckAdminStatus.mockReset().mockResolvedValue(false);
  mockFindUserIdentity
    .mockReset()
    .mockResolvedValue({ data: { id: TARGET, email: EMAIL, createdAt: '2026-05-01T10:00:00.000Z' }, error: null });
  mockFindByUser.mockReset().mockResolvedValue({ data: null, error: null });
  mockFindProfile.mockReset().mockResolvedValue({ data: { company_name: BUSINESS }, error: null });
  mockWriteVerifiedSnapshot.mockReset();

  spies.hasStripeConnectRow = jest.spyOn(businessPurgeRepository, 'hasStripeConnectRow').mockResolvedValue(false);
  spies.countAll = jest
    .spyOn(businessPurgeRepository, 'countAll')
    .mockImplementation(async (descriptors) => descriptors.map((d, i) => ({ table: d.table, count: i === 0 ? null : 2 })));
  spies.countStorageObjects = jest
    .spyOn(businessPurgeRepository, 'countStorageObjects')
    .mockImplementation(async (bucket) => ({ table: bucket, count: 4 }));
  spies.purgeFunctionExists = jest.spyOn(businessPurgeRepository, 'purgeFunctionExists').mockResolvedValue(false);
  spies.introspectSchema = jest.spyOn(businessPurgeRepository, 'introspectSchema').mockResolvedValue(okSchema());
  spies.resolveConnectAccounts = jest.spyOn(businessPurgeRepository, 'resolveConnectAccounts').mockResolvedValue([]);
  spies.countLocalBlockingState = jest
    .spyOn(businessPurgeRepository, 'countLocalBlockingState')
    .mockImplementation(async () =>
      LOCAL_BLOCKING_CONDITIONS.map((c) => ({ ...c, count: 0 }))
    );
  for (const method of DESTRUCTIVE) {
    spies[method] = jest.spyOn(businessPurgeRepository, method).mockImplementation(() => {
      throw new Error(`${method} must never be reached by a preview`);
    });
  }
});

const run = (targetId = TARGET) => buildAdminDeletionPreview({ adminId: ADMIN, targetId, correlationId: CORRELATION });

function expectNothingDestructive() {
  for (const method of DESTRUCTIVE) expect(spies[method]).not.toHaveBeenCalled();
  expect(mockWriteVerifiedSnapshot).not.toHaveBeenCalled();
}

describe('happy path', () => {
  it('previews Purge at the fixed options (SC-2), counts by area, and deletes nothing (SC-9)', async () => {
    const previewSpy = jest.spyOn(PreviewServiceModule, 'buildPurgePreview');
    const outcome = await run();
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    const { preview } = outcome;

    expect(previewSpy).toHaveBeenCalledTimes(1);
    expect(previewSpy).toHaveBeenCalledWith({
      userId: TARGET,
      level: 'purge',
      options: { integrations: true, agents: true, activityHistory: false },
      correlationId: CORRELATION,
    });
    expect(ADMIN_DELETION_OPTIONS).toEqual({ integrations: true, agents: true, activityHistory: false });

    expect(preview.counted).toBe(true);
    expect(preview.target).toEqual({ userId: TARGET, email: EMAIL, businessName: BUSINESS, joinedAt: '2026-05-01T10:00:00.000Z' });
    expect(preview.areas.length).toBeGreaterThan(1);
    expect(preview.areas.some((a) => a.area === 'unassigned')).toBe(false);
    // The uncounted table is unknown, never zero.
    expect(preview.areas.reduce((n, a) => n + a.tablesUnknown, 0)).toBe(1);
    expect(preview.totals?.tablesUnknown).toBe(1);
    expect(preview.storage.every((s) => s.count === 4)).toBe(true);
    expect(preview.keptTables.map((k) => k.table)).toEqual(expect.arrayContaining(['email_unsubscribes', 'user_preferences']));
    expect(preview.schema?.status).toBe('ok');
    expect(preview.refusals.map((r) => `${r.id}:${r.status}`)).toEqual([
      'R-1:clear',
      'R-2:clear',
      'R-3:clear',
      'R-4:not_applicable',
      'R-5:clear',
      'R-6:clear',
      'R-7:deferred',
      'R-8:clear',
    ]);
    expect(preview.deletionAvailable).toBe(false);
    expect(preview.deletionUnavailableReason).toContain('later release');
    expect(preview.deletionUnavailableReason).toContain('not installed');
    expect(preview.limitations.some((l) => l.includes('unknown'))).toBe(true);

    // Both livemode rows were read (SC-5), for the target only.
    expect(mockFindByUser.mock.calls).toEqual([
      [TARGET, false],
      [TARGET, true],
    ]);
    // The email reaches R-2's check; the target id is the path's.
    expect(mockCheckAdminStatus).toHaveBeenCalledWith({ id: TARGET, email: EMAIL });
    expectNothingDestructive();
  });

  it('logs ids only: neither the email nor the business name appears in any logger argument (SC-10)', async () => {
    await run();
    expect(logged.length).toBeGreaterThan(0);
    const text = JSON.stringify(logged);
    expect(text).not.toContain(EMAIL);
    expect(text).not.toContain(BUSINESS);
    expect(text).toContain(TARGET);
  });
});

describe('R-1 / R-2 stop counting (SC-3)', () => {
  it('self: R-1 applies, nothing is counted, no purge preview or reconciler runs', async () => {
    const previewSpy = jest.spyOn(PreviewServiceModule, 'buildPurgePreview');
    mockFindUserIdentity.mockResolvedValue({ data: { id: ADMIN, email: 'me@example.com', createdAt: null }, error: null });
    const outcome = await run(ADMIN);
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.preview.counted).toBe(false);
    expect(outcome.preview.areas).toEqual([]);
    expect(outcome.preview.totals).toBeNull();
    expect(outcome.preview.refusals[0].status).toBe('applies');
    expect(outcome.preview.deletionUnavailableReason).toContain('your own account');
    expect(previewSpy).not.toHaveBeenCalled();
    expect(spies.countAll).not.toHaveBeenCalled();
    expect(spies.introspectSchema).not.toHaveBeenCalled();
    expect(mockFindByUser).not.toHaveBeenCalled();
    expectNothingDestructive();
  });

  it('an admin target: R-2 applies, nothing is counted', async () => {
    const previewSpy = jest.spyOn(PreviewServiceModule, 'buildPurgePreview');
    mockCheckAdminStatus.mockResolvedValue(true);
    const outcome = await run();
    if (outcome.kind !== 'ok') throw new Error('expected ok');
    expect(outcome.preview.counted).toBe(false);
    expect(outcome.preview.refusals[1]).toMatchObject({ id: 'R-2', status: 'applies' });
    expect(previewSpy).not.toHaveBeenCalled();
    expect(spies.countAll).not.toHaveBeenCalled();
  });

  it('admin status unknown: R-2 unverified, refuses, nothing is counted', async () => {
    mockCheckAdminStatus.mockResolvedValue(null);
    const outcome = await run();
    if (outcome.kind !== 'ok') throw new Error('expected ok');
    expect(outcome.preview.counted).toBe(false);
    expect(outcome.preview.refusals[1]).toMatchObject({ id: 'R-2', status: 'unverified' });
    expect(spies.countAll).not.toHaveBeenCalled();
  });

  it('R-2 still runs when the target has no email (bound id decides)', async () => {
    mockFindUserIdentity.mockResolvedValue({ data: { id: TARGET, email: null, createdAt: null }, error: null });
    mockCheckAdminStatus.mockResolvedValue(true);
    const outcome = await run();
    if (outcome.kind !== 'ok') throw new Error('expected ok');
    expect(mockCheckAdminStatus).toHaveBeenCalledWith({ id: TARGET, email: null });
    expect(outcome.preview.refusals[1].status).toBe('applies');
  });
});

describe('target lookup (SA D-1)', () => {
  it('404 from auth: not_found, nothing evaluated', async () => {
    mockFindUserIdentity.mockResolvedValue({ data: null, error: null });
    expect(await run()).toEqual({ kind: 'not_found' });
    expect(mockCheckAdminStatus).not.toHaveBeenCalled();
    expect(spies.countAll).not.toHaveBeenCalled();
  });

  it('any other identity failure: identity_error (the route answers 500), never not_found, never "not an admin"', async () => {
    mockFindUserIdentity.mockResolvedValue({ data: null, error: new Error('upstream') });
    expect(await run()).toEqual({ kind: 'identity_error' });
    expect(mockCheckAdminStatus).not.toHaveBeenCalled();
    expect(spies.countAll).not.toHaveBeenCalled();
  });
});

describe('failed reads are refusals, and the preview still renders', () => {
  it('reconciler unreadable: R-8 unverified, the counts and other refusals still render (SA condition 3)', async () => {
    spies.introspectSchema.mockResolvedValue({ data: null, error: new Error('permission denied') });
    const outcome = await run();
    if (outcome.kind !== 'ok') throw new Error('expected ok');
    expect(outcome.preview.counted).toBe(true);
    expect(outcome.preview.areas.length).toBeGreaterThan(1);
    expect(outcome.preview.schema).toMatchObject({ status: 'unreadable', fingerprint: null });
    expect(outcome.preview.refusals.find((r) => r.id === 'R-8')?.status).toBe('unverified');
    expect(outcome.preview.refusals.find((r) => r.id === 'R-3')?.status).toBe('clear');
    expect(outcome.preview.deletionUnavailableReason).toContain('could not be read');
  });

  it('reconciler throwing: still unverified, never a crash', async () => {
    spies.introspectSchema.mockRejectedValue(new Error('socket hang up'));
    const outcome = await run();
    if (outcome.kind !== 'ok') throw new Error('expected ok');
    expect(outcome.preview.refusals.find((r) => r.id === 'R-8')?.status).toBe('unverified');
  });

  it('billing error (either mode), Connect throw and a null local count: each unverified, all returned', async () => {
    mockFindByUser.mockImplementation(async (_id: string, livemode: boolean) =>
      livemode ? { data: null, error: new Error('db') } : { data: null, error: null }
    );
    spies.resolveConnectAccounts.mockRejectedValue(new Error('db'));
    spies.countLocalBlockingState.mockImplementation(async () =>
      LOCAL_BLOCKING_CONDITIONS.map((c, i) => ({ ...c, count: i === 0 ? null : 0 }))
    );
    const outcome = await run();
    if (outcome.kind !== 'ok') throw new Error('expected ok');
    const statuses = Object.fromEntries(outcome.preview.refusals.map((r) => [r.id, r.status]));
    expect(statuses).toMatchObject({ 'R-3': 'unverified', 'R-5': 'unverified', 'R-6': 'unverified', 'R-8': 'clear' });
    expectNothingDestructive();
  });

  it('a THROWN local blocking-state read: R-6 unverified with a fixed reason, never the raw message (AD-1b QA Low-1)', async () => {
    spies.countLocalBlockingState.mockRejectedValue(new Error('relation "secret_internal_table" does not exist'));
    const outcome = await run();
    if (outcome.kind !== 'ok') throw new Error('expected ok');
    const r6 = outcome.preview.refusals.find((r) => r.id === 'R-6');
    expect(r6?.status).toBe('unverified');
    expect(r6?.message).toContain('the read failed');
    expect(JSON.stringify(outcome.preview)).not.toContain('secret_internal_table');
    expectNothingDestructive();
  });

  it('a live plan subscription: R-3 applies and is the disabled reason', async () => {
    mockFindByUser.mockImplementation(async (_id: string, livemode: boolean) => ({
      data: livemode ? null : { subscriptionStatus: 'active', stripeSubscriptionId: 'sub_1', endedAt: null },
      error: null,
    }));
    const outcome = await run();
    if (outcome.kind !== 'ok') throw new Error('expected ok');
    const r3 = outcome.preview.refusals.find((r) => r.id === 'R-3');
    expect(r3?.status).toBe('applies');
    expect(outcome.preview.deletionUnavailableReason).toBe(r3?.message);
  });

  it('a missing business profile is fine; an unreadable one is a limitation, not a refusal', async () => {
    mockFindProfile.mockResolvedValue({ data: null, error: null });
    let outcome = await run();
    if (outcome.kind !== 'ok') throw new Error('expected ok');
    expect(outcome.preview.target.businessName).toBeNull();

    mockFindProfile.mockResolvedValue({ data: null, error: new Error('db') });
    outcome = await run();
    if (outcome.kind !== 'ok') throw new Error('expected ok');
    expect(outcome.preview.limitations.some((l) => l.includes('business name could not be read'))).toBe(true);
    expect(outcome.preview.refusals.every((r) => r.status !== 'unverified')).toBe(true);
  });
});

describe('source bounds', () => {
  const fs = jest.requireActual<typeof import('fs')>('fs');
  const path = jest.requireActual<typeof import('path')>('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'AdminDeletionPreview.ts'), 'utf8');
  const code = src.replace(/^[ \t]*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

  it('imports no entitlements module (SC-5) and no Supabase client (B-1)', () => {
    expect(src).not.toMatch(/business-os\/entitlements/);
    expect(src).not.toMatch(/supabase(Server|Client|ServerAuth)|@supabase\//);
  });

  it('calls no destructive method and does not take the advisory lock', () => {
    for (const method of [...DESTRUCTIVE, 'writeVerifiedSnapshot', 'evaluateResetGuard', 'executeReset']) {
      expect(code).not.toMatch(new RegExp(`\\b${method}\\s*\\(`));
    }
    expect(code).not.toMatch(/advisory|pg_try_advisory/i);
  });
});
