/**
 * UserMemoryContextBuilder
 *
 * Builds rich user context from memory for V6 pipeline injection.
 * Aggregates user preferences, successful patterns, and recurring errors
 * to personalize agent generation.
 *
 * Part of Phase 2: Personalization (Memory System Enhancement)
 *
 * @module lib/memory/UserMemoryContextBuilder
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ service: 'UserMemoryContextBuilder' });

// ============ Types ============

export interface UserMemoryContext {
  // User preferences from user_memory table
  preferences: {
    timezone?: string;
    communication_style?: string;
    preferred_plugins?: string[];
    notification_preferences?: Record<string, string>;
  };

  // Aggregated from successful agents
  workflow_patterns: {
    common_plugin_sequences: string[][];
    avg_workflow_complexity: number;
    most_used_plugins: Array<{ plugin: string; usage_count: number }>;
  };

  // From run_memories patterns
  execution_insights: {
    recurring_errors: Array<{ error: string; frequency: number }>;
    successful_patterns: string[];
    performance_preferences?: string;
  };

  // From agents table
  agent_context: {
    total_agents: number;
    active_agents: number;
    common_triggers: Record<string, number>;
  };

  // Metadata
  meta: {
    built_at: string;
    memories_used: number;
    agents_analyzed: number;
  };
}

export interface BuildOptions {
  maxMemories?: number;
  includeWorkflowPatterns?: boolean;
  includeExecutionInsights?: boolean;
  includeAgentContext?: boolean;
}

const DEFAULT_OPTIONS: BuildOptions = {
  maxMemories: 10,
  includeWorkflowPatterns: true,
  includeExecutionInsights: true,
  includeAgentContext: true,
};

// ============ Service ============

export class UserMemoryContextBuilder {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Build comprehensive user memory context for V6 pipeline
   *
   * Call this before V6 generation to inject personalized context.
   */
  async build(
    userId: string,
    options: BuildOptions = {}
  ): Promise<UserMemoryContext> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const startTime = Date.now();

    logger.debug({ userId }, 'Building user memory context');

    try {
      // Run queries in parallel for speed
      const [preferences, workflowPatterns, executionInsights, agentContext] =
        await Promise.all([
          this.fetchUserPreferences(userId, opts.maxMemories!),
          opts.includeWorkflowPatterns
            ? this.analyzeWorkflowPatterns(userId)
            : Promise.resolve(this.emptyWorkflowPatterns()),
          opts.includeExecutionInsights
            ? this.analyzeExecutionInsights(userId)
            : Promise.resolve(this.emptyExecutionInsights()),
          opts.includeAgentContext
            ? this.fetchAgentContext(userId)
            : Promise.resolve(this.emptyAgentContext()),
        ]);

      const context: UserMemoryContext = {
        preferences,
        workflow_patterns: workflowPatterns,
        execution_insights: executionInsights,
        agent_context: agentContext,
        meta: {
          built_at: new Date().toISOString(),
          memories_used: Object.keys(preferences).length,
          agents_analyzed: agentContext.total_agents,
        },
      };

      const duration = Date.now() - startTime;
      logger.info(
        { userId, duration, memoriesUsed: context.meta.memories_used },
        'User memory context built'
      );

      return context;
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to build user memory context');
      return this.emptyContext();
    }
  }

  /**
   * Format context for injection into V6 EnhancedPrompt
   *
   * Returns a string suitable for system prompt injection.
   */
  formatForV6Prompt(context: UserMemoryContext): string {
    const lines: string[] = [];

    // User preferences
    if (Object.keys(context.preferences).length > 0) {
      lines.push('## User Preferences');
      if (context.preferences.timezone) {
        lines.push(`- Timezone: ${context.preferences.timezone}`);
      }
      if (context.preferences.communication_style) {
        lines.push(`- Communication style: ${context.preferences.communication_style}`);
      }
      if (context.preferences.preferred_plugins?.length) {
        lines.push(
          `- Preferred plugins: ${context.preferences.preferred_plugins.join(', ')}`
        );
      }
    }

    // Workflow patterns
    if (context.workflow_patterns.most_used_plugins.length > 0) {
      lines.push('');
      lines.push('## Workflow Patterns');
      const topPlugins = context.workflow_patterns.most_used_plugins
        .slice(0, 5)
        .map((p) => p.plugin);
      lines.push(`- Most used plugins: ${topPlugins.join(', ')}`);
      if (context.workflow_patterns.avg_workflow_complexity > 0) {
        lines.push(
          `- Typical workflow complexity: ${context.workflow_patterns.avg_workflow_complexity.toFixed(1)} steps`
        );
      }
    }

    // Execution insights
    if (context.execution_insights.recurring_errors.length > 0) {
      lines.push('');
      lines.push('## Known Issues to Avoid');
      for (const error of context.execution_insights.recurring_errors.slice(0, 3)) {
        lines.push(`- ${error.error} (occurred ${error.frequency}x)`);
      }
    }

    if (context.execution_insights.successful_patterns.length > 0) {
      lines.push('');
      lines.push('## Successful Patterns');
      for (const pattern of context.execution_insights.successful_patterns.slice(0, 3)) {
        lines.push(`- ${pattern}`);
      }
    }

    return lines.length > 0 ? lines.join('\n') : '';
  }

  /**
   * Build a minimal context object for EnhancedPrompt.user_context
   */
  buildForEnhancedPrompt(
    context: UserMemoryContext,
    originalRequest: string,
    clarifications?: Record<string, string>
  ): {
    original_request: string;
    clarifications?: Record<string, string>;
    user_preferences?: string;
    preferred_plugins?: string[];
    workflow_hints?: string[];
  } {
    const result: any = {
      original_request: originalRequest,
    };

    if (clarifications && Object.keys(clarifications).length > 0) {
      result.clarifications = clarifications;
    }

    // Add user preferences as summary
    const prefSummary: string[] = [];
    if (context.preferences.timezone) {
      prefSummary.push(`timezone: ${context.preferences.timezone}`);
    }
    if (context.preferences.communication_style) {
      prefSummary.push(`style: ${context.preferences.communication_style}`);
    }
    if (prefSummary.length > 0) {
      result.user_preferences = prefSummary.join(', ');
    }

    // Add preferred plugins
    if (context.preferences.preferred_plugins?.length) {
      result.preferred_plugins = context.preferences.preferred_plugins;
    }

    // Add workflow hints from successful patterns
    if (context.execution_insights.successful_patterns.length > 0) {
      result.workflow_hints = context.execution_insights.successful_patterns.slice(0, 3);
    }

    return result;
  }

  // ============ Private Fetchers ============

  private async fetchUserPreferences(
    userId: string,
    limit: number
  ): Promise<UserMemoryContext['preferences']> {
    try {
      const { data, error } = await this.supabase
        .from('user_memory')
        .select('memory_key, memory_value, memory_type')
        .eq('user_id', userId)
        .order('importance', { ascending: false })
        .limit(limit);

      if (error || !data) {
        return {};
      }

      const preferences: UserMemoryContext['preferences'] = {};

      for (const mem of data) {
        switch (mem.memory_key) {
          case 'timezone':
            preferences.timezone = mem.memory_value;
            break;
          case 'communication_style':
            preferences.communication_style = mem.memory_value;
            break;
          case 'preferred_plugins':
            try {
              preferences.preferred_plugins = JSON.parse(mem.memory_value);
            } catch {
              preferences.preferred_plugins = [mem.memory_value];
            }
            break;
          default:
            // Store other preferences in a generic way
            if (mem.memory_key.includes('notification')) {
              preferences.notification_preferences =
                preferences.notification_preferences || {};
              preferences.notification_preferences[mem.memory_key] = mem.memory_value;
            }
        }
      }

      return preferences;
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch user preferences');
      return {};
    }
  }

  private async analyzeWorkflowPatterns(
    userId: string
  ): Promise<UserMemoryContext['workflow_patterns']> {
    try {
      // Get agent workflow data
      const { data: agents, error } = await this.supabase
        .from('agents')
        .select('workflow, status')
        .eq('user_id', userId)
        .neq('status', 'deleted')
        .limit(50);

      if (error || !agents) {
        return this.emptyWorkflowPatterns();
      }

      // Analyze plugin usage
      const pluginCounts: Record<string, number> = {};
      const stepCounts: number[] = [];

      for (const agent of agents) {
        if (!agent.workflow?.steps) continue;

        stepCounts.push(agent.workflow.steps.length);

        for (const step of agent.workflow.steps) {
          const plugin = step.plugin || step.type;
          if (plugin) {
            pluginCounts[plugin] = (pluginCounts[plugin] || 0) + 1;
          }
        }
      }

      const mostUsedPlugins = Object.entries(pluginCounts)
        .map(([plugin, count]) => ({ plugin, usage_count: count }))
        .sort((a, b) => b.usage_count - a.usage_count)
        .slice(0, 10);

      const avgComplexity =
        stepCounts.length > 0
          ? stepCounts.reduce((a, b) => a + b, 0) / stepCounts.length
          : 0;

      return {
        common_plugin_sequences: [], // TODO: Extract actual sequences
        avg_workflow_complexity: avgComplexity,
        most_used_plugins: mostUsedPlugins,
      };
    } catch (error) {
      logger.error({ err: error }, 'Failed to analyze workflow patterns');
      return this.emptyWorkflowPatterns();
    }
  }

  private async analyzeExecutionInsights(
    userId: string
  ): Promise<UserMemoryContext['execution_insights']> {
    try {
      // Get recent run memories with patterns
      const { data: memories, error } = await this.supabase
        .from('run_memories')
        .select('patterns_detected, sentiment, suggestions')
        .eq('user_id', userId)
        .order('run_timestamp', { ascending: false })
        .limit(100);

      if (error || !memories) {
        return this.emptyExecutionInsights();
      }

      // Aggregate recurring errors
      const errorCounts: Record<string, number> = {};
      const successPatterns: string[] = [];

      for (const mem of memories) {
        if (mem.patterns_detected?.recurring_error) {
          const err = mem.patterns_detected.recurring_error;
          errorCounts[err] = (errorCounts[err] || 0) + 1;
        }
        if (mem.patterns_detected?.success_pattern) {
          successPatterns.push(mem.patterns_detected.success_pattern);
        }
      }

      const recurringErrors = Object.entries(errorCounts)
        .map(([error, frequency]) => ({ error, frequency }))
        .filter((e) => e.frequency >= 2) // Only errors that occurred 2+ times
        .sort((a, b) => b.frequency - a.frequency)
        .slice(0, 5);

      // Deduplicate success patterns
      const uniqueSuccessPatterns = [...new Set(successPatterns)].slice(0, 5);

      return {
        recurring_errors: recurringErrors,
        successful_patterns: uniqueSuccessPatterns,
      };
    } catch (error) {
      logger.error({ err: error }, 'Failed to analyze execution insights');
      return this.emptyExecutionInsights();
    }
  }

  private async fetchAgentContext(
    userId: string
  ): Promise<UserMemoryContext['agent_context']> {
    try {
      const { data: agents, error } = await this.supabase
        .from('agents')
        .select('status, trigger_type')
        .eq('user_id', userId)
        .neq('status', 'deleted');

      if (error || !agents) {
        return this.emptyAgentContext();
      }

      const triggerCounts: Record<string, number> = {};
      let activeCount = 0;

      for (const agent of agents) {
        if (agent.status === 'active') activeCount++;
        if (agent.trigger_type) {
          triggerCounts[agent.trigger_type] =
            (triggerCounts[agent.trigger_type] || 0) + 1;
        }
      }

      return {
        total_agents: agents.length,
        active_agents: activeCount,
        common_triggers: triggerCounts,
      };
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch agent context');
      return this.emptyAgentContext();
    }
  }

  // ============ Empty Defaults ============

  private emptyWorkflowPatterns(): UserMemoryContext['workflow_patterns'] {
    return {
      common_plugin_sequences: [],
      avg_workflow_complexity: 0,
      most_used_plugins: [],
    };
  }

  private emptyExecutionInsights(): UserMemoryContext['execution_insights'] {
    return {
      recurring_errors: [],
      successful_patterns: [],
    };
  }

  private emptyAgentContext(): UserMemoryContext['agent_context'] {
    return {
      total_agents: 0,
      active_agents: 0,
      common_triggers: {},
    };
  }

  private emptyContext(): UserMemoryContext {
    return {
      preferences: {},
      workflow_patterns: this.emptyWorkflowPatterns(),
      execution_insights: this.emptyExecutionInsights(),
      agent_context: this.emptyAgentContext(),
      meta: {
        built_at: new Date().toISOString(),
        memories_used: 0,
        agents_analyzed: 0,
      },
    };
  }
}

// Singleton factory
let _instance: UserMemoryContextBuilder | null = null;
let _lastSupabase: SupabaseClient | null = null;

export function getUserMemoryContextBuilder(
  supabase: SupabaseClient
): UserMemoryContextBuilder {
  if (!_instance || _lastSupabase !== supabase) {
    _instance = new UserMemoryContextBuilder(supabase);
    _lastSupabase = supabase;
  }
  return _instance;
}
