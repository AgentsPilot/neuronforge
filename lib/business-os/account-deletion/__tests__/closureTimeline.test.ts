/**
 * The pre-check's "What happens next" timeline (account deletion lifecycle
 * DL-2b; DL-2 workplan §6.1 T-1 to T-5, §12; SA W-13, W-14). Fakes at every
 * port: no database, no entitlements resolver, no network.
 *
 * Zones: Asia/Jerusalem and America/New_York, one DST week each way. No
 * midnight-DST zone (R-1, W-12): nothing here pins a wrong value.
 */

import { buildClosureTimeline, readClosureTimeline, timelinePlan, type ClosureTimelinePorts } from '../closureTimeline';
import { closureLockAt } from '../closureDates';
import { GRACE_DAYS } from '../closureLifecycle';
import { runClosureRequest, type BillingRowLike, type ClosureRequestDeps } from '../closureRequest';
import { closureStatusView } from '../closureStatusView';
import { closureTimelineSchema } from '../schemas';
import type { AccountDeletionCheckOutcome } from '../selfServiceDeletion';
import type { PlanManageResult } from '@/lib/business-os/billing/planSubscriptionManage';

const USER = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-11-20T10:00:00.000Z');
const PERIOD_END = '2026-12-05T10:00:00.000Z';

const renewing = (o: Partial<BillingRowLike> = {}): BillingRowLike => ({
  stripeSubscriptionId: 'sub_own',
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
const prices = () => true;

/** The local wall clock of an instant in a zone, as `YYYY-MM-DD HH:mm`. */
function localClock(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

describe('timelinePlan (T-1: the request\'s own classification, W-14)', () => {
  it.each([
    ['renewing', renewing(), { kind: 'paid', planEndsAt: PERIOD_END, trialing: false }],
    ['cancelling', renewing({ cancelAtPeriodEnd: true }), { kind: 'paid', planEndsAt: PERIOD_END, trialing: false }],
    ['trialing (W-13)', renewing({ subscriptionStatus: 'trialing' }), { kind: 'paid', planEndsAt: PERIOD_END, trialing: true }],
    ['no billing row', null, { kind: 'free' }],
    ['no subscription', renewing({ stripeSubscriptionId: null, subscriptionStatus: null, currentPeriodEnd: null }), { kind: 'free' }],
    ['an ended plan', renewing({ endedAt: '2026-10-01T00:00:00.000Z' }), { kind: 'free' }],
    ['a failing renewal', renewing({ subscriptionStatus: 'past_due', failedAttempts: 1 }), { kind: 'refuse' }],
  ] as const)('%s', (_label, row, expected) => {
    expect(timelinePlan(row, prices, NOW)).toEqual(expected);
  });

  it('the prices switch off on a paid row → refuse (as the request would)', () => {
    expect(timelinePlan(renewing(), () => false, NOW)).toEqual({ kind: 'refuse' });
  });
});

describe('buildClosureTimeline (T-3, T-4)', () => {
  const zone = { ok: true as const, stored: 'Asia/Jerusalem' };

  it('free: grace starts now; the lock is closureLockAt(now, zone)', () => {
    const timeline = buildClosureTimeline({ plan: { kind: 'free' }, zone, now: NOW, ending: null });
    expect(timeline).toEqual({ kind: 'free', lockAt: closureLockAt(NOW, 'Asia/Jerusalem').lockAt, timezone: 'Asia/Jerusalem', graceDays: GRACE_DAYS });
    expect(closureTimelineSchema.safeParse(timeline).success).toBe(true);
  });

  it('paid: the period end, its projected lock, the after-plan from the view', () => {
    const timeline = buildClosureTimeline({
      plan: { kind: 'paid', planEndsAt: PERIOD_END, trialing: false },
      zone,
      now: NOW,
      ending: { kind: 'back_to_plan', planName: 'Founding Partner' },
    });
    expect(timeline).toEqual({
      kind: 'paid',
      planEndsAt: PERIOD_END,
      lockAt: closureLockAt(new Date(PERIOD_END), 'Asia/Jerusalem').lockAt,
      timezone: 'Asia/Jerusalem',
      graceDays: GRACE_DAYS,
      during: 'back_to_plan',
      planName: 'Founding Partner',
      trialing: false,
    });
    expect(closureTimelineSchema.safeParse(timeline).success).toBe(true);
  });

  it('paid: no view → unknown with no name; an unknown view never carries a name', () => {
    const plan = { kind: 'paid' as const, planEndsAt: PERIOD_END, trialing: true };
    expect(buildClosureTimeline({ plan, zone, now: NOW, ending: null })).toMatchObject({ during: 'unknown', planName: null, trialing: true });
    expect(buildClosureTimeline({ plan, zone, now: NOW, ending: { kind: 'unknown', planName: 'x' } })).toMatchObject({ during: 'unknown', planName: null });
  });

  it.each([[null], ['not a date']])('paid with period end %p → null', (planEndsAt) => {
    expect(buildClosureTimeline({ plan: { kind: 'paid', planEndsAt, trialing: false }, zone, now: NOW, ending: null })).toBeNull();
  });

  it('refuse → null; an unreadable zone → null (never a guessed zone)', () => {
    expect(buildClosureTimeline({ plan: { kind: 'refuse' }, zone, now: NOW, ending: null })).toBeNull();
    expect(buildClosureTimeline({ plan: { kind: 'free' }, zone: { ok: false }, now: NOW, ending: null })).toBeNull();
  });

  it('a NULL stored zone ("not asked") resolves to UTC, and says so', () => {
    expect(buildClosureTimeline({ plan: { kind: 'free' }, zone: { ok: true, stored: null }, now: NOW, ending: null })).toMatchObject({ timezone: 'UTC' });
  });

  it.each([
    // Asia/Jerusalem: summer time ends 2026-10-25 and starts 2027-03-26.
    ['Asia/Jerusalem, across the October change', 'Asia/Jerusalem', '2026-10-20T12:00:00.000Z', '2026-11-03 00:00'],
    ['Asia/Jerusalem, across the March change', 'Asia/Jerusalem', '2027-03-20T12:00:00.000Z', '2027-04-03 00:00'],
    // America/New_York: summer time ends 2026-11-01 and starts 2027-03-14.
    ['America/New_York, across the November change', 'America/New_York', '2026-10-28T16:00:00.000Z', '2026-11-11 00:00'],
    ['America/New_York, across the March change', 'America/New_York', '2027-03-10T16:00:00.000Z', '2027-03-24 00:00'],
  ])('%s: the lock is local midnight of day 15', (_label, zoneName, start, expectedLocal) => {
    const free = buildClosureTimeline({ plan: { kind: 'free' }, zone: { ok: true, stored: zoneName }, now: new Date(start), ending: null });
    expect(free && localClock(free.lockAt, zoneName)).toBe(expectedLocal);
    const paid = buildClosureTimeline({ plan: { kind: 'paid', planEndsAt: start, trialing: false }, zone: { ok: true, stored: zoneName }, now: NOW, ending: null });
    expect(paid && localClock(paid.lockAt, zoneName)).toBe(expectedLocal);
  });
});

function ports(o: Partial<{ zone: 'error' | string | null; ending: 'throws' | null | { kind: 'free_plan' | 'back_to_plan' | 'unknown'; planName: string | null }; count: 'error' | 'throws' | number }> = {}) {
  const calls: string[] = [];
  const p: ClosureTimelinePorts = {
    pricesEnabled: () => true,
    readTimezone: async () => {
      calls.push('timezone');
      return o.zone === 'error' ? { ok: false } : { ok: true, stored: o.zone === undefined ? 'Asia/Jerusalem' : o.zone };
    },
    readPlanEnding: jest.fn(async () => {
      calls.push('ending');
      if (o.ending === 'throws') throw new Error('resolver down');
      return o.ending === undefined ? { kind: 'free_plan' as const, planName: 'Test Flight' } : o.ending;
    }),
    countUpcomingBookings: jest.fn(async () => {
      calls.push('count');
      if (o.count === 'throws') throw new Error('boom');
      if (o.count === 'error') return { data: null, error: new Error('42703') };
      return { data: o.count ?? 0, error: null };
    }),
  };
  return { p, calls };
}

describe('readClosureTimeline (T-1 to T-5, never throws)', () => {
  const run = (row: BillingRowLike | null, p: ClosureTimelinePorts, locale: 'en' | 'he' | 'es' = 'en') =>
    readClosureTimeline({ subject: USER, billingRow: row, locale, now: NOW }, p);

  it('paid: the view is asked for the session account, the period end and the locale; the count from the lock', async () => {
    const { p } = ports({ count: 3 });
    const result = await run(renewing(), p, 'he');
    const lock = closureLockAt(new Date(PERIOD_END), 'Asia/Jerusalem').lockAt;
    expect(result).toEqual({
      timeline: { kind: 'paid', planEndsAt: PERIOD_END, lockAt: lock, timezone: 'Asia/Jerusalem', graceDays: GRACE_DAYS, during: 'free_plan', planName: 'Test Flight', trialing: false },
      futureBookings: { count: 3 },
      notes: [],
    });
    expect(p.readPlanEnding).toHaveBeenCalledWith({ userId: USER, endsAt: PERIOD_END, locale: 'he' });
    expect(p.countUpcomingBookings).toHaveBeenCalledWith(USER, lock);
  });

  it('free: no view is read; a zero is a zero', async () => {
    const { p, calls } = ports({ count: 0 });
    const result = await run(null, p);
    expect(result.timeline).toMatchObject({ kind: 'free' });
    expect(result.futureBookings).toEqual({ count: 0 });
    expect(calls).not.toContain('ending');
  });

  it('T-1 refuse → no timezone read, nothing counted', async () => {
    const { p, calls } = ports();
    expect(await run(renewing({ subscriptionStatus: 'past_due', failedAttempts: 1 }), p)).toEqual({ timeline: null, futureBookings: { count: null }, notes: ['plan_refused'] });
    expect(calls).toEqual([]);
  });

  it('T-2 timezone unreadable → null and { count: null }', async () => {
    const { p, calls } = ports({ zone: 'error' });
    expect(await run(renewing(), p)).toEqual({ timeline: null, futureBookings: { count: null }, notes: ['timezone_unreadable'] });
    expect(calls).toEqual(['timezone']);
  });

  it('T-3 paid without a period end → null', async () => {
    const { p } = ports();
    expect(await run(renewing({ currentPeriodEnd: null }), p)).toEqual({ timeline: null, futureBookings: { count: null }, notes: ['no_period_end'] });
  });

  it.each([
    ['throws', 'throws' as const, 'ending_view_failed'],
    ['answers null', null, 'ending_view_empty'],
  ])('T-4 the view %s → during unknown, the rest unchanged', async (_label, ending, note) => {
    const { p } = ports({ ending, count: 1 });
    const result = await run(renewing(), p);
    expect(result.timeline).toMatchObject({ kind: 'paid', during: 'unknown', planName: null, planEndsAt: PERIOD_END });
    expect(result.futureBookings).toEqual({ count: 1 });
    expect(result.notes).toEqual([note]);
  });

  it.each([['error' as const], ['throws' as const]])('T-5 the count %s → { count: null }, never 0', async (count) => {
    const { p } = ports({ count });
    const result = await run(null, p);
    expect(result.futureBookings).toEqual({ count: null });
    expect(result.timeline).toMatchObject({ kind: 'free' });
    expect(result.notes).toEqual(['bookings_count_failed']);
  });

  it('a port that throws where it promised not to → null, null, unexpected (the check never fails)', async () => {
    const { p } = ports();
    p.readTimezone = async () => {
      throw new Error('broken port');
    };
    expect(await run(null, p)).toEqual({ timeline: null, futureBookings: { count: null }, notes: ['unexpected'] });
  });
});

describe('W-14: the drawer\'s dates equal what the request then records', () => {
  const CHECK_OK: AccountDeletionCheckOutcome = {
    kind: 'checked',
    canDelete: true,
    targetUserId: USER,
    blockers: [],
    notes: [],
    guards: [],
    rows: [],
    verdictBlocked: false,
    resolvedThisLogin: true,
    serverMs: 1,
  };

  function requestDeps(row: BillingRowLike | null, zone: string) {
    const transitions: Array<{ to: string; patch: Record<string, string | boolean | null> }> = [];
    const deps: ClosureRequestDeps = {
      closures: {
        findOpenForUser: async () => ({ data: null, error: null }),
        insertRequesting: async () => ({ data: { id: 'c1', status: 'requesting' }, error: null }),
        transition: async (_id, _user, _from, to, patch) => {
          transitions.push({ to, patch });
          return { data: true, error: null };
        },
        deleteRequesting: async () => ({ data: true, error: null }),
      },
      billingRow: async () => ({ data: row, error: null }),
      livemode: () => false,
      pricesEnabled: () => true,
      runCheck: async () => CHECK_OK,
      readTimezone: async () => ({ data: zone, error: null }),
      manage: async () =>
        ({
          ok: true,
          outcome: 'cancelled',
          mode: 'period_end',
          endsOn: row?.currentPeriodEnd ?? null,
          audit: { action: 'cancel', outcome: 'cancelled', subscriptionId: 'sub_own', endsOn: row?.currentPeriodEnd ?? null, renewsOn: null, livemode: false, mode: 'period_end', reasonCode: 'other', origin: 'deletion_request' },
        }) as unknown as PlanManageResult,
      now: () => NOW,
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    };
    return { deps, transitions };
  }

  it.each([['Asia/Jerusalem'], ['America/New_York']])('free (%s): the timeline lock is the stored grace lock_at', async (zone) => {
    const { p } = ports({ zone });
    const { timeline } = await readClosureTimeline({ subject: USER, billingRow: null, locale: 'en', now: NOW }, p);
    const { deps, transitions } = requestDeps(null, zone);
    const outcome = await runClosureRequest({ subject: USER, email: 'o@example.com', accountId: USER, statementLanguage: 'en', reasonCode: 'other' }, deps);
    expect(outcome).toMatchObject({ ok: true, status: 'grace' });
    const grace = transitions.find((t) => t.to === 'grace');
    expect(timeline).toMatchObject({ kind: 'free', lockAt: grace?.patch.lock_at, timezone: grace?.patch.lock_timezone });
  });

  it.each([['Asia/Jerusalem'], ['America/New_York']])('paid (%s): plan_ends_at, and the pending view\'s projected lock', async (zone) => {
    const row = renewing();
    const { p } = ports({ zone });
    const { timeline } = await readClosureTimeline({ subject: USER, billingRow: row, locale: 'en', now: NOW }, p);
    const { deps, transitions } = requestDeps(row, zone);
    const outcome = await runClosureRequest({ subject: USER, email: 'o@example.com', accountId: USER, statementLanguage: 'en', reasonCode: 'other' }, deps);
    expect(outcome).toMatchObject({ ok: true, status: 'pending' });
    const pending = transitions.find((t) => t.to === 'pending');
    const planEndsAt = pending?.patch.plan_ends_at as string;
    const view = closureStatusView(
      { status: 'pending', renewal_was_on: true, plan_ends_at: planEndsAt, lock_at: null, lock_timezone: null },
      { ok: true, stored: zone }
    );
    expect(timeline).toMatchObject({ kind: 'paid', planEndsAt, lockAt: view.lockAt, timezone: view.timezone });
  });
});
