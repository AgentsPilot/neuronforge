/**
 * The nightly finance history snapshot, as rows (finance slice 8.2, §11M.4,
 * §11M.5, HS-W-5, HS-W-7, E-86, E-95; workplan
 * docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_8_2_SNAPSHOT_JOB_WORKPLAN.md §1).
 *
 * PURE: no repository, no clock, no entitlements path. The `now` is the job's
 * start, passed in. Every figure comes from the functions the Finance page
 * uses for all businesses (HS-W-7): `classifyAccounts` (Section 1, K-3) and
 * `buildCreditsSection` (Section 4, K-2, K-4), and bought credits through
 * K-4's own loop, `outstandingBySource` (E-95). No second definition.
 *
 * ONLY EXACT FIGURES (HS-W-5): a family whose source was unreadable, capped or
 * timed out is not written at all, never as 0 and never as a lower bound.
 * Every emitted row is checked against the 8.1 shape constants before it is
 * returned (8.2-R1, E-86); a row the table's CHECKs would refuse skips its own
 * family, so the one batched insert is never sent with it.
 *
 * NO MONEY, NO ACCOUNT (HS-W-8, HS-W-9): every value is a count of accounts or
 * an amount of credits; a dimension is a group key, a lifecycle state or
 * `all`, and the shape refuses a uuid.
 *
 * @module lib/business-os/finance/financeSnapshot
 */

import type { AdminCreditPositionsPass } from '@/lib/business-os/credits/adminCreditPercent';
import { buildCreditsSection, outstandingBySource, type FinanceLot } from './creditsSection';
import { SNAPSHOT_DIMENSION_SHAPE, SNAPSHOT_METRIC_SHAPE } from './financeSnapshotShape';
import { classifyAccounts, type ClassifyInput } from './planGroups';

/** The metrics of §11M.5, the one list (SA-Q101): the migration checks only their shape. */
export const SNAPSHOT_METRICS = [
  'accounts_total',
  'accounts_in_group',
  'accounts_in_grace',
  'accounts_past_due',
  'accounts_in_state',
  'founding_no_end_date',
  'founding_dormant',
  'accounts_ending_soon',
  'credit_accounts',
  'credit_over_allowance',
  'credit_unknown_accounts',
  'credit_no_allowance_accounts',
  'credit_far_over_allowance',
  'credit_allowance',
  'credit_used',
  'credit_included_left',
  'gifted_outstanding',
  'gifted_outstanding_deleted',
  'bought_outstanding',
  'credit_outstanding_total',
] as const;
export type SnapshotMetric = (typeof SNAPSHOT_METRICS)[number];

export type SnapshotFamily = 'plan' | 'credit' | 'lots';

/** One row, exactly the five columns the job may insert (8.1 grant). */
export interface SnapshotRow {
  as_of_date: string;
  metric: SnapshotMetric;
  dimension: string;
  unit: 'accounts' | 'credits';
  value: number;
}

export interface FinanceSnapshotInput {
  /** `YYYY-MM-DD`: the UTC day whose end the state describes (HS-W-2). */
  asOfDate: string;
  /** The job's start: the instant the state is read at. */
  now: Date;
  /** The all-accounts plan walk; null when it failed. */
  plans: { rows: ClassifyInput['rows']; capped: boolean } | null;
  /** From `payingSetOf`: `payingIds` null means the billing read failed (paying unknown, 8.2-R3). */
  paying: { payingIds: ReadonlySet<string> | null; paidTierHints: ReadonlyMap<string, string> };
  config: ClassifyInput['config'];
  /** Null when the pass did not run (the walk failed or was capped). */
  positions: AdminCreditPositionsPass | null;
  /** Null when the lots read failed. */
  lots: readonly FinanceLot[] | null;
  /** The validated far-over-allowance line; null when the configured one is invalid. */
  farOverAllowancePercent: number | null;
}

export interface FinanceSnapshotResult {
  rows: SnapshotRow[];
  /** Families not written (HS-FR-3). */
  familiesSkipped: number;
  /** Single figures not written inside a family that was (an invalid line, an unknown account, an unreadable part). */
  metricsSkipped: number;
  /** Which families were skipped, for the job's log (names only). */
  skipped: SnapshotFamily[];
}

const MICRO = 1e6;

/** Exact micro-credits, or null when the figure cannot be held as a safe integer. */
function toMicro(value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || value < 0) return null;
  const micro = Math.round(value * MICRO);
  return Number.isSafeInteger(micro) ? micro : null;
}

const isWholeCount = (value: number) => Number.isSafeInteger(value) && value >= 0;

/** 8.2-R1: every emitted row fits the table's metric and dimension CHECKs. */
function fitsShape(row: SnapshotRow): boolean {
  return SNAPSHOT_METRIC_SHAPE.test(row.metric) && SNAPSHOT_DIMENSION_SHAPE.test(row.dimension);
}

export function buildFinanceSnapshot(input: FinanceSnapshotInput): FinanceSnapshotResult {
  const { asOfDate, now } = input;
  const skipped: SnapshotFamily[] = [];
  let metricsSkipped = 0;
  const accounts = (metric: SnapshotMetric, value: number, dimension = 'all'): SnapshotRow => ({
    as_of_date: asOfDate,
    metric,
    dimension,
    unit: 'accounts',
    value,
  });
  const credits = (metric: SnapshotMetric, micro: number): SnapshotRow => ({
    as_of_date: asOfDate,
    metric,
    dimension: 'all',
    unit: 'credits',
    value: micro / MICRO,
  });
  /** A family is written whole or not at all: any row outside the shape or not a whole count skips it. */
  const familyRows = (family: SnapshotFamily, rows: SnapshotRow[]): SnapshotRow[] => {
    const valid = rows.every((row) => fitsShape(row) && (row.unit !== 'accounts' || isWholeCount(row.value)));
    if (valid) return rows;
    skipped.push(family);
    return [];
  };

  // The same empty window the page never shows: "new in window" is not snapshotted (SA-W-8.2-8).
  const instant = { start: now, end: now };
  const walk = input.plans !== null && !input.plans.capped ? input.plans.rows : null;
  const classified =
    walk === null
      ? null
      : classifyAccounts({
          rows: walk,
          payingIds: input.paying.payingIds,
          paidTierHints: input.paying.paidTierHints,
          window: instant,
          now,
          config: input.config,
        });

  // ── plan: a complete walk AND a known paying set (no folded "Tier set" in history) ──
  let planRows: SnapshotRow[] = [];
  if (classified === null || input.paying.payingIds === null || !classified.figures.payingKnown) {
    skipped.push('plan');
  } else {
    const f = classified.figures;
    const rows: SnapshotRow[] = [accounts('accounts_total', f.total)];
    for (const group of f.groups) {
      rows.push(accounts('accounts_in_group', group.count, group.key));
      rows.push(accounts('accounts_in_grace', group.grace, group.key));
      rows.push(accounts('accounts_past_due', group.pastDue, group.key));
    }
    for (const [state, count] of Object.entries(f.byState)) rows.push(accounts('accounts_in_state', count, state));
    rows.push(accounts('founding_no_end_date', f.foundingNoEndDate));
    rows.push(accounts('founding_dormant', f.dormantFounding));
    rows.push(accounts('accounts_ending_soon', f.endingIn30Days));
    planRows = familyRows('plan', rows);
  }

  // ── credit and lots: Section 4's own builder, every account, no display cap ──
  const groupOfAccount = classified?.groupByAccount ?? null;
  const section = buildCreditsSection({
    accountIds: walk === null ? null : walk.map((row) => row.user_id),
    groupOf: (id) => groupOfAccount?.get(id),
    tierLabelOf: () => null,
    positions: input.positions?.outcome === 'ok' ? input.positions.byUserId : null,
    lots: input.lots,
    window: instant,
    now,
    farOverAllowancePercent: input.farOverAllowancePercent,
    displayCap: 0,
  });

  let creditRows: SnapshotRow[] = [];
  let includedLeftMicro: number | null = null;
  if (section.figures === null || section.rowByAccount === null) {
    skipped.push('credit');
  } else {
    const f = section.figures;
    const rows: SnapshotRow[] = [
      accounts('credit_accounts', f.accounts),
      accounts('credit_over_allowance', f.overAllowance),
      accounts('credit_unknown_accounts', f.unknownAccounts),
      accounts('credit_no_allowance_accounts', f.noAllowanceAccounts),
    ];
    if (f.farOverAllowance === null) metricsSkipped += 1;
    else rows.push(accounts('credit_far_over_allowance', f.farOverAllowance));

    // SA-W-8.2-2: exact integer micro-credit sums over the position rows, only with no unknown account.
    let allowanceMicro: number | null = f.unknownAccounts === 0 ? 0 : null;
    let usedMicro: number | null = allowanceMicro;
    let leftMicro: number | null = allowanceMicro;
    if (allowanceMicro !== null) {
      for (const row of section.rowByAccount.values()) {
        if (row.kind !== 'position') continue;
        const a = toMicro(row.allowance);
        const u = toMicro(row.used);
        if (a === null || u === null || allowanceMicro === null || usedMicro === null || leftMicro === null) {
          allowanceMicro = usedMicro = leftMicro = null;
          break;
        }
        allowanceMicro += a;
        usedMicro += u;
        leftMicro += Math.max(a - u, 0);
      }
    }
    const safe = (micro: number | null) => (micro !== null && Number.isSafeInteger(micro) ? micro : null);
    allowanceMicro = safe(allowanceMicro);
    usedMicro = safe(usedMicro);
    leftMicro = safe(leftMicro);
    if (allowanceMicro === null || usedMicro === null || leftMicro === null) {
      metricsSkipped += 3;
    } else {
      rows.push(credits('credit_allowance', allowanceMicro), credits('credit_used', usedMicro), credits('credit_included_left', leftMicro));
    }
    creditRows = familyRows('credit', rows);
    includedLeftMicro = creditRows.some((row) => row.metric === 'credit_included_left') ? leftMicro : null;
  }

  let lotRows: SnapshotRow[] = [];
  if (input.lots === null || section.gifted === null) {
    skipped.push('lots');
  } else {
    const rows: SnapshotRow[] = [];
    const giftedMicro = toMicro(section.gifted.outstanding);
    const deletedMicro = toMicro(section.gifted.deletedAccountsOutstanding);
    // E-95: K-4's loop over the boost lots; existing accounts only (its total, never the deleted part).
    const boughtTotal = outstandingBySource(input.lots, 'boost_purchase', now).totalMicro;
    const boughtMicro = boughtTotal !== null && Number.isSafeInteger(boughtTotal) ? boughtTotal : null;
    if (giftedMicro === null) metricsSkipped += 1;
    else rows.push(credits('gifted_outstanding', giftedMicro));
    if (deletedMicro === null) metricsSkipped += 1;
    else rows.push(credits('gifted_outstanding_deleted', deletedMicro));
    if (boughtMicro === null) metricsSkipped += 1;
    else rows.push(credits('bought_outstanding', boughtMicro));
    const totalMicro =
      includedLeftMicro !== null && giftedMicro !== null && boughtMicro !== null ? includedLeftMicro + giftedMicro + boughtMicro : null;
    if (totalMicro === null || !Number.isSafeInteger(totalMicro)) metricsSkipped += 1;
    else rows.push(credits('credit_outstanding_total', totalMicro));
    lotRows = familyRows('lots', rows);
  }

  return { rows: [...planRows, ...creditRows, ...lotRows], familiesSkipped: skipped.length, metricsSkipped, skipped };
}
