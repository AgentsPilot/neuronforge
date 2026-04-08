/**
 * AIOutputValidator — Runtime validation of AI step outputs against declared schemas
 *
 * Direction #2: Enforces the contract that V6 design promised but never implemented
 * at runtime. When an ai_processing step declares an output_schema, this validator
 * checks the actual LLM output against it — structurally, not semantically.
 *
 * Design doc: docs/v6/V6_WORKFLOW_DATA_SCHEMA_DESIGN_REBASE.md (Deep Dive B)
 *
 * What it catches:
 *   - LLM returns prose instead of JSON → extraction failure
 *   - JSON with wrong wrapper ({result: {actual...}}) → missing expected fields
 *   - Required field missing → missing_required error
 *   - Type mismatch (array vs string, object vs number) → type_mismatch error
 *   - Memory-dump garbage → missing all expected fields
 *
 * What it does NOT catch:
 *   - Semantically-invalid but structurally-valid output ("Unknown X" placeholders)
 *   - That requires trust-metadata propagation (§B.6, separate concern)
 *
 * Validation rules (per B.3):
 *   1. Declaration opts in: no output_schema → no validation
 *   2. No aliasing around failures: schema match or fail, no silent fallback
 *   3. One repair attempt before hard fail
 *   4. Errors are actionable: step ID, expected shape, actual shape, field path
 *   5. Backward compatible: steps without output_schema keep the alias wrapper
 */

import { createLogger } from '@/lib/logger'

const logger = createLogger({ module: 'AIOutputValidator', service: 'V6' })

// ─── Types ──────────────────────────────────────────────────────────────

export interface AIOutputValidationError {
  path: string
  reason: 'missing_required' | 'type_mismatch' | 'not_array' | 'not_object' | 'array_items_invalid'
  expected: string
  actual: string
}

export interface AIOutputValidationResult {
  valid: boolean
  errors: AIOutputValidationError[]
  expectedShape: string
  actualShape: string
}

/** Max array items to validate fully (per Q-B3: all for ≤50, sample for larger) */
const MAX_FULL_VALIDATION_ITEMS = 50
/** How many items to sample from each end of large arrays (first N + last N) */
const SAMPLE_HALF = 5

// ─── Validator ──────────────────────────────────────────────────────────

/**
 * Validate an AI step's actual output against its declared output_schema.
 *
 * Supports both schema formats:
 *   - {properties: {name: {type: "string"}, ...}} (object form)
 *   - {fields: [{name: "x", type: "string"}, ...]} (array form from V6 compiler)
 *
 * @param data     The actual output from the LLM (parsed JSON)
 * @param schema   The declared output_schema
 * @param stepId   For diagnostics
 */
export function validateAIOutput(
  data: any,
  schema: any,
  stepId: string,
): AIOutputValidationResult {
  const errors: AIOutputValidationError[] = []

  // Normalize schema to properties form
  const properties = normalizeSchemaToProperties(schema)
  if (!properties) {
    // Schema has no structure to validate against
    return {
      valid: true,
      errors: [],
      expectedShape: describeSchema(schema),
      actualShape: describeValue(data),
    }
  }

  // Top-level must be an object
  if (data === null || data === undefined || typeof data !== 'object' || Array.isArray(data)) {
    errors.push({
      path: '',
      reason: 'not_object',
      expected: 'object',
      actual: data === null ? 'null' : Array.isArray(data) ? 'array' : typeof data,
    })
    return {
      valid: false,
      errors,
      expectedShape: describeProperties(properties),
      actualShape: describeValue(data),
    }
  }

  // Validate each declared property
  validateProperties(data, properties, '', errors)

  const result: AIOutputValidationResult = {
    valid: errors.length === 0,
    errors,
    expectedShape: describeProperties(properties),
    actualShape: describeValue(data),
  }

  if (result.valid) {
    logger.debug({ stepId, fieldCount: Object.keys(properties).length },
      '[AIOutputValidator] Validation passed')
  } else {
    logger.warn(
      { stepId, errorCount: errors.length, errors: errors.slice(0, 3).map(e => `${e.path}: ${e.reason}`) },
      '[AIOutputValidator] Validation failed'
    )
  }

  return result
}

// ─── Repair Prompt Builder ──────────────────────────────────────────────

/**
 * Build a repair prompt that tells the LLM what went wrong and asks it to fix.
 * Used for the single-retry attempt (per Q-B1).
 */
export function buildRepairPrompt(args: {
  originalPrompt: string
  previousResponse: string
  schema: any
  validation: AIOutputValidationResult | null
  reason: 'extraction_failed' | 'validation_failed'
}): string {
  const { originalPrompt, previousResponse, schema, validation, reason } = args

  logger.info({ reason, errorCount: validation?.errors?.length ?? 0 },
    '[AIOutputValidator] Building repair prompt')

  const properties = normalizeSchemaToProperties(schema)
  const schemaDesc = properties ? describeProperties(properties) : JSON.stringify(schema, null, 2)

  const lines: string[] = []

  lines.push('Your previous response did not match the required output schema.')
  lines.push('')

  if (reason === 'extraction_failed') {
    lines.push('Problem: Could not extract valid JSON from your response.')
  } else if (validation && validation.errors.length > 0) {
    lines.push('Validation errors:')
    for (const err of validation.errors.slice(0, 5)) {
      lines.push(`  - ${err.path || '(root)'}: ${err.reason} — expected ${err.expected}, got ${err.actual}`)
    }
    if (validation.errors.length > 5) {
      lines.push(`  ... and ${validation.errors.length - 5} more errors`)
    }
  }

  lines.push('')
  lines.push('Required schema:')
  lines.push(schemaDesc)
  lines.push('')
  lines.push('Your previous response (first 500 chars):')
  lines.push(previousResponse.substring(0, 500))
  lines.push('')
  lines.push('Original task:')
  lines.push(originalPrompt.substring(0, 500))
  lines.push('')
  lines.push('Respond ONLY with valid JSON matching the schema above. No prose, no explanation, no markdown fences.')

  return lines.join('\n')
}

// ─── Internal helpers ───────────────────────────────────────────────────

/**
 * Normalize output_schema to a properties map.
 * Handles both {properties: {...}} and {fields: [{name, type}, ...]} formats.
 */
function normalizeSchemaToProperties(
  schema: any,
): Record<string, any> | null {
  if (!schema) return null

  // Object form: {properties: {name: {type: "string"}, ...}}
  if (schema.properties && typeof schema.properties === 'object') {
    return schema.properties
  }

  // Array form: {fields: [{name: "x", type: "string"}, ...]}
  if (Array.isArray(schema.fields)) {
    const props: Record<string, any> = {}
    for (const field of schema.fields) {
      if (field.name) {
        props[field.name] = {
          type: field.type || 'string',
          required: field.required,
          description: field.description,
          properties: field.properties,
          items: field.items,
        }
      }
    }
    return Object.keys(props).length > 0 ? props : null
  }

  return null
}

/**
 * Recursively validate an object's properties against a schema properties map.
 */
function validateProperties(
  data: Record<string, any>,
  properties: Record<string, any>,
  pathPrefix: string,
  errors: AIOutputValidationError[],
): void {
  for (const [fieldName, fieldDef] of Object.entries(properties)) {
    const fieldPath = pathPrefix ? `${pathPrefix}.${fieldName}` : fieldName
    const value = data[fieldName]

    // Check required fields
    if (fieldDef.required && (value === undefined || value === null)) {
      errors.push({
        path: fieldPath,
        reason: 'missing_required',
        expected: fieldDef.type || 'any',
        actual: value === null ? 'null' : 'undefined',
      })
      continue
    }

    // Skip validation if field is absent and not required
    if (value === undefined || value === null) continue

    // Type check
    const expectedType = fieldDef.type
    if (expectedType) {
      const typeError = checkType(value, expectedType, fieldPath)
      if (typeError) {
        errors.push(typeError)
        continue // Don't recurse into wrong-typed value
      }
    }

    // Recurse into nested objects
    if (expectedType === 'object' && fieldDef.properties && typeof value === 'object' && !Array.isArray(value)) {
      validateProperties(value, fieldDef.properties, fieldPath, errors)
    }

    // Validate array items
    if (expectedType === 'array' && Array.isArray(value) && fieldDef.items) {
      validateArrayItems(value, fieldDef.items, fieldPath, errors)
    }
  }
}

/**
 * Validate array items against the items schema.
 * Per Q-B3: full validation for ≤50 items, sample 10 (first 5 + last 5) for larger.
 */
function validateArrayItems(
  arr: any[],
  itemSchema: any,
  arrayPath: string,
  errors: AIOutputValidationError[],
): void {
  if (arr.length === 0) return

  let indicesToCheck: number[]
  if (arr.length <= MAX_FULL_VALIDATION_ITEMS) {
    indicesToCheck = arr.map((_, i) => i)
  } else {
    // Sample: first SAMPLE_HALF + last SAMPLE_HALF
    const first = Array.from({ length: Math.min(SAMPLE_HALF, arr.length) }, (_, i) => i)
    const last = Array.from(
      { length: Math.min(SAMPLE_HALF, arr.length) },
      (_, i) => arr.length - 1 - i,
    ).reverse()
    indicesToCheck = [...new Set([...first, ...last])]
  }

  for (const i of indicesToCheck) {
    const item = arr[i]
    const itemPath = `${arrayPath}[${i}]`

    // Check item type
    if (itemSchema.type) {
      const typeError = checkType(item, itemSchema.type, itemPath)
      if (typeError) {
        errors.push(typeError)
        continue
      }
    }

    // Recurse into item properties
    if (itemSchema.type === 'object' && itemSchema.properties && typeof item === 'object' && item !== null) {
      validateProperties(item, itemSchema.properties, itemPath, errors)
    }
  }
}

/**
 * Check a single value's type against an expected JSON Schema type.
 */
function checkType(
  value: any,
  expectedType: string,
  path: string,
): AIOutputValidationError | null {
  switch (expectedType) {
    case 'string':
      if (typeof value !== 'string') {
        return { path, reason: 'type_mismatch', expected: 'string', actual: `${typeof value} (${truncate(value)})` }
      }
      break
    case 'number':
    case 'integer':
      if (typeof value !== 'number') {
        return { path, reason: 'type_mismatch', expected: expectedType, actual: `${typeof value} (${truncate(value)})` }
      }
      break
    case 'boolean':
      if (typeof value !== 'boolean') {
        return { path, reason: 'type_mismatch', expected: 'boolean', actual: `${typeof value} (${truncate(value)})` }
      }
      break
    case 'array':
      if (!Array.isArray(value)) {
        return { path, reason: 'not_array', expected: 'array', actual: `${typeof value} (${truncate(value)})` }
      }
      break
    case 'object':
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return { path, reason: 'not_object', expected: 'object', actual: Array.isArray(value) ? 'array' : `${typeof value}` }
      }
      break
    // 'any' — no validation
  }
  return null
}

/**
 * Describe a properties map as a compact string for error messages.
 */
function describeProperties(properties: Record<string, any>): string {
  const fields = Object.entries(properties).map(([name, def]) => {
    const req = def.required ? ' (required)' : ''
    return `${name}: ${def.type || 'any'}${req}`
  })
  return `{ ${fields.join(', ')} }`
}

/**
 * Describe a schema for error messages.
 */
function describeSchema(schema: any): string {
  const props = normalizeSchemaToProperties(schema)
  if (props) return describeProperties(props)
  return schema?.type || 'unknown'
}

/**
 * Describe an actual value for error messages.
 */
function describeValue(data: any): string {
  if (data === null) return 'null'
  if (data === undefined) return 'undefined'
  if (Array.isArray(data)) return `array (${data.length} items)`
  if (typeof data === 'object') {
    const keys = Object.keys(data)
    return `{ ${keys.slice(0, 5).join(', ')}${keys.length > 5 ? `, ...${keys.length - 5} more` : ''} }`
  }
  return `${typeof data}: ${truncate(data)}`
}

/**
 * Truncate a value for display in error messages.
 */
function truncate(value: any, maxLen: number = 50): string {
  const str = typeof value === 'string' ? value : JSON.stringify(value)
  if (!str) return 'null'
  return str.length > maxLen ? str.substring(0, maxLen) + '...' : str
}
