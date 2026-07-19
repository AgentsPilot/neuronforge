/**
 * ExtractionCoverage — deterministic-vs-AI extraction coverage predicate (WP-62)
 *
 * The authoritative, schema-driven judgment of whether an available (connected)
 * deterministic document-extraction plugin *genuinely covers* a specific extract
 * step. Implements the ordered coverage criteria CC-1..CC-4 / CC-3a from
 * `docs/requirements/DETERMINISTIC_VS_AI_EXTRACTION_ROUTING_REQUIREMENT.md`:
 *
 *   CC-1  the extract input is a document/file (bytes-bearing / file_attachment)
 *   CC-2  a CONNECTED deterministic document-extraction capability exists
 *   CC-3  the requested document-surface fields are producible (Q2 source split)
 *   CC-3a meta/computed residual fields are split to a downstream AI step
 *   CC-4  the plugin supports the input's file type(s)
 *
 * Design constraints (CLAUDE.md "No Hardcoding" / V6 Design Principle 6 /
 * Anti-pattern F):
 *  - ZERO field-name allow/deny lists. Field producibility is judged purely from
 *    the field's DECLARED SOURCE (`ExtractFieldSource`) in the IntentContract.
 *  - ZERO plugin/action-identity branches. The deterministic extractor is
 *    discovered from the plugin *schema* (domain + capability), never by key.
 *  - Conservative in the safe direction: when coverage cannot be established from
 *    the schemas, fall back to AI (never fabricate coverage). Symmetrically, when
 *    coverage IS schema-provable, never fall back to AI (fixes the today-bug).
 *
 * This module is pure (no logging, no I/O). CapabilityBinderV2 (Phase 2c) is the
 * single caller that authors the verdict onto the bound step; IntentToIRConverter
 * only HONORS it (single decision-maker — Q1 anti-double-decision guard).
 */

import type { ExtractFieldSource } from '../semantic-plan/types/intent-schema-types'

/** A requested extract field, minimally typed for coverage classification. */
export interface CoverageField {
  name: string
  type?: string
  required?: boolean
  description?: string
  source?: ExtractFieldSource
  [key: string]: unknown
}

/** Which criterion decided the verdict (for observability — AC-7). */
export type CoverageCriterion = 'CC-1' | 'CC-2' | 'CC-3' | 'CC-4' | 'covered'

/** The authoritative coverage verdict authored by the binder. */
export interface ExtractCoverageVerdict {
  /** True iff CC-1 ∧ CC-2 ∧ CC-3 ∧ CC-4 all hold. */
  covered: boolean
  /** The first criterion that decided the verdict (the failing one, or 'covered'). */
  decidingCriterion: CoverageCriterion
  /** Human-readable reason for the log line. */
  reason: string
  /** The discovered deterministic extractor when covered; null otherwise. */
  deterministicPlugin: { pluginKey: string; action: string } | null
  /** Document-surface fields the deterministic capability produces (CC-3). */
  surfaceFields: CoverageField[]
  /** Meta/computed fields to split to a downstream AI step (CC-3a). */
  residualFields: CoverageField[]
}

/** Minimal action shape this module reads (schema-driven, no identity). */
interface CoverageActionDef {
  domain?: string
  capability?: string
  must_support?: string[]
  parameters?: { properties?: Record<string, unknown> }
  output_schema?: Record<string, unknown>
  // Optional forward-looking explicit accepted-type list (read if present).
  ['x-accepted-file-types']?: string[]
}

/** Connected-plugin map shape from PluginManagerV2.getExecutablePlugins(). */
export type ConnectedPluginsMap = Record<string, { definition?: { actions?: Record<string, CoverageActionDef> } }>

/**
 * The bytes-bearing content fields a downloadable file object exposes, in
 * PREFERENCE order (most explicit first; `content` last because it is ambiguous —
 * it is also a text marker). Generic file-object vocabulary, not a plugin-specific
 * field list.
 *
 * SINGLE SOURCE OF TRUTH: this is the ONLY definition of the bytes vocabulary in
 * the codebase. `IntentToIRConverter.slotHasBytes` / `findDownloadAction` and the
 * `convertExtract` file-param mapping all consume it via `bytesFieldOf` /
 * `classifySchemaFileness`. Duplicating it re-opens the divergence class SA flagged
 * as the Round-1 HIGH (a mapping and a verdict silently disagreeing).
 */
const BYTES_FIELDS_PRIORITY = ['file_content', 'data', 'base64', 'content'] as const
const BYTES_FIELDS: ReadonlySet<string> = new Set<string>(BYTES_FIELDS_PRIORITY)

/**
 * Return the NAME of the bytes-bearing content field a schema exposes (preferring
 * the most explicit), or null when the schema has no bytes field. Schema-driven —
 * the producer's own schema is the source of truth for which key carries the bytes
 * (Gmail's is `data`, Drive's is `content`), so no plugin/field-name branching.
 */
export function bytesFieldOf(schema: any): string | null {
  const props = schema?.properties || schema?.items?.properties
  if (!props || typeof props !== 'object') return null
  for (const candidate of BYTES_FIELDS_PRIORITY) {
    if (candidate in props) return candidate
  }
  return null
}

/** True when the schema (or its array items) exposes any bytes-bearing content field. */
export function schemaHasBytes(schema: any): boolean {
  return bytesFieldOf(schema) !== null
}
const FILE_SEMANTIC_TYPES = new Set(['file_attachment', 'file'])
// Field-name markers for the fallback field-name heuristic (deferred to only when
// there is no semantic-type / bytes signal). Generic file-object vs text-object
// vocabulary — not a plugin-specific list.
const FILE_MARKERS = new Set(['file_url', 'attachment_id', 'mimeType', 'file_content', 'file_path'])
const TEXT_MARKERS = new Set(['body', 'subject', 'snippet', 'message', 'text', 'content'])

/**
 * Normalize a value/ref string to its BASE variable name: strip `{{ }}`, trim, and
 * drop any dotted field tail (`{{attachment_content.data}}` → `attachment_content`).
 *
 * SHARED normalization so the binder's authoritative CC-1 and the converter's
 * legacy heuristic resolve the SAME base variable — a well-phrased plan pointing
 * `extract.input` at the bytes field (the B1 steer) must still resolve to its
 * producer. (SA Finding #1.)
 */
export function baseVarOfRef(ref: string): string {
  return String(ref || '').replace(/\{\{|\}\}/g, '').trim().split('.')[0]
}

/**
 * SHARED file/text/unknown classification of a slot or action output schema — the
 * single source of truth for "is this a document/file?" used by BOTH the binder's
 * authoritative CC-1 (`extractInputIsFile`) and the converter's legacy heuristic
 * (`inputLooksLikeFileAttachment`), so B3 hardening can't become dead code and the
 * two can't diverge again (SA Finding #1).
 *
 * Order (positive file signals win, so a text short-circuit can't override the
 * producer's own file shape):
 *  1. `semantic_type` (schema or array items) annotated file → 'file'.
 *  2. a bytes-bearing content field (data / file_content / content / base64) → 'file'.
 *  3. field-name markers: file-only → 'file'; text-only → 'text'; both → 'text'
 *     (text-primary, e.g. an email with an attachments field); neither → 'unknown'.
 */
export function classifySchemaFileness(schema: any): 'file' | 'text' | 'unknown' {
  if (!schema || typeof schema !== 'object') return 'unknown'

  const semanticType = schema['x-semantic-type'] ?? schema.semantic_type
  const itemsSemanticType = schema.items?.['x-semantic-type'] ?? schema.items?.semantic_type
  if (FILE_SEMANTIC_TYPES.has(semanticType) || FILE_SEMANTIC_TYPES.has(itemsSemanticType)) {
    return 'file'
  }

  const props = schema.properties || schema.items?.properties
  if (!props || typeof props !== 'object') return 'unknown'
  const keys = Object.keys(props)

  if (keys.some((k) => BYTES_FIELDS.has(k))) return 'file'

  const hasFile = keys.some((k) => FILE_MARKERS.has(k))
  const hasText = keys.some((k) => TEXT_MARKERS.has(k))
  if (hasFile && !hasText) return 'file'
  if (hasText && !hasFile) return 'text'
  if (hasFile && hasText) return 'text'
  return 'unknown'
}

/**
 * The deterministic document-extraction capability, expressed as a schema
 * contract (NOT a plugin key). An action qualifies when it declares the document
 * domain + the structured-extraction capability. This mirrors how
 * CapabilityBinderV2.findCandidates already matches by domain+capability.
 */
const DOC_EXTRACTION_DOMAIN = 'document'
const DOC_EXTRACTION_CAPABILITY = 'extract_structured_data'

/**
 * CC-2: discover a CONNECTED deterministic document-extraction capability.
 * Schema-driven — matches on the action's declared domain + capability, never on
 * plugin identity. Returns the first qualifying action, or null.
 */
export function findDeterministicDocumentExtractor(
  connectedPlugins: ConnectedPluginsMap,
): { pluginKey: string; action: string; actionDef: CoverageActionDef } | null {
  for (const [pluginKey, plugin] of Object.entries(connectedPlugins || {})) {
    const actions = plugin?.definition?.actions
    if (!actions) continue
    for (const [actionName, actionDef] of Object.entries(actions)) {
      if (
        actionDef?.domain === DOC_EXTRACTION_DOMAIN &&
        actionDef?.capability === DOC_EXTRACTION_CAPABILITY
      ) {
        return { pluginKey, action: actionName, actionDef }
      }
    }
  }
  return null
}

/**
 * CC-1 signal: does a producer's output schema expose a file attachment? True
 * when the schema (or its array items) is annotated `x-semantic-type:
 * file_attachment` (B2 for Gmail; WP-57 for Drive), OR when it exposes a
 * bytes-bearing content field. Only ever yields a positive file signal.
 */
export function outputSchemaIsFileAttachment(outputSchema: unknown): boolean {
  // Positive file signal only (semantic_type / bytes) — a text object never
  // yields true here. Delegates to the shared classifier so the binder's CC-1 and
  // the converter heuristic agree on the file/text verdict.
  return classifySchemaFileness(outputSchema) === 'file'
}

/**
 * Q2 partition: classify each requested field by its DECLARED SOURCE.
 * `source === "document"` → surface (deterministically producible); everything
 * else (`meta`, `computed`, or absent — conservative) → residual.
 * No field-name lists.
 */
export function partitionFieldsBySource(fields: CoverageField[]): {
  surfaceFields: CoverageField[]
  residualFields: CoverageField[]
} {
  const surfaceFields: CoverageField[] = []
  const residualFields: CoverageField[] = []
  for (const f of fields || []) {
    if (f?.source === 'document') surfaceFields.push(f)
    else residualFields.push(f)
  }
  return { surfaceFields, residualFields }
}

/**
 * CC-4: does the extractor support the input's declared file type(s)?
 *
 * Schema-driven support set, derived from the action's own declarations:
 *  - an explicit `x-accepted-file-types` list, if present (forward-looking), OR
 *  - the `must_support` capability flags (e.g. `pdf_extraction` → pdf,
 *    `image_extraction` → jpg/jpeg/png/gif/webp). These are the plugin's own
 *    declared flags — reading them is not plugin-identity branching.
 *
 * Passes when every declared file type is supported, OR when the extract declares
 * no file types (unknown → defer to the extractor, which handles common docs).
 * Fails when at least one declared file type is not in the support set.
 */
export function pluginSupportsFileTypes(
  actionDef: CoverageActionDef,
  fileTypes: string[] | undefined,
): boolean {
  if (!fileTypes || fileTypes.length === 0) return true

  const explicit = actionDef?.['x-accepted-file-types']
  const supported = new Set<string>()
  if (Array.isArray(explicit)) {
    for (const t of explicit) supported.add(normalizeFileType(t))
  } else {
    // Derive from must_support flags (the plugin's declared capabilities).
    const flags = actionDef?.must_support || []
    for (const flag of flags) {
      if (/pdf/i.test(flag)) supported.add('pdf')
      if (/image|ocr/i.test(flag)) {
        for (const t of ['jpg', 'jpeg', 'png', 'gif', 'webp', 'image', 'tiff', 'bmp']) supported.add(t)
      }
    }
  }

  // If the action declares no support signal at all, we cannot establish
  // file-type coverage from schema → conservative: do not claim support.
  if (supported.size === 0) return false

  return fileTypes.every((t) => supported.has(normalizeFileType(t)))
}

function normalizeFileType(t: string): string {
  return String(t).toLowerCase().replace(/^\./, '').replace(/^application\//, '').replace(/^image\//, '')
}

/**
 * The ordered coverage judgment. `inputIsFile` (CC-1) is resolved by the caller
 * from the extract input's producer schema (the binder has the full step graph,
 * so it resolves loop-internal producers correctly — the RCA's gate-1 fix).
 */
export function evaluateExtractionCoverage(input: {
  fields: CoverageField[]
  fileTypes?: string[]
  inputIsFile: boolean
  connectedPlugins: ConnectedPluginsMap
}): ExtractCoverageVerdict {
  const { fields, fileTypes, inputIsFile, connectedPlugins } = input

  // CC-1 — document/file input?
  if (!inputIsFile) {
    return {
      covered: false,
      decidingCriterion: 'CC-1',
      reason: 'CC-1 failed: extract input does not resolve to a document/file (bytes-bearing / file_attachment) slot',
      deterministicPlugin: null,
      surfaceFields: [],
      residualFields: fields || [],
    }
  }

  // CC-2 — a connected deterministic document-extraction capability?
  const extractor = findDeterministicDocumentExtractor(connectedPlugins)
  if (!extractor) {
    return {
      covered: false,
      decidingCriterion: 'CC-2',
      reason: `CC-2 failed: no connected plugin declares a deterministic document-extraction capability (${DOC_EXTRACTION_DOMAIN}/${DOC_EXTRACTION_CAPABILITY})`,
      deterministicPlugin: null,
      surfaceFields: [],
      residualFields: fields || [],
    }
  }

  // CC-4 — file-type support?
  if (!pluginSupportsFileTypes(extractor.actionDef, fileTypes)) {
    return {
      covered: false,
      decidingCriterion: 'CC-4',
      reason: `CC-4 failed: ${extractor.pluginKey}.${extractor.action} does not support the requested file type(s): ${(fileTypes || []).join(', ')}`,
      deterministicPlugin: null,
      surfaceFields: [],
      residualFields: fields || [],
    }
  }

  // CC-3 / CC-3a — requested-field coverage via declared-source partition.
  const { surfaceFields, residualFields } = partitionFieldsBySource(fields || [])

  // G1: zero deterministically-coverable surface fields → not covered; AI whole.
  if (surfaceFields.length === 0) {
    return {
      covered: false,
      decidingCriterion: 'CC-3',
      reason: 'CC-3 failed (G1): no requested field declares source="document" — the deterministic extractor covers no surface field for this extraction',
      deterministicPlugin: null,
      surfaceFields: [],
      residualFields: fields || [],
    }
  }

  // Covered. Surface subset → deterministic; residual (if any) → downstream AI split (CC-3a).
  return {
    covered: true,
    decidingCriterion: 'covered',
    reason:
      `Covered by ${extractor.pluginKey}.${extractor.action}: ${surfaceFields.length} document-surface field(s) bound deterministically` +
      (residualFields.length > 0
        ? `; ${residualFields.length} meta/computed field(s) split to a downstream AI generate step (CC-3a)`
        : ''),
    deterministicPlugin: { pluginKey: extractor.pluginKey, action: extractor.action },
    surfaceFields,
    residualFields,
  }
}
