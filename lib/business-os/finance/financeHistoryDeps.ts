/**
 * The Finance History block's wiring (slice 8.3, HS-FR-10, E-98, 8.3-R1).
 *
 * It picks `config` from the Finance page's own wiring, `financeHealthDeps()`
 * (the E-94 trick), so no new entitlements importer appears, and it adds only
 * the READ-ONLY snapshot repository, through a `Pick` of its two reads. No
 * writer is reachable from here (the writer has one importer, the 8.2 job's
 * wiring). Only `GET /api/admin/business-os/finance/history` imports this.
 *
 * @module lib/business-os/finance/financeHistoryDeps
 */

import 'server-only';

import {
  businessOsFinanceSnapshotReadRepository,
  type BusinessOsFinanceSnapshotReadRepository,
} from '@/lib/repositories/BusinessOsFinanceSnapshotReadRepository';
import type { FinanceHealthDeps } from './financeHealth';
import { financeHealthDeps } from './financeHealthDeps';

export interface FinanceHistoryDeps extends Pick<FinanceHealthDeps, 'config'> {
  snapshots: Pick<BusinessOsFinanceSnapshotReadRepository, 'findFirstSnapshotDate' | 'listSnapshotsInRange'>;
}

export function financeHistoryDeps(): FinanceHistoryDeps {
  return {
    config: financeHealthDeps().config,
    snapshots: businessOsFinanceSnapshotReadRepository,
  };
}
