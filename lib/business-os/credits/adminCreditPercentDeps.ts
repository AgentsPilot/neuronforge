/**
 * The admin "Credits left" column's production wiring (credit deduction slice
 * 8a, SA SQ-42, SQ-43).
 *
 * Declared, with its reason, on the plan repository's referrer guard (RC-15,
 * `businessOsEntitlements.imports.guard`) as a READER: it calls
 * `findPeriodAnchorsBatch` and nothing else, and that guard pins that it calls
 * no plan-state write.
 *
 * ── SERVICE ROLE (intentional RLS bypass, documented per CLAUDE.md) ─────────
 * Both reads run as the service role, because they read OTHER accounts'
 * figures for the admin list — no owner RLS client can:
 *   - the plan anchors (`findPeriodAnchorsBatch`): the plan table has no owner
 *     policy by design;
 *   - the credit totals (`listTotalsForAccountsInRange`): `user_id`,
 *     `period_start`, `credits_total` only — no cost column.
 * The one caller is `GET /api/admin/users`, after `requireAdmin`, and the
 * account ids are built from that route's own profile list, never from the
 * request.
 *
 * @module lib/business-os/credits/adminCreditPercentDeps
 */

import 'server-only';

import { businessOsAccountPlanRepository } from '@/lib/repositories/BusinessOsAccountPlanRepository';
import { businessOsCreditLedgerReadRepository } from '@/lib/repositories/BusinessOsCreditLedgerReadRepository';
import type { AdminCreditPercentDeps } from './adminCreditPercent';

export function adminCreditPercentDeps(): AdminCreditPercentDeps {
  return {
    findPeriodAnchorsBatch: (accountIds) => businessOsAccountPlanRepository.findPeriodAnchorsBatch(accountIds),
    listTotalsForAccountsInRange: (accountIds, range, opts) =>
      businessOsCreditLedgerReadRepository.listTotalsForAccountsInRange(accountIds, range, opts),
  };
}
