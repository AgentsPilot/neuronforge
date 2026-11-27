/**
 * GET /api/business-os/account/deletion-check (data export DE-10b.2; workplan
 * §2.3, §4.2; SA O2-1, V-1, V-2). The real route and blocker mapping over
 * mocked edges: session, throttle, self-service check runner, export facts.
 *
 * DL-1b (workplan §9; SA W-4, Q-15): the blockers are the deletion REQUEST's,
 * from the XC-5 filter over the check's RAW rows plus `payment_failed` from
 * our billing row (mocked here through `readDeletionBillingRow`).
 *
 * DL-2b (DL-2 workplan §6.1, T-1 to T-5, §12): the strict `?lang=` query, and
 * the additive `timeline` and `futureBookings`, over mocked timeline ports
 * (`closureTimelineDeps`): each failure mode leaves the check a 200.
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
  for (const level of ['info', 'warn', 'error', 'debug']) logger[level] = (...args: unknown[]) => mockLogged.push(...args);
  logger.child = (...args: unknown[]) => {
    mockLogged.push(...args);
    return logger;
  };
  return { createLogger: () => logger };
});

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

const mockCheck = jest.fn();
jest.mock('@/lib/business-os/account-deletion/selfServiceDeletion', () => ({
  runAccountDeletionCheck: (...args: unknown[]) => mockCheck(...args),
  errorKindFacts: () => ({ kind: null, code: null, name: null }),
}));

const mockFacts = jest.fn();
jest.mock('@/lib/repositories/BusinessOsDataExportJobRepository', () => ({
  BusinessOsDataExportJobRepository: jest.fn().mockImplementation(() => ({ findDeletionFacts: (...args: unknown[]) => mockFacts(...args) })),
}));

const mockBilling = jest.fn();
jest.mock('@/lib/business-os/account-deletion/closureRequestDeps', () => ({
  readDeletionBillingRow: (...args: unknown[]) => mockBilling(...args),
}));

const mockTimezone = jest.fn();
const mockEnding = jest.fn();
const mockCount = jest.fn();
const mockPrices = jest.fn();
jest.mock('@/lib/business-os/account-deletion/closureTimelineDeps', () => ({
  closureTimelineDeps: () => ({
    pricesEnabled: () => mockPrices(),
    readTimezone: (...args: unknown[]) => mockTimezone(...args),
    readPlanEnding: (...args: unknown[]) => mockEnding(...args),
    countUpcomingBookings: (...args: unknown[]) => mockCount(...args),
  }),
}));

import { GET } from '../route';
import { deletionCheckResponseSchema } from '@/lib/business-os/account-deletion/schemas';
import { closureLockAt } from '@/lib/business-os/account-deletion/closureDates';

const BASE_URL = 'http://localhost/api/business-os/account/deletion-check';
const req = (query = '') => new NextRequest(`${BASE_URL}${query}`);

const NOW = new Date('2026-11-20T10:00:00.000Z');
const PERIOD_END = '2026-12-05T10:00:00.000Z';
const ZONE = 'Asia/Jerusalem';
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

const CHECKED = { kind: 'checked', canDelete: true, targetUserId: SUBJECT, blockers: [], notes: [], guards: [], rows: [], verdictBlocked: false, resolvedThisLogin: true, serverMs: 3 };

beforeEach(() => {
  mockLogged.length = 0;
  process.env[FLAG] = 'true';
  process.env[SECRET_ENV] = 's'.repeat(40);
  process.env[KEY_ENV] = 'k'.repeat(48);
  mockSession.mockReset().mockResolvedValue({ id: SUBJECT, email: EMAIL });
  mockRateLimit.mockReset().mockResolvedValue({ allowed: true, hits: 1, degraded: false });
  mockCheck.mockReset().mockResolvedValue(CHECKED);
  mockBilling.mockReset().mockResolvedValue({ kind: 'row', row: null });
  mockFacts.mockReset().mockResolvedValue({ data: { ownerLastExportReadyAt: '2026-10-10T10:00:00Z', ownerExportDownloadedAt: null, adminExportExisted: false }, error: null });
  mockTimezone.mockReset().mockResolvedValue({ ok: true, stored: ZONE });
  mockEnding.mockReset().mockResolvedValue({ kind: 'free_plan', planName: 'Test Flight' });
  mockCount.mockReset().mockResolvedValue({ data: 2, error: null });
  mockPrices.mockReset().mockReturnValue(true);
  // Only the clock is fixed; every timer stays real (the route awaits real promises).
  jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'queueMicrotask', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'hrtime', 'performance'] });
});

afterEach(() => {
  jest.useRealTimers();
});

afterAll(() => {
  delete process.env[FLAG];
  delete process.env[SECRET_ENV];
  delete process.env[KEY_ENV];
});

async function data(res: Response) {
  const body = await res.json();
  expect(deletionCheckResponseSchema.safeParse(body).success).toBe(true);
  return body.data;
}

describe('the off switch (O2-1)', () => {
  it('200 { enabled: false } before the session is read', async () => {
    delete process.env[FLAG];
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await data(res)).toEqual({ enabled: false });
    expect(mockSession).not.toHaveBeenCalled();
    expect(mockCheck).not.toHaveBeenCalled();
  });
});

describe('auth and throttle', () => {
  it('401 without a session, nothing else', async () => {
    mockSession.mockResolvedValue(null);
    expect((await GET(req())).status).toBe(401);
    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(mockCheck).not.toHaveBeenCalled();
  });

  it('429 when throttled, before the check', async () => {
    mockRateLimit.mockResolvedValue({ allowed: false, hits: 200, degraded: false });
    const res = await GET(req());
    expect(res.status).toBe(429);
    // SA N-2: no-store on the 429 too.
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(mockCheck).not.toHaveBeenCalled();
  });
});

describe('available: false', () => {
  it.each([
    ['no login email (V-1)', () => mockSession.mockResolvedValue({ id: SUBJECT, email: null })],
    ['no cleanup secret', () => delete process.env[SECRET_ENV]],
    ['no fingerprint key', () => delete process.env[KEY_ENV]],
  ])('%s → the engine is not called', async (_name, arrange) => {
    arrange();
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await data(res)).toMatchObject({ enabled: true, available: false, blockers: [] });
    expect(mockCheck).not.toHaveBeenCalled();
  });

  it('a function out of date or a refused secret → available: false', async () => {
    mockCheck.mockResolvedValue({ kind: 'unavailable', reason: 'function_out_of_date', error: null });
    expect(await data(await GET(req()))).toMatchObject({ enabled: true, available: false });
  });
});

describe('the happy path', () => {
  it('checks the SESSION user and returns no email', async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    const body = await data(res);
    expect(body).toEqual({
      enabled: true,
      available: true,
      blockers: [],
      willKeepBilling: false,
      exportFacts: { lastReadyAt: '2026-10-10T10:00:00Z', downloaded: false },
      // DL-2b: no billing row → free, grace from now; the count is from the lock date.
      timeline: { kind: 'free', lockAt: closureLockAt(NOW, ZONE).lockAt, timezone: ZONE, graceDays: 14 },
      futureBookings: { count: 2 },
    });
    expect(mockCheck).toHaveBeenCalledWith({ email: EMAIL, subject: SUBJECT });
    expect(mockTimezone).toHaveBeenCalledWith(SUBJECT);
    expect(mockCount).toHaveBeenCalledWith(SUBJECT, closureLockAt(NOW, ZONE).lockAt);
    expect(mockEnding).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain(EMAIL);
  });

  it('blockers in plain words, notes as willKeepBilling (a legacy trace alone included)', async () => {
    mockCheck.mockResolvedValue({
      ...CHECKED,
      canDelete: false,
      blockers: [{ guard: 'G-8', item: 'no Stripe account connected for client payments', found: 1 }],
      rows: [{ guard: 'G-8', item: 'no Stripe account connected for client payments', found: 1 }],
      verdictBlocked: true,
      notes: [{ guard: 'G-7', item: 'legacy billing event from Stripe', found: 1 }],
      guards: ['G-8'],
    });
    expect(await data(await GET(req()))).toMatchObject({ blockers: [{ code: 'stripe_connected' }], willKeepBilling: true });
  });

  it('an export facts failure shows "none on record" rather than failing', async () => {
    mockFacts.mockResolvedValue({ data: null, error: new Error('db') });
    expect(await data(await GET(req()))).toMatchObject({ available: true, exportFacts: { lastReadyAt: null, downloaded: false } });
  });
});

describe('DL-1b: the request\'s blockers (XC-5, W-4, Q-15)', () => {
  const blockedBy = (rows: Array<{ guard: string; item?: string; found?: number }>) =>
    mockCheck.mockResolvedValue({ ...CHECKED, canDelete: false, rows, verdictBlocked: true, blockers: rows.filter((r) => r.guard !== 'G-12'), guards: rows.map((r) => r.guard) });

  it.each([
    ['G-6 alone (a plan running)', [{ guard: 'G-6', found: 1 }]],
    ['G-12 alone (files)', [{ guard: 'G-12', found: 4 }]],
    ['an engineering guard (G-17)', [{ guard: 'G-17', item: 'x', found: 1 }]],
  ])('%s → no blocker shown', async (_label, rows) => {
    blockedBy(rows);
    expect(await data(await GET(req()))).toMatchObject({ available: true, blockers: [] });
  });

  it('the check resolved another login → contact_support', async () => {
    mockCheck.mockResolvedValue({ ...CHECKED, resolvedThisLogin: false, targetUserId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
    expect(await data(await GET(req()))).toMatchObject({ blockers: [{ code: 'contact_support' }] });
  });

  it('a failed renewal on our billing row → payment_failed (BQ-11), read for the session user', async () => {
    mockBilling.mockResolvedValue({ kind: 'row', row: { stripeSubscriptionId: 'sub_1', subscriptionStatus: 'past_due', cancelAtPeriodEnd: false, currentPeriodEnd: null, endedAt: null, failedAttempts: 1, pendingTier: null, openCheckoutSessionId: null, openCheckoutExpiresAt: null } });
    blockedBy([{ guard: 'G-6', found: 1 }]);
    expect(await data(await GET(req()))).toMatchObject({ blockers: [{ code: 'payment_failed' }] });
    expect(mockBilling).toHaveBeenCalledWith(SUBJECT);
  });

  it('the Stripe key mode unknown → available: false; the billing row unreadable → 500', async () => {
    mockBilling.mockResolvedValueOnce({ kind: 'mode_unknown' });
    expect(await data(await GET(req()))).toMatchObject({ available: false });
    mockBilling.mockResolvedValueOnce({ kind: 'unreadable' });
    expect((await GET(req())).status).toBe(500);
  });
});

describe('failures', () => {
  it('a failed check → 500 without detail', async () => {
    mockCheck.mockResolvedValue({ kind: 'failed', error: new Error(`raw ${EMAIL}`) });
    const res = await GET(req());
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain(EMAIL);
    expect(JSON.stringify(mockLogged)).not.toContain(EMAIL);
  });
});

describe('DL-2b: the lang query (strict Zod)', () => {
  it.each([['en'], ['he'], ['es']])('?lang=%s is accepted and passed to the plan ending view', async (lang) => {
    mockBilling.mockResolvedValue({ kind: 'row', row: paidRow() });
    const res = await GET(req(`?lang=${lang}`));
    expect(res.status).toBe(200);
    await data(res);
    expect(mockEnding).toHaveBeenCalledWith({ userId: SUBJECT, endsAt: PERIOD_END, locale: lang });
  });

  it('no lang → en', async () => {
    mockBilling.mockResolvedValue({ kind: 'row', row: paidRow() });
    await data(await GET(req()));
    expect(mockEnding).toHaveBeenCalledWith(expect.objectContaining({ locale: 'en' }));
  });

  it.each([
    ['an unknown language', '?lang=fr'],
    ['an empty language', '?lang='],
    ['an extra key (identity cannot be steered)', '?lang=en&userId=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'],
    ['a key that is not lang', '?userId=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'],
  ])('%s → 400 invalid_query, no-store, nothing read', async (_label, query) => {
    const res = await GET(req(query));
    expect(res.status).toBe(400);
    expect(res.headers.get('cache-control')).toContain('no-store');
    const body = await res.json();
    expect(body).toMatchObject({ success: false, error: 'invalid_query' });
    expect(mockSession).not.toHaveBeenCalled();
    expect(mockCheck).not.toHaveBeenCalled();
    expect(mockTimezone).not.toHaveBeenCalled();
  });
});

describe('DL-2b: timeline and futureBookings (§6.1 T-1 to T-5)', () => {
  const lockFromPeriodEnd = closureLockAt(new Date(PERIOD_END), ZONE).lockAt;

  it('paid: the period end, its projected lock, the after-plan, the count from the lock', async () => {
    mockBilling.mockResolvedValue({ kind: 'row', row: paidRow() });
    const body = await data(await GET(req('?lang=he')));
    expect(body.timeline).toEqual({
      kind: 'paid',
      planEndsAt: PERIOD_END,
      lockAt: lockFromPeriodEnd,
      timezone: ZONE,
      graceDays: 14,
      during: 'free_plan',
      planName: 'Test Flight',
      trialing: false,
    });
    expect(body.futureBookings).toEqual({ count: 2 });
    expect(mockCount).toHaveBeenCalledWith(SUBJECT, lockFromPeriodEnd);
  });

  it('W-13: a trialing plan is paid with trialing: true', async () => {
    mockBilling.mockResolvedValue({ kind: 'row', row: paidRow({ subscriptionStatus: 'trialing' }) });
    expect((await data(await GET(req()))).timeline).toMatchObject({ kind: 'paid', trialing: true });
  });

  it('T-1: a refused classification (payment failing) → timeline null, count null, the check still answers', async () => {
    mockBilling.mockResolvedValue({ kind: 'row', row: paidRow({ subscriptionStatus: 'past_due', failedAttempts: 1 }) });
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await data(res);
    expect(body).toMatchObject({ available: true, blockers: [{ code: 'payment_failed' }], timeline: null, futureBookings: { count: null } });
    expect(mockCount).not.toHaveBeenCalled();
  });

  it('T-2: the timezone unreadable → timeline null, count null, 200', async () => {
    mockTimezone.mockResolvedValue({ ok: false });
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await data(res)).toMatchObject({ timeline: null, futureBookings: { count: null } });
    expect(mockCount).not.toHaveBeenCalled();
  });

  it('T-3: paid with no period end → timeline null, count null', async () => {
    mockBilling.mockResolvedValue({ kind: 'row', row: paidRow({ currentPeriodEnd: null }) });
    expect(await data(await GET(req()))).toMatchObject({ timeline: null, futureBookings: { count: null } });
  });

  it.each([
    ['throws', () => mockEnding.mockRejectedValue(new Error('resolver down'))],
    ['answers null', () => mockEnding.mockResolvedValue(null)],
  ])('T-4: the plan ending view %s → during unknown, planName null, 200', async (_label, arrange) => {
    arrange();
    mockBilling.mockResolvedValue({ kind: 'row', row: paidRow() });
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect((await data(res)).timeline).toMatchObject({ kind: 'paid', during: 'unknown', planName: null, lockAt: lockFromPeriodEnd });
  });

  it('T-5: the count fails → { count: null }, never 0, and the check still answers 200', async () => {
    mockCount.mockResolvedValue({ data: null, error: new Error('42703') });
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await data(res);
    expect(body.futureBookings).toEqual({ count: null });
    expect(body.timeline).toMatchObject({ kind: 'free' });
  });

  it('available: false carries timeline null and count null', async () => {
    mockSession.mockResolvedValue({ id: SUBJECT, email: null });
    expect(await data(await GET(req()))).toMatchObject({ available: false, timeline: null, futureBookings: { count: null } });
    expect(mockTimezone).not.toHaveBeenCalled();
  });

  it('no plan name, timezone or count value reaches a log line as an email; notes are codes', async () => {
    mockCount.mockResolvedValue({ data: null, error: new Error(`boom ${EMAIL}`) });
    await data(await GET(req()));
    expect(JSON.stringify(mockLogged)).not.toContain(EMAIL);
    expect(JSON.stringify(mockLogged)).toContain('bookings_count_failed');
  });
});
