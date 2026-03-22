/**
 * A2: StubDataGenerator — Generate realistic mock data from output_schema
 *
 * Walks a JSON schema and produces mock values using field-name heuristics.
 * Array fields generate 3 items by default to give downstream transforms realistic data.
 */

export interface GeneratorOptions {
  arrayItemCount?: number
  indexSuffix?: string // e.g., "001", "002" — used inside scatter-gather iterations
}

const DEFAULT_OPTIONS: GeneratorOptions = {
  arrayItemCount: 3,
  indexSuffix: '001',
}

/**
 * Generate mock data from a JSON-schema-like output_schema object.
 */
export function generateFromSchema(schema: any, options: GeneratorOptions = {}): any {
  const opts = { ...DEFAULT_OPTIONS, ...options }

  if (!schema) return null

  const type = schema.type || 'object'

  switch (type) {
    case 'object':
      return generateObject(schema, opts)
    case 'array':
      return generateArray(schema, opts)
    case 'string':
      return generateString(schema.description || '', opts)
    case 'number':
    case 'integer':
      return generateNumber(schema.description || '', opts)
    case 'boolean':
      return generateBoolean(schema.description || '')
    default:
      return `mock_${type}`
  }
}

function generateObject(schema: any, opts: GeneratorOptions): Record<string, any> {
  const result: Record<string, any> = {}
  const properties = schema.properties || {}

  for (const [key, propSchema] of Object.entries(properties)) {
    result[key] = generateField(key, propSchema as any, opts)
  }

  return result
}

function generateArray(schema: any, opts: GeneratorOptions): any[] {
  const itemSchema = schema.items
  if (!itemSchema) return []

  const count = opts.arrayItemCount || 3
  const items: any[] = []

  for (let i = 0; i < count; i++) {
    const itemOpts = { ...opts, indexSuffix: String(i + 1).padStart(3, '0') }
    items.push(generateFromSchema(itemSchema, itemOpts))
  }

  return items
}

/**
 * Generate a value for a specific field name + schema.
 * Uses field-name heuristics for realistic values.
 */
function generateField(fieldName: string, schema: any, opts: GeneratorOptions): any {
  const type = schema?.type || 'string'
  const desc = schema?.description || ''
  const lower = fieldName.toLowerCase()

  // Type-specific generation with field-name awareness
  switch (type) {
    case 'object':
      return generateObject(schema, opts)
    case 'array':
      return generateArray(schema, opts)
    case 'string':
      return generateStringByFieldName(lower, fieldName, desc, opts)
    case 'number':
    case 'integer':
      return generateNumberByFieldName(lower, desc, opts)
    case 'boolean':
      return generateBooleanByFieldName(lower, desc)
    default:
      return `mock_${fieldName}_${opts.indexSuffix}`
  }
}

function generateStringByFieldName(lower: string, fieldName: string, desc: string, opts: GeneratorOptions): string {
  const idx = opts.indexSuffix || '001'

  // IDs
  if (lower.endsWith('_id') || lower.endsWith('id') && lower !== 'id' || lower === 'id') {
    return `mock_${fieldName}_${idx}`
  }
  if (lower === 'thread_id') return `thread_${idx}`
  if (lower === 'message_id') return `msg_${idx}`
  if (lower === 'attachment_id') return `att_${idx}`
  if (lower === 'file_id') return `file_${idx}`
  if (lower === 'folder_id') return `folder_${idx}`
  if (lower === 'permission_id') return `perm_${idx}`
  if (lower === 'spreadsheet_id') return `sheet_${idx}`
  if (lower === 'sheet_id') return `sheet_tab_${idx}`

  // URLs and links
  if (lower.includes('url') || lower.includes('link')) {
    return `https://example.com/mock/${fieldName}/${idx}`
  }

  // Email
  if (lower.includes('email') || lower === 'from' || lower === 'to' || lower === 'sender') {
    return `vendor${idx}@example.com`
  }
  if (lower === 'recipients') return `user@example.com`

  // Dates
  if (lower.includes('date') || lower.endsWith('_at') || lower === 'searched_at' || lower === 'created_at') {
    return `2026-03-22T10:${idx.slice(-2)}:00Z`
  }

  // Names
  if (lower === 'filename' || lower === 'file_name') return `invoice_${idx}.pdf`
  if (lower === 'folder_name') return `Vendor_${idx}`
  if (lower === 'sheet_name' || lower === 'tab_name') return `Invoices`
  if (lower === 'vendor') return `Acme Corp ${idx}`
  if (lower === 'category') return `Office Supplies`

  // Content types
  if (lower === 'mimetype' || lower === 'mime_type') return 'application/pdf'
  if (lower === 'type') return desc.toLowerCase().includes('expense') ? 'expense' : 'invoice'

  // Content
  if (lower === 'subject') return `Invoice #INV-${idx} from Acme Corp`
  if (lower === 'snippet') return `Please find attached invoice #INV-${idx} for services rendered...`
  if (lower === 'body' || lower === 'html_body') return `<p>Invoice content for ${idx}</p>`
  if (lower === 'data') return `base64_encoded_pdf_content_${idx}`
  if (lower === 'extracted_text') return `Invoice #INV-${idx}\nDate: 2026-03-22\nAmount: $149.99\nVendor: Acme Corp`
  if (lower === 'invoice_number') return `INV-${idx}`
  if (lower === 'search_query') return `subject:(Invoice OR Bill) has:attachment filename:pdf`

  // Permission type
  if (lower === 'permission_type') return 'anyone_with_link'
  if (lower === 'role') return 'reader'

  // Drive link (special — used in final output)
  if (lower === 'drive_link') return `https://drive.google.com/file/d/mock_file_${idx}/view`

  // Generic string
  return `mock_${fieldName}_${idx}`
}

function generateNumberByFieldName(lower: string, desc: string, opts: GeneratorOptions): number {
  if (lower === 'amount' || lower.includes('price') || lower.includes('total')) return 149.99
  if (lower === 'size' || lower === 'file_size') return 102400
  if (lower.includes('count') || lower.includes('total_found') || lower.includes('total_available')) return 3
  if (lower === 'appended_rows') return 3
  if (lower === 'appended_columns') return 7
  if (lower === 'appended_cells') return 21
  if (lower === 'sheet_id') return 0
  return 42
}

function generateBooleanByFieldName(lower: string, desc: string): boolean {
  if (lower === 'is_image') return false
  if (lower === 'created' || lower === 'existed') return true
  if (lower === 'has_amount') return true
  return true
}

function generateString(desc: string, opts: GeneratorOptions): string {
  return `mock_string_${opts.indexSuffix || '001'}`
}

function generateNumber(desc: string, opts: GeneratorOptions): number {
  return 42
}

function generateBoolean(desc: string): boolean {
  return true
}
