/**
 * PILOT DSL TypeScript Type Definitions
 *
 * These types match the PILOT_DSL_SCHEMA JSON schema defined in pilot-dsl-schema.ts
 * Used by the V6 compiler to generate type-safe PILOT_DSL workflows.
 */

// ============================================================================
// Workflow Step Types
// ============================================================================

export type StepType =
  | 'action'
  | 'transform'
  | 'conditional'
  | 'loop'
  | 'scatter'
  | 'scatter_gather'
  | 'trigger'
  | 'ai_processing'
  | 'decision'
  | 'sub_workflow'
  | 'parallel'
  | 'delay'
  | 'retry'
  | 'error_handler'
  | 'validation'
  | 'notification'
  | 'webhook'

export interface WorkflowStep {
  step_id: string
  type: StepType
  description?: string
  plugin?: string
  operation?: string
  config?: Record<string, any>
  input?: any
  output_variable?: string
  condition?: Condition
  loop?: LoopConfig
  scatter?: ScatterConfig
  gather?: GatherConfig  // For scatter_gather steps
  steps?: WorkflowStep[]
  on_error?: ErrorHandler
  retry?: RetryConfig
  [key: string]: any // Allow additional properties for flexibility
}

// ============================================================================
// Condition Types
// ============================================================================

export interface Condition {
  field?: string
  operator?: 'equals' | 'not_equals' | 'greater_than' | 'less_than' | 'contains' | 'not_contains' | 'is_empty' | 'is_not_empty'
  value?: any
  and?: Condition[]
  or?: Condition[]
  not?: Condition
}

// ============================================================================
// Loop Configuration
// ============================================================================

export interface LoopConfig {
  iterate_over: string
  item_variable: string
  index_variable?: string
  max_iterations?: number
  parallel?: boolean
}

// ============================================================================
// Scatter-Gather Configuration
// ============================================================================

/**
 * Scatter configuration - matches the executor's expected format
 */
export interface ScatterConfig {
  input: string | any[]  // Variable reference to array OR static array
  steps: WorkflowStep[]  // Steps to execute for each item
  itemVariable?: string  // Variable name for current item (default: "item")
  maxConcurrency?: number  // Limit parallel execution
}

/**
 * Gather configuration - how to aggregate results
 */
export interface GatherConfig {
  operation: 'collect' | 'merge' | 'reduce' | 'flatten'
  outputKey?: string
  reduceExpression?: string
}

// ============================================================================
// Error Handling
// ============================================================================

export interface ErrorHandler {
  action: 'continue' | 'stop' | 'retry' | 'fallback'
  fallback_step?: WorkflowStep
  log_error?: boolean
}

// ============================================================================
// Retry Configuration
// ============================================================================

export interface RetryConfig {
  max_attempts: number
  backoff_strategy?: 'fixed' | 'exponential'
  initial_delay_ms?: number
}

// ============================================================================
// Complete Workflow Definition
// ============================================================================

export interface PILOTWorkflow {
  agent_name: string
  description: string
  system_prompt?: string
  workflow_type: 'pure_ai' | 'data_retrieval_ai' | 'ai_external_actions'
  suggested_plugins: string[]
  required_inputs: RequiredInput[]
  workflow_steps: WorkflowStep[]
  suggested_outputs: SuggestedOutput[]
  reasoning?: string
}

export interface RequiredInput {
  name: string
  type: 'text' | 'email' | 'number' | 'file' | 'select' | 'url' | 'date' | 'textarea'
  label: string
  required: boolean
  description: string
  placeholder?: string
  reasoning: string
}

export interface SuggestedOutput {
  name: string
  type: 'SummaryBlock' | 'EmailDraft' | 'PluginAction' | 'Alert'
  category: 'human-facing' | 'machine-facing'
  description: string
  format?: 'table' | 'list' | 'markdown' | 'html' | 'json' | 'text'
  plugin?: string
  reasoning: string
}

// ============================================================================
// Compilation Result (used by V6 compiler)
// ============================================================================

export interface CompiledWorkflow {
  workflow_steps: WorkflowStep[]
  metadata: {
    ir_version: string
    goal: string
    compiled_at: string
    compiler_version: string
  }
}
