// lib/client/agent-api.ts
// Client-side API service for agent operations
// Use this in 'use client' components instead of importing repositories directly

import { requestDeduplicator } from '@/lib/utils/request-deduplication'

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface Agent {
  id: string;
  user_id: string;
  agent_name: string;
  description?: string | null;
  status: string;
  config: Record<string, unknown>;
  mode?: string | null;
  schedule_cron?: string | null;
  timezone?: string | null;
  next_run_at?: string | null;
  plugins_required?: string[] | null;
  connected_plugins?: Record<string, unknown> | null;
  system_prompt?: string | null;
  user_prompt?: string | null;
  input_schema?: unknown[] | null;
  output_schema?: unknown[] | null;
  workflow_steps?: unknown[] | null;
  agent_config?: unknown;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  [key: string]: unknown;
}

interface Execution {
  id: string;
  agent_id: string;
  status: string;
  started_at?: string;
  completed_at?: string;
  tokens_used?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
  execution_logs?: unknown[];
  output?: unknown;
  error?: string;
  error_message?: string | null;
  logs?: Record<string, unknown>;
  [key: string]: unknown;
}

interface PluginRefreshResult {
  ready: string[];
  failed: string[];
}

// Helper to get auth headers
function getAuthHeaders(userId: string, token?: string): HeadersInit {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    'x-user-id': userId,
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

// Helper to get token from localStorage
function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const authData = localStorage.getItem('sb-auth-token');
    if (authData) {
      const parsed = JSON.parse(authData);
      return parsed.access_token || null;
    }
  } catch {
    // Ignore parse errors
  }
  return null;
}

export const agentApi = {
  /**
   * Get agent by ID
   * Also triggers automatic plugin token refresh for agent's required plugins
   */
  async getById(agentId: string, userId: string): Promise<ApiResponse<{ agent: Agent; pluginRefresh: PluginRefreshResult | null }>> {
    try {
      const token = getStoredToken();
      const response = await fetch(`/api/agents/${agentId}`, {
        method: 'GET',
        headers: getAuthHeaders(userId, token || undefined),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        return { success: false, error: data.error || 'Failed to fetch agent' };
      }

      return {
        success: true,
        data: {
          agent: data.agent,
          pluginRefresh: data.pluginRefresh || null,
        },
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Network error' };
    }
  },

  /**
   * Update agent
   */
  async update(agentId: string, userId: string, agentData: Partial<Agent>): Promise<ApiResponse<Agent>> {
    try {
      const token = getStoredToken();
      const response = await fetch(`/api/agents/${agentId}`, {
        method: 'PUT',
        headers: getAuthHeaders(userId, token || undefined),
        body: JSON.stringify({ agent: agentData }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        return { success: false, error: data.error || 'Failed to update agent' };
      }

      return { success: true, data: data.agent };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Network error' };
    }
  },

  /**
   * Delete agent (soft delete)
   */
  async delete(agentId: string, userId: string): Promise<ApiResponse<void>> {
    try {
      const token = getStoredToken();
      const response = await fetch(`/api/agents/${agentId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(userId, token || undefined),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        return { success: false, error: data.error || 'Failed to delete agent' };
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Network error' };
    }
  },

  /**
   * Update agent status (pause/activate)
   */
  async updateStatus(agentId: string, userId: string, status: 'active' | 'paused'): Promise<ApiResponse<Agent>> {
    try {
      const token = getStoredToken();
      const response = await fetch(`/api/agents/${agentId}/status`, {
        method: 'POST',
        headers: getAuthHeaders(userId, token || undefined),
        body: JSON.stringify({ status }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        return { success: false, error: data.error || 'Failed to update agent status' };
      }

      return { success: true, data: data.agent };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Network error' };
    }
  },

  /**
   * Duplicate agent
   */
  async duplicate(agentId: string, userId: string): Promise<ApiResponse<Agent>> {
    try {
      const token = getStoredToken();
      const response = await fetch(`/api/agents/${agentId}/duplicate`, {
        method: 'POST',
        headers: getAuthHeaders(userId, token || undefined),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        return { success: false, error: data.error || 'Failed to duplicate agent' };
      }

      return { success: true, data: data.agent };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Network error' };
    }
  },

  /**
   * Get agent executions
   * @param includeTokens - If true, enriches executions with token usage data from token_usage table
   */
  async getExecutions(agentId: string, userId: string, options?: { limit?: number; includeTokens?: boolean }): Promise<ApiResponse<Execution[]>> {
    // Create cache key based on parameters to deduplicate identical requests
    const cacheKey = `executions-${agentId}-${options?.includeTokens || false}-${options?.limit || 'all'}`

    return requestDeduplicator.deduplicate(
      cacheKey,
      async () => {
        try {
          const token = getStoredToken();
          const params = new URLSearchParams();
          if (options?.limit) params.set('limit', options.limit.toString());
          if (options?.includeTokens) params.set('includeTokens', 'true');

          const queryString = params.toString();
          const url = queryString
            ? `/api/agents/${agentId}/executions?${queryString}`
            : `/api/agents/${agentId}/executions`;

          const response = await fetch(url, {
            method: 'GET',
            headers: getAuthHeaders(userId, token || undefined),
          });

          const data = await response.json();

          if (!response.ok || !data.success) {
            return { success: false, error: data.error || 'Failed to fetch executions' };
          }

          return { success: true, data: data.executions };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : 'Network error' };
        }
      },
      5000 // 5 second cache TTL
    )
  },

  /**
   * Get memory count for agent
   * Uses request deduplication with 30s cache - memory count doesn't change often
   */
  async getMemoryCount(agentId: string, userId: string): Promise<ApiResponse<number>> {
    const cacheKey = `memory-count-${agentId}`

    return requestDeduplicator.deduplicate(
      cacheKey,
      async () => {
        try {
          const token = getStoredToken();
          const response = await fetch(`/api/agents/${agentId}/memory/count`, {
            method: 'GET',
            headers: getAuthHeaders(userId, token || undefined),
          });

          const data = await response.json();

          if (!response.ok || !data.success) {
            return { success: false, error: data.error || 'Failed to fetch memory count' };
          }

          return { success: true, data: data.count };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : 'Network error' };
        }
      },
      30000 // 30 second cache TTL - memory count doesn't change often
    )
  },
};

export const systemConfigApi = {
  /**
   * Get system config by category
   */
  async getByCategory(category: string): Promise<ApiResponse<Record<string, unknown>>> {
    try {
      const response = await fetch(`/api/system-config?category=${encodeURIComponent(category)}`);
      const data = await response.json();

      if (!response.ok || data.error) {
        return { success: false, error: data.error || 'Failed to fetch config' };
      }

      return { success: true, data: data.data };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Network error' };
    }
  },

  /**
   * Get specific config keys
   */
  async getByKeys(keys: string[]): Promise<ApiResponse<Record<string, unknown>>> {
    try {
      const response = await fetch(`/api/system-config?keys=${encodeURIComponent(keys.join(','))}`);
      const data = await response.json();

      if (!response.ok || data.error) {
        return { success: false, error: data.error || 'Failed to fetch config' };
      }

      return { success: true, data: data.data };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Network error' };
    }
  },

  /**
   * Get a numeric config value with default
   */
  async getNumber(key: string, defaultValue: number): Promise<number> {
    const result = await this.getByKeys([key]);
    if (result.success && result.data && result.data[key] !== undefined) {
      const value = Number(result.data[key]);
      return isNaN(value) ? defaultValue : value;
    }
    return defaultValue;
  },
};

export const sharedAgentApi = {
  /**
   * Check if agent is already shared
   */
  async existsByOriginalAgent(agentId: string, userId: string): Promise<ApiResponse<boolean>> {
    try {
      const token = getStoredToken();
      const response = await fetch(`/api/shared-agents/exists?agentId=${agentId}`, {
        method: 'GET',
        headers: getAuthHeaders(userId, token || undefined),
      });

      const data = await response.json();

      if (!response.ok) {
        return { success: false, error: data.error || 'Failed to check shared status' };
      }

      return { success: true, data: data.exists };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Network error' };
    }
  },

  /**
   * Share an agent
   * Agent data is copied from the original agent. Quality scores can be provided.
   */
  async share(agentId: string, userId: string, shareData?: {
    description?: string;
    // Quality scores (computed by client)
    quality_score?: number;
    reliability_score?: number;
    efficiency_score?: number;
    adoption_score?: number;
    complexity_score?: number;
    base_executions?: number;
    base_success_rate?: number;
  }): Promise<ApiResponse<{ id: string }>> {
    try {
      const token = getStoredToken();
      const response = await fetch('/api/shared-agents', {
        method: 'POST',
        headers: getAuthHeaders(userId, token || undefined),
        body: JSON.stringify({ agentId, ...shareData }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        return { success: false, error: data.error || 'Failed to share agent' };
      }

      return { success: true, data: { id: data.id } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Network error' };
    }
  },
};

export const metricsApi = {
  /**
   * Get basic metrics for an agent
   */
  async getBasicMetrics(agentId: string, userId: string): Promise<ApiResponse<{
    total_executions: number;
    successful_executions: number;
    failed_executions: number;
    avg_duration_ms?: number;
  }>> {
    try {
      const token = getStoredToken();
      const response = await fetch(`/api/agents/${agentId}/metrics`, {
        method: 'GET',
        headers: getAuthHeaders(userId, token || undefined),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        return { success: false, error: data.error || 'Failed to fetch metrics' };
      }

      return { success: true, data: data.metrics };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Network error' };
    }
  },
};