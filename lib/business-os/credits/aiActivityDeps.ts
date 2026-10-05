/**
 * The admin AI Activity view's production wiring (Gap B slices B1a and B1b).
 * Workplan docs/workplans/BUSINESS_OS_ADMIN_AI_ACTIVITY_SLICE_B1_WORKPLAN.md § D.
 *
 * The ONE file that hands the real ledger reads to `buildAiActivity`. It is
 * declared, with its reason, on the ledger read repository's importer guard
 * (`lib/repositories/__tests__/BusinessOsCreditLedgerReadRepository.test.ts`).
 * B1b adds the audit archive cutoff reads (`getLatestCutoff`, `listRuns`), which
 * are reused unchanged (OQ-8).
 *
 * Every method it exposes is a read. It wires the NON-admin reads only: the
 * admin-pinned reads (`findAdminIdentitiesByUserIds`, and in B1b
 * `listAiActionEntriesAllAccountsByGroupIds`) may be called only from
 * `app/api/admin/**`, so the route injects them. There is no `token_usage` read
 * here, by design (SA-RC-4, AC-B7 list half).
 *
 * Server-only: the repositories hold the service-role client. The one caller is
 * the admin route, which runs `requireAdmin` first.
 *
 * @module lib/business-os/credits/aiActivityDeps
 */

import { businessOsCreditLedgerReadRepository } from '@/lib/repositories/BusinessOsCreditLedgerReadRepository';
import { archiveRepository } from '@/lib/repositories/ArchiveRepository';
import type { AiActivityDeps } from './aiActivity';

export function aiActivityLedger(): AiActivityDeps['ledger'] {
  return {
    listChargesAllAccountsInWindow: (filter, opts) =>
      businessOsCreditLedgerReadRepository.listChargesAllAccountsInWindow(filter, opts),
    listChargesForAccountInWindow: (userId, filter, opts) =>
      businessOsCreditLedgerReadRepository.listChargesForAccountInWindow(userId, filter, opts),
    listAdjustmentsForActionIds: (actionIds) => businessOsCreditLedgerReadRepository.listAdjustmentsForActionIds(actionIds),
    listChargesOfDeletedAccountsInWindow: (filter, opts) =>
      businessOsCreditLedgerReadRepository.listChargesOfDeletedAccountsInWindow(filter, opts),
  };
}

/** B1b: the two existing archive reads that decide "entry may be archived" (FR-B5, OQ-8). */
export function aiActivityArchive(): AiActivityDeps['archive'] {
  return {
    getLatestCutoff: (source) => archiveRepository.getLatestCutoff(source),
    listRuns: (options) => archiveRepository.listRuns(options),
  };
}
