/**
 * Producer-schema field extraction (Phase 0 — schema reconciliation core).
 *
 * Walks a JSON-Schema-shaped object (a plugin action's `output_schema`, or any
 * step's declared `output_schema`) and collects every field name at every
 * nesting level, keyed by its fuzzy-normalised form. This is how the reconciler
 * answers "does this declared field fuzzy-overlap ANY real producer field?".
 *
 * Mirrors the tree walk previously inlined as `extractAllFieldNames` in
 * `ExecutionGraphCompiler`, but is now the single shared implementation.
 *
 * Generic by construction — it reads the schema shape only; no plugin/field
 * identifiers are hardcoded.
 */

import { normalizeFieldName } from './field-name-normalizer';

/**
 * The set of field names a producer schema really exposes, indexed for fuzzy
 * lookup.
 */
export interface ProducerFieldIndex {
  /** normalised field name → the producer's canonical (real) spelling. */
  normalizedToCanonical: Map<string, string>;
  /** Every canonical (real) field name found, de-duplicated, first-seen order. */
  canonicalNames: string[];
  /**
   * Normalised keys that map to MORE THAN ONE distinct canonical spelling in the
   * producer (a genuinely ambiguous overlap). The reconciler must never rewrite
   * to an ambiguous target — it cannot know which the user meant.
   */
  ambiguousNormalized: Set<string>;
}

/** Minimal structural shape we read from a JSON-Schema node. */
interface SchemaNode {
  type?: string;
  properties?: Record<string, unknown>;
  items?: unknown;
}

function isSchemaNode(value: unknown): value is SchemaNode {
  return typeof value === 'object' && value !== null;
}

/**
 * Build a {@link ProducerFieldIndex} from a JSON-Schema tree. Handles
 * `object.properties`, `array.items(.properties)`, and arbitrary nesting depth,
 * so nested producer shapes (e.g. `emails[].attachments[].mimeType`) are indexed.
 */
export function indexProducerFields(schema: unknown): ProducerFieldIndex {
  const normalizedToCanonical = new Map<string, string>();
  const ambiguousNormalized = new Set<string>();
  const canonicalNames: string[] = [];
  const seenCanonical = new Set<string>();

  const walk = (node: unknown): void => {
    if (!isSchemaNode(node)) return;

    if (node.properties && typeof node.properties === 'object') {
      for (const [fieldName, fieldValue] of Object.entries(node.properties)) {
        if (!seenCanonical.has(fieldName)) {
          seenCanonical.add(fieldName);
          canonicalNames.push(fieldName);
        }

        const normalized = normalizeFieldName(fieldName);
        const existing = normalizedToCanonical.get(normalized);
        if (existing === undefined) {
          normalizedToCanonical.set(normalized, fieldName);
        } else if (existing !== fieldName) {
          // Two DIFFERENT real spellings collapse to the same normalised key —
          // ambiguous. Keep the first as the map value but flag it so the
          // reconciler refuses to rewrite toward it.
          ambiguousNormalized.add(normalized);
        }

        walk(fieldValue);
      }
    }

    if (node.type === 'array' && node.items !== undefined) {
      walk(node.items);
    }
  };

  walk(schema);

  return { normalizedToCanonical, canonicalNames, ambiguousNormalized };
}

/**
 * Build a {@link ProducerFieldIndex} from a flat list of real field names
 * (when the caller already has the producer's field names and not a schema).
 */
export function indexProducerFieldNames(fieldNames: string[]): ProducerFieldIndex {
  const normalizedToCanonical = new Map<string, string>();
  const ambiguousNormalized = new Set<string>();
  const canonicalNames: string[] = [];
  const seenCanonical = new Set<string>();

  for (const fieldName of fieldNames) {
    if (!seenCanonical.has(fieldName)) {
      seenCanonical.add(fieldName);
      canonicalNames.push(fieldName);
    }
    const normalized = normalizeFieldName(fieldName);
    const existing = normalizedToCanonical.get(normalized);
    if (existing === undefined) {
      normalizedToCanonical.set(normalized, fieldName);
    } else if (existing !== fieldName) {
      ambiguousNormalized.add(normalized);
    }
  }

  return { normalizedToCanonical, canonicalNames, ambiguousNormalized };
}
