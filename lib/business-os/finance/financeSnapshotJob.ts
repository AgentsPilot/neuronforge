/**
 * The nightly finance history snapshot job (finance slice 8.2, §11M.4 HS-W-2,
 * HS-W-3, HS-W-5; §11M.7 HS-FR-6, HS-FR-8, HS-FR-8b; E-87, E-96). The cron
 * route is a thin door over `runFinanceSnapshot`.
 *
 * Order: late gate → table probe → reads (the page's own) → pure builder → ONE
 * idempotent insert. It never throws: a read that fails or throws skips its
 * family, and every other end is a result kind the route maps to a response.
 *
 * NO CLOCK HERE (8.2-R4): `startedAt` is the route's `financeSnapshotClock.now()`.
 * NOT A QUEUE DRAIN (HS-W-11): nothing is claimed; the write is keyed by day,
 * metric and dimension, so a second run the same day writes nothing new.
 *
 * @module lib/business-os/finance/financeSnapshotJob
 */

import { settle } from '@/lib/business-os/credits/aiActivity';
import { readAdminCreditPositions, type AdminCreditPositionsPass } from '@/lib/business-os/credits/adminCreditPercent';
import type { FinanceLot } from './creditsSection';
import { payingSetOf, walkPlans, type FinanceHealthLogger, type PlanWalk } from './financeHealth';
import { FINANCE_METRIC_PARAMS, farOverAllowancePercentOf } from './financeRules';
import { buildFinanceSnapshot } from './financeSnapshot';
import type { FinanceSnapshotDeps } from './financeSnapshotDeps';

/** HS-W-3 (SA-Q103): a run that starts at or after this UTC hour writes nothing. */
export const SNAPSHOT_LATEST_START_HOUR_UTC = 2;
/** E-87: the credit pass's night budget; the page keeps its 2 s. Below the route's maxDuration (60 s). */
export const SNAPSHOT_CREDIT_BUDGET_MS = 30 * 1000;

export interface FinanceSnapshotCounts {
  metricsWritten: number;
  metricsAlreadyThere: number;
  metricsSkipped: number;
  familiesSkipped: number;
  accountsRead: number;
  /** 1 = the run started too late and wrote nothing. */
  lateRun: number;
}

export type FinanceSnapshotRunResult =
  | { kind: 'done'; asOfDate: string; counts: FinanceSnapshotCounts }
  | { kind: 'late'; asOfDate: string; counts: FinanceSnapshotCounts }
  | { kind: 'not_installed'; asOfDate: string }
  | { kind: 'probe_failed'; asOfDate: string }
  | { kind: 'insert_failed'; asOfDate: string };

/** HS-W-2: the UTC day that has just ended when the run starts. `Date.UTC` rolls day 0 back into the previous month and year. */
export function snapshotDayOf(startedAt: Date): string {
  const day = Date.UTC(startedAt.getUTCFullYear(), startedAt.getUTCMonth(), startedAt.getUTCDate() - 1);
  return new Date(day).toISOString().slice(0, 10);
}

const ZERO: FinanceSnapshotCounts = {
  metricsWritten: 0,
  metricsAlreadyThere: 0,
  metricsSkipped: 0,
  familiesSkipped: 0,
  accountsRead: 0,
  lateRun: 0,
};

export async function runFinanceSnapshot(
  input: { startedAt: Date },
  deps: FinanceSnapshotDeps,
  logger: FinanceHealthLogger
): Promise<FinanceSnapshotRunResult> {
  const { startedAt } = input;
  const asOfDate = snapshotDayOf(startedAt);

  // ── 1. Late gate (HS-W-3): the state is too far from the day's end to label it ──
  if (startedAt.getUTCHours() >= SNAPSHOT_LATEST_START_HOUR_UTC) {
    return { kind: 'late', asOfDate, counts: { ...ZERO, lateRun: 1 } };
  }

  // ── 2. Probe (E-96): nothing is read before the table is known to be there ──
  const probe = await settle(() => deps.writer.probeTable());
  if (probe.error || !probe.data) return { kind: 'probe_failed', asOfDate };
  if (!probe.data.installed) return { kind: 'not_installed', asOfDate };

  // ── 3. The page's all-businesses reads, each settled ──────────────────────
  const failed = (read: string, err: Error | null) => logger.error({ read, err }, 'Finance snapshot read failed');
  const walkPromise = settle<PlanWalk>(() => walkPlans(deps.plans));
  // A failed or capped walk runs NO pass, as on the page (AC-37): never a partial count.
  const positionsPromise: Promise<AdminCreditPositionsPass | null> = walkPromise.then(async (walk) => {
    if (!walk.data || walk.data.capped) return null;
    const ids = walk.data.rows.map((row) => row.user_id);
    try {
      return await readAdminCreditPositions(ids, deps.credits, logger, { now: startedAt, budgetMs: SNAPSHOT_CREDIT_BUDGET_MS });
    } catch (err) {
      failed('credit_positions', err instanceof Error ? err : new Error(String(err)));
      return null;
    }
  });
  const [walk, billing, lots, positions] = await Promise.all([
    walkPromise,
    settle(() => deps.finance.listBillingStatusesAllAccounts()),
    settle<FinanceLot[]>(() => deps.lots.allAccounts()),
    positionsPromise,
  ]);
  if (walk.error) failed('plans', walk.error);
  if (billing.error) failed('billing_statuses', billing.error);
  if (lots.error) failed('lots', lots.error);

  // ── 4. The pure builder (the page's own functions) ────────────────────────
  const built = buildFinanceSnapshot({
    asOfDate,
    now: startedAt,
    plans: walk.data,
    paying: payingSetOf(billing.data),
    config: deps.config,
    positions,
    lots: lots.data,
    farOverAllowancePercent: farOverAllowancePercentOf(FINANCE_METRIC_PARAMS),
  });
  if (built.skipped.length > 0) logger.warn({ families: built.skipped }, 'Finance snapshot families not recorded');

  // ── 5. One idempotent insert (E-88) ──────────────────────────────────────
  const inserted = await settle(() => deps.writer.insertSnapshotRows(built.rows));
  if (inserted.error || !inserted.data) return { kind: 'insert_failed', asOfDate };

  return {
    kind: 'done',
    asOfDate,
    counts: {
      metricsWritten: inserted.data.written,
      metricsAlreadyThere: inserted.data.alreadyThere,
      metricsSkipped: built.metricsSkipped,
      familiesSkipped: built.familiesSkipped,
      accountsRead: walk.data?.rows.length ?? 0,
      lateRun: 0,
    },
  };
}
