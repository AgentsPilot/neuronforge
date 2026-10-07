/**
 * Which tiers an account may buy (plan payments P-3a, workplan T6; SA-P11,
 * SA Q-3). Tiers are compared with the CONFIG, never written as literals
 * (FR-12: this folder may not name a tier).
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { INVITE_ISSUANCE_POLICY } from '@/lib/business-os/entitlements/config/invites';
import { PLAN_STRIPE_PRICES } from '@/lib/business-os/entitlements/config/planPrices';
import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';
import { planCheckoutEligibility, sellableTiers } from '@/lib/business-os/billing/planCheckoutEligibility';

const INVITE = '66666666-6666-4666-8666-666666666666';

describe('sellableTiers', () => {
  it('is every tier with a configured Stripe price, in tier order', () => {
    expect(sellableTiers()).toEqual(TIER_ORDER.filter((tier) => tier in PLAN_STRIPE_PRICES));
    expect(sellableTiers().length).toBeGreaterThan(1);
  });
});

describe('planCheckoutEligibility', () => {
  it('not held → every sellable tier', () => {
    expect(planCheckoutEligibility({ ok: true, held: false })).toEqual({ ok: true, held: false, tiers: sellableTiers() });
  });

  it('a held friend (account_invite) → the friend tier ONLY, taken from the invite policy', () => {
    const result = planCheckoutEligibility({ ok: true, held: true, inviteId: INVITE, source: 'account_invite' });
    expect(result).toEqual({ ok: true, held: true, tiers: [INVITE_ISSUANCE_POLICY.account.grantId] });
    // Non-vacuity: the friend tier is the cheapest tier, and another tier exists that the friend may not buy.
    expect(INVITE_ISSUANCE_POLICY.account.grantId).toBe(TIER_ORDER[0]);
    expect(result.ok && result.tiers).not.toContain(TIER_ORDER[TIER_ORDER.length - 1]);
  });

  it('a held admin invitee (admin_invite) → refused until P-9 (fail closed)', () => {
    expect(planCheckoutEligibility({ ok: true, held: true, inviteId: INVITE, source: 'admin_invite' })).toEqual({
      ok: false,
      code: 'held_tier_unresolved',
    });
  });

  it('an unreadable hold → refused (fail CLOSED, unlike the page gate)', () => {
    expect(planCheckoutEligibility({ ok: false })).toEqual({ ok: false, code: 'hold_unreadable' });
  });

  it('writes no tier name (FR-12)', () => {
    const source = readFileSync(join(process.cwd(), 'lib', 'business-os', 'billing', 'planCheckoutEligibility.ts'), 'utf8');
    for (const tier of TIER_ORDER) expect(source).not.toMatch(new RegExp(`['"\`]${tier}['"\`]`));
  });
});
