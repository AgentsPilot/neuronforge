/**
 * A catalogue package, reduced to what the owner's picker shows (credits boost
 * slice 5a; SA C-4).
 *
 * Every field is picked by name, never spread, so a field added to
 * `BoostPackage` later cannot reach the browser by accident. Figures are copied
 * from the catalogue as-is: the bonus % is the catalogue's computed one
 * (FR-42), never recomputed or typed here.
 *
 * Pure: no I/O, no logging.
 *
 * @module lib/business-os/boost/boostPackagesView
 */

import type { BoostPackage } from '@/lib/business-os/entitlements/boostCatalogue';
import type { BoostLabels, BoostPackageView } from '@/lib/business-os/boost/boostPackagesTypes';

const labels = (source: { en: string; he: string; es: string }): BoostLabels => ({
  en: source.en,
  he: source.he,
  es: source.es,
});

export function toBoostPackageView(pkg: BoostPackage): BoostPackageView {
  return {
    id: pkg.id,
    version: pkg.version,
    order: pkg.order,
    priceMinor: pkg.priceMinor,
    currency: pkg.currency,
    taxExclusive: pkg.taxExclusive,
    baseCredits: pkg.baseCredits,
    bonusCredits: pkg.bonusCredits,
    totalCredits: pkg.totalCredits,
    bonusPercent: pkg.bonusPercent,
    labels: {
      name: labels(pkg.labels.name),
      description: labels(pkg.labels.description),
      badge: pkg.labels.badge ? labels(pkg.labels.badge) : null,
    },
  };
}
