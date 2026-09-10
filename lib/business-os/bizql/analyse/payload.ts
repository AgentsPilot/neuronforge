/**
 * What the analysis layer is allowed to see.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NUMBERS, NEVER NAMES
 *
 * The planner already sees a great deal: the question, the catalog, the
 * business's own configured vocabulary. This layer sees something different and
 * far more sensitive — the ANSWER — so it is given the least that still lets it
 * say something useful.
 *
 * `ComputeResult.groups` is `{ key, value, id }` where `key` is the label and
 * `id` the row it came from. Both are withheld. The model is handed `g1`, `g2`,
 * `g3` and writes `{s1.groups.g1.label}`; the renderer substitutes the name
 * afterwards from the result it already holds.
 *
 * Two things follow from that, and the second is the reason it is worth doing
 * rather than merely being careful:
 *
 *   - no contact name, service name, email or id reaches the model, so the
 *     privacy question does not depend on anyone remembering to be careful;
 *   - the model CANNOT fabricate a name, because it was never given one. The
 *     same property the planner has, for the same reason.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/business-os/bizql/analyse
 */

import type { ComputeResult, FindResult, QueryResult } from '../types';

export interface AnalysisStep {
  id: string;
  /** What was measured — never WHICH rows. */
  measure: string;
  value: number | null;
  /** Present only for a grouped aggregate: opaque refs, in the result's order. */
  groups?: Array<{ ref: string; value: number }>;
  /** True when the aggregate ran over a capped scan; the sentence must not overstate. */
  approximate?: boolean;
}

export interface AnalysisPayload {
  question: string;
  language: string;
  currency: string;
  steps: AnalysisStep[];
}

/**
 * One line describing what a step measured.
 *
 * Entity and aggregate only. "sum of transactions.net_amount" tells the model
 * everything it needs to relate two figures and nothing about whose money it is.
 */
function describeMeasure(result: QueryResult): string {
  if (result.op === 'compute') {
    const compute = result as ComputeResult;
    const { fn, field, distinct } = compute.agg;
    const target = field ? `${compute.entity}.${field}` : compute.entity;
    return distinct ? `${fn} distinct ${target}` : `${fn} of ${target}`;
  }

  if (result.op === 'find') return `count of ${(result as FindResult).entity} rows`;

  return result.op;
}

export function buildAnalysisPayload(args: {
  question: string;
  language: string;
  currency: string;
  steps: Array<{ id?: string }>;
  results: QueryResult[];
}): AnalysisPayload {
  const steps: AnalysisStep[] = [];

  args.steps.forEach((step, index) => {
    const result = args.results[index];
    if (!step.id || !result) return;

    const compute = result.op === 'compute' ? (result as ComputeResult) : undefined;

    steps.push({
      id: step.id,
      measure: describeMeasure(result),
      value: compute ? compute.value : (result as FindResult).rows.length,
      // Index refs, in result order. The label lives only on the server.
      ...(compute?.groups?.length
        ? {
            groups: compute.groups.map((group, position) => ({
              ref: `g${position + 1}`,
              value: group.value,
            })),
          }
        : {}),
      ...(compute?.approximate ? { approximate: true } : {}),
    });
  });

  return {
    question: args.question,
    language: args.language,
    currency: args.currency,
    steps,
  };
}
