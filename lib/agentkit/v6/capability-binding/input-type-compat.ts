/**
 * Input-Type Compatibility — Types, Vocabulary, and Rules
 *
 * **This file is the single source of truth** for all semantic type definitions,
 * compatibility rules, and property-name markers used by the input-type checking
 * system (Direction #3).
 *
 * Design doc: docs/v6/V6_WORKFLOW_DATA_SCHEMA_DESIGN_REBASE.md (Deep Dive C, §C.5.4)
 *
 * ## Maintenance guide
 *
 * Everything flows from this file:
 *
 *   input-type-compat.ts
 *   ├── FROM_TYPE_VALUES (const array)     ← add new types HERE
 *   ├── TO_TYPE_EXTRAS (const array)       ← add new types HERE
 *   ├── FromType (derived type)            ← auto-derived, don't edit directly
 *   ├── ToType (derived type)              ← auto-derived, don't edit directly
 *   ├── KNOWN_SEMANTIC_TYPES (derived Set) ← auto-derived, used by plugin validator
 *   ├── TYPE_COMPAT (hand-maintained)      ← add compatibility rules HERE
 *   ├── FILE_PROPERTY_MARKERS              ← heuristic fallback, shrinks as plugins get x-semantic-type annotations
 *   ├── TEXT_PROPERTY_MARKERS              ← heuristic fallback, shrinks as plugins get x-semantic-type annotations
 *   ├── FILE_PARAM_NAMES                   ← heuristic fallback, shrinks as plugins get from_type declarations
 *   └── PRIMARY_CONTENT_PARAMS             ← design decision, scopes which params trigger type checks
 *
 * To add a new semantic type:
 *   1. Add to FROM_TYPE_VALUES or TO_TYPE_EXTRAS below
 *   2. Add compatibility entry to TYPE_COMPAT
 *   3. The TypeScript type, runtime KNOWN_SEMANTIC_TYPES set, and plugin validator all update automatically
 *
 * The heuristic marker sets (FILE_PROPERTY_MARKERS, TEXT_PROPERTY_MARKERS, FILE_PARAM_NAMES)
 * are temporary — they infer semantic types from property/param names when explicit
 * x-semantic-type annotations are missing. As more plugin definitions get annotated,
 * these sets become unnecessary. Track their firing rate to know when to remove them.
 *
 * See also: validatePluginTypeAnnotations.ts — linter that flags unknown type values
 * in plugin definitions, so new types can't slip in without updating this file.
 */

// ─── Semantic Type Definitions ──────────────────────────────────────────
// Single source of truth: the const arrays below define every valid value.
// The TypeScript types and the runtime Set are both derived from these arrays.
// To add a new type: add it to the appropriate array below — everything else follows.

/**
 * All semantic types that a plugin input parameter can require.
 * Read from `x-variable-mapping.from_type` or `x-input-mapping.accepts[]` on plugin parameters.
 */
export const FROM_TYPE_VALUES = [
  'file_attachment',
  'file',
  'folder',
  'folder_ref',
  'text_content',
  'html_content',
  'email',
  'email_message',
  'message',
  'record',
  'row',
  'spreadsheet_ref',
  'url',
  'identifier',
] as const

export type FromType = (typeof FROM_TYPE_VALUES)[number]

/**
 * Additional semantic types that only appear on producer (output) side.
 */
export const TO_TYPE_EXTRAS = ['string', 'object', 'array', 'unknown'] as const

export type ToType = FromType | (typeof TO_TYPE_EXTRAS)[number]

/**
 * Runtime-queryable set of all known semantic type values.
 * Used by validatePluginTypeAnnotations to flag unknown types.
 */
export const KNOWN_SEMANTIC_TYPES: ReadonlySet<string> = new Set<string>([
  ...FROM_TYPE_VALUES,
  ...TO_TYPE_EXTRAS,
])

// ─── Compatibility Matrix ───────────────────────────────────────────────

/**
 * Compatibility matrix: for a given `from_type` requirement, which `to_type` values satisfy it?
 *
 * If a from_type is not in this map, it requires an exact match.
 * If a to_type is not in any compatible set, it is only compatible with exact match.
 */
export const TYPE_COMPAT: Record<string, Set<string>> = {
  // File-based inputs accept file types
  file_attachment: new Set(['file_attachment', 'file']),
  file: new Set(['file_attachment', 'file']),

  // Folder inputs
  folder: new Set(['folder', 'folder_ref']),
  folder_ref: new Set(['folder', 'folder_ref']),

  // Text content accepts text and HTML
  text_content: new Set(['text_content', 'string', 'html_content']),
  html_content: new Set(['html_content', 'text_content', 'string']),

  // Email/message types
  email: new Set(['email', 'email_message']),
  email_message: new Set(['email', 'email_message']),
  message: new Set(['message', 'email', 'email_message']),

  // Record/row types
  record: new Set(['record', 'row']),
  row: new Set(['record', 'row']),

  // Strict match types — no substitution
  spreadsheet_ref: new Set(['spreadsheet_ref']),
  url: new Set(['url', 'string']),
  identifier: new Set(['identifier', 'string']),
}

// ─── Property-Name Markers ──────────────────────────────────────────────

/**
 * Object property names that indicate a file-typed data structure.
 * Used by InputTypeChecker.resolveSemanticType() to infer semantic type
 * when no explicit `x-semantic-type` annotation is present.
 * Also used by IntentToIRConverter.inputLooksLikeFileAttachment() (WP-12 safety net).
 */
export const FILE_PROPERTY_MARKERS = new Set([
  'file_url', 'attachment_id', 'mimeType', 'file_content', 'file_path',
])

/**
 * Object property names that indicate a text-typed data structure (email, message, post).
 * Used alongside FILE_PROPERTY_MARKERS to distinguish text-primary objects
 * from file-primary objects. An object with both (e.g., email with attachments)
 * is treated as text-primary.
 */
export const TEXT_PROPERTY_MARKERS = new Set([
  'body', 'subject', 'snippet', 'message', 'text', 'content',
])

// ─── Parameter-Name Sets ────────────────────────────────────────────────

/**
 * Parameter names that imply the action requires file input.
 * Used as a heuristic fallback in extractFromType() when no explicit
 * x-variable-mapping or x-input-mapping is declared.
 */
export const FILE_PARAM_NAMES = new Set([
  'file_content', 'file_url', 'file_path',
])

/**
 * Parameter names that represent the action's primary content/data intake.
 * Only these params are checked for from_type compatibility in InputTypeChecker.
 * Non-primary params (folder_id, parent_id, labels, attachments) get their
 * values from config or other variables, not from the step's inputs[].
 */
export const PRIMARY_CONTENT_PARAMS = new Set([
  'file_content', 'file_url', 'file_path', 'content', 'data', 'input',
  'body', 'text', 'document', 'source', 'html_body', 'message',
])

// ─── Functions ──────────────────────────────────────────────────────────

/**
 * Check if a producer's to_type is compatible with a consumer's from_type requirement.
 *
 * Rules (per Q-C3):
 * - If from_type is not declared on the param → compatible (no constraint, skip check)
 * - If to_type is not declared on the source → compatible (no annotation, skip check — warn separately)
 * - Otherwise, check the compatibility matrix
 */
export function isTypeCompatible(
  fromType: string | undefined,
  toType: string | undefined,
): { compatible: boolean; reason?: string } {
  // No from_type declared → no constraint → compatible
  if (!fromType) {
    return { compatible: true }
  }

  // No to_type declared → skip check (warn elsewhere per Q-C3)
  if (!toType) {
    return { compatible: true, reason: 'source_missing_to_type' }
  }

  // Exact match always works
  if (fromType === toType) {
    return { compatible: true }
  }

  // Check compatibility matrix
  const compatSet = TYPE_COMPAT[fromType]
  if (compatSet && compatSet.has(toType)) {
    return { compatible: true }
  }

  // Incompatible
  return {
    compatible: false,
    reason: `required from_type="${fromType}" but source provides to_type="${toType}"`,
  }
}

/**
 * Extract the from_type requirement from a plugin action's parameter definition.
 *
 * Checks (in priority order):
 * 1. x-variable-mapping.from_type
 * 2. x-input-mapping.accepts[] — takes the first entry
 * 3. Param name heuristic via FILE_PARAM_NAMES
 */
export function extractFromType(paramDef: any, paramName: string): string | undefined {
  // 1. Explicit x-variable-mapping.from_type
  const varMapping = paramDef?.['x-variable-mapping']
  if (varMapping?.from_type) {
    return varMapping.from_type
  }

  // 2. x-input-mapping.accepts[]
  const inputMapping = paramDef?.['x-input-mapping']
  const accepts = Array.isArray(inputMapping?.accepts) ? inputMapping.accepts : []
  if (accepts.includes('file_object') || accepts.includes('file_attachment')) {
    return 'file_attachment'
  }

  // 3. Param name heuristic (minimal — only for very clear file params)
  if (FILE_PARAM_NAMES.has(paramName)) {
    return 'file_attachment'
  }

  return undefined
}

/**
 * Extract all parameters with a from_type constraint from an action's parameter schema.
 * Returns the full list — callers (InputTypeChecker) apply further filtering
 * (e.g., PRIMARY_CONTENT_PARAMS) to determine which constraints are binding.
 */
export function getActionInputTypeConstraints(
  actionParams: Record<string, any> | undefined,
): Array<{ param: string; from_type: string }> {
  if (!actionParams) return []

  const constraints: Array<{ param: string; from_type: string }> = []
  for (const [paramName, paramDef] of Object.entries(actionParams)) {
    const fromType = extractFromType(paramDef, paramName)
    if (fromType) {
      constraints.push({ param: paramName, from_type: fromType })
    }
  }
  return constraints
}
