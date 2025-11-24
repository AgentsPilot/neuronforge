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

/** Agent config metadata for create-agent API */
export interface CreateAgentConfigMetadata {
  ai_generated_at: string;
  session_id: string;
  agent_id: string;
  thread_id: string;
  prompt_type: 'enhanced' | 'original';
  clarification_answers: Record<string, any>;
  version: string;
  platform_version: string;
  enhanced_prompt_data: any; // V9 structured data
}

/** AI context for create-agent API */
export interface CreateAgentAIContext {
  reasoning: string;
  confidence: number;
  original_prompt: string;
  enhanced_prompt: string;
  generated_plan: string;
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
