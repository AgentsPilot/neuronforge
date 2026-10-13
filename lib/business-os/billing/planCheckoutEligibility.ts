/**
 * Which plan tiers an account may buy at checkout (plan payments P-3a,
 * workplan §3.3 step 6; SA-P11, SA Q-3, Q-10).
 *
 * Pure except `readHeldPaymentSwitches` (P-5a.2, SA W-9): it takes the payment
 * hold already read, and the switches already read, and returns the tiers. It
 * applies INVITE POLICY (FR-30: a champion's friend joins on the friend tier),
 * not a capability or a plan decision, and calls nothing in the entitlements
 * service. So it is a recorded non-gate, not an enforcement point (SA Q-10).
 *
 * - not held → every tier that has a Stripe price (`PLAN_STRIPE_PRICES`),
 *   whatever the held-payment switches say;
 * - held → `heldPaymentOffer` decides (P-5a.2, SA S5-1, S5-2, P5-C5):
 *   - any of the three switches off (checkout, price recognition,
 *     `INVITE_ISSUANCE_POLICY.paidInvitesAvailable`) → refused,
 *     `held_payment_unavailable` (D5-3: never offer what the server refuses);
 *   - held by a friend invite (`account_invite`) → the friend tier only,
 *     `INVITE_ISSUANCE_POLICY.account.grantId`, imported, never written here;
 *   - held by an admin Paid invite (`admin_invite`) → refused until P-9
 *     decides which tier such an invite sells (fail closed);
 * - the hold could not be read → refused (fail CLOSED here, unlike the page
 *   gate: this decides what may be bought).
 *
 * `heldPaymentOffer` is the ONE predicate behind both the holding screen's Pay
 * button (`heldPaymentView.ts`) and the held checkout, so the screen can never
 * offer a payment the server would refuse. Neither re-derives any part of it.
 *
 * No tier name is written in this file: tiers come from the config.
 *
 * @module lib/business-os/billing/planCheckoutEligibility
 */

import { INVITE_ISSUANCE_POLICY } from '@/lib/business-os/entitlements/config/invites';
import { PLAN_STRIPE_PRICES } from '@/lib/business-os/entitlements/config/planPrices';
import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';
import type { TierId } from '@/lib/business-os/entitlements/config/tierMatrix';
import type { PaymentHold } from '@/lib/business-os/invites/paymentHold';
import { isPlanCheckoutEnabled } from '@/lib/business-os/billing/planCheckoutFlag';
import { isPlanPriceRecognitionEnabled } from '@/lib/business-os/billing/planPricesFlag';

/** A held account's hold: the only input `heldPaymentOffer` accepts. */
export type HeldPaymentHold = Extract<PaymentHold, { ok: true; held: true }>;

/** The three switches a held account's payment needs, all on (S5-1, S5-2, D5-3). */
export interface HeldPaymentSwitches {
  /** `isPlanCheckoutEnabled()`: off, the checkout route answers 404. */
  checkoutEnabled: boolean;
  /** `isPlanPriceRecognitionEnabled()`: off, the checkout refuses at step 4. */
  pricesEnabled: boolean;
  /** `INVITE_ISSUANCE_POLICY.paidInvitesAvailable`: off, a held account is refused here. */
  paidInvitesAvailable: boolean;
}

export type HeldPaymentUnavailableCode = 'held_payment_unavailable' | 'held_tier_unresolved';

export type HeldPaymentOffer = { kind: 'pay'; tier: TierId } | { kind: 'unavailable'; code: HeldPaymentUnavailableCode };

export type PlanCheckoutEligibility =
  | { ok: true; held: boolean; tiers: readonly TierId[] }
  | { ok: false; code: 'hold_unreadable' | HeldPaymentUnavailableCode };

/** Every tier with a configured Stripe price, in tier order. */
export function sellableTiers(): readonly TierId[] {
  return TIER_ORDER.filter((tier) => Object.prototype.hasOwnProperty.call(PLAN_STRIPE_PRICES, tier));
}

/**
 * The one reader of the three switches, used by the checkout (step 6) and the
 * holding screen. The two environment switches come from their own flag
 * modules, never through `planCheckout.ts` (SA W-9). Injectable at both call
 * sites, so tests cover every combination without editing the constant.
 */
export function readHeldPaymentSwitches(): HeldPaymentSwitches {
  return {
    checkoutEnabled: isPlanCheckoutEnabled(),
    pricesEnabled: isPlanPriceRecognitionEnabled(),
    paidInvitesAvailable: INVITE_ISSUANCE_POLICY.paidInvitesAvailable,
  };
}

/**
 * What a HELD account may pay for (S5-2). Pure. The holding screen offers Pay
 * exactly when this says `pay`, and the checkout admits a held account exactly
 * when this says `pay` (P5-C5).
 */
export function heldPaymentOffer(hold: HeldPaymentHold, switches: HeldPaymentSwitches): HeldPaymentOffer {
  // D5-3: all three, or nothing is offered and nothing is sold.
  if (!switches.checkoutEnabled || !switches.pricesEnabled || !switches.paidInvitesAvailable) {
    return { kind: 'unavailable', code: 'held_payment_unavailable' };
  }

  if (hold.source === 'account_invite') {
    const friendTier = INVITE_ISSUANCE_POLICY.account.grantId;
    // A friend tier with no Stripe price would leave the friend nothing to buy:
    // refuse rather than widen to the other tiers.
    const tier = sellableTiers().find((candidate) => candidate === friendTier);
    return tier ? { kind: 'pay', tier } : { kind: 'unavailable', code: 'held_tier_unresolved' };
  }

  // `admin_invite`: P-9 decides the tier an admin Paid invite sells.
  return { kind: 'unavailable', code: 'held_tier_unresolved' };
}

/** The tiers this account may buy, from its payment hold and the held-payment switches. */
export function planCheckoutEligibility(hold: PaymentHold, switches: HeldPaymentSwitches): PlanCheckoutEligibility {
  if (!hold.ok) return { ok: false, code: 'hold_unreadable' };
  if (!hold.held) return { ok: true, held: false, tiers: sellableTiers() };

  const offer = heldPaymentOffer(hold, switches);
  return offer.kind === 'pay' ? { ok: true, held: true, tiers: [offer.tier] } : { ok: false, code: offer.code };
}
