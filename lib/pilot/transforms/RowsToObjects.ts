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
  /**
   * 1-based row number where headers are located (default: 1).
   * Rows before header_row are skipped. Data starts from header_row + 1.
   * Example: header_row: 4 means row 4 has headers, rows 1-3 are skipped.
   */
  header_row?: number
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

  // Determine header row index (0-based). Default is row 1 (index 0).
  // header_row is 1-based for user-friendliness (matches spreadsheet row numbers).
  let headerRowIndex = config.header_row ? config.header_row - 1 : 0

  // AUTO-DETECTION: If no explicit header_row specified, try to auto-detect
  // by skipping rows that are clearly not headers (empty, single column, etc.)
  if (!config.header_row && !config.headers) {
    // Find first row with multiple non-empty values (likely the real header)
    for (let i = 0; i < Math.min(data.length, 10); i++) {
      const row = data[i]
      if (!Array.isArray(row)) continue

      // Count non-empty cells
      const nonEmptyCells = row.filter(cell =>
        cell !== null && cell !== undefined && cell.toString().trim() !== ''
      ).length

      // If this row has 2+ non-empty cells, assume it's the header
      if (nonEmptyCells >= 2) {
        if (i !== headerRowIndex) {
          console.log(`🔍 [rowsToObjects] Auto-detected header row at index ${i} (row ${i + 1}) with ${nonEmptyCells} columns`)
        }
        headerRowIndex = i
        break
      }
    }
  }

  // Validate header_row is within bounds
  if (headerRowIndex < 0 || headerRowIndex >= data.length) {
    throw new RowsToObjectsError(
      `header_row ${config.header_row} is out of bounds (data has ${data.length} rows)`,
      'INVALID_HEADER_ROW'
    )
  }

  const headers: string[] = config.headers ?? data[headerRowIndex]
  // Data rows start after the header row (skip rows before and including header)
  const dataRows = config.headers ? data : data.slice(headerRowIndex + 1)

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
