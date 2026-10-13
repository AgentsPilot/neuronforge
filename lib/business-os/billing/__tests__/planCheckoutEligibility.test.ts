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
import {
  heldPaymentOffer,
  planCheckoutEligibility,
  readHeldPaymentSwitches,
  sellableTiers,
  type HeldPaymentSwitches,
} from '@/lib/business-os/billing/planCheckoutEligibility';

const INVITE = '66666666-6666-4666-8666-666666666666';
/** P-5a.2: every held-payment switch on, so the held rules below are what decides. */
const ALL_ON: HeldPaymentSwitches = { checkoutEnabled: true, pricesEnabled: true, paidInvitesAvailable: true };

describe('sellableTiers', () => {
  it('is every tier with a configured Stripe price, in tier order', () => {
    expect(sellableTiers()).toEqual(TIER_ORDER.filter((tier) => tier in PLAN_STRIPE_PRICES));
    expect(sellableTiers().length).toBeGreaterThan(1);
  });
});

describe('planCheckoutEligibility', () => {
  it('not held → every sellable tier', () => {
    expect(planCheckoutEligibility({ ok: true, held: false }, ALL_ON)).toEqual({ ok: true, held: false, tiers: sellableTiers() });
  });

  it('a held friend (account_invite) → the friend tier ONLY, taken from the invite policy', () => {
    const result = planCheckoutEligibility({ ok: true, held: true, inviteId: INVITE, source: 'account_invite' }, ALL_ON);
    expect(result).toEqual({ ok: true, held: true, tiers: [INVITE_ISSUANCE_POLICY.account.grantId] });
    // Non-vacuity: the friend tier is the cheapest tier, and another tier exists that the friend may not buy.
    expect(INVITE_ISSUANCE_POLICY.account.grantId).toBe(TIER_ORDER[0]);
    expect(result.ok && result.tiers).not.toContain(TIER_ORDER[TIER_ORDER.length - 1]);
  });

  it('a held admin invitee (admin_invite) → refused until P-9 (fail closed)', () => {
    expect(planCheckoutEligibility({ ok: true, held: true, inviteId: INVITE, source: 'admin_invite' }, ALL_ON)).toEqual({
      ok: false,
      code: 'held_tier_unresolved',
    });
  });

  it('an unreadable hold → refused (fail CLOSED, unlike the page gate)', () => {
    expect(planCheckoutEligibility({ ok: false }, ALL_ON)).toEqual({ ok: false, code: 'hold_unreadable' });
  });

  // P-5a.2 (S5-1, D5-3, G5-5).
  it.each([
    ['checkoutEnabled'],
    ['pricesEnabled'],
    ['paidInvitesAvailable'],
  ] as const)('a held friend with %s off → held_payment_unavailable, never a widened list', (off) => {
    const switches = { ...ALL_ON, [off]: false };
    expect(planCheckoutEligibility({ ok: true, held: true, inviteId: INVITE, source: 'account_invite' }, switches)).toEqual({
      ok: false,
      code: 'held_payment_unavailable',
    });
  });

  it('not held is unaffected by the held-payment switches; an unreadable hold stays hold_unreadable', () => {
    const allOff: HeldPaymentSwitches = { checkoutEnabled: false, pricesEnabled: false, paidInvitesAvailable: false };
    expect(planCheckoutEligibility({ ok: true, held: false }, allOff)).toEqual({ ok: true, held: false, tiers: sellableTiers() });
    expect(planCheckoutEligibility({ ok: false }, allOff)).toEqual({ ok: false, code: 'hold_unreadable' });
  });

  it('writes no tier name (FR-12)', () => {
    const source = readFileSync(join(process.cwd(), 'lib', 'business-os', 'billing', 'planCheckoutEligibility.ts'), 'utf8');
    for (const tier of TIER_ORDER) expect(source).not.toMatch(new RegExp(`['"\`]${tier}['"\`]`));
  });
});

describe('heldPaymentOffer (P-5a.2, S5-2)', () => {
  const friend = { ok: true, held: true, inviteId: INVITE, source: 'account_invite' } as const;
  const admin = { ok: true, held: true, inviteId: INVITE, source: 'admin_invite' } as const;

  it('all switches on, a held friend → pay, the friend tier from the invite policy', () => {
    expect(heldPaymentOffer(friend, ALL_ON)).toEqual({ kind: 'pay', tier: INVITE_ISSUANCE_POLICY.account.grantId });
  });

  it('a held admin invitee → held_tier_unresolved (until P-9)', () => {
    expect(heldPaymentOffer(admin, ALL_ON)).toEqual({ kind: 'unavailable', code: 'held_tier_unresolved' });
  });

  it('any switch off → held_payment_unavailable, for a friend and an admin invitee alike (the switches come first)', () => {
    for (const off of ['checkoutEnabled', 'pricesEnabled', 'paidInvitesAvailable'] as const) {
      expect(heldPaymentOffer(friend, { ...ALL_ON, [off]: false })).toEqual({ kind: 'unavailable', code: 'held_payment_unavailable' });
      expect(heldPaymentOffer(admin, { ...ALL_ON, [off]: false })).toEqual({ kind: 'unavailable', code: 'held_payment_unavailable' });
    }
  });
});

describe('readHeldPaymentSwitches (P-5a.2, SA W-9)', () => {
  const NAMES = ['BUSINESS_OS_PLAN_CHECKOUT_ENABLED', 'BUSINESS_OS_PLAN_PRICES_ENABLED'] as const;
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const name of NAMES) saved[name] = process.env[name];
  });
  afterEach(() => {
    for (const name of NAMES) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });

  it('reads the two environment switches and the invite-policy constant, on every call', () => {
    process.env.BUSINESS_OS_PLAN_CHECKOUT_ENABLED = 'true';
    process.env.BUSINESS_OS_PLAN_PRICES_ENABLED = 'false';
    expect(readHeldPaymentSwitches()).toEqual({
      checkoutEnabled: true,
      pricesEnabled: false,
      paidInvitesAvailable: INVITE_ISSUANCE_POLICY.paidInvitesAvailable,
    });
    delete process.env.BUSINESS_OS_PLAN_CHECKOUT_ENABLED;
    process.env.BUSINESS_OS_PLAN_PRICES_ENABLED = 'true';
    expect(readHeldPaymentSwitches()).toMatchObject({ checkoutEnabled: false, pricesEnabled: true });
  });

  it('imports the flag readers from their own modules, never through planCheckout.ts', () => {
    const source = readFileSync(join(process.cwd(), 'lib', 'business-os', 'billing', 'planCheckoutEligibility.ts'), 'utf8');
    expect(source).toContain("from '@/lib/business-os/billing/planCheckoutFlag'");
    expect(source).toContain("from '@/lib/business-os/billing/planPricesFlag'");
    expect(source).not.toMatch(/from '@\/lib\/business-os\/billing\/planCheckout'/);
  });
});
