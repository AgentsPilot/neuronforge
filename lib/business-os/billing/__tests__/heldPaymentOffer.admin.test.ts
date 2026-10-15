/**
 * Plan payments P-9.2 (workplan BUSINESS_OS_PLAN_PAYMENTS_P9_WORKPLAN.md §3.4,
 * §7 "heldPaymentOffer", "Holding screen"; SA-P9, SA C-3, C-5, C-6, W-2).
 *
 * What matters:
 *   - an admin Paid invitee is offered EXACTLY the tier the admin chose
 *     (`grantId` on the hold), when it has a Stripe price (`sellableTiers()`,
 *     never `buyableTiers()`); an unknown or unpriced tier is
 *     `held_tier_unresolved` (fail closed, never widened);
 *   - the switches come first (D5-3);
 *   - `heldInviteOffer` (the step the invite page shares, C-6) and
 *     `heldPaymentOffer` give the same answer for every hold;
 *   - the holding screen shows the invited plan in the invite's language with
 *     the config's price, and alerts once when every switch is on but the
 *     account has nothing it can buy (W-2: ids and source only).
 * Tier names and prices come from the CONFIG, never written here.
 */

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: { marker: 'service-role-default' } }));
jest.mock('@/lib/stripe/StripeService', () => ({
  getStripeService: () => {
    throw new Error('the holding screen never talks to Stripe');
  },
}));

import { readFileSync } from 'fs';
import { join } from 'path';

import { INVITE_ISSUANCE_POLICY } from '@/lib/business-os/entitlements/config/invites';
import { TIER_MATRIX, TIER_ORDER, type TierId } from '@/lib/business-os/entitlements/config/tierMatrix';
import { readHeldPaymentView, type HeldPaymentViewDeps } from '@/lib/business-os/billing/heldPaymentView';
import {
  heldInviteOffer,
  heldPaymentOffer,
  sellableTiers,
  type HeldPaymentHold,
  type HeldPaymentSwitches,
} from '@/lib/business-os/billing/planCheckoutEligibility';

const USER = '11111111-1111-4111-8111-111111111111';
const INVITE = '66666666-6666-4666-8666-666666666666';
const ALL_ON: HeldPaymentSwitches = { checkoutEnabled: true, pricesEnabled: true, paidInvitesAvailable: true };
const UNPRICED = 'tier_without_a_price';

const adminHold = (grantId: string): HeldPaymentHold => ({ ok: true, held: true, inviteId: INVITE, source: 'admin_invite', grantId });
const friendHold: HeldPaymentHold = { ok: true, held: true, inviteId: INVITE, source: 'account_invite' };

const BOOLS = [false, true] as const;
const COMBINATIONS: HeldPaymentSwitches[] = BOOLS.flatMap((checkoutEnabled) =>
  BOOLS.flatMap((pricesEnabled) => BOOLS.map((paidInvitesAvailable) => ({ checkoutEnabled, pricesEnabled, paidInvitesAvailable })))
);

describe('heldPaymentOffer, admin branch (SA-P9, C-3, C-5)', () => {
  it('every tier the config prices is sellable today (non-vacuity for the cases below)', () => {
    expect(sellableTiers().length).toBeGreaterThan(0);
  });

  it.each(sellableTiers().map((tier) => [tier]))('invited to %s, all switches on → pay exactly that tier', (tier) => {
    expect(heldPaymentOffer(adminHold(tier), ALL_ON)).toEqual({ kind: 'pay', tier });
  });

  it.each([[UNPRICED], [''], ['constructor']])('an unknown or unpriced grantId %j → held_tier_unresolved (never widened)', (grantId) => {
    expect(heldPaymentOffer(adminHold(grantId), ALL_ON)).toEqual({ kind: 'unavailable', code: 'held_tier_unresolved' });
  });

  it.each(COMBINATIONS.filter((s) => !(s.checkoutEnabled && s.pricesEnabled && s.paidInvitesAvailable)).map((s) => [s]))(
    'switches %j: held_payment_unavailable, whatever the tier (the switches come first)',
    (switches) => {
      for (const tier of [...TIER_ORDER, UNPRICED]) {
        expect(heldPaymentOffer(adminHold(tier), switches)).toEqual({ kind: 'unavailable', code: 'held_payment_unavailable' });
      }
    }
  );

  it('the friend branch is unchanged: the invite policy\'s friend tier', () => {
    expect(heldPaymentOffer(friendHold, ALL_ON)).toEqual({ kind: 'pay', tier: INVITE_ISSUANCE_POLICY.account.grantId });
  });
});

describe('C-6: heldInviteOffer is the one step, and heldPaymentOffer delegates to it', () => {
  const holds: HeldPaymentHold[] = [friendHold, ...TIER_ORDER.map((tier) => adminHold(tier)), adminHold(UNPRICED)];
  it.each(COMBINATIONS.flatMap((switches) => holds.map((hold) => [hold, switches] as const)))('%j × %j: the same answer', (hold, switches) => {
    const invite = hold.source === 'admin_invite' ? { source: 'admin_invite' as const, grantId: hold.grantId } : { source: 'account_invite' as const };
    expect(heldInviteOffer(invite, switches)).toEqual(heldPaymentOffer(hold, switches));
  });

  it('source: sellableTiers only; no buyableTiers, no INVITE_TYPES grant list, no tier literal in the decision', () => {
    const text = readFileSync(join(process.cwd(), 'lib', 'business-os', 'billing', 'planCheckoutEligibility.ts'), 'utf8').replace(/\r\n/g, '\n');
    const at = text.indexOf('export function heldInviteOffer(');
    const body = text.slice(at, text.indexOf('\n}\n', at));
    expect(body).toContain('sellableTiers()');
    expect(body).not.toContain('buyableTiers');
    expect(body).not.toContain('INVITE_TYPES');
    for (const tier of TIER_ORDER) expect(body).not.toContain(`'${tier}'`);
  });
});

function viewHarness(switches: HeldPaymentSwitches = ALL_ON) {
  const logger = { warn: jest.fn(), error: jest.fn() };
  const deps: HeldPaymentViewDeps = {
    switches: () => switches,
    billing: { findByUser: jest.fn(async () => ({ data: null, error: null })) } as unknown as HeldPaymentViewDeps['billing'],
    mode: () => 'test',
    now: () => new Date('2026-10-14T10:00:00.000Z'),
    logger,
  };
  return { deps, logger };
}

describe('the holding screen for an admin Paid invitee (§3.4)', () => {
  const lastTier = TIER_ORDER[TIER_ORDER.length - 1] as TierId;

  it.each([['en'], ['he'], ['es']] as const)('invited to the top tier, %s: Pay with that plan\'s label and monthly price from the config', async (language) => {
    const { deps, logger } = viewHarness();
    const view = await readHeldPaymentView({ userId: USER, accountId: USER, hold: adminHold(lastTier), language, checkoutReturned: false }, deps);
    expect(view).toEqual({
      kind: 'pay',
      tier: lastTier,
      planName: TIER_MATRIX.presentation[lastTier].labels[language],
      monthlyPriceUsd: TIER_MATRIX.presentation[lastTier].monthlyPriceUsd,
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('W-2: every switch on but the invited tier has no price → coming soon and ONE alert, ids and source only', async () => {
    const { deps, logger } = viewHarness();
    const view = await readHeldPaymentView({ userId: USER, accountId: USER, hold: adminHold(UNPRICED), language: 'en', checkoutReturned: false }, deps);
    expect(view).toEqual({ kind: 'coming_soon' });
    expect(logger.error).toHaveBeenCalledTimes(1);
    const [ctx] = logger.error.mock.calls[0] as [Record<string, unknown>, string];
    expect(ctx).toEqual({ event: 'bos_billing_held_tier_unresolved', alert: true, accountId: USER, source: 'admin_invite' });
    expect(deps.billing!.findByUser).not.toHaveBeenCalled();
  });

  it.each(COMBINATIONS.filter((s) => !(s.checkoutEnabled && s.pricesEnabled && s.paidInvitesAvailable)).map((s) => [s]))(
    'a switch off (%j): coming soon with NO alert (that is the designed waiting state)',
    async (switches) => {
      const { deps, logger } = viewHarness(switches);
      const view = await readHeldPaymentView({ userId: USER, accountId: USER, hold: adminHold(UNPRICED), language: 'en', checkoutReturned: false }, deps);
      expect(view).toEqual({ kind: 'coming_soon' });
      expect(logger.error).not.toHaveBeenCalled();
    }
  );
});
