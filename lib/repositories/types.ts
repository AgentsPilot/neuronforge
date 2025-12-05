// lib/repositories/types.ts
// Type definitions for repository layer

/**
 * Enum for agent statuses
 */
export enum AgentStatusEnum {
  DRAFT = 'draft',
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

// Type alias for flexibility (can use enum values or string literals)
export type AgentStatus = 'draft' | 'active' | 'inactive';

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

export interface AgentRepositoryResult<T> {
  data: T | null;
  error: Error | null;
}

// Status transition rules
export const STATUS_TRANSITIONS: Record<AgentStatus, AgentStatus[]> = {
  draft: ['active'],        // Draft can only become active
  active: ['inactive'],     // Active can only be paused
  inactive: ['active'],     // Inactive can be reactivated
};