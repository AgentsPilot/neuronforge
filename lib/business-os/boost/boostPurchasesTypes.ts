/**
 * What the owner sees about one boost purchase (credits boost slice 5b; FR-11,
 * FR-26, BQ-B1; SA C-1, C-3). Types only and client-safe: nothing here imports
 * the entitlements module or a repository.
 *
 * @module lib/business-os/boost/boostPurchasesTypes
 */

import type { BoostLabels } from '@/lib/business-os/boost/boostPackagesTypes';

/**
 * The owner-facing status. Internal states are folded so the owner never reads
 * an operator code: `pending` → processing, `paid` → credited, `abandoned` →
 * expired, any flag or OPEN dispute → under review, a LOST dispute → reversed
 * (user decision BQ-1, 2026-10-08: "under review" forever is not true once the
 * bank has decided).
 */
export const BOOST_PURCHASE_OWNER_STATUSES = [
  'processing',
  'awaiting_payment',
  'credited',
  'failed',
  'expired',
  'under_review',
  'reversed',
  'refunded',
  'partially_refunded',
] as const;
export type BoostPurchaseOwnerStatus = (typeof BOOST_PURCHASE_OWNER_STATUSES)[number];

/** One purchase, owner-safe: no Stripe id, session id, flag reason, mode or lot id (SA C-3). */
export interface BoostPurchaseView {
  id: string;
  createdAt: string;
  paidAt: string | null;
  packageId: string;
  /** The package's name in the three languages; null for a package no longer sold. */
  name: BoostLabels | null;
  creditsTotal: number;
  creditsBonus: number;
  priceMinor: number;
  currency: string;
  taxExclusive: true;
  status: BoostPurchaseOwnerStatus;
  /** Stripe's receipt link (https only), once recorded. */
  receiptUrl: string | null;
  /** Bought, as opposed to granted (BQ-B1). */
  kind: 'bought';
}
