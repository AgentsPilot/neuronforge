/**
 * Declarative Logical IR v4.0: Execution Graph Architecture
 *
 * This is the next-generation IR format that replaces the flat v3.0 structure
 * with an explicit execution graph. The graph represents workflow execution
 * as nodes (operations) connected by edges (control flow).
 *
 * Key Improvements over v3.0:
 * - Explicit sequencing via `next` field (no more inference)
 * - Selective conditionals (some operations always, some conditional)
 * - Data flow tracking (explicit inputs/outputs per node)
 * - Composability (loops, conditionals, parallel execution)
 * - Visualization-friendly (can render as Mermaid/DOT diagrams)
 *
 * Inspired by: AWS Step Functions, Apache Airflow, BPMN, LLVM IR
 */

import type { HardRequirements } from '../../requirements/HardRequirementsExtractor'

// ============================================================================
// Requirements Enforcement Tracking
// ============================================================================

/**
 * Requirement Enforcement Tracking
 *
 * Tracks which execution graph nodes enforce which hard requirements.
 * Enables validation that all requirements are properly enforced.
 *
 * @example
 * {
 *   requirement_id: "R1",
 *   enforced_by: {
 *     node_ids: ["check_amount"],
 *     enforcement_mechanism: "choice"
 *   },
 *   validation_passed: true
 * }
 */
export interface RequirementEnforcement {
  /** Requirement ID from Phase 0 (e.g., "R1", "R2") */
  requirement_id: string

  /** Which nodes enforce this requirement */
  enforced_by: {
    /** Node IDs that enforce this requirement */
    node_ids: string[]

    /** How the requirement is enforced */
    enforcement_mechanism: 'choice' | 'sequence' | 'input_binding' | 'output_capture'
  }

  /** Whether validation passed for this requirement */
  validation_passed: boolean

  /** Validation details (if validation failed) */
  validation_details?: string
}

// ============================================================================
// Variable and Data Flow Types
// ============================================================================

/**
 * Variable Definition
 *
 * Declares a variable that can be used across the execution graph.
 * Variables track data flow and dependencies between nodes.
 *
 * @example
 * {
 *   name: "emails",
 *   type: "array",
 *   scope: "global",
 *   description: "List of email messages fetched from Gmail"
 * }
 */
export interface VariableDefinition {
  /** Unique variable name (must be valid identifier) */
  name: string

  /** Data type of the variable */
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'any'

  /** Variable scope - determines visibility and lifetime */
  scope: 'global' | 'loop' | 'branch'

  /** Optional human-readable description */
  description?: string

  /** Optional default value */
  default_value?: any
}

/**
 * Input Binding
 *
 * Declares that a node reads from a variable.
 * Used for dependency tracking and validation.
 *
 * @example
 * {
 *   variable: "invoice_data",
 *   path: "amount",
 *   required: true
 * }
 */
export interface InputBinding {
  /** Variable name to read from */
  variable: string

  /** Optional JSONPath to extract specific field (e.g., "amount", "attachments[0]") */
  path?: string

  /** Whether this input is required for execution */
  required?: boolean

  /** Optional transformation to apply before use */
  transform?: 'to_string' | 'to_number' | 'to_array' | 'json_parse'
}

/**
 * Output Binding
 *
 * Declares that a node writes to a variable.
 * Used for dependency tracking and data flow visualization.
 *
 * @example
 * {
 *   variable: "uploaded_file",
 *   path: "id"
 * }
 */
export interface OutputBinding {
  /** Variable name to write to */
  variable: string

  /** Optional JSONPath to write to specific field */
  path?: string

  /** Optional transformation to apply before storing */
  transform?: 'to_string' | 'to_number' | 'to_array' | 'json_stringify'
}

/**
 * Simple Condition
 *
 * A single comparison expression for conditional branching.
 *
 * @example
 * {
 *   type: "simple",
 *   variable: "invoice_data.amount",
 *   operator: "gt",
 *   value: 50
 * }
 */
export interface SimpleCondition {
  type: 'simple'

  /** Variable name (can include JSONPath like "invoice_data.amount") */
  variable: string

  /** Comparison operator */
  operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'starts_with' | 'ends_with' | 'matches' | 'exists' | 'is_empty'

  /** Value to compare against (can be literal or variable reference with {{var}}) */
  value?: any
}

/**
 * Complex Condition
 *
 * Combines multiple conditions with logical operators (AND/OR/NOT).
 *
 * @example
 * {
 *   type: "complex",
 *   operator: "and",
 *   conditions: [
 *     { type: "simple", variable: "amount", operator: "gt", value: 50 },
 *     { type: "simple", variable: "vendor", operator: "eq", value: "Acme Corp" }
 *   ]
 * }
 */
export interface ComplexCondition {
  type: 'complex'

  /** Logical operator to combine conditions */
  operator: 'and' | 'or' | 'not'

  /** Sub-conditions (can be simple or complex) */
  conditions: ConditionExpression[]
}

/**
 * Condition Expression
 *
 * Union type for all condition types.
 */
export type ConditionExpression = SimpleCondition | ComplexCondition

/**
 * Choice Rule
 *
 * Defines a conditional branch in a choice node.
 * Rules are evaluated in order; first match wins.
 *
 * @example
 * {
 *   condition: {
 *     type: "simple",
 *     variable: "invoice_data.amount",
 *     operator: "gt",
 *     value: 50
 *   },
 *   next: "append_sheets"
 * }
 */
export interface ChoiceRule {
  /** Condition to evaluate */
  condition: ConditionExpression

  /** Node ID to jump to if condition is true */
  next: string

  /** Optional description for debugging */
  description?: string
}

/**
 * Fetch Configuration
 *
 * Configuration for data fetching operations (API calls, database queries, etc.)
 */
export interface FetchConfig {
  /** Plugin key (e.g., "google-mail", "google-drive") */
  plugin_key: string

  /** Action name within the plugin (e.g., "search_messages", "list_files") */
  action: string

  /** Action-specific configuration (can contain {{variable}} references) */
  config?: Record<string, any>

  /** Optional pagination settings */
  pagination?: {
    enabled: boolean
    page_size?: number
    max_pages?: number
  }
}

/**
 * Transform Configuration
 *
 * Configuration for data transformation operations (map, filter, reduce, etc.)
 */
export interface TransformConfig {
  /** Transform type */
  type: 'map' | 'filter' | 'reduce' | 'group_by' | 'sort' | 'deduplicate' | 'flatten' | 'merge' | 'custom'

  /** Primary input variable to transform */
  input: string

  /** Additional input variables (for multi-input transforms like merge/custom) */
  additional_inputs?: string[]

  /** Transform-specific configuration */
  map_expression?: string
  filter_expression?: ConditionExpression
  reduce_operation?: 'sum' | 'count' | 'avg' | 'min' | 'max' | 'concat'
  reduce_field?: string  // Field to reduce over (e.g., 'amount' for sum)
  group_by_field?: string
  sort_field?: string
  sort_order?: 'asc' | 'desc'
  custom_code?: string
}

/**
 * AI Operation Configuration
 *
 * Configuration for AI-powered operations (extraction, generation, classification, etc.)
 */
export interface AIConfig {
  /** AI operation type */
  type: 'deterministic_extract' | 'llm_extract' | 'generate' | 'classify' | 'summarize' | 'custom'

  /** Instruction for the AI operation */
  instruction: string

  /** Input variable (e.g., "current_email.attachments[0]") */
  input?: string

  /** Output schema (for extraction operations) */
  output_schema?: {
    fields: Array<{
      name: string
      type: 'string' | 'number' | 'boolean' | 'object' | 'array'
      description?: string
      required?: boolean
    }>
  }

  /** Model configuration */
  model?: string
  temperature?: number

  /** Classification labels (for classify type) */
  labels?: string[]
}

/**
 * Delivery Configuration
 *
 * Configuration for delivery operations (email, sheets, drive, webhook, etc.)
 */
export interface DeliveryConfig {
  /** Plugin key (e.g., "google-mail", "google-sheets", "google-drive") */
  plugin_key: string

  /** Action name within the plugin (e.g., "send_message", "append_rows", "upload_file") */
  action: string

  /** Action-specific configuration (can contain {{variable}} references) */
  config?: Record<string, any>

  /**
   * Field mappings from IntentContract deliver.mapping
   * Maps semantic field names to values for schema-driven parameter mapping
   * Example: [{ from: "important", value: true }, { from: "add_label", value: "{{config.label_name}}" }]
   */
  mapping?: Array<{
    /** Semantic field name (e.g., "important", "add_label", "recipient") */
    field: string
    /** Value to set (can be literal or {{variable}} reference) */
    value: any
  }>
}

/**
 * File Operation Configuration
 *
 * Configuration for file operations (upload, download, generate, etc.)
 */
export interface FileOperationConfig {
  /** File operation type */
  type: 'upload' | 'download' | 'generate' | 'convert' | 'extract_text' | 'extract_metadata'

  /** Plugin key (e.g., "google-drive", "dropbox") */
  plugin_key?: string

  /** Action name within the plugin */
  action?: string

  /** Operation-specific configuration */
  config?: Record<string, any>
}

/**
 * Operation Configuration
 *
 * Configuration for operation nodes.
 * Uses discriminated union based on operation_type.
 */
export interface OperationConfig {
  /** Operation type determines which config field is used */
  operation_type: 'fetch' | 'transform' | 'ai' | 'deliver' | 'file_op'

  /** Fetch operation config (only if operation_type === 'fetch') */
  fetch?: FetchConfig

  /** Transform operation config (only if operation_type === 'transform') */
  transform?: TransformConfig

  /** AI operation config (only if operation_type === 'ai') */
  ai?: AIConfig

  /** Delivery operation config (only if operation_type === 'deliver') */
  deliver?: DeliveryConfig

  /** File operation config (only if operation_type === 'file_op') */
  file_op?: FileOperationConfig

  /** Optional description for debugging */
  description?: string
}

/**
 * Choice Configuration
 *
 * Configuration for choice (conditional branching) nodes.
 * Rules are evaluated in order; first match wins.
 * Default path is required (must handle all cases).
 *
 * @example
 * {
 *   rules: [
 *     {
 *       condition: { type: "simple", variable: "amount", operator: "gt", value: 50 },
 *       next: "append_sheets"
 *     }
 *   ],
 *   default: "loop_end"
 * }
 */
export interface ChoiceConfig {
  /** Ordered list of conditional rules */
  rules: ChoiceRule[]

  /** Default node ID if no rules match (REQUIRED) */
  default: string

  /** Optional description for debugging */
  description?: string
}

/**
 * Loop Configuration
 *
 * Configuration for loop (iteration) nodes.
 * Creates a scatter-gather pattern in the compiled workflow.
 *
 * @example
 * {
 *   iterate_over: "emails",
 *   item_variable: "current_email",
 *   body_start: "extract_invoice",
 *   collect_outputs: true,
 *   output_variable: "processed_items",
 *   concurrency: 5
 * }
 */
export interface LoopConfig {
  /** Variable containing array to iterate over */
  iterate_over: string

  /** Variable name for current loop item */
  item_variable: string

  /** Node ID where loop body starts */
  body_start: string

  /** Whether to collect outputs from each iteration */
  collect_outputs?: boolean

  /** Variable to store collected outputs (required if collect_outputs === true) */
  output_variable?: string

  /** Optional concurrency limit (default: sequential) */
  concurrency?: number

  /** Optional early exit condition */
  exit_condition?: ConditionExpression

  /** Optional description for debugging */
  description?: string
}

/**
 * Parallel Branch
 *
 * Defines a branch in parallel execution.
 * Each branch starts at a different node and executes independently.
 */
export interface ParallelBranch {
  /** Unique branch ID */
  id: string

  /** Node ID where this branch starts */
  start: string

  /** Optional description for debugging */
  description?: string
}

/**
 * Parallel Configuration
 *
 * Configuration for parallel execution nodes.
 * All branches start simultaneously and synchronize at the end.
 *
 * @example
 * {
 *   branches: [
 *     { id: "drive_ops", start: "create_folder" },
 *     { id: "sheets_check", start: "check_amount" }
 *   ],
 *   wait_strategy: "all",
 *   timeout_ms: 30000
 * }
 */
export interface ParallelConfig {
  /** Branches to execute in parallel */
  branches: ParallelBranch[]

  /** Wait strategy for synchronization */
  wait_strategy: 'all' | 'any' | 'n'

  /** Required if wait_strategy === 'n' */
  wait_count?: number

  /** Optional timeout in milliseconds */
  timeout_ms?: number

  /** Optional description for debugging */
  description?: string
}

/**
 * Execution Node
 *
 * Represents a single node in the execution graph.
 * Uses discriminated union based on node type.
 *
 * @example Operation Node
 * {
 *   id: "fetch_emails",
 *   type: "operation",
 *   operation: {
 *     operation_type: "fetch",
 *     fetch: { plugin_key: "google-mail", action: "search_messages", config: {...} }
 *   },
 *   outputs: [{ variable: "emails" }],
 *   next: "loop_emails"
 * }
 *
 * @example Choice Node
 * {
 *   id: "check_amount",
 *   type: "choice",
 *   choice: {
 *     rules: [{ condition: {...}, next: "append_sheets" }],
 *     default: "loop_end"
 *   },
 *   inputs: [{ variable: "invoice_data.amount" }]
 * }
 *
 * @example Loop Node
 * {
 *   id: "loop_emails",
 *   type: "loop",
 *   loop: {
 *     iterate_over: "emails",
 *     item_variable: "current_email",
 *     body_start: "extract_invoice",
 *     collect_outputs: true,
 *     output_variable: "processed_items"
 *   },
 *   inputs: [{ variable: "emails" }],
 *   outputs: [{ variable: "processed_items" }],
 *   next: "send_digest"
 * }
 */
export interface ExecutionNode {
  /** Unique node ID (must be valid identifier) */
  id: string

  /** Node type determines which config field is used */
  type: 'operation' | 'choice' | 'parallel' | 'loop' | 'end'

  /** Operation config (only if type === 'operation') */
  operation?: OperationConfig

  /** Choice config (only if type === 'choice') */
  choice?: ChoiceConfig

  /** Parallel config (only if type === 'parallel') */
  parallel?: ParallelConfig

  /** Loop config (only if type === 'loop') */
  loop?: LoopConfig

  /** Next node ID(s) - single string for most nodes, array for parallel */
  next?: string | string[]

  /** Variables this node reads from */
  inputs?: InputBinding[]

  /** Variables this node writes to */
  outputs?: OutputBinding[]

  /** Optional error handling configuration */
  error_handler?: {
    strategy: 'fail' | 'continue' | 'retry' | 'fallback'
    retry_config?: {
      max_attempts: number
      backoff: 'linear' | 'exponential' | 'fixed'
      initial_delay_ms: number
    }
    fallback_node?: string
    log_errors?: boolean
    notify?: string
  }

  /** Optional description for debugging */
  description?: string
}

/**
 * Execution Graph
 *
 * The core data structure representing workflow execution.
 * All nodes are stored flat (not nested) for easier processing.
 * Control flow is explicit via `next` fields.
 *
 * @example
 * {
 *   start: "fetch_emails",
 *   nodes: {
 *     "fetch_emails": { id: "fetch_emails", type: "operation", ... },
 *     "loop_emails": { id: "loop_emails", type: "loop", ... },
 *     "extract_invoice": { id: "extract_invoice", type: "operation", ... },
 *     ...
 *   },
 *   variables: [
 *     { name: "emails", type: "array", scope: "global" },
 *     { name: "current_email", type: "object", scope: "loop" },
 *     ...
 *   ]
 * }
 */
export interface ExecutionGraph {
  /** Entry point node ID (where execution begins) */
  start: string

  /** All nodes in the graph (flat structure, keyed by node ID) */
  nodes: Record<string, ExecutionNode>

  /** Global and loop-scoped variable declarations */
  variables?: VariableDefinition[]

  /** Optional metadata */
  metadata?: {
    estimated_complexity?: 'low' | 'medium' | 'high'
    estimated_duration_ms?: number
    tags?: string[]
  }
}

/**
 * Declarative Logical IR v4.0
 *
 * Top-level IR structure supporting both v3.0 (flat) and v4.0 (graph) formats.
 * When ir_version === '4.0', execution_graph is used.
 * When ir_version === '3.0', legacy fields are used.
 *
 * @example v4.0 IR
 * {
 *   ir_version: "4.0",
 *   goal: "Process invoices with conditional Sheets append",
 *   execution_graph: {
 *     start: "fetch_emails",
 *     nodes: { ... },
 *     variables: [ ... ]
 *   }
 * }
 */
export interface DeclarativeLogicalIRv4 {
  /** IR version - determines which fields are used */
  ir_version: '3.0' | '4.0'

  /** High-level goal of the workflow */
  goal: string

  /** V4.0: Execution graph (only if ir_version === '4.0') */
  execution_graph?: ExecutionGraph

  /** Optional context from previous phases */
  context?: {
    enhanced_prompt?: any
    semantic_plan?: any
    grounding_results?: any[]
    /** Hard requirements embedded from Phase 0 */
    hard_requirements?: HardRequirements
  }

  /**
   * Requirements enforcement tracking
   * Shows which execution graph nodes enforce which requirements
   */
  requirements_enforcement?: RequirementEnforcement[]

  /** Optional metadata */
  metadata?: {
    generated_at?: string
    generated_by?: string
    version?: string
  }
}

/**
 * Export type alias for convenience
 */
export type DeclarativeLogicalIR = DeclarativeLogicalIRv4
