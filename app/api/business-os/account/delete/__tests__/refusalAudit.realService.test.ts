/**
 * The deletion REQUEST's audit rows through the REAL `logAndFlush` →
 * `AuditTrailService.buildLogEntry` → insert (DL-1b / D6; requirement XC-13;
 * SA W-14; carried from DE-10b.2's QA B-1 / SA addendum).
 *
 * `buildLogEntry` rewrites a NULL `userId` to `SYSTEM_ADMIN_USER_ID` and sets
 * `details.system_action: true`. That is what makes the success rows SURVIVE
 * stage E (which deletes audit_trail by user_id), and exactly what a refusal
 * must NOT get (B-1: the account stays, the row is the owner's). Only the
 * Supabase client is faked (its `from('audit_trail').insert(rows)` captures
 * the rows); the session, throttle and the request's ports are mocked.
 *
 *   (a) success, paid: REQUESTED on the system user with the owner as actor;
 *       the money row on the owner
 *   (b) success, free: REQUESTED and GRACE_STARTED on the system user
 *   (c) a refusal: on the session user, never the platform admin
 *   (d) negative control: the harness would catch a NULL user
 */

import { NextRequest } from 'next/server';
import { DELETION_STATEMENTS } from '@/lib/business-os/account-deletion/acknowledgement';
import type { BillingRowLike, ClosureRequestDeps } from '@/lib/business-os/account-deletion/closureRequest';

const FLAG = 'BUSINESS_OS_ACCOUNT_SELF_DELETE_ENABLED';
const SECRET_ENV = ['TEST', 'CLEANUP', 'SECRET'].join('_');
const KEY_ENV = ['DELETION', 'RECEIPT', 'FINGERPRINT', 'KEY'].join('_');
const SUBJECT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SYSTEM_ADMIN = '55555555-5555-4555-8555-555555555555';
const CLOSURE = '44444444-4444-4444-8444-444444444444';
const EMAIL = 'jane.owner@example.org';
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
jest.mock('@/lib/security/rateLimit', () => {
  const actual = jest.requireActual('@/lib/security/rateLimit');
  return { ...actual, rateLimit: async () => ({ allowed: true, hits: 1, degraded: false }) };
});
jest.mock('@/lib/business-os/account-deletion/selfServiceDeletion', () => ({
  errorKindFacts: () => ({ kind: null, code: null, name: null }),
}));
let billing: BillingRowLike | null;
let checkRows: Array<{ guard: string; found?: number }>;
jest.mock('@/lib/business-os/account-deletion/closureRequestDeps', () => ({
  closureRequestDeps: (): ClosureRequestDeps => ({
    closures: {
      findOpenForUser: async () => ({ data: null, error: null }),
      insertRequesting: async () => ({ data: { id: CLOSURE, status: 'requesting' }, error: null }),
      transition: async () => ({ data: true, error: null }),
      deleteRequesting: async () => ({ data: true, error: null }),
    },
    billingRow: async () => ({ data: billing, error: null }),
    livemode: () => false,
    pricesEnabled: () => true,
    runCheck: async () => ({ kind: 'checked', canDelete: true, targetUserId: SUBJECT, blockers: [], notes: [], guards: [], rows: checkRows, verdictBlocked: checkRows.length > 0, resolvedThisLogin: true, serverMs: 1 }),
    readTimezone: async () => ({ data: null, error: null }),
    manage: async () => ({
      ok: true,
      outcome: 'cancelled',
      endsOn: ENDS,
      audit: { action: 'cancel', outcome: 'cancelled', subscriptionId: 'sub_own', endsOn: ENDS, renewsOn: null, livemode: false, mode: 'period_end', reasonCode: 'other', origin: 'deletion_request' },
    }),
    now: () => new Date('2026-11-04T10:00:00.000Z'),
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  }),
}));

import { POST } from '../route';
import { logAndFlush } from '@/lib/audit/boundedAuditFlush';
import { AUDIT_EVENTS } from '@/lib/audit/events';

const quietLogger = { warn: () => undefined, error: () => undefined };
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

const req = (body: unknown) =>
  new NextRequest('http://localhost/api/business-os/account/delete', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-correlation-id': 'corr-b1' },
  });
const OK = { statement: DELETION_STATEMENTS.en, language: 'en', reasonCode: 'other' };

beforeEach(() => {
  inserted.length = 0;
  billing = RENEWING;
  checkRows = [];
  process.env[FLAG] = 'true';
  process.env[SECRET_ENV] = 's'.repeat(40);
  process.env[KEY_ENV] = 'k'.repeat(48);
  process.env.SYSTEM_ADMIN_USER_ID = SYSTEM_ADMIN;
  mockSession.mockReset().mockResolvedValue({ id: SUBJECT, email: EMAIL });
});

afterAll(() => {
  delete process.env[FLAG];
  delete process.env[SECRET_ENV];
  delete process.env[KEY_ENV];
  delete process.env.SYSTEM_ADMIN_USER_ID;
});

const rowsOf = (action: string) => inserted.filter((row) => row.action === action);

function expectClean(row: Record<string, unknown>) {
  const serialised = JSON.stringify(row);
  expect(serialised).not.toContain(EMAIL);
  expect(serialised).not.toContain(DELETION_STATEMENTS.en);
  expect(serialised).not.toMatch(/[0-9a-f]{64}/);
}

function expectSurvivesE(row: Record<string, unknown>) {
  expect(row.user_id).toBe(SYSTEM_ADMIN);
  expect(row.actor_id).toBe(SUBJECT);
  expect(row.entity_id).toBe(SUBJECT);
  expect((row.details as Record<string, unknown>).system_action).toBe(true);
  expectClean(row);
}

it('(a) paid success: REQUESTED on the system user (survives E) with the owner as actor; the money row on the owner', async () => {
  const res = await POST(req(OK));
  expect(res.status).toBe(200);
  const [requested] = rowsOf(AUDIT_EVENTS.ACCOUNT_DELETION_REQUESTED);
  expectSurvivesE(requested);
  expect(requested.details).toMatchObject({ closure_id: CLOSURE, status: 'pending', renewal_was_on: true, reason_code: 'other', statement_language: 'en', source: 'self_service', stage: 'request' });
  const [money] = rowsOf(AUDIT_EVENTS.BOS_BILLING_SUBSCRIPTION_CANCELLED);
  expect(money.user_id).toBe(SUBJECT);
  expect(money.actor_id).toBe(SUBJECT);
  expect(money.details).toMatchObject({ origin: 'deletion_request', closure_id: CLOSURE });
  expect(rowsOf(AUDIT_EVENTS.ACCOUNT_DELETION_REFUSED)).toEqual([]);
});

it('(b) free success: REQUESTED and GRACE_STARTED on the system user, the owner as actor', async () => {
  billing = null;
  expect((await POST(req(OK))).status).toBe(200);
  expectSurvivesE(rowsOf(AUDIT_EVENTS.ACCOUNT_DELETION_REQUESTED)[0]);
  const [grace] = rowsOf(AUDIT_EVENTS.ACCOUNT_GRACE_STARTED);
  expectSurvivesE(grace);
  expect(grace.details).toMatchObject({ lock_at: '2026-11-18T00:00:00.000Z', lock_timezone: 'UTC' });
  expect(rowsOf(AUDIT_EVENTS.BOS_BILLING_SUBSCRIPTION_CANCELLED)).toEqual([]);
});

it.each([
  ['a wrong statement', () => req({ ...OK, statement: `${EMAIL} ${DELETION_STATEMENTS.en.slice(0, 20)}` }), 400, 'statement_mismatch'],
  ['a blocker at A (G-8)', () => {
    checkRows = [{ guard: 'G-8', found: 1 }];
    return req(OK);
  }, 409, 'blocked'],
])('(c) %s: one refusal row on the session user, never the platform admin', async (_label, build, status, reason) => {
  const res = await POST(build());
  expect(res.status).toBe(status);
  const rows = rowsOf(AUDIT_EVENTS.ACCOUNT_DELETION_REFUSED);
  expect(rows).toHaveLength(1);
  expect(rows[0].user_id).toBe(SUBJECT);
  expect(rows[0].actor_id).toBe(SUBJECT);
  expect((rows[0].details as Record<string, unknown>).system_action).toBeUndefined();
  expect(rows[0].details).toMatchObject({ reason, source: 'self_service', stage: 'request', correlation_id: 'corr-b1' });
  expectClean(rows[0]);
});

it('(d) negative control: the same harness records a NULL user as the platform admin with system_action', async () => {
  await logAndFlush(
    { action: AUDIT_EVENTS.ACCOUNT_DELETION_REFUSED, entityType: 'user', entityId: SUBJECT, userId: null, actorId: null, details: { source: 'self_service', reason: 'statement_mismatch' } },
    quietLogger,
    { reason: 'negative control', continues: 'continuing' }
  );
  const rows = rowsOf(AUDIT_EVENTS.ACCOUNT_DELETION_REFUSED);
  expect(rows).toHaveLength(1);
  expect(rows[0].user_id).toBe(SYSTEM_ADMIN);
  expect((rows[0].details as Record<string, unknown>).system_action).toBe(true);
});
