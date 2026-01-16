/**
 * Declarative Logical IR Type Definitions (V6 Pure)
 *
 * These types represent PURELY DECLARATIVE business intent.
 * NO execution details, NO operation IDs, NO loops.
 */

// ============================================================================
// Core IR Structure
// ============================================================================

export interface DeclarativeLogicalIR {
  ir_version: '2.0' | '3.0'  // Accept both for backward compatibility
  goal: string

  // Runtime inputs - values user provides at execution time
  runtime_inputs?: RuntimeInput[]

  // Data layer
  data_sources: DataSource[]
  normalization?: Normalization

  // Processing layer
  filters?: FilterGroup
  ai_operations?: AIOperation[]
  post_ai_filters?: FilterGroup  // Filters on AI output fields - derived from semantic context
  conditionals?: Conditional[] // NEW: Conditional branching

  // Organization layer
  partitions?: Partition[]
  grouping?: Grouping

  // Output layer
  rendering?: Rendering
  delivery_rules: DeliveryRules
  file_operations?: FileOperation[] // NEW: File generation/upload

  // Execution constraints
  execution_constraints?: ExecutionConstraints // NEW: Retry, timeout, rate limiting

  // Error handling
  edge_cases?: EdgeCase[]
  clarifications_required?: string[]
}

// ============================================================================
// Runtime Inputs
// ============================================================================

export interface RuntimeInput {
  name: string           // Variable name (e.g., "topic", "search_query")
  type: 'text' | 'number' | 'email' | 'date' | 'select'
  label: string          // Human-readable label
  description: string    // Description of what this input is for
  required: boolean      // Whether this input is required
  placeholder?: string   // Placeholder text
  options?: string[]     // Options for select type
  default_value?: string // Default value if not provided
}

// ============================================================================
// Data Sources
// ============================================================================

export interface DataSource {
  type: 'tabular' | 'api' | 'webhook' | 'database' | 'file' | 'stream'
  source: string // e.g., "google_sheets", "gmail", "airtable" (for backward compatibility)

  // Plugin-agnostic fields
  plugin_key?: string // e.g., "google-mail", "outlook-mail", "google-sheets"
  operation_type?: 'read' | 'search' | 'list' | 'fetch' // What kind of operation

  location: string // e.g., sheet name, API endpoint
  tab?: string // For tabular: specific tab
  endpoint?: string // For API: endpoint path
  trigger?: string // For webhooks: event type
  role?: string // Human-readable description

  // Plugin-specific configuration parameters
  // This allows storing plugin action parameters (e.g., Gmail query, max_results, etc.)
  // at IR level instead of only at compilation time
  config?: Record<string, any>
}

export interface Normalization {
  required_headers?: string[]
  case_sensitive?: boolean
  missing_header_action?: 'error' | 'warn' | 'ignore'
}

// ============================================================================
// Processing Operations
// ============================================================================

export interface FilterCondition {
  field: string
  operator:
    | 'equals'
    | 'not_equals'
    | 'contains'
    | 'not_contains'          // ADDED: Schema sync
    | 'starts_with'           // ADDED: Schema sync
    | 'ends_with'             // ADDED: Schema sync
    | 'matches_regex'         // ADDED: Schema sync
    | 'greater_than'
    | 'less_than'
    | 'greater_than_or_equals'  // ADDED: Schema sync
    | 'less_than_or_equals'     // ADDED: Schema sync
    | 'in'
    | 'not_in'                // ADDED: Schema sync
    | 'is_empty'
    | 'is_not_empty'
    | 'within_last_days'
    | 'before'
    | 'after'
  value?: any
  description?: string
}

export interface FilterGroup {
  combineWith?: 'AND' | 'OR' // Default: AND
  conditions?: FilterCondition[]
  groups?: {
    combineWith: 'AND' | 'OR'
    conditions: FilterCondition[]
  }[]
}

export interface AIOperation {
  type: 'summarize' | 'extract' | 'classify' | 'sentiment' | 'generate' | 'decide' | 'normalize' | 'transform' | 'validate' | 'enrich' | 'deterministic_extract'
  instruction: string // Clear business instruction
  context?: string // What data this operates on (e.g., "PDF attachments")
  input_description?: string // Description of input data (from semantic plan)
  output_schema: OutputSchema
  constraints?: AIConstraints

  // Deterministic extraction specific fields (only used when type = 'deterministic_extract')
  document_type?: 'invoice' | 'receipt' | 'form' | 'contract' | 'auto'
  ocr_fallback?: boolean // Use AWS Textract if pdf-parse fails (default: true)
}

export interface OutputSchema {
  type: 'string' | 'object' | 'array' | 'number' | 'boolean'
  /** For object type: fields to extract */
  fields?: SchemaField[]
  /** For array type: schema of each item in the array */
  items?: {
    fields: SchemaField[]
  }
  /** For string type or overall extraction description */
  description?: string
  /** For classification: allowed values */
  enum?: string[]
}

export interface SchemaField {
  name: string
  type: string
  required: boolean
  description: string
  /** If true, this field requires AI inference rather than deterministic extraction */
  inference?: boolean
  /** Source for inference: 'raw_text' (uses document text) or 'extracted_fields' (uses other extracted values) */
  inferenceSource?: 'raw_text' | 'extracted_fields'
}

export interface AIConstraints {
  max_tokens?: number
  temperature?: number
  model_preference?: 'fast' | 'accurate' | 'balanced'
}

// ============================================================================
// Organization & Grouping
// ============================================================================

export interface Partition {
  field: string
  split_by: 'value' | 'condition'
  handle_empty?: {
    partition_name: string
    description?: string
  }
}

export interface Grouping {
  group_by: string
  emit_per_group?: boolean
}

// ============================================================================
// Output & Rendering
// ============================================================================

export interface Rendering {
  type: 'email_embedded_table' | 'html_table' | 'summary_block' | 'alert' | 'json' | 'csv'
  template?: string
  engine?: 'jinja' | 'handlebars' | 'mustache'
  columns_in_order?: string[]
  empty_message?: string
  summary_stats?: string[] // Summary statistics to calculate (e.g., ['total_amount', 'count', 'average_amount'])
  sort_order?: SortSpec[]  // Sorting specification - derived from semantic context
}

export interface SortSpec {
  field: string           // Field name to sort by (can be source field or AI output field)
  direction: 'asc' | 'desc'  // Sort direction
  priority?: number       // Sort priority (1 = primary sort, 2 = secondary, etc.)
}

// ============================================================================
// Delivery Rules (COMPILER INFERS LOOPS FROM THIS!)
// ============================================================================

export interface DeliveryRules {
  per_item_delivery?: PerItemDelivery
  per_group_delivery?: PerGroupDelivery
  summary_delivery?: SummaryDelivery
  multiple_destinations?: MultiDestinationDelivery[] // NEW: Send to multiple channels in parallel
  send_when_no_results?: boolean
}

export interface PerItemDelivery {
  recipient_source: string // Field containing recipient email
  cc?: string[]
  subject?: string
  body_template?: string

  // Plugin-agnostic delivery
  plugin_key?: string // e.g., "google-mail", "outlook-mail", "slack"
  operation_type?: 'send' | 'post' | 'publish' // Default: 'send'
}

export interface PerGroupDelivery {
  recipient_source: string // Field containing recipient for each group
  cc?: string[]
  subject?: string
  body_template?: string

  // Plugin-agnostic delivery
  plugin_key?: string // e.g., "google-mail", "outlook-mail", "slack"
  operation_type?: 'send' | 'post' | 'publish' // Default: 'send'
}

export interface SummaryDelivery {
  recipient?: string // Fixed recipient email (optional for non-email plugins)
  recipient_source?: string // Field containing recipient
  cc?: string[]
  subject?: string
  body_template?: string
  content?: string | { format?: string; body?: string } // Email body content
  include_missing_section?: boolean

  // Plugin-agnostic delivery
  plugin_key?: string // e.g., "google-mail", "outlook-mail", "slack", "google-sheets"
  operation_type?: 'send' | 'post' | 'publish' | 'append_rows' | string // Default: 'send'

  // Plugin-specific configuration (for non-email plugins like Google Sheets)
  config?: Record<string, any>
}

export interface MultiDestinationDelivery {
  name?: string // Optional name for this destination (e.g., "Email notification", "Slack alert")
  recipient: string // Fixed recipient email/channel
  cc?: string[]
  subject?: string
  body_template?: string
  include_missing_section?: boolean

  // Plugin-agnostic delivery
  plugin_key: string // REQUIRED: e.g., "google-mail", "outlook-mail", "slack", "google-sheets"
  operation_type: string // REQUIRED: e.g., 'send', 'post', 'append_rows', 'publish'

  // Plugin-specific configuration (for non-email plugins like Google Sheets)
  config?: Record<string, any>
}

// ============================================================================
// Edge Cases
// ============================================================================

export interface EdgeCase {
  condition: 'no_rows_after_filter' | 'empty_data_source' | 'missing_required_field' | 'duplicate_records' | 'rate_limit_exceeded' | 'api_error'
  action: 'send_empty_result_message' | 'skip_execution' | 'use_default_value' | 'retry' | 'alert_admin'
  message?: string
  recipient?: string
}

// ============================================================================
// Validation Types
// ============================================================================

export interface IRValidationResult {
  valid: boolean
  errors: IRValidationError[]
  warnings?: string[]
}

export interface IRValidationError {
  error_code: 'INVALID_SCHEMA' | 'FORBIDDEN_TOKEN' | 'MISSING_REQUIRED_FIELD' | 'INVALID_REFERENCE' | 'REDUNDANT_FILTER'
  message: string
  ir_path?: string
  leaked_token?: string
  suggestion?: string
}

// ============================================================================
// Conditional Branching (NEW - Phase 1)
// ============================================================================

export interface Conditional {
  id: string // Unique identifier for this conditional
  condition: ConditionalExpression
  then_actions: ConditionalAction[]
  else_actions?: ConditionalAction[]
  description?: string
}

export interface ConditionalExpression {
  type: 'simple' | 'complex'

  // Simple condition (single check)
  field?: string
  operator?: 'equals' | 'not_equals' | 'contains' | 'greater_than' | 'less_than' | 'is_empty' | 'is_not_empty' | 'in'
  value?: any

  // Complex condition (multiple checks)
  combineWith?: 'AND' | 'OR'
  conditions?: ConditionalExpression[]
}

export interface ConditionalAction {
  type: 'set_field' | 'skip_delivery' | 'use_template' | 'send_to_recipient' | 'abort' | 'continue'
  params?: Record<string, any>
  description?: string
}

// ============================================================================
// Execution Constraints (NEW - Phase 1)
// ============================================================================

export interface ExecutionConstraints {
  retry?: RetryConfig
  timeout?: TimeoutConfig
  rate_limiting?: RateLimitConfig
  concurrency?: ConcurrencyConfig
}

export interface RetryConfig {
  max_attempts: number // e.g., 3
  backoff_strategy: 'linear' | 'exponential' | 'fixed'
  initial_delay_ms: number // e.g., 1000 (1 second)
  max_delay_ms?: number // e.g., 30000 (30 seconds)
  retry_on_errors?: string[] // Which error types to retry (e.g., ['rate_limit', 'timeout'])
}

export interface TimeoutConfig {
  total_workflow_timeout_ms?: number // Max time for entire workflow
  step_timeout_ms?: number // Max time per step (API call, AI operation, etc.)
  data_fetch_timeout_ms?: number // Max time for data source reads
}

export interface RateLimitConfig {
  strategy: 'token_bucket' | 'sliding_window' | 'fixed_window'
  max_requests_per_window: number // e.g., 100
  window_duration_ms: number // e.g., 60000 (1 minute)
  burst_allowance?: number // Allow bursts up to this limit
}

export interface ConcurrencyConfig {
  max_concurrent_operations: number // e.g., 5 (max parallel API calls)
  max_concurrent_deliveries: number // e.g., 10 (max parallel emails)
  per_recipient_delay_ms?: number // Delay between deliveries to same recipient
}

// ============================================================================
// File Operations (NEW - Phase 1)
// ============================================================================

export interface FileOperation {
  id: string
  type: 'generate_csv' | 'generate_excel' | 'generate_pdf' | 'generate_json' | 'upload_file'
  source_data: string // Variable/field containing data to export
  output_config: FileOutputConfig
  upload_destination?: FileUploadDestination
  description?: string
}

export interface FileOutputConfig {
  filename: string // e.g., "leads_report_{date}.csv"
  format: 'csv' | 'xlsx' | 'pdf' | 'json' | 'txt'
  columns?: string[] // For CSV/Excel
  template?: string // For PDF (HTML template)
  encoding?: 'utf-8' | 'utf-16' | 'ascii'
  include_headers?: boolean
  date_format?: string // e.g., "YYYY-MM-DD"
}

export interface FileUploadDestination {
  plugin_key: string // e.g., "google-drive", "aws-s3", "dropbox"
  operation_type: 'upload' | 'create' | 'update'
  location: string // e.g., folder path, bucket name
  permissions?: FilePermissions
  overwrite?: boolean
}

export interface FilePermissions {
  visibility: 'private' | 'public' | 'shared'
  shared_with?: string[] // Email addresses or group IDs
  allow_comments?: boolean
  allow_downloads?: boolean
}

// ============================================================================
// Database Integration (NEW - Phase 1)
// ============================================================================

// Extend DataSource to support database operations
export interface DatabaseDataSource extends DataSource {
  type: 'database'
  database_config: DatabaseConfig
  query?: DatabaseQuery
  write_operation?: DatabaseWriteOperation
}

export interface DatabaseConfig {
  database_type: 'postgresql' | 'mysql' | 'sqlite' | 'mongodb' | 'mssql'
  connection_string?: string // For security, prefer env vars
  connection_params?: {
    host: string
    port: number
    database: string
    schema?: string
    ssl?: boolean
  }
  pool_config?: {
    max_connections: number
    idle_timeout_ms: number
  }
}

export interface DatabaseQuery {
  query_type: 'select' | 'insert' | 'update' | 'delete' | 'custom'
  table?: string
  columns?: string[]
  conditions?: FilterCondition[] // Reuse existing filter conditions
  order_by?: { field: string; direction: 'asc' | 'desc' }[]
  limit?: number
  offset?: number
  custom_sql?: string // For complex queries (use with caution)
}

export interface DatabaseWriteOperation {
  operation: 'insert' | 'update' | 'upsert' | 'delete'
  table: string
  data_source: string // Variable containing data to write
  key_fields?: string[] // For updates/upserts (primary key fields)
  batch_size?: number // For bulk operations
  on_conflict?: 'ignore' | 'update' | 'error'
  transaction?: boolean // Wrap in transaction
}

// ============================================================================
// Webhook Support (NEW - Phase 1)
// ============================================================================

// Extend DataSource to support webhook triggers
export interface WebhookDataSource extends DataSource {
  type: 'webhook'
  webhook_config: WebhookConfig
}

export interface WebhookConfig {
  endpoint: string // Webhook endpoint path (e.g., "/webhooks/stripe")
  method: 'POST' | 'GET' | 'PUT' | 'DELETE'
  authentication?: WebhookAuthentication
  payload_schema?: OutputSchema // Expected payload structure
  validation?: WebhookValidation
  transformation?: string // JSONPath or template to transform payload
}

export interface WebhookAuthentication {
  type: 'hmac' | 'bearer_token' | 'api_key' | 'basic' | 'none'
  secret_env_var?: string // Environment variable containing secret
  header_name?: string // For bearer token or API key
  verify_signature?: boolean
}

export interface WebhookValidation {
  required_fields?: string[]
  schema_validation?: boolean
  signature_verification?: {
    algorithm: 'sha256' | 'sha1' | 'md5'
    header_name: string
    secret_env_var: string
  }
  ip_whitelist?: string[]
}
