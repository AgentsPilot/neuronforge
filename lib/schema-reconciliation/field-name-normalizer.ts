/**
 * Shared fuzzy field-name normaliser (Phase 0 — schema reconciliation core).
 *
 * ONE canonical implementation of the "are these two field names clearly the
 * same field, just spelled differently?" normalisation. Prior to this module the
 * same logic was triplicated as inline `normalizeForFuzzy` closures in
 * `ExecutionGraphCompiler` (O10a) and a divergent variant in `FieldMatcher`.
 * Divergence between copies is exactly how the field-fidelity class re-surfaces
 * (requirement §Cross-Cutting Constraints #5 — "one reconciliation core").
 *
 * Semantics (matching the existing O10a `normalizeForFuzzy` approach the
 * requirement pins in Item 1 AC): lowercase, then strip `_` and `-` separators.
 * This makes `mime_type`, `mimeType`, `MIME-TYPE` and `mimetype` all collapse to
 * the same key `mimetype`, so a snake_case vs camelCase spelling difference is
 * recognised as the same field. Whitespace is trimmed defensively.
 *
 * Deliberately generic: it knows nothing about any plugin, operation, or field.
 */

/**
 * Collapse a field name to its case/separator-insensitive canonical key.
 * `mime_type` → `mimetype`, `mimeType` → `mimetype`, `attachment-id` → `attachmentid`.
 */
export function normalizeFieldName(fieldName: string): string {
  return fieldName.trim().toLowerCase().replace(/[_-]/g, '');
}

/**
 * True when two field names refer to the same field modulo case/separators
 * (e.g. `mime_type` and `mimeType`), but are NOT byte-for-byte identical.
 * A byte-identical pair returns false — there is nothing to reconcile.
 */
export function isSameFieldDifferentSpelling(a: string, b: string): boolean {
  return a !== b && normalizeFieldName(a) === normalizeFieldName(b);
}
