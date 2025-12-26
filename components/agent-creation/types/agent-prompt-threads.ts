/**
 * Types for agent_prompt_threads table
 * Represents thread state for agent creation flow (phases 1-4)
 * Supports multiple AI providers (OpenAI, Anthropic, Kimi)
 */

import type { ProviderName } from '@/lib/ai/providerFactory';

export type ThreadStatus = 'active' | 'expired' | 'completed' | 'abandoned';
export type ThreadPhase = 1 | 2 | 3 | 4;

// Re-export ProviderName for convenience
export type { ProviderName };

export interface AgentPromptThread {
  id: string; // UUID
  user_id: string; // UUID
  openai_thread_id: string;
  status: ThreadStatus;
  current_phase: ThreadPhase;
  agent_id: string | null; // UUID, nullable until agent is created
  ai_provider: ProviderName; // AI provider for this thread (cannot change after creation)
  ai_model: string; // AI model for this thread (cannot change after creation)
  created_at: string; // ISO timestamp
  updated_at: string; // ISO timestamp
  expires_at: string; // ISO timestamp
  metadata: ThreadMetadata;
}

/**
 * Cached Phase 3 response data for merging with Phase 4
 * These fields are saved after Phase 3 completes and used to construct the complete Phase 4 response
 */
export interface LastPhase3Response {
  analysis: AnalysisObject;
  requiredServices: string[];
  missingPlugins: string[];
  pluginWarning: Record<string, string>;
  clarityScore: number;
  enhanced_prompt: EnhancedPrompt;
}

export interface ThreadMetadata {
  user_prompt?: string;
  analysis?: AnalysisObject;
  connected_services?: string[]; // Simple array of plugin keys
  clarification_answers?: Record<string, any>;
  user_context?: UserContext;
  last_phase3_response?: LastPhase3Response; // Cached Phase 3 data for Phase 4 merge
  [key: string]: any; // Allow additional metadata
}

export interface UserContext {
  full_name?: string;
  email?: string;
  role?: string;
  company?: string;
  domain?: string;
}

export interface ConnectedService {
  name: string;
  context: string;
}

export interface AnalysisObject {
  data: AnalysisDimension;
  trigger?: AnalysisDimension; // Optional in Phase 3
  output: AnalysisDimension;
  actions: AnalysisDimension;
  delivery: AnalysisDimension;
  error_handling?: AnalysisDimension; // Optional in Phase 3
}

export type DimensionStatus = 'clear' | 'partial' | 'missing';

export interface AnalysisDimension {
  status: DimensionStatus;
  confidence: number; // 0-1, strictly validated at runtime
  detected: string; // Non-empty string
}

// Database insert/update types (omit generated fields)
export type CreateAgentPromptThread = Omit<
  AgentPromptThread,
  'id' | 'created_at' | 'updated_at'
> & {
  created_at?: string;
  updated_at?: string;
};

export type UpdateAgentPromptThread = Partial<
  Omit<AgentPromptThread, 'id' | 'user_id' | 'openai_thread_id' | 'ai_provider' | 'ai_model' | 'created_at'>
>;

// API Request/Response types
export interface InitThreadRequest {
  user_id?: string; // Optional, will be extracted from auth session
  ai_provider?: ProviderName; // Optional, defaults to 'openai'
  ai_model?: string; // Optional, defaults to provider's default model
}

export interface InitThreadResponse {
  success: boolean;
  thread_id: string;
  created_at: string;
  message: string;
}

/**
 * Schema service action definition for Phase 4
 */
export interface SchemaServiceAction {
  description: string;
  usage_context: string;
  parameters: Record<string, unknown>;
  output_schema?: Record<string, unknown>;
}

/**
 * Schema service definition for Phase 4
 */
export interface SchemaService {
  name: string;
  key: string;
  description: string;
  context: string;
  actions: Record<string, SchemaServiceAction>;
}

export interface ProcessMessageRequest {
  thread_id: string;
  phase: ThreadPhase;
  user_prompt?: string;  // Required for Phase 1
  user_context?: UserContext;
  analysis?: AnalysisObject | null;
  connected_services?: string[]; // Simple array of connected plugin keys
  available_services?: ConnectedService[]; // All plugins available in the system with full context
  clarification_answers?: Record<string, any>;
  enhanced_prompt?: EnhancedPrompt | null; // Phase 2/3/4: Previous Phase 3 output for refinement
  declined_services?: string[]; // V10: Services user explicitly refused to connect (top-level)
  user_feedback?: string; // V10: Free-form user feedback for refinement (mini-cycle mode)
  schema_services?: Record<string, SchemaService>; // Phase 4: Full service definitions for technical workflow
  technical_inputs_collected?: Record<string, string>; // Phase 4: User-provided technical inputs (re-run)
  ai_provider?: ProviderName; // Optional, override thread's provider for this call
  ai_model?: string; // Optional, override thread's model for this call
  metadata?: {
    declined_plugins?: string[]; // Deprecated: use declined_services instead
    [key: string]: any; // Allow additional metadata
  };
}

export interface ProcessMessageResponse {
  success: boolean;
  phase: ThreadPhase;

  // Phase 1 specific fields (diagnostic narrative)
  workflow_draft?: string[];
  entities_detected?: string[];
  sources_detected?: string[];
  operations_detected?: string[];
  outputs_detected?: string[];
  delivery_detected?: string[];
  ambiguities?: string[];
  choices_identified?: Record<string, string[]>;
  serviceConfidenceNotes?: Record<string, string>;
  user_inputs_required?: string[];  // Labels for inputs still missing (Phase 1 top-level)
  resolved_user_inputs?: ResolvedUserInput[];  // Phase 1 top-level resolved inputs

  // Phase 1 & 2 shared fields
  analysis?: AnalysisObject;
  questionsSequence?: ClarificationQuestion[];
  needsClarification?: boolean;
  clarityScore?: number;
  suggestions?: string[];
  connectedPlugins?: string[]; // Phase 1: List of user's connected plugin keys (e.g., ['google-mail', 'slack'])

  // Phase 2 specific fields
  workflow_refined_preview?: string[];

  // Phase 3 specific fields
  enhanced_prompt?: EnhancedPrompt;
  requiredServices?: string[];
  missingPlugins?: string[];
  pluginWarning?: Record<string, string>; // Changed from Record<string, any>
  error?: string; // Phase 3: Error message if workflow impossible (e.g., no alternatives for declined plugin)
  // Note: ready_for_generation is ONLY in metadata.ready_for_generation, not at top level

  // Phase 4 specific fields
  technical_workflow?: TechnicalWorkflowStep[];
  technical_inputs_required?: TechnicalInputRequired[];
  feasibility?: Feasibility;

  // All Phases
  conversationalSummary?: string; // LLM-generated friendly summary of understanding/progress

  // Strictly typed metadata (no arbitrary keys) - Phase 4 uses Phase4Metadata
  metadata?: Phase3Metadata | Phase4Metadata;
}

export interface ClarificationQuestion {
  id: string;
  dimension?: 'data' | 'trigger' | 'output' | 'actions' | 'delivery' | 'error_handling'; // v7 and below
  theme?: string; // v8: Inputs, Processing, Outputs, Delivery
  question: string;
  type: 'select' | 'text' | 'email' | 'number';
  options?: ClarificationOption[];
  allowCustom?: boolean;
  required?: boolean;
  depends_on?: string[];
  placeholder?: string;
}

export interface ClarificationOption {
  value: string;
  label: string;
  description?: string;
}

export interface EnhancedPromptSections {
  data: string[];              // Array of bullet points
  actions: string[];           // Array of bullet points
  output: string[];            // Array of bullet points
  delivery: string[];          // Array of bullet points
  processing_steps?: string[]; // Optional - v7 compatibility
}

/**
 * V10: Resolved user input tracking
 * Represents inputs that were previously in user_inputs_required but now have values
 */
export interface ResolvedUserInput {
  key: string;    // Machine-friendly key (e.g., "accountant_email", "user_email")
  value: string;  // Resolved value (e.g., "bob@company.com")
}

export interface EnhancedPromptSpecifics {
  services_involved: string[];
  user_inputs_required: string[];  // Labels for inputs still missing
  resolved_user_inputs?: ResolvedUserInput[];  // V10: Previously required inputs that now have values
}

export interface EnhancedPrompt {
  plan_title: string;
  plan_description: string;
  sections: EnhancedPromptSections;
  specifics: EnhancedPromptSpecifics;
}

/**
 * Strict metadata for Phase 3 responses
 * All fields explicitly defined, no arbitrary keys
 */
export interface Phase3Metadata {
  all_clarifications_applied: boolean;
  ready_for_generation: boolean;
  confirmation_needed: boolean;
  implicit_services_detected: string[];
  provenance_checked: boolean;
  provenance_note?: string;
  declined_plugins_blocking?: string[];
  oauth_required?: boolean;
  oauth_message?: string;
  plugins_adjusted?: string[];
  adjustment_reason?: string;
  reason?: string;
}

/**
 * Phase 4 specific metadata extension
 */
export interface Phase4MetadataExtension {
  can_execute: boolean;
  needs_technical_inputs: boolean;
  needs_user_feedback: boolean;
}

/**
 * Strict metadata for Phase 4 responses
 * Extends Phase 3 metadata with Phase 4 specific fields
 */
export interface Phase4Metadata extends Phase3Metadata {
  phase4: Phase4MetadataExtension;
}

/**
 * Technical workflow step input source
 */
export type StepInputSource = 'constant' | 'from_step' | 'user_input' | 'env' | 'plugin_config';

/**
 * Technical workflow step input parameter
 */
export interface StepInput {
  source: StepInputSource;
  value?: any;           // For 'constant' source
  ref?: string;          // For 'from_step' source (e.g., "step1.messages")
  key?: string;          // For 'user_input' source
  plugin?: string;       // For 'user_input' source - which plugin needs this
  action?: string;       // Optional - which action consumes this
}

/**
 * Operation step - maps to a real plugin action
 */
export interface OperationStep {
  id: string;
  kind: 'operation';
  description: string;
  plugin: string;
  action: string;
  inputs: Record<string, StepInput>;
  outputs: Record<string, string>;
}

/**
 * Deterministic transform types (no LLM required)
 */
export const DeterministicTransformTypes = [
  'filter', 'map', 'sort', 'group_by', 'aggregate', 'reduce',
  'deduplicate', 'flatten', 'pick_fields', 'format', 'merge', 'split', 'convert',
] as const;

/**
 * LLM-assisted transform types (requires AI processing)
 */
export const LLMAssistedTransformTypes = [
  'summarize_with_llm', 'classify_with_llm', 'extract_with_llm',
  'analyze_with_llm', 'generate_with_llm', 'translate_with_llm', 'enrich_with_llm',
] as const;

/**
 * All allowed transform types
 */
export type DeterministicTransformType = typeof DeterministicTransformTypes[number];
export type LLMAssistedTransformType = typeof LLMAssistedTransformTypes[number];
export type TransformType = DeterministicTransformType | LLMAssistedTransformType;

/**
 * Transform step - data transformation (e.g., LLM processing, filtering)
 * v14: Transform steps MUST include a top-level `type` field from the allowed transform types
 */
export interface TransformStep {
  id: string;
  kind: 'transform';
  type: TransformType;  // v14: Required - must be one of the allowed transform types
  description: string;
  plugin?: string;    // Optional - used when transform is a plugin call (e.g., chatgpt-research)
  action?: string;    // Optional - used when transform is a plugin call
  inputs?: Record<string, StepInput>;
  outputs?: Record<string, string>;
}

/**
 * Control step - conditional logic, loops, etc.
 */
export interface ControlStep {
  id: string;
  kind: 'control';
  description?: string;
  control?: {
    type: string;
    condition: string;
  };
  plugin?: string;    // Optional - for compatibility
  action?: string;    // Optional - for compatibility
  inputs?: Record<string, StepInput>;
  outputs?: Record<string, string>;
}

/**
 * Union of all technical workflow step types
 */
export type TechnicalWorkflowStep = OperationStep | TransformStep | ControlStep;

/**
 * Technical input required from user (Phase 4)
 */
export interface TechnicalInputRequired {
  key: string;              // Machine-friendly identifier (e.g., "slack_channel_id")
  plugin: string;           // Which plugin needs this input
  actions?: string[];       // Which actions use this input
  type?: string;            // Suggested UI type (string, fileId, folderId)
  description: string;      // Human-friendly description for UI
}

/**
 * Blocking issue in feasibility check
 */
export interface BlockingIssue {
  type: string;            // e.g., "missing_plugin", "missing_operation", "unsupported_pattern"
  description: string;     // Human-readable description
}

/**
 * Warning in feasibility check (non-blocking)
 */
export interface FeasibilityWarning {
  type: string;            // e.g., "assumption", "expensive_operation", "data_shape"
  description: string;
}

/**
 * Feasibility assessment for the technical workflow
 */
export interface Feasibility {
  can_execute: boolean;
  blocking_issues: BlockingIssue[];
  warnings: FeasibilityWarning[];
}

// Thread resume response type
export interface ThreadResumeResponse {
  success: boolean;
  thread: AgentPromptThread;
  messages: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    created_at: number;
  }>;
}

// Error response type
export interface ThreadErrorResponse {
  success: false;
  error: string;
  phase?: ThreadPhase;
  details?: string;
}
