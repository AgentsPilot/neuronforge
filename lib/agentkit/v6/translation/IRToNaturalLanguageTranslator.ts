/**
 * IR to Natural Language Translator
 *
 * Converts technical Logical IR into plain English that non-technical users can understand.
 *
 * Key Principles:
 * 1. NO technical jargon (no "IR", "schema", "config")
 * 2. Use emojis for visual clarity
 * 3. Focus on WHAT will happen, not HOW
 * 4. Business-friendly language
 *
 * This is what users see - never raw IR JSON.
 */

import type { ExtendedLogicalIR } from '../logical-ir/schemas/extended-ir-types'

// ============================================================================
// Types
// ============================================================================

export interface NaturalLanguagePlan {
  goal: string
  steps: PlanStep[]
  edgeCases?: string[]
  estimation: {
    emails?: string
    slackMessages?: string
    apiCalls?: string
    time?: string
    cost?: string
  }
  clarifications?: string[]
}

export interface PlanStep {
  icon: string
  title: string
  details: string[]
  type: 'data' | 'filter' | 'transform' | 'ai' | 'partition' | 'delivery' | 'edge_case'
}

// ============================================================================
// Translator
// ============================================================================

export class IRToNaturalLanguageTranslator {
  /**
   * Translate IR to natural language plan
   */
  translate(ir: ExtendedLogicalIR): NaturalLanguagePlan {
    console.log('[Translator] Translating IR to natural language...')
    console.log('[Translator] Goal:', ir.goal)

    const steps: PlanStep[] = []

    // Data sources
    steps.push(...this.translateDataSources(ir))

    // Normalization
    if (ir.normalization) {
      steps.push(this.translateNormalization(ir))
    }

    // Filters
    if (ir.filters && ir.filters.length > 0) {
      steps.push(...this.translateFilters(ir))
    }

    // Transforms
    if (ir.transforms && ir.transforms.length > 0) {
      steps.push(...this.translateTransforms(ir))
    }

    // AI operations
    if (ir.ai_operations && ir.ai_operations.length > 0) {
      steps.push(...this.translateAIOperations(ir))
    }

    // Partitions
    if (ir.partitions && ir.partitions.length > 0) {
      steps.push(...this.translatePartitions(ir))
    }

    // Grouping
    if (ir.grouping) {
      steps.push(this.translateGrouping(ir))
    }

    // Rendering
    if (ir.rendering) {
      steps.push(this.translateRendering(ir))
    }

    // Delivery
    steps.push(...this.translateDelivery(ir))

    // Edge cases
    const edgeCases = ir.edge_cases?.map(ec => this.translateEdgeCase(ec)) || []

    // Estimation
    const estimation = this.estimateWorkflow(ir)

    console.log('[Translator] ✓ Translated to', steps.length, 'steps')

    return {
      goal: ir.goal,
      steps,
      edgeCases,
      estimation,
      clarifications: ir.clarifications_required.length > 0 ? ir.clarifications_required : undefined
    }
  }

  /**
   * Translate data sources
   */
  private translateDataSources(ir: ExtendedLogicalIR): PlanStep[] {
    return ir.data_sources.map(ds => {
      const details: string[] = []

      if (ds.type === 'tabular') {
        details.push(`From: ${ds.location}${ds.tab ? ` (${ds.tab} tab)` : ''}`)
        if (ds.source) {
          details.push(`Source: ${this.friendlySourceName(ds.source)}`)
        }
      } else if (ds.type === 'api') {
        details.push(`Endpoint: ${ds.location}${ds.endpoint || ''}`)
      } else if (ds.type === 'webhook') {
        details.push(`Trigger: ${ds.trigger || ds.location}`)
      } else if (ds.type === 'database') {
        details.push(`Database: ${ds.location}`)
        if (ds.tab) {
          details.push(`Table: ${ds.tab}`)
        }
      } else if (ds.type === 'file') {
        details.push(`File: ${ds.location}`)
      } else if (ds.type === 'stream') {
        details.push(`Stream: ${ds.location}`)
      }

      if (ds.role) {
        details.push(`Purpose: ${ds.role}`)
      }

      return {
        icon: this.getDataSourceIcon(ds.type),
        title: `Read ${this.friendlyDataSourceType(ds.type)}`,
        details,
        type: 'data'
      }
    })
  }

  /**
   * Translate normalization
   */
  private translateNormalization(ir: ExtendedLogicalIR): PlanStep {
    const norm = ir.normalization!
    const details: string[] = []

    details.push(`Required columns: ${norm.required_headers.join(', ')}`)

    if (norm.case_sensitive !== undefined) {
      details.push(`Case sensitive: ${norm.case_sensitive ? 'Yes' : 'No'}`)
    }

    if (norm.missing_header_action) {
      details.push(`If column missing: ${norm.missing_header_action}`)
    }

    return {
      icon: '✅',
      title: 'Validate data structure',
      details,
      type: 'filter'
    }
  }

  /**
   * Translate filters
   */
  private translateFilters(ir: ExtendedLogicalIR): PlanStep[] {
    const filters = ir.filters!

    // Combine into single step if multiple filters
    if (filters.length === 1) {
      const filter = filters[0]
      return [{
        icon: '🔍',
        title: 'Filter data',
        details: [this.describeFilter(filter)],
        type: 'filter'
      }]
    }

    return [{
      icon: '🔍',
      title: 'Filter data',
      details: filters.map(f => this.describeFilter(f)),
      type: 'filter'
    }]
  }

  /**
   * Describe a single filter
   */
  private describeFilter(filter: any): string {
    const operatorText = this.friendlyOperator(filter.operator)
    const valueText = this.friendlyValue(filter.value)

    if (filter.operator === 'is_empty') {
      return `Where ${filter.field} is empty`
    }
    if (filter.operator === 'is_not_empty') {
      return `Where ${filter.field} is not empty`
    }

    return `Where ${filter.field} ${operatorText} ${valueText}`
  }

  /**
   * Translate transforms
   */
  private translateTransforms(ir: ExtendedLogicalIR): PlanStep[] {
    return ir.transforms!.map(t => {
      const details: string[] = []

      if (t.operation === 'sort') {
        details.push(`By: ${t.config.sort_by || t.config.field}`)
        details.push(`Order: ${t.config.order === 'desc' ? 'Newest first' : 'Oldest first'}`)
      } else if (t.operation === 'group') {
        details.push(`By: ${t.config.group_by || t.config.field}`)
      } else if (t.operation === 'aggregate') {
        details.push(`Function: ${t.config.aggregation}`)
        if (t.config.field) {
          details.push(`Field: ${t.config.field}`)
        }
      } else if (t.operation === 'deduplicate') {
        details.push(t.config.field ? `By: ${t.config.field}` : 'Remove duplicate rows')
      } else if (t.operation === 'join') {
        details.push(`With: ${t.config.source}`)
        details.push(`On: ${t.config.join_key}`)
      }

      return {
        icon: '🔧',
        title: this.friendlyTransformOperation(t.operation),
        details,
        type: 'transform'
      }
    })
  }

  /**
   * Translate AI operations
   */
  private translateAIOperations(ir: ExtendedLogicalIR): PlanStep[] {
    return ir.ai_operations!.map(ai => {
      const details: string[] = []

      details.push(`Task: ${ai.instruction}`)
      details.push(`Input: ${this.cleanVariableReference(ai.input_source)}`)

      if (ai.output_schema.enum) {
        details.push(`Options: ${ai.output_schema.enum.join(', ')}`)
      }

      if (ai.constraints?.model_preference) {
        details.push(`Speed: ${ai.constraints.model_preference}`)
      }

      return {
        icon: '🤖',
        title: this.friendlyAIOperation(ai.type),
        details,
        type: 'ai'
      }
    })
  }

  /**
   * Translate partitions
   */
  private translatePartitions(ir: ExtendedLogicalIR): PlanStep[] {
    return ir.partitions!.map(p => {
      const details: string[] = []

      details.push(`Split by: ${p.field}`)
      details.push(`Strategy: ${p.split_by === 'value' ? 'Each unique value' : 'By condition'}`)

      if (p.handle_empty) {
        details.push(`Empty values: ${p.handle_empty.description || 'Handled separately'}`)
      }

      return {
        icon: '📂',
        title: 'Split data into groups',
        details,
        type: 'partition'
      }
    })
  }

  /**
   * Translate grouping
   */
  private translateGrouping(ir: ExtendedLogicalIR): PlanStep {
    const g = ir.grouping!

    const details: string[] = []
    details.push(`Group by: ${g.group_by}`)
    details.push(g.emit_per_group ? 'Process each group separately' : 'Combine all groups')

    return {
      icon: '📦',
      title: 'Group data',
      details,
      type: 'partition'
    }
  }

  /**
   * Translate rendering
   */
  private translateRendering(ir: ExtendedLogicalIR): PlanStep {
    const r = ir.rendering!

    const details: string[] = []

    if (r.type === 'html_table' || r.type === 'email_embedded_table') {
      details.push('Format: HTML table')
      if (r.columns_in_order) {
        details.push(`Columns: ${r.columns_in_order.join(', ')}`)
      }
    } else if (r.type === 'json') {
      details.push('Format: JSON')
    } else if (r.type === 'csv') {
      details.push('Format: CSV')
    } else if (r.type === 'template') {
      details.push(`Template: ${r.engine || 'custom'}`)
    }

    if (r.empty_message) {
      details.push(`If empty: "${r.empty_message}"`)
    }

    return {
      icon: '🎨',
      title: 'Format output',
      details,
      type: 'transform'
    }
  }

  /**
   * Translate delivery
   */
  private translateDelivery(ir: ExtendedLogicalIR): PlanStep[] {
    return ir.delivery.map(d => {
      const details: string[] = []

      if (d.method === 'email') {
        if (d.config.recipient) {
          details.push(`To: ${Array.isArray(d.config.recipient) ? d.config.recipient.join(', ') : d.config.recipient}`)
        } else if (d.config.recipient_source) {
          details.push(`To: ${this.cleanVariableReference(d.config.recipient_source)}`)
        }
        if (d.config.cc && d.config.cc.length > 0) {
          details.push(`CC: ${d.config.cc.join(', ')}`)
        }
        if (d.config.subject) {
          details.push(`Subject: ${d.config.subject}`)
        }
      } else if (d.method === 'slack') {
        details.push(`Channel: ${d.config.channel}`)
        if (d.config.message) {
          details.push(`Message: ${d.config.message}`)
        }
      } else if (d.method === 'webhook') {
        details.push(`URL: ${d.config.url}${d.config.endpoint || ''}`)
        details.push(`Method: ${d.config.method || 'POST'}`)
      } else if (d.method === 'database') {
        details.push(`Table: ${d.config.table}`)
        details.push(`Operation: ${d.config.operation || 'insert'}`)
      } else if (d.method === 'file') {
        details.push(`Path: ${d.config.path}`)
        details.push(`Format: ${d.config.format || 'json'}`)
      }

      return {
        icon: this.getDeliveryIcon(d.method),
        title: this.friendlyDeliveryMethod(d.method),
        details,
        type: 'delivery'
      }
    })
  }

  /**
   * Translate edge case
   */
  private translateEdgeCase(edgeCase: any): string {
    const condition = this.friendlyEdgeCaseCondition(edgeCase.condition)
    const action = this.friendlyEdgeCaseAction(edgeCase.action)

    if (edgeCase.message) {
      return `${condition} → ${action}: "${edgeCase.message}"${edgeCase.recipient ? ` (to ${edgeCase.recipient})` : ''}`
    }

    return `${condition} → ${action}`
  }

  /**
   * Estimate workflow metrics
   */
  private estimateWorkflow(ir: ExtendedLogicalIR): any {
    const estimation: any = {}

    // Count emails
    const emailCount = ir.delivery.filter(d => d.method === 'email').length
    if (emailCount > 0) {
      if (ir.partitions || ir.grouping?.emit_per_group) {
        estimation.emails = '~varies per group'
      } else {
        estimation.emails = `~${emailCount}`
      }
    }

    // Count Slack messages
    const slackCount = ir.delivery.filter(d => d.method === 'slack').length
    if (slackCount > 0) {
      estimation.slackMessages = `~${slackCount}`
    }

    // Estimate time
    let timeEstimate = 5 // Base time in seconds
    timeEstimate += (ir.filters?.length || 0) * 1
    timeEstimate += (ir.transforms?.length || 0) * 2
    timeEstimate += (ir.ai_operations?.length || 0) * 3 // AI is slower
    timeEstimate += ir.delivery.length * 2

    estimation.time = `~${timeEstimate}s`

    // Estimate cost
    const aiOpCount = ir.ai_operations?.length || 0
    if (aiOpCount > 0) {
      const costPerOp = 0.01 // Rough estimate
      estimation.cost = `~$${(aiOpCount * costPerOp).toFixed(2)}`
    } else {
      estimation.cost = '$0.00'
    }

    return estimation
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private friendlySourceName(source: string): string {
    const names: Record<string, string> = {
      google_sheets: 'Google Sheets',
      airtable: 'Airtable',
      microsoft_excel: 'Microsoft Excel',
      notion: 'Notion'
    }
    return names[source] || source
  }

  private friendlyDataSourceType(type: string): string {
    const types: Record<string, string> = {
      tabular: 'spreadsheet',
      api: 'API data',
      webhook: 'webhook event',
      database: 'database',
      file: 'file',
      stream: 'data stream'
    }
    return types[type] || type
  }

  private getDataSourceIcon(type: string): string {
    const icons: Record<string, string> = {
      tabular: '📊',
      api: '🌐',
      webhook: '🔔',
      database: '🗄️',
      file: '📄',
      stream: '📡'
    }
    return icons[type] || '📊'
  }

  private friendlyOperator(operator: string): string {
    const operators: Record<string, string> = {
      equals: 'equals',
      not_equals: 'does not equal',
      contains: 'contains',
      not_contains: 'does not contain',
      greater_than: 'is greater than',
      less_than: 'is less than',
      greater_than_or_equal: 'is at least',
      less_than_or_equal: 'is at most',
      in: 'is one of',
      not_in: 'is not one of'
    }
    return operators[operator] || operator
  }

  private friendlyValue(value: any): string {
    if (Array.isArray(value)) {
      return value.join(', ')
    }
    if (typeof value === 'string') {
      return `"${value}"`
    }
    return String(value)
  }

  private friendlyTransformOperation(operation: string): string {
    const operations: Record<string, string> = {
      sort: 'Sort data',
      group: 'Group data',
      aggregate: 'Calculate summary',
      map: 'Transform each row',
      reduce: 'Calculate total',
      join: 'Combine with other data',
      deduplicate: 'Remove duplicates',
      flatten: 'Flatten nested data',
      filter: 'Filter data'
    }
    return operations[operation] || operation
  }

  private friendlyAIOperation(type: string): string {
    const operations: Record<string, string> = {
      summarize: 'Summarize content',
      extract: 'Extract information',
      classify: 'Classify content',
      sentiment: 'Analyze sentiment',
      generate: 'Generate content',
      decide: 'Make decision'
    }
    return operations[type] || type
  }

  private friendlyDeliveryMethod(method: string): string {
    const methods: Record<string, string> = {
      email: 'Send email',
      slack: 'Send Slack message',
      webhook: 'Send webhook',
      database: 'Save to database',
      api_call: 'Call API',
      file: 'Save to file',
      sms: 'Send SMS'
    }
    return methods[method] || method
  }

  private getDeliveryIcon(method: string): string {
    const icons: Record<string, string> = {
      email: '📧',
      slack: '💬',
      webhook: '🔗',
      database: '💾',
      api_call: '🌐',
      file: '📁',
      sms: '📱'
    }
    return icons[method] || '📤'
  }

  private friendlyEdgeCaseCondition(condition: string): string {
    const conditions: Record<string, string> = {
      no_rows_after_filter: 'If no data found',
      empty_data_source: 'If data source is empty',
      missing_required_field: 'If required field is missing',
      duplicate_records: 'If duplicates found',
      rate_limit_exceeded: 'If rate limit hit',
      api_error: 'If API fails'
    }
    return conditions[condition] || condition
  }

  private friendlyEdgeCaseAction(action: string): string {
    const actions: Record<string, string> = {
      send_empty_result_message: 'Send notification',
      skip_execution: 'Skip workflow',
      use_default_value: 'Use default',
      retry: 'Retry',
      alert_admin: 'Alert admin'
    }
    return actions[action] || action
  }

  private cleanVariableReference(ref: string): string {
    // Remove {{}} syntax for user-friendly display
    return ref.replace(/\{\{|\}\}/g, '')
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create translator
 */
export function createTranslator(): IRToNaturalLanguageTranslator {
  return new IRToNaturalLanguageTranslator()
}

/**
 * Quick translate function
 */
export function translateIRToNaturalLanguage(ir: ExtendedLogicalIR): NaturalLanguagePlan {
  const translator = new IRToNaturalLanguageTranslator()
  return translator.translate(ir)
}
