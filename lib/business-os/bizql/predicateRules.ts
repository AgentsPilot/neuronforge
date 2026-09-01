/**
 * Predicate legality rules shared by the validator and the compiler.
 *
 * WHY THIS MODULE EXISTS
 *
 * `validatePlan` decides whether a plan is allowed to run; `compiler` decides
 * what it actually does. Every time those two encoded the same rule separately
 * they drifted, and each drift was a silent wrong answer rather than an error:
 *
 *   - a one-to-many `include` was accepted by the compiler and rejected by the
 *     validator, so a correct plan was refused;
 *   - a predicate carrying both `field` and `relation` had opposite precedence
 *     in each layer, so it validated and then threw at query time;
 *   - relation cardinality was checked in one layer and not the other.
 *
 * A rule that lives in two places is a rule that will be enforced in one. So
 * anything both layers need to agree on belongs here, stated once, and both call
 * it. Checking one is otherwise checking neither.
 *
 * @module lib/business-os/bizql/predicateRules
 */

import type { ResolvedEntity } from '@/lib/business-os/catalog';

/**
 * Is this relation predicate meaningful for this entity?
 *
 * Returns an explanatory message when it is not, or `null` when it is legal.
 * The message is written to be actionable by the planner on its repair pass —
 * it names the shape to emit instead, not just the fault.
 */
export function relationPredicateProblem(
  entity: ResolvedEntity,
  relationName: string,
  where: unknown
): string | null {
  const relation = entity.relations?.[relationName];
  if (!relation) return null; // Unknown relations are reported by the caller.

  const hasInnerFilter = Array.isArray(where) && where.length > 0;
  const toOne = relation.via.side === 'local';

  // A quantifier over a to-one relation with NO inner filter asks "does this row
  // point at a related row at all" — which is a question about this table's own
  // foreign key column, not about the related table.
  //
  // Observed: "מי חייב לי כסף?" ("who owes me money?") planned as
  // `invoices where status unpaid AND {relation: contact, quantifier: none}`.
  // The compiler dutifully collected every contact the user owns and excluded
  // every invoice pointing at one — so a question with 13 correct answers
  // returned zero, and the user was told nobody owed them anything.
  //
  // Rejecting the shape rather than "fixing" it is deliberate: the planner
  // reaches for a bare quantifier as filler, and there is always a direct field
  // predicate that says the same thing more cheaply and more clearly.
  if (toOne && !hasInnerFilter) {
    // The wording matters as much as the rule. An earlier version of this message
    // named two replacement FILTERS, and the model dutifully picked one — it
    // invented `contact.stage = "לקוח"` — because the message implied a filter
    // was needed. It is not: the planner adds this predicate while reaching for
    // contact DETAILS, which `include` already supplies. So the instruction now
    // leads with DELETE, and mentions the alternatives only as the narrow cases
    // they actually are.
    return (
      `DELETE this filter. A '${relationName}' filter with no inner "where" ` +
      `restricts nothing, and every ${entity.key} row has one ${relationName}, so it ` +
      `only risks emptying the result. If you wanted the related ${relationName} ` +
      `DETAILS in the answer, "include" already provides them — a filter is not ` +
      `needed and you must not invent one. Add a relation filter back ONLY if the ` +
      `user constrained the ${relationName} itself, and then give it a "where": ` +
      `{"relation":"${relationName}","quantifier":"any","where":[...]}. ` +
      `To ask whether the link exists at all, use ` +
      `{"field":"${relation.via.column}","op":"is_null"} or "is_not_null".`
    );
  }

  return null;
}
