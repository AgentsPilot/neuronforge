/**
 * Section 6 block B, "Client payment problems" (finance & business health
 * slice 2b, S2-FR-15 to S2-FR-26). Workplan
 * docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_2B_WORKPLAN.md § The payment
 * problems builder.
 *
 * Where the businesses' clients are not paying: the businesses' problem, not
 * ours (BD-2). Five parts, each with its own status (S2-FR-15):
 *   1. failed client payments: a fixed "not stored" state, never a count;
 *   2. overdue invoices, as of now (UTC);
 *   3. overdue or past-due plan instalments, as of now (UTC);
 *   4. client plans: active now, cancelled and completed in the window, next
 *      charge overdue, and whether a failed charge was ever stored;
 *   5. reminder health: the Jobs & queues figures for the reminder queue,
 *      mapped field by field (SA-W35).
 *
 * PURE (SA-WR-4): every input is a parameter; no clock, no I/O. Its input
 * types are STRUCTURAL (SA-W22, SA-W35): this file imports nothing from a
 * repository (so neither the finance read repository's one-caller pin nor the
 * jobs & queues isolation guard moves).
 *
 * Statuses are matched EXACTLY (SA-WR-15: no trim, no case change), so the
 * page and SQL checks 10 to 12 cannot differ. Every amount is the FULL invoice
 * or instalment amount (S2-F7), summed in integer hundredths per currency
 * through the currency helper and divided by 100 once (SA-W26). Nothing adds
 * two currencies (S2-CUR-1). A due date is date-only text and goes through
 * `dueDates.ts`, never through a Date (S2-F5).
 *
 * @module lib/business-os/finance/paymentProblems
 */

import { CURRENCY_SCALE, groupByCurrency, normaliseCurrencyCode, toHundredths } from './currencyGroups';
import { daysPastDue, isDueDate, isPastDue } from './dueDates';
import type {
  FinanceClientPlansFigures,
  FinanceDueFigures,
  FinanceDueLine,
  FinanceDueRow,
  FinanceReminderFigures,
  FinanceSectionStatus,
} from './financeTypes';

/** One invoice or instalment row, structurally (SA-W22): the repository's row fits it. */
export interface DueRowInput {
  id: string;
  user_id: string | null;
  amount: unknown;
  currency: unknown;
  status: string | null;
  due_date: unknown;
}

/** One client plan row, structurally (SA-W22). */
export interface ClientPlanInput {
  id: string;
  user_id: string | null;
  status: string | null;
  cancelled_at: string | null;
  completed_at: string | null;
  next_charge_at: string | null;
  last_failure_at: string | null;
}

/**
 * The reminder queue's figures, structurally (SA-W35): the Jobs & queues
 * read's result fits it, and this file never names that read's types.
 */
export interface FinanceReminderFiguresInput {
  dueNow: number;
  inProgress: number;
  stuck: number;
  failed24h: number;
  failed7d: number;
  deadLettered24h: number;
  deadLettered7d: number;
  oldestDueAt: string | null;
}

/**
 * The stored client plan statuses, in the order the page shows them: the
 * CHECK of the client plan table, as literal data (SA-W39). A test pins it to
 * the migration (SA-WR-22).
 */
export const CLIENT_PLAN_STATUSES = ['pending', 'active', 'past_due', 'paused', 'completed', 'cancelled'] as const;

/** The stored status that means "the business marked it overdue", for both tables. */
const MARKED = 'overdue';
/** Not yet marked, but due before today: an invoice still `sent`, an instalment still `pending`. */
const UNMARKED: Record<'invoice' | 'instalment', string> = { invoice: 'sent', instalment: 'pending' };

/** A table row before names: the builder adds the name from rows already read. */
export type OverdueRowBuilt = Omit<FinanceDueRow, 'name' | 'nameStatus'> & { isPlatform: boolean };

export type FinanceDueFiguresBuilt = Omit<FinanceDueFigures, 'rows'> & { rows: OverdueRowBuilt[] };

export interface OverdueBuilt {
  status: FinanceSectionStatus;
  /** Null only when `status` is `unknown` (the read failed). */
  figures: FinanceDueFiguresBuilt | null;
  /** Rows the read returned that are neither marked nor past due (cannot happen through the `.or()`): counted, left out. */
  unexpectedRows: number;
}

export interface OverdueInput {
  kind: 'invoice' | 'instalment';
  /** Null: the read failed. */
  read: { rows: readonly DueRowInput[]; reachedCeiling: boolean } | null;
  /** Today's UTC date, `YYYY-MM-DD`, from the request's one clock. */
  todayUtc: string;
  isPlatformAccount: (accountId: string) => boolean;
  /** `FINANCE_LIMITS.OVERDUE_ROWS_SHOWN`. */
  displayCap: number;
}

/** Hundredths → the wire number, once (SA-W26). */
const toMoney = (hundredths: number): number => hundredths / CURRENCY_SCALE;

export function buildOverdue(input: OverdueInput): OverdueBuilt {
  const { kind, read, todayUtc, isPlatformAccount, displayCap } = input;
  if (read === null) return { status: 'unknown', figures: null, unexpectedRows: 0 };

  const exact = !read.reachedCeiling;
  const unmarked = UNMARKED[kind];
  const counted: Array<{ row: DueRowInput; rowKind: FinanceDueRow['kind'] }> = [];
  let unexpectedRows = 0;
  for (const row of read.rows) {
    if (row.status === MARKED) counted.push({ row, rowKind: 'marked' });
    else if (row.status === unmarked && isPastDue(row.due_date, todayUtc)) counted.push({ row, rowKind: 'past_due' });
    else unexpectedRows += 1;
  }

  const cents = counted.map(({ row }) => toHundredths(row.amount));
  const unreadableAmounts = cents.filter((c) => c === null).length;

  // ── Per currency (the money only through the currency helper) ───────────
  const sums = groupByCurrency(
    counted.map(({ row }, i) => ({ currency: row.currency, field: 'amount' as const, hundredths: cents[i] })),
    ['amount'] as const
  );
  const perCurrency = new Map<string | null, { marked: number; pastDue: number; businesses: Set<string>; oldest: string | null }>();
  const businesses = new Set<string>();
  for (const { row, rowKind } of counted) {
    const currency = normaliseCurrencyCode(row.currency);
    const acc = perCurrency.get(currency) ?? { marked: 0, pastDue: 0, businesses: new Set<string>(), oldest: null };
    if (rowKind === 'marked') acc.marked += 1;
    else acc.pastDue += 1;
    if (row.user_id !== null) {
      acc.businesses.add(row.user_id);
      businesses.add(row.user_id);
    }
    // SA-W36: an unknown due date is left out of "oldest" (check 10's min() skips NULL).
    if (isDueDate(row.due_date) && (acc.oldest === null || row.due_date < acc.oldest)) acc.oldest = row.due_date;
    perCurrency.set(currency, acc);
  }
  let overflow = false;
  const lines: FinanceDueLine[] = sums.map((line) => {
    if (line.overflow) overflow = true;
    const acc = perCurrency.get(line.currency);
    return {
      currency: line.currency,
      marked: acc?.marked ?? 0,
      pastDue: acc?.pastDue ?? 0,
      amount: toMoney(line.sums.amount),
      amountExact: exact && line.unreadable.amount === 0 && !line.overflow,
      unreadable: line.unreadable.amount,
      businesses: acc?.businesses.size ?? 0,
      oldestDueDate: acc?.oldest ?? null,
    };
  });

  // ── The rows, oldest due date first; unknown dates last, then by id (SA-W30, SA-W36) ──
  const allRows: OverdueRowBuilt[] = counted
    .map(({ row, rowKind }, i) => {
      const dueDate = isDueDate(row.due_date) ? row.due_date : null;
      const amountCents = cents[i];
      return {
        id: row.id,
        accountId: row.user_id,
        isPlatform: row.user_id !== null && isPlatformAccount(row.user_id),
        kind: rowKind,
        dueDate,
        daysPastDue: dueDate === null ? null : daysPastDue(dueDate, todayUtc),
        amount: amountCents === null ? null : toMoney(amountCents),
        currency: normaliseCurrencyCode(row.currency),
      };
    })
    .sort((a, b) => compareNullableAsc(a.dueDate, b.dueDate) || compareNullableAsc(a.id, b.id));

  const partial = !exact || unreadableAmounts > 0 || overflow;
  return {
    status: partial ? 'partial' : 'ok',
    figures: {
      empty: counted.length === 0,
      exact,
      lines,
      businesses: businesses.size,
      total: counted.length,
      unreadableAmounts,
      rows: allRows.slice(0, Math.max(0, displayCap)),
      rowsTotal: allRows.length,
    },
    unexpectedRows,
  };
}

export interface ClientPlansInput {
  /** Null: the read failed. */
  read: { rows: readonly ClientPlanInput[]; reachedCeiling: boolean } | null;
  /** The selected window, half-open `[start, end)`. */
  window: { start: Date; end: Date };
  /** The request's one clock. */
  now: Date;
}

export interface ClientPlansBuilt {
  status: FinanceSectionStatus;
  figures: FinanceClientPlansFigures | null;
}

const KNOWN_STATUSES: ReadonlySet<string> = new Set(CLIENT_PLAN_STATUSES);

export function buildClientPlans(input: ClientPlansInput): ClientPlansBuilt {
  const { read, window, now } = input;
  if (read === null) return { status: 'unknown', figures: null };

  const exact = !read.reachedCeiling;
  const start = window.start.getTime();
  const end = window.end.getTime();
  let unreadableTimes = 0;
  /** A stored timestamp as an instant; NULL is "not set", an unparseable value is counted, never guessed. */
  const instant = (value: string | null): number | null => {
    if (value === null) return null;
    const ms = Date.parse(value);
    if (Number.isNaN(ms)) {
      unreadableTimes += 1;
      return null;
    }
    return ms;
  };
  const inWindow = (ms: number | null) => ms !== null && ms >= start && ms < end;

  const counts = new Map<string | null, number>();
  let activeNow = 0;
  let cancelledInWindow = 0;
  let completedInWindow = 0;
  let nextChargeOverdue = 0;
  let everRecorded = false;
  let failedInWindow = 0;
  for (const row of read.rows) {
    counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
    const isActive = row.status === 'active';
    if (isActive) activeNow += 1;
    if (inWindow(instant(row.cancelled_at))) cancelledInWindow += 1;
    if (inWindow(instant(row.completed_at))) completedInWindow += 1;
    const nextCharge = instant(row.next_charge_at);
    if (isActive && nextCharge !== null && nextCharge < now.getTime()) nextChargeOverdue += 1;
    // `everRecorded` covers the rows READ only: the page claims "never stored" only when the read was complete (QA-1).
    if (row.last_failure_at !== null) {
      everRecorded = true;
      if (inWindow(instant(row.last_failure_at))) failedInWindow += 1;
    }
  }

  const byStatus: FinanceClientPlansFigures['byStatus'] = CLIENT_PLAN_STATUSES.map((status) => ({
    status,
    plans: counts.get(status) ?? 0,
    recognised: true,
  }));
  const others = [...counts.entries()]
    .filter(([status]) => status === null || !KNOWN_STATUSES.has(status))
    .sort(([a], [b]) => compareNullableAsc(a, b));
  let unrecognised = 0;
  for (const [status, plans] of others) {
    unrecognised += plans;
    byStatus.push({ status, plans, recognised: false });
  }

  return {
    status: !exact || unreadableTimes > 0 ? 'partial' : 'ok',
    figures: {
      exact,
      total: read.rows.length,
      byStatus,
      unrecognised,
      activeNow,
      cancelledInWindow,
      completedInWindow,
      nextChargeOverdue,
      unreadableTimes,
      failedCharges: { everRecorded, inWindow: failedInWindow },
    },
  };
}

const REMINDER_COUNTS = ['dueNow', 'inProgress', 'stuck', 'failed24h', 'failed7d', 'deadLettered24h', 'deadLettered7d'] as const;

/**
 * SA-W35: the reminder figures, checked field by field and copied by name
 * (nothing else from the read travels). A malformed result is null, which the
 * part shows as "Could not check reminders", never as a 0.
 */
export function mapReminderFigures(raw: unknown): FinanceReminderFigures | null {
  if (raw === null || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  const counts: Partial<Record<(typeof REMINDER_COUNTS)[number], number>> = {};
  for (const key of REMINDER_COUNTS) {
    const value = source[key];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return null;
    counts[key] = value;
  }
  const oldest = source.oldestDueAt;
  let oldestDueAt: string | null = null;
  if (oldest !== null) {
    // An instant (the queue's effective due time), not a due date: parsing it is safe.
    if (typeof oldest !== 'string' || Number.isNaN(Date.parse(oldest))) return null;
    oldestDueAt = oldest;
  }
  return {
    dueNow: counts.dueNow as number,
    inProgress: counts.inProgress as number,
    stuck: counts.stuck as number,
    failed24h: counts.failed24h as number,
    failed7d: counts.failed7d as number,
    deadLettered24h: counts.deadLettered24h as number,
    deadLettered7d: counts.deadLettered7d as number,
    oldestDueAt,
  };
}

/** SA-W31: the block is never `unknown`, so a failed part never hides the others. */
export function paymentProblemsStatus(parts: readonly FinanceSectionStatus[]): FinanceSectionStatus {
  return parts.some((status) => status !== 'ok') ? 'partial' : 'ok';
}

/** Ascending, NULL last: a deterministic order. */
function compareNullableAsc(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}
