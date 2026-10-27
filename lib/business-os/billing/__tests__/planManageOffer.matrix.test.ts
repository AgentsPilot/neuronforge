/**
 * The screen offers Cancel / Reactivate EXACTLY where the routes act (plan
 * payments P-7a.1; workplan §7 "Matrix"; SA C-1; the P-4 F-C pattern).
 *
 * For every billing-row shape and both switch states, the REAL Settings view
 * (`readPlanPurchaseView`) is compared with the REAL orchestration
 * (`managePlanSubscription`), fed the same row and a Stripe answer that agrees
 * with it:
 *   - `manage.cancel`     ⇔ the cancel action writes at Stripe;
 *   - `manage.reactivate` ⇔ the reactivate action writes at Stripe;
 *   - no control          ⇔ both actions are refused before any Stripe call.
 */

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: { marker: 'service-role-default' } }));
jest.mock('@/lib/stripe/StripeService', () => ({
  getStripeService: () => {
    throw new Error('the plan screen never talks to Stripe (SR-11)');
  },
}));

import { COHORTS } from '@/lib/business-os/entitlements/config/cohorts';
import { LIFECYCLE_CONFIG } from '@/lib/business-os/entitlements/config/lifecycle';
import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';
import { deriveLifecycle, type LifecycleInputs } from '@/lib/business-os/entitlements/lifecycle';
import { account } from '@/lib/business-os/entitlements/__fixtures__/accounts';
import type { PlanSnapshotLike } from '@/lib/business-os/billing/planCheckout';
import { readPlanPurchaseView, type PlanPurchaseViewDeps } from '@/lib/business-os/billing/planPurchaseView';
import { managePlanSubscription, type PlanManageDeps } from '@/lib/business-os/billing/planSubscriptionManage';

const USER = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-10-26T10:00:00.000Z');
const FUTURE = '2026-11-26T10:00:00.000Z';
const PAST = '2026-10-20T10:00:00.000Z';
const FUTURE_UNIX = Math.floor(Date.parse(FUTURE) / 1000);
const TIER = TIER_ORDER[0];

const INPUTS: LifecycleInputs = {
  cohorts: COHORTS,
  tierOrder: TIER_ORDER,
  subscriptionGraceHistory: LIFECYCLE_CONFIG.subscriptionGraceHistory,
  renewalSettlementMarginHistory: LIFECYCLE_CONFIG.renewalSettlementMarginHistory,
};
const lifecycle = deriveLifecycle(account({ tier: TIER, planVersion: 1, tierExpiresAt: FUTURE }), INPUTS, NOW);
const SNAPSHOT: PlanSnapshotLike = { unavailable: false, resolution: { basis: lifecycle.basis, lifecycle: { accessEndsAt: lifecycle.accessEndsAt } } };

type Row = Record<string, unknown>;

function row(overrides: Row): Row {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    accountId: USER,
    livemode: false,
    stripeCustomerId: 'cus_own',
    stripeSubscriptionId: 'sub_own',
    subscriptionStatus: 'active',
    boughtTier: TIER,
    currentPeriodEnd: FUTURE,
    cancelAtPeriodEnd: false,
    pendingTier: null,
    openCheckoutSessionId: null,
    openCheckoutExpiresAt: null,
    lastInvoiceId: null,
    lastPaidAt: null,
    lastPaymentFailedAt: null,
    failedAttempts: 0,
    actionRequiredInvoiceUrl: null,
    founderDiscountAppliedAt: null,
    endedAt: null,
    createdAt: '2026-10-04T00:00:00.000Z',
    updatedAt: '2026-10-04T00:00:00.000Z',
    ...overrides,
  };
}

const ROWS: Array<[string, Row | null]> = [
  ['no billing row', null],
  ['a customer, no subscription', row({ stripeSubscriptionId: null, subscriptionStatus: null })],
  ['active, renewing', row({})],
  ['trialing, renewing', row({ subscriptionStatus: 'trialing' })],
  ['active, set to end', row({ cancelAtPeriodEnd: true })],
  ['active, set to end, end passed', row({ cancelAtPeriodEnd: true, currentPeriodEnd: PAST })],
  ['past_due', row({ subscriptionStatus: 'past_due', failedAttempts: 1 })],
  ['active with a failed attempt counted', row({ failedAttempts: 1 })],
  ['unpaid', row({ subscriptionStatus: 'unpaid' })],
  ['canceled', row({ subscriptionStatus: 'canceled', endedAt: PAST })],
  ['incomplete', row({ subscriptionStatus: 'incomplete' })],
  ['paused', row({ subscriptionStatus: 'paused' })],
  // D2 (SA W-3): a pending change refuses the CANCEL side only; a cancelling plan stays kept-able.
  ['active, set to end, a tier change pending', row({ cancelAtPeriodEnd: true, pendingTier: TIER })],
  ['active, set to end, a checkout lock open', row({ cancelAtPeriodEnd: true, openCheckoutSessionId: 'cs_open', openCheckoutExpiresAt: FUTURE })],
  ['active, renewing, an EXPIRED checkout lock', row({ openCheckoutSessionId: 'cs_old', openCheckoutExpiresAt: PAST })],
];

/** Stripe agrees with our row (the matrix is about OUR data; the fresh checks have their own tests). */
function freshFrom(r: Row): Row {
  return {
    id: r.stripeSubscriptionId,
    status: r.subscriptionStatus,
    customerId: r.stripeCustomerId,
    billingCycleAnchor: FUTURE_UNIX - 86400 * 30,
    cancelAtPeriodEnd: r.cancelAtPeriodEnd,
    cancelAt: r.cancelAtPeriodEnd ? FUTURE_UNIX : null,
    endedAt: r.endedAt ? Math.floor(Date.parse(String(r.endedAt)) / 1000) : null,
    livemode: r.livemode,
    metadata: {},
    priceIds: ['price_x'],
    items: [{ id: 'si_1', priceId: 'price_x', currentPeriodStart: FUTURE_UNIX - 86400 * 30, currentPeriodEnd: Math.floor(Date.parse(String(r.currentPeriodEnd)) / 1000) }],
    pendingUpdate: null,
    latestInvoiceId: null,
  };
}

async function writes(r: Row | null, action: 'cancel' | 'reactivate', pricesEnabled: boolean): Promise<{ wrote: boolean; stripeCalls: number }> {
  let stripeCalls = 0;
  let wrote = false;
  const deps = {
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    now: () => NOW,
    switches: () => ({ pricesEnabled }),
    mode: () => 'test',
    repo: {
      findByUser: async () => ({ data: r, error: null }),
      mirrorSubscriptionState: async () => ({ data: { mirrored: true }, error: null }),
    },
    stripe: {
      retrieveBusinessOsSubscription: async () => {
        stripeCalls += 1;
        return freshFrom(r as Row);
      },
      setBusinessOsCancelAtPeriodEnd: async (_id: string, value: boolean) => {
        stripeCalls += 1;
        wrote = true;
        return { id: 'sub_own', status: 'active', customerId: 'cus_own', livemode: false, cancelAtPeriodEnd: value, cancelAt: value ? FUTURE_UNIX : null, endedAt: null, currentPeriodEnd: FUTURE_UNIX };
      },
    },
  } as unknown as PlanManageDeps;
  await managePlanSubscription({ action, userId: USER, accountId: USER }, deps);
  return { wrote, stripeCalls };
}

async function screen(r: Row | null, pricesEnabled: boolean) {
  const deps: PlanPurchaseViewDeps = {
    switches: () => ({ checkoutEnabled: true, pricesEnabled }),
    billing: { findByUser: async () => ({ data: r, error: null }) } as unknown as PlanPurchaseViewDeps['billing'],
    mode: () => 'test',
    buyableTiers: () => [...TIER_ORDER],
    now: () => NOW,
    enforcing: () => false,
    logger: { warn: () => undefined },
  };
  const view = await readPlanPurchaseView({ userId: USER, accountId: USER, snapshot: SNAPSHOT as never }, deps);
  return view?.manage ?? { cancel: false, reactivate: false, paymentFailed: false };
}

describe.each([true, false])('price switch %s', (pricesEnabled) => {
  it.each(ROWS)('%s: the screen offers exactly what the routes do', async (_name, r) => {
    const manage = await screen(r, pricesEnabled);
    const cancel = await writes(r, 'cancel', pricesEnabled);
    const reactivate = await writes(r, 'reactivate', pricesEnabled);

    expect(cancel.wrote).toBe(manage.cancel);
    expect(reactivate.wrote).toBe(manage.reactivate);
    if (!manage.cancel && !manage.reactivate) {
      // Refused on our data: not one Stripe call, for either action.
      expect(cancel.stripeCalls).toBe(0);
      expect(reactivate.stripeCalls).toBe(0);
    }
    if (!pricesEnabled) expect(manage).toEqual({ cancel: false, reactivate: false, paymentFailed: false });
  });
});

it('the matrix is not vacuous: each control is offered somewhere', async () => {
  const offered = await Promise.all(ROWS.map(([, r]) => screen(r, true)));
  expect(offered.some((m) => m.cancel)).toBe(true);
  expect(offered.some((m) => m.reactivate)).toBe(true);
  expect(offered.some((m) => m.paymentFailed)).toBe(true);
});

/**
 * D2 (SA W-3): a renewing plan with a change pending. The screen shows no
 * control; the cancel is refused on our data with zero Stripe calls; a
 * reactivate is never refused for this reason (our row may be stale, P-7a C-2),
 * so it reads Stripe, finds nothing to undo and writes nothing.
 */
describe('D2 change_pending (renewing side)', () => {
  it.each([
    ['a tier change pending', row({ pendingTier: TIER })],
    ['a checkout lock open', row({ openCheckoutSessionId: 'cs_open', openCheckoutExpiresAt: FUTURE })],
    ['a checkout lock with no expiry recorded', row({ openCheckoutSessionId: 'cs_open', openCheckoutExpiresAt: null })],
  ])('%s: no control, cancel refused with zero Stripe calls, reactivate writes nothing', async (_name, r) => {
    const manage = await screen(r, true);
    expect(manage).toEqual({ cancel: false, reactivate: false, paymentFailed: false });
    const cancel = await writes(r, 'cancel', true);
    expect(cancel).toEqual({ wrote: false, stripeCalls: 0 });
    const reactivate = await writes(r, 'reactivate', true);
    expect(reactivate.wrote).toBe(false);
  });
});
