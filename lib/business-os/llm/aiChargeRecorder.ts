// lib/business-os/llm/aiChargeRecorder.ts
//
// Business OS credit deduction, slice 3b-ii: write ONE confirmed charge row for
// one AI action (requirement FR-13, FR-15, FR-16; SA SQ-3, SQ-11 condition 1).
//
// Called once, at the end of `runAiAction` (aiActionAudit.ts), after the audit
// entry is queued and the unpriced-call check has run, and before the action's
// value is returned or its error rethrown. It:
//
//   - builds the record with 3a's `buildAiChargeRecord` from the SAME decision
//     the audit entry took (validated identities and failure, SA N-7), so the
//     charge and the entry can never disagree on succeeded / failed;
//   - writes it through `BusinessOsCreditChargeRepository` only (CLAUDE.md
//     rule 1), with `service` from `AI_CHARGE_SERVICE` and never from input
//     (SA C-6);
//   - is AWAITED, but inside a `BOS_AI_CHARGE_WRITE_BUDGET_MS` budget: the
//     HTTP call is cancelled client-side when the budget runs out, and it is
//     never attempted a second time (SA Q-11);
//   - NEVER throws and never rejects. Every failure is one `error` log
//     (`bos_ai_charge_write_failed` or `bos_ai_charge_not_written`), never an
//     exception into the action. It cannot change the action's value or error,
//     and cannot delay it beyond the write budget, plus — after a RECORDED
//     charge into a plan period — at most `CREDIT_LOW_LINE_READ_BUDGET_MS`
//     for the low-line check, plus the audit flush bound on the one charge per
//     period that crosses the low line (slice 8b; proofs NI-1 to NI-5 in
//     `__tests__/aiActionAudit.test.ts`, NI-6 to NI-8 in
//     `__tests__/aiChargeRecorder.test.ts`).
//
// Import graph (SA C-5): only TYPES come from `aiActionAudit.ts`, so the two
// modules form no runtime cycle. A source guard in the tests pins it.
//
// Server-only: the repository holds the service-role client.
//
// Logs carry ids and codes only, never owner text (bos-llm-call-standards
// Standard 5).

import type { UsageCallRecord } from '@/lib/ai/usageScope';
import { checkCreditLowLine } from '@/lib/business-os/credits/creditLowLine';
import { createLogger } from '@/lib/logger';
import {
  businessOsCreditChargeRepository,
  type BusinessOsCreditChargeInput,
} from '@/lib/repositories/BusinessOsCreditChargeRepository';
import type { AiActionSpec } from './aiActionAudit';
import { buildAiChargeRecord, type AiChargeRecord } from './chargeResolver';

const logger = createLogger({ module: 'BosAiChargeRecorder' });

/**
 * The one `service` value the AI recorder writes (SA C-6). The ledger is not
 * AI-specific (user decision 2026-09-29); every other service will name its own.
 * Never taken from caller input, a parameter or the record builder's input.
 */
export const AI_CHARGE_SERVICE = 'ai' as const;

/** SQ-3: "a short time budget, ≤ 2 s". 1.5 s leaves margin under SA's ceiling. */
export const BOS_AI_CHARGE_WRITE_BUDGET_MS = 1_500;

/** Everything the recorder needs, decided by `runAiAction` before the call. */
export interface AiChargeInput {
  spec: AiActionSpec;
  /** The invocation's id, minted by `runAiAction` (SA-B1). The idempotency key. */
  actionId: string;
  /** The account as `runAiAction` holds it, for the logs only. */
  accountId: string | undefined;
  /**
   * The action's decision, the one the audit entry took (SA N-7): the validated
   * identities (`null` = invalid) and the failure. `undefined` when deciding it
   * threw, which is a defect: no charge is written and one `error` says so.
   */
  decision: { identities: { accountId: string } | null; failure: { code: string } | undefined } | undefined;
  /** The declaration's `isCharged` for `spec.actionType` (FR-4). */
  isCharged: boolean;
  calls: readonly UsageCallRecord[];
}

/** Why a charge was not written, in the `bos_ai_charge_not_written` event. */
type NotWrittenReason = 'invalid_identity' | 'unpriceable' | 'undecided';

/** Why a write failed, in the `bos_ai_charge_write_failed` event (FR-16). */
type WriteFailedReason = 'db_error' | 'timeout' | 'exception';

const SAFE_CODE = /^[A-Za-z0-9_.:-]{1,64}$/;

/**
 * An error code only the database side produces: a 5-character SQLSTATE
 * (`23514`, `P0001`, `42883`, `XX000`) or a PostgREST code (`PGRST202`).
 * SA 3b-ii S-1. The first character is limited to the leads PostgreSQL's
 * SQLSTATE classes use (a digit, or F0 / HV / P0 / XX), because a bare
 * `[0-9A-Z]{5}` also matches 5-letter Node network codes such as `EPIPE` and
 * `EPERM`. A code that does not match is logged with an unknown fate, which is
 * the safe direction: slice 4's leak check reconciles it either way.
 */
const DB_ERROR_CODE = /^(?:[0-9FHPX][0-9A-Z]{4}|PGRST\d+)$/;

/** A short error code safe to log: the error's `code`, else its class name. Never its message. */
function errCodeOf(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const { code, name } = error as { code?: unknown; name?: unknown };
  if (typeof code === 'string' && SAFE_CODE.test(code)) return code;
  if (typeof name === 'string' && SAFE_CODE.test(name)) return name;
  return undefined;
}

type BudgetResult<T> = { timedOut: false; value: T } | { timedOut: true };

/**
 * Run `work` with a time budget (SA Q-11: written locally, the same shape as
 * `withReadBudget` in modelSettings.ts). On time-out the signal aborts the
 * HTTP call and the promise resolves `{ timedOut: true }`. The timer is
 * `unref()`ed and always cleared, so it keeps no process alive and none is left
 * pending. A rejection of `work` propagates to the caller's `try`.
 */
async function withWriteBudget<T>(budgetMs: number, work: (signal: AbortSignal) => Promise<T>): Promise<BudgetResult<T>> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<BudgetResult<T>>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ timedOut: true });
    }, budgetMs);
    // Not every runtime's timer has unref (a fake timer may not).
    (timer as { unref?: () => void }).unref?.();
  });
  try {
    // An async IIFE turns a synchronous throw inside `work` into a rejection.
    const written = (async () => ({ timedOut: false as const, value: await work(controller.signal) }))();
    // `Promise.race` subscribes to `written`, so a write that rejects AFTER the
    // budget won is still a handled rejection, never a process-level event.
    return await Promise.race([written, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Write one action's charge. Resolves within `BOS_AI_CHARGE_WRITE_BUDGET_MS`
 * (plus the synchronous pricing). NEVER throws, never rejects.
 */
export async function recordAiCharge(input: AiChargeInput): Promise<void> {
  const ids = {
    service: AI_CHARGE_SERVICE,
    accountId: input.accountId ?? null,
    area: input.spec.area,
    actionType: input.spec.actionType,
    groupId: input.spec.groupId,
    actionId: input.actionId,
  };

  try {
    if (!input.decision) {
      notWritten(ids, 'undecided');
      return;
    }

    const built = buildAiChargeRecord({
      spec: input.spec,
      actionId: input.actionId,
      identities: input.decision.identities,
      isCharged: input.isCharged,
      calls: input.calls,
      failure: input.decision.failure,
    });

    if ('skipped' in built) {
      if (built.skipped === 'no_calls' || built.skipped === 'not_charged') {
        logger.debug({ event: 'bos_ai_charge_skipped', reason: built.skipped, ...ids }, 'AI charge not needed');
      } else {
        notWritten(ids, built.skipped);
      }
      return;
    }

    await write(built.record, built.fallbackCallCount, ids);
  } catch (err) {
    // A defect in the builder or the pricing tables (SA N-4), before any write
    // was sent: logged once, never thrown into the action.
    writeFailed(ids, 'exception', errCodeOf(err), 'not_written');
  }
}

async function write(
  record: AiChargeRecord,
  fallbackCallCount: number,
  ids: Record<string, unknown> & { actionId: string }
): Promise<void> {
  // Field by field (tenant-isolation-guard Step 3); `service` is the constant (SA C-6).
  const charge: BusinessOsCreditChargeInput = {
    actionId: record.actionId,
    accountId: record.accountId,
    groupId: record.groupId,
    service: AI_CHARGE_SERVICE,
    actionType: record.actionType,
    trigger: record.trigger,
    outcome: record.outcome,
    credits: record.credits,
    costUsd: record.costUsd,
    creditValueVersion: record.creditValueVersion,
    isFallbackPriced: record.isFallbackPriced,
  };

  let outcome: BudgetResult<Awaited<ReturnType<typeof businessOsCreditChargeRepository.recordCharge>>>;
  try {
    outcome = await withWriteBudget(BOS_AI_CHARGE_WRITE_BUDGET_MS, (signal) =>
      businessOsCreditChargeRepository.recordCharge(charge, { signal })
    );
  } catch (err) {
    // The repository returns errors rather than throwing; a throw here is a
    // defect. The call may have been sent, so its fate is unknown.
    writeFailed(ids, 'exception', errCodeOf(err), 'unknown');
    return;
  }

  if (outcome.timedOut) {
    // SA N-5: cancelling the HTTP call does not cancel the database transaction,
    // so this write may still have committed. Its fate is UNKNOWN, not "not
    // charged"; the row is idempotent on the action id and slice 4's leak
    // check reconciles either way.
    writeFailed(ids, 'timeout', undefined, 'unknown');
    return;
  }

  const { data, error } = outcome.value;
  if (error || !data) {
    // Only a DATABASE-shaped code (a SQLSTATE such as 23514, or a PostgREST
    // PGRSTnnn) means the server answered and the transaction did not commit.
    // postgrest-js maps a fetch failure to a plain object whose `code` is a
    // string too, usually '' and sometimes a Node code such as ECONNRESET
    // (SA 3b-ii S-1): that is a network failure, possibly after the commit, so
    // its fate is unknown. An empty code is logged as 'network', not null.
    const rawCode = (error as { code?: unknown } | null)?.code;
    const isDbCode = typeof rawCode === 'string' && DB_ERROR_CODE.test(rawCode);
    const errCode = rawCode === '' ? 'network' : errCodeOf(error);
    writeFailed(ids, 'db_error', errCode, isDbCode ? 'not_written' : 'unknown');
    return;
  }

  if (!data.recorded) {
    // SA 3b-i N-4: an action id already in the ledger (in-process ids make this
    // unexpected). Nothing was written and no total moved; kept visible.
    logger.info({ event: 'bos_ai_charge_duplicate', recorded: false, ...ids }, 'AI charge already recorded for this action id');
    return;
  }

  if (data.anchorSource === 'calendar_month') {
    // SA Q-3: no plan row, so the charge went to the UTC calendar month.
    logger.warn({ event: 'bos_ai_charge_no_plan_row', periodStart: data.periodStart, ...ids }, 'AI charge recorded without a plan row');
  }

  if (record.isFallbackPriced) {
    // One per CHARGE, from the builder's count (SA D-1: no second pricing). The
    // per-CALL `bos_llm_call_unpriced` error stays the one loud event (S2 N-4).
    logger.info(
      {
        event: 'bos_ai_charge_fallback_priced',
        actionId: record.actionId,
        groupId: record.groupId,
        accountId: record.accountId,
        actionType: record.actionType,
        fallbackCallCount,
      },
      'AI charge recorded at the fallback price'
    );
  }

  logger.debug({ event: 'bos_ai_charge_recorded', credits: record.credits, ...ids }, 'AI charge recorded');

  // Slice 8b (SA SQ-44): did this recorded charge take the account below the
  // low line? Only for a charge into a plan period that carries credits — a
  // calendar-month charge has no plan row, so no allowance (NI-8). Awaited and
  // bounded inside the hook (reads ≤ CREDIT_LOW_LINE_READ_BUDGET_MS, then the
  // audit flush on a crossing); it never throws, and the catch is defence in depth.
  if (data.anchorSource === 'plan' && record.credits > 0) {
    try {
      await checkCreditLowLine({
        accountId: record.accountId,
        credits: record.credits,
        periodStart: data.periodStart,
        anchorSource: data.anchorSource,
        actionId: record.actionId,
        actionType: record.actionType,
        trigger: record.trigger,
        chargeService: AI_CHARGE_SERVICE,
      });
    } catch (err) {
      logger.error(
        { event: 'bos_credit_low_line_check_failed', reason: 'exception', errCode: errCodeOf(err) ?? null, ...ids },
        'Credit low-line check threw; the AI action continues'
      );
    }
  }
}

function notWritten(ids: Record<string, unknown>, reason: NotWrittenReason): void {
  // FR-16: an uncharged action is discoverable by its own event name.
  logger.error({ event: 'bos_ai_charge_not_written', reason, ...ids }, 'AI charge not written');
}

function writeFailed(
  ids: Record<string, unknown>,
  reason: WriteFailedReason,
  errCode: string | undefined,
  fate: 'unknown' | 'not_written' = 'not_written'
): void {
  // FR-16: the account, area, action type, grouping id and action id, at error.
  logger.error(
    { event: 'bos_ai_charge_write_failed', reason, errCode: errCode ?? null, fate, ...ids },
    'AI charge write failed'
  );
}
