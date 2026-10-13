/**
 * The upgrade matrix (plan payments P-7b.1b; workplan §3.6, §7 "Offer"; SA
 * U-2, R-1 of §12, and the P-4.1 F-C lesson).
 *
 * For every combination of our own data that decides an upgrade, the Settings
 * view offers "Upgrade to X" EXACTLY when the real preview gets past step 5
 * (our-data decision) for X:
 *
 *   checkout switch × price switch × availableToBuy per tier × our billing row
 *   (none; bought tier; subscription id; status; cancel at period end; ended)
 *
 * The view side is the REAL `readPlanPurchaseView`, fed the world through its
 * own ports (switches, billing reader, key mode, buyable tiers). The route
 * side is the REAL `previewPlanUpgrade`, fed the SAME world through ITS ports.
 * Neither is handed the predicate's facts, so their agreement is a
 * cross-check of two readers of our data, not a tautology. "Gets past step 5"
 * means it reached Stripe's fresh subscription read (step 7; step 6 is the
 * confirm's clock window). The preview route only adds auth, the strict body
 * and the 404 switch in front of this function (its own suite pins those),
 * so the orchestration is where the two readers can disagree.
 *
 * Documented exceptions (as SA W-2 for P-4): refusals that need Stripe, which
 * the view can never know (SR-11). Each has its own localised line on the
 * screen (`planUpgradeCopy.ts`). The last block pins each one, so an
 * exception cannot widen silently.
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
import { sellableTiers } from '@/lib/business-os/billing/planCheckoutEligibility';
import type { PlanSnapshotLike } from '@/lib/business-os/billing/planCheckout';
import { displayMonthlyPricesUsd, displayPriceInCents } from '@/lib/business-os/billing/planPriceCheck';
import { readPlanPurchaseView } from '@/lib/business-os/billing/planPurchaseView';
import { previewPlanUpgrade, type PlanUpgradeDeps } from '@/lib/business-os/billing/planUpgrade';

const USER = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-10-13T10:00:00.000Z');
const NOW_S = Math.floor(NOW.getTime() / 1000);
const PAST = '2026-10-01T00:00:00.000Z';

type Row = NonNullable<Awaited<ReturnType<NonNullable<PlanUpgradeDeps['repo']>['findByUser']>>['data']>;
type SubscriptionRead = Awaited<ReturnType<NonNullable<PlanUpgradeDeps['stripe']>['retrieveBusinessOsSubscription']>>;

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    accountId: USER,
    livemode: false,
    stripeCustomerId: 'cus_own',
    stripeSubscriptionId: 'sub_own',
    subscriptionStatus: 'active',
    boughtTier: TIER_ORDER[0],
    currentPeriodEnd: '2026-11-01T00:00:00.000Z',
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

const priceIdOf = (tier: TierId) => `price_${PLAN_STRIPE_PRICES[tier].lookupKey}`;
const priceFor = (tier: TierId, unitAmount?: number) => ({
  id: priceIdOf(tier),
  lookup_key: PLAN_STRIPE_PRICES[tier].lookupKey,
  active: true,
  currency: 'usd',
  unit_amount: unitAmount ?? (displayPriceInCents(displayMonthlyPricesUsd()[tier]) as number),
  type: 'recurring',
  recurring: { interval: 'month', interval_count: 1 },
  tax_behavior: 'exclusive',
  livemode: false,
});

const ON_A_TIER: PlanSnapshotLike = {
  unavailable: false,
  resolution: { basis: { kind: 'tier', tier: TIER_ORDER[0] }, lifecycle: { accessEndsAt: null } },
};

interface World {
  checkoutEnabled: boolean;
  pricesEnabled: boolean;
  buyable: readonly TierId[];
  billing: { data: Row | null; error: Error | null };
  /** Stripe's side, for the documented exceptions only. */
  subscription?: SubscriptionRead;
  prices?: ReturnType<typeof priceFor>[];
}

function stripeSubscription(overrides: Partial<SubscriptionRead> = {}): SubscriptionRead {
  return {
    id: 'sub_own',
    status: 'active',
    customerId: 'cus_own',
    billingCycleAnchor: NOW_S - 86400 * 10,
    cancelAtPeriodEnd: false,
    endedAt: null,
    livemode: false,
    metadata: {},
    priceIds: [priceIdOf(TIER_ORDER[0])],
    items: [{ id: 'si_own', priceId: priceIdOf(TIER_ORDER[0]), currentPeriodStart: NOW_S - 86400 * 10, currentPeriodEnd: NOW_S + 86400 * 20 }],
    pendingUpdate: null,
    latestInvoiceId: 'in_last',
    ...overrides,
  };
}

/** The real preview, over this world. `reached` = it got to Stripe's fresh read (past step 5). */
async function previewFor(tier: TierId, world: World): Promise<{ reached: boolean; result: Awaited<ReturnType<typeof previewPlanUpgrade>> }> {
  let reached = false;
  const deps: PlanUpgradeDeps = {
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    repo: { findByUser: async () => world.billing },
    stripe: {
      retrieveBusinessOsSubscription: async () => {
        reached = true;
        if (!world.subscription) throw new Error('matrix: no Stripe answer needed past step 5');
        return world.subscription;
      },
      retrieveBusinessOsUpgradeInvoice: async () => {
        throw new Error('matrix: no pending invoice');
      },
      previewBusinessOsPlanUpgrade: async () => ({ amountDueMinor: 3387, totalMinor: 3387, taxMinor: 0, currency: 'usd' }),
      upgradeBusinessOsPlanSubscription: async () => {
        throw new Error('the preview never writes');
      },
      listPricesByLookupKeys: async () => (world.prices ?? TIER_ORDER.map((candidate) => priceFor(candidate))) as never,
    },
    catalog: {
      load: async () => ({ byPriceId: new Map(TIER_ORDER.map((t) => [priceIdOf(t), PLAN_STRIPE_PRICES[t].lookupKey])), fromCache: false }),
    },
    switches: () => ({ checkoutEnabled: world.checkoutEnabled, pricesEnabled: world.pricesEnabled }),
    buyableTiers: () => world.buyable,
    mode: () => 'test',
    now: () => NOW,
  };
  const result = await previewPlanUpgrade({ userId: USER, tier }, deps);
  return { reached, result };
}

/** The Settings view's upgrade tiers for this world, through its OWN reads (SA F-C). */
async function viewOffers(world: World): Promise<readonly string[]> {
  const purchase = await readPlanPurchaseView(
    { userId: USER, accountId: USER, snapshot: ON_A_TIER },
    {
      switches: () => ({ checkoutEnabled: world.checkoutEnabled, pricesEnabled: world.pricesEnabled }),
      billing: { findByUser: async () => world.billing },
      mode: () => 'test',
      buyableTiers: () => world.buyable,
      now: () => NOW,
      logger: { warn: () => {} },
    }
  );
  expect(purchase).not.toBeNull();
  return purchase!.upgrade?.tiers ?? [];
}

const BOOLS = [false, true] as const;
const SELLABLE = sellableTiers();
/** Every subset of the priced tiers, as the `availableToBuy` mask. */
const BUYABLE_SETS: TierId[][] = Array.from({ length: 2 ** SELLABLE.length }, (_v, mask) =>
  SELLABLE.filter((_tier, index) => (mask >> index) & 1)
);
const BOUGHT: Array<string | null> = [null, ...TIER_ORDER, 'retired_or_unknown_tier'];
const STATUSES = ['active', 'past_due', 'canceled', null] as const;

const BILLING: Array<[string, World['billing']]> = [
  ['no billing row', { data: null, error: null }],
  ['billing row unreadable', { data: null, error: new Error('db down') }],
  ...BOUGHT.flatMap((boughtTier) =>
    BOOLS.flatMap((hasSubscription) =>
      STATUSES.flatMap((subscriptionStatus) =>
        BOOLS.flatMap((cancelAtPeriodEnd) =>
          BOOLS.map(
            (ended) =>
              [
                JSON.stringify({ boughtTier, hasSubscription, subscriptionStatus, cancelAtPeriodEnd, ended }),
                {
                  data: row({
                    boughtTier,
                    stripeSubscriptionId: hasSubscription ? 'sub_own' : null,
                    subscriptionStatus,
                    cancelAtPeriodEnd,
                    endedAt: ended ? PAST : null,
                  }),
                  error: null,
                },
              ] as [string, World['billing']]
          )
        )
      )
    )
  ),
];

const CASES = BOOLS.flatMap((checkoutEnabled) =>
  BOOLS.flatMap((pricesEnabled) =>
    BUYABLE_SETS.flatMap((buyable) => BILLING.map(([label, billing]) => [{ checkoutEnabled, pricesEnabled, buyable, label }, billing] as const))
  )
);

describe('the Settings view offers "Upgrade to X" ⇔ the real preview gets past our own data for X (SA U-2, F-C)', () => {
  it('covers every combination of our own data (non-vacuity)', () => {
    expect(SELLABLE.length).toBeGreaterThan(1);
    expect(CASES.length).toBe(2 * 2 * BUYABLE_SETS.length * BILLING.length);
  });

  it('the matrix is not vacuous: some worlds offer an upgrade, most do not', async () => {
    const offered = await viewOffers({ checkoutEnabled: true, pricesEnabled: true, buyable: SELLABLE, billing: { data: row(), error: null } });
    expect(offered.length).toBeGreaterThan(0);
  });

  it.each(CASES)('%j', async (facts, billing) => {
    const world: World = { checkoutEnabled: facts.checkoutEnabled, pricesEnabled: facts.pricesEnabled, buyable: facts.buyable, billing };
    const shown = await viewOffers(world);
    for (const tier of TIER_ORDER) {
      const { reached } = await previewFor(tier, world);
      expect({ tier, reached }).toEqual({ tier, reached: shown.includes(tier) });
    }
  });
});

describe('the documented exceptions: Stripe-side refusals the view cannot see (SR-11)', () => {
  const TOP = TIER_ORDER[TIER_ORDER.length - 1];
  const CLEAR: Omit<World, 'subscription'> = { checkoutEnabled: true, pricesEnabled: true, buyable: SELLABLE, billing: { data: row(), error: null } };

  it('baseline: everything clear on both sides → offered by the view, previewed by the route', async () => {
    expect(await viewOffers(CLEAR)).toContain(TOP);
    expect((await previewFor(TOP, { ...CLEAR, subscription: stripeSubscription() })).result).toMatchObject({ ok: true, tier: TOP });
  });

  it.each([
    ['Stripe says past_due while our record says active', { status: 'past_due' as const }, 'subscription_not_active'],
    ['Stripe says cancelling while our record does not', { cancelAtPeriodEnd: true }, 'subscription_cancelling'],
    ['a pending update for another target', { pendingUpdate: { expiresAt: NOW_S + 3600, priceIds: ['price_elsewhere'] } }, 'upgrade_pending'],
    [
      'the item already on the higher tier (the webhook is late, V-2)',
      { items: [{ id: 'si_own', priceId: priceIdOf(TOP), currentPeriodStart: NOW_S - 86400, currentPeriodEnd: NOW_S + 86400 }] },
      'upgrade_processing',
    ],
    ['a different customer at Stripe', { customerId: 'cus_other' }, 'billing_record_mismatch'],
  ] as Array<[string, Partial<SubscriptionRead>, string]>)('%s → offered, refused %s… by code', async (_label, stripeSide, code) => {
    expect(await viewOffers(CLEAR)).toContain(TOP);
    const { reached, result } = await previewFor(TOP, { ...CLEAR, subscription: stripeSubscription(stripeSide) });
    expect(reached).toBe(true);
    expect(result).toMatchObject({ ok: false, code });
  });

  it('the price check: Stripe\'s price differs from the display price → offered, refused price_mismatch', async () => {
    const prices = TIER_ORDER.map((tier) => (tier === TOP ? priceFor(tier, 1) : priceFor(tier)));
    const { result } = await previewFor(TOP, { ...CLEAR, subscription: stripeSubscription(), prices });
    expect(result).toMatchObject({ ok: false, code: 'price_mismatch' });
  });
});
