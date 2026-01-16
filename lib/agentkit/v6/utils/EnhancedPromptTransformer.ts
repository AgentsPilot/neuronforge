/**
 * Enhanced Prompt Transformer
 *
 * Converts production Enhanced Prompt format into the format expected by V6 Semantic Pipeline.
 *
 * Production Format:
 * - Has specifics.services_involved and specifics.resolved_user_inputs
 * - Missing metadata.data_source
 *
 * V6 Semantic Format:
 * - Has metadata.data_source with plugin config for grounding
 */

export interface ProductionEnhancedPrompt {
  plan_title: string
  plan_description: string
  sections: {
    data: string[]
    actions: string[]
    output: string[]
    delivery: string[]
    processing_steps?: string[]
  }
  specifics: {
    services_involved: string[]
    user_inputs_required: any[]
    resolved_user_inputs: Array<{
      key: string
      value: any
    }>
  }
}

export interface V6EnhancedPrompt {
  sections: {
    data: string[]
    actions: string[]
    output?: string[]
    delivery: string[]
  }
  metadata?: {
    data_source?: {
      type: string
      config: Record<string, any>
    }
    intent?: string
    complexity?: string
  }
}

/**
 * Transform production Enhanced Prompt to V6 format with metadata.data_source
 */
export function transformEnhancedPromptForV6(
  productionPrompt: ProductionEnhancedPrompt
): V6EnhancedPrompt {
  console.log('[EnhancedPromptTransformer] Transforming production Enhanced Prompt to V6 format...')

  const { sections, specifics } = productionPrompt

  // Identify primary data source plugin
  const primaryDataSource = identifyPrimaryDataSource(specifics.services_involved, sections.data)
  console.log('[EnhancedPromptTransformer] Primary data source:', primaryDataSource)

  // Extract plugin config from resolved_user_inputs
  const dataSourceConfig = extractDataSourceConfig(
    primaryDataSource,
    specifics.resolved_user_inputs,
    sections.data
  )
  console.log('[EnhancedPromptTransformer] Data source config:', dataSourceConfig)

  // Build V6 Enhanced Prompt
  const v6Prompt: V6EnhancedPrompt = {
    sections: {
      data: sections.data,
      actions: sections.actions,
      output: sections.output,
      delivery: sections.delivery
    }
  }

  // Add metadata if we have a data source
  if (primaryDataSource && dataSourceConfig) {
    v6Prompt.metadata = {
      data_source: {
        type: primaryDataSource,
        config: dataSourceConfig
      },
      intent: inferIntent(productionPrompt),
      complexity: inferComplexity(sections)
    }
  }

  return v6Prompt
}

/**
 * Wave 7 Fix: Data source plugins identified by capability, not hardcoded names.
 *
 * A plugin is considered a data source if it has actions that read/list/search data:
 * - search_messages, read_range, list_records, get_records, search, list_bases, etc.
 *
 * This list is derived from plugin action patterns, not plugin names.
 */
const DATA_SOURCE_ACTION_PATTERNS = [
  'search',      // search_messages, search
  'read',        // read_range, read_content
  'list',        // list_records, list_bases
  'get',         // get_record, get_contact
  'fetch',       // fetch_messages
  'query',       // query_records
]

/**
 * Check if a plugin name represents a data source capability.
 * This is inferred from common category patterns until proper
 * plugin metadata (like capabilities: ['data-source']) is available.
 *
 * Wave 10: Uses category-based detection - checks if plugin name
 * contains patterns associated with data storage/retrieval.
 */
function isLikelyDataSourcePlugin(pluginName: string): boolean {
  const normalized = pluginName.toLowerCase().replace(/_/g, '-')

  // Category patterns that indicate data source capability
  // These are semantic categories, not specific plugin names
  const dataSourceCategories = [
    /mail/,        // Email services (any mail provider)
    /sheet/,       // Spreadsheet services
    /table/,       // Table/database services
    /crm/,         // CRM category
    /drive/,       // File storage
    /calendar/,    // Calendar services
    /database/,    // Database services
    /record/,      // Record-based services
    /contact/,     // Contact management
    /storage/,     // Storage services
  ]

  return dataSourceCategories.some(pattern => pattern.test(normalized))
}

/**
 * Identify the primary data source plugin from services_involved
 *
 * Wave 10: Returns the service name as-is (normalized) rather than
 * mapping to hardcoded plugin names. The actual plugin resolution
 * happens in PluginResolver at compile time.
 */
function identifyPrimaryDataSource(
  servicesInvolved: string[],
  dataSections: string[]
): string | null {
  // Find first service that matches data source patterns
  for (const service of servicesInvolved) {
    const normalized = service.toLowerCase().replace(/_/g, '-')
    if (isLikelyDataSourcePlugin(normalized)) {
      return normalized
    }
  }

  // If no data source service found, try to infer category from data sections text
  // Return the category pattern, not a specific plugin name
  for (const dataLine of dataSections) {
    const lowerData = dataLine.toLowerCase()

    // Infer category from data description keywords
    // These return semantic categories that PluginResolver will map to actual plugins
    if (lowerData.includes('email') || lowerData.includes('mail')) {
      // Return category hint - PluginResolver will find the appropriate mail plugin
      return 'mail'
    }
    if (lowerData.includes('spreadsheet') || lowerData.includes('sheet')) {
      return 'sheets'
    }
    if (lowerData.includes('table') || lowerData.includes('base')) {
      return 'table'
    }
    if (lowerData.includes('crm') || lowerData.includes('contact') || lowerData.includes('lead')) {
      return 'crm'
    }
    if (lowerData.includes('drive') || lowerData.includes('file') || lowerData.includes('document')) {
      return 'drive'
    }
    if (lowerData.includes('calendar') || lowerData.includes('event')) {
      return 'calendar'
    }
  }

  return null
}

/**
 * Extract plugin config from resolved_user_inputs based on plugin category
 *
 * Wave 10: Uses category-based config extraction instead of hardcoded plugin names.
 * Categories are semantic groups that share similar configuration patterns.
 */
function extractDataSourceConfig(
  pluginType: string | null,
  resolvedInputs: Array<{ key: string; value: any }>,
  dataSections: string[]
): Record<string, any> | null {
  if (!pluginType) return null

  const inputMap = new Map(resolvedInputs.map(i => [i.key, i.value]))
  const lowerType = pluginType.toLowerCase()

  // Determine category from plugin type/name
  // This maps any plugin to its semantic category for config extraction
  if (lowerType.includes('mail') || lowerType === 'mail') {
    return extractEmailConfig(inputMap, dataSections)
  }
  if (lowerType.includes('sheet') || lowerType === 'sheets') {
    return extractSpreadsheetConfig(inputMap, dataSections)
  }
  if (lowerType.includes('table') || lowerType === 'table' || lowerType.includes('base')) {
    return extractTableConfig(inputMap, dataSections)
  }
  if (lowerType.includes('notion')) {
    return extractDatabaseConfig(inputMap, dataSections)
  }
  if (lowerType.includes('crm') || lowerType === 'crm') {
    return extractCRMConfig(inputMap, dataSections)
  }
  if (lowerType.includes('drive') || lowerType === 'drive') {
    return extractStorageConfig(inputMap, dataSections)
  }
  if (lowerType.includes('calendar') || lowerType === 'calendar') {
    return extractCalendarConfig(inputMap, dataSections)
  }

  // Generic fallback - extract any known input keys
  console.warn(`[EnhancedPromptTransformer] Unknown plugin category: ${pluginType}, using generic config`)
  return extractGenericConfig(inputMap, dataSections)
}

/**
 * Extract email service config (works for any mail provider)
 * Wave 10: Category-based - not specific to Gmail
 */
function extractEmailConfig(
  inputs: Map<string, any>,
  dataSections: string[]
): Record<string, any> {
  const config: Record<string, any> = {}

  // Build query from inputs (common pattern for email search)
  const queryParts: string[] = []

  // Add scope/folder
  const scope = inputs.get('gmail_scope') || inputs.get('mail_scope') || inputs.get('folder')
  if (scope) {
    queryParts.push(`in:${scope.toLowerCase()}`)
  }

  // Add time window
  const timeWindow = inputs.get('data_time_window') || inputs.get('time_window')
  if (timeWindow) {
    const daysMatch = timeWindow.match(/(\d+)\s*days?/)
    if (daysMatch) {
      queryParts.push(`newer_than:${daysMatch[1]}d`)
    }
  }

  // Add keywords
  const keywords = inputs.get('complaint_keywords') || inputs.get('keywords') || inputs.get('search_keywords')
  if (keywords && typeof keywords === 'string') {
    const keywordList = keywords.split(',').map(k => k.trim())
    if (keywordList.length > 0) {
      const keywordQuery = keywordList.map(k => `subject:${k} OR body:${k}`).join(' OR ')
      queryParts.push(`(${keywordQuery})`)
    }
  }

  if (queryParts.length > 0) {
    config.query = queryParts.join(' ')
  }
  config.max_results = inputs.get('max_results') || 100

  return config
}

/**
 * Extract spreadsheet service config (works for any spreadsheet provider)
 * Wave 10: Category-based - not specific to Google Sheets
 */
function extractSpreadsheetConfig(
  inputs: Map<string, any>,
  dataSections: string[]
): Record<string, any> {
  const config: Record<string, any> = {}

  // Spreadsheet ID
  const spreadsheetId = inputs.get('spreadsheet_id') || inputs.get('sheet_id') || inputs.get('workbook_id')
  if (spreadsheetId) {
    config.spreadsheet_id = spreadsheetId
  }

  // Sheet/tab name and range
  const sheetTab = inputs.get('sheet_tab_name') || inputs.get('tab_name') || inputs.get('worksheet')
  if (sheetTab) {
    config.range = `${sheetTab}!A:Z`
  }

  return config
}

/**
 * Extract table/base service config (works for Airtable, similar services)
 * Wave 10: Category-based
 */
function extractTableConfig(
  inputs: Map<string, any>,
  dataSections: string[]
): Record<string, any> {
  const config: Record<string, any> = {}

  const baseId = inputs.get('airtable_base_id') || inputs.get('base_id') || inputs.get('workspace_id')
  if (baseId) {
    config.base_id = baseId
  }

  const tableName = inputs.get('airtable_table_name') || inputs.get('table_name') || inputs.get('table')
  if (tableName) {
    config.table_name = tableName
  }

  return config
}

/**
 * Extract database service config (works for Notion, similar services)
 * Wave 10: Category-based
 */
function extractDatabaseConfig(
  inputs: Map<string, any>,
  dataSections: string[]
): Record<string, any> {
  const config: Record<string, any> = {}

  const databaseId = inputs.get('notion_database_id') || inputs.get('database_id') || inputs.get('db_id')
  if (databaseId) {
    config.database_id = databaseId
  }

  return config
}

/**
 * Extract CRM service config (works for HubSpot, Salesforce, etc.)
 * Wave 10: Category-based
 */
function extractCRMConfig(
  inputs: Map<string, any>,
  dataSections: string[]
): Record<string, any> {
  const config: Record<string, any> = {}

  const objectType = inputs.get('object_type') || inputs.get('record_type') || 'contacts'
  config.object_type = objectType

  const filter = inputs.get('filter') || inputs.get('query')
  if (filter) {
    config.filter = filter
  }

  return config
}

/**
 * Extract storage/drive service config
 * Wave 10: Category-based
 */
function extractStorageConfig(
  inputs: Map<string, any>,
  dataSections: string[]
): Record<string, any> {
  const config: Record<string, any> = {}

  const folderId = inputs.get('folder_id') || inputs.get('drive_folder_id')
  if (folderId) {
    config.folder_id = folderId
  }

  const fileType = inputs.get('file_type') || inputs.get('mime_type')
  if (fileType) {
    config.file_type = fileType
  }

  return config
}

/**
 * Extract calendar service config
 * Wave 10: Category-based
 */
function extractCalendarConfig(
  inputs: Map<string, any>,
  dataSections: string[]
): Record<string, any> {
  const config: Record<string, any> = {}

  const calendarId = inputs.get('calendar_id') || 'primary'
  config.calendar_id = calendarId

  const timeWindow = inputs.get('data_time_window') || inputs.get('time_window')
  if (timeWindow) {
    config.time_window = timeWindow
  }

  return config
}

/**
 * Extract generic config - fallback for unknown plugin categories
 * Wave 10: Extracts any available input key-value pairs
 */
function extractGenericConfig(
  inputs: Map<string, any>,
  dataSections: string[]
): Record<string, any> {
  const config: Record<string, any> = {}

  // Copy all inputs that aren't user-specific
  for (const [key, value] of inputs) {
    if (!key.includes('user_') && !key.includes('email')) {
      config[key] = value
    }
  }

  return config
}

/**
 * Infer user intent from plan title/description
 */
function inferIntent(prompt: ProductionEnhancedPrompt): string {
  const title = prompt.plan_title.toLowerCase()
  const description = prompt.plan_description.toLowerCase()

  if (title.includes('complaint') || description.includes('complaint')) {
    return 'complaint_tracker'
  }
  if (title.includes('lead') || description.includes('lead')) {
    return 'lead_management'
  }
  if (title.includes('expense') || description.includes('expense')) {
    return 'expense_tracking'
  }
  if (title.includes('report') || description.includes('summary')) {
    return 'reporting'
  }

  return 'workflow_automation'
}

/**
 * Infer complexity from number of sections and processing steps
 */
function inferComplexity(sections: ProductionEnhancedPrompt['sections']): string {
  const totalSteps = (sections.processing_steps?.length || 0) +
                    (sections.actions?.length || 0)

  if (totalSteps <= 3) return 'simple'
  if (totalSteps <= 6) return 'moderate'
  return 'complex'
}
