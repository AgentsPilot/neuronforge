/**
 * The purchase matrix (plan payments P-4.1; workplan §3.1, §7 "Shared
 * predicate"; SA W-1, W-2).
 *
 * For every combination of our own data that decides a sale to an account
 * that is NOT held, `planPurchaseOffer` offers tier X EXACTLY when the real
 * checkout admits that account for X:
 *
 *   checkout switch × price switch × availableToBuy per tier × open-ended free
 *   access (BQ-P10) × a live subscription on our record
 *
 * The checkout side is the REAL `startPlanCheckout`, with fakes only at the
 * edges (hold readers, snapshot, repository, Stripe). "Admitted" means it
 * reached Stripe's session create and returned ok.
 *
 * The view side is the REAL Settings purchase view (`readPlanPurchaseView`,
 * P-4.2), fed the SAME world through its own ports: the snapshot, the billing
 * row it reads itself, the switches and the buyable tiers. It is NOT handed
 * the predicate's facts, so the agreement is a cross-check of two readers of
 * our data, not a tautology (SA code review P-4.1, follow-up F-C). The
 * predicate is still asserted directly as a non-vacuity check.
 *
 * Documented exceptions (SA W-2): refusals that need Stripe, which the view
 * can never know (SR-11), and so are not part of the predicate. Each has its
 * own localised line on the screen that shows it:
 *   - M-3: the account's own open session reads `complete` → `checkout_processing`;
 *   - layer 1b: a live subscription at Stripe that our record does not show
 *     yet → `subscription_live`;
 *   - the price check: Stripe's price differs from the display price, or is
 *     missing → `price_mismatch` / `price_unavailable`.
 * The last block pins each one, so an exception cannot widen silently.
 *
 * Tier names come from the config (FR-12: none written here).
 */

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: { marker: 'service-role-default' } }));
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});
jest.mock('@/lib/stripe/StripeService', () => ({
  getStripeService: () => {
    throw new Error('the shared StripeService must not be reached when one is injected');
  },
}));

import { PLAN_STRIPE_PRICES } from '@/lib/business-os/entitlements/config/planPrices';
import { TIER_ORDER, type TierId } from '@/lib/business-os/entitlements/config/tierMatrix';
import { planPurchaseOffer, sellableTiers } from '@/lib/business-os/billing/planCheckoutEligibility';
import {
  LIVE_SUBSCRIPTION_STATUSES,
  isLiveSubscriptionStatus,
  startPlanCheckout,
  type PlanCheckoutDeps,
  type PlanSnapshotLike,
} from '@/lib/business-os/billing/planCheckout';
import { displayMonthlyPricesUsd, displayPriceInCents } from '@/lib/business-os/billing/planPriceCheck';
import { readPlanPurchaseView } from '@/lib/business-os/billing/planPurchaseView';

const USER = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-10-13T10:00:00.000Z');

type Row = NonNullable<Awaited<ReturnType<NonNullable<PlanCheckoutDeps['repo']>['findByUser']>>['data']>;

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    accountId: USER,
    livemode: false,
    stripeCustomerId: 'cus_stored',
    stripeSubscriptionId: null,
    subscriptionStatus: null,
    boughtTier: null,
    currentPeriodEnd: null,
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

const priceFor = (tier: TierId, unitAmount?: number) => ({
  id: `price_${PLAN_STRIPE_PRICES[tier].lookupKey}`,
  lookup_key: PLAN_STRIPE_PRICES[tier].lookupKey,
  active: true,
  currency: 'usd',
  unit_amount: unitAmount ?? (displayPriceInCents(displayMonthlyPricesUsd()[tier]) as number),
  type: 'recurring',
  recurring: { interval: 'month', interval_count: 1 },
  tax_behavior: 'exclusive',
  livemode: false,
});

const OPEN_ENDED: PlanSnapshotLike = {
  unavailable: false,
  resolution: { basis: { kind: 'cohort', cohort: 'any_admin_dated' }, lifecycle: { accessEndsAt: null } },
};
const ON_A_TIER: PlanSnapshotLike = {
  unavailable: false,
  resolution: { basis: { kind: 'tier', tier: TIER_ORDER[0] }, lifecycle: { accessEndsAt: null } },
};

interface World {
  checkoutEnabled: boolean;
  pricesEnabled: boolean;
  buyable: readonly TierId[];
  openEndedFreeAccess: boolean;
  billingRow: Row | null;
  openSession?: { status: 'open' | 'complete' | 'expired'; customerId: string; livemode: boolean };
  stripeSubscriptions?: Array<{ id: string; status: string }>;
  prices?: ReturnType<typeof priceFor>[];
}

async function checkoutAdmits(tier: TierId, world: World): Promise<{ admitted: boolean; code?: string }> {
  let sessionCreated = false;
  const deps: PlanCheckoutDeps = {
    holdReaders: {
      lineage: { findHoldFactsForAccount: async () => ({ data: null, error: null }) },
      invites: { findHoldFactsById: async () => ({ data: null, error: null }) },
    } as unknown as PlanCheckoutDeps['holdReaders'],
    readPlanSnapshot: async () => (world.openEndedFreeAccess ? OPEN_ENDED : ON_A_TIER),
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    repo: {
      findByUser: async () => ({ data: world.billingRow, error: null }),
      recordCustomer: async () => ({ data: { account: row(), created: true }, error: null }),
      acquireCheckoutLock: async () => ({ data: { acquired: true }, error: null }),
      replaceCustomer: async () => ({ data: { replaced: true }, error: null }),
      releaseCheckoutLock: async () => ({ data: { released: true }, error: null }),
    } as unknown as PlanCheckoutDeps['repo'],
    stripe: {
      listPricesByLookupKeys: async () => world.prices ?? TIER_ORDER.map((candidate) => priceFor(candidate)),
      listCustomerSubscriptions: async () => ({ complete: true, subscriptions: world.stripeSubscriptions ?? [] }),
      createBusinessOsPlanCheckoutSession: async () => {
        sessionCreated = true;
        return { sessionId: 'cs_test_matrix', clientSecret: 'cs_test_secret', expiresAt: 1_900_000_000, livemode: false };
      },
      expireCheckoutSession: async () => undefined,
      retrieveCheckoutSessionState: async () => world.openSession ?? { status: 'expired', customerId: 'cus_stored', livemode: false },
      findOrCreatePlatformCustomer: async () => ({ customerId: 'cus_created', created: true, livemode: false }),
    } as unknown as PlanCheckoutDeps['stripe'],
    // The price switch is read twice in production (step 4 and the predicate),
    // from the same environment variable; both see the same value here.
    pricesEnabled: () => world.pricesEnabled,
    heldPaymentSwitches: () => ({ checkoutEnabled: world.checkoutEnabled, pricesEnabled: world.pricesEnabled, paidInvitesAvailable: false }),
    buyableTiers: () => world.buyable,
    mode: () => 'test',
    now: () => NOW,
    attemptId: () => 'matrix-attempt',
    origin: () => 'https://app.example',
  };
  const result = await startPlanCheckout({ userId: USER, accountId: USER, email: 'owner@example.com', tier, returnTo: 'settings_plan' }, deps);
  // Never ok without a session, nor a session without ok.
  expect(result.ok).toBe(sessionCreated);
  return result.ok ? { admitted: true } : { admitted: false, code: result.code };
}

/** The Settings view's offer for this world, through its OWN reads (SA F-C). */
async function viewOffers(world: World): Promise<readonly string[]> {
  const purchase = await readPlanPurchaseView(
    { userId: USER, accountId: USER, snapshot: world.openEndedFreeAccess ? OPEN_ENDED : ON_A_TIER },
    {
      switches: () => ({ checkoutEnabled: world.checkoutEnabled, pricesEnabled: world.pricesEnabled }),
      billing: { findByUser: async () => ({ data: world.billingRow, error: null }) },
      mode: () => 'test',
      buyableTiers: () => world.buyable,
      now: () => NOW,
      logger: { warn: () => {} },
    }
  );
  // The view never returns null for a readable plan with a known key mode.
  expect(purchase).not.toBeNull();
  return purchase!.offer.kind === 'choose' ? purchase!.offer.tiers : [];
}

const BOOLS = [false, true] as const;
const SELLABLE = sellableTiers();
/** Every subset of the priced tiers, as the `availableToBuy` mask. */
const BUYABLE_SETS: TierId[][] = Array.from({ length: 2 ** SELLABLE.length }, (_v, mask) =>
  SELLABLE.filter((_tier, index) => (mask >> index) & 1)
);
const BILLING_ROWS: Array<[string, Row | null]> = [
  ['no billing row', null],
  ['a row with nothing live', row()],
  ...LIVE_SUBSCRIPTION_STATUSES.map((status) => [`a ${status} subscription on the record`, row({ subscriptionStatus: status })] as [string, Row]),
  ['a canceled subscription on the record', row({ subscriptionStatus: 'canceled' })],
];

const CASES = BOOLS.flatMap((checkoutEnabled) =>
  BOOLS.flatMap((pricesEnabled) =>
    BUYABLE_SETS.flatMap((buyable) =>
      BOOLS.flatMap((openEndedFreeAccess) =>
        BILLING_ROWS.map(([label, billingRow]) => [{ checkoutEnabled, pricesEnabled, buyable, openEndedFreeAccess, label }, billingRow] as const)
      )
    )
  )
);

describe('the Settings view offers X ⇔ the real checkout admits a non-held account for X (P-4.1 W-1, W-2; P-4.2 F-C)', () => {
  it('covers every combination of our own data (non-vacuity)', () => {
    expect(SELLABLE.length).toBeGreaterThan(1);
    expect(CASES.length).toBe(2 * 2 * BUYABLE_SETS.length * 2 * BILLING_ROWS.length);
  });

  it.each(CASES)('%j', async (facts, billingRow) => {
    const world: World = { ...facts, billingRow };
    const offer = planPurchaseOffer(
      { openEndedFreeAccess: facts.openEndedFreeAccess, subscriptionLive: isLiveSubscriptionStatus(billingRow?.subscriptionStatus) },
      { checkoutEnabled: facts.checkoutEnabled, pricesEnabled: facts.pricesEnabled },
      facts.buyable
    );
    const offered = offer.kind === 'choose' ? offer.tiers : [];
    // The view reaches the same answer from its own reads (F-C).
    const shown = await viewOffers(world);
    expect([...shown]).toEqual([...offered]);

    for (const tier of TIER_ORDER) {
      const { admitted } = await checkoutAdmits(tier, world);
      expect({ tier, admitted }).toEqual({ tier, admitted: shown.includes(tier) });
    }

    // Non-vacuity: Choose appears only when nothing in our data is in the way.
    const clear =
      facts.checkoutEnabled && facts.pricesEnabled && !facts.openEndedFreeAccess && !isLiveSubscriptionStatus(billingRow?.subscriptionStatus);
    expect(offered).toEqual(clear ? facts.buyable : []);
  });
});

describe('the documented exceptions: Stripe-side refusals the predicate cannot see (SA W-2)', () => {
  const ALL_CLEAR = { checkoutEnabled: true, pricesEnabled: true, buyable: SELLABLE, openEndedFreeAccess: false };
  const tier = SELLABLE[0];

  it('baseline: everything clear → offered (by the view too) and admitted', async () => {
    expect(planPurchaseOffer({ openEndedFreeAccess: false, subscriptionLive: false }, ALL_CLEAR, SELLABLE)).toEqual({ kind: 'choose', tiers: SELLABLE });
    expect(await viewOffers({ ...ALL_CLEAR, billingRow: row() })).toEqual(SELLABLE);
    expect(await checkoutAdmits(tier, { ...ALL_CLEAR, billingRow: row() })).toEqual({ admitted: true });
  });

  it('M-3: the account\'s own open session reads complete → checkout_processing', async () => {
    const billingRow = row({ openCheckoutSessionId: 'cs_test_open', openCheckoutExpiresAt: '2026-10-13T10:20:00.000Z' });
    const world = { ...ALL_CLEAR, billingRow, openSession: { status: 'complete' as const, customerId: 'cus_stored', livemode: false } };
    // The view makes no Stripe call (SR-11), so it still offers: the exception.
    expect(await viewOffers(world)).toContain(tier);
    expect(await checkoutAdmits(tier, world)).toEqual({ admitted: false, code: 'checkout_processing' });
  });

  it('layer 1b: a live subscription at Stripe that our record does not show yet → subscription_live', async () => {
    const world = { ...ALL_CLEAR, billingRow: row(), stripeSubscriptions: [{ id: 'sub_live', status: 'active' }] };
    expect(await checkoutAdmits(tier, world)).toEqual({ admitted: false, code: 'subscription_live' });
  });

  it('the price check: Stripe\'s price differs from the display price → price_mismatch', async () => {
    const world = { ...ALL_CLEAR, billingRow: row(), prices: TIER_ORDER.map((candidate) => priceFor(candidate, 1)) };
    expect(await checkoutAdmits(tier, world)).toEqual({ admitted: false, code: 'price_mismatch' });
  });

  it('the price check: no price at Stripe → price_unavailable', async () => {
    const world = { ...ALL_CLEAR, billingRow: row(), prices: [] };
    expect(await checkoutAdmits(tier, world)).toEqual({ admitted: false, code: 'price_unavailable' });
  });
});
