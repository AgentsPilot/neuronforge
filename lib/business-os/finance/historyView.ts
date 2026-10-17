/**
 * The Finance History block's view, built on the server (finance slice 8.3,
 * §11M.8 HS-FR-12 to HS-FR-15, E-99; workplan
 * docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_8_3_HISTORY_BLOCK_WORKPLAN.md §2).
 *
 * PURE: no repository, no clock (the window and the dates are passed in), no
 * entitlements path. The browser only formats what this returns: the points,
 * the "No snapshot" days, the "Not recorded" cells, weekly sampling and the
 * change lines are all decided here (the client-format-only guard).
 *
 * NO MONEY (HS-W-9): every value is a count of accounts or credits, so nothing
 * is ever summed across currencies. NO ACCOUNT (HS-W-8): a stored plan key that
 * is neither a seeded group nor a `tier:` key is dropped, never echoed.
 *
 * @module lib/business-os/finance/historyView
 */

import { seedGroups, type ClassifyInput } from './planGroups';
import type { FinanceGroupKey } from './financeTypes';

export const HISTORY_LIMITS = {
  /** HS-FR-14: up to this many inclusive days, one point per day; longer, one per week. */
  DAILY_MAX_DAYS: 31,
  WEEK_DAYS: 7,
} as const;

export type HistoryState = 'ready' | 'no_history' | 'none_in_window' | 'not_installed';

export type HistoryCell = { kind: 'value'; value: number } | { kind: 'not_recorded' };
export type HistoryPoint = { date: string; kind: 'snapshot'; cells: HistoryCell[] } | { date: string; kind: 'no_snapshot' };
export type HistoryChange = { kind: 'value'; value: number } | { kind: 'not_available' };

/** A plan-mix group column: its key and config label, or a stored tier no longer configured (HS-W-10). */
export interface HistoryGroupColumn {
  id: 'group';
  key: FinanceGroupKey;
  tierLabel: string | null;
  noLongerConfigured: boolean;
}
export interface HistoryFigureColumn {
  id:
    | 'accounts_total'
    | 'founding_no_end_date'
    | 'credit_allowance'
    | 'credit_used'
    | 'gifted_outstanding'
    | 'bought_outstanding'
    | 'credit_outstanding_total'
    | 'credit_over_allowance'
    | 'credit_far_over_allowance';
  unit: 'accounts' | 'credits';
}
export type HistoryColumn = HistoryGroupColumn | HistoryFigureColumn;

export interface HistoryTable {
  columns: HistoryColumn[];
  /** Newest first. */
  points: HistoryPoint[];
  /** One per column: newest minus oldest, only when both cells are recorded (HS-FR-15). */
  change: HistoryChange[];
}

export interface FinanceHistoryView {
  window: { from: string; to: string };
  firstSnapshotDate: string | null;
  state: HistoryState;
  weekly: boolean;
  planMix: HistoryTable;
  credits: HistoryTable;
}

export interface HistoryRowInput {
  as_of_date: string;
  metric: string;
  dimension: string;
  unit: string;
  value: number | string;
}

export interface HistoryViewInput {
  /** The page's window, as resolved on the server (inclusive UTC dates). */
  window: { from: string; to: string };
  /** The last day a snapshot can exist for: yesterday, UTC (the job records D − 1). */
  latestDay: string;
  firstSnapshotDate: string | null;
  rows: readonly HistoryRowInput[];
  config: ClassifyInput['config'];
}

const MICRO = 1e6;
const DAY_MS = 24 * 60 * 60 * 1000;

const msOf = (date: string) => Date.parse(`${date}T00:00:00.000Z`);
const dateOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const inclusiveDays = (from: string, to: string) => Math.round((msOf(to) - msOf(from)) / DAY_MS) + 1;

const PLAN_TAIL: HistoryFigureColumn[] = [
  { id: 'accounts_total', unit: 'accounts' },
  { id: 'founding_no_end_date', unit: 'accounts' },
];
const CREDIT_COLUMNS: HistoryFigureColumn[] = [
  { id: 'credit_allowance', unit: 'credits' },
  { id: 'credit_used', unit: 'credits' },
  { id: 'gifted_outstanding', unit: 'credits' },
  { id: 'bought_outstanding', unit: 'credits' },
  { id: 'credit_outstanding_total', unit: 'credits' },
  { id: 'credit_over_allowance', unit: 'accounts' },
  { id: 'credit_far_over_allowance', unit: 'accounts' },
];

/** The value a column reads from one day's rows: a plan group is `accounts_in_group` by its key; a figure is its metric at `all`. */
function metricOf(column: HistoryColumn): { metric: string; dimension: string } {
  return column.id === 'group' ? { metric: 'accounts_in_group', dimension: column.key } : { metric: column.id, dimension: 'all' };
}

/** Exact micro units for a change line; null when a value cannot be held exactly. */
function toMicro(value: number): number | null {
  const micro = Math.round(value * MICRO);
  return Number.isSafeInteger(micro) ? micro : null;
}

function emptyTable(columns: HistoryColumn[]): HistoryTable {
  return { columns, points: [], change: columns.map(() => ({ kind: 'not_available' as const })) };
}

function tableOf(columns: HistoryColumn[], dates: readonly string[], byDay: ReadonlyMap<string, ReadonlyMap<string, number>>): HistoryTable {
  const points: HistoryPoint[] = dates.map((date) => {
    const day = byDay.get(date);
    if (!day) return { date, kind: 'no_snapshot' };
    const cells: HistoryCell[] = columns.map((column) => {
      const { metric, dimension } = metricOf(column);
      const value = day.get(`${metric}|${dimension}`);
      return value === undefined ? { kind: 'not_recorded' } : { kind: 'value', value };
    });
    return { date, kind: 'snapshot', cells };
  });
  const newest = points[0];
  const oldest = points[points.length - 1];
  const change: HistoryChange[] = columns.map((_column, i) => {
    if (!newest || !oldest || newest === oldest || newest.kind !== 'snapshot' || oldest.kind !== 'snapshot') return { kind: 'not_available' };
    const a = newest.cells[i];
    const b = oldest.cells[i];
    if (a.kind !== 'value' || b.kind !== 'value') return { kind: 'not_available' };
    const ma = toMicro(a.value);
    const mb = toMicro(b.value);
    return ma === null || mb === null ? { kind: 'not_available' } : { kind: 'value', value: (ma - mb) / MICRO };
  });
  return { columns, points, change };
}

export function buildHistoryView(input: HistoryViewInput): FinanceHistoryView {
  const { window, config } = input;
  const weekly = inclusiveDays(window.from, window.to) > HISTORY_LIMITS.DAILY_MAX_DAYS;

  // ── Plan-mix columns: Section 1's group order, then stored tiers no longer configured ──
  const seeded = seedGroups(config, true);
  const seededKeys = new Set<string>(seeded.map((g) => g.key));
  const groupColumns: HistoryGroupColumn[] = seeded.map((g) => ({ id: 'group', key: g.key, tierLabel: g.tierLabel, noLongerConfigured: false }));
  const staleTiers = new Set<string>();

  // ── The rows by day; unknown plan keys that are not tier keys are dropped (HS-W-8) ──
  const byDay = new Map<string, Map<string, number>>();
  for (const row of input.rows) {
    const value = Number(row.value);
    if (!Number.isFinite(value)) continue;
    if (row.metric === 'accounts_in_group' && !seededKeys.has(row.dimension)) {
      if (!/^tier:[a-z0-9_-]{1,40}$/.test(row.dimension)) continue;
      staleTiers.add(row.dimension);
    }
    const day = byDay.get(row.as_of_date) ?? new Map<string, number>();
    day.set(`${row.metric}|${row.dimension}`, value);
    byDay.set(row.as_of_date, day);
  }
  for (const key of [...staleTiers].sort()) {
    groupColumns.push({ id: 'group', key: key as FinanceGroupKey, tierLabel: null, noLongerConfigured: true });
  }
  const planColumns: HistoryColumn[] = [...groupColumns, ...PLAN_TAIL];

  const base = { window, firstSnapshotDate: input.firstSnapshotDate, weekly };
  if (input.firstSnapshotDate === null) {
    return { ...base, state: 'no_history', planMix: emptyTable(planColumns), credits: emptyTable(CREDIT_COLUMNS) };
  }
  if (byDay.size === 0) {
    return { ...base, state: 'none_in_window', planMix: emptyTable(planColumns), credits: emptyTable(CREDIT_COLUMNS) };
  }

  // ── Point dates: from the last day that can hold a snapshot back to the window's start, never before the first ──
  const last = window.to < input.latestDay ? window.to : input.latestDay;
  const first = window.from > input.firstSnapshotDate ? window.from : input.firstSnapshotDate;
  const step = weekly ? HISTORY_LIMITS.WEEK_DAYS : 1;
  const dates: string[] = [];
  for (let ms = msOf(last); ms >= msOf(first); ms -= step * DAY_MS) dates.push(dateOf(ms));

  return {
    ...base,
    state: 'ready',
    planMix: tableOf(planColumns, dates, byDay),
    credits: tableOf(CREDIT_COLUMNS, dates, byDay),
  };
}

/** The not-installed view (E-100): the window only, no tables. */
export function notInstalledHistoryView(window: { from: string; to: string }): FinanceHistoryView {
  return {
    window,
    firstSnapshotDate: null,
    state: 'not_installed',
    weekly: false,
    planMix: emptyTable([]),
    credits: emptyTable([]),
  };
}

/** The UTC date before `date` (`YYYY-MM-DD`): the last day a snapshot can exist for on `date` (HS-W-2). */
export function dayBefore(date: string): string {
  return dateOf(msOf(date) - DAY_MS);
}
