/**
 * Execute a set of already-approved, already-frozen writes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS SHARED CODE
 *
 * Two callers need to apply exactly the same writes in exactly the same way:
 * the chat, when a user replies "yes" to a confirmation card, and a saved plan,
 * when a user runs one again. They are the same operation — the difference is
 * only where the frozen steps were parked in the meantime.
 *
 * It lives here rather than in the route because duplicating it is how the two
 * drift, and the parts that would drift are the ones that matter: whether the
 * rows are re-queried (they must not be), whether branding is resolved once or
 * per recipient, and whether partial failure is reported honestly.
 *
 * THE INVARIANT: nothing in this file runs a query to decide WHO to act on. The
 * rows travel with the steps, frozen at the moment the user was shown them.
 * Re-querying here is precisely how a user approves 12 recipients and emails 40.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/business-os/bizql/mutate
 */

import { createLogger } from '@/lib/logger';
import { resolveEmailBranding } from '@/lib/email/branding';
import { getActionLog } from './ActionLog';
import { executeForEach } from './ForEachExecutor';
import { executeMutate } from './MutateExecutor';
import type { ForEachQuery, MutateQuery, QueryContext, QueryRow } from '../types';

const logger = createLogger({ module: 'BizQLApplyWrites' });

/**
 * Perform ONE write, at most once.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SINGLE WRITE NEEDS THIS TOO
 *
 * `ActionLog.claim()` was wired only into the fan-out, on the reasoning that
 * emailing forty people twice is the expensive mistake. But a single write is
 * reached through the same double-submittable surfaces — a double-tapped Confirm
 * button, a double-tapped row chip, a retried request — and every guard against
 * it lived in the client or in the ORDER of two server statements. Both are
 * application-level "have we done this?" checks, and those lose to concurrency:
 * two requests can each read the parked write before either clears it, and then
 * both apply it. Marking the same invoice paid twice is survivable; charging,
 * sending or cancelling twice is not, and the catalog is free to add such an
 * action tomorrow.
 *
 * The guarantee is the UNIQUE index on `idempotency_key`, exactly as it is for
 * the fan-out. This function is the only thing that changes: nothing decides
 * WHETHER to act by reading a row it wrote itself.
 *
 * SCOPE. The key is `planId|stepId`, so it is stable for one approval and
 * different across approvals — which is why `planId` must be the id of the thing
 * the user approved (a confirmation, a choice, a fill, a saved-plan run) and
 * never a per-request id. A caller with no such id has nothing to deduplicate
 * against and should call `executeMutate` directly; see the direct-apply branch
 * in the chat route, which says so.
 *
 * A FAILED write keeps its claim, like the fan-out's items do. Retrying the same
 * approval is therefore refused — which costs nothing in practice, because every
 * caller clears the approval before applying, so a retry always arrives under a
 * new id.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export async function applyClaimedMutate(args: {
  step: MutateQuery;
  ctx: QueryContext;
  /** The approval this write belongs to. Stable per approval, unique across them. */
  planId: string;
  /** Which step within it. Index-based when the step carries no id of its own. */
  stepId: string;
  options?: Parameters<typeof executeMutate>[2];
}): Promise<{ preview: string; skipped: boolean }> {
  const { step, ctx, planId, stepId, options = {} } = args;
  const log = getActionLog();

  const fallback = `${step.entity}.${step.action}`;

  const claim = await log.claim({
    userId: ctx.userId,
    planId,
    stepId,
    entity: step.entity,
    action: step.action,
    target: typeof step.target === 'object' && step.target && 'id' in step.target
      ? String((step.target as { id?: unknown }).id ?? '')
      : undefined,
  });

  if (!claim.proceed) {
    logger.info(
      { userId: ctx.userId, planId, stepId, entity: step.entity, action: step.action },
      'Write already claimed; not applying it a second time'
    );

    /*
     * Report it as done, because it IS done — the first request did it. A dry
     * run renders the same line the user would have seen, and falls back to the
     * bare action name when the row has already moved past the state this write
     * describes (an invoice marked paid cannot be previewed as being marked paid
     * again). Either way nothing is written here.
     */
    try {
      const preview = await executeMutate(step, ctx, { ...options, dryRun: true });
      return { preview: preview.preview ?? fallback, skipped: true };
    } catch {
      return { preview: fallback, skipped: true };
    }
  }

  try {
    const result = await executeMutate(step, ctx, options);
    await log.complete(claim.entryId, { status: 'succeeded' });
    return { preview: result.preview ?? fallback, skipped: false };
  } catch (err) {
    await log.complete(claim.entryId, { status: 'failed', error: (err as Error).message });
    throw err;
  }
}

export interface ApplyWritesArgs {
  /** The frozen steps, exactly as the user approved them. */
  steps: Array<MutateQuery | ForEachQuery>;
  /** Step id → the rows resolved at preview time. Required for every for_each. */
  frozenRows?: Record<string, QueryRow[]>;
  userId: string;
  /**
   * Idempotency scope. Every item's key is derived from this, so it must be
   * stable for one approval and different across approvals — a confirmation id,
   * or a saved plan's run id. Reusing one across runs would make the second run
   * silently do nothing.
   */
  planId: string;
  timezone?: string;
  /** Narrow, because branding resolution is typed to the supported set. */
  language?: 'en' | 'he' | 'es';
  /**
   * The names each step resolved to at preview time, positionally aligned with
   * `steps`. Optional: a saved plan re-run has no preview to carry them from.
   *
   * Same invariant as the frozen rows, applied to labels. `executeMutate`
   * renders its outcome line from what it is given, so applying without these
   * reported the raw id for anything the user had been shown by name — a task
   * confirmed as "איש קשר: דויד המלך" came back as
   * "איש קשר: 8742fcd8-fdfc-4e32-bb1f-c599cf72adf5".
   */
  names?: Array<{ targetName?: string; referenceNames?: Record<string, string> }>;
}

export interface ApplyWritesResult {
  /** One human-readable line per step, safe to join into a sentence. */
  applied: string[];
  /** True when any item failed or was skipped — the caller must not report a clean success. */
  partial: boolean;
}

export async function applyFrozenWrites(args: ApplyWritesArgs): Promise<ApplyWritesResult> {
  const { steps, frozenRows, userId, planId, timezone, language = 'en', names } = args;

  const applied: string[] = [];
  let partial = false;

  // Resolved ONCE, before the loop. A fan-out to 40 recipients must not perform
  // 40 identical branding lookups.
  const branding = steps.some((s) => s.op === 'for_each')
    ? await resolveEmailBranding(userId, language)
    : undefined;

  for (const [index, step] of steps.entries()) {
    if (step.op === 'for_each') {
      const rows = (frozenRows?.[step.id ?? ''] ?? []) as QueryRow[];

      const result = await executeForEach(
        step as ForEachQuery,
        rows,
        { userId, timezone, consumer: 'chat' },
        { planId, language, branding }
      );

      if (result.failed > 0 || result.skipped > 0) partial = true;

      applied.push(sendOutcome(result, language));
      continue;
    }

    const result = await applyClaimedMutate({
      step: step as MutateQuery,
      ctx: { userId, timezone, consumer: 'chat' },
      planId,
      // The step's own id when it has one; its position when it does not, since
      // `MutateQuery.id` is optional and the key must still be stable.
      stepId: step.id ?? `s${index}`,
      options: {
        language,
        targetName: names?.[index]?.targetName,
        referenceNames: names?.[index]?.referenceNames,
      },
    });

    applied.push(result.preview);
  }

  logger.info({ userId, planId, steps: steps.length, partial }, 'Applied frozen writes');

  return { applied, partial };
}

/**
 * What a fan-out actually did, in the reader's language.
 *
 * This is the sentence that reports whether someone's clients were contacted,
 * and it was English inside an otherwise Hebrew answer: "בוצע — sent to 0 of 1,
 * 1 failed." The one part of that line a reader most needs to understand — that
 * nothing was sent — was the part they could not read.
 *
 * Phrased per language rather than assembled from fragments, because the pieces
 * do not compose the same way in each: Hebrew puts the count after the verb and
 * has no direct equivalent of the bare "of".
 */
function sendOutcome(
  result: { succeeded: number; attempted: number; failed: number; skipped: number },
  language: string
): string {
  const clean = result.failed === 0 && result.skipped === 0;

  if (language === 'he') {
    if (clean) return `נשלח ל-${result.succeeded}`;
    return (
      `נשלח ל-${result.succeeded} מתוך ${result.attempted}` +
      (result.failed ? `, ${result.failed} נכשלו` : '') +
      (result.skipped ? `, ${result.skipped} כבר נשלחו` : '')
    );
  }

  if (language === 'es') {
    if (clean) return `enviado a ${result.succeeded}`;
    return (
      `enviado a ${result.succeeded} de ${result.attempted}` +
      (result.failed ? `, ${result.failed} fallaron` : '') +
      (result.skipped ? `, ${result.skipped} ya enviados` : '')
    );
  }

  if (clean) return `sent to ${result.succeeded}`;
  return (
    `sent to ${result.succeeded} of ${result.attempted}` +
    (result.failed ? `, ${result.failed} failed` : '') +
    (result.skipped ? `, ${result.skipped} already done` : '')
  );
}
