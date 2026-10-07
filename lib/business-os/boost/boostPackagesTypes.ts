/**
 * What the owner's package picker receives (credits boost slice 5a).
 *
 * Types only, and client-safe: nothing here imports the entitlements module
 * (SA C-2). The label type is declared here rather than borrowed from
 * `entitlements/types`, so this file is not an entitlements importer.
 *
 * @module lib/business-os/boost/boostPackagesTypes
 */

/** One text in the three product languages. English may fill all three (FR-1). */
export interface BoostLabels {
  en: string;
  he: string;
  es: string;
}

/**
 * One package as the owner sees it. Every figure comes from the catalogue,
 * already derived there (FR-2, FR-42); nothing here is typed by hand.
 * Internal fields (`active`, `retailVersion`, `creditValueVersion`) are never
 * sent (SA C-4).
 */
export interface BoostPackageView {
  id: string;
  version: number;
  order: number;
  priceMinor: number;
  currency: 'USD';
  taxExclusive: true;
  baseCredits: number;
  bonusCredits: number;
  totalCredits: number;
  /** The catalogue's computed bonus % (FR-42). */
  bonusPercent: number;
  labels: { name: BoostLabels; description: BoostLabels; badge: BoostLabels | null };
}

export interface BoostPackagesPayload {
  packages: BoostPackageView[];
  /**
   * Always `false` in slice 5a: there is no purchase flow yet. Slice 5b sets it
   * on the server from the purchase route's own per-account access check, and
   * that route's switch stays the authority whatever the UI shows (SA C-3; the
   * exact call is recorded in the slice 5a workplan §9).
   */
  purchaseAvailable: boolean;
}
