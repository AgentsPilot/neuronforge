/**
 * The `purchase` part of the my-plan payload, as it travels over HTTP (plan
 * payments P-4.2; workplan §3.4; SA W-6).
 *
 * Its own file with NO import, so the Settings components can type-import it
 * without reaching into the entitlements module (registration, SR-17) or into a
 * `server-only` file. `planPurchaseView.ts` builds values of these types, and
 * the compiler checks its server-side types are assignable to them.
 *
 * Tiers are plain strings here: the screen renders what it is sent and never
 * names a tier (FR-12).
 *
 * @module lib/business-os/billing/planPurchaseTypes
 */

/** Why nothing is offered, in `planPurchaseOffer`'s order. */
export type PlanPurchaseNoneReasonWire = 'switches_off' | 'free_access_no_end_date' | 'paying' | 'not_on_sale';

/** `planPurchaseOffer`'s answer: Choose exactly these tiers, or nothing. */
export type PlanPurchaseOfferWire =
  | { kind: 'choose'; tiers: readonly string[] }
  | { kind: 'none'; reason: PlanPurchaseNoneReasonWire };

/**
 * What our own billing record says about the paid plan (F-2, SA W-5). From the
 * record only, never Stripe (SR-11):
 *
 *   renewing  status `active`, not set to cancel, not ended, period end in the future
 *   ending    status `active`, set to cancel at the period end
 *
 * Any other status (`past_due` included) is `null`: the dateless sentence
 * stays, and P-6a's banners own that state.
 */
export interface PlanPurchaseBillingWire {
  state: 'renewing' | 'ending';
  /** ISO: `current_period_end`. */
  date: string;
}

/** What free access a purchase would end today (SA W-7). */
export type EndsFreeAccessOnPurchaseWire = 'trial' | 'free_access' | null;

/**
 * What an owner who already PAYS may upgrade to now (plan payments P-7b.1b;
 * workplan §3.6; SA U-2). `planUpgradeOffer`'s answer, from our billing record
 * only: the buyable tiers above the tier the account pays for, in tier order.
 * The upgrade routes call the same predicate, so the screen shows "Upgrade"
 * exactly where the server would get past our own data. What only Stripe knows
 * (a pending update, the live item price) is checked by the routes after a
 * fresh read, and answered by code.
 */
export interface PlanUpgradeWire {
  tiers: readonly string[];
}

export interface PlanPurchaseWire {
  offer: PlanPurchaseOfferWire;
  billing: PlanPurchaseBillingWire | null;
  /** Set only when `offer.kind` is `choose`: the sentence goes beside the Choose list. */
  endsFreeAccessOnPurchase: EndsFreeAccessOnPurchaseWire;
  /** P-7b.1b: `null` unless `planUpgradeOffer` answers `upgrade`. */
  upgrade: PlanUpgradeWire | null;
}
