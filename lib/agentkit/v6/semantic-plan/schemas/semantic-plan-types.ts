/**
 * Semantic Plan Types (V6)
 *
 * The Semantic Plan sits between Enhanced Prompt and IR.
 * It represents the LLM's UNDERSTANDING of the workflow BEFORE formalization.
 *
 * Key Properties:
 * - Ambiguity-tolerant: Can express "probably", "if exists", "infer"
 * - Non-executable: Contains reasoning, not execution instructions
 * - Repairable: Can be refined through dialogue or grounding
 * - Transparent: Shows what the LLM understood for user review
 *
 * Architecture:
 *   Enhanced Prompt → [LLM: Understanding] → Semantic Plan
 *                                               ↓
 *                                          [Grounding: Validate]
 *                                               ↓
 *                      [LLM: Formalize] → IR (fully resolved)
 */

// ============================================================================
// Core Semantic Plan Structure
// ============================================================================

export interface SemanticPlan {
  /** Version of semantic plan schema */
  plan_version: '1.0'

  /** High-level understanding of user's goal */
  goal: string

  /** Structured understanding of the workflow */
  understanding: Understanding

  /** Explicit assumptions that need validation */
  assumptions: Assumption[]

  /** Inferences made by the LLM (can be corrected) */
  inferences: Inference[]

  /** Unresolved ambiguities with resolution strategies */
  ambiguities: Ambiguity[]

  /** Reasoning traces (why LLM made certain decisions) */
  reasoning_trace: ReasoningTrace[]

  /** Questions for the user (if understanding is incomplete) */
  clarifications_needed?: string[]
}

// ============================================================================
// Understanding - What the LLM Understood
// ============================================================================

export interface Understanding {
  /** What data source(s) to use */
  data_sources: DataSourceUnderstanding[]

  /** Runtime inputs required from user at execution time */
  runtime_inputs?: RuntimeInputUnderstanding[]

  /** How to filter the data */
  filtering?: FilteringUnderstanding

  /** What AI processing is needed */
  ai_processing?: AIProcessingUnderstanding[]

  /** How to group/partition data */
  grouping?: GroupingUnderstanding

  /** How to format/render output */
  rendering?: RenderingUnderstanding

  /** How to deliver results */
  delivery: DeliveryUnderstanding

  /** Edge cases and error handling */
  edge_cases?: EdgeCaseUnderstanding[]
}

export interface RuntimeInputUnderstanding {
  /** Variable name (e.g., "topic", "search_query") */
  name: string

  /** Input type */
  type: 'text' | 'number' | 'email' | 'date' | 'select'

  /** Human-readable label */
  label: string

  /** Description of what this input is for */
  description: string

  /** Whether this input is required */
  required: boolean

  /** Placeholder text */
  placeholder?: string

  /** Options for select type */
  options?: string[]
}

export interface DataSourceUnderstanding {
  /** Type of data source (user's description) */
  type: 'spreadsheet' | 'email' | 'database' | 'api' | 'webhook' | 'file' | 'stream'

  /** Source description (e.g., "Google Sheets", "Gmail emails") */
  source_description: string

  /** Location (e.g., "MyLeads spreadsheet", "inbox") */
  location: string

  /** What this data represents (business context) */
  role: string

  /** Field/column assumptions */
  expected_fields?: FieldAssumption[]
}

export interface FieldAssumption {
  /** Semantic name (what the field represents) */
  semantic_name: string

  /** Possible physical field names (candidates for fuzzy matching) */
  field_name_candidates: string[]

  /** Expected data type */
  expected_type?: 'string' | 'number' | 'date' | 'email' | 'boolean'

  /** Whether this field is required */
  required: boolean

  /** Reasoning for this assumption */
  reasoning: string
}

export interface FilteringUnderstanding {
  /** What filtering is needed (natural language) */
  description: string

  /** Filter conditions (with possible ambiguity) */
  conditions: FilterConditionUnderstanding[]

  /** How to combine conditions */
  combination_logic: 'AND' | 'OR' | 'complex'

  /** Complex logic explanation (if applicable) */
  complex_logic_explanation?: string
}

export interface FilterConditionUnderstanding {
  /** Field to filter on (semantic name) */
  field: string

  /** Operation (user's intent) */
  operation: string

  /** Value or value description */
  value: string | number | boolean

  /** Confidence in this interpretation */
  confidence: 'high' | 'medium' | 'low'

  /** Alternative interpretations */
  alternatives?: string[]
}

export interface AIProcessingUnderstanding {
  /** Type of AI operation */
  type: 'extract' | 'classify' | 'summarize' | 'generate' | 'analyze' | 'transform' | 'deterministic_extract'

  /** What to do (business language) */
  instruction: string

  /** What data to process */
  input_description: string

  /** Expected output structure */
  output_description: string

  /**
   * Output type based on user intent:
   * - object: Single record per document (default)
   * - array: Multiple items per document (e.g., line items)
   * - string: Summary or text output
   */
  output_type?: 'object' | 'array' | 'string'

  /** Field mappings for extraction (if applicable) */
  field_mappings?: AIFieldMapping[]

  /** For deterministic_extract: document type hint */
  document_type?: string

  /** For deterministic_extract: use OCR fallback */
  ocr_fallback?: boolean
}

export interface AIFieldMapping {
  /** Output field name */
  output_field: string

  /** Possible source field names in input */
  source_field_candidates: string[]

  /** Extraction strategy */
  extraction_strategy: string

  /** Format/transformation needed */
  format?: string
}

export interface GroupingUnderstanding {
  /** Whether grouping is needed */
  needs_grouping: boolean

  /** Field to group by (semantic name) */
  group_by_field?: string

  /** Grouping strategy description */
  strategy_description: string

  /** What to do with each group */
  per_group_action?: string
}

export interface RenderingUnderstanding {
  /** Desired output format */
  format: 'table' | 'summary' | 'list' | 'custom'

  /** What columns/fields to include */
  columns_to_include?: string[]

  /** Order preference */
  column_order_preference?: string

  /** Message when no results */
  empty_message?: string
}

export interface DeliveryUnderstanding {
  /** Delivery pattern */
  pattern: 'per_item' | 'per_group' | 'summary' | 'conditional'

  /** Who receives results */
  recipients_description: string

  /** How to determine recipients */
  recipient_resolution_strategy: string

  /** Email subject (if applicable) */
  subject_template?: string

  /** Email body description */
  body_description?: string

  /** CC recipients */
  cc_recipients?: string[]

  /** Delivery conditions */
  conditions?: string
}

export interface EdgeCaseUnderstanding {
  /** What edge case this handles */
  scenario: string

  /** How to handle it */
  handling_strategy: string

  /** Who to notify */
  notify_who?: string
}

// ============================================================================
// Assumptions - Things That Need Validation
// ============================================================================

export interface Assumption {
  /** Unique ID for this assumption */
  id: string

  /** Category of assumption */
  category: 'field_name' | 'data_type' | 'value_format' | 'structure' | 'behavior'

  /** What is assumed */
  description: string

  /** Confidence level */
  confidence: 'high' | 'medium' | 'low'

  /** How to validate this assumption */
  validation_strategy: ValidationStrategy

  /** Impact if assumption is wrong */
  impact_if_wrong: 'critical' | 'major' | 'minor'

  /** Fallback if assumption fails */
  fallback?: string
}

export interface ValidationStrategy {
  /** Method to validate */
  method: 'exact_match' | 'fuzzy_match' | 'data_sample' | 'user_confirmation' | 'heuristic'

  /** Parameters for validation */
  parameters?: Record<string, any>

  /** Acceptable threshold (for fuzzy matching, confidence scores, etc.) */
  threshold?: number
}

// ============================================================================
// Inferences - Things the LLM Filled In
// ============================================================================

export interface Inference {
  /** What was inferred */
  field: string

  /** Inferred value */
  value: any

  /** Why this was inferred */
  reasoning: string

  /** Confidence in inference */
  confidence: 'high' | 'medium' | 'low'

  /** Can user override this? */
  user_overridable: boolean
}

// ============================================================================
// Ambiguities - Unresolved Questions
// ============================================================================

export interface Ambiguity {
  /** What is ambiguous */
  field: string

  /** Question to resolve */
  question: string

  /** Possible resolutions */
  possible_resolutions: string[]

  /** Recommended resolution */
  recommended_resolution: string

  /** How to resolve programmatically */
  resolution_strategy: string

  /** Whether user input is needed */
  requires_user_input: boolean
}

// ============================================================================
// Reasoning Trace - Why Decisions Were Made
// ============================================================================

export interface ReasoningTrace {
  /** Step in reasoning */
  step: number

  /** Decision point */
  decision: string

  /** Options considered */
  options_considered: string[]

  /** Choice made */
  choice_made: string

  /** Why this choice */
  reasoning: string

  /** Confidence in choice */
  confidence: 'high' | 'medium' | 'low'
}

// ============================================================================
// Grounding Results - After Validation
// ============================================================================

export interface GroundedSemanticPlan extends SemanticPlan {
  /** Flag to indicate grounding was performed */
  grounded: boolean

  /** Grounding results for each assumption */
  grounding_results: GroundingResult[]

  /** Errors encountered during grounding */
  grounding_errors: GroundingError[]

  /** Overall grounding confidence (0-1) */
  grounding_confidence: number

  /** Timestamp when grounding was performed */
  grounding_timestamp: string

  /** Number of validated assumptions */
  validated_assumptions_count: number

  /** Total number of assumptions */
  total_assumptions_count: number

  /** Flag indicating all assumptions were skipped (no real validation) */
  all_assumptions_skipped?: boolean

  /** Number of assumptions that were skipped */
  skipped_assumptions_count?: number
}

export interface GroundingResult {
  /** Assumption ID */
  assumption_id: string

  /** Was assumption validated? */
  validated: boolean

  /** Was validation skipped (graceful degradation)? */
  skipped?: boolean

  /** Resolved value (if validated) */
  resolved_value?: any | null

  /** Validation method used */
  validation_method: string

  /** Confidence in resolution */
  confidence: number

  /** Details of resolution (renamed from evidence) */
  evidence?: string

  /** Alternative resolutions (for fuzzy matches) */
  alternatives?: Array<{
    value: string
    confidence: number
    reasoning: string
  }>
}

export interface GroundingError {
  /** Assumption ID that failed */
  assumption_id: string

  /** Error type/code */
  error_type: string

  /** Error message */
  message: string

  /** Severity level */
  severity: 'error' | 'warning'

  /** Suggested fix */
  suggested_fix?: string
}

// ============================================================================
// Generation Result
// ============================================================================

export interface SemanticPlanGenerationResult {
  /** Success status */
  success: boolean

  /** Generated semantic plan */
  semantic_plan?: SemanticPlan

  /** Errors (if any) */
  errors?: string[]

  /** Warnings */
  warnings?: string[]

  /** Metadata */
  metadata?: {
    model: string
    tokens_used: number
    generation_time_ms: number
    confidence_score?: number
  }
}
