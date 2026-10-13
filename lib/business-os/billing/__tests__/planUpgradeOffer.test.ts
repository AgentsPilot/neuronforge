/**
 * planUpgradeOffer (plan payments P-7b.1a, workplan §3.1; SA U-2): whether an
 * owner who pays may upgrade, from OUR billing record only. Every reason, in
 * order. Tiers come from TIER_ORDER, never a literal (FR-12).
 */

import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';
import { planUpgradeOffer, type PlanUpgradeFacts } from '@/lib/business-os/billing/planCheckoutEligibility';

const LOWER = TIER_ORDER[0];
const TOP = TIER_ORDER[TIER_ORDER.length - 1];
const ABOVE_LOWER = TIER_ORDER.slice(1);
const ON = { checkoutEnabled: true, pricesEnabled: true };

function paying(overrides: Partial<PlanUpgradeFacts> = {}): PlanUpgradeFacts {
  return {
    boughtTier: LOWER,
    subscriptionId: 'sub_1',
    subscriptionStatus: 'active',
    cancelAtPeriodEnd: false,
    endedAt: null,
    ...overrides,
  };
}

describe('planUpgradeOffer', () => {
  it('an active paying account on the lower tier is offered every buyable tier above it, in tier order', () => {
    expect(TIER_ORDER.length).toBeGreaterThan(1);
    expect(planUpgradeOffer(paying(), ON, TIER_ORDER)).toEqual({ kind: 'upgrade', from: LOWER, tiers: ABOVE_LOWER });
  });

  it.each([
    ['checkout off', { checkoutEnabled: false, pricesEnabled: true }],
    ['prices off', { checkoutEnabled: true, pricesEnabled: false }],
  ])('switches_off first (%s), even for a record that would otherwise be offered', (_label, switches) => {
    expect(planUpgradeOffer(paying(), switches, TIER_ORDER)).toEqual({ kind: 'none', reason: 'switches_off' });
    expect(planUpgradeOffer(null, switches, TIER_ORDER)).toEqual({ kind: 'none', reason: 'switches_off' });
  });

  it.each([
    ['no billing row', null],
    ['no boughtTier (a held account has none, by construction)', paying({ boughtTier: null })],
    ['a boughtTier the config does not know', paying({ boughtTier: 'retired_tier_x' })],
    ['no subscription id (never races the first payment)', paying({ subscriptionId: null })],
  ])('not_subscribed: %s', (_label, facts) => {
    expect(planUpgradeOffer(facts, ON, TIER_ORDER)).toEqual({ kind: 'none', reason: 'not_subscribed' });
  });

  it('a held-shaped record (no boughtTier, no subscription) is not_subscribed even if its status reads active', () => {
    expect(planUpgradeOffer(paying({ boughtTier: null, subscriptionId: null }), ON, TIER_ORDER)).toEqual({
      kind: 'none',
      reason: 'not_subscribed',
    });
  });

  it.each(['past_due', 'incomplete', 'trialing', 'unpaid', 'paused', 'canceled', 'incomplete_expired', null, 'something_new'])(
    'not_active: status %s',
    (status) => {
      expect(planUpgradeOffer(paying({ subscriptionStatus: status }), ON, TIER_ORDER)).toEqual({ kind: 'none', reason: 'not_active' });
    }
  );

  it('not_active: an ended subscription, even if the status still reads active', () => {
    expect(planUpgradeOffer(paying({ endedAt: '2026-10-01T00:00:00.000Z' }), ON, TIER_ORDER)).toEqual({ kind: 'none', reason: 'not_active' });
  });

  it('cancelling: set to cancel at the period end', () => {
    expect(planUpgradeOffer(paying({ cancelAtPeriodEnd: true }), ON, TIER_ORDER)).toEqual({ kind: 'none', reason: 'cancelling' });
  });

  it('top_tier: nothing above the bought tier', () => {
    expect(planUpgradeOffer(paying({ boughtTier: TOP }), ON, TIER_ORDER)).toEqual({ kind: 'none', reason: 'top_tier' });
  });

  it('not_on_sale: no tier above is buyable; a buyable tier BELOW does not count', () => {
    expect(planUpgradeOffer(paying(), ON, [LOWER])).toEqual({ kind: 'none', reason: 'not_on_sale' });
    expect(planUpgradeOffer(paying(), ON, [])).toEqual({ kind: 'none', reason: 'not_on_sale' });
  });

  it('first reason wins: cancelling AND past_due reads not_active; top tier AND cancelling reads cancelling', () => {
    expect(planUpgradeOffer(paying({ subscriptionStatus: 'past_due', cancelAtPeriodEnd: true }), ON, TIER_ORDER).kind).toBe('none');
    expect(planUpgradeOffer(paying({ subscriptionStatus: 'past_due', cancelAtPeriodEnd: true }), ON, TIER_ORDER)).toMatchObject({ reason: 'not_active' });
    expect(planUpgradeOffer(paying({ boughtTier: TOP, cancelAtPeriodEnd: true }), ON, TIER_ORDER)).toMatchObject({ reason: 'cancelling' });
  });
});
