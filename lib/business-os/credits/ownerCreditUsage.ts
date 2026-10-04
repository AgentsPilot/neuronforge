/**
 * The owner's credits, for the dashboard card (credit deduction slice 6a,
 * workplan §4.4; FR-24, FR-25, FR-28, FR-29; SA SQ-20 to SQ-22, SQ-27).
 *
 * ── WHAT IT ANSWERS ──────────────────────────────────────────────────────────
 * Credits used and left of the owner's OWN plan allowance, for their OWN
 * billing period, split "by you" / "automatic". Read from the credit ledger —
 * never tokens, never dollars.
 *
 * ── WHERE EACH FIGURE COMES FROM ────────────────────────────────────────────
 *   - allowance: the entitlements resolver, through `creditAllowanceForDisplay`
 *     (null = "no allowance", decided there — never "0 of 0");
 *   - period: `creditPeriod.ts` — the plan anchor and the database's own period
 *     rule, strings end to end;
 *   - used and its split: the totals row (C-S6-1): `credits_owner` is "by you",
 *     `credits_scheduled + credits_external` is "automatic", `credits_total` is
 *     used. Only when a period carries corrections (`credits_adjustment ≠ 0`)
 *     are the adjustment rows read, and each is attributed under the trigger of
 *     the charge it corrects (`effectiveFields.ts`); one that cannot be resolved
 *     counts in neither part and is logged.
 *
 * ── TWO CONSUMERS, ONE WINDOW (slice 7a, SA SQ-30) ──────────────────────────
 * `resolveOwnerCreditWindow` is the one place the owner's window (period,
 * trial total or calendar month) and its figures are resolved. The card
 * (`readOwnerCreditUsage`) and the credit history (`ownerCreditHistory.ts`)
 * both read it; the history never computes a period of its own.
 *
 * ── THIS FILE AND THE ENTITLEMENTS MODULE ────────────────────────────────────
 * The ONE file outside the module that imports from it for these surfaces:
 * `getEntitlementService` (`getSnapshot`, never `check`), `resolveAccountId`
 * (the account seam) and `creditAllowanceForDisplay`. Registered as a non-gate
 * importer: it is display only and refuses nothing.
 *
 * ── TENANT ISOLATION ─────────────────────────────────────────────────────────
 * The account comes from the session user only, through `resolveAccountId`.
 * The ledger is read with the owner's RLS client (the owner repository adds
 * `.eq('user_id', …)` on top). Service role is used only by the injected plan
 * anchor read and the pure period function, both in `ownerCreditUsageDeps.ts`.
 *
 * ── FAILURE ──────────────────────────────────────────────────────────────────
 * Any ledger, anchor or period read error, a non-finite figure, or a trial
 * total read that hit its ceiling returns an ERROR — the route answers 500 and
 * the card shows its error line. Never a zero, never a partial sum. An
 * unavailable entitlement snapshot is not an error: the card shows usage with
 * no gauge, and a warning is logged.
 *
 * @module lib/business-os/credits/ownerCreditUsage
 */

import 'server-only';

import { getEntitlementService } from '@/lib/business-os/entitlements/EntitlementService';
import { resolveAccountId } from '@/lib/business-os/entitlements/account';
import { creditAllowanceForDisplay } from '@/lib/business-os/entitlements/creditAllowanceView';
import type {
  BusinessOsCreditOwnerReadRepository,
  OwnerCreditChargeRow,
  OwnerCreditTotalsRow,
  OwnerLedgerWindow,
} from '@/lib/repositories/BusinessOsCreditOwnerReadRepository';
import { computeCreditBalance, roundToLedger } from './creditBalance';
import { nextPeriodStartUtc, resolveCreditPeriod, type CreditPeriodDeps } from './creditPeriod';
import { creditWindowRule, parseLedgerFigure } from './creditWindowRule';
import { resolveEffectiveFields, type EffectiveFieldsInput } from './effectiveFields';
import type { OwnerCreditAllowance, OwnerCreditPeriodKind, OwnerCreditUsage } from './ownerCreditUsageTypes';

type Result<T> = { data: T | null; error: Error | null };

/** The logger methods this module needs; a request's child logger fits. */
export interface OwnerCreditUsageLogger {
  warn: (ctx: Record<string, unknown>, msg: string) => void;
  error: (ctx: Record<string, unknown>, msg: string) => void;
}

export interface OwnerCreditUsageDeps extends CreditPeriodDeps {
  /** The owner repository, built on the CALLER'S RLS client. */
  owner: Pick<
    BusinessOsCreditOwnerReadRepository,
    'findTotalsForPeriod' | 'listTotalsFrom' | 'listAdjustmentsForPeriods' | 'findChargesByActionIds'
  >;
  now?: () => Date;
  /** Tests only. Production reads the entitlement snapshot. */
  readAllowance?: (accountId: string, log: OwnerCreditUsageLogger) => Promise<OwnerCreditAllowance | null>;
}

/** Why a read failed. `code` is for the log; the owner is shown one generic line. */
export class OwnerCreditUsageError extends Error {
  constructor(
    readonly code:
      | 'anchor_read_failed'
      | 'period_read_failed'
      | 'totals_read_failed'
      | 'trial_ceiling'
      | 'adjustments_read_failed'
      | 'adjustments_ceiling'
      | 'originals_read_failed'
      | 'unreadable_figure',
    message: string,
    readonly readError?: unknown
  ) {
    super(message);
    this.name = 'OwnerCreditUsageError';
  }
}

async function readAllowanceFromEntitlements(
  accountId: string,
  log: OwnerCreditUsageLogger
): Promise<OwnerCreditAllowance | null> {
  const snapshot = await getEntitlementService().getSnapshot(accountId);
  if (snapshot.unavailable) {
    // Not an error line on the card: usage is still true without a gauge.
    log.warn({ accountId }, 'Entitlement snapshot unavailable; the credit card shows usage with no allowance');
  }
  return creditAllowanceForDisplay(snapshot);
}

/**
 * A ledger figure as a number. PostgREST may deliver `numeric` as a string;
 * anything that does not parse to a finite number is an unreadable figure —
 * an ERROR, never 0 (SA W6-4).
 */
function figure(value: number | string | null | undefined, column: string): number {
  const parsed = parseLedgerFigure(value);
  if (parsed === null) {
    throw new OwnerCreditUsageError('unreadable_figure', `Unreadable credit figure in ${column}`);
  }
  return parsed;
}

interface Sums {
  used: number;
  byOwner: number;
  automatic: number;
}

function sumTotals(rows: readonly OwnerCreditTotalsRow[]): Sums & { periodsWithCorrections: string[] } {
  const sums = { used: 0, byOwner: 0, automatic: 0 };
  const periodsWithCorrections: string[] = [];
  for (const row of rows) {
    sums.used += figure(row.credits_total, 'credits_total');
    sums.byOwner += figure(row.credits_owner, 'credits_owner');
    sums.automatic += figure(row.credits_scheduled, 'credits_scheduled') + figure(row.credits_external, 'credits_external');
    // The key goes on exactly as read — never re-formatted.
    if (figure(row.credits_adjustment, 'credits_adjustment') !== 0) periodsWithCorrections.push(row.period_start);
  }
  return { ...sums, periodsWithCorrections };
}

/** Attribute each correction under the trigger of the charge it corrects (SQ-22). */
async function attributeCorrections(
  accountId: string,
  periods: readonly string[],
  deps: OwnerCreditUsageDeps,
  log: OwnerCreditUsageLogger
): Promise<{ byOwner: number; automatic: number }> {
  const adjustments = await deps.owner.listAdjustmentsForPeriods(accountId, periods);
  if (adjustments.error || !adjustments.data) {
    throw new OwnerCreditUsageError('adjustments_read_failed', 'Could not read the credit corrections', adjustments.error);
  }
  if (adjustments.data.reachedCeiling) {
    log.warn({ accountId, periods: periods.length }, 'Credit corrections reached the read ceiling; not shown as a partial split');
    throw new OwnerCreditUsageError('adjustments_ceiling', 'Too many credit corrections to read in one period');
  }

  const rows = adjustments.data.rows;
  const originalIds = [
    ...new Set(rows.map((row) => row.adjusts_action_id).filter((id): id is string => typeof id === 'string')),
  ];

  const chargesByActionId = new Map<string, EffectiveFieldsInput>();
  if (originalIds.length > 0) {
    const originals = await deps.owner.findChargesByActionIds(accountId, originalIds);
    if (originals.error || !originals.data) {
      throw new OwnerCreditUsageError('originals_read_failed', 'Could not read the corrected charges', originals.error);
    }
    for (const charge of originals.data) {
      if (charge.action_id) chargesByActionId.set(charge.action_id, charge);
    }
  }

  let byOwner = 0;
  let automatic = 0;
  let unresolved = 0;
  for (const adjustment of rows as readonly OwnerCreditChargeRow[]) {
    const credits = figure(adjustment.credits, 'credits');
    const { effectiveTrigger } = resolveEffectiveFields(adjustment, chargesByActionId);
    if (effectiveTrigger === 'owner') byOwner += credits;
    else if (effectiveTrigger === 'scheduled' || effectiveTrigger === 'external') automatic += credits;
    else unresolved += 1;
  }
  if (unresolved > 0) {
    // Counted in `used` (from the totals row), in neither part — never guessed.
    log.warn({ accountId, unresolved }, 'Credit corrections with no resolvable charge; counted in used, in neither part');
  }
  return { byOwner, automatic };
}

/**
 * The window the owner's credits are read over, resolved ONCE for both owner
 * surfaces (credit deduction slice 7a, SA SQ-30): the dashboard card and the
 * credit history. The ledger-row read and the totals read take the same
 * `ledger` predicate, so the history can only ever list the rows the card's
 * total was summed from.
 */
export interface OwnerCreditWindow {
  /** From `resolveAccountId(userId)` only. */
  accountId: string;
  kind: OwnerCreditPeriodKind;
  /** The predicate BOTH the totals read and the ledger-row read use. */
  ledger: OwnerLedgerWindow;
  /** The window key, the EXACT string read: the period key, or the trial anchor. */
  key: string;
  /** The plan anchor, verbatim, or null with no plan row. */
  anchor: string | null;
  /** The current period key, verbatim. */
  periodStart: string;
  allowance: OwnerCreditAllowance | null;
  /**
   * When the next period starts (ISO instant), DISPLAY ONLY. Computed once here
   * (SA W6-5: null without an allowance, and for a trial or a calendar month):
   * the card's `resetsOn` and the history's `endsBefore` (SA W7-5).
   */
  resetsOn: string | null;
  /** Exact, 6 dp, from the totals row(s) — never a page sum. */
  used: number;
  usedByOwner: number;
  usedAutomatic: number;
}

/** Resolves the window; THROWS `OwnerCreditUsageError`. Callers own the logging. */
async function computeOwnerCreditWindow(
  accountId: string,
  now: Date,
  deps: OwnerCreditUsageDeps,
  log: OwnerCreditUsageLogger
): Promise<OwnerCreditWindow> {
  const [allowanceRead, periodRead] = await Promise.all([
    (deps.readAllowance ?? readAllowanceFromEntitlements)(accountId, log),
    resolveCreditPeriod(accountId, now, deps),
  ]);
  if (periodRead.error || !periodRead.data) {
    throw new OwnerCreditUsageError('period_read_failed', 'Could not resolve the credit period', periodRead.error);
  }
  const period = periodRead.data;

  // No plan row means no allowance, whatever a cached snapshot still says. The
  // rule is shared with the admin column and the low-line record (slice 8a).
  const rule = creditWindowRule({ anchor: period.anchor, allowance: allowanceRead });
  const allowance = rule.allowance;

  let kind: OwnerCreditPeriodKind;
  let ledger: OwnerLedgerWindow;
  let totals: OwnerCreditTotalsRow[];

  if (rule.mode === 'trial_total' && period.anchor !== null) {
    // A one-off (trial) allowance: every period from the anchor on (V-7).
    kind = 'trial_total';
    ledger = { kind: 'from', fromPeriodStart: period.anchor };
    const read = await deps.owner.listTotalsFrom(accountId, ledger.fromPeriodStart);
    if (read.error || !read.data) {
      throw new OwnerCreditUsageError('totals_read_failed', 'Could not read the credit totals', read.error);
    }
    if (read.data.reachedCeiling) {
      // An anomaly (a trial allowance on a years-old anchor): never a partial total (SA W6-6).
      log.warn({ accountId }, 'Trial credit totals reached the read ceiling; not shown as a partial total');
      throw new OwnerCreditUsageError('trial_ceiling', 'Too many credit periods for a trial total');
    }
    totals = read.data.rows;
  } else {
    kind = period.kind;
    ledger = { kind: 'period', periodStart: period.periodStart };
    const read = await deps.owner.findTotalsForPeriod(accountId, ledger.periodStart);
    if (read.error) {
      throw new OwnerCreditUsageError('totals_read_failed', 'Could not read the credit totals', read.error);
    }
    // No row yet: nothing charged this period.
    totals = read.data ? [read.data] : [];
  }

  const sums = sumTotals(totals);
  let byOwner = sums.byOwner;
  let automatic = sums.automatic;
  if (sums.periodsWithCorrections.length > 0) {
    const corrections = await attributeCorrections(accountId, sums.periodsWithCorrections, deps, log);
    byOwner += corrections.byOwner;
    automatic += corrections.automatic;
  }

  // No reset date without an allowance (SA W6-5): it would promise a refill.
  const resetsOn =
    allowance !== null && kind === 'monthly' && period.anchor !== null
      ? nextPeriodStartUtc(period.anchor, period.periodStart)
      : null;

  return {
    accountId,
    kind,
    ledger,
    key: ledger.kind === 'from' ? ledger.fromPeriodStart : ledger.periodStart,
    anchor: period.anchor,
    periodStart: period.periodStart,
    allowance,
    resetsOn,
    used: roundToLedger(sums.used),
    usedByOwner: roundToLedger(byOwner),
    usedAutomatic: roundToLedger(automatic),
  };
}

function logReadFailure(log: OwnerCreditUsageLogger, error: unknown, accountId: string, message: string): Error {
  const err = error instanceof Error ? error : new Error(String(error));
  log.error(
    {
      err,
      accountId,
      code: error instanceof OwnerCreditUsageError ? error.code : 'unexpected',
      readError: error instanceof OwnerCreditUsageError ? error.readError : undefined,
    },
    message
  );
  return err;
}

/**
 * The owner's credit window and its figures, for the credit history (slice 7a).
 * Never throws; `{ data, error }`.
 */
export async function resolveOwnerCreditWindow(
  userId: string,
  deps: OwnerCreditUsageDeps,
  log: OwnerCreditUsageLogger
): Promise<Result<OwnerCreditWindow>> {
  // The ONLY account this can read: the session user's, through the seam.
  const accountId = resolveAccountId(userId);
  const now = (deps.now ?? (() => new Date()))();
  try {
    return { data: await computeOwnerCreditWindow(accountId, now, deps, log), error: null };
  } catch (error) {
    return { data: null, error: logReadFailure(log, error, accountId, 'Owner credit window read failed') };
  }
}

/** The owner's credit usage for the card. Never throws; `{ data, error }`. */
export async function readOwnerCreditUsage(
  userId: string,
  deps: OwnerCreditUsageDeps,
  log: OwnerCreditUsageLogger
): Promise<Result<OwnerCreditUsage>> {
  // The ONLY account this can read: the session user's, through the seam.
  const accountId = resolveAccountId(userId);
  const now = (deps.now ?? (() => new Date()))();

  try {
    const window = await computeOwnerCreditWindow(accountId, now, deps, log);
    const granted = 0;
    return {
      data: {
        period: { kind: window.kind, resetsOn: window.resetsOn },
        allowance: window.allowance ? { amount: window.allowance.amount, per: window.allowance.per } : null,
        used: window.used,
        usedByOwner: window.usedByOwner,
        usedAutomatic: window.usedAutomatic,
        granted,
        remaining: computeCreditBalance({ allowance: window.allowance?.amount ?? null, granted, used: window.used }),
      },
      error: null,
    };
  } catch (error) {
    return { data: null, error: logReadFailure(log, error, accountId, 'Owner credit usage read failed') };
  }
}
