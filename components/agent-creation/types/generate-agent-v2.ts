/**
 * Types for generate-agent-v2 API
 * POST /api/generate-agent-v2
 *
 * This API uses AgentKit to generate agent configurations from user prompts.
 * Returns agent data for user review before saving.
 */

// ============================================
// INPUT TYPES
// ============================================

export interface GenerateAgentV2Request {
  prompt: string;
}

// ============================================
// AGENT DATA TYPES
// ============================================

/** Input field as analyzed from prompt (before hidden is added) */
export interface AnalyzedInputField {
  name: string;
  type: string;
  label: string;
  required: boolean;
  description: string;
  placeholder?: string;
}

/** Input field with hidden property (after processing) */
export interface AgentInputField extends AnalyzedInputField {
  placeholder: string;
  hidden: boolean; // Hidden by default - shown during Input Parameters step
}

export interface AgentOutputField {
  name: string;
  type: string;
  label?: string;
  description?: string;
}

/** All possible workflow step types from analysis */
export type WorkflowStepType =
  | 'plugin_action'
  | 'ai_processing'
  | 'conditional'
  | 'transform'
  | 'human_approval';

/** Workflow step as returned from analysis (before validation) */
export interface AnalyzedWorkflowStep {
  operation: string;
  plugin: string;
  plugin_action: string;
  params?: Record<string, any>;
  type?: WorkflowStepType;
}

/** Workflow step after validation (used in agent data) */
export interface WorkflowStep {
  operation: string;
  plugin: string;
  plugin_action: string;
  params: Record<string, any>;
  validated: boolean;
  type: 'plugin_action' | 'ai_processing';
}

export interface PilotStep {
  id: string;
  name: string;
  dependencies: string[];
  type: 'action' | 'ai_processing';
  plugin?: string;
  action?: string;
  prompt?: string;
  params: Record<string, any>;
}

export interface DetectedCategory {
  plugin: string;
  detected: boolean;
}

export interface TriggerConditions {
  error_handling: {
    on_failure: string;
    retry_on_fail: boolean;
  };
}

export interface AgentConfigMetadata {
  version: string;
  generation_method: string;
  agent_id: string;
  session_id: string;
  prompt_type: string;
  ai_generated_at: string;
  platform_version: string;
  analysis_confidence: number;
  workflow_type: string;
}

export interface AgentConfigAIContext {
  reasoning: string;
  confidence: number;
  workflow_type: string;
  generation_method: string;
  pilot_enabled: boolean;
  pilot_steps_generated: boolean;
}

export interface AgentConfig {
  mode: string;
  metadata: AgentConfigMetadata;
  timezone: string;
  agent_name: string;
  description: string;
  user_prompt: string;
  input_schema: AnalyzedInputField[]; // Raw inputs from analysis (no hidden)
  output_schema: AgentOutputField[];
  workflow_steps: AnalyzedWorkflowStep[]; // Raw steps from analysis
  pilot_steps: PilotStep[] | null;
  plugins_required: string[];
  connected_plugins: string[];
  system_prompt: string;
  ai_context: AgentConfigAIContext;
}

export interface GeneratedAgentData {
  user_id: string;
  agent_name: string;
  user_prompt: string;
  system_prompt: string;
  description: string;
  plugins_required: string[];
  connected_plugins: string[];
  input_schema: AgentInputField[];
  output_schema: AgentOutputField[];
  status: 'draft';
  mode: 'on_demand';
  schedule_cron: null;
  created_from_prompt: string;
  ai_reasoning: string;
  ai_confidence: number;
  ai_generated_at: string;
  workflow_steps: WorkflowStep[];
  pilot_steps: PilotStep[] | null;
  trigger_conditions: TriggerConditions;
  detected_categories: DetectedCategory[];
  agent_config: AgentConfig;
}

// ============================================
// RESPONSE TYPES
// ============================================

export interface ExtractionAnalysis {
  method: 'agentkit_direct_v3';
  confidence: number;
  workflow_type: string;
  reasoning: string;
  suggested_plugins: string[];
}

export interface ExtractionDetails {
  analysis: ExtractionAnalysis;
  workflow_steps: AnalyzedWorkflowStep[];
  activity_tracked: boolean;
  agentId: string;
  sessionId: string;
}

export interface GenerateAgentV2SuccessResponse {
  success: true;
  agent: GeneratedAgentData;
  agentId: string;
  sessionId: string;
  extraction_details: ExtractionDetails;
}

export interface GenerateAgentV2ErrorResponse {
  success?: false;
  error: string;
  message: string;
}

export type GenerateAgentV2Response =
  | GenerateAgentV2SuccessResponse
  | GenerateAgentV2ErrorResponse;

// ============================================
// CREATE AGENT TYPES
// ============================================

/** Provider + model that produced one generation step (Part B provenance). */
export interface GenerationModelRef {
  provider: string | null;
  model: string | null;
}

/**
 * Part B: which LLM produced each generation step. Persisted on
 * `creation_metadata.models` (no column equivalent — legitimately JSONB).
 * A step is `null` when its provenance is unavailable (e.g. legacy/V4 path).
 */
export interface CreationModels {
  enhanced_prompt: GenerationModelRef | null;
  agent_generation: GenerationModelRef | null;
}

/**
 * V6 pipeline creation telemetry (Option A, SA-approved 2026-07-14). Populated
 * on the V6 path only, from the V6 response `metadata`, into
 * `creation_metadata.v6_metadata`. No column equivalent — legitimately JSONB.
 * `phase_times_ms` is a verbatim passthrough (no hardcoded phase names). Null
 * sub-fields (e.g. `grounding_confidence` on pipeline A) are omitted, not stored.
 * See docs/requirements/AGENT_CONFIG_CREATION_TELEMETRY_REQUIREMENT.md.
 */
export interface V6CreationMetadata {
  architecture: string;
  total_time_ms: number;
  phase_times_ms: Record<string, number>;
  steps_generated: number;
  grounding_confidence?: number;
  formalization_confidence?: number;
}

/** Agent config metadata for create-agent API */
export interface CreateAgentConfigMetadata {
  session_id: string;
  thread_id: string;
  prompt_type: 'enhanced' | 'original';
  clarification_answers: Record<string, any>;
  version: string;
  platform_version: string;
  // A2 de-dup (SA-approved): the following mirror dedicated columns and are no
  // longer written on the lean V6 path — canonical: `ai_generated_at` column,
  // row `id`, and `user_prompt` column respectively. Kept OPTIONAL because the
  // legacy V4/SmartAgentBuilder paths still populate them, and for backward-compat.
  ai_generated_at?: string;
  agent_id?: string;
  enhanced_prompt_data?: any; // duplicates `user_prompt`; V4-legacy only going forward
  /** Part B: generation provenance (provider/model per step). Optional for
   *  backward-compat with agents created before it landed. */
  models?: CreationModels;
  /** A2 Option A: V6 pipeline creation telemetry (V6 path only). */
  v6_metadata?: V6CreationMetadata;
}

/**
 * AI context for create-agent API.
 *
 * A2 de-dup (SA-approved): the five narrative fields below mirror dedicated
 * top-level columns (`ai_reasoning`, `ai_confidence`, `created_from_prompt`,
 * `user_prompt`, `generated_plan`) and are NO LONGER WRITTEN on the lean V6 path
 * — read them via `getAgentAiContextView` (column-first). They stay OPTIONAL
 * because the legacy V4/SmartAgentBuilder paths still emit them. Only
 * `intent_contract`/`data_schema` (no column) are written on the V6 path.
 */
export interface CreateAgentAIContext {
  reasoning?: string;
  confidence?: number;
  original_prompt?: string;
  enhanced_prompt?: string;
  generated_plan?: string;
  /**
   * WP-55: Phase 1 raw IntentContract LLM output (Pipeline A only).
   * Persisted so post-hoc diagnosis of LLM emission variance becomes a
   * SQL lookup instead of a non-deterministic LLM re-run. Null for
   * agents created before WP-55 landed or via legacy generators.
   * See docs/v6/V6_DEVELOPER_GUIDE.md § "Diagnosing a Production
   * Agent's Phase 1 Emission".
   */
  intent_contract?: unknown | null;
  /**
   * WP-55: Phase 2 data_schema (slot schemas + semantic types built
   * from plugin definitions). Persisted alongside intent_contract for
   * the same diagnosis flow. Null for agents created before WP-55.
   */
  data_schema?: unknown | null;
}

/** Agent config for create-agent API */
export interface CreateAgentConfig {
  creation_metadata: CreateAgentConfigMetadata;
  ai_context: CreateAgentAIContext;
}

/** Complete agent data structure for create-agent API */
export interface CreateAgentData extends Omit<GeneratedAgentData, 'agent_config' | 'schedule_cron' | 'mode' | 'timezone' | 'status'> {
  agent_config: CreateAgentConfig;
  schedule_cron: string | null;
  timezone: string;
  mode: 'on_demand' | 'scheduled';
  status: 'draft';
}

/** Request payload for create-agent API */
export interface CreateAgentRequest {
  agent: CreateAgentData;
  sessionId: string;
  agentId: string;
}

// ============================================
// TYPE GUARDS
// ============================================

export function isGenerateAgentV2Success(
  response: GenerateAgentV2Response
): response is GenerateAgentV2SuccessResponse {
  return 'success' in response && response.success === true;
}

export function isGenerateAgentV2Error(
  response: GenerateAgentV2Response
): response is GenerateAgentV2ErrorResponse {
  return 'error' in response;
}
