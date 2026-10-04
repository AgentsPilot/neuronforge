/**
 * The owner credit surfaces' production wiring (credit deduction slice 6a,
 * SA W6-1; the credit history joined in slice 7a).
 *
 * The ONE file that names the entitlement plan repository for the card. It is
 * declared, with its reason, on the plan repository's referrer guard (RC-15,
 * `businessOsEntitlements.imports.guard`) as a READER: it calls
 * `findPeriodAnchor` and nothing else, and that guard pins that it calls no
 * plan-state write.
 *
 * What runs as the service role here, and why each is safe:
 *   - the plan anchor (`findPeriodAnchor`): the plan table has no owner
 *     policy by design; the account id is the session's, resolved by the
 *     caller through the account seam;
 *   - the period function: pure date arithmetic that reads no table.
 * The LEDGER, and since slice 11d the owner's credit lots, are read with the
 * caller's RLS client, never the service role.
 *
 * Server-only. Two callers: `GET /api/business-os/usage` (the card,
 * `ownerCreditUsageDeps`) and `GET /api/business-os/credits/history` (the
 * credit history, `ownerCreditHistoryDeps`, slice 7a). The history adds the
 * same owner repository instance for its ledger-row reads — RLS client, no
 * service role.
 *
 * @module lib/business-os/credits/ownerCreditUsageDeps
 */

import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { businessOsAccountPlanRepository } from '@/lib/repositories/BusinessOsAccountPlanRepository';
import { businessOsCreditPeriodRepository } from '@/lib/repositories/BusinessOsCreditPeriodRepository';
import { BusinessOsCreditOwnerReadRepository } from '@/lib/repositories/BusinessOsCreditOwnerReadRepository';
import type { OwnerCreditHistoryDeps } from './ownerCreditHistory';
import type { OwnerCreditCardDeps } from './ownerCreditUsage';

/** The card's wiring. Since slice 11d its owner repository also serves the lot read (same RLS client). */
export function ownerCreditUsageDeps(ownerClient: SupabaseClient): OwnerCreditCardDeps {
  return {
    findPeriodAnchor: (accountId) => businessOsAccountPlanRepository.findPeriodAnchor(accountId),
    periodStartFor: (anchor, at) => businessOsCreditPeriodRepository.periodStartFor(anchor, at),
    owner: new BusinessOsCreditOwnerReadRepository(ownerClient),
  };
}

/** The credit history's wiring: the card's, plus the same owner repository for the ledger rows. */
export function ownerCreditHistoryDeps(ownerClient: SupabaseClient): OwnerCreditHistoryDeps {
  const owner = new BusinessOsCreditOwnerReadRepository(ownerClient);
  return { ...ownerCreditUsageDeps(ownerClient), owner, ledger: owner };
}
