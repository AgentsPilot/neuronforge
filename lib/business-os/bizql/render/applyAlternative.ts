/**
 * Re-run the last question with one word changed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A TAP MUST NOT GO BACK TO THE PLANNER
 *
 * The answer line says what was understood and offers the alternatives the
 * catalog can see — "no-show?", "net?". Tapping one has to produce THE SAME
 * QUERY with one value substituted. Sending the question back to the model
 * would be a second charge for a question already understood, and worse, the
 * model might plan it differently: the user taps "no-show" and gets a different
 * query about no-shows, so the two numbers they are trying to compare are no
 * longer comparable.
 *
 * WHY THE PLAN COMES FROM THE SERVER
 *
 * The stored plan is the one we wrote, held in conversation memory against the
 * user's own id. A plan posted by a browser is a plan we did not write, and
 * "execute this query" is not something a client should be able to say. The tap
 * carries only three small facts — which step, which field, which value — and
 * every one of them is checked against the catalog before it is applied.
 *
 * WHY THE SENTENCE IS DROPPED
 *
 * The planner's `answer.text` was written about the ORIGINAL value: "you have
 * {s1.count} cancelled bookings". Substituting `no_show` underneath it would
 * produce a sentence that names one status and counts another — the exact
 * confident-wrong-answer failure this feature exists to prevent. The renderer's
 * fallback plus the understanding line carry the corrected turn instead.
 *
 * @module lib/business-os/bizql/render
 */

import { CATALOG } from '@/lib/business-os/catalog';
import { validatePlan } from '../planner/validatePlan';
import type { Plan } from '../planner/Planner';
import type { ComputeQuery, FindQuery, Predicate, Query } from '../types';
import { isFieldPredicate } from '../types';
import type { Alternative } from './describePlan';

export interface AppliedAlternative {
  plan: Plan;
  /**
   * A choice worth remembering for the rest of the conversation, keyed
   * `entity.field`. Only set for the gross/net kind: a status swap is a new
   * question, but "when I say revenue I mean net" is a standing fact.
   */
  preference?: { key: string; value: string };
}

/**
 * Apply a tapped alternative to a stored plan.
 *
 * Returns null whenever anything does not line up — no stored plan, an unknown
 * step, a value the column cannot hold, a plan that no longer validates. A null
 * means the caller should plan the turn normally rather than execute something
 * half-substituted.
 */
export function applyAlternative(
  storedSteps: unknown[] | undefined,
  alternative: Alternative
): AppliedAlternative | null {
  if (!storedSteps?.length) return null;

  // Deep copy: the stored context must not be mutated by an attempt that then
  // fails validation and is discarded.
  const steps = JSON.parse(JSON.stringify(storedSteps)) as Query[];

  const index = steps.findIndex(
    (step, i) => (step.id ?? `s${i + 1}`) === alternative.stepId
  );
  if (index < 0) return null;

  const step = steps[index];

  // A write is never re-run from a tap. Memory refuses to store one, and this
  // is the second lock on the same door.
  if (step.op !== 'find' && step.op !== 'compute') return null;

  const entity = CATALOG.entities[step.entity];
  if (!entity) return null;

  let preference: AppliedAlternative['preference'];

  if (alternative.kind === 'aggregate_field') {
    if (step.op !== 'compute') return null;

    // The substituted field must be one the catalog itself nominated as the
    // alternative — never an arbitrary column name from the request body.
    const nominating = Object.entries(entity.fields).find(([, field]) =>
      field.aggregateInstead?.includes(alternative.value)
    );
    if (!nominating) return null;
    if (!entity.fields[alternative.value]) return null;

    (step as ComputeQuery).agg = { ...(step as ComputeQuery).agg, field: alternative.value };
    preference = { key: `${step.entity}.${nominating[0]}`, value: alternative.value };
  } else {
    const field = entity.fields[alternative.field];
    if (!field?.enumValues?.includes(alternative.value)) return null;

    const where = ((step as FindQuery | ComputeQuery).where ?? []) as Predicate[];
    const target = where.find(
      (p) => isFieldPredicate(p) && p.field === alternative.field && p.op === 'eq'
    );

    if (target && isFieldPredicate(target)) {
      target.value = alternative.value;
    } else {
      // No predicate to change: add one. This is the "you counted everything,
      // did you mean only the cancelled ones" direction of the same correction.
      where.push({ field: alternative.field, op: 'eq', value: alternative.value });
      (step as FindQuery | ComputeQuery).where = where;
    }
  }

  // No sentence — see the header. The renderer falls back and the understanding
  // line says exactly what ran.
  const plan: Plan = { steps };

  // The same gate a fresh plan passes. A substitution is only safe if the
  // result is a plan the system would have been willing to produce itself.
  if (validatePlan(plan).length > 0) return null;

  return { plan, preference };
}
