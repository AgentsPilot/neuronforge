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
import { executeForEach } from './ForEachExecutor';
import { executeMutate } from './MutateExecutor';
import type { ForEachQuery, MutateQuery, QueryRow } from '../types';

const logger = createLogger({ module: 'BizQLApplyWrites' });

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
}

export interface ApplyWritesResult {
  /** One human-readable line per step, safe to join into a sentence. */
  applied: string[];
  /** True when any item failed or was skipped — the caller must not report a clean success. */
  partial: boolean;
}

export async function applyFrozenWrites(args: ApplyWritesArgs): Promise<ApplyWritesResult> {
  const { steps, frozenRows, userId, planId, timezone, language = 'en' } = args;

  const applied: string[] = [];
  let partial = false;

  // Resolved ONCE, before the loop. A fan-out to 40 recipients must not perform
  // 40 identical branding lookups.
  const branding = steps.some((s) => s.op === 'for_each')
    ? await resolveEmailBranding(userId, language)
    : undefined;

  for (const step of steps) {
    if (step.op === 'for_each') {
      const rows = (frozenRows?.[step.id ?? ''] ?? []) as QueryRow[];

      const result = await executeForEach(
        step as ForEachQuery,
        rows,
        { userId, timezone, consumer: 'chat' },
        { planId, language, branding }
      );

      if (result.failed > 0 || result.skipped > 0) partial = true;

      applied.push(
        result.failed > 0 || result.skipped > 0
          ? `sent to ${result.succeeded} of ${result.attempted}` +
              (result.failed ? `, ${result.failed} failed` : '') +
              (result.skipped ? `, ${result.skipped} already done` : '')
          : `sent to ${result.succeeded}`
      );
      continue;
    }

    const result = await executeMutate(
      step as MutateQuery,
      { userId, timezone, consumer: 'chat' },
      { language }
    );
    applied.push(result.preview ?? `${step.entity}.${step.action}`);
  }

  logger.info({ userId, planId, steps: steps.length, partial }, 'Applied frozen writes');

  return { applied, partial };
}
