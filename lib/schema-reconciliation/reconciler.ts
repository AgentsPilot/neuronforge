/**
 * Deterministic field-name reconciler (Phase 0 — schema reconciliation core).
 *
 * Given a step's DECLARED item field names and the producing plugin action's
 * REAL output schema (or real field names), classify each declared field and
 * emit the clearly-same-field spelling corrections.
 *
 * This is the single shared piece of logic the requirement calls "one
 * reconciliation core, four call sites" (§Cross-Cutting Constraints #5). It is
 * consumed by calibration detection (Item 5b / calibration-side of Item 3) and
 * calibration correction (Item 7) in this phase, and by the generation and
 * compiler call sites in later phases.
 *
 * Rules (requirement §Item 1 AC + Open Questions on derived-field preservation
 * and ambiguous multi-match):
 *   - `rename`    — declared field fuzzy-overlaps EXACTLY ONE real producer field
 *                   and spells it differently → rewrite to the producer's spelling.
 *   - `keep`      — declared field already IS the producer's exact spelling.
 *   - `ambiguous` — declared field fuzzy-overlaps the producer but the match is
 *                   not safely unique (multiple producer spellings collapse to the
 *                   same key, OR renaming would collide with another field). Never
 *                   rewrite — "leave unchanged rather than guess".
 *   - `derived`   — declared field has NO producer counterpart (a legitimate
 *                   LLM-introduced derived field). Must survive unchanged.
 *
 * Deterministic and generic — no plugin names, no hardcoded field maps.
 */

import { normalizeFieldName } from './field-name-normalizer';
import {
  indexProducerFields,
  indexProducerFieldNames,
  type ProducerFieldIndex,
} from './schema-field-extractor';

export type ReconciliationAction = 'rename' | 'keep' | 'ambiguous' | 'derived';

export interface FieldReconciliation {
  /** The field name as declared by the step. */
  declared: string;
  /** The producer's canonical spelling when actionable; null for keep/ambiguous/derived. */
  canonical: string | null;
  action: ReconciliationAction;
}

export interface FieldRename {
  from: string;
  to: string;
}

export interface ReconciliationResult {
  /** Per-declared-field classification, input order preserved. */
  fields: FieldReconciliation[];
  /** Convenience view: only the actionable `rename` corrections. */
  renames: FieldRename[];
  /** True when at least one clearly-same-field rename was found. */
  hasRenames: boolean;
}

/**
 * Reconcile declared field names against a producer's {@link ProducerFieldIndex}.
 * Lower-level entry point; most callers use {@link reconcileFields} /
 * {@link reconcileFieldNames}.
 */
export function reconcileAgainstIndex(
  declaredFields: string[],
  producer: ProducerFieldIndex
): ReconciliationResult {
  // Count how many declared fields collapse to each normalised key, so a
  // declared-side collision (two declared fields that would both rename to the
  // same producer field) is treated as ambiguous rather than silently merged.
  const declaredNormalizedCounts = new Map<string, number>();
  for (const declared of declaredFields) {
    const key = normalizeFieldName(declared);
    declaredNormalizedCounts.set(key, (declaredNormalizedCounts.get(key) ?? 0) + 1);
  }

  // Set of declared spellings, so a rename target that already exists verbatim
  // among the declared fields is refused (would create a duplicate key).
  const declaredExact = new Set(declaredFields);

  const fields: FieldReconciliation[] = [];
  const renames: FieldRename[] = [];

  for (const declared of declaredFields) {
    const normalized = normalizeFieldName(declared);
    const producerCanonical = producer.normalizedToCanonical.get(normalized);

    if (producerCanonical === undefined) {
      // No producer field overlaps → genuinely derived, survives untouched.
      fields.push({ declared, canonical: null, action: 'derived' });
      continue;
    }

    if (producerCanonical === declared) {
      // Already the producer's exact spelling.
      fields.push({ declared, canonical: producerCanonical, action: 'keep' });
      continue;
    }

    const producerAmbiguous = producer.ambiguousNormalized.has(normalized);
    const declaredCollision = (declaredNormalizedCounts.get(normalized) ?? 0) > 1;
    const targetAlreadyDeclared = declaredExact.has(producerCanonical);

    if (producerAmbiguous || declaredCollision || targetAlreadyDeclared) {
      fields.push({ declared, canonical: null, action: 'ambiguous' });
      continue;
    }

    // Clearly the same field, spelled differently → actionable rename.
    fields.push({ declared, canonical: producerCanonical, action: 'rename' });
    renames.push({ from: declared, to: producerCanonical });
  }

  return { fields, renames, hasRenames: renames.length > 0 };
}

/**
 * Reconcile declared field names against a producer plugin action's
 * `output_schema` (a JSON-Schema tree). Nested producer shapes are indexed at
 * every depth, so a flatten's declared item fields are compared against the
 * producer's real item fields regardless of nesting.
 */
export function reconcileFields(
  declaredFields: string[],
  producerSchema: unknown
): ReconciliationResult {
  return reconcileAgainstIndex(declaredFields, indexProducerFields(producerSchema));
}

/**
 * Reconcile declared field names against an explicit list of real producer
 * field names (when the caller already resolved them).
 */
export function reconcileFieldNames(
  declaredFields: string[],
  producerFieldNames: string[]
): ReconciliationResult {
  return reconcileAgainstIndex(declaredFields, indexProducerFieldNames(producerFieldNames));
}
