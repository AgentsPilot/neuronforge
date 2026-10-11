/**
 * The production wiring of the admin credit-position pass (credit deduction
 * slice 8a, SA SQ-42, SQ-43; finance & business health slice 1b, SA-W13).
 *
 * Declared, with its reason, on the plan repository's referrer guard (RC-15,
 * `businessOsEntitlements.imports.guard`) as a READER: it calls
 * `findPeriodAnchorsBatch` and nothing else, and that guard pins that it calls
 * no plan-state write.
 *
 * ── SERVICE ROLE (intentional RLS bypass, documented per CLAUDE.md) ─────────
 * Both reads run as the service role, because they read OTHER accounts'
 * figures for an admin page — no owner RLS client can:
 *   - the plan anchors (`findPeriodAnchorsBatch`): the plan table has no owner
 *     policy by design;
 *   - the credit totals (`listTotalsForAccountsInRange`): `user_id`,
 *     `period_start`, `credits_total` only — no cost column.
 * Two callers, each after `requireAdmin`, and the account ids never come from
 * raw request input:
 *   - `GET /api/admin/users` (the "Credits left" column): ids built from that
 *     route's own profile list;
 *   - `GET /api/admin/business-os/finance` (the credits section), through
 *     `lib/business-os/finance/financeHealthDeps.ts` (SA-W13): ids from that
 *     route's own plan walk, or the one picked business, validated as a UUID
 *     and checked against the plan table before any read.
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
