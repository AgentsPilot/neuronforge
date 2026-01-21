/**
 * Extended Logical IR Type Definitions
 *
 * These types represent the Logical Intermediate Representation (IR) used in V6 architecture.
 * The IR captures user intent WITHOUT execution details (no plugin names, step IDs, etc.)
 */

// ============================================================================
// Main IR Structure
// ============================================================================

export interface ExtendedLogicalIR {
  ir_version: string                    // "2.0"
  goal: string                          // Human-readable workflow goal

  // Data Layer
  data_sources: DataSource[]
  normalization: Normalization

  // Processing Layer
  filters: Filter[]
  transforms: Transform[]
  ai_operations: AIOperation[]

  // Control Flow
  conditionals: Conditional[]
  loops: Loop[]
  partitions: Partition[]
  grouping: Grouping

  // Output Layer
  rendering: Rendering
  delivery: Delivery[]

  // Error Handling
  edge_cases: EdgeCase[]
  clarifications_required: string[]
}

// ============================================================================
// Data Sources
// ============================================================================

export type DataSourceType =
  | 'tabular'      // Spreadsheets, databases
  | 'api'          // REST APIs
  | 'webhook'      // Event triggers
  | 'database'     // Direct DB queries
  | 'file'         // Files (CSV, JSON, PDF)
  | 'stream'       // Real-time data

export interface DataSource {
  id: string
  type: DataSourceType
  source: string                    // Source name hint (e.g., "google_sheets", "google_mail")
  location: string                  // Business identifier
  tab?: string                      // For tabular data
  endpoint?: string                 // For APIs
  trigger?: string                  // For webhooks
  role?: string                     // Business description

  // Schema-driven plugin resolution (from IR)
  plugin_key?: string               // Actual plugin name (e.g., "google-sheets", "google-mail")
  operation_type?: string           // Actual operation name (e.g., "read_range", "search_emails")
  config?: Record<string, any>      // Plugin-specific configuration
}

export interface Normalization {
  required_headers: string[]
  case_sensitive: boolean
  missing_header_action: 'error' | 'warn' | 'ignore'
  // LLM sometimes outputs grounded_facts here - coerced from object to array if needed
  grounded_facts?: string[] | null
}

// ============================================================================
// Filters and Transforms
// ============================================================================

export type FilterOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'greater_than'
  | 'less_than'
  | 'greater_than_or_equal'
  | 'less_than_or_equal'
  | 'in'
  | 'not_in'
  | 'is_empty'
  | 'is_not_empty'

export interface Filter {
  id: string
  field: string
  operator: FilterOperator
  value: any  // Can be any type
  description: string
}

export type TransformOperation =
  | 'map'          // Transform each item
  | 'filter'       // Subset based on condition
  | 'reduce'       // Aggregate into single value
  | 'sort'         // Order data
  | 'group'        // Group by field
  | 'aggregate'    // sum, count, average
  | 'join'         // Merge datasets
  | 'deduplicate'  // Remove duplicates
  | 'flatten'      // Flatten nested arrays

export type AggregationType = 'sum' | 'count' | 'average' | 'min' | 'max'

export interface TransformConfig {
  source: string               // Input data reference
  field: string                // Field to operate on
  group_by: string             // For grouping
  sort_by: string              // For sorting
  order: 'asc' | 'desc'
  aggregation: AggregationType
  join_key: string
  condition?: Condition         // For filter operation (kept optional for backward compat)
  mapping: string              // For map operation
}

export interface Transform {
  id: string
  operation: TransformOperation
  config: TransformConfig
}

// ============================================================================
// AI Operations
// ============================================================================

export type AIOperationType =
  | 'summarize'      // Text summarization
  | 'extract'        // Extract structured data
  | 'classify'       // Categorize into classes
  | 'sentiment'      // Sentiment analysis
  | 'generate'       // Generate text
  | 'decide'         // Make a decision
  | 'normalize'      // Normalize/standardize data
  | 'transform'      // Transform data structure
  | 'validate'       // Validate data against rules
  | 'enrich'         // Enrich data with additional info

export interface OutputSchema {
  type: 'string' | 'object' | 'array' | 'number' | 'boolean'
  fields: OutputField[]
  enum: string[]               // For classification
}

export interface OutputField {
  name: string
  type: string
  required: boolean
  description: string
}

export interface AIConstraints {
  max_tokens: number
  temperature: number          // 0-1, lower = more deterministic
  model_preference: 'fast' | 'accurate' | 'balanced'
}

export interface AIOperation {
  id: string
  type: AIOperationType
  instruction: string           // What to do (business language)
  input_source: string          // {{variable}} reference
  output_schema: OutputSchema   // Expected output structure
  constraints: AIConstraints
}

// ============================================================================
// Control Flow
// ============================================================================

export type ConditionType = 'simple' | 'complex_and' | 'complex_or' | 'complex_not'

export interface Condition {
  type: ConditionType
  field?: string                // For simple conditions
  operator?: FilterOperator
  value?: any
  conditions?: Condition[]      // For complex conditions
}

export type IntentAction =
  | { type: 'filter'; config: Filter }
  | { type: 'transform'; config: Transform }
  | { type: 'ai_operation'; config: AIOperation }
  | { type: 'delivery'; config: Delivery }

export interface Conditional {
  id: string
  when: Condition
  then: string[]                // Natural language descriptions of actions
  else: string[]                // Natural language descriptions of actions
}

export interface Loop {
  id: string
  for_each: string              // Source to iterate ({{variable}})
  item_variable: string         // Name for current item
  do: string[]                  // Natural language descriptions of actions for each iteration
  max_iterations: number       // Safety limit
  max_concurrency: number      // Parallel processing limit
}

export interface Partition {
  id: string
  field: string
  split_by: 'value' | 'condition'
  condition?: Condition
  handle_empty: {
    partition_name: string
    description: string
  }
}

export interface Grouping {
  input_partition: string       // Which partition to group
  group_by: string              // Field to group by
  emit_per_group: boolean       // Create separate output per group
}

// ============================================================================
// Rendering and Delivery
// ============================================================================

export type RenderingType =
  | 'html_table'
  | 'email_embedded_table'
  | 'json'
  | 'csv'
  | 'template'
  | 'summary_block'
  | 'alert'
  | 'none'

export interface Rendering {
  type: RenderingType
  template: string             // For template-based rendering
  engine: 'jinja' | 'handlebars' | 'mustache'
  columns_in_order: string[]   // For table rendering
  empty_message: string
}

export type DeliveryMethod =
  | 'email'
  | 'slack'
  | 'webhook'
  | 'database'
  | 'api_call'
  | 'file'
  | 'sms'

export interface DeliveryConfig {
  // Email
  recipient: string | string[]
  recipient_source: string     // Field containing recipient
  cc: string[]
  bcc: string[]
  subject: string
  body: string

  // Slack
  channel: string
  message: string

  // Webhook/API
  url: string
  endpoint: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  headers: string              // JSON string of headers object
  payload: string              // JSON string of payload object

  // Database
  table: string
  operation: 'insert' | 'update' | 'delete'

  // File
  path: string
  format: 'json' | 'csv' | 'txt'
}

export interface Delivery {
  id: string
  method: DeliveryMethod
  config: DeliveryConfig
}

// ============================================================================
// Edge Cases
// ============================================================================

export type EdgeCaseCondition =
  | 'no_rows_after_filter'
  | 'empty_data_source'
  | 'missing_required_field'
  | 'duplicate_records'
  | 'rate_limit_exceeded'
  | 'api_error'

export type EdgeCaseAction =
  | 'send_empty_result_message'
  | 'skip_execution'
  | 'use_default_value'
  | 'retry'
  | 'alert_admin'

export interface EdgeCase {
  condition: EdgeCaseCondition
  action: EdgeCaseAction
  message: string
  recipient: string
}

// ============================================================================
// Validation Result Types
// ============================================================================

export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings?: string[]
}

export interface IRValidationResult extends ValidationResult {
  normalizedIR?: ExtendedLogicalIR  // IR with fixes applied
}
