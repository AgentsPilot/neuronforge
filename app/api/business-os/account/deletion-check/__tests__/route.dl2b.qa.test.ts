/**
 * QA (DL-2b): GET /api/business-os/account/deletion-check over the REAL
 * timeline stack: the route, `readClosureTimeline`, the production ports in
 * `closureTimelineDeps.ts`, `UserPreferencesRepository.findTimezone` and
 * `SchedulingBookingRepository.countUpcomingBookings`. Only the database (a
 * recorded fake `supabaseServer`), the entitlements resolver behind
 * `readPlanEndingView`, and the pre-existing check edges are mocked.
 *
 * Fills what the Dev suites leave out (they mock `closureTimelineDeps` whole):
 * the ports' own mapping, the session id reaching both DB reads, the wire for
 * free / paid / Founding Partner back_to_plan / count 0, and each DB failure
 * mode leaving the check a 200 (DL-2 workplan §6.1 T-1 to T-5, §6.2, D-12).
 * No network: every DB call lands on the fake client.
 */

import { NextRequest } from 'next/server';

const FLAG = 'BUSINESS_OS_ACCOUNT_SELF_DELETE_ENABLED';
const SECRET_ENV = ['TEST', 'CLEANUP', 'SECRET'].join('_');
const KEY_ENV = ['DELETION', 'RECEIPT', 'FINGERPRINT', 'KEY'].join('_');
const SUBJECT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EMAIL = 'jane.owner@example.org';

const mockLogged: unknown[] = [];
jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = {};
  for (const level of ['info', 'warn', 'error', 'debug', 'trace', 'fatal']) logger[level] = (...args: unknown[]) => mockLogged.push(...args);
  logger.child = () => logger;
  return { createLogger: () => logger, logger };
});

const mockSession = jest.fn();
jest.mock('@/lib/business-os/account-deletion/sessionSubject', () => {
  const actual = jest.requireActual('@/lib/business-os/account-deletion/sessionSubject');
  return { ...actual, readSessionSubject: () => mockSession() };
});
jest.mock('@/lib/security/rateLimit', () => {
  const actual = jest.requireActual('@/lib/security/rateLimit');
  return { ...actual, rateLimit: () => Promise.resolve({ allowed: true, hits: 1, degraded: false }) };
});
jest.mock('@/lib/business-os/account-deletion/selfServiceDeletion', () => ({
  runAccountDeletionCheck: () =>
    Promise.resolve({ kind: 'checked', canDelete: true, targetUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', blockers: [], notes: [], guards: [], rows: [], verdictBlocked: false, resolvedThisLogin: true, serverMs: 3 }),
  errorKindFacts: () => ({ kind: null, code: null, name: null }),
}));
jest.mock('@/lib/repositories/BusinessOsDataExportJobRepository', () => ({
  BusinessOsDataExportJobRepository: jest.fn().mockImplementation(() => ({
    findDeletionFacts: () => Promise.resolve({ data: null, error: null }),
  })),
}));
const mockBilling = jest.fn();
jest.mock('@/lib/business-os/account-deletion/closureRequestDeps', () => ({
  readDeletionBillingRow: (...args: unknown[]) => mockBilling(...args),
}));
jest.mock('@/lib/business-os/billing/planPricesFlag', () => ({ isPlanPriceRecognitionEnabled: () => true }));
jest.mock('@/lib/business-os/insight/events/recordEvent', () => ({ recordBusinessEvent: jest.fn() }));

// The entitlements resolver (the only DB-backed part of the plan ending view).
const mockEndingView = jest.fn();
jest.mock('@/lib/business-os/entitlements/planEndingView', () => ({
  readPlanEndingView: (...args: unknown[]) => mockEndingView(...args),
}));

// The database: one recorded fake service-role client for both repositories.
interface DbAnswer {
  timezone: { data: unknown; error: unknown } | 'throw';
  count: { count: number | null; error: unknown };
}
const mockDb: { answer: DbAnswer; calls: Array<{ table: string; op: string; args: unknown[] }> } = {
  answer: { timezone: { data: { timezone: 'Asia/Jerusalem' }, error: null }, count: { count: 0, error: null } },
  calls: [],
};
jest.mock('@/lib/supabaseServer', () => {
  const from = (table: string) => {
    const builder: Record<string, unknown> = {};
    for (const op of ['select', 'eq', 'in', 'gte', 'is', 'lte', 'neq', 'order', 'limit']) {
      builder[op] = (...args: unknown[]) => {
        mockDb.calls.push({ table, op, args });
        return builder;
      };
    }
    builder.maybeSingle = () => {
      const answer = mockDb.answer.timezone;
      if (answer === 'throw') return Promise.reject(new Error('socket hang up'));
      return Promise.resolve(answer);
    };
    builder.then = (resolve: (v: unknown) => unknown, reject: (r: unknown) => unknown) =>
      Promise.resolve({ data: null, ...mockDb.answer.count }).then(resolve, reject);
    return builder;
  };
  return { supabaseServer: { from }, default: { from } };
});

import { GET } from '../route';
import { deletionCheckResponseSchema } from '@/lib/business-os/account-deletion/schemas';
import { closureLockAt } from '@/lib/business-os/account-deletion/closureDates';

const URL_BASE = 'http://localhost/api/business-os/account/deletion-check';
const NOW = new Date('2026-11-20T10:00:00.000Z');
const PERIOD_END = '2026-12-05T10:00:00.000Z';
const paidRow = (o: Record<string, unknown> = {}) => ({
  stripeSubscriptionId: 'sub_1',
  subscriptionStatus: 'active',
  cancelAtPeriodEnd: false,
  currentPeriodEnd: PERIOD_END,
  endedAt: null,
  failedAttempts: 0,
  pendingTier: null,
  openCheckoutSessionId: null,
  openCheckoutExpiresAt: null,
  ...o,
});

async function check(query = '?lang=en') {
  const res = await GET(new NextRequest(`${URL_BASE}${query}`));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(deletionCheckResponseSchema.safeParse(body).success).toBe(true);
  return body.data;
}

const callsOn = (table: string) => mockDb.calls.filter((call) => call.table === table);

beforeEach(() => {
  mockLogged.length = 0;
  mockDb.calls.length = 0;
  mockDb.answer = { timezone: { data: { timezone: 'Asia/Jerusalem' }, error: null }, count: { count: 0, error: null } };
  process.env[FLAG] = 'true';
  process.env[SECRET_ENV] = 's'.repeat(40);
  process.env[KEY_ENV] = 'k'.repeat(48);
  mockSession.mockReset().mockResolvedValue({ id: SUBJECT, email: EMAIL });
  mockBilling.mockReset().mockResolvedValue({ kind: 'row', row: null });
  mockEndingView.mockReset().mockResolvedValue({ kind: 'free_plan', endsAt: PERIOD_END, planName: 'Test Flight', until: '2027-01-01T00:00:00Z', credits: null, loses: [], thenReadOnlyDays: null, thenPausedFrom: null });
  jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'queueMicrotask', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'hrtime', 'performance'] });
});
afterEach(() => jest.useRealTimers());
afterAll(() => {
  delete process.env[FLAG];
  delete process.env[SECRET_ENV];
  delete process.env[KEY_ENV];
});

describe('QA DL-2b: the route over the real timeline ports and repositories', () => {
  it('free: the lock from now on the stored zone; both DB reads are scoped to the SESSION user', async () => {
    mockDb.answer.count = { count: 3, error: null };
    const body = await check();
    const lockAt = closureLockAt(NOW, 'Asia/Jerusalem').lockAt;
    expect(body.timeline).toEqual({ kind: 'free', lockAt, timezone: 'Asia/Jerusalem', graceDays: 14 });
    expect(body.futureBookings).toEqual({ count: 3 });
    expect(mockEndingView).not.toHaveBeenCalled();

    expect(callsOn('user_preferences')).toEqual(expect.arrayContaining([{ table: 'user_preferences', op: 'eq', args: ['user_id', SUBJECT] }]));
    const bookings = callsOn('scheduling_bookings');
    expect(bookings).toEqual([
      { table: 'scheduling_bookings', op: 'select', args: ['id', { count: 'exact', head: true }] },
      { table: 'scheduling_bookings', op: 'eq', args: ['user_id', SUBJECT] },
      { table: 'scheduling_bookings', op: 'in', args: ['status', ['confirmed', 'pending']] },
      { table: 'scheduling_bookings', op: 'gte', args: ['start_time', lockAt] },
    ]);
  });

  it('a real zero is a 0 on the wire (the drawer then shows no bookings line)', async () => {
    expect((await check()).futureBookings).toEqual({ count: 0 });
  });

  it('paid: the view is read for the session account and the period end, in the asked language', async () => {
    mockBilling.mockResolvedValue({ kind: 'row', row: paidRow() });
    mockDb.answer.count = { count: 1, error: null };
    const body = await check('?lang=es');
    const lockAt = closureLockAt(new Date(PERIOD_END), 'Asia/Jerusalem').lockAt;
    expect(body.timeline).toEqual({
      kind: 'paid', planEndsAt: PERIOD_END, lockAt, timezone: 'Asia/Jerusalem', graceDays: 14, during: 'free_plan', planName: 'Test Flight', trialing: false,
    });
    expect(mockEndingView).toHaveBeenCalledWith({ accountId: SUBJECT, endsAt: PERIOD_END, locale: 'es' });
    expect(callsOn('scheduling_bookings').find((call) => call.op === 'gte')?.args).toEqual(['start_time', lockAt]);
    expect(body.futureBookings).toEqual({ count: 1 });
  });

  it('Founding Partner with a paid plan → back_to_plan carrying the cohort name (P-12)', async () => {
    mockBilling.mockResolvedValue({ kind: 'row', row: paidRow({ cancelAtPeriodEnd: true }) });
    mockEndingView.mockResolvedValue({ kind: 'back_to_plan', endsAt: PERIOD_END, planName: 'Founding Partner', until: null, loses: [] });
    expect((await check()).timeline).toMatchObject({ kind: 'paid', during: 'back_to_plan', planName: 'Founding Partner' });
  });

  it('the view answers unknown → during unknown, no name leaks through', async () => {
    mockBilling.mockResolvedValue({ kind: 'row', row: paidRow() });
    mockEndingView.mockResolvedValue({ kind: 'unknown', endsAt: PERIOD_END, planName: 'should not show' });
    expect((await check()).timeline).toMatchObject({ kind: 'paid', during: 'unknown', planName: null });
  });

  it('trialing → paid with trialing: true', async () => {
    mockBilling.mockResolvedValue({ kind: 'row', row: paidRow({ subscriptionStatus: 'trialing' }) });
    expect((await check()).timeline).toMatchObject({ kind: 'paid', trialing: true });
  });

  it('a NULL stored zone ("not asked") → UTC, said on the wire', async () => {
    mockDb.answer.timezone = { data: { timezone: null }, error: null };
    expect((await check()).timeline).toMatchObject({ kind: 'free', timezone: 'UTC', lockAt: closureLockAt(NOW, null).lockAt });
  });

  it.each([
    ['a PostgREST error', { data: null, error: { code: '42703', message: 'column does not exist' } }],
    ['a thrown read', 'throw' as const],
  ])('T-2 the timezone read fails with %s → timeline null, count null, no count query, 200', async (_label, answer) => {
    mockDb.answer.timezone = answer;
    const body = await check();
    expect(body).toMatchObject({ available: true, timeline: null, futureBookings: { count: null } });
    expect(callsOn('scheduling_bookings')).toHaveLength(0);
  });

  it.each([
    ['a PostgREST error', { count: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }],
    ['no count and no error', { count: null, error: null }],
  ])('T-5 the count comes back with %s → { count: null }, never 0, timeline intact, 200', async (_label, answer) => {
    mockDb.answer.count = answer;
    const body = await check();
    expect(body.futureBookings).toEqual({ count: null });
    expect(body.timeline).toMatchObject({ kind: 'free' });
    expect(JSON.stringify(mockLogged)).toContain('bookings_count_failed');
  });

  it('T-4 the resolver throws → during unknown; the count still runs; 200', async () => {
    mockBilling.mockResolvedValue({ kind: 'row', row: paidRow() });
    mockEndingView.mockRejectedValue(new Error('resolver down'));
    mockDb.answer.count = { count: 2, error: null };
    const body = await check();
    expect(body.timeline).toMatchObject({ kind: 'paid', during: 'unknown', planName: null });
    expect(body.futureBookings).toEqual({ count: 2 });
  });

  it('T-1 an open checkout on a free row (refuse) → timeline null, no DB read for the timeline', async () => {
    mockBilling.mockResolvedValue({
      kind: 'row',
      row: paidRow({ stripeSubscriptionId: null, subscriptionStatus: null, currentPeriodEnd: null, openCheckoutSessionId: 'cs_1', openCheckoutExpiresAt: '2026-11-21T10:00:00.000Z' }),
    });
    const body = await check();
    expect(body.timeline).toBeNull();
    expect(body.futureBookings).toEqual({ count: null });
    expect(mockDb.calls).toHaveLength(0);
  });

  it('a request value never reaches a DB id: ?lang only, any other key is a 400 with no DB call', async () => {
    const res = await GET(new NextRequest(`${URL_BASE}?lang=en&user_id=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.details).toBeUndefined(); // NODE_ENV is 'test', not development
    expect(mockDb.calls).toHaveLength(0);
    expect(mockSession).not.toHaveBeenCalled();
  });

  it('the session email never reaches a log line on the DL-2b paths (paid, count failure)', async () => {
    mockBilling.mockResolvedValue({ kind: 'row', row: paidRow() });
    mockDb.answer.count = { count: null, error: { code: '57014', message: 'timeout' } };
    await check();
    expect(JSON.stringify(mockLogged)).not.toContain(EMAIL);
  });
});
