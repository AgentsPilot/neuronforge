/**
 * Which plan tiers an account may buy at checkout (plan payments P-3a,
 * workplan §3.3 step 6; SA-P11, SA Q-3, Q-10).
 *
 * Pure: it takes the payment hold already read and returns the tiers. It
 * applies INVITE POLICY (FR-30: a champion's friend joins on the friend tier),
 * not a capability or a plan decision, and calls nothing in the entitlements
 * service. So it is a recorded non-gate, not an enforcement point (SA Q-10).
 *
 * - not held → every tier that has a Stripe price (`PLAN_STRIPE_PRICES`);
 * - held by a friend invite (`account_invite`) → the friend tier only,
 *   `INVITE_ISSUANCE_POLICY.account.grantId`, imported, never written here;
 * - held by an admin Paid invite (`admin_invite`) → refused until P-9 decides
 *   which tier such an invite sells (fail closed);
 * - the hold could not be read → refused (fail CLOSED here, unlike the page
 *   gate: this decides what may be bought).
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

export type PlanCheckoutEligibility =
  | { ok: true; held: boolean; tiers: readonly TierId[] }
  | { ok: false; code: 'hold_unreadable' | 'held_tier_unresolved' };

/** Every tier with a configured Stripe price, in tier order. */
export function sellableTiers(): readonly TierId[] {
  return TIER_ORDER.filter((tier) => Object.prototype.hasOwnProperty.call(PLAN_STRIPE_PRICES, tier));
}

/** The tiers this account may buy, from its payment hold. */
export function planCheckoutEligibility(hold: PaymentHold): PlanCheckoutEligibility {
  if (!hold.ok) return { ok: false, code: 'hold_unreadable' };
  if (!hold.held) return { ok: true, held: false, tiers: sellableTiers() };

  if (hold.source === 'account_invite') {
    const friendTier = INVITE_ISSUANCE_POLICY.account.grantId;
    const tiers = sellableTiers().filter((tier) => tier === friendTier);
    // A friend tier with no Stripe price would leave the friend nothing to buy:
    // refuse rather than widen to the other tiers.
    return tiers.length === 1 ? { ok: true, held: true, tiers } : { ok: false, code: 'held_tier_unresolved' };
  }

  // `admin_invite`: P-9 decides the tier an admin Paid invite sells.
  return { ok: false, code: 'held_tier_unresolved' };
}
