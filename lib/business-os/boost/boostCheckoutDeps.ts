import 'server-only';

/**
 * Production wiring for the boost checkout (credits boost slice 3, workplan
 * §3.2). Kept apart from `boostCheckout.ts` so the orchestrator stays free of
 * singletons and environment reads, and the tests inject fakes.
 *
 * It imports the catalogue loader and the default cap from the entitlements
 * module. That is a registered NON-GATE import (`KNOWN_NON_GATE_IMPORTERS`,
 * SA C-7 of slice 1): the checkout refuses by catalogue validity and by the
 * cap, never by plan or capability.
 *
 * @module lib/business-os/boost/boostCheckoutDeps
 */

import { getBusinessOsStripeClient } from '@/lib/business-os/billing/stripeClient';
import { currentStripeMode } from '@/lib/business-os/billing/stripeMode';
import { codeBoostPackageSource } from '@/lib/business-os/entitlements/boostCatalogue';
import { BOOST_PURCHASE_CAP_DEFAULT } from '@/lib/business-os/entitlements/config/boostPackages';
import { businessOsAccountLineageRepository } from '@/lib/repositories/BusinessOsAccountLineageRepository';
import { businessOsBoostPurchaseRepository } from '@/lib/repositories/BusinessOsBoostPurchaseRepository';
import { businessOsInviteRepository } from '@/lib/repositories/BusinessOsInviteRepository';

import type { BoostCheckoutDeps } from './boostCheckout';

export function boostCheckoutDeps(): BoostCheckoutDeps {
  return {
    holdReaders: { lineage: businessOsAccountLineageRepository, invites: businessOsInviteRepository },
    packageSource: codeBoostPackageSource(),
    cap: BOOST_PURCHASE_CAP_DEFAULT,
    repo: businessOsBoostPurchaseRepository,
    stripe: getBusinessOsStripeClient,
    mode: currentStripeMode,
    now: () => new Date(),
  };
}
