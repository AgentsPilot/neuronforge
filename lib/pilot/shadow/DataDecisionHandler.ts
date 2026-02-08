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
import type {
  DataDecisionContext,
  DataDecisionResult,
  DataDecisionRequestInsert,
  DataDecisionRequest,
  FailureClassification,
  BehaviorRuleInsert,
} from './types';

const POLL_INTERVAL_MS = 5000; // Poll every 5 seconds
const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes timeout

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
      // 1. Check MemoryManager for existing rule
      if (this.memoryManager) {
        const existingRule = await this.memoryManager.findMatchingRule(
          userId,
          agentId,
          context.stepName,
          context.dataField,
          context.operator
        );

        if (existingRule) {
          console.log(
            `[DataDecisionHandler] Found existing rule ${existingRule.id} for ${context.dataField}:${context.operator}` +
            ` — auto-applying action: ${existingRule.action.type}`
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
      }

      // 2. No rule found → create decision request and wait for user
      console.log(
        `[DataDecisionHandler] No existing rule found for ${context.dataField}:${context.operator}` +
        ` — pausing execution and creating decision request`
      );

      return await this.createAndWaitForDecision(
        executionId,
        agentId,
        userId,
        context
      );
    } catch (err) {
      console.error('[DataDecisionHandler] handleDataUnavailable failed (non-blocking):', err);
      // Fallback: stop execution on error
      return {
        decision: 'stop',
        ruleApplied: false,
      };
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
        console.log(`[DataDecisionHandler] Created behavior rule ${ruleId}`);
        return {
          decision: result.action,
          ruleApplied: false, // Rule will be applied on future runs
          ruleId,
        };
      } catch (ruleErr) {
        console.error('[DataDecisionHandler] Failed to create behavior rule (non-blocking):', ruleErr);
        // Continue anyway — user's decision is still valid
      }
    }

    return {
      decision: result.action,
      ruleApplied: false,
    };
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
