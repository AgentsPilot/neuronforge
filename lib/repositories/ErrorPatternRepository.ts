/**
 * ErrorPatternRepository
 *
 * Data access layer for error_patterns table.
 * Tracks recurring error patterns per agent for auto-recovery learning.
 *
 * Part of Phase 1: Error Learning (Memory System Enhancement)
 *
 * @module lib/repositories/ErrorPatternRepository
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, Logger } from '@/lib/logger';

// ============ Types ============

export type AutoFixMethod =
  | 'retry_with_backoff'
  | 'skip'
  | 'fallback'
  | 'wait_and_retry';

export interface RecoveryAttempt {
  method: string;
  success: boolean;
  timestamp: string;
  execution_id?: string;
  error_message?: string;
}

export interface AutoFixConfig {
  max_retries?: number;
  backoff_ms?: number;
  fallback_value?: unknown;
  wait_ms?: number;
}

export interface ErrorPattern {
  id: string;
  agent_id: string | null;
  user_id: string;
  error_code: string;
  plugin: string;
  action: string | null;
  occurrence_count: number;
  first_seen: string;
  last_seen: string;
  recovery_attempts: RecoveryAttempt[];
  auto_fix_enabled: boolean;
  auto_fix_method: AutoFixMethod | null;
  auto_fix_config: AutoFixConfig;
  auto_fix_success_rate: number | null;
  auto_fix_applied_count: number;
  auto_fix_success_count: number;
  error_message_sample: string | null;
  step_type: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpsertErrorPatternInput {
  user_id: string;
  agent_id?: string | null;
  error_code: string;
  plugin: string;
  action?: string | null;
  error_message?: string | null;
  step_type?: string | null;
  recovery_attempt?: RecoveryAttempt | null;
}

export interface EnableAutoFixInput {
  pattern_id: string;
  method: AutoFixMethod;
  config?: AutoFixConfig;
}

export interface ErrorPatternRepositoryResult<T> {
  data: T | null;
  error: Error | null;
}

// ============ Repository ============

export class ErrorPatternRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'ErrorPatternRepository' });
  }

  /**
   * Upsert an error pattern (create or increment occurrence)
   * Uses database RPC function for atomic upsert
   */
  async upsert(
    input: UpsertErrorPatternInput
  ): Promise<ErrorPatternRepositoryResult<string>> {
    try {
      const { data, error } = await this.supabase.rpc('upsert_error_pattern', {
        p_user_id: input.user_id,
        p_agent_id: input.agent_id || null,
        p_error_code: input.error_code,
        p_plugin: input.plugin,
        p_action: input.action || null,
        p_error_message: input.error_message || null,
        p_step_type: input.step_type || null,
        p_recovery_attempt: input.recovery_attempt
          ? JSON.stringify(input.recovery_attempt)
          : null,
      });

      if (error) {
        this.logger.error({ err: error, input }, 'Failed to upsert error pattern');
        throw error;
      }

      return { data: data as string, error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }

  /**
   * Find a matching error pattern for potential auto-fix
   */
  async findMatchingPattern(
    userId: string,
    agentId: string | null,
    errorCode: string,
    plugin: string,
    action?: string | null
  ): Promise<ErrorPatternRepositoryResult<ErrorPattern>> {
    try {
      // First try to find agent-specific pattern
      let query = this.supabase
        .from('error_patterns')
        .select('*')
        .eq('user_id', userId)
        .eq('error_code', errorCode)
        .eq('plugin', plugin);

      if (agentId) {
        query = query.eq('agent_id', agentId);
      }

      if (action) {
        query = query.eq('action', action);
      }

      const { data: agentPattern, error: agentError } = await query.maybeSingle();

      if (agentError) throw agentError;

      if (agentPattern) {
        return { data: agentPattern as ErrorPattern, error: null };
      }

      // If no agent-specific pattern, try global (agent_id is null)
      if (agentId) {
        let globalQuery = this.supabase
          .from('error_patterns')
          .select('*')
          .eq('user_id', userId)
          .is('agent_id', null)
          .eq('error_code', errorCode)
          .eq('plugin', plugin);

        if (action) {
          globalQuery = globalQuery.eq('action', action);
        }

        const { data: globalPattern, error: globalError } = await globalQuery.maybeSingle();

        if (globalError) throw globalError;

        return { data: globalPattern as ErrorPattern | null, error: null };
      }

      return { data: null, error: null };
    } catch (error) {
      this.logger.error(
        { err: error, userId, agentId, errorCode, plugin, action },
        'Failed to find matching pattern'
      );
      return { data: null, error: error as Error };
    }
  }

  /**
   * Find pattern by ID
   */
  async findById(
    patternId: string,
    userId: string
  ): Promise<ErrorPatternRepositoryResult<ErrorPattern>> {
    try {
      const { data, error } = await this.supabase
        .from('error_patterns')
        .select('*')
        .eq('id', patternId)
        .eq('user_id', userId)
        .single();

      if (error) throw error;

      return { data: data as ErrorPattern, error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get all patterns for a user, optionally filtered by agent
   */
  async findByUser(
    userId: string,
    options?: {
      agentId?: string;
      minOccurrences?: number;
      autoFixEnabledOnly?: boolean;
      limit?: number;
    }
  ): Promise<ErrorPatternRepositoryResult<ErrorPattern[]>> {
    try {
      let query = this.supabase
        .from('error_patterns')
        .select('*')
        .eq('user_id', userId)
        .order('occurrence_count', { ascending: false });

      if (options?.agentId) {
        query = query.or(`agent_id.eq.${options.agentId},agent_id.is.null`);
      }

      if (options?.minOccurrences) {
        query = query.gte('occurrence_count', options.minOccurrences);
      }

      if (options?.autoFixEnabledOnly) {
        query = query.eq('auto_fix_enabled', true);
      }

      if (options?.limit) {
        query = query.limit(options.limit);
      }

      const { data, error } = await query;

      if (error) throw error;

      return { data: (data || []) as ErrorPattern[], error: null };
    } catch (error) {
      this.logger.error({ err: error, userId, options }, 'Failed to fetch patterns');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get patterns eligible for auto-fix suggestion (3+ occurrences, not yet enabled)
   */
  async findEligibleForAutoFix(
    userId: string,
    agentId?: string
  ): Promise<ErrorPatternRepositoryResult<ErrorPattern[]>> {
    try {
      let query = this.supabase
        .from('error_patterns')
        .select('*')
        .eq('user_id', userId)
        .eq('auto_fix_enabled', false)
        .gte('occurrence_count', 3)
        .order('occurrence_count', { ascending: false });

      if (agentId) {
        query = query.or(`agent_id.eq.${agentId},agent_id.is.null`);
      }

      const { data, error } = await query;

      if (error) throw error;

      return { data: (data || []) as ErrorPattern[], error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }

  /**
   * Enable auto-fix for a pattern
   */
  async enableAutoFix(
    input: EnableAutoFixInput,
    userId: string
  ): Promise<ErrorPatternRepositoryResult<ErrorPattern>> {
    try {
      const { data, error } = await this.supabase
        .from('error_patterns')
        .update({
          auto_fix_enabled: true,
          auto_fix_method: input.method,
          auto_fix_config: input.config || {},
          updated_at: new Date().toISOString(),
        })
        .eq('id', input.pattern_id)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;

      this.logger.info(
        { patternId: input.pattern_id, method: input.method },
        'Auto-fix enabled for pattern'
      );

      return { data: data as ErrorPattern, error: null };
    } catch (error) {
      this.logger.error({ err: error, input }, 'Failed to enable auto-fix');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Disable auto-fix for a pattern
   */
  async disableAutoFix(
    patternId: string,
    userId: string
  ): Promise<ErrorPatternRepositoryResult<ErrorPattern>> {
    try {
      const { data, error } = await this.supabase
        .from('error_patterns')
        .update({
          auto_fix_enabled: false,
          updated_at: new Date().toISOString(),
        })
        .eq('id', patternId)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;

      return { data: data as ErrorPattern, error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }

  /**
   * Record the result of an auto-fix attempt
   * Updates success rate using database RPC function
   */
  async recordAutoFixResult(
    patternId: string,
    success: boolean
  ): Promise<ErrorPatternRepositoryResult<void>> {
    try {
      const { error } = await this.supabase.rpc('record_auto_fix_result', {
        p_pattern_id: patternId,
        p_success: success,
      });

      if (error) throw error;

      this.logger.debug(
        { patternId, success },
        'Recorded auto-fix result'
      );

      return { data: undefined, error: null };
    } catch (error) {
      // Non-blocking - log but don't fail
      this.logger.error({ err: error, patternId, success }, 'Failed to record auto-fix result');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Add a recovery attempt to an existing pattern
   */
  async addRecoveryAttempt(
    patternId: string,
    userId: string,
    attempt: RecoveryAttempt
  ): Promise<ErrorPatternRepositoryResult<void>> {
    try {
      // Fetch current pattern
      const { data: pattern, error: fetchError } = await this.supabase
        .from('error_patterns')
        .select('recovery_attempts')
        .eq('id', patternId)
        .eq('user_id', userId)
        .single();

      if (fetchError) throw fetchError;

      // Append new attempt (keep last 20 attempts to avoid bloat)
      const attempts = (pattern.recovery_attempts || []) as RecoveryAttempt[];
      attempts.push(attempt);
      const trimmedAttempts = attempts.slice(-20);

      const { error: updateError } = await this.supabase
        .from('error_patterns')
        .update({
          recovery_attempts: trimmedAttempts,
          last_seen: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', patternId)
        .eq('user_id', userId);

      if (updateError) throw updateError;

      return { data: undefined, error: null };
    } catch (error) {
      this.logger.error({ err: error, patternId, attempt }, 'Failed to add recovery attempt');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get patterns with low auto-fix success rate (candidates for disabling)
   */
  async findLowSuccessRatePatterns(
    userId: string,
    threshold: number = 0.5,
    minAttempts: number = 5
  ): Promise<ErrorPatternRepositoryResult<ErrorPattern[]>> {
    try {
      const { data, error } = await this.supabase
        .from('error_patterns')
        .select('*')
        .eq('user_id', userId)
        .eq('auto_fix_enabled', true)
        .gte('auto_fix_applied_count', minAttempts)
        .lt('auto_fix_success_rate', threshold)
        .order('auto_fix_success_rate', { ascending: true });

      if (error) throw error;

      return { data: (data || []) as ErrorPattern[], error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }

  /**
   * Delete a pattern
   */
  async delete(
    patternId: string,
    userId: string
  ): Promise<ErrorPatternRepositoryResult<void>> {
    try {
      const { error } = await this.supabase
        .from('error_patterns')
        .delete()
        .eq('id', patternId)
        .eq('user_id', userId);

      if (error) throw error;

      return { data: undefined, error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get error pattern statistics for a user
   */
  async getStatistics(
    userId: string
  ): Promise<
    ErrorPatternRepositoryResult<{
      total_patterns: number;
      total_occurrences: number;
      auto_fix_enabled_count: number;
      avg_success_rate: number | null;
      top_plugins: Array<{ plugin: string; count: number }>;
    }>
  > {
    try {
      // Get aggregate counts
      const { data: patterns, error } = await this.supabase
        .from('error_patterns')
        .select('plugin, occurrence_count, auto_fix_enabled, auto_fix_success_rate')
        .eq('user_id', userId);

      if (error) throw error;

      if (!patterns || patterns.length === 0) {
        return {
          data: {
            total_patterns: 0,
            total_occurrences: 0,
            auto_fix_enabled_count: 0,
            avg_success_rate: null,
            top_plugins: [],
          },
          error: null,
        };
      }

      // Calculate statistics
      const totalOccurrences = patterns.reduce(
        (sum, p) => sum + (p.occurrence_count || 0),
        0
      );
      const autoFixEnabled = patterns.filter((p) => p.auto_fix_enabled);
      const successRates = autoFixEnabled
        .filter((p) => p.auto_fix_success_rate !== null)
        .map((p) => p.auto_fix_success_rate as number);
      const avgSuccessRate =
        successRates.length > 0
          ? successRates.reduce((a, b) => a + b, 0) / successRates.length
          : null;

      // Count by plugin
      const pluginCounts = patterns.reduce(
        (acc, p) => {
          acc[p.plugin] = (acc[p.plugin] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );

      const topPlugins = Object.entries(pluginCounts)
        .map(([plugin, count]) => ({ plugin, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      return {
        data: {
          total_patterns: patterns.length,
          total_occurrences: totalOccurrences,
          auto_fix_enabled_count: autoFixEnabled.length,
          avg_success_rate: avgSuccessRate,
          top_plugins: topPlugins,
        },
        error: null,
      };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }
}

// Singleton export for convenience
let _instance: ErrorPatternRepository | null = null;

export function getErrorPatternRepository(
  supabaseClient?: SupabaseClient
): ErrorPatternRepository {
  if (!_instance || supabaseClient) {
    _instance = new ErrorPatternRepository(supabaseClient);
  }
  return _instance;
}
