/**
 * planUpgradeEligibility (plan payments P-7b.1a, workplan §3.2; SA U-2, V-2,
 * V-8): the upgrade re-checked against Stripe's fresh answer. Pure. Every
 * rule, in order. Tiers from TIER_ORDER (FR-12); the Stripe shapes are
 * hand-built here; the real E-1 / E-4 subscriptions run through the
 * orchestration in `planUpgrade.captured.test.ts` (U-7, P-7b.1b).
 */

import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';
import {
  planUpgradeEligibility,
  type PlanUpgradeRowFacts,
  type PlanUpgradeSubscriptionFacts,
} from '@/lib/business-os/billing/planUpgrade';

const LOWER = TIER_ORDER[0];
const TOP = TIER_ORDER[TIER_ORDER.length - 1];
const PRICE_LOWER = 'price_lower_handbuilt';
const PRICE_LOWER_RETIRED = 'price_lower_retired_handbuilt';
const PRICE_TOP = 'price_top_handbuilt';
const TIERS: Record<string, string> = { [PRICE_LOWER]: LOWER, [PRICE_LOWER_RETIRED]: LOWER, [PRICE_TOP]: TOP };
const tierOf = (id: string) => TIERS[id] ?? null;
const PERIOD_START = 1_790_000_000;

const row: PlanUpgradeRowFacts = { stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', livemode: false, boughtTier: LOWER };

function sub(overrides: Partial<PlanUpgradeSubscriptionFacts> = {}): PlanUpgradeSubscriptionFacts {
  return {
    id: 'sub_1',
    customerId: 'cus_1',
    livemode: false,
    status: 'active',
    cancelAtPeriodEnd: false,
    pendingUpdate: null,
    items: [{ id: 'si_1', priceId: PRICE_LOWER, currentPeriodStart: PERIOD_START, currentPeriodEnd: PERIOD_START + 2_592_000 }],
    latestInvoiceId: 'in_last',
    ...overrides,
  };
}

const check = (s: PlanUpgradeSubscriptionFacts, options: { prorationDate?: number; buyable?: readonly string[] } = {}) =>
  planUpgradeEligibility(row, s, TOP, tierOf, { buyable: (options.buyable ?? TIER_ORDER) as never, prorationDate: options.prorationDate });

describe('planUpgradeEligibility', () => {
  it('eligible: the one item, on the bought tier', () => {
    expect(check(sub())).toEqual({ kind: 'eligible', item: sub().items[0] });
  });

  it('CF-1: an item on a RETIRED key of the bought tier is accepted', () => {
    expect(check(sub({ items: [{ id: 'si_1', priceId: PRICE_LOWER_RETIRED, currentPeriodStart: PERIOD_START, currentPeriodEnd: null }] })).kind).toBe(
      'eligible'
    );
  });

  it.each([
    ['another subscription', sub({ id: 'sub_other' })],
    ['another customer', sub({ customerId: 'cus_other' })],
    ['another mode', sub({ livemode: true })],
  ])('billing_record_mismatch: %s', (_label, s) => {
    expect(check(s)).toMatchObject({ kind: 'refused', code: 'billing_record_mismatch', reason: 'subscription_record_differs' });
  });

  it.each(['past_due', 'incomplete', 'trialing', 'unpaid', 'paused', 'canceled', 'something_new'])('subscription_not_active: %s', (status) => {
    expect(check(sub({ status: status as never }))).toMatchObject({ kind: 'refused', code: 'subscription_not_active' });
  });

  it('subscription_cancelling', () => {
    expect(check(sub({ cancelAtPeriodEnd: true }))).toMatchObject({ kind: 'refused', code: 'subscription_cancelling' });
  });

  it('a pending update: `pending`, with its expiry, the tier it would set and the invoice it waits on', () => {
    expect(check(sub({ pendingUpdate: { expiresAt: 1_790_080_000, priceIds: [PRICE_TOP] } }))).toEqual({
      kind: 'pending',
      expiresAt: 1_790_080_000,
      pendingTier: TOP,
      latestInvoiceId: 'in_last',
    });
    // Prices it cannot name, or two tiers: no pending tier (never resumed).
    expect(check(sub({ pendingUpdate: { expiresAt: 1, priceIds: ['price_unknown'] } }))).toMatchObject({ kind: 'pending', pendingTier: null });
    expect(check(sub({ pendingUpdate: { expiresAt: 1, priceIds: [PRICE_LOWER, PRICE_TOP] } }))).toMatchObject({ kind: 'pending', pendingTier: null });
  });

  it.each([
    ['zero items', []],
    [
      'two items',
      [
        { id: 'si_1', priceId: PRICE_LOWER, currentPeriodStart: PERIOD_START, currentPeriodEnd: null },
        { id: 'si_2', priceId: PRICE_LOWER, currentPeriodStart: PERIOD_START, currentPeriodEnd: null },
      ],
    ],
  ])('billing_record_mismatch: %s (item count, alerted)', (_label, items) => {
    expect(check(sub({ items }))).toMatchObject({ kind: 'refused', code: 'billing_record_mismatch', reason: 'item_count' });
  });

  it('billing_record_mismatch: the item price is not in the catalog', () => {
    expect(check(sub({ items: [{ id: 'si_1', priceId: 'price_unknown', currentPeriodStart: PERIOD_START, currentPeriodEnd: null }] }))).toMatchObject({
      code: 'billing_record_mismatch',
      reason: 'item_price_not_in_catalog',
    });
  });

  it('V-2: the item already on the higher tier, no pending update → upgrade_processing (the webhook is late), NOT a mismatch', () => {
    expect(check(sub({ items: [{ id: 'si_1', priceId: PRICE_TOP, currentPeriodStart: PERIOD_START, currentPeriodEnd: null }] }))).toMatchObject({
      kind: 'refused',
      code: 'upgrade_processing',
    });
  });

  it('V-2: the item BELOW the bought tier is a mismatch', () => {
    const topRow = { ...row, boughtTier: TOP };
    expect(planUpgradeEligibility(topRow, sub(), TOP, tierOf, { buyable: TIER_ORDER })).toMatchObject({
      code: 'billing_record_mismatch',
      reason: 'item_below_bought_tier',
    });
  });

  it('not_an_upgrade: the target equal to the bought tier', () => {
    expect(planUpgradeEligibility(row, sub(), LOWER, tierOf, { buyable: TIER_ORDER })).toMatchObject({ code: 'not_an_upgrade' });
  });

  it('price_unavailable: the target not buyable', () => {
    expect(check(sub(), { buyable: [LOWER] })).toMatchObject({ code: 'price_unavailable', reason: 'tier_not_sold' });
  });

  it('V-8: a proration date before the ITEM period start is preview_expired; at or after it is eligible', () => {
    expect(check(sub(), { prorationDate: PERIOD_START - 1 })).toMatchObject({ code: 'preview_expired', reason: 'proration_before_period_start' });
    expect(check(sub(), { prorationDate: PERIOD_START }).kind).toBe('eligible');
    expect(check(sub({ items: [{ id: 'si_1', priceId: PRICE_LOWER, currentPeriodStart: null, currentPeriodEnd: null }] }), { prorationDate: PERIOD_START })).toMatchObject({
      code: 'preview_expired',
    });
  });

  it('first rule wins: a mismatched customer that is also cancelling reads billing_record_mismatch', () => {
    expect(check(sub({ customerId: 'cus_other', cancelAtPeriodEnd: true }))).toMatchObject({ code: 'billing_record_mismatch' });
    expect(check(sub({ status: 'past_due', pendingUpdate: { expiresAt: 1, priceIds: [PRICE_TOP] } }))).toMatchObject({ code: 'subscription_not_active' });
  });
});
