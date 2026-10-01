/**
 * The owner credit card's production wiring (credit deduction slice 6a, SA W6-1).
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
 * The LEDGER is read with the caller's RLS client, never the service role.
 *
 * Server-only. The one caller is `GET /api/business-os/usage`.
 *
 * @module lib/business-os/credits/ownerCreditUsageDeps
 */

import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { businessOsAccountPlanRepository } from '@/lib/repositories/BusinessOsAccountPlanRepository';
import { businessOsCreditPeriodRepository } from '@/lib/repositories/BusinessOsCreditPeriodRepository';
import { BusinessOsCreditOwnerReadRepository } from '@/lib/repositories/BusinessOsCreditOwnerReadRepository';
import type { OwnerCreditUsageDeps } from './ownerCreditUsage';

export function ownerCreditUsageDeps(ownerClient: SupabaseClient): OwnerCreditUsageDeps {
  return {
    findPeriodAnchor: (accountId) => businessOsAccountPlanRepository.findPeriodAnchor(accountId),
    periodStartFor: (anchor, at) => businessOsCreditPeriodRepository.periodStartFor(anchor, at),
    owner: new BusinessOsCreditOwnerReadRepository(ownerClient),
  };
}
