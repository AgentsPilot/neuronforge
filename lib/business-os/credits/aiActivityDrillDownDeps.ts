/**
 * The admin AI Activity drill-down's production wiring (Gap B slice B2a).
 * Workplan docs/workplans/BUSINESS_OS_ADMIN_AI_ACTIVITY_SLICE_B2_WORKPLAN.md § D.
 *
 * Hands the three real ledger reads to `buildAiActivityDrillDown`: the charge
 * by its action id, the charges of one group on one account, and the
 * corrections of those charges. It is declared, with its reason, on the ledger
 * read repository's importer guard
 * (`lib/repositories/__tests__/BusinessOsCreditLedgerReadRepository.test.ts`).
 * The archive cutoff reads are the list's own (`aiActivityArchive`, reused).
 *
 * Every method it exposes is a read. It wires the NON-admin reads only: the
 * admin-pinned reads (`findAdminIdentitiesByUserIds`,
 * `listAiActionEntriesAllAccountsByGroupIds`) may be called only from
 * `app/api/admin/**`, so the route injects them.
 *
 * Server-only: the repository holds the service-role client. The one caller is
 * the admin drill-down route, which runs `requireAdmin` first.
 *
 * @module lib/business-os/credits/aiActivityDrillDownDeps
 */

import { businessOsCreditLedgerReadRepository } from '@/lib/repositories/BusinessOsCreditLedgerReadRepository';
import type { AiActivityDrillDownDeps } from './aiActivityDrillDown';

export function aiActivityDrillDownLedger(): AiActivityDrillDownDeps['ledger'] {
  return {
    findChargesByActionIds: (actionIds) => businessOsCreditLedgerReadRepository.findChargesByActionIds(actionIds),
    listChargesOfGroupForAccount: (userId, groupId, opts) =>
      businessOsCreditLedgerReadRepository.listChargesOfGroupForAccount(userId, groupId, opts),
    listAdjustmentsForActionIds: (actionIds) => businessOsCreditLedgerReadRepository.listAdjustmentsForActionIds(actionIds),
  };
}
