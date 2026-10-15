/**
 * The admin finance page's production wiring (finance & business health slices
 * 1a and 1b). The ONE file that hands the real reads to `buildFinanceHealth`.
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
 *   - the finance read repository: billing status and revenue head counts,
 *     the client payments and refunds (layer B, slice 2a), and the overdue
 *     invoices and instalments, and client plans (layer B, slice 2b), and the
 *     boost purchases paid in the window (layer A, slice 4a), and the paid
 *     plan invoices in the window (layer A, slice 5a): the
 *     named all-accounts reads only when no business is picked, the
 *     account-scoped ones with exactly the picked id (the builder chooses);
 *   - slice 1b, the credit-position pass: `adminCreditPercentDeps()`, the
 *     Businesses list's own wiring (SA-W13), so this file names neither of the
 *     pass's repository methods. It sets no `getSnapshots`: in production the
 *     pass reads the real entitlement service (SA-WR-10);
 *   - slice 1b, the credit lot repository: exactly two READS through a
 *     `Pick<...>` (no writer is reachable): `listLotsWithDrawsAllAccounts`
 *     (the named all-accounts read, R-b, SA-Q10, only when no business is
 *     picked) and `listLotsWithDraws` (the picked business). Service role, as
 *     the repository's header documents. Each lot is mapped FIELD BY FIELD to
 *     the narrow `FinanceLot` (SA-W14), never spread: the lot's and the draws'
 *     admin-written `reason`, the idempotency keys, the source reference and
 *     the credit value version stop HERE, so they can never reach the builder,
 *     the response or a log, and a column added to the repository later cannot
 *     travel by accident.
 *
 * The admin-pinned name read (`findAdminIdentitiesByUserIds`) is NOT wired
 * here: it may be called only from `app/api/admin/**`, so the route injects it.
 * Nor is the reminder queue read (slice 2b, R-j): the jobs & queues admin read
 * may be named only under `app/api/admin/**`, so the route binds it to the
 * request's admin context and injects it too. Nor are the two usage-log reads
 * of Money M-4 (the recorded AI cost): the all-accounts one may be named only
 * under `app/api/admin/**`, and only the route may name either (the finance
 * source guard), so the route binds both and injects them.
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
import {
  businessOsCreditLotRepository,
  type BusinessOsCreditLotRepository,
  type BusinessOsCreditLotRow,
} from '@/lib/repositories/BusinessOsCreditLotRepository';
import { adminCreditPercentDeps } from '@/lib/business-os/credits/adminCreditPercentDeps';
import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';
import { isPlatformAccount } from '@/lib/business-os/llm/callCatalog';
import type { FinanceHealthDeps } from './financeHealth';
import type { FinanceLot } from './creditsSection';

/** Read only (SA-Q10): the two lot reads, never a writer. */
const lotReads: Pick<BusinessOsCreditLotRepository, 'listLotsWithDrawsAllAccounts' | 'listLotsWithDraws'> =
  businessOsCreditLotRepository;

/** SA-W14: only what Section 4 needs crosses this line, field by field; admin-written text never does. */
export function toFinanceLot(row: BusinessOsCreditLotRow): FinanceLot {
  return {
    id: row.id,
    accountId: row.accountId,
    source: row.source,
    creditsGranted: row.creditsGranted,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    actorAdminId: row.actorAdminId,
    draws: row.draws.map((draw) => ({ kind: draw.kind, credits: draw.credits, createdAt: draw.createdAt })),
  };
}

type LotsResult = Awaited<ReturnType<FinanceHealthDeps['lots']['allAccounts']>>;

async function narrowLots(read: Promise<{ data: BusinessOsCreditLotRow[] | null; error: Error | null }>): Promise<LotsResult> {
  const result = await read;
  if (result.error || !result.data) return { data: null, error: result.error ?? new Error('Lot read returned no data') };
  return { data: result.data.map(toFinanceLot), error: null };
}

/** The plan row of one account, its override rows dropped (SA-WR-1). */
export async function findPlanWithoutOverrides(
  accountId: string
): ReturnType<FinanceHealthDeps['findPlanForAccount']> {
  const result = await businessOsAccountPlanRepository.findEntitlementInputs(accountId);
  if (result.error || !result.data) return { data: null, error: result.error ?? new Error('Plan read returned no data') };
  // Only the plan crosses this line; `result.data.overrides` is never read.
  return { data: { plan: result.data.plan }, error: null };
}

/**
 * Everything but the four admin-route reads (names, reminder figures, and since
 * M-4 the two recorded AI cost reads), which the route supplies.
 */
export function financeHealthDeps(): Omit<
  FinanceHealthDeps,
  'findNames' | 'readReminderFigures' | 'readRecordedAllAccounts' | 'readRecordedForAccount'
> {
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
      listBillingStatusesAllAccounts: (opts) => businessOsFinanceReadRepository.listBillingStatusesAllAccounts(opts),
      findBillingStatusForAccount: (accountId) => businessOsFinanceReadRepository.findBillingStatusForAccount(accountId),
      countRevenueRows: () => businessOsFinanceReadRepository.countRevenueRows(),
      listClientPaymentsAllAccountsPaidInRange: (range, opts) =>
        businessOsFinanceReadRepository.listClientPaymentsAllAccountsPaidInRange(range, opts),
      listClientPaymentsForAccountPaidInRange: (accountId, range, opts) =>
        businessOsFinanceReadRepository.listClientPaymentsForAccountPaidInRange(accountId, range, opts),
      listClientRefundsAllAccountsCreatedInRange: (range, opts) =>
        businessOsFinanceReadRepository.listClientRefundsAllAccountsCreatedInRange(range, opts),
      listClientRefundsForAccountCreatedInRange: (accountId, range, opts) =>
        businessOsFinanceReadRepository.listClientRefundsForAccountCreatedInRange(accountId, range, opts),
      listOverdueClientInvoicesAllAccounts: (todayUtc, opts) =>
        businessOsFinanceReadRepository.listOverdueClientInvoicesAllAccounts(todayUtc, opts),
      listOverdueClientInvoicesForAccount: (accountId, todayUtc, opts) =>
        businessOsFinanceReadRepository.listOverdueClientInvoicesForAccount(accountId, todayUtc, opts),
      listOverdueClientInstalmentsAllAccounts: (todayUtc, opts) =>
        businessOsFinanceReadRepository.listOverdueClientInstalmentsAllAccounts(todayUtc, opts),
      listOverdueClientInstalmentsForAccount: (accountId, todayUtc, opts) =>
        businessOsFinanceReadRepository.listOverdueClientInstalmentsForAccount(accountId, todayUtc, opts),
      listClientPlansAllAccounts: (opts) => businessOsFinanceReadRepository.listClientPlansAllAccounts(opts),
      listClientPlansForAccount: (accountId, opts) => businessOsFinanceReadRepository.listClientPlansForAccount(accountId, opts),
      listBoostPurchasesAllAccountsPaidInRange: (range, opts) =>
        businessOsFinanceReadRepository.listBoostPurchasesAllAccountsPaidInRange(range, opts),
      listBoostPurchasesForAccountPaidInRange: (accountId, range, opts) =>
        businessOsFinanceReadRepository.listBoostPurchasesForAccountPaidInRange(accountId, range, opts),
      listPlanPaymentsAllAccountsPaidInRange: (range, opts) =>
        businessOsFinanceReadRepository.listPlanPaymentsAllAccountsPaidInRange(range, opts),
      listPlanPaymentsForAccountPaidInRange: (accountId, range, opts) =>
        businessOsFinanceReadRepository.listPlanPaymentsForAccountPaidInRange(accountId, range, opts),
    },
    // SA-WR-4: the classifier takes the config as a parameter; this is where it is read.
    config: getEntitlementConfig(),
    isPlatformAccount,
    // SA-W13: the Businesses list's own wiring; no getSnapshots, so production reads the real service.
    credits: adminCreditPercentDeps(),
    lots: {
      allAccounts: () => narrowLots(lotReads.listLotsWithDrawsAllAccounts()),
      forAccount: (accountId) => narrowLots(lotReads.listLotsWithDraws(accountId)),
    },
  };
}
