/**
 * Contract-Based Pipeline Types
 *
 * Core TypeScript interfaces for the requirements extraction, tracking, and validation system.
 * These types enable formal contracts between pipeline phases to prevent information loss.
 */

/**
 * Main workflow contract that tracks requirements through all pipeline phases
 */
export interface WorkflowContract {
  version: string

  /** Requirements extracted from Enhanced Prompt */
  requirements: Requirement[]

  /** Data flow tracking between operations */
  dataFlow: DataFlow[]

  /** Execution constraints (sequential, parallel, conditional) */
  executionConstraints: ExecutionConstraint[]

  /** Validation rules for each phase */
  validationRules: ValidationRule[]
}

/**
 * Individual requirement from Enhanced Prompt
 */
export interface Requirement {
  /** Unique identifier (R1, R2, R3...) */
  id: string

  /** Type of requirement */
  type: 'data_source' | 'transformation' | 'storage' | 'delivery' | 'conditional' | 'edge_case'

  /** Human-readable description */
  description: string

  /** Other requirement IDs this depends on */
  dependencies: string[]

  /** Current status in pipeline */
  status: 'pending' | 'mapped' | 'validated' | 'enforced'

  // Lineage tracking
  /** Which section of Enhanced Prompt */
  enhancedPromptSection: string

  /** Path in Semantic Plan (e.g., "understanding.data_sources[0]") */
  semanticMapping?: string

  /** Path in IR (e.g., "data_sources[0]") */
  irMapping?: string

  /** DSL step IDs (e.g., ["step1", "step2"]) */
  dslMapping?: string[]

  // Additional metadata
  /** For transformation requirements - output fields expected */
  outputFields?: string[]

  /** For conditional requirements - the condition expression */
  condition?: string

  /** For conditional requirements - which operations it applies to */
  appliesTo?: string[]

  /** For conditional requirements - which operations it excludes */
  excludes?: string[]

  /** Validation rule to check this requirement */
  validationRule?: string

  /** Check to enforce this requirement */
  enforcementCheck?: string
}

/**
 * Data flow between operations
 * Tracks which operation produces data that another operation consumes
 */
export interface DataFlow {
  /** Unique identifier (DF1, DF2, DF3...) */
  id: string

  /** Operation that produces data (requirement ID or operation name) */
  source: string

  /** Operation that consumes data (requirement ID or operation name) */
  target: string

  /** Field being passed (e.g., "drive_link", "folder_id") */
  dataField: string

  /** Whether this data flow is required for workflow to succeed */
  required: boolean

  /** Full path to source field (e.g., "emails[].id") */
  sourceField?: string

  /** Any transformations needed */
  transformations?: string[]

  /** Whether this field is used in a condition */
  usedInCondition?: boolean
}

/**
 * Execution constraint that must be enforced
 */
export interface ExecutionConstraint {
  /** Type of constraint */
  type: 'sequential' | 'parallel' | 'conditional' | 'always_execute'

  /** Requirement IDs this constraint applies to */
  operations: string[]

  /** Human-readable reason for this constraint */
  reason: string

  /** How strictly this must be enforced */
  enforcementLevel: 'must' | 'should' | 'can'

  /** For conditional constraints - the condition */
  condition?: string

  /** For conditional constraints - scope specification */
  scope?: 'selective' | 'all'

  // Lineage tracking
  /** Where in Semantic Plan this is represented */
  semanticMapping?: string

  /** Where in IR this is represented */
  irMapping?: string

  /** Where in DSL this is enforced */
  dslMapping?: string[]
}

/**
 * Validation rule for checking requirements
 */
export interface ValidationRule {
  /** Unique identifier (VR1, VR2, VR3...) */
  id: string

  /** Type of validation */
  type: 'presence' | 'execution_order' | 'conditional_scope' | 'data_flow' | 'schema_compliance'

  /** Human-readable description */
  description: string

  /** Check expression (pseudo-code describing the validation) */
  check: string

  /** Which phase this rule applies to */
  phase?: 'semantic_plan' | 'ir' | 'dsl'
}

/**
 * Result of a validation check
 */
export interface ValidationResult {
  /** Whether validation passed */
  valid: boolean

  /** Errors that cause validation to fail */
  errors: ValidationError[]

  /** Warnings that don't fail validation but should be noted */
  warnings: ValidationWarning[]

  /** Updated contract with lineage tracking filled in */
  updatedContract: WorkflowContract

  /** Which phase was validated */
  phase: 'semantic_plan' | 'ir' | 'dsl'

  /** Timestamp of validation */
  timestamp?: Date
}

/**
 * Validation error
 */
export interface ValidationError {
  /** Error type for categorization */
  type: 'requirement_missing' | 'constraint_violated' | 'data_flow_broken' |
        'nested_groups' | 'missing_field' | 'wrong_type' | 'invalid_field' |
        'plugin_missing' | 'invalid_input' | 'schema_violation'

  /** Human-readable error message */
  message: string

  /** Requirement ID this error relates to */
  requirementId?: string

  /** Path in output where error occurred */
  path?: string

  /** Default value that can be used to fix the error */
  defaultValue?: any

  /** Expected type (for type mismatch errors) */
  expectedType?: string

  /** Severity level */
  severity: 'error' | 'critical'
}

/**
 * Validation warning
 */
export interface ValidationWarning {
  /** Warning type */
  type: 'optimization' | 'style' | 'deprecation' | 'grounding_low_confidence'

  /** Human-readable warning message */
  message: string

  /** Requirement ID this warning relates to */
  requirementId?: string

  /** Suggested fix */
  suggestion?: string
}

/**
 * Result of auto-recovery attempt
 */
export interface RecoveryResult {
  /** Strategy used for recovery */
  strategy: 'auto_fixed' | 'llm_fixed' | 'llm_fallback' | 'needs_clarification'

  /** Fixed output */
  output: any

  /** Errors that were fixed */
  fixesApplied?: Array<{
    error: ValidationError
    method: string
  }>

  /** Whether output still fails validation after recovery */
  stillFailing: boolean

  /** For needs_clarification strategy - questions to ask user */
  questions?: Array<{
    question: string
    options: string[]
    reason: string
  }>

  /** Partial workflow that was generated successfully */
  partialWorkflow?: any
}

/**
 * Categorized errors for recovery
 */
export interface CategorizedErrors {
  /** Simple structural issues that can be auto-fixed */
  autoFixable: ValidationError[]

  /** Semantic issues that need LLM to fix */
  needsLLM: ValidationError[]

  /** Errors that cannot be fixed automatically */
  unrecoverable: ValidationError[]
}

/**
 * Requirement lineage for debugging/tracing
 */
export interface RequirementLineage {
  /** Requirement ID */
  requirementId: string

  /** Human-readable description */
  description: string

  /** Source in Enhanced Prompt */
  source: string

  /** Mapping in Semantic Plan */
  semanticPlan?: string

  /** Mapping in IR */
  ir?: string

  /** Mapping in DSL */
  dsl?: string[]

  /** Final status */
  status: 'pending' | 'mapped' | 'validated' | 'enforced'
}

/**
 * Enhanced Prompt structure is defined in HardRequirementsExtractor.ts
 * (removed from here to avoid duplicate export)
 */

/**
 * Workflow result with contract and lineage
 */
export interface WorkflowResult {
  /** Generated workflow DSL */
  workflow: any

  /** Contract with full lineage tracking */
  contract: WorkflowContract

  /** Lineage for each requirement */
  lineage: RequirementLineage[]

  /** Validation results from each phase */
  validation: {
    semanticPlan: ValidationResult
    ir: ValidationResult
    dsl: ValidationResult
  }
}

/**
 * Pipeline validation error (thrown when validation fails)
 */
export class PipelineValidationError extends Error {
  constructor(
    public phase: string,
    public errors: ValidationError[]
  ) {
    super(`Validation failed at ${phase} phase: ${errors.map(e => e.message).join(', ')}`)
    this.name = 'PipelineValidationError'
  }
}
