/**
 * The admin finance page's production wiring (finance & business health slice
 * 1a). The ONE file that hands the real reads to `buildFinanceHealth`.
 *
 * Every method it exposes is a read:
 *   - the plan repository: `pagePlans` (all businesses) and
 *     `findEntitlementInputs` (one business) and nothing else (pinned by the
 *     RC-15 guard). `findEntitlementInputs` embeds the account's override rows,
 *     which carry admin-written `reason` text: they are DROPPED HERE, and only
 *     `{ plan }` travels on (SA-WR-1), so they can never reach the builder, the
 *     response or a log;
 *   - the ledger read repository: the all-accounts and one-account reads by
 *     time, and the charges by action id (declared on its importer guard);
 *   - the finance read repository: live billing status and revenue head counts.
 *
 * The admin-pinned name read (`findAdminIdentitiesByUserIds`) is NOT wired
 * here: it may be called only from `app/api/admin/**`, so the route injects it.
 *
 * Server-only: the repositories hold the service-role client. The one caller is
 * the admin route, which runs `requireAdmin` first.
 *
 * @module lib/business-os/finance/financeHealthDeps
 */

import 'server-only';

import { businessOsAccountPlanRepository } from '@/lib/repositories/BusinessOsAccountPlanRepository';
import { businessOsCreditLedgerReadRepository } from '@/lib/repositories/BusinessOsCreditLedgerReadRepository';
import { businessOsFinanceReadRepository } from '@/lib/repositories/BusinessOsFinanceReadRepository';
import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';
import { isPlatformAccount } from '@/lib/business-os/llm/callCatalog';
import type { FinanceHealthDeps } from './financeHealth';

/** The plan row of one account, its override rows dropped (SA-WR-1). */
export async function findPlanWithoutOverrides(
  accountId: string
): ReturnType<FinanceHealthDeps['findPlanForAccount']> {
  const result = await businessOsAccountPlanRepository.findEntitlementInputs(accountId);
  if (result.error || !result.data) return { data: null, error: result.error ?? new Error('Plan read returned no data') };
  // Only the plan crosses this line; `result.data.overrides` is never read.
  return { data: { plan: result.data.plan }, error: null };
}

/** Everything but the admin-pinned name read, which the route supplies. */
export function financeHealthDeps(): Omit<FinanceHealthDeps, 'findNames'> {
  return {
    plans: {
      pagePlans: (options) => businessOsAccountPlanRepository.pagePlans(options),
    },
    findPlanForAccount: findPlanWithoutOverrides,
    ledger: {
      listRowsOfAllAccountsCreatedInRange: (range, opts) =>
        businessOsCreditLedgerReadRepository.listRowsOfAllAccountsCreatedInRange(range, opts),
      listRowsForAccountCreatedInRange: (accountId, range, opts) =>
        businessOsCreditLedgerReadRepository.listRowsForAccountCreatedInRange(accountId, range, opts),
      findChargesByActionIds: (actionIds) => businessOsCreditLedgerReadRepository.findChargesByActionIds(actionIds),
    },
    finance: {
      listLiveBillingStatusesAllAccounts: (opts) => businessOsFinanceReadRepository.listLiveBillingStatusesAllAccounts(opts),
      findLiveBillingStatusForAccount: (accountId) => businessOsFinanceReadRepository.findLiveBillingStatusForAccount(accountId),
      countLiveRevenueRows: () => businessOsFinanceReadRepository.countLiveRevenueRows(),
    },
    // SA-WR-4: the classifier takes the config as a parameter; this is where it is read.
    config: getEntitlementConfig(),
    isPlatformAccount,
  };
}
