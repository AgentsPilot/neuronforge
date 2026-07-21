/**
 * Field-name reconciliation — shared helper (WP-63)
 *
 * SINGLE SOURCE OF TRUTH for the schema-driven, case/underscore-insensitive
 * matching that reconciles a transform's AI-declared item field names to the real
 * field names its upstream producer emits (e.g. declared `mime_type` → producer
 * `mimeType`). Used by BOTH:
 *   - Gap A: `DataSchemaBuilder` (Phase 2 schema authoring) + the reference rewrite
 *            in `CapabilityBinderV2.applyTransformFieldRenames`, and
 *   - Gap B: `ExecutionGraphCompiler` O10a (compiler-side belt-and-suspenders net).
 *
 * Design constraints (CLAUDE.md No-Hardcoding / V6 Principle 6 / Anti-pattern F):
 *  - ZERO field-name constants, ZERO snake↔camel translation table, ZERO
 *    plugin/action-identity branches. The producer's own declared schema is the
 *    only source of truth for the canonical field names.
 *  - Q1: the matcher is a pure normalized-key equality (`toLowerCase()` with
 *    `_`/`-` stripped), reused verbatim from the pre-existing O10a approach.
 *  - M1: COLLISION SAFETY — if two producer fields normalize to the same form
 *    (e.g. `message_id` and `messageId`), that normalized key is AMBIGUOUS and the
 *    reconciler REFUSES to rewrite to it (leaves the declared field as-is +
 *    reports it). Ambiguity is the only path that could corrupt a correct schema,
 *    so we never guess (Principle 2/11 — no silent wrong rewrite).
 *
 * This module is pure (no logging, no I/O).
 */

/** Q1 normalizer — case- and separator-insensitive. The ONLY normalizer in the codebase. */
export function normalizeForFuzzy(s: string): string {
  return String(s).toLowerCase().replace(/[_\-]/g, '')
}

/** Runtime flatten builtins (`StepExecutor.transformFlatten`) — never reconciled/flagged (M2). */
export const FLATTEN_BUILTINS: readonly string[] = ['_parentId', '_parentData']

/**
 * Direct (one-level) field names of a schema node: object `properties`, or — when
 * the node is an array — its `items` properties. Does NOT recurse into nested
 * object/array fields (that is `collectAllFieldNames`).
 */
export function directFieldNames(schema: any): string[] {
  if (!schema || typeof schema !== 'object') return []
  const props = schema.properties || (schema.type === 'array' ? schema.items?.properties : undefined)
  return props && typeof props === 'object' ? Object.keys(props) : []
}

/**
 * Recursively collect every RAW field name in a schema tree (deep). Mirrors the
 * pre-existing `ExecutionGraphCompiler.extractAllFieldNames`, but returns raw names
 * so the caller can detect collisions (M1). Deep collection is what lets a flatten's
 * producer universe (parent email fields ∪ child attachment fields, e.g.
 * `emails[].attachments[].mimeType`) be found from the input's top-level schema
 * without needing to know the flatten `field` — collisions are guarded downstream.
 */
export function collectRawFieldNames(schema: any): string[] {
  const names: string[] = []
  const walk = (node: any): void => {
    if (!node || typeof node !== 'object') return
    if (node.properties && typeof node.properties === 'object') {
      for (const [fieldName, child] of Object.entries(node.properties)) {
        names.push(fieldName)
        walk(child)
      }
    }
    if (node.type === 'array' && node.items) walk(node.items)
  }
  walk(schema)
  return names
}

/**
 * Recursively collect every field name in a schema tree, normalized → canonical.
 * Reports ambiguity (M1) so callers never rewrite to a colliding normalized key.
 */
export function collectAllFieldNames(schema: any): { byNormalized: Map<string, string>; ambiguous: Set<string> } {
  return buildNormalizedMap(collectRawFieldNames(schema))
}

/**
 * Build a normalized-key → canonical-name map from a flat list of field names,
 * detecting collisions (M1). When two DISTINCT names share a normalized form, that
 * normalized key is marked ambiguous and omitted from the unambiguous map.
 */
export function buildNormalizedMap(fieldNames: string[]): {
  byNormalized: Map<string, string>
  ambiguous: Set<string>
} {
  const seen = new Map<string, Set<string>>()
  for (const name of fieldNames) {
    const n = normalizeForFuzzy(name)
    if (!seen.has(n)) seen.set(n, new Set())
    seen.get(n)!.add(name)
  }
  const byNormalized = new Map<string, string>()
  const ambiguous = new Set<string>()
  for (const [n, canonicals] of seen) {
    if (canonicals.size > 1) ambiguous.add(n)
    else byNormalized.set(n, [...canonicals][0])
  }
  return { byNormalized, ambiguous }
}

export interface ReconcileResult {
  /** declared field name → producer canonical name (re-cased matches only). */
  renames: Map<string, string>
  /** declared fields with NO normalized producer match (genuinely absent). */
  unmatched: string[]
  /** declared fields whose normalized key is ambiguous in the producer (M1 — left as-is). */
  ambiguous: string[]
}

/**
 * Reconcile a transform's declared field names against a producer field universe.
 *
 * - Exact match → no rename (already correct).
 * - Normalized match to an UNAMBIGUOUS producer field with different casing → rename.
 * - Normalized key is AMBIGUOUS in the producer (M1) → leave as-is, report `ambiguous`.
 * - No normalized match → leave as-is, report `unmatched` (genuinely absent).
 *
 * NEVER drops or fabricates a field (Principle 2/11) — it only ever returns a
 * rename decision for re-cased fields. The caller decides how to surface unmatched
 * (Gap C) based on the transform op's field-semantics (Q2).
 */
export function reconcileFieldNames(declared: string[], producerUniverse: string[]): ReconcileResult {
  const { byNormalized, ambiguous } = buildNormalizedMap(producerUniverse)
  const producerExact = new Set(producerUniverse)
  const result: ReconcileResult = { renames: new Map(), unmatched: [], ambiguous: [] }

  for (const d of declared) {
    if (producerExact.has(d)) continue // already correct
    const n = normalizeForFuzzy(d)
    if (ambiguous.has(n)) {
      result.ambiguous.push(d)
      continue
    }
    const canonical = byNormalized.get(n)
    if (!canonical) {
      result.unmatched.push(d)
      continue
    }
    if (canonical !== d) result.renames.set(d, canonical)
  }
  return result
}

/**
 * Q2 — field-semantics classification of a transform op, deciding whether a
 * declared field with no producer match is a genuine defect (PRESERVING ops pass
 * producer fields through verbatim, so every declared field must trace to the
 * producer) or legitimately computed (SYNTHESIZING ops mint new fields).
 *
 * Schema-driven by the op name only (the grammar's own vocabulary) — not a
 * plugin/field-name branch.
 */
const FIELD_PRESERVING_OPS: ReadonlySet<string> = new Set([
  'flatten',
  'filter',
  'sort',
  'dedupe',
  'project_column',
  'set_difference',
])
const FIELD_SYNTHESIZING_OPS: ReadonlySet<string> = new Set([
  'with_fields',
  'map',
  'group',
  'reduce',
  'merge',
  'select',
  'custom',
])

export function isFieldPreservingOp(op: string | undefined): boolean {
  return !!op && FIELD_PRESERVING_OPS.has(op)
}
export function isFieldSynthesizingOp(op: string | undefined): boolean {
  return !!op && FIELD_SYNTHESIZING_OPS.has(op)
}
