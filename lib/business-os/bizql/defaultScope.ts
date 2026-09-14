/**
 * The rows an entity leaves out unless it is asked for them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS, AND WHY IT IS NARROW
 *
 * A quote is revised by writing a NEW row and retiring the old one, which is
 * what makes agreed terms un-rewritable. The cost is that one negotiation is
 * several rows, and every plain question about quotes counts all of them:
 * asked how many quotes were open and what they came to, the chat answered
 * "11, ₪75,850" for a business with four live quotes worth ₪15,850. Nothing
 * was wrong with the query. It counted four superseded drafts of quotes it had
 * also counted.
 *
 * A hidden filter is normally the WRONG answer to that — a silent exclusion is
 * how a confident zero happens, and this file argues against them everywhere
 * else. Three things make this one safe:
 *
 *   1. It only ever excludes a row that has been REPLACED by another row which
 *      IS included. Nothing disappears from the answer; a duplicate does.
 *   2. It is not hidden. `describePlan` reads the same rule and says
 *      "current versions only" in the line shown next to the answer.
 *   3. It steps aside the moment the user asks. A plan that constrains any of
 *      the named fields — status, or the derived fact built on it — is left
 *      exactly as written, so "show me the history" still works.
 *
 * The same shape covers soft deletion if it is ever declared here; today only
 * `proposals` uses it.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/business-os/bizql
 */

import type { ResolvedEntity } from '@/lib/business-os/catalog';
import { isFieldPredicate, type Predicate } from './types';

/** Every field named anywhere in a predicate tree, however deeply nested. */
function constrainedFields(where: Predicate[] | undefined, into = new Set<string>()): Set<string> {
  for (const predicate of where ?? []) {
    if (isFieldPredicate(predicate)) into.add(predicate.field);
    else if ('and' in predicate) constrainedFields(predicate.and, into);
    else if ('or' in predicate) constrainedFields(predicate.or, into);
    else if ('not' in predicate) constrainedFields([predicate.not], into);
    // A relation predicate's inner fields belong to the OTHER entity, so they
    // say nothing about whether this one was constrained.
  }

  return into;
}

/**
 * The default predicates to add to this query, or none.
 *
 * Shared by the compiler (which applies them) and the answer line (which says
 * so), because a filter the user is not told about is the thing this module is
 * careful not to become.
 */
export function defaultScopeFor(
  entity: ResolvedEntity,
  where: Predicate[] | undefined
): { where: Predicate[]; labels: Record<string, string> } | null {
  const scope = entity.defaultScope;
  if (!scope) return null;

  const asked = constrainedFields(where);
  if (scope.unless.some((field) => asked.has(field))) return null;

  return { where: scope.where as unknown as Predicate[], labels: scope.labels };
}
