/**
 * One admin audit entry when an account's plan credits drop below the low line
 * (credit deduction slice 8b; FR-49, FR-50; BD-22, BD-25; SA SQ-44 to SQ-46).
 *
 * ── WHEN IT RUNS ─────────────────────────────────────────────────────────────
 * Called once by `aiChargeRecorder.ts` `write()`, after a charge is RECORDED
 * (`recorded: true`), only when the charge went into a plan period
 * (`anchorSource === 'plan'`) and carries credits. Never on a duplicate, a
 * failed or timed-out write, or an uncharged action.
 *
 * ── WHAT IT DECIDES ──────────────────────────────────────────────────────────
 * "Crossed" means exactly: the SHOWN percentage left (the card's own BD-20
 * rounding, `creditPercentLeft`) was at or above `LOW_LINE_PERCENT` before this
 * charge and is below it after. Measured against the PLAN allowance only
 * (BD-25); credit lots are never read. No cut-off is defined here.
 *
 * ── ONCE PER PERIOD, DERIVED (SQ-45) ─────────────────────────────────────────
 * Within one period (or one trial) the totals only rise, so exactly one charge
 * can straddle the line. Nothing is stored: no marker, no "seen" set, no
 * audit-trail pre-read. Known limits: KI-21 (two charges committing together at
 * the line), KI-22 (an allowance changed mid-period).
 *
 * ── TIME AND FAILURE (FR-50) ─────────────────────────────────────────────────
 * Reads run under `CREDIT_LOW_LINE_READ_BUDGET_MS`, raced, the timer `unref`'d
 * and always cleared. The read phase and the write phase are separate: a read
 * that answers after the budget is discarded with the race, so it can never
 * write an entry. The write is `logAndFlush` (its own 2 s bound). NEVER throws:
 * every failure is one `warn` (`bos_credit_low_line_check_failed`).
 *
 * ── READS (SQ-44) ────────────────────────────────────────────────────────────
 * The charge's OWN `periodStart` / `anchorSource`, never re-derived from "now".
 * Allowance from the entitlement snapshot (30 s cache) through the account
 * seam; monthly: one totals read for the charge's key; trial: the anchor, then
 * every totals row from it. Service-role owner reads, wired in
 * `creditLowLineDeps.ts` (documented there).
 *
 * ── THIS FILE AND THE ENTITLEMENTS MODULE ────────────────────────────────────
 * Imports `getEntitlementService` (`getSnapshot` only, never `check()` /
 * `decide()`), `resolveAccountId` and `creditAllowanceForDisplay`. Registered
 * as a non-gate importer: it refuses nothing.
 *
 * Logs carry ids, codes and percentages only — never owner text.
 *
 * @module lib/business-os/credits/creditLowLine
 */

import 'server-only';

import { logAndFlush } from '@/lib/audit/boundedAuditFlush';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { getEntitlementService } from '@/lib/business-os/entitlements/EntitlementService';
import { resolveAccountId } from '@/lib/business-os/entitlements/account';
import { creditAllowanceForDisplay } from '@/lib/business-os/entitlements/creditAllowanceView';
import { createLogger } from '@/lib/logger';
import { platformActorUuid } from '@/lib/platformAccount';
import type { BusinessOsCreditOwnerReadRepository } from '@/lib/repositories/BusinessOsCreditOwnerReadRepository';
import { roundToLedger } from './creditBalance';
import { creditPercentLeft, LOW_LINE_PERCENT, type ShownPercentLeft } from './creditBands';
import { creditLowLineDeps } from './creditLowLineDeps';
import { creditWindowRule, parseLedgerFigure } from './creditWindowRule';
import type { OwnerCreditAllowance } from './ownerCreditUsageTypes';

const logger = createLogger({ module: 'BosCreditLowLine' });

/** SA SQ-44: the read budget, separate from and after the charge's write budget. */
export const CREDIT_LOW_LINE_READ_BUDGET_MS = 500;

export interface CreditLowLineInput {
  /** `record.accountId`: validated by `runAiAction` from its own identities, never caller input. */
  accountId: string;
  /** This charge's credits (6 dp). */
  credits: number;
  /** The charge's own period key, verbatim. */
  periodStart: string;
  anchorSource: 'plan' | 'calendar_month';
  actionId: string;
  actionType: string;
  trigger: 'owner' | 'scheduled' | 'external';
  /** The recorder's `AI_CHARGE_SERVICE`, passed in so this file never imports the recorder. */
  chargeService: string;
}

type Result<T> = { data: T | null; error: Error | null };

export interface CreditLowLineDeps {
  findPeriodAnchor(accountId: string): Promise<Result<string | null>>;
  owner: Pick<BusinessOsCreditOwnerReadRepository, 'findTotalsForPeriod' | 'listTotalsFrom'>;
  /** Test seam. Default: the entitlement snapshot through the account seam. */
  readAllowance?(accountId: string): Promise<OwnerCreditAllowance | null>;
}

// ── The crossing decision (pure) ─────────────────────────────────────────────

/** True when a shown percentage is under the low line: the card's red band, by the same rule. */
export function isBelowLowLine(shown: ShownPercentLeft): boolean {
  return shown.kind === 'less_than_one' || shown.value < LOW_LINE_PERCENT;
}

export type LowLineCrossing =
  | { crossed: true; before: ShownPercentLeft; after: ShownPercentLeft }
  | { crossed: false; reason: 'no_allowance' | 'already_below' | 'still_above' | 'anomaly' };

/** Did the shown percentage go from at-or-above the low line to below it? */
export function crossedLowLine(usedBefore: number, usedAfter: number, allowance: number): LowLineCrossing {
  // A total smaller than this very charge means the read did not see the write.
  if (!Number.isFinite(usedBefore) || !Number.isFinite(usedAfter) || usedBefore < 0 || usedAfter < usedBefore) {
    return { crossed: false, reason: 'anomaly' };
  }
  const before = creditPercentLeft(usedBefore, allowance);
  const after = creditPercentLeft(usedAfter, allowance);
  if (!before || !after) return { crossed: false, reason: 'no_allowance' };
  if (isBelowLowLine(before.shown)) return { crossed: false, reason: 'already_below' };
  if (!isBelowLowLine(after.shown)) return { crossed: false, reason: 'still_above' };
  return { crossed: true, before: before.shown, after: after.shown };
}

/** A shown percentage as the audit entry records it. */
function recorded(shown: ShownPercentLeft): number | 'less_than_one' {
  return shown.kind === 'less_than_one' ? 'less_than_one' : shown.value;
}

// ── Reads ────────────────────────────────────────────────────────────────────

type FailReason = 'timeout' | 'read_failed' | 'ceiling' | 'unreadable_figure' | 'anomaly' | 'exception';

type Figures =
  | { status: 'ready'; allowance: number; periodKind: 'monthly' | 'trial_total'; usedAfter: number }
  | { status: 'skip'; reason: 'no_allowance' | 'no_plan_row' }
  | { status: 'fail'; reason: FailReason; errCode?: string };

const SAFE_CODE = /^[A-Za-z0-9_.:-]{1,64}$/;

/** A short error code safe to log: the error's `code`, else its class name. Never its message. */
function errCodeOf(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const { code, name } = error as { code?: unknown; name?: unknown };
  if (typeof code === 'string' && SAFE_CODE.test(code)) return code;
  if (typeof name === 'string' && SAFE_CODE.test(name)) return name;
  return undefined;
}

async function readAllowanceFromEntitlements(accountId: string): Promise<OwnerCreditAllowance | null> {
  const snapshot = await getEntitlementService().getSnapshot(resolveAccountId(accountId));
  return creditAllowanceForDisplay(snapshot);
}

async function readFigures(input: CreditLowLineInput, deps: CreditLowLineDeps, signal: AbortSignal): Promise<Figures> {
  const allowanceRead = await (deps.readAllowance ?? readAllowanceFromEntitlements)(input.accountId);
  if (!allowanceRead) return { status: 'skip', reason: 'no_allowance' };

  if (allowanceRead.per === 'month') {
    // SA Q-B1: `anchorSource === 'plan'` is the database's own statement that a
    // plan row existed at the write, so the charge's key stands in for "anchor
    // present" and no anchor read is spent. In `period` mode the rule only
    // tests that the anchor is present; its value is never used.
    const rule = creditWindowRule({
      anchor: input.anchorSource === 'plan' ? input.periodStart : null,
      allowance: allowanceRead,
    });
    if (!rule.allowance) return { status: 'skip', reason: 'no_plan_row' };
    const read = await deps.owner.findTotalsForPeriod(input.accountId, input.periodStart, { signal });
    if (read.error) return { status: 'fail', reason: 'read_failed', errCode: errCodeOf(read.error) };
    // The charge was just written into this row: no row is an anomaly, never "nothing used".
    if (!read.data) return { status: 'fail', reason: 'anomaly' };
    const used = parseLedgerFigure(read.data.credits_total);
    if (used === null) return { status: 'fail', reason: 'unreadable_figure' };
    return { status: 'ready', allowance: rule.allowance.amount, periodKind: 'monthly', usedAfter: roundToLedger(used) };
  }

  // A one-off (trial) allowance: summed over every period from the anchor on.
  const anchorRead = await deps.findPeriodAnchor(input.accountId);
  if (anchorRead.error) return { status: 'fail', reason: 'read_failed', errCode: errCodeOf(anchorRead.error) };
  const anchor = anchorRead.data ?? null;
  const rule = creditWindowRule({ anchor, allowance: allowanceRead });
  if (!rule.allowance || anchor === null) return { status: 'skip', reason: 'no_plan_row' };
  if (rule.mode !== 'trial_total') return { status: 'fail', reason: 'anomaly' };

  const read = await deps.owner.listTotalsFrom(input.accountId, anchor, { signal });
  if (read.error || !read.data) return { status: 'fail', reason: 'read_failed', errCode: errCodeOf(read.error) };
  // Never a partial sum (as the card).
  if (read.data.reachedCeiling) return { status: 'fail', reason: 'ceiling' };
  let sum = 0;
  for (const row of read.data.rows) {
    const figure = parseLedgerFigure(row.credits_total);
    if (figure === null) return { status: 'fail', reason: 'unreadable_figure' };
    sum += figure;
  }
  return { status: 'ready', allowance: rule.allowance.amount, periodKind: 'trial_total', usedAfter: roundToLedger(sum) };
}

type BudgetResult<T> = { timedOut: false; value: T } | { timedOut: true };

/**
 * Run `work` with a time budget (the recorder's `withWriteBudget` shape). On
 * time-out the signal aborts the owner reads and the promise resolves
 * `{ timedOut: true }`; the work's late result is discarded. The timer is
 * `unref()`ed and always cleared.
 */
async function withReadBudget<T>(budgetMs: number, work: (signal: AbortSignal) => Promise<T>): Promise<BudgetResult<T>> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<BudgetResult<T>>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ timedOut: true });
    }, budgetMs);
    (timer as { unref?: () => void }).unref?.();
  });
  try {
    // An async IIFE turns a synchronous throw inside `work` into a rejection,
    // and `Promise.race` subscribes to it, so a late rejection stays handled.
    const read = (async () => ({ timedOut: false as const, value: await work(controller.signal) }))();
    return await Promise.race([read, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// ── The check ────────────────────────────────────────────────────────────────

/**
 * Decide whether this recorded charge crossed the low line and, if so, write
 * one audit entry. Resolves within the read budget plus, on a crossing, the
 * audit flush bound. NEVER throws, never rejects.
 */
export async function checkCreditLowLine(input: CreditLowLineInput, deps?: CreditLowLineDeps): Promise<void> {
  const ids = { accountId: input.accountId, actionId: input.actionId, actionType: input.actionType };
  try {
    // Zero reads: no plan row means no allowance; a charge of nothing moves nothing.
    if (input.anchorSource !== 'plan' || !(input.credits > 0)) {
      logger.debug({ event: 'bos_credit_low_line_skipped', reason: 'not_applicable', ...ids }, 'Credit low-line check not needed');
      return;
    }

    const resolved = deps ?? creditLowLineDeps();
    const outcome = await withReadBudget(CREDIT_LOW_LINE_READ_BUDGET_MS, (signal) => readFigures(input, resolved, signal));
    if (outcome.timedOut) {
      gaveUp(ids, 'timeout');
      return;
    }

    const figures = outcome.value;
    if (figures.status === 'skip') {
      logger.debug({ event: 'bos_credit_low_line_skipped', reason: figures.reason, ...ids }, 'Credit low-line check not needed');
      return;
    }
    if (figures.status === 'fail') {
      gaveUp(ids, figures.reason, figures.errCode);
      return;
    }

    const usedBefore = roundToLedger(figures.usedAfter - roundToLedger(input.credits));
    const crossing = crossedLowLine(usedBefore, figures.usedAfter, figures.allowance);
    if (!crossing.crossed) {
      if (crossing.reason === 'anomaly') gaveUp(ids, 'anomaly');
      else logger.debug({ event: 'bos_credit_low_line_not_crossed', reason: crossing.reason, ...ids }, 'Low line not crossed');
      return;
    }

    await writeCrossing(input, figures.periodKind, figures.allowance, crossing.before, crossing.after);
  } catch (err) {
    gaveUp(ids, 'exception', errCodeOf(err));
  }
}

async function writeCrossing(
  input: CreditLowLineInput,
  periodKind: 'monthly' | 'trial_total',
  allowance: number,
  before: ShownPercentLeft,
  after: ShownPercentLeft
): Promise<void> {
  // SA SQ-46: ids and figures only; no owner text, tokens, dollars or used credits.
  const details = {
    periodStart: input.periodStart,
    periodKind,
    allowance,
    percentBefore: recorded(before),
    percentAfter: recorded(after),
    lowLine: LOW_LINE_PERCENT,
    service: input.chargeService,
    actionId: input.actionId,
    actionType: input.actionType,
    trigger: input.trigger,
  };

  // First, so the event survives even if the audit flush does not (KI-23).
  logger.info(
    { event: 'bos_credit_low_line_crossed', accountId: input.accountId, ...details },
    'Business OS credits dropped below the low line'
  );

  // The registration decides the severity (SA SQ-46): none is passed here.
  // The actor is the UUID-checked platform actor (SA C-B1): a null actor would
  // be stored as the account, and a non-UUID would fail the whole batch.
  await logAndFlush(
    {
      action: AUDIT_EVENTS.BOS_CREDIT_LOW_LINE_CROSSED,
      entityType: 'business_os_credit_period',
      entityId: input.accountId,
      userId: input.accountId,
      actorId: platformActorUuid(),
      details,
    },
    logger,
    { reason: 'credit low line crossed', continues: 'the AI action continues' }
  );
}

function gaveUp(ids: Record<string, unknown>, reason: FailReason, errCode?: string): void {
  logger.warn(
    { event: 'bos_credit_low_line_check_failed', reason, errCode: errCode ?? null, ...ids },
    'Credit low-line check gave up; the AI action continues'
  );
}
