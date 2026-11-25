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
   * The sheet row the FIRST element of `data` came from, 1-based.
   *
   * A read of `A2:Z200` passes 2. Without it `source_row` would number from
   * the array rather than from the sheet, and a write-back would mark the
   * wrong line. Defaults to 1 — a read that started at the top.
   */
  row_offset?: number
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

  /*
   * Where each object came from, in the sheet's own numbering.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * WITHOUT IT, NOTHING DOWNSTREAM CAN WRITE BACK.
   *
   * A row becomes an object here and its position is lost. That is fine for
   * reading and fatal for marking: the spreadsheet importer files a contact
   * and then has no way to say WHICH row it filed, so an owner re-reads the
   * same sheet every day with nothing on it to show what was already taken.
   *
   * The scatter does expose a 0-based `index`, but the template resolver does
   * only `{{path}}` lookups — no arithmetic — so `{{index + 2}}` cannot be
   * written, and the offset between an array position and a sheet row depends
   * on where the read started anyway. The row number has to travel WITH the
   * object.
   *
   * `source_row` is 1-based, like the row numbers down the left of the sheet,
   * and it accounts for both the header and any rows the read skipped.
   *
   * OPT-IN, AND THAT MATTERS MORE THAN IT LOOKS. `rows_to_objects` is used by
   * every agent on the platform that reads a sheet, and stamping unconditionally
   * put an extra key into every object each of them produces. Nothing asked for
   * it, anything mapping over the keys would see it, and a shape change to a
   * shared transform is the kind of thing that breaks an agent nobody has
   * touched in months. `row_offset` is the caller saying where the read started,
   * which is both the information the stamp needs and a clear statement that it
   * is wanted: without it, output is byte-for-byte what it was before.
   *
   * Written only when it does not collide with a real column either. A sheet
   * whose header literally says "source_row" means its own data, and silently
   * overwriting that would be the worse failure.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const hasOffset = typeof config.row_offset === 'number'
  const rowOffset = hasOffset ? (config.row_offset as number) : 1
  const headerRows = config.headers ? 0 : headerRowIndex + 1
  const takenKeys = new Set(
    headers.map((h: string, i: number) => {
      const trimmed = (h || `column_${i}`).toString().trim()
      return preserveCase ? trimmed : trimmed.toLowerCase()
    })
  )
  const stampRow = hasOffset && !takenKeys.has('source_row')

  return dataRows.map((row: any[], rowIndex: number) => {
    const obj: Record<string, any> = {}
    headers.forEach((header: string, index: number) => {
      const trimmed = (header || `column_${index}`).toString().trim()
      const key = preserveCase ? trimmed : trimmed.toLowerCase()
      obj[key] = row[index] !== undefined ? row[index] : null
    })
    if (stampRow) obj.source_row = rowOffset + headerRows + rowIndex
    return obj
  })
}
