/**
 * The leak check's production wiring (credit deduction slice 4b, workplan §5.3).
 *
 * The ONE file that hands the real repositories to `runCreditLeakCheck`. It is
 * declared, with its reason, on two referrer guards:
 *   - the plan repository's (RC-15, `businessOsEntitlements.imports.guard`), as
 *     a READER: it calls `pagePlans` and `findEntitlementInputs`, and the guard
 *     pins that it calls no plan-state write;
 *   - the ledger read repository's importer guard.
 *
 * Every method it exposes is a read. `token_usage` is reached only through
 * `TokenUsageRepository` (CLAUDE.md rule 1), with existing methods: the
 * per-account `listCallsInWindow` and `countInWindow` for the platform
 * accounts. No new `token_usage` method, and no all-accounts `token_usage` read
 * (SA S-1).
 *
 * Server-only: every repository here holds the service-role client. The two
 * callers are the admin route (`requireAdmin` first) and the fail-closed cron.
 *
 * @module lib/business-os/credits/creditLeakCheckDeps
 */

import { businessOsAccountPlanRepository } from '@/lib/repositories/BusinessOsAccountPlanRepository';
import { businessOsCreditLedgerReadRepository } from '@/lib/repositories/BusinessOsCreditLedgerReadRepository';
import { tokenUsageRepository } from '@/lib/repositories/TokenUsageRepository';
import type { CreditLeakCheckDeps } from './creditLeakCheck';

export function creditLeakCheckDeps(): CreditLeakCheckDeps {
  return {
    async pagePlanAnchors(afterUserId, limit) {
      const { data, error } = await businessOsAccountPlanRepository.pagePlans({ afterUserId, limit });
      if (error || !data) return { data: null, error: error ?? new Error('No plan rows returned') };
      return { data: data.map((plan) => ({ user_id: plan.user_id, period_anchor: plan.period_anchor ?? null })), error: null };
    },
    async findPlanAnchor(accountId) {
      const { data, error } = await businessOsAccountPlanRepository.findEntitlementInputs(accountId);
      if (error || !data) return { data: null, error: error ?? new Error('No entitlement inputs returned') };
      return { data: { found: data.plan !== null, periodAnchor: data.plan?.period_anchor ?? null }, error: null };
    },
    listTotalsForPeriodsInRange: (range, opts) => businessOsCreditLedgerReadRepository.listTotalsForPeriodsInRange(range, opts),
    listLedgerRowsForAccount: (userId, range, opts) =>
      businessOsCreditLedgerReadRepository.listRowsForAccountCreatedInRange(userId, range, opts),
    listUsageCallsForAccount: (userId, window, filter, opts) => tokenUsageRepository.listCallsInWindow(userId, window, filter, opts),
    countPlatformCalls: (userIds, window, match) => tokenUsageRepository.countInWindow(userIds, window, match),
    now: () => new Date(),
  };
}
