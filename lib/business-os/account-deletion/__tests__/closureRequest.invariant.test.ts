/**
 * THE D6 INVARIANT (requirement XC-2, §7 DL-1b; workplan §4.4, T-6; SA W-1):
 * never a `pending` closure row on a plan that renews.
 *
 * The request orchestration runs over the REAL cancel engine
 * (`managePlanSubscription`, origin `deletion_request`) and a fake Stripe that
 * holds one subscription's state. Every combination of
 *
 *   Stripe's state before   renewing / set to end (flag) / `cancel_at` at the
 *                           period end / `cancel_at` LATER than it (W-1) /
 *                           past_due / already ended
 *   our billing row         renewing / cancelling (it may lag Stripe, P-7a C-2)
 *   the Stripe write        applied / lost after applying / lost before
 *                           applying / refused before running / an answer that
 *                           differs (a later `cancel_at`)
 *   the pending transition  moved / not moved / error
 *   the withdrawal          removed / error
 *
 * is driven, and after each run: a row that is `pending` means Stripe's
 * subscription is set to end THIS period. A row the engine may have changed
 * Stripe for (lost answer) is never deleted and never `pending`.
 */

import { runClosureRequest, type ClosureRequestDeps } from '../closureRequest';
import { managePlanSubscription, type PlanManageDeps } from '@/lib/business-os/billing/planSubscriptionManage';
import { isSetToEndThisPeriod } from '@/lib/business-os/billing/subscriptionCancelling';
import type { AccountDeletionCheckOutcome } from '../selfServiceDeletion';

const USER = '11111111-1111-4111-8111-111111111111';
const CLOSURE = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2026-11-04T10:00:00.000Z');
const PERIOD_END = Math.floor(Date.parse('2026-11-26T10:00:00.000Z') / 1000);
const PERIOD_END_ISO = new Date(PERIOD_END * 1000).toISOString();

interface Sub {
  status: string;
  cancelAtPeriodEnd: boolean;
  cancelAt: number | null;
  endedAt: number | null;
}

const BEFORE: Record<string, Sub> = {
  renewing: { status: 'active', cancelAtPeriodEnd: false, cancelAt: null, endedAt: null },
  set_to_end_flag: { status: 'active', cancelAtPeriodEnd: true, cancelAt: PERIOD_END, endedAt: null },
  cancel_at_period_end: { status: 'active', cancelAtPeriodEnd: false, cancelAt: PERIOD_END, endedAt: null },
  cancel_at_later: { status: 'active', cancelAtPeriodEnd: false, cancelAt: PERIOD_END + 86400 * 40, endedAt: null },
  past_due: { status: 'past_due', cancelAtPeriodEnd: false, cancelAt: null, endedAt: null },
  ended: { status: 'canceled', cancelAtPeriodEnd: false, cancelAt: null, endedAt: PERIOD_END - 86400 },
};
const OUR_ROW = ['renewing', 'cancelling'] as const;
const WRITE = ['applied', 'lost_after_apply', 'lost_before_apply', 'refused', 'answer_later_cancel_at'] as const;
const TRANSITION = ['moved', 'not_moved', 'error'] as const;
const WITHDRAW = ['removed', 'error'] as const;

const CHECK_OK: AccountDeletionCheckOutcome = {
  kind: 'checked', canDelete: true, targetUserId: USER, blockers: [], notes: [], guards: [], rows: [], verdictBlocked: false, resolvedThisLogin: true, serverMs: 1,
};

function stripeError(type: string): Error {
  return Object.assign(new Error(type), { type });
}

function scenario(before: Sub, ourRow: (typeof OUR_ROW)[number], write: (typeof WRITE)[number], transition: (typeof TRANSITION)[number], withdraw: (typeof WITHDRAW)[number]) {
  const sub: Sub = { ...before };
  const closures = new Map<string, string>();
  const facts = () => ({ cancelAtPeriodEnd: sub.cancelAtPeriodEnd, cancelAt: sub.cancelAt, periodEnd: PERIOD_END });
  const answer = () => ({ id: 'sub_own', status: sub.status, customerId: 'cus_own', livemode: false, cancelAtPeriodEnd: sub.cancelAtPeriodEnd, cancelAt: sub.cancelAt, endedAt: sub.endedAt, currentPeriodEnd: PERIOD_END });
  const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };

  const billingRow = {
    id: '22222222-2222-4222-8222-222222222222',
    accountId: USER,
    livemode: false,
    stripeCustomerId: 'cus_own',
    stripeSubscriptionId: 'sub_own',
    subscriptionStatus: before.status === 'canceled' ? 'active' : before.status, // our row lags an end
    boughtTier: 'tier_one',
    currentPeriodEnd: PERIOD_END_ISO,
    cancelAtPeriodEnd: ourRow === 'cancelling',
    endedAt: null,
    failedAttempts: 0,
    pendingTier: null,
    openCheckoutSessionId: null,
    openCheckoutExpiresAt: null,
  };

  const engineDeps = {
    logger: silent,
    now: () => NOW,
    switches: () => ({ pricesEnabled: true }),
    mode: () => 'test',
    newAttemptId: () => 'attempt',
    deletionPending: async () => 'none' as const,
    repo: {
      findByUser: async () => ({ data: billingRow, error: null }),
      mirrorSubscriptionState: async () => ({ data: { mirrored: true }, error: null }),
    },
    stripe: {
      retrieveBusinessOsSubscription: async () => ({
        id: 'sub_own', status: sub.status, customerId: 'cus_own', billingCycleAnchor: PERIOD_END - 86400 * 30,
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd, cancelAt: sub.cancelAt, endedAt: sub.endedAt, livemode: false, metadata: {},
        priceIds: ['price_one'], items: [{ id: 'si_1', priceId: 'price_one', currentPeriodStart: PERIOD_END - 86400 * 30, currentPeriodEnd: PERIOD_END }],
        pendingUpdate: null, latestInvoiceId: 'in_1',
      }),
      setBusinessOsCancelAtPeriodEnd: async (_id: string, value: boolean) => {
        if (write === 'refused') throw stripeError('StripeInvalidRequestError');
        if (write === 'lost_before_apply') throw stripeError('StripeConnectionError');
        if (write === 'answer_later_cancel_at') {
          sub.cancelAtPeriodEnd = false;
          sub.cancelAt = PERIOD_END + 86400 * 40;
          return answer();
        }
        sub.cancelAtPeriodEnd = value;
        sub.cancelAt = value ? PERIOD_END : null;
        if (write === 'lost_after_apply') throw stripeError('StripeAPIError');
        return answer();
      },
      cancelBusinessOsSubscriptionNow: async () => {
        sub.status = 'canceled';
        sub.endedAt = Math.floor(NOW.getTime() / 1000);
        return answer();
      },
      listBusinessOsOpenSubscriptionInvoices: async () => ({ invoices: [], hasMore: false }),
      voidBusinessOsInvoice: async () => ({ id: 'in', status: 'void' }),
    },
  } as unknown as PlanManageDeps;

  const deps: ClosureRequestDeps = {
    closures: {
      findOpenForUser: async () => ({ data: closures.has(CLOSURE) ? { id: CLOSURE, status: closures.get(CLOSURE) as 'pending' } : null, error: null }),
      insertRequesting: async () => {
        closures.set(CLOSURE, 'requesting');
        return { data: { id: CLOSURE, status: 'requesting' }, error: null };
      },
      transition: async (id, _user, from, to) => {
        if (transition === 'error') return { data: null, error: new Error('down') };
        if (transition === 'not_moved' || closures.get(id) !== from) return { data: false, error: null };
        closures.set(id, to);
        return { data: true, error: null };
      },
      deleteRequesting: async (id) => {
        if (withdraw === 'error') return { data: null, error: new Error('down') };
        if (closures.get(id) !== 'requesting') return { data: false, error: null };
        closures.delete(id);
        return { data: true, error: null };
      },
    },
    billingRow: async () => ({ data: billingRow, error: null }),
    livemode: () => false,
    pricesEnabled: () => true,
    runCheck: async () => CHECK_OK,
    readTimezone: async () => ({ data: 'UTC', error: null }),
    manage: (input) => managePlanSubscription(input, engineDeps),
    now: () => NOW,
    logger: silent,
  };
  return { deps, sub, closures, facts };
}

const MATRIX = Object.keys(BEFORE).flatMap((before) =>
  OUR_ROW.flatMap((ourRow) => WRITE.flatMap((write) => TRANSITION.flatMap((transition) => WITHDRAW.map((withdraw) => [before, ourRow, write, transition, withdraw] as const))))
);

describe('T-6: never a pending row on a plan that renews (XC-2)', () => {
  it('drives the whole matrix (not vacuous)', () => {
    expect(MATRIX.length).toBe(6 * 2 * 5 * 3 * 2);
  });

  it.each(MATRIX)('before=%s ourRow=%s write=%s transition=%s withdraw=%s', async (before, ourRow, write, transition, withdraw) => {
    const s = scenario(BEFORE[before], ourRow, write, transition, withdraw);
    const out = await runClosureRequest(
      { subject: USER, email: 'owner@example.com', accountId: USER, statementLanguage: 'en', reasonCode: 'other' },
      s.deps
    );
    const status = s.closures.get(CLOSURE) ?? null;

    // THE INVARIANT.
    if (status === 'pending') expect(isSetToEndThisPeriod(s.facts())).toBe(true);
    if (out.ok) {
      expect(out.status).toBe('pending');
      expect(status).toBe('pending');
    }
    // A plan that renews this period never sits under a pending row (W-1: a later `cancel_at` renews).
    if (!isSetToEndThisPeriod(s.facts())) expect(status).not.toBe('pending');
    // A lost answer: Stripe may have changed, so the row is neither deleted nor pending (DL-3 settles it).
    if (!out.ok && out.outcomeUnknown) expect(status).toBe('requesting');
    // Never an immediate end from a deletion request (§6 E-1).
    expect(s.sub.status === 'canceled' && BEFORE[before].status !== 'canceled').toBe(false);
  });

  it('non-vacuous: a renewing plan with an applied write and a moved row does end pending, set to end', async () => {
    const s = scenario(BEFORE.renewing, 'renewing', 'applied', 'moved', 'removed');
    const out = await runClosureRequest({ subject: USER, email: 'o@example.com', accountId: USER, statementLanguage: 'en', reasonCode: 'other' }, s.deps);
    expect(out).toMatchObject({ ok: true, status: 'pending', renewalWasOn: true });
    expect(s.closures.get(CLOSURE)).toBe('pending');
    expect(isSetToEndThisPeriod(s.facts())).toBe(true);
  });

  it('W-1 spelled out: a `cancel_at` later than the period end is refused and the row withdrawn', async () => {
    const s = scenario(BEFORE.cancel_at_later, 'cancelling', 'applied', 'moved', 'removed');
    const out = await runClosureRequest({ subject: USER, email: 'o@example.com', accountId: USER, statementLanguage: 'en', reasonCode: 'other' }, s.deps);
    expect(out).toMatchObject({ ok: false, error: 'blocked', reason: 'plan_custom_end_date', blockers: [{ code: 'contact_support' }] });
    expect(s.closures.has(CLOSURE)).toBe(false);
  });
});
