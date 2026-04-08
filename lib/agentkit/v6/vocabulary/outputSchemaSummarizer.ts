/**
 * Output Schema Summarizer
 *
 * Converts a plugin action's full JSON Schema output_schema into a compact,
 * readable summary for LLM prompt injection. The LLM needs to know the exact
 * field names an action returns — but not the full nested JSON Schema.
 *
 * Design doc: docs/v6/V6_WORKFLOW_DATA_SCHEMA_DESIGN_REBASE.md (Deep Dive A, §A.4)
 *
 * Depth cap: 2 levels of nesting by default (top → items → item properties).
 * Deeper objects are elided as `object` with a field count hint.
 * Per-action override via `x-summary-depth` on the output_schema.
 */

/** A single named type produced during summarization (e.g. "email", "attachment") */
interface NamedType {
  name: string
  fields: string // e.g. "{ id: string, subject: string, from: string }"
}

export interface OutputSchemaSummary {
  /** Top-level return line, e.g. "{ emails: array<email>, total_found: number }" */
  topLine: string
  /** Named sub-types extracted during summarization */
  namedTypes: NamedType[]
  /** Total token estimate (rough: chars / 4) */
  estimatedTokens: number
}

/**
 * Summarize a plugin action's output_schema into a compact string representation.
 *
 * @param schema  The action's output_schema (JSON Schema object)
 * @param depthCap  Max nesting depth for inline expansion (default: 2).
 *                  Objects deeper than this are shown as `object {...N fields}`.
 * @returns OutputSchemaSummary with topLine, namedTypes, and token estimate.
 *          Returns null if schema is missing or has no properties.
 */
export function summarizeOutputSchema(
  schema: any,
  depthCap: number = 2,
): OutputSchemaSummary | null {
  if (!schema || typeof schema !== 'object') return null

  // Allow per-action depth override
  const effectiveDepth = schema['x-summary-depth'] ?? depthCap

  const namedTypes: NamedType[] = []

  const topLine = summarizeField(schema, 0, effectiveDepth, namedTypes, null)
  if (!topLine) return null

  const fullText = topLine + namedTypes.map(t => `\n  ${t.name}: ${t.fields}`).join('')
  const estimatedTokens = Math.ceil(fullText.length / 4)

  return { topLine, namedTypes, estimatedTokens }
}

/**
 * Format a complete summary as a multi-line string ready for prompt injection.
 *
 * Example output:
 *   Returns: { emails: array<email>, total_found: number }
 *     email: { id: string, subject: string, from: string, body: string, attachments: array<attachment> }
 *     attachment: { filename: string, mimeType: string, size: integer }
 */
export function formatSummaryForPrompt(summary: OutputSchemaSummary): string {
  const lines: string[] = []
  lines.push(`Returns: ${summary.topLine}`)
  for (const nt of summary.namedTypes) {
    lines.push(`    ${nt.name}: ${nt.fields}`)
  }
  return lines.join('\n')
}

// ─── Internal helpers ───────────────────────────────────────────────────

/**
 * Recursively summarize a JSON Schema node into a compact string.
 *
 * @param node       JSON Schema node
 * @param depth      Current depth (0 = top level)
 * @param maxDepth   Max depth for inline expansion
 * @param namedTypes Accumulator for extracted named sub-types
 * @param hintName   Suggested name for this type if extracted (e.g. from parent's property key)
 */
function summarizeField(
  node: any,
  depth: number,
  maxDepth: number,
  namedTypes: NamedType[],
  hintName: string | null,
): string {
  if (!node || typeof node !== 'object') return 'any'

  const type = node.type

  if (type === 'object' && node.properties) {
    const propEntries = Object.entries(node.properties)

    // Beyond depth cap: elide to "object {...N fields}"
    if (depth >= maxDepth) {
      return `object {...${propEntries.length} fields}`
    }

    const fieldSummaries: string[] = []

    for (const [key, propDef] of propEntries) {
      const fieldType = summarizeField(
        propDef as any,
        depth + 1,
        maxDepth,
        namedTypes,
        singularize(key),
      )
      fieldSummaries.push(`${key}: ${fieldType}`)
    }

    return `{ ${fieldSummaries.join(', ')} }`
  }

  if (type === 'array' && node.items) {
    const items = node.items

    // If items is an object with properties, try to extract as a named type
    if (items.type === 'object' && items.properties) {
      const itemPropEntries = Object.entries(items.properties)

      // If we're at or beyond depth cap, elide items too
      if (depth + 1 >= maxDepth) {
        const typeName = hintName || 'item'
        // Extract the named type at one more level — share the namedTypes accumulator
        // so nested complex types (e.g. attachment inside email) are also captured
        const itemFields = summarizeField(items, 0, 2, namedTypes, null)
        namedTypes.push({ name: typeName, fields: itemFields })
        return `array<${typeName}>`
      }

      // Inline if small (≤ 4 fields) and not too deep
      if (itemPropEntries.length <= 4 && depth + 1 < maxDepth) {
        const inlineFields: string[] = []
        for (const [key, propDef] of itemPropEntries) {
          const fieldType = summarizeField(
            propDef as any,
            depth + 2,
            maxDepth,
            namedTypes,
            singularize(key),
          )
          inlineFields.push(`${key}: ${fieldType}`)
        }
        return `array<{ ${inlineFields.join(', ')} }>`
      }

      // Extract as named type
      const typeName = hintName || 'item'
      // Summarize the item's fields at depth 0 relative to the named type,
      // but limit to 1 level so named types stay compact
      const itemFields = summarizeObjectFields(items, maxDepth - depth - 1, namedTypes)
      namedTypes.push({ name: typeName, fields: itemFields })
      return `array<${typeName}>`
    }

    // Simple array — recurse for nested arrays (e.g. array<array<string>>)
    if (items.type === 'array' && items.items) {
      const innerType = summarizeField(items, depth + 1, maxDepth, namedTypes, hintName)
      return `array<${innerType}>`
    }
    const itemType = items.type || 'any'
    return `array<${itemType}>`
  }

  // Scalar types
  if (type) return type

  return 'any'
}

/**
 * Summarize an object's properties into a `{ field: type, ... }` string.
 * Used for named type extraction.
 */
function summarizeObjectFields(
  node: any,
  remainingDepth: number,
  namedTypes: NamedType[],
): string {
  if (!node.properties) return '{ }'

  const fieldSummaries: string[] = []
  for (const [key, propDef] of Object.entries(node.properties)) {
    const fieldType = summarizeField(
      propDef as any,
      1, // treat named type content as depth 1
      Math.max(remainingDepth + 1, 2), // allow at least 1 level
      namedTypes,
      singularize(key),
    )
    fieldSummaries.push(`${key}: ${fieldType}`)
  }

  return `{ ${fieldSummaries.join(', ')} }`
}

/**
 * Naive singularization for type naming.
 * "emails" → "email", "attachments" → "attachment", "items" → "item"
 */
function singularize(name: string): string {
  if (name.endsWith('ies')) return name.slice(0, -3) + 'y'
  if (name.endsWith('ses')) return name.slice(0, -2)
  if (name.endsWith('s') && !name.endsWith('ss')) return name.slice(0, -1)
  return name
}
