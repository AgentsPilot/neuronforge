// lib/repositories/types.ts
// Type definitions for repository layer

/**
 * Enum for agent statuses
 */
export enum AgentStatusEnum {
  DRAFT = 'draft',
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  DELETED = 'deleted',
}

// Type alias for flexibility (can use enum values or string literals)
export type AgentStatus = 'draft' | 'active' | 'inactive' | 'deleted' | 'archived';

// Post-creation background-calibration gate state (Phase 2). NULL on the agent
// row means legacy/pre-existing — interpreted at read-time as deferred.
export type CalibrationGateStatus = 'running' | 'passed' | 'failed' | 'skipped';

export interface Agent {
  id: string;
  user_id: string;
  agent_name: string;
  description?: string | null;
  status: AgentStatus;
  config: Record<string, unknown>;
  schedule_cron?: string | null;
  timezone?: string | null;
  next_run_at?: string | null;
  deactivation_reason?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  // Additional fields used in agent detail page
  mode?: string | null;
  plugins_required?: string[] | null;
  connected_plugins?: unknown[] | Record<string, unknown> | null;
  input_schema?: unknown[] | null;
  output_schema?: unknown[] | null;
  user_prompt?: string | null;
  workflow_steps?: unknown[] | null;
  // Additional fields used in agent execution
  pilot_steps?: unknown[] | null;
  pilot_steps_original?: unknown[] | null; // Original workflow before calibration - never modified after first set
  system_prompt?: string | null;
  enhanced_prompt?: string | null;
  trigger_condintion?: Record<string, unknown> | null;
  // Intelligence features
  insights_enabled?: boolean;
  production_ready?: boolean;
  // Calibration state
  is_calibrated?: boolean;
  last_successful_calibration_id?: string | null;
  calibration_prompt_decision?: 'accepted' | 'declined' | null;
  calibration_prompt_decided_at?: string | null;
  // Post-creation background-calibration gate (Phase 2)
  calibration_status?: CalibrationGateStatus | null;
  // Business intelligence context
  workflow_purpose?: string | null;
  // ROI tracking - estimated time saved per item automated (in seconds)
  manual_time_per_item_seconds?: number | null;
  // Creation metadata + AI context (JSONB column populated at agent creation time;
  // shape matches CreateAgentInput.agent_config — creation_metadata + ai_context)
  agent_config?: Record<string, unknown> | null;
  // AI generation timestamp (separate from created_at — when the AI generated
  // the workflow, not when the DB row was inserted)
  ai_generated_at?: string | null;
  // Workflow scheduling / runtime metadata
  ai_reasoning?: string | null;
  ai_confidence?: number | null;
  trigger_conditions?: Record<string, unknown> | null;
  detected_categories?: unknown | null;
  generated_plan?: unknown | null;
  created_from_prompt?: string | null;
}

export interface CreateAgentInput {
  // Identity
  id?: string;                                   // optional explicit ID (frontend-provided for token-tracking consistency)
  user_id: string;
  agent_name: string;
  description?: string | null;

  // Prompts
  user_prompt?: string | null;
  system_prompt?: string | null;
  created_from_prompt?: string | null;

  // Schema / I/O
  input_schema?: unknown[] | null;
  output_schema?: unknown[] | null;

  // Plugins / execution
  plugins_required?: string[] | null;
  connected_plugins?: unknown[] | Record<string, unknown> | null;
  workflow_steps?: unknown[] | null;
  pilot_steps?: unknown[] | null;
  generated_plan?: unknown | null;
  detected_categories?: unknown | null;
  trigger_conditions?: Record<string, unknown> | null;

  // AI / creation metadata
  ai_reasoning?: string | null;
  ai_confidence?: number | null;
  ai_generated_at?: string | null;
  agent_config?: Record<string, unknown> | null;  // JSONB: creation_metadata + ai_context

  // Lifecycle / scheduling
  status?: AgentStatus;
  mode?: string | null;
  schedule_cron?: string | null;
  timezone?: string | null;

  // Legacy / wider Agent fields (kept for forward-compat — repository spreads input directly)
  config?: Record<string, unknown>;
}

export interface UpdateAgentInput {
  agent_name?: string;
  description?: string;
  config?: Record<string, unknown>;
  // Added 2026-06-10 (Effort Estimator cycle, Risk #3 option-a): allow
  // writes of the JSONB `agent_config` column via the repository so the
  // estimator's read-modify-write can stay on the repository layer instead
  // of falling back to a direct Supabase call. `AgentRepository.update`
  // already spreads input directly into the Supabase update, so no impl
  // change is needed — this is purely a type extension.
  agent_config?: Record<string, unknown> | null;
  schedule_cron?: string | null;
  timezone?: string | null;
}

export interface UpdateAgentDetailsInput {
  agent_name?: string;
  description?: string | null;
  schedule_cron?: string | null;
  mode?: 'on_demand' | 'scheduled';
  timezone?: string | null;
}

export interface AgentRepositoryResult<T> {
  data: T | null;
  error: Error | null;
}

// Status transition rules
export const STATUS_TRANSITIONS: Record<AgentStatus, AgentStatus[]> = {
  draft: ['active', 'deleted'],      // Draft can activate or be deleted
  active: ['inactive', 'deleted'],   // Active can be paused or deleted
  inactive: ['active', 'deleted'],   // Inactive can be reactivated or deleted
  deleted: [],                        // Terminal state - only restore() bypasses this
  archived: [],                       // Archived agents cannot transition
};

// ============ Execution Types ============

export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'success' | 'error';

export interface ExecutionTokensUsed {
  total?: number;
  prompt?: number;
  completion?: number;
  adjusted?: number;
  intensityMultiplier?: number;
  intensityScore?: number;
  _source?: string;
}

export interface ExecutionLogs {
  tokensUsed?: ExecutionTokensUsed;
  pilot?: boolean;
  agentkit?: boolean;
  model?: string;
  provider?: string;
  iterations?: number;
  toolCalls?: unknown[];
  executionId?: string;
  stepsCompleted?: number;
  stepsFailed?: number;
  stepsSkipped?: number;
  totalSteps?: number;
  inputValuesUsed?: number;
  [key: string]: unknown; // Allow additional properties
}

export interface Execution {
  id: string;
  agent_id: string;
  user_id?: string;
  execution_type?: 'manual' | 'scheduled';
  status: ExecutionStatus;
  scheduled_at?: string;
  started_at: string;
  completed_at?: string | null;
  execution_duration_ms?: number | null;
  logs?: ExecutionLogs | null;
  result?: Record<string, unknown> | null;
  error_message?: string | null;
  input_data?: Record<string, unknown> | null;
  output?: unknown;
  cron_expression?: string | null;
  progress?: number;
  retry_count?: number;
  created_at?: string;
}

// Lightweight execution record for status polling (GET handler)
export interface ExecutionStatusRecord {
  id: string;
  agent_id: string;
  execution_type?: 'manual' | 'scheduled';
  status: ExecutionStatus;
  progress?: number;
  scheduled_at?: string;
  started_at?: string;
  completed_at?: string | null;
  error_message?: string | null;
  execution_duration_ms?: number | null;
  retry_count?: number;
}

export interface TokenUsage {
  id: string;
  execution_id: string;
  input_tokens: number;
  output_tokens: number;
  activity_type: string;
}

// ============ Shared Agent Types ============

export interface SharedAgent {
  id: string;
  original_agent_id: string;
  user_id: string;
  agent_name: string;
  description?: string | null;
  system_prompt?: string | null;
  user_prompt: string;
  input_schema?: unknown | null;
  output_schema?: unknown | null;
  plugins_required?: string[] | null;
  workflow_steps?: unknown | null;
  mode?: string | null;
  generated_plan?: string | null;
  ai_reasoning?: string | null;
  ai_confidence?: number | null;
  detected_categories?: string[] | null;
  created_from_prompt?: string | null;
  ai_generated_at?: string | null;
  connected_plugins?: unknown[] | Record<string, unknown> | null;
  shared_at: string;
  created_at?: string | null;
  updated_at?: string | null;
  import_count?: number | null;
  average_score?: number | null;
  total_ratings?: number | null;
  quality_score?: number | null;
  reliability_score?: number | null;
  efficiency_score?: number | null;
  adoption_score?: number | null;
  complexity_score?: number | null;
  last_imported_at?: string | null;
  score_calculated_at?: string | null;
  base_executions?: number | null;
  base_success_rate?: number | null;
}

export interface CreateSharedAgentInput {
  original_agent_id: string;
  user_id: string;
  agent_name: string;
  description?: string | null;
  system_prompt?: string | null;
  user_prompt: string;
  input_schema?: unknown | null;
  output_schema?: unknown | null;
  plugins_required?: string[] | null;
  workflow_steps?: unknown | null;
  mode?: string | null;
  generated_plan?: string | null;
  ai_reasoning?: string | null;
  ai_confidence?: number | null;
  detected_categories?: string[] | null;
  created_from_prompt?: string | null;
  ai_generated_at?: string | null;
  connected_plugins?: unknown[] | Record<string, unknown> | null;
  quality_score?: number | null;
  reliability_score?: number | null;
  efficiency_score?: number | null;
  adoption_score?: number | null;
  complexity_score?: number | null;
  base_executions?: number | null;
  base_success_rate?: number | null;
}

// ============ Agent Metrics Types ============

export interface AgentMetrics {
  agent_id: string;
  user_id: string;
  success_rate: number;
  total_executions: number;
  avg_execution_time_ms?: number | null;
  last_execution_at?: string | null;
}

// ============ Config Types ============

export interface SystemConfig {
  config_key: string;
  config_value: string;
}

export interface RewardConfig {
  reward_key: string;
  credits_amount: number;
  is_active: boolean;
}

export interface SystemSettingsConfig {
  id: string;
  key: string;
  value: any; // JSONB can be any type
  category: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  updated_by?: string | null;
}