/**
 * A purchase row reduced to the owner's view (credits boost slice 5b; SA C-3).
 *
 * Fields are picked by name, never spread, so a column added to the row can
 * never reach the browser by accident. Pure: no I/O, no logging.
 *
 * @module lib/business-os/boost/boostPurchasesView
 */

import type { BusinessOsBoostPurchase, BusinessOsBoostPurchaseStatus } from '@/lib/repositories/BusinessOsBoostPurchaseRepository';
import type { BoostLabels } from '@/lib/business-os/boost/boostPackagesTypes';
import type { BoostPurchaseOwnerStatus, BoostPurchaseView } from '@/lib/business-os/boost/boostPurchasesTypes';

const OWNER_STATUS: Readonly<Record<BusinessOsBoostPurchaseStatus, BoostPurchaseOwnerStatus>> = {
  pending: 'processing',
  awaiting_payment: 'awaiting_payment',
  paid: 'credited',
  failed: 'failed',
  expired: 'expired',
  abandoned: 'expired',
  flagged_mismatch: 'under_review',
  disputed: 'under_review',
  dispute_lost: 'under_review',
  refunded: 'refunded',
  partially_refunded: 'partially_refunded',
};

export function boostPurchaseOwnerStatus(status: BusinessOsBoostPurchaseStatus): BoostPurchaseOwnerStatus {
  return OWNER_STATUS[status];
}

/** `names`: package id → its labels, from the active catalogue; a retired package has none. */
export function toBoostPurchaseView(row: BusinessOsBoostPurchase, names: ReadonlyMap<string, BoostLabels>): BoostPurchaseView {
  const name = names.get(row.packageId);
  return {
    id: row.id,
    createdAt: row.createdAt,
    paidAt: row.paidAt,
    packageId: row.packageId,
    name: name ? { en: name.en, he: name.he, es: name.es } : null,
    creditsTotal: row.creditsTotal,
    creditsBonus: row.creditsBonus,
    priceMinor: row.priceMinor,
    currency: row.currency,
    taxExclusive: true,
    status: boostPurchaseOwnerStatus(row.status),
    receiptUrl: typeof row.receiptUrl === 'string' && row.receiptUrl.startsWith('https://') ? row.receiptUrl : null,
    kind: 'bought',
  };
}
