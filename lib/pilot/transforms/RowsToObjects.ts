/**
 * RowsToObjects — pure helper that converts a 2D array (e.g. Google Sheets
 * `{values: [[headers], [row1], ...]}`) into an array of objects, using
 * either the first row as headers (default) or an explicit `headers` array.
 *
 * Extracted from StepExecutor.transformRowsToObjects so tests can import it
 * without pulling the whole executor's heavy import chain (OpenAI, Supabase,
 * runAgentKit, etc.). Same pattern as `lib/pilot/transforms/StructuredTransforms.ts`.
 *
 * Header-case handling (config.preserve_case):
 *   - default (false): lowercase headers for consistent key matching
 *     ("Id"/"ID" → "id"). Matches the V6-introduction behavior; existing
 *     direct callers depend on it.
 *   - true: preserve the header text as-is (just trim whitespace). Used
 *     by the compiler's auto-inject path so downstream LLM `transform/map`
 *     steps that reference the original-case header in their `field_mapping`
 *     (e.g. `{date: "Date", lead_name: "Lead Name"}`) actually read real values
 *     instead of every `item["Date"]` returning undefined (the WP-SR bug).
 */

export interface RowsToObjectsConfig {
  /** Explicit header list. When provided, all rows are kept (no auto-skip). */
  headers?: string[]
  /** When true, keep header text as-is. Otherwise lowercase. */
  preserve_case?: boolean
}

export class RowsToObjectsError extends Error {
  code: string
  constructor(message: string, code: string) {
    super(message)
    this.name = 'RowsToObjectsError'
    this.code = code
  }
}

export function rowsToObjects(data: any[], config: RowsToObjectsConfig = {}): any[] {
  if (!Array.isArray(data)) {
    throw new RowsToObjectsError(
      'rows_to_objects operation requires array input',
      'INVALID_INPUT_TYPE'
    )
  }

  if (data.length === 0) {
    return []
  }

  // Already an array of objects/primitives — nothing to convert.
  if (!Array.isArray(data[0])) {
    return data
  }

  const headers: string[] = config.headers ?? data[0]
  const dataRows = config.headers ? data : data.slice(1)

  if (dataRows.length === 0) {
    return []
  }

  const preserveCase = config.preserve_case === true

  return dataRows.map((row: any[]) => {
    const obj: Record<string, any> = {}
    headers.forEach((header: string, index: number) => {
      const trimmed = (header || `column_${index}`).toString().trim()
      const key = preserveCase ? trimmed : trimmed.toLowerCase()
      obj[key] = row[index] !== undefined ? row[index] : null
    })
    return obj
  })
}
