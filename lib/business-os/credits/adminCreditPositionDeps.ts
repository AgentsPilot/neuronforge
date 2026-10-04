/**
 * The admin per-account credit view's production wiring (credit deduction
 * slice 11c, SA S11-SQ-9, OP-25, W11c-5).
 *
 * ── SERVICE ROLE (intentional RLS bypass, documented per CLAUDE.md) ─────────
 * Every read here runs as the service role, on purpose: an admin reads ANOTHER
 * account's credits, and no RLS policy lets one user read another's ledger.
 * What makes it safe:
 *   - the ONLY caller is `GET /api/admin/business-os/credits/accounts/[accountId]`
 *     (a source guard in `__tests__/creditPosition.test.ts` pins that, SA
 *     W11c-2), which passes the canonical URL path id only after
 *     `requireAdmin`, Zod, the platform check and the tenant check. No body is
 *     read and the query string is ignored;
 *   - every repository read is keyed by that id and adds
 *     `.eq('user_id', accountId)`: the owner read repository on every method
 *     (it refuses a non-UUID first), the lot repository on both its reads, the
 *     plan anchor by the same id. On this path RLS is no longer defence in
 *     depth, so the `.eq` is the only line; the route test proves every call
 *     receives exactly the path id (W11c-5);
 *   - the owner read repository selects owner-granted columns only, so no cost
 *     column can reach the admin payload this way.
 *
 * Not `ownerCreditUsageDeps(supabaseServer)`: that file's header promises the
 * caller's RLS client, and this is the one documented exception.
 *
 * Reads only. It calls no `.rpc(`, no lot write and no plan-state write (SA
 * W11c-16); the plan repository's referrer guard pins `findPeriodAnchor` as
 * its one method. Imports nothing from the entitlements module, type-only
 * included (SA W11c-4).
 *
 * @module lib/business-os/credits/adminCreditPositionDeps
 */

import 'server-only';

import { supabaseServer } from '@/lib/supabaseServer';
import { businessOsAccountPlanRepository } from '@/lib/repositories/BusinessOsAccountPlanRepository';
import { businessOsCreditPeriodRepository } from '@/lib/repositories/BusinessOsCreditPeriodRepository';
import { BusinessOsCreditOwnerReadRepository } from '@/lib/repositories/BusinessOsCreditOwnerReadRepository';
import {
  businessOsCreditLotRepository,
  type BusinessOsCreditLotRepository,
} from '@/lib/repositories/BusinessOsCreditLotRepository';
import type { OwnerCreditUsageDeps } from './ownerCreditUsage';

/** What the admin credit view reads: the owner card's deps, plus the account's lots. */
export interface AdminCreditPositionDeps extends OwnerCreditUsageDeps {
  /** Read only: `listLotsWithDraws`, never a write. */
  lots: Pick<BusinessOsCreditLotRepository, 'listLotsWithDraws'>;
}

export function adminCreditPositionDeps(): AdminCreditPositionDeps {
  return {
    findPeriodAnchor: (accountId) => businessOsAccountPlanRepository.findPeriodAnchor(accountId),
    periodStartFor: (anchor, at) => businessOsCreditPeriodRepository.periodStartFor(anchor, at),
    // The one sanctioned service-role construction of the owner read repository.
    owner: new BusinessOsCreditOwnerReadRepository(supabaseServer),
    lots: { listLotsWithDraws: (accountId) => businessOsCreditLotRepository.listLotsWithDraws(accountId) },
  };
}
