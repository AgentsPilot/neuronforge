/**
 * Which tiers an account may buy (plan payments P-3a, workplan T6; SA-P11,
 * SA Q-3). Tiers are compared with the CONFIG, never written as literals
 * (FR-12: this folder may not name a tier).
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { INVITE_ISSUANCE_POLICY } from '@/lib/business-os/entitlements/config/invites';
import { PLAN_STRIPE_PRICES } from '@/lib/business-os/entitlements/config/planPrices';
import { TIER_MATRIX, TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';
import {
  buyableTiers,
  heldPaymentOffer,
  planCheckoutEligibility,
  planPurchaseOffer,
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
  // Rewritten on purpose for P-4.1 (SA W-1): a non-held account's tiers are
  // decided by `planPurchaseOffer` after every read, not at step 6.
  it('not held → admitted past the hold, with no tier list (planPurchaseOffer decides later)', () => {
    expect(planCheckoutEligibility({ ok: true, held: false }, ALL_ON)).toEqual({ ok: true, held: false });
  });

  it('a held friend (account_invite) → the friend tier ONLY, taken from the invite policy', () => {
    const result = planCheckoutEligibility({ ok: true, held: true, inviteId: INVITE, source: 'account_invite' }, ALL_ON);
    expect(result).toEqual({ ok: true, held: true, tiers: [INVITE_ISSUANCE_POLICY.account.grantId] });
    // Non-vacuity: the friend tier is the cheapest tier, and another tier exists that the friend may not buy.
    expect(INVITE_ISSUANCE_POLICY.account.grantId).toBe(TIER_ORDER[0]);
    expect(result.ok && result.held ? result.tiers : []).not.toContain(TIER_ORDER[TIER_ORDER.length - 1]);
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
    expect(planCheckoutEligibility({ ok: true, held: false }, allOff)).toEqual({ ok: true, held: false });
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

describe('buyableTiers (P-4.1, M-1)', () => {
  it('is every priced tier whose presentation.availableToBuy is on, in tier order', () => {
    expect(buyableTiers()).toEqual(sellableTiers().filter((tier) => TIER_MATRIX.presentation[tier].availableToBuy));
  });

  it('production config sells every priced tier (availableToBuy on since 2026-10-13, for testing; productionConfig.test.ts pins it too)', () => {
    expect(buyableTiers()).toEqual(sellableTiers());
    // Every tier is priced, so "every priced tier" is not a vacuous claim.
    expect(sellableTiers()).toEqual([...TIER_ORDER]);
  });

  it.each(TIER_ORDER.map((tier) => [tier]))('turning availableToBuy OFF for %s drops exactly that tier', (off) => {
    const presentation = TIER_MATRIX.presentation as Record<string, { availableToBuy: boolean }>;
    const saved = presentation[off].availableToBuy;
    presentation[off].availableToBuy = false;
    try {
      expect(buyableTiers()).toEqual(TIER_ORDER.filter((tier) => tier !== off));
    } finally {
      presentation[off].availableToBuy = saved;
    }
  });
});

describe('planPurchaseOffer (P-4.1, M-1, BQ-P10; SA W-2)', () => {
  const ON = { checkoutEnabled: true, pricesEnabled: true };
  const NONE = { openEndedFreeAccess: false, subscriptionLive: false };
  const ALL = [...TIER_ORDER];

  it('everything on, nothing in the way → choose, exactly the buyable tiers given', () => {
    expect(planPurchaseOffer(NONE, ON, ALL)).toEqual({ kind: 'choose', tiers: ALL });
    expect(planPurchaseOffer(NONE, ON, [TIER_ORDER[0]])).toEqual({ kind: 'choose', tiers: [TIER_ORDER[0]] });
  });

  it.each([['checkoutEnabled'], ['pricesEnabled']] as const)('%s off → switches_off', (off) => {
    expect(planPurchaseOffer(NONE, { ...ON, [off]: false }, ALL)).toEqual({ kind: 'none', reason: 'switches_off' });
  });

  it('paidInvitesAvailable is not an input (held accounts only)', () => {
    const withHeldSwitchOff: HeldPaymentSwitches = { ...ALL_ON, paidInvitesAvailable: false };
    expect(planPurchaseOffer(NONE, withHeldSwitchOff, ALL)).toEqual({ kind: 'choose', tiers: ALL });
  });

  it('open-ended free access → free_access_no_end_date (BQ-P10)', () => {
    expect(planPurchaseOffer({ ...NONE, openEndedFreeAccess: true }, ON, ALL)).toEqual({ kind: 'none', reason: 'free_access_no_end_date' });
  });

  it('a live subscription on our record → paying', () => {
    expect(planPurchaseOffer({ ...NONE, subscriptionLive: true }, ON, ALL)).toEqual({ kind: 'none', reason: 'paying' });
  });

  it('nothing buyable → not_on_sale', () => {
    expect(planPurchaseOffer(NONE, ON, [])).toEqual({ kind: 'none', reason: 'not_on_sale' });
  });

  it('first reason wins: switches, then free access, then paying, then not on sale', () => {
    const everything = { openEndedFreeAccess: true, subscriptionLive: true };
    expect(planPurchaseOffer(everything, { ...ON, checkoutEnabled: false }, [])).toEqual({ kind: 'none', reason: 'switches_off' });
    expect(planPurchaseOffer(everything, ON, [])).toEqual({ kind: 'none', reason: 'free_access_no_end_date' });
    expect(planPurchaseOffer({ ...everything, openEndedFreeAccess: false }, ON, [])).toEqual({ kind: 'none', reason: 'paying' });
  });

  it('defaults to the production buyable tiers', () => {
    expect(planPurchaseOffer(NONE, ON)).toEqual(buyableTiers().length ? { kind: 'choose', tiers: buyableTiers() } : { kind: 'none', reason: 'not_on_sale' });
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
