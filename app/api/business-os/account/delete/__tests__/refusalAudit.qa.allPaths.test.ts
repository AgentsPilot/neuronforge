/**
 * EVERY refusal path of the deletion REQUEST route (DL-1b / D6; workplan §4.1,
 * §4.4, T-15; SA W-14; carried from DE-10b.2's QA re-test of B-1), through the
 * real `logAndFlush` → `AuditTrailService.buildLogEntry` → insert, with
 * `SYSTEM_ADMIN_USER_ID` set. Only the Supabase client is faked (it captures
 * the inserted rows); the session, throttle and the request's ports are mocked.
 *
 * Each audited refusal writes exactly one `ACCOUNT_DELETION_REFUSED` row with
 * user_id = actor_id = entity_id = the session user, no `system_action`,
 * `details.source: 'self_service'`, `stage: 'request'`, and no email,
 * statement text or 64-hex string. An open request already (nothing was
 * attempted) writes nothing.
 */

import { NextRequest } from 'next/server';
import { DELETION_STATEMENTS } from '@/lib/business-os/account-deletion/acknowledgement';
import type { BillingRowLike, ClosureRequestDeps } from '@/lib/business-os/account-deletion/closureRequest';
import type { PlanManageResult } from '@/lib/business-os/billing/planSubscriptionManage';

const FLAG = 'BUSINESS_OS_ACCOUNT_SELF_DELETE_ENABLED';
const SECRET_ENV = ['TEST', 'CLEANUP', 'SECRET'].join('_');
const KEY_ENV = ['DELETION', 'RECEIPT', 'FINGERPRINT', 'KEY'].join('_');
const SUBJECT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SYSTEM_ADMIN = '66666666-6666-4666-8666-666666666666';
const CLOSURE = '44444444-4444-4444-8444-444444444444';
const EMAIL = 'qa.subject@example.org';
const ENDS = '2026-11-26T10:00:00.000Z';

const inserted: Array<Record<string, unknown>> = [];

jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const l: Record<string, unknown> = {};
    for (const level of ['info', 'warn', 'debug', 'error']) l[level] = () => undefined;
    l.child = () => l;
    return l;
  };
  return { createLogger: () => make(), clientLogger: make() };
});

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => ({
      insert: async (rows: Array<Record<string, unknown>>) => {
        if (table === 'audit_trail') inserted.push(...rows);
        return { error: null };
      },
    }),
  }),
}));
jest.mock('@/lib/repositories/ArchiveRepository', () => ({ archiveRepository: {} }));

const mockSession = jest.fn();
jest.mock('@/lib/business-os/account-deletion/sessionSubject', () => {
  const actual = jest.requireActual('@/lib/business-os/account-deletion/sessionSubject');
  return { ...actual, readSessionSubject: () => mockSession() };
});
const mockRateLimit = jest.fn();
jest.mock('@/lib/security/rateLimit', () => {
  const actual = jest.requireActual('@/lib/security/rateLimit');
  return { ...actual, rateLimit: (...args: unknown[]) => mockRateLimit(...args) };
});
jest.mock('@/lib/business-os/account-deletion/selfServiceDeletion', () => ({
  errorKindFacts: () => ({ kind: null, code: null, name: null }),
}));

interface World {
  open: 'none' | 'pending' | 'error';
  billing: BillingRowLike | null | 'error';
  check: 'ok' | 'G-8' | 'unavailable' | 'failed';
  timezone: 'ok' | 'error';
  insert: 'ok' | 'error';
  engine: PlanManageResult | 'throws';
  throwDeps: boolean;
}
let world: World;
jest.mock('@/lib/business-os/account-deletion/closureRequestDeps', () => ({
  closureRequestDeps: (): ClosureRequestDeps => {
    if (world.throwDeps) throw new Error(`boom ${EMAIL}`);
    return {
      closures: {
        findOpenForUser: async () => (world.open === 'error' ? { data: null, error: new Error('down') } : { data: world.open === 'pending' ? { id: CLOSURE, status: 'pending' } : null, error: null }),
        insertRequesting: async () => (world.insert === 'error' ? { data: null, error: new Error('down') } : { data: { id: CLOSURE, status: 'requesting' }, error: null }),
        transition: async () => ({ data: true, error: null }),
        deleteRequesting: async () => ({ data: true, error: null }),
      },
      billingRow: async () => (world.billing === 'error' ? { data: null, error: new Error('down') } : { data: world.billing, error: null }),
      livemode: () => false,
      pricesEnabled: () => true,
      runCheck: async () => {
        if (world.check === 'unavailable') return { kind: 'unavailable', reason: 'function_out_of_date', error: null };
        if (world.check === 'failed') return { kind: 'failed', error: new Error(`db said ${EMAIL}`) };
        const rows = world.check === 'G-8' ? [{ guard: 'G-8', item: 'stripe connect', found: 1 }] : [];
        return { kind: 'checked', canDelete: rows.length === 0, targetUserId: SUBJECT, blockers: [], notes: [], guards: [], rows, verdictBlocked: rows.length > 0, resolvedThisLogin: true, serverMs: 1 };
      },
      readTimezone: async () => (world.timezone === 'error' ? { data: null, error: new Error('down') } : { data: 'UTC', error: null }),
      manage: async () => {
        if (world.engine === 'throws') throw new Error(`stripe said ${EMAIL}`);
        return world.engine;
      },
      now: () => new Date('2026-11-04T10:00:00.000Z'),
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    };
  },
}));

import { POST } from '../route';
import { AUDIT_EVENTS } from '@/lib/audit/events';

const RENEWING: BillingRowLike = {
  stripeSubscriptionId: 'sub_own',
  subscriptionStatus: 'active',
  cancelAtPeriodEnd: false,
  currentPeriodEnd: ENDS,
  endedAt: null,
  failedAttempts: 0,
  pendingTier: null,
  openCheckoutSessionId: null,
  openCheckoutExpiresAt: null,
};
const UNKNOWN_AUDIT = { action: 'cancel' as const, outcome: 'unknown' as const, subscriptionId: 'sub_own', endsOn: null, renewsOn: null, livemode: false, mode: 'period_end' as const, reasonCode: 'other' as const, origin: 'deletion_request' as const };

const req = (body: unknown) =>
  new NextRequest('http://localhost/api/business-os/account/delete', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-correlation-id': 'corr-qa' },
  });
const OK = { statement: DELETION_STATEMENTS.he, language: 'he', reasonCode: 'other' };

beforeEach(() => {
  inserted.length = 0;
  world = { open: 'none', billing: RENEWING, check: 'ok', timezone: 'ok', insert: 'ok', engine: { ok: false, code: 'stripe_error' }, throwDeps: false };
  process.env[FLAG] = 'true';
  process.env[SECRET_ENV] = 's'.repeat(40);
  process.env[KEY_ENV] = 'k'.repeat(48);
  process.env.SYSTEM_ADMIN_USER_ID = SYSTEM_ADMIN;
  mockSession.mockReset().mockResolvedValue({ id: SUBJECT, email: EMAIL });
  mockRateLimit.mockReset().mockResolvedValue({ allowed: true, hits: 1, degraded: false });
});

afterAll(() => {
  delete process.env[FLAG];
  delete process.env[SECRET_ENV];
  delete process.env[KEY_ENV];
  delete process.env.SYSTEM_ADMIN_USER_ID;
});

const refusals = () => inserted.filter((row) => row.action === AUDIT_EVENTS.ACCOUNT_DELETION_REFUSED);

function expectOneOnSubject(reason: string) {
  const rows = refusals();
  expect(rows).toHaveLength(1);
  const [row] = rows;
  const details = row.details as Record<string, unknown>;
  expect(row.user_id).toBe(SUBJECT);
  expect(row.actor_id).toBe(SUBJECT);
  expect(row.entity_id).toBe(SUBJECT);
  expect(row.entity_type).toBe('user');
  expect(details.system_action).toBeUndefined();
  expect(details).toMatchObject({ source: 'self_service', stage: 'request', reason });
  const serialised = JSON.stringify(row);
  expect(serialised).not.toContain(SYSTEM_ADMIN);
  expect(serialised).not.toContain(EMAIL);
  expect(serialised).not.toContain(DELETION_STATEMENTS.he);
  expect(serialised).not.toMatch(/[0-9a-f]{64}/);
  return details;
}

it('a wrong statement past the failure budget (429) still writes its row on the subject', async () => {
  mockRateLimit.mockImplementation(async (_r: unknown, _k: string, _rule: unknown, outcome = 'ok') => ({ allowed: outcome !== 'failure', hits: 9, degraded: false }));
  expect((await POST(req({ ...OK, statement: 'nope' }))).status).toBe(429);
  expectOneOnSubject('statement_mismatch');
});

it.each<[string, () => void, number, string]>([
  ['no login email (V-1)', () => mockSession.mockResolvedValue({ id: SUBJECT, email: null }), 503, 'not_available'],
  ['no fingerprint key', () => delete process.env[KEY_ENV], 503, 'not_available'],
  ['the closure read fails', () => (world.open = 'error'), 503, 'closure_read_failed'],
  ['the billing row is unreadable', () => (world.billing = 'error'), 503, 'billing_row_unreadable'],
  ['a failed last payment (BQ-11)', () => (world.billing = { ...RENEWING, subscriptionStatus: 'past_due' }), 409, 'payment_failed'],
  ['a plan change pending', () => (world.billing = { ...RENEWING, pendingTier: 'tier_two' }), 409, 'change_pending'],
  ['blocked on the check (G-8)', () => (world.check = 'G-8'), 409, 'blocked'],
  ['the check function out of date', () => (world.check = 'unavailable'), 503, 'function_out_of_date'],
  ['the check failed (its message holds the email)', () => (world.check = 'failed'), 503, 'check_failed'],
  ['free: the timezone unreadable', () => {
    world.billing = null;
    world.timezone = 'error';
  }, 503, 'timezone_unreadable'],
  ['the insert failed', () => (world.insert = 'error'), 503, 'closure_insert_failed'],
  ['a definite engine refusal', () => (world.engine = { ok: false, code: 'billing_record_mismatch' }), 409, 'plan_billing_record_mismatch'],
  ['the engine throws (its message holds the email)', () => (world.engine = 'throws'), 500, 'unexpected_failed'],
  ['the route itself throws (its message holds the email)', () => (world.throwDeps = true), 500, 'unexpected_failed'],
])('%s → %s, one refusal row on the subject', async (_label, arrange, status, reason) => {
  arrange();
  expect((await POST(req(OK))).status).toBe(status);
  expectOneOnSubject(reason);
});

it('blocked: the row carries the guard ids, never the item text', async () => {
  world.check = 'G-8';
  await POST(req(OK));
  const details = expectOneOnSubject('blocked');
  expect(details.guards).toEqual(['G-8']);
  expect(JSON.stringify(details)).not.toContain('stripe connect');
});

it('a lost Stripe answer → the money row (unknown) on the subject, then the refusal row', async () => {
  world.engine = { ok: false, code: 'stripe_error', outcomeUnknown: true, audit: UNKNOWN_AUDIT };
  expect((await POST(req(OK))).status).toBe(502);
  expectOneOnSubject('plan_outcome_unknown');
  const [money] = inserted.filter((row) => row.action === AUDIT_EVENTS.BOS_BILLING_SUBSCRIPTION_CANCELLED);
  expect(money).toMatchObject({ user_id: SUBJECT, actor_id: SUBJECT });
  expect(money.details).toMatchObject({ outcome: 'unknown', origin: 'deletion_request' });
});

it('an open request already → 409 and NO row (nothing was attempted)', async () => {
  world.open = 'pending';
  expect((await POST(req(OK))).status).toBe(409);
  expect(inserted).toEqual([]);
});
