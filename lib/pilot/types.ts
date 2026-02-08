/**
 * AgentPilot Workflow Pilot - Type Definitions
 *
 * Comprehensive type system for workflow piloting including:
 * - Workflow step definitions
 * - Execution context and state
 * - Conditional expressions
 * - Execution results and outputs
 *
 * @module lib/pilot/types
 */

// ============================================================================
// WORKFLOW STEP DEFINITIONS
// ============================================================================

/**
 * Base workflow step interface
 * All step types extend this base interface
 */
export interface WorkflowStepBase {
  id: string;
  name: string;
  description?: string;

  /**
   * Dependencies: IDs of steps that must complete before this step
   */
  dependencies?: string[];

  /**
   * Conditional execution: Only execute if condition evaluates to true
   */
  executeIf?: Condition;

  /**
   * Continue workflow even if this step fails
   */
  continueOnError?: boolean;

  /**
   * Retry policy for this step
   */
  retryPolicy?: RetryPolicy;

  /**
   * Rollback action if step fails
   */
  rollbackAction?: RollbackAction;

  /**
   * Cache configuration
   */
  cache?: CacheConfig;

  /**
   * Metadata for UI display
   */
  metadata?: Record<string, any>;
}

/**
 * Action step: Execute a plugin action
 */
export interface ActionStep extends WorkflowStepBase {
  type: 'action';
  plugin: string;
  action: string;
  params: Record<string, any>;
  /** Plugin output schema - propagated from compilation for schema-aware execution */
  output_schema?: any;
}

/**
 * LLM Decision step: Use AgentKit for complex decision-making
 */
export interface LLMDecisionStep extends WorkflowStepBase {
  type: 'llm_decision';
  prompt?: string;  // Optional custom prompt
  params: Record<string, any>;
}

/**
 * AI Processing step: Alias for LLM Decision (Smart Agent Builder compatibility)
 */
export interface AIProcessingStep extends WorkflowStepBase {
  type: 'ai_processing';
  prompt?: string;  // Optional custom prompt
  params?: Record<string, any>;
}

/**
 * Conditional step: Branch based on condition
 *
 * Supports two formats:
 * 1. Legacy: trueBranch/falseBranch with step IDs (orchestrator handles routing)
 * 2. V4: then_steps/else_steps with nested step arrays (executor handles nesting)
 */
export interface ConditionalStep extends WorkflowStepBase {
  type: 'conditional';
  condition: Condition;

  // Legacy format (step IDs for routing)
  trueBranch?: string;   // Step ID to execute if true
  falseBranch?: string;  // Step ID to execute if false

  // V4 format (nested steps for direct execution)
  then_steps?: WorkflowStep[];  // Steps to execute if condition is true
  else_steps?: WorkflowStep[];  // Steps to execute if condition is false
}

/**
 * Loop step: Iterate over array
 */
export interface LoopStep extends WorkflowStepBase {
  type: 'loop';
  iterateOver: string;     // Variable reference to array
  maxIterations?: number;  // Safety limit
  loopSteps: WorkflowStep[];  // Steps to execute in each iteration
  parallel?: boolean;      // Execute iterations in parallel
}

/**
 * Transform step: Data transformation
 */
export interface TransformStep extends WorkflowStepBase {
  type: 'transform';
  operation: 'map' | 'filter' | 'reduce' | 'sort' | 'group' | 'aggregate';
  input: string;  // Variable reference
  config: TransformConfig;
}

/**
 * Delay step: Wait/sleep
 */
export interface DelayStep extends WorkflowStepBase {
  type: 'delay';
  duration: number;  // milliseconds
}

/**
 * Parallel group: Execute multiple steps concurrently
 */
export interface ParallelGroupStep extends WorkflowStepBase {
  type: 'parallel_group';
  steps: WorkflowStep[];
  maxConcurrency?: number;
}

/**
 * Switch/Case step: Route based on discrete values
 * Phase 2: Enhanced Conditionals
 */
export interface SwitchStep extends WorkflowStepBase {
  type: 'switch';
  evaluate: string; // Expression to evaluate (e.g., "{{step1.data.priority}}")
  cases: Record<string, string[]>; // Map from value to step IDs to execute
  default?: string[]; // Fallback step IDs if no case matches
}

/**
 * Scatter-Gather step: Fan-out parallel execution with aggregation
 * Phase 3: Advanced Parallel Patterns
 */
export interface ScatterGatherStep extends WorkflowStepBase {
  type: 'scatter_gather';
  scatter: {
    input: string; // Variable reference to array (e.g., "{{emails}}")
    steps: WorkflowStep[]; // Steps to execute for each item
    maxConcurrency?: number; // Limit parallel execution
    itemVariable?: string; // Variable name for current item (default: "item")
  };
  gather: {
    operation: 'collect' | 'merge' | 'reduce' | 'flatten'; // How to aggregate results
    outputKey?: string; // Where to store aggregated results (default: step.id)
    reduceExpression?: string; // For 'reduce' operation
  };
}

/**
 * Enrichment step: Merge data from multiple sources
 * Phase 4: Data Operations
 */
export interface EnrichmentStep extends WorkflowStepBase {
  type: 'enrichment';
  sources: Array<{
    key: string; // Key in output object
    from: string; // Variable reference (e.g., "{{step1.data}}")
  }>;
  strategy: 'merge' | 'deep_merge' | 'join'; // Merging strategy
  joinOn?: string; // Field to join on (for 'join' strategy)
  mergeArrays?: boolean; // Concatenate arrays instead of replacing (default: false)
}

/**
 * Validation step: Validate data against schema or rules
 * Phase 4: Data Operations
 */
export interface ValidationStep extends WorkflowStepBase {
  type: 'validation';
  input: string; // Variable reference to validate
  schema?: {
    type: 'object' | 'array' | 'string' | 'number' | 'boolean';
    required?: string[]; // Required fields (for objects)
    properties?: Record<string, any>; // Property definitions
    minLength?: number; // For strings/arrays
    maxLength?: number; // For strings/arrays
    min?: number; // For numbers
    max?: number; // For numbers
    pattern?: string; // Regex pattern for strings
  };
  rules?: Array<{
    field: string;
    condition: Condition;
    message?: string;
  }>;
  onValidationFail?: 'throw' | 'continue' | 'skip'; // What to do on failure (default: 'throw')
}

/**
 * Comparison step: Compare two data sources
 * Phase 4: Data Operations
 */
export interface ComparisonStep extends WorkflowStepBase {
  type: 'comparison';
  left: string; // Variable reference for first value
  right: string; // Variable reference for second value
  operation: 'equals' | 'deep_equals' | 'diff' | 'contains' | 'subset';
  outputFormat?: 'boolean' | 'diff' | 'detailed'; // How to format result
}

/**
 * Sub-workflow step: Execute another workflow as a sub-workflow
 * Phase 5: Sub-Workflows
 */
export interface SubWorkflowStep extends WorkflowStepBase {
  type: 'sub_workflow';
  workflowId?: string; // ID of workflow to execute (from database)
  workflowSteps?: WorkflowStep[]; // Inline workflow definition
  inputs: Record<string, string>; // Input mapping (key → variable reference)
  outputMapping?: Record<string, string>; // Map sub-workflow outputs to parent context
  timeout?: number; // Optional timeout in milliseconds
  inheritContext?: boolean; // Whether to inherit parent context variables (default: false)
  onError?: 'throw' | 'continue' | 'return_error'; // Error handling (default: 'throw')
}

/**
 * Deterministic extraction step: Extract data from documents using LLM
 * OCR extracts text (FREE), then LLM extracts structured fields from text
 *
 * Supports flexible output formats based on user intent:
 * - object: Single record per document (default)
 * - array: Multiple items per document (e.g., line items from receipt)
 * - string: Summary or unstructured text output
 */
export interface DeterministicExtractionStep extends WorkflowStepBase {
  type: 'deterministic_extraction';
  input: string;  // Variable reference to document content (e.g., "{{item.content}}")
  output_schema?: {
    type?: 'object' | 'array' | 'string';  // Output type (default: 'object')
    fields?: Array<{
      name: string;
      type: 'string' | 'number' | 'boolean' | 'date' | 'array' | 'object';
      required?: boolean;
      description?: string;
    }>;
    items?: {  // For array type: schema of each item
      fields: Array<{
        name: string;
        type: 'string' | 'number' | 'boolean' | 'date' | 'array' | 'object';
        required?: boolean;
        description?: string;
      }>;
    };
    description?: string;  // For string type or overall description
  };
  instruction?: string;  // Extraction instruction from user intent
  document_type?: 'invoice' | 'receipt' | 'form' | 'contract' | 'auto';
  ocr_fallback?: boolean;  // Use AWS Textract if pdf-parse fails
}

/**
 * Human approval step: Pause workflow for human approval
 * Phase 6: Human-in-the-Loop
 */
export interface HumanApprovalStep extends WorkflowStepBase {
  type: 'human_approval';

  // Approval configuration
  approvers: string[];  // User IDs who can approve
  approvalType: 'any' | 'all' | 'majority';  // How many approvers needed

  // Notification
  notificationChannels?: Array<{
    type: 'email' | 'webhook' | 'slack' | 'teams';
    config: Record<string, any>;  // Channel-specific config
  }>;

  // Approval message
  title: string;  // Short title for approval request
  message?: string;  // Detailed message/instructions
  context?: Record<string, string>;  // Variables to include in notification

  // Timeout
  timeout?: number;  // Timeout in milliseconds
  onTimeout?: 'approve' | 'reject' | 'escalate';  // Action on timeout (default: 'reject')
  escalateTo?: string[];  // User IDs to escalate to on timeout

  // Response handling
  requireComment?: boolean;  // Require comment with approval/rejection
  allowDelegate?: boolean;  // Allow approvers to delegate to others
}

/**
 * Union type of all workflow steps
 */
export type WorkflowStep =
  | ActionStep
  | LLMDecisionStep
  | AIProcessingStep
  | ConditionalStep
  | LoopStep
  | TransformStep
  | DelayStep
  | ParallelGroupStep
  | SwitchStep
  | ScatterGatherStep
  | EnrichmentStep
  | ValidationStep
  | ComparisonStep
  | SubWorkflowStep
  | HumanApprovalStep
  | DeterministicExtractionStep;

// ============================================================================
// CONDITIONAL EXPRESSIONS
// ============================================================================

/**
 * Simple condition: field operator value
 * NEW: Added conditionType discriminator for strict mode compatibility
 */
export interface SimpleCondition {
  conditionType: 'simple';
  field: string;
  operator: ComparisonOperator;
  value: any;
}

/**
 * Complex condition: logical combinations
 * Uses conditionType discriminator for strict mode compatibility
 */
export interface ComplexCondition {
  conditionType: 'complex_and' | 'complex_or' | 'complex_not';
  // For AND/OR operations (used when conditionType is 'complex_and' or 'complex_or')
  conditions?: Condition[];
  // For NOT operation (used when conditionType is 'complex_not')
  condition?: Condition;
}

/**
 * Condition union type
 * Now includes conditionType discriminator for strict mode
 */
export type Condition = SimpleCondition | ComplexCondition | string;

/**
 * Comparison operators
 */
export type ComparisonOperator =
  | '=='
  | '!='
  | '>'
  | '>='
  | '<'
  | '<='
  | 'equals'
  | 'not_equals'
  | 'greater_than'
  | 'greater_than_or_equal'
  | 'less_than'
  | 'less_than_or_equal'
  | 'contains'
  | 'not_contains'
  | 'in'
  | 'not_in'
  | 'exists'
  | 'not_exists'
  | 'is_empty'
  | 'is_not_empty'
  | 'matches'  // regex match
  | 'matches_regex'  // alias for matches (schema compatibility)
  | 'starts_with'
  | 'ends_with'
  // Date operators (Wave 8 - schema alignment)
  | 'within_last_days'  // Date is within N days from now
  | 'before'  // Date is before reference date
  | 'after';  // Date is after reference date

// ============================================================================
// DEPENDENCY INTERFACES (Wave 7 Type Safety Fix)
// ============================================================================

/**
 * Interface for WorkflowOrchestrator
 * Replaces `any` type for type safety
 */
export interface IOrchestrator {
  /**
   * Check if orchestration is active
   */
  isActive(): boolean;

  /**
   * Execute a step with orchestration
   */
  executeStep(
    stepId: string,
    stepData: {
      step: WorkflowStep;
      params: Record<string, any>;
      context: Record<string, any>;
      executionContext: IExecutionContext;
    },
    memoryContext?: MemoryContext,
    pluginsRequired?: string[]
  ): Promise<{
    output: any;
    tokensUsed: { total: number; input?: number; output?: number };
    tokensSaved: number;
    executionTime: number;
    compressionApplied?: boolean;
    routedModel?: string;
  } | null>;

  /**
   * Orchestrator configuration
   */
  config?: {
    aisRoutingEnabled?: boolean;
    [key: string]: any;
  };
}

/**
 * Interface for StateManager
 * Used by StepExecutor for persistence
 */
export interface IStateManager {
  /**
   * Log step execution start
   */
  logStepExecution(
    workflowExecutionId: string,
    stepId: string,
    stepName: string,
    stepType: string,
    status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped',
    metadata?: Record<string, any>
  ): Promise<void>;

  /**
   * Update step execution status
   */
  updateStepExecution(
    workflowExecutionId: string,
    stepId: string,
    status: 'completed' | 'failed' | 'skipped',
    metadata?: Record<string, any>,
    errorMessage?: string
  ): Promise<void>;
}

/**
 * Interface for ParallelExecutor
 * Used by StepExecutor for nested parallel operations
 */
export interface IParallelExecutor {
  /**
   * Execute scatter-gather step
   */
  executeScatterGather(
    step: ScatterGatherStep,
    context: IExecutionContext
  ): Promise<any[]>;

  /**
   * Execute loop step
   */
  executeLoop(
    step: LoopStep,
    context: IExecutionContext
  ): Promise<any[]>;
}

/**
 * Interface for ExecutionContext (minimal interface for dependency injection)
 * The full ExecutionContext class implements this plus additional methods
 */
export interface IExecutionContext {
  // Execution metadata
  executionId: string;
  agentId: string;
  userId: string;
  sessionId: string;

  // Agent configuration
  agent: Agent;
  inputValues: Record<string, any>;

  // Execution state
  status: ExecutionStatus;
  currentStep: string | null;
  completedSteps: string[];
  failedSteps: string[];
  skippedSteps: string[];

  // Runtime variables
  variables: Record<string, any>;

  // Memory context
  memoryContext?: MemoryContext;

  // Orchestration (Phase 4) - now typed
  orchestrator?: IOrchestrator;

  // Timing
  startedAt: Date;
  completedAt?: Date;

  // Metrics
  totalTokensUsed: number;
  totalExecutionTime: number;

  // Methods required by StepExecutor and ParallelExecutor
  resolveVariable(reference: string): any;
  resolveAllVariables(obj: any): any;
  setVariable(name: string, value: any): void;
  getStepOutput(stepId: string): StepOutput | undefined;
  setStepOutput(stepId: string, output: StepOutput): void;
  getAllStepOutputs(): Map<string, StepOutput>;
  markStepSkipped(stepId: string): void;
  clone(resetMetrics?: boolean): IExecutionContext;
}

// ============================================================================
// EXECUTION CONTEXT
// ============================================================================

/**
 * Execution context: In-memory state during workflow execution
 * @deprecated Use IExecutionContext interface for type declarations
 */
export interface ExecutionContext {
  // Execution metadata
  executionId: string;
  agentId: string;
  userId: string;
  sessionId: string;

  // Agent configuration
  agent: Agent;
  inputValues: Record<string, any>;

  // Execution state
  status: ExecutionStatus;
  currentStep: string | null;
  completedSteps: string[];
  failedSteps: string[];
  skippedSteps: string[];

  // Step outputs (in-memory, ephemeral)
  stepOutputs: Map<string, StepOutput>;

  // Runtime variables
  variables: Record<string, any>;

  // Memory context
  memoryContext?: MemoryContext;

  // Orchestration (Phase 4) - now typed
  orchestrator?: IOrchestrator;

  // Timing
  startedAt: Date;
  completedAt?: Date;

  // Metrics
  totalTokensUsed: number;
  totalExecutionTime: number;
}

/**
 * Execution status
 */
export type ExecutionStatus = 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

/**
 * Step output from plugin execution
 */
export interface StepOutput {
  stepId: string;
  plugin: string;
  action: string;

  // Actual plugin response (EPHEMERAL - not persisted to DB)
  data: any;

  // Metadata (persisted to DB)
  metadata: StepOutputMetadata;
}

/**
 * ✅ P1 FIX: Standardized token usage format
 * All components should use this format for type safety and consistency
 */
export interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

/**
 * ✅ P1 FIX: Extract total tokens from any format
 * Backward compatible with existing code
 */
export function getTokenTotal(tokens: number | { total?: number; prompt?: number; completion?: number; input?: number; output?: number } | undefined): number {
  if (!tokens) return 0;
  if (typeof tokens === 'number') return tokens;
  return tokens.total ?? ((tokens.input ?? tokens.prompt ?? 0) + (tokens.output ?? tokens.completion ?? 0));
}

/**
 * Step output metadata (privacy-compliant, persisted to DB)
 */
export interface StepOutputMetadata {
  success: boolean;
  executedAt: string;
  executionTime: number;
  itemCount?: number;
  /**
   * ✅ P1 UPDATE: Prefer TokenUsage format, but still support legacy number for backward compatibility
   * Use getTokenTotal() utility to extract total tokens
   */
  tokensUsed?: TokenUsage | number | { total: number; prompt: number; completion: number };
  error?: string;
  errorCode?: string;
  cacheHit?: boolean;

  // Orchestration metadata (Phase 4)
  compressionApplied?: boolean;
  tokensSaved?: number;
  routedModel?: string;
  orchestrated?: boolean;
  subWorkflowStepCount?: number;

  // Parameter error detection (Shadow Agent)
  parameter_error_details?: {
    parameterName: string;
    problematicValue: string;
    errorMessage: string;
  };
  failure_category?: string;
  failure_sub_type?: string;

  // Auto-repair metadata
  auto_repaired?: boolean;
  repair_action?: string;
  repair_description?: string;

  // Additional metadata fields
  plugin?: string;
  action?: string;
  field_names?: string[];
  started_at?: string;
}

/**
 * Approval request tracking
 * Phase 6: Human-in-the-Loop
 */
export interface ApprovalRequest {
  id: string;  // Unique approval request ID
  executionId: string;  // Workflow execution ID
  stepId: string;  // Step ID that requires approval

  // Approval configuration
  approvers: string[];  // User IDs who can approve
  approvalType: 'any' | 'all' | 'majority';

  // Request details
  title: string;
  message?: string;
  context: Record<string, any>;  // Resolved context variables

  // Status
  status: 'pending' | 'approved' | 'rejected' | 'timeout' | 'escalated';
  createdAt: string;
  expiresAt?: string;

  // Responses
  responses: ApprovalResponse[];

  // Timeout handling
  timeoutAction?: 'approve' | 'reject' | 'escalate';
  escalatedTo?: string[];
}

/**
 * Individual approval response
 * Phase 6: Human-in-the-Loop
 */
export interface ApprovalResponse {
  approverId: string;
  decision: 'approve' | 'reject';
  comment?: string;
  respondedAt: string;
  delegatedFrom?: string;  // If approval was delegated
}

/**
 * Execution summary for checkpointing
 */
export interface ExecutionSummary {
  executionId: string;
  agentId: string;
  userId: string;
  status: ExecutionStatus;
  currentStep: string | null;
  completedSteps: string[];
  failedSteps: string[];
  skippedSteps: string[];
  totalTokensUsed: number;
  totalExecutionTime: number;
  stepCount: {
    total: number;
    completed: number;
    failed: number;
    skipped: number;
  };
}

// ============================================================================
// EXECUTION PLAN
// ============================================================================

/**
 * Execution plan: Parsed workflow with dependency graph
 */
export interface ExecutionPlan {
  steps: ExecutionStep[];
  parallelGroups: ParallelGroup[];
  totalSteps: number;
  estimatedDuration: number;
}

/**
 * Execution step: Enhanced step definition with execution metadata
 */
export interface ExecutionStep {
  stepId: string;
  stepDefinition: WorkflowStep;
  dependencies: string[];
  level: number;  // Execution level (0 = no deps, 1 = depends on level 0, etc.)
  canRunInParallel: boolean;
  parallelGroupId?: string;
}

/**
 * Parallel group: Steps that can execute concurrently
 */
export interface ParallelGroup {
  groupId: string;
  level: number;
  steps: string[];  // Step IDs
}

/**
 * Workflow validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings?: string[];
}

// ============================================================================
// EXECUTION RESULTS
// ============================================================================

/**
 * Workflow execution result
 */
export interface WorkflowExecutionResult {
  success: boolean;
  executionId: string;
  output: any;

  // Step counts
  stepsCompleted: number;
  stepsFailed: number;
  stepsSkipped: number;

  // Metrics
  totalExecutionTime: number;
  totalTokensUsed: number;

  // Step details for visualization
  completedStepIds?: string[];
  failedStepIds?: string[];
  skippedStepIds?: string[];

  // Debug mode support
  debugRunId?: string;

  // Orchestration metrics (Phase 4)
  orchestrationMetrics?: {
    totalTokensUsed: number;
    totalTokensSaved: number;
    savingsPercent: string;
    totalCost: number;
    budgetUtilization: string;
  };

  // Error info (if failed)
  error?: string;
  errorStack?: string;
  failedStep?: string;

  // Batch calibration results
  collectedIssues?: CollectedIssue[];
  context?: any; // ExecutionContext (for hardcode detection after execution)
}

// ============================================================================
// BATCH CALIBRATION INTERFACES
// ============================================================================

/**
 * Issue collected during batch calibration
 */
export interface CollectedIssue {
  id: string; // uuid
  category: 'parameter_error' | 'hardcode_detected' | 'data_shape_mismatch' |
            'logic_error' | 'execution_error' | 'data_unavailable';
  severity: 'critical' | 'high' | 'medium' | 'low';

  // Affected steps
  affectedSteps: Array<{
    stepId: string;
    stepName: string;
    friendlyName: string;
  }>;

  // Issue details
  title: string; // "Parameter 'range' not found"
  message: string; // Plain English explanation
  technicalDetails: string; // Technical error message

  // Fix information
  suggestedFix?: {
    type: 'parameter_correction' | 'parameterization' | 'data_repair' | 'logic_suggestion';
    action: any; // Depends on type
    confidence: number; // 0-1
  };

  // Auto-repair info
  autoRepairAvailable: boolean;
  autoRepairProposal?: any; // RepairProposal from RepairEngine

  // UI metadata
  requiresUserInput: boolean;
  estimatedImpact: 'high' | 'medium' | 'low';
}

/**
 * Calibration session from database
 */
export interface CalibrationSession {
  id: string;
  agent_id: string;
  user_id: string;
  execution_id?: string;
  status: 'running' | 'collecting_issues' | 'awaiting_fixes' | 'fixes_applied' | 'completed' | 'failed';
  issues: CollectedIssue[];
  issue_summary: {
    critical: number;
    warnings: number;
    auto_repairs: number;
  };
  auto_repairs_proposed: any[];
  user_fixes: Record<string, any>;
  applied_fixes?: {
    parameters: number;
    parameterizations: number;
    autoRepairs: number;
  };
  backup_pilot_steps?: any;
  total_steps: number;
  completed_steps: number;
  failed_steps: number;
  skipped_steps: number;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

// ============================================================================
// CONFIGURATION INTERFACES
// ============================================================================

/**
 * Retry policy configuration
 */
export interface RetryPolicy {
  maxRetries: number;
  backoffMs: number;
  backoffMultiplier: number;
  retryableErrors: string[];
}

/**
 * Rollback action configuration
 */
export interface RollbackAction {
  plugin: string;
  action: string;
  params: Record<string, any>;
}

/**
 * Cache configuration
 */
export interface CacheConfig {
  enabled: boolean;
  key: string;  // Cache key (can include variable references)
  ttl: number;  // TTL in seconds
}

/**
 * Transform configuration
 */
export interface TransformConfig {
  // Map operation
  mapping?: Record<string, string>;

  // Filter operation
  condition?: Condition;

  // Reduce operation
  reducer?: string;  // Function name or expression
  initialValue?: any;

  // Sort operation
  field?: string;
  order?: 'asc' | 'desc';

  // Aggregate operation
  aggregations?: Array<{
    field: string;
    operation: 'sum' | 'avg' | 'min' | 'max' | 'count';
    alias?: string;
  }>;
}

// ============================================================================
// AGENT & MEMORY INTERFACES
// ============================================================================

/**
 * Agent interface (from database)
 */
export interface Agent {
  id: string;
  user_id: string;
  agent_name: string;

  // Prompts
  system_prompt?: string;
  enhanced_prompt?: string;
  user_prompt: string;

  // Workflow
  workflow_steps?: WorkflowStep[];  // Legacy format (backward compatibility with old agents)
  pilot_steps?: WorkflowStep[];     // Pilot format (default for all new agents)

  // Plugins
  plugins_required: string[];

  // Schemas
  input_schema?: InputSchema[];
  output_schema?: OutputSchema[];

  // Triggers
  schedule_cron?: string;
  trigger_condintion?: any;

  // Production & Insights
  production_ready?: boolean;       // Whether agent is ready for production
  insights_enabled?: boolean;       // Whether to generate AI-powered insights (requires LLM calls)

  // Metadata
  status: string;
  created_at: string;
  updated_at?: string;
}

/**
 * Input schema definition
 */
export interface InputSchema {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  default?: any;
  validation?: ValidationRule[];
}

/**
 * Output schema definition
 */
export interface OutputSchema {
  name: string;
  type: string;
  source?: string;  // Variable reference for where to get the value
  format?: string;
  description?: string;
}

/**
 * Validation rule
 */
export interface ValidationRule {
  type: 'min' | 'max' | 'pattern' | 'enum' | 'custom';
  value: any;
  message?: string;
}

/**
 * Memory context (from MemoryInjector)
 */
export interface MemoryContext {
  recent_runs: AgentMemorySummary[];
  user_context: UserMemoryEntry[];
  relevant_patterns: AgentMemorySummary[];
  token_count: number;
}

/**
 * Agent memory summary
 */
export interface AgentMemorySummary {
  run_number: number;
  summary: string;
  insights: string[];
  patterns_observed: string[];
  input_summary: string;
  output_summary: string;
  status: string;
  execution_time_ms: number;
  model_used: string;
  created_at: string;
}

/**
 * User memory entry
 */
export interface UserMemoryEntry {
  memory_key: string;
  memory_value: string;
  memory_type: 'preference' | 'context' | 'pattern' | 'fact';
  importance: number;
  usage_count: number;
  last_used_at?: string;
}

// ============================================================================
// DATABASE INTERFACES
// ============================================================================

/**
 * Workflow execution record (from database)
 */
export interface WorkflowExecutionRecord {
  id: string;
  agent_id: string;
  user_id: string;

  // State
  status: ExecutionStatus;
  current_step: string | null;

  // Plan
  execution_plan: ExecutionPlan;
  total_steps: number;

  // Progress
  completed_steps_count: number;
  failed_steps_count: number;
  skipped_steps_count: number;

  // Trace (sanitized)
  execution_trace: ExecutionTrace;

  // Input/Output
  input_values: Record<string, any>;
  final_output: any;

  // Metrics
  total_tokens_used: number;
  total_execution_time_ms: number;

  // Error
  error_message?: string;
  error_stack?: string;
  retry_count: number;

  // Session
  session_id: string;

  // Timestamps
  started_at: string;
  paused_at?: string;
  resumed_at?: string;
  completed_at?: string;
  failed_at?: string;
  cancelled_at?: string;
  updated_at: string;
  created_at: string;
}

/**
 * Execution trace (sanitized, for database)
 */
export interface ExecutionTrace {
  completedSteps: string[];
  failedSteps: string[];
  skippedSteps: string[];
  stepExecutions: Array<{
    stepId: string;
    plugin: string;
    action: string;
    metadata: StepOutputMetadata;
  }>;
}

/**
 * Workflow step execution record (from database)
 */
export interface WorkflowStepExecutionRecord {
  id: string;
  workflow_execution_id: string;

  // Step info
  step_id: string;
  step_name: string;
  step_type: string;

  // Plugin info
  plugin?: string;
  action?: string;

  // Status
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'cancelled';

  // Metadata (sanitized)
  execution_metadata: StepOutputMetadata;

  // Error
  error_message?: string;
  error_code?: string;
  retry_count: number;

  // Metrics
  execution_time_ms: number;
  tokens_used?: number;
  item_count?: number;

  // Timestamps
  started_at: string;
  completed_at?: string;
  failed_at?: string;
  created_at: string;
}

// ============================================================================
// PILOT OPTIONS
// ============================================================================

/**
 * Pilot configuration options
 */
export interface PilotOptions {
  // Execution options
  maxParallelSteps?: number;
  defaultTimeout?: number;
  enableCaching?: boolean;

  // Error handling
  defaultRetryPolicy?: RetryPolicy;
  continueOnError?: boolean;

  // Monitoring
  enableProgressTracking?: boolean;
  enableRealTimeUpdates?: boolean;

  // Performance
  enableOptimizations?: boolean;
  cacheStepResults?: boolean;

  // Memory configuration
  memoryLoadTimeoutMs?: number;
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

/**
 * Variable reference (e.g., "{{step1.data.email}}")
 */
export type VariableReference = string;

/**
 * Step ID reference
 */
export type StepId = string;

/**
 * Plugin key reference
 */
export type PluginKey = string;

/**
 * Action name reference
 */
export type ActionName = string;

// ============================================================================
// ERROR TYPES
// ============================================================================

/**
 * Workflow error base class
 */
export class WorkflowError extends Error {
  constructor(
    message: string,
    public code: string,
    public stepId?: string,
    public details?: any
  ) {
    super(message);
    this.name = 'WorkflowError';
  }
}

/**
 * Validation error
 */
export class ValidationError extends WorkflowError {
  constructor(message: string, stepId?: string, details?: any) {
    super(message, 'VALIDATION_ERROR', stepId, details);
    this.name = 'ValidationError';
  }
}

/**
 * Execution error
 */
export class ExecutionError extends WorkflowError {
  constructor(message: string, stepId?: string, details?: any) {
    super(message, 'EXECUTION_ERROR', stepId, details);
    this.name = 'ExecutionError';
  }
}

/**
 * Condition evaluation error
 */
export class ConditionError extends WorkflowError {
  constructor(message: string, stepId?: string, details?: any) {
    super(message, 'CONDITION_ERROR', stepId, details);
    this.name = 'ConditionError';
  }
}

/**
 * Variable resolution error
 */
export class VariableResolutionError extends WorkflowError {
  constructor(message: string, variable: string, stepId?: string) {
    super(message, 'VARIABLE_RESOLUTION_ERROR', stepId, { variable });
    this.name = 'VariableResolutionError';
  }
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Type guard for ActionStep
 */
export function isActionStep(step: WorkflowStep): step is ActionStep {
  return step.type === 'action';
}

/**
 * Type guard for LLMDecisionStep
 */
export function isLLMDecisionStep(step: WorkflowStep): step is LLMDecisionStep {
  return step.type === 'llm_decision';
}

/**
 * Type guard for ConditionalStep
 */
export function isConditionalStep(step: WorkflowStep): step is ConditionalStep {
  return step.type === 'conditional';
}

/**
 * Type guard for LoopStep
 */
export function isLoopStep(step: WorkflowStep): step is LoopStep {
  return step.type === 'loop';
}

/**
 * Type guard for TransformStep
 */
export function isTransformStep(step: WorkflowStep): step is TransformStep {
  return step.type === 'transform';
}

/**
 * Type guard for ParallelGroupStep
 */
export function isParallelGroupStep(step: WorkflowStep): step is ParallelGroupStep {
  return step.type === 'parallel_group';
}

/**
 * Type guard for SwitchStep
 */
export function isSwitchStep(step: WorkflowStep): step is SwitchStep {
  return step.type === 'switch';
}

/**
 * Type guard for ScatterGatherStep
 */
export function isScatterGatherStep(step: WorkflowStep): step is ScatterGatherStep {
  return step.type === 'scatter_gather';
}

/**
 * Type guard for EnrichmentStep
 * Phase 4: Data Operations
 */
export function isEnrichmentStep(step: WorkflowStep): step is EnrichmentStep {
  return step.type === 'enrichment';
}

/**
 * Type guard for ValidationStep
 * Phase 4: Data Operations
 */
export function isValidationStep(step: WorkflowStep): step is ValidationStep {
  return step.type === 'validation';
}

/**
 * Type guard for ComparisonStep
 * Phase 4: Data Operations
 */
export function isComparisonStep(step: WorkflowStep): step is ComparisonStep {
  return step.type === 'comparison';
}

/**
 * Type guard for SubWorkflowStep
 * Phase 5: Sub-Workflows
 */
export function isSubWorkflowStep(step: WorkflowStep): step is SubWorkflowStep {
  return step.type === 'sub_workflow';
}

/**
 * Type guard for HumanApprovalStep
 * Phase 6: Human-in-the-Loop
 */
export function isHumanApprovalStep(step: WorkflowStep): step is HumanApprovalStep {
  return step.type === 'human_approval';
}

/**
 * Type guard for DeterministicExtractionStep
 */
export function isDeterministicExtractionStep(step: WorkflowStep): step is DeterministicExtractionStep {
  return step.type === 'deterministic_extraction';
}

/**
 * Type guard for SimpleCondition
 * Uses conditionType discriminator for strict mode compatibility
 */
export function isSimpleCondition(condition: Condition): condition is SimpleCondition {
  return (
    typeof condition === 'object' &&
    'conditionType' in condition &&
    condition.conditionType === 'simple'
  );
}

/**
 * Type guard for ComplexCondition
 * Uses conditionType discriminator for strict mode compatibility
 */
export function isComplexCondition(condition: Condition): condition is ComplexCondition {
  return (
    typeof condition === 'object' &&
    'conditionType' in condition &&
    (condition.conditionType === 'complex_and' ||
     condition.conditionType === 'complex_or' ||
     condition.conditionType === 'complex_not')
  );
}
