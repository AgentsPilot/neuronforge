/**
 * The nightly finance history snapshot's wiring (slice 8.2, HS-FR-8a, E-94).
 *
 * It PICKS its four reads and the config from the Finance page's own wiring,
 * `financeHealthDeps()`, so the snapshot reads exactly what Section 1 and
 * Section 4 read for all businesses (HS-W-7), and no repository caller list or
 * entitlements-importer pin moves. Building the page's deps object costs no
 * I/O. The one thing it adds is the snapshot writer (8.2-R2: the only importer
 * of `BusinessOsFinanceSnapshotRepository`).
 *
 * No account-scoped read, no name read, no ledger read and no recorded-cost read
 * crosses this line. The job takes no caller input (tenant-isolation-guard).
 *
 * @module lib/business-os/finance/financeSnapshotDeps
 */

import 'server-only';

import {
  businessOsFinanceSnapshotRepository,
  type BusinessOsFinanceSnapshotRepository,
} from '@/lib/repositories/BusinessOsFinanceSnapshotRepository';
import type { FinanceHealthDeps } from './financeHealth';
import { financeHealthDeps } from './financeHealthDeps';

export interface FinanceSnapshotDeps extends Pick<FinanceHealthDeps, 'plans' | 'credits' | 'config'> {
  finance: Pick<FinanceHealthDeps['finance'], 'listBillingStatusesAllAccounts'>;
  lots: Pick<FinanceHealthDeps['lots'], 'allAccounts'>;
  writer: Pick<BusinessOsFinanceSnapshotRepository, 'probeTable' | 'insertSnapshotRows'>;
}

export function financeSnapshotDeps(): FinanceSnapshotDeps {
  const page = financeHealthDeps();
  return {
    plans: page.plans,
    finance: { listBillingStatusesAllAccounts: page.finance.listBillingStatusesAllAccounts },
    credits: page.credits,
    lots: { allAccounts: page.lots.allAccounts },
    config: page.config,
    writer: businessOsFinanceSnapshotRepository,
  };
}
