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
export type AgentStatus = 'draft' | 'active' | 'inactive' | 'deleted';

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
  connected_plugins?: Record<string, unknown> | null;
  input_schema?: unknown[] | null;
  output_schema?: unknown[] | null;
  user_prompt?: string | null;
  workflow_steps?: unknown[] | null;
}

export interface CreateAgentInput {
  user_id: string;
  agent_name: string;
  description?: string;
  config: Record<string, unknown>;
  status?: AgentStatus;
  schedule_cron?: string;
  timezone?: string;
}

export interface UpdateAgentInput {
  agent_name?: string;
  description?: string;
  config?: Record<string, unknown>;
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
  status: ExecutionStatus;
  started_at: string;
  completed_at?: string | null;
  execution_duration_ms?: number | null;
  logs?: ExecutionLogs | null;
  result?: Record<string, unknown> | null;
  error_message?: string | null;
  input_data?: Record<string, unknown> | null;
  output?: unknown;
  created_at?: string;
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
  user_prompt?: string | null;
  input_schema?: unknown[] | null;
  output_schema?: unknown[] | null;
  connected_plugins?: Record<string, unknown> | null;
  plugins_required?: string[] | null;
  workflow_steps?: unknown[] | null;
  mode?: string | null;
  shared_at: string;
  quality_score?: number | null;
  reliability_score?: number | null;
  efficiency_score?: number | null;
  adoption_score?: number | null;
  complexity_score?: number | null;
  score_calculated_at?: string | null;
  base_executions?: number | null;
  base_success_rate?: number | null;
}

export interface CreateSharedAgentInput {
  original_agent_id: string;
  user_id: string;
  agent_name: string;
  description?: string | null;
  user_prompt?: string | null;
  input_schema?: unknown[] | null;
  output_schema?: unknown[] | null;
  connected_plugins?: Record<string, unknown> | null;
  plugins_required?: string[] | null;
  workflow_steps?: unknown[] | null;
  mode?: string | null;
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