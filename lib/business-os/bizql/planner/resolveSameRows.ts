/**
 * "The same rows as last time" — filled in by the server, not by the model.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * Three layers of conversation memory already carry the last turn forward: the
 * utterances, the row ids that were shown, and (since today) the whole plan.
 * All three are HINTS in a prompt, and the one that mattered kept being
 * ignored. Asked "what is their total" straight after "4 of 7 quotes were
 * accepted", the planner summed all seven — then did it again after the hint
 * was made more explicit, this time also comparing the result to an unrelated
 * payments figure and reporting 2,042%.
 *
 * The pattern behind those failures is worth naming: the model is good at
 * RECOGNISING that a message is a follow-up, and unreliable at REPRODUCING the
 * filter that follow-up inherits. So it now only has to do the first: set
 * `same_rows`, and the server copies the entity and the predicates across from
 * the plan it stored.
 *
 * Deterministic, so it cannot drift. If there is nothing to inherit the flag is
 * simply dropped and the step stands on what it declared — a plan that says
 * nothing else then fails validation with "entity is required", which is the
 * honest outcome for a follow-up to a conversation that no longer exists.
 *
 * @module lib/business-os/bizql/planner
 */

import { createLogger } from '@/lib/logger';
import type { Plan } from './Planner';
import type { ConversationContext } from '../memory/ConversationMemory';

const logger = createLogger({ module: 'BizQLSameRows' });

/** A read step of the previous plan, preferring one that matches the entity asked for. */
function inheritFrom(
  steps: Array<Record<string, unknown>>,
  entity: unknown
): Record<string, unknown> | undefined {
  const reads = steps.filter((step) => step.op === 'find' || step.op === 'compute');
  if (reads.length === 0) return undefined;

  /*
   * The MOST FILTERED step, not the first.
   *
   * A two-step answer is usually "N of M": a broad step and a narrow one, and
   * "their total" means the narrow one — the four that were accepted, not the
   * seven that exist. Ties go to the first, which is the order the model wrote.
   */
  const named = typeof entity === 'string' ? reads.filter((s) => s.entity === entity) : [];
  const pool = named.length > 0 ? named : reads;

  return pool.reduce((best, step) =>
    ((step.where as unknown[])?.length ?? 0) > ((best.where as unknown[])?.length ?? 0) ? step : best
  );
}

/**
 * Fill in every step that asked for the previous rows.
 *
 * @returns how many steps inherited, for logging.
 */
export function resolveSameRows(plan: Plan, context?: ConversationContext): number {
  const previous = (context?.lastPlan?.steps ?? []) as Array<Record<string, unknown>>;
  let inherited = 0;

  for (const step of plan.steps ?? []) {
    const s = step as unknown as Record<string, unknown>;
    if (s.same_rows !== true) continue;

    delete s.same_rows;

    const source = inheritFrom(previous, s.entity);

    if (!source) {
      logger.info('A step asked for the previous rows, but there is no previous plan');
      continue;
    }

    /*
     * The filters are inherited WHOLE, and the entity with them.
     *
     * Not merged with anything the step declared: a follow-up that also states
     * a filter is stating a NEW question about the same subject, and the two
     * predicate sets could contradict each other. What the new step keeps is
     * everything else — its aggregate, its limit, its ordering — which is
     * exactly what the follow-up came to change.
     */
    s.entity = source.entity;
    s.where = JSON.parse(JSON.stringify(source.where ?? []));
    inherited += 1;
  }

  return inherited;
}
