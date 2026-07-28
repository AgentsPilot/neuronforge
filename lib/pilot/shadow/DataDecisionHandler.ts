/**
 * DataDecisionHandler — Pause execution on empty/missing data,
 * ask user what to do, store choice as behavior rule.
 *
 * This is the core component for Phase 4 of the Shadow Agent architecture.
 * When data_unavailable is detected during calibration, this handler:
 *
 * 1. Checks MemoryManager for existing rule matching this pattern
 * 2. If rule exists → auto-applies → returns decision (NO pause)
 * 3. If no rule → creates DataDecisionRequest → pauses → waits for user response
 * 4. User responds → creates BehaviorRule (if "remember" checked) → resumes
 *
 * CRITICAL CONSTRAINTS:
 * - Never stores client data — only metadata (step IDs, field names, operators)
 * - All operations wrapped in try-catch — never blocks main execution
 * - Follows ApprovalTracker pattern: poll DB every 5s with 10min timeout
 *
 * @module lib/pilot/shadow/DataDecisionHandler
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { MemoryManager } from '../insight/MemoryManager';
import { createLogger } from '@/lib/logger';
import type {
  DataDecisionContext,
  DataDecisionResult,
  DataDecisionRequestInsert,
  DataDecisionRequest,
  FailureClassification,
  BehaviorRuleInsert,
} from './types';

const logger = createLogger({ service: 'DataDecisionHandler' });

const POLL_INTERVAL_MS = 5000; // Poll every 5 seconds
const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes timeout
const CROSS_AGENT_THRESHOLD = 3; // Minimum same decisions before suggesting cross-agent rule

export class DataDecisionHandler {
  constructor(
    private supabase: SupabaseClient,
    private memoryManager: MemoryManager | null
  ) {}

  /**
   * Handle data_unavailable: check for rule, pause if needed, wait for user.
   *
   * This is the main entry point called by ResumeOrchestrator when
   * data_unavailable failure is detected.
   *
   * @param executionId - Current execution ID
   * @param agentId - Agent ID
   * @param userId - User ID
   * @param context - Failure context (metadata only)
   * @param classification - Failure classification from ShadowAgent
   * @returns Decision to apply
   */
  async handleDataUnavailable(
    executionId: string,
    agentId: string,
    userId: string,
    context: DataDecisionContext,
    classification: FailureClassification
  ): Promise<DataDecisionResult> {
    try {
      // 1. Check MemoryManager for existing rule (agent-specific first)
      if (this.memoryManager) {
        const existingRule = await this.memoryManager.findMatchingRule(
          userId,
          agentId,
          context.stepName,
          context.dataField,
          context.operator
        );

        if (existingRule) {
          logger.debug(
            { ruleId: existingRule.id, dataField: context.dataField, operator: context.operator },
            'Found existing rule - auto-applying'
          );

          // Record that this rule was applied
          await this.memoryManager.recordRuleApplication(existingRule.id);

          // Map rule action to DataDecisionResult
          return {
            decision: existingRule.action.type as 'continue' | 'stop' | 'skip',
            ruleApplied: true,
            ruleId: existingRule.id,
          };
        }

        // 1b. Check for cross-agent plugin-scoped rule (Phase 5 enhancement)
        const crossAgentRule = await this.findCrossAgentRule(
          userId,
          context.plugin,
          context.dataField,
          context.operator
        );

        if (crossAgentRule) {
          logger.debug(
            { ruleId: crossAgentRule.id, plugin: context.plugin },
            'Found cross-agent rule - auto-applying'
          );
          await this.memoryManager.recordRuleApplication(crossAgentRule.id);
          return {
            decision: crossAgentRule.action.type as 'continue' | 'stop' | 'skip',
            ruleApplied: true,
            ruleId: crossAgentRule.id,
          };
        }
      }

      // 2. No rule found → create decision request and wait for user
      logger.debug(
        { dataField: context.dataField, operator: context.operator },
        'No existing rule found - pausing for user decision'
      );

      return await this.createAndWaitForDecision(
        executionId,
        agentId,
        userId,
        context
      );
    } catch (err) {
      logger.error({ err }, 'handleDataUnavailable failed (non-blocking)');
      // Fallback: stop execution on error
      return {
        decision: 'stop',
        ruleApplied: false,
      };
    }
  }

  /**
   * Find a cross-agent rule (plugin-scoped, agent_id IS NULL)
   * that matches the current context.
   *
   * @private
   */
  private async findCrossAgentRule(
    userId: string,
    plugin: string,
    dataField: string,
    operator: string
  ): Promise<{ id: string; action: { type: string } } | null> {
    try {
      const { data, error } = await this.supabase
        .from('behavior_rules')
        .select('id, action')
        .eq('user_id', userId)
        .is('agent_id', null) // Cross-agent rules have no agent_id
        .eq('status', 'active')
        .eq('plugin_pattern', plugin)
        .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
        .limit(1)
        .maybeSingle();

      if (error || !data) {
        return null;
      }

      // Check if trigger_condition matches
      const trigger = data.action?.trigger_condition || {};
      if (
        trigger.data_pattern?.field === dataField &&
        trigger.data_pattern?.operator === operator
      ) {
        return data as { id: string; action: { type: string } };
      }

      return null;
    } catch (err) {
      logger.debug({ err }, 'Cross-agent rule lookup failed (non-blocking)');
      return null;
    }
  }

  /**
   * Create decision request in DB and wait for user response.
   *
   * Follows ApprovalTracker pattern:
   * - Create request with status='pending'
   * - Poll DB every 5s checking for status='responded' or 'timeout'
   * - Max wait: 10 minutes
   * - If user responds: create BehaviorRule if "remember" checked
   *
   * @private
   */
  private async createAndWaitForDecision(
    executionId: string,
    agentId: string,
    userId: string,
    context: DataDecisionContext
  ): Promise<DataDecisionResult> {
    // Create decision request
    const requestInsert: DataDecisionRequestInsert = {
      execution_id: executionId,
      agent_id: agentId,
      user_id: userId,
      step_id: context.stepId,
      step_name: context.stepName,
      failure_category: 'data_unavailable',
      decision_context: {
        plugin: context.plugin,
        action: context.action,
        dataField: context.dataField,
        operator: context.operator,
      },
      status: 'pending',
      user_decision: undefined,
      responded_at: undefined,
      expires_at: new Date(Date.now() + TIMEOUT_MS).toISOString(),
    };

    const { data: request, error: insertError } = await this.supabase
      .from('data_decision_requests')
      .insert(requestInsert)
      .select()
      .single();

    if (insertError || !request) {
      console.error('[DataDecisionHandler] Failed to create decision request:', insertError?.message);
      return { decision: 'stop', ruleApplied: false };
    }

    console.log(`[DataDecisionHandler] Created decision request ${request.id} — waiting for user response...`);

    // Wait for user response (polling)
    const result = await this.waitForUserResponse(request.id);

    if (!result) {
      // Timeout or error
      console.error('[DataDecisionHandler] Timeout or error waiting for decision — stopping execution');
      await this.markRequestTimeout(request.id);
      return { decision: 'stop', ruleApplied: false };
    }

    // User responded!
    console.log(`[DataDecisionHandler] User responded with action: ${result.action}, remember: ${result.remember}`);

    // If "remember" checked, create BehaviorRule
    if (result.remember && this.memoryManager) {
      try {
        const ruleId = await this.createBehaviorRule(
          userId,
          agentId,
          context,
          result.action,
          request.id
        );
        logger.info({ ruleId }, 'Created behavior rule');

        // Check if user has made similar decisions across agents (cross-agent learning)
        // Fire-and-forget: don't block on this check
        this.checkCrossAgentPattern(userId, context, result.action).catch((err) => {
          logger.debug({ err }, 'Cross-agent pattern check failed (non-blocking)');
        });

        return {
          decision: result.action,
          ruleApplied: false, // Rule will be applied on future runs
          ruleId,
        };
      } catch (ruleErr) {
        logger.error({ err: ruleErr }, 'Failed to create behavior rule (non-blocking)');
        // Continue anyway — user's decision is still valid
      }
    }

    return {
      decision: result.action,
      ruleApplied: false,
    };
  }

  /**
   * Check if user has made the same decision multiple times across different agents.
   * If threshold reached, create a cross-agent (plugin-scoped) rule suggestion.
   *
   * This enables learning: "User always continues on empty Gmail results"
   * becomes a global rule after CROSS_AGENT_THRESHOLD occurrences.
   *
   * @private
   */
  private async checkCrossAgentPattern(
    userId: string,
    context: DataDecisionContext,
    decision: 'continue' | 'stop' | 'skip'
  ): Promise<void> {
    try {
      // Count similar decisions across all agents for this plugin+operator combo
      const { data: similarRules, error } = await this.supabase
        .from('behavior_rules')
        .select('id, agent_id')
        .eq('user_id', userId)
        .eq('status', 'active')
        .not('agent_id', 'is', null) // Only agent-specific rules
        .contains('trigger_condition', {
          data_pattern: {
            field: context.dataField,
            operator: context.operator,
          },
        })
        .contains('action', { type: decision });

      if (error || !similarRules) {
        return;
      }

      // Count unique agents with this pattern
      const uniqueAgents = new Set(similarRules.map((r) => r.agent_id));

      if (uniqueAgents.size >= CROSS_AGENT_THRESHOLD) {
        // Check if cross-agent rule already exists
        const { data: existingCrossAgent } = await this.supabase
          .from('behavior_rules')
          .select('id')
          .eq('user_id', userId)
          .is('agent_id', null)
          .eq('plugin_pattern', context.plugin)
          .contains('trigger_condition', {
            data_pattern: {
              field: context.dataField,
              operator: context.operator,
            },
          })
          .maybeSingle();

        if (existingCrossAgent) {
          // Cross-agent rule already exists
          return;
        }

        // Create cross-agent rule suggestion
        logger.info(
          {
            plugin: context.plugin,
            dataField: context.dataField,
            operator: context.operator,
            decision,
            agentCount: uniqueAgents.size,
          },
          'Creating cross-agent rule - pattern detected across multiple agents'
        );

        await this.supabase.from('behavior_rules').insert({
          user_id: userId,
          agent_id: null, // NULL = cross-agent (plugin-scoped)
          rule_type: decision === 'stop' ? 'data_fallback' : 'skip_on_empty',
          plugin_pattern: context.plugin,
          trigger_condition: {
            data_pattern: {
              field: context.dataField,
              operator: context.operator,
            },
          },
          action: {
            type: decision,
            params: {},
          },
          name: `Cross-agent: ${context.operator} ${context.dataField} → ${decision} (${context.plugin})`,
          description: `Auto-promoted from ${uniqueAgents.size} agents. ${decision} when ${context.plugin} returns ${context.operator} ${context.dataField}`,
          status: 'active',
          applied_count: 0,
          priority: 10, // Lower priority than agent-specific rules
        });
      }
    } catch (err) {
      // Non-blocking - just log and continue
      logger.debug({ err }, 'Cross-agent pattern check failed');
    }
  }

  /**
   * Poll database waiting for user to respond to the decision request.
   *
   * @param requestId - ID of the decision request
   * @returns User's decision or null on timeout/error
   * @private
   */
  private async waitForUserResponse(
    requestId: string
  ): Promise<{ action: 'continue' | 'stop' | 'skip'; remember: boolean } | null> {
    const startTime = Date.now();

    return new Promise((resolve) => {
      const pollInterval = setInterval(async () => {
        try {
          // Check if timeout exceeded
          if (Date.now() - startTime > TIMEOUT_MS) {
            clearInterval(pollInterval);
            resolve(null);
            return;
          }

          // Poll database for updated status
          const { data, error } = await this.supabase
            .from('data_decision_requests')
            .select('status, user_decision')
            .eq('id', requestId)
            .single();

          if (error) {
            console.error('[DataDecisionHandler] Error polling decision request:', error.message);
            return; // Continue polling
          }

          if (data.status === 'responded' && data.user_decision) {
            clearInterval(pollInterval);
            resolve({
              action: data.user_decision.action,
              remember: data.user_decision.remember || false,
            });
            return;
          }

          if (data.status === 'timeout') {
            clearInterval(pollInterval);
            resolve(null);
            return;
          }

          // Still pending — continue polling
        } catch (pollErr) {
          console.error('[DataDecisionHandler] Poll error (non-blocking):', pollErr);
          // Continue polling
        }
      }, POLL_INTERVAL_MS);
    });
  }

  /**
   * Mark a decision request as timed out.
   *
   * @param requestId - ID of the decision request
   * @private
   */
  private async markRequestTimeout(requestId: string): Promise<void> {
    try {
      await this.supabase
        .from('data_decision_requests')
        .update({ status: 'timeout' })
        .eq('id', requestId);
    } catch (err) {
      console.error('[DataDecisionHandler] Failed to mark request as timeout:', err);
    }
  }

  /**
   * Create a BehaviorRule from user's decision.
   *
   * @param userId - User ID
   * @param agentId - Agent ID
   * @param context - Failure context
   * @param decision - User's chosen action
   * @param decisionRequestId - ID of the decision request that created this rule
   * @returns Rule ID
   * @private
   */
  private async createBehaviorRule(
    userId: string,
    agentId: string,
    context: DataDecisionContext,
    decision: 'continue' | 'stop' | 'skip',
    decisionRequestId: string
  ): Promise<string> {
    if (!this.memoryManager) {
      throw new Error('MemoryManager not available');
    }

    // Map decision to rule_type
    let ruleType: 'skip_on_empty' | 'data_fallback' | 'auto_retry';
    if (decision === 'continue' || decision === 'skip') {
      ruleType = 'skip_on_empty';
    } else {
      ruleType = 'data_fallback'; // Phase 5 will handle more nuanced types
    }

    const rule: BehaviorRuleInsert = {
      user_id: userId,
      agent_id: agentId, // Agent-specific by default
      rule_type: ruleType,
      trigger_condition: {
        // Phase 4: No step pattern matching yet
        data_pattern: {
          field: context.dataField,
          operator: context.operator,
        },
      },
      action: {
        type: decision === 'stop' ? 'stop' : decision === 'skip' ? 'skip' : 'continue',
        params: {},
      },
      name: `Auto: ${context.operator} ${context.dataField} → ${decision}`,
      description: `Automatically ${decision} when step has ${context.operator} ${context.dataField}`,
      created_from_decision_id: decisionRequestId,
      status: 'active',
      applied_count: 0,
    };

    const createdRule = await this.memoryManager.createRule(rule);
    return createdRule.id;
  }
}
