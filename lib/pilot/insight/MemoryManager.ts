/**
 * MemoryManager — Store and apply behavior rules
 *
 * Phase 4 (stub): Basic CRUD for behavior_rules table
 * Phase 5 (full): Pattern matching, auto-application, rule priority
 *
 * This is the memory layer for the Shadow Agent system. When a user makes
 * a data handling decision (e.g., "continue with empty data"), that choice
 * can be stored as a BehaviorRule and auto-applied in future runs.
 *
 * Phase 4 limitations:
 * - Simple exact field matching only (no wildcards)
 * - No rule priority or conflict resolution
 * - No pattern matching for step names
 *
 * Phase 5 will add:
 * - Wildcard patterns (e.g., "gmail_search_*")
 * - Rule priority when multiple rules match
 * - Advanced pattern matching
 * - Rule suggestions and insights
 *
 * @module lib/pilot/insight/MemoryManager
 */

import { SupabaseClient } from '@supabase/supabase-js';
import type { BehaviorRule, BehaviorRuleInsert } from '../shadow/types';

export class MemoryManager {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Find a matching rule for a given failure pattern.
   *
   * Phase 4: Simple exact match on dataField and operator
   * Phase 5: Will add wildcard pattern matching for step names
   *
   * @param userId - The user who owns the rules
   * @param agentId - The agent ID (or check global rules if no agent-specific rule found)
   * @param stepName - Name of the step that failed
   * @param dataField - Field that has the data issue (e.g., 'emails', 'contacts')
   * @param operator - Type of data issue ('empty', 'missing', 'null')
   * @returns Matching rule or null
   */
  async findMatchingRule(
    userId: string,
    agentId: string,
    stepName: string,
    dataField: string,
    operator: 'empty' | 'missing' | 'null'
  ): Promise<BehaviorRule | null> {
    try {
      // Phase 4: Simple exact match on data_pattern.field and operator
      // Query for agent-specific rules first, then global rules
      const { data, error } = await this.supabase
        .from('behavior_rules')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active')
        .or(`agent_id.eq.${agentId},agent_id.is.null`)
        .order('agent_id', { ascending: false, nullsLast: true }) // Agent-specific rules first
        .limit(10); // Limit to avoid excessive queries

      if (error) {
        console.error('[MemoryManager] Error querying rules:', error.message);
        return null;
      }

      if (!data || data.length === 0) {
        return null;
      }

      // Find first rule that matches the data pattern
      for (const rule of data) {
        const dataPattern = rule.trigger_condition?.data_pattern;
        if (dataPattern &&
            dataPattern.field === dataField &&
            dataPattern.operator === operator) {
          // Phase 4: No step pattern matching yet
          // Phase 5 will add: stepName matches step_pattern (with wildcards)
          return rule as BehaviorRule;
        }
      }

      return null;
    } catch (err) {
      console.error('[MemoryManager] findMatchingRule failed (non-blocking):', err);
      return null;
    }
  }

  /**
   * Create a new behavior rule.
   *
   * @param rule - Rule to create (without id, created_at, updated_at)
   * @returns Created rule with ID and timestamps
   */
  async createRule(rule: BehaviorRuleInsert): Promise<BehaviorRule> {
    const { data, error } = await this.supabase
      .from('behavior_rules')
      .insert({
        ...rule,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create behavior rule: ${error.message}`);
    }

    return data as BehaviorRule;
  }

  /**
   * Record that a rule was applied during execution.
   * Increments applied_count and updates last_applied_at.
   *
   * @param ruleId - ID of the rule that was applied
   */
  async recordRuleApplication(ruleId: string): Promise<void> {
    try {
      const { error } = await this.supabase
        .from('behavior_rules')
        .update({
          applied_count: this.supabase.raw('applied_count + 1'),
          last_applied_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', ruleId);

      if (error) {
        console.error('[MemoryManager] Failed to record rule application:', error.message);
        // Non-blocking — don't throw, just log
      }
    } catch (err) {
      console.error('[MemoryManager] recordRuleApplication failed (non-blocking):', err);
    }
  }

  /**
   * Get all active rules for a user (for debugging/UI display).
   *
   * @param userId - The user ID
   * @param agentId - Optional: filter by agent (or show global rules)
   * @returns List of active rules
   */
  async getRules(userId: string, agentId?: string): Promise<BehaviorRule[]> {
    try {
      let query = this.supabase
        .from('behavior_rules')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active')
        .order('created_at', { ascending: false });

      if (agentId) {
        query = query.or(`agent_id.eq.${agentId},agent_id.is.null`);
      }

      const { data, error } = await query;

      if (error) {
        console.error('[MemoryManager] Error fetching rules:', error.message);
        return [];
      }

      return (data || []) as BehaviorRule[];
    } catch (err) {
      console.error('[MemoryManager] getRules failed (non-blocking):', err);
      return [];
    }
  }

  /**
   * Deactivate a rule (Phase 5: UI will call this).
   *
   * @param ruleId - ID of the rule to deactivate
   * @param userId - User ID (for RLS check)
   */
  async deactivateRule(ruleId: string, userId: string): Promise<void> {
    const { error } = await this.supabase
      .from('behavior_rules')
      .update({
        status: 'inactive',
        updated_at: new Date().toISOString(),
      })
      .eq('id', ruleId)
      .eq('user_id', userId);

    if (error) {
      throw new Error(`Failed to deactivate rule: ${error.message}`);
    }
  }
}
