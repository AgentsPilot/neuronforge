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
 * - not held → no tier list here. What a non-held account may buy is decided
 *   by `planPurchaseOffer` (P-4.1, M-1), evaluated by the checkout ONCE, after
 *   every database read and before any Stripe call (SA W-1);
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
 * `planPurchaseOffer` (P-4.1) is its twin for an account that is NOT held: the
 * checkout uses it now, and the Settings → Plan view (P-4.2) will use the same
 * function, so Choose is offered exactly when the server would sell. It reads
 * our own data only (SA W-2): the switches, `availableToBuy` from the tier
 * matrix's presentation block, the free-access fact (BQ-P10,
 * `hasOpenEndedFreeAccess`) and whether our billing record shows a live
 * subscription. It refuses a SALE, never a capability: nothing here calls
 * `check()` / `decide()` or withholds a feature by plan.
 *
 * `planUpgradeOffer` (P-7b.1a, workplan §3.1, SA U-2) is the third twin, for
 * an account that already PAYS: whether "Upgrade" is offered and admitted,
 * from our billing record only. The my-plan view (P-7b.1b) and both upgrade
 * routes call it; what our record cannot know (a pending update, the live
 * item price, Stripe's status now) is checked by the routes after a fresh
 * Stripe read (`planUpgradeEligibility`, planUpgrade.ts). It refuses a SALE,
 * never a capability.
 *
 * No tier name is written in this file: tiers come from the config.
 *
 * @module lib/business-os/billing/planCheckoutEligibility
 */

import { INVITE_ISSUANCE_POLICY } from '@/lib/business-os/entitlements/config/invites';
import { PLAN_STRIPE_PRICES } from '@/lib/business-os/entitlements/config/planPrices';
import { TIER_MATRIX, TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';
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

/**
 * The hold's answer. A held account gets its tier list here (step 6); a
 * non-held account gets none, because `planPurchaseOffer` decides its tiers
 * after every database read (SA W-1).
 */
export type PlanCheckoutEligibility =
  | { ok: true; held: true; tiers: readonly TierId[] }
  | { ok: true; held: false }
  | { ok: false; code: 'hold_unreadable' | HeldPaymentUnavailableCode };

/** Every tier with a configured Stripe price, in tier order. */
export function sellableTiers(): readonly TierId[] {
  return TIER_ORDER.filter((tier) => Object.prototype.hasOwnProperty.call(PLAN_STRIPE_PRICES, tier));
}

/**
 * Every tier a customer may buy (M-1): it has a Stripe price AND its
 * `presentation.availableToBuy` is on, in tier order. From config only.
 */
export function buyableTiers(): readonly TierId[] {
  return sellableTiers().filter((tier) => TIER_MATRIX.presentation[tier].availableToBuy);
}

/**
 * The facts `planPurchaseOffer` decides from: our own data only (SA W-2), never
 * a Stripe call, so the my-plan view (which may make none, SR-11) can supply
 * every one of them.
 */
export interface PlanPurchaseFacts {
  /** BQ-P10: `hasOpenEndedFreeAccess(snapshot.resolution)`. */
  openEndedFreeAccess: boolean;
  /**
   * Our billing record shows a live subscription: its status is in
   * `LIVE_SUBSCRIPTION_STATUSES` (planCheckout.ts, the set step 9 refuses on).
   * Passed as a fact rather than a status so this file need not import
   * planCheckout.ts, which imports this one.
   */
  subscriptionLive: boolean;
}

/** The two switches a non-held purchase needs; `paidInvitesAvailable` is ignored (held only). */
export type PlanPurchaseSwitches = Pick<HeldPaymentSwitches, 'checkoutEnabled' | 'pricesEnabled'>;

export type PlanPurchaseNoneReason = 'switches_off' | 'free_access_no_end_date' | 'paying' | 'not_on_sale';

export type PlanPurchaseOffer = { kind: 'choose'; tiers: readonly TierId[] } | { kind: 'none'; reason: PlanPurchaseNoneReason };

/**
 * What an account that is NOT held may buy (P-4.1, M-1, BQ-P10). Pure. The
 * checkout admits a non-held account for tier X exactly when this says
 * `choose` with X; the Settings view (P-4.2) offers Choose on exactly the same
 * answer. First reason wins, in this order:
 *
 *   switches_off             checkout or price recognition off: nothing is sold
 *   free_access_no_end_date  BQ-P10: refuse until an admin sets an end date
 *   paying                   a live subscription on our record (SR-5 layer 1)
 *   not_on_sale              no tier has a Stripe price and `availableToBuy` on
 *
 * `buyable` is injectable for tests; production reads `buyableTiers()`.
 */
export function planPurchaseOffer(
  facts: PlanPurchaseFacts,
  switches: PlanPurchaseSwitches,
  buyable: readonly TierId[] = buyableTiers()
): PlanPurchaseOffer {
  if (!switches.checkoutEnabled || !switches.pricesEnabled) return { kind: 'none', reason: 'switches_off' };
  if (facts.openEndedFreeAccess) return { kind: 'none', reason: 'free_access_no_end_date' };
  if (facts.subscriptionLive) return { kind: 'none', reason: 'paying' };
  if (buyable.length === 0) return { kind: 'none', reason: 'not_on_sale' };
  return { kind: 'choose', tiers: buyable };
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

/**
 * Step 6: the payment hold's answer. A held account's tiers come from
 * `heldPaymentOffer`; a non-held account is passed on to `planPurchaseOffer`
 * after every read (SA W-1).
 */
export function planCheckoutEligibility(hold: PaymentHold, switches: HeldPaymentSwitches): PlanCheckoutEligibility {
  if (!hold.ok) return { ok: false, code: 'hold_unreadable' };
  if (!hold.held) return { ok: true, held: false };

  const offer = heldPaymentOffer(hold, switches);
  return offer.kind === 'pay' ? { ok: true, held: true, tiers: [offer.tier] } : { ok: false, code: offer.code };
}

// ── Upgrade (plan payments P-7b.1a, workplan §3.1; SA U-2) ─────────────────

/**
 * The facts `planUpgradeOffer` decides from: OUR billing row only (SR-11, the
 * view may make no Stripe call). The plan row's tier is deliberately NOT an
 * input (U-2): an admin override may differ from what Stripe bills.
 */
export interface PlanUpgradeFacts {
  /** The tier the account pays for (`business_os_billing_accounts.bought_tier`). */
  boughtTier: string | null;
  subscriptionId: string | null;
  subscriptionStatus: string | null;
  cancelAtPeriodEnd: boolean;
  endedAt: string | null;
}

export type PlanUpgradeNoneReason = 'switches_off' | 'not_subscribed' | 'not_active' | 'cancelling' | 'top_tier' | 'not_on_sale';

export type PlanUpgradeOffer =
  | { kind: 'upgrade'; from: TierId; tiers: readonly TierId[] }
  | { kind: 'none'; reason: PlanUpgradeNoneReason };

/**
 * Whether an owner who pays may upgrade, and to which tiers (pure). First
 * reason wins, in this order:
 *
 *   switches_off   checkout or price recognition off: nothing is sold
 *   not_subscribed no billing row, no `boughtTier` (a held account has none:
 *                  its first paid invoice is what releases it), a
 *                  `boughtTier` the config does not know, or no subscription
 *                  id, so an upgrade never races the first payment
 *   not_active     our record's status is not `active`, or it ended
 *   cancelling     set to cancel at the period end
 *   top_tier       no tier above `boughtTier` in `TIER_ORDER`
 *   not_on_sale    none of the tiers above it is buyable (`buyableTiers()`)
 *
 * `tiers` lists the buyable tiers ABOVE `boughtTier`, in tier order.
 * `buyable` is injectable for tests; production reads `buyableTiers()`.
 */
export function planUpgradeOffer(
  facts: PlanUpgradeFacts | null,
  switches: PlanPurchaseSwitches,
  buyable: readonly TierId[] = buyableTiers()
): PlanUpgradeOffer {
  if (!switches.checkoutEnabled || !switches.pricesEnabled) return { kind: 'none', reason: 'switches_off' };
  const from = facts ? TIER_ORDER.find((tier) => tier === facts.boughtTier) : undefined;
  if (!facts || !from || !facts.subscriptionId) return { kind: 'none', reason: 'not_subscribed' };
  if (facts.subscriptionStatus !== 'active' || facts.endedAt !== null) return { kind: 'none', reason: 'not_active' };
  if (facts.cancelAtPeriodEnd) return { kind: 'none', reason: 'cancelling' };
  const above = TIER_ORDER.slice(TIER_ORDER.indexOf(from) + 1);
  if (above.length === 0) return { kind: 'none', reason: 'top_tier' };
  const tiers = above.filter((tier) => buyable.includes(tier));
  if (tiers.length === 0) return { kind: 'none', reason: 'not_on_sale' };
  return { kind: 'upgrade', from, tiers };
}
