/**
 * Payment Automation Engine
 *
 * Central engine for evaluating and executing payment automation rules.
 *
 * As of the queue-drain cycle the engine owns ONLY the durable DRAIN:
 * `processScheduledExecutions` claims due `payment_automation_executions` rows
 * (SELECT ... FOR UPDATE SKIP LOCKED via RPC), enforces the per-entity guardrails
 * at that single choke point, executes the action block, and marks the claimed row
 * terminal. The old in-process subscribe()/notifySubscribers() bus + immediate
 * `executeRuleAction`/`scheduleExecution` paths are retired — reactions are now
 * durably enqueued at emit time (see lib/payments/paymentReactionEnqueuer.ts).
 *
 * Pure rule-evaluation helpers live in lib/payments/ruleEvaluation.ts (shared with
 * the enqueuer). The default rule literals live in lib/payments/defaultPaymentRules.ts.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';
import { PaymentEvent, PaymentEventType } from '@/lib/services/PaymentEventService';
import { getBlock } from '@/lib/payments/PaymentBuildingBlocks';
import {
  PaymentAutomationRuleRepository,
  paymentAutomationExecutionRepository,
} from '@/lib/repositories/PaymentAutomationRepository';
import { PaymentEventRepository } from '@/lib/repositories/PaymentEventRepository';
import { buildActionParameters } from '@/lib/payments/ruleEvaluation';
import { ensureDefaultPaymentRules } from '@/lib/payments/defaultPaymentRules';

const logger = createLogger({ service: 'PaymentAutomationEngine' });

// Durable-queue drain constants (Q1). Lease > the cron's maxDuration (60s) so any
// row still `running` past the lease is provably dead (the serverless gift).
const LEASE_SECONDS = 90;
const MAX_ATTEMPTS = 5;
const BATCH = 100;

// ==================== TYPES ====================

export type TriggerConditionOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains';

export interface TriggerCondition {
  field: string;
  operator: TriggerConditionOperator;
  value: unknown;
}

export interface AutomationRule {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  is_active: boolean;

  // Trigger
  trigger_event: PaymentEventType;
  trigger_conditions: TriggerCondition[] | null;

  // Action
  action_block: string;
  action_parameters: Record<string, unknown>;

  // Timing
  delay_minutes: number;

  // Limits
  max_executions_per_entity: number | null;
  cooldown_hours: number | null;

  created_at: string;
  updated_at: string;
}

export interface RuleExecution {
  id: string;
  user_id: string;
  rule_id: string;
  entity_type: string;
  entity_id: string;
  trigger_event_id: string;
  // Reconciled vocab (M4): pending (enqueued) → running (claimed) → completed | failed;
  // cancelled (user), dead_letter (reaper-declared poison). Legacy scheduled/executing/executed dropped.
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'dead_letter';
  scheduled_at: string | null;
  executed_at: string | null;
  result: Record<string, unknown> | null;
  error_message: string | null;
  // Claim/lease columns (§8.1 durable-queue pattern; added by the
  // 2026-08-14_payment_automation_executions_claim migration).
  claimed_by: string | null;
  claimed_at: string | null;
  attempts: number;
  next_attempt_at: string | null;
  created_at: string;
}

export interface AutomationEngineResult<T> {
  data: T | null;
  error: Error | null;
}

export interface RuleEvaluationContext {
  event: PaymentEvent;
  entityType: string;
  entityId: string;
  contactId?: string | null;
  metadata: Record<string, unknown>;
}

// ==================== ENGINE ====================

export class PaymentAutomationEngine {
  private ruleRepo: PaymentAutomationRuleRepository;
  private eventRepo: PaymentEventRepository;

  constructor(supabaseClient: SupabaseClient) {
    this.ruleRepo = new PaymentAutomationRuleRepository(supabaseClient);
    this.eventRepo = new PaymentEventRepository(supabaseClient);
  }

  // ==================== EXECUTION (block executor) ====================

  /**
   * Call the block executor (internal).
   *
   * NOTE: still a placeholder — actual block execution is wired by the block
   * execution API and is out of scope for this cycle.
   */
  private async callBlockExecutor(
    userId: string,
    blockId: string,
    parameters: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const block = getBlock(blockId);
    if (!block) {
      throw new Error(`Unknown block: ${blockId}`);
    }

    logger.info({
      blockId,
      userId,
      parameterKeys: Object.keys(parameters)
    }, 'Calling block executor');

    // Return a placeholder - actual implementation would execute the block
    return {
      executed: true,
      blockId,
      parameters
    };
  }

  // ==================== RULE CRUD ====================

  /**
   * Get active rules for an event type
   */
  async getActiveRulesForEvent(
    userId: string,
    eventType: PaymentEventType
  ): Promise<AutomationEngineResult<AutomationRule[]>> {
    try {
      const { data, error } = await this.ruleRepo.findActiveForEvent(userId, eventType);

      if (error) throw error;

      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error, userId, eventType }, 'Failed to get automation rules');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get all rules for a user
   */
  async getUserRules(
    userId: string,
    options: { isActive?: boolean; limit?: number; offset?: number } = {}
  ): Promise<AutomationEngineResult<AutomationRule[]>> {
    try {
      const { data, error } = await this.ruleRepo.list(userId, options);

      if (error) throw error;

      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to get user rules');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Create an automation rule
   */
  async createRule(
    userId: string,
    rule: Omit<AutomationRule, 'id' | 'user_id' | 'created_at' | 'updated_at'>
  ): Promise<AutomationEngineResult<AutomationRule>> {
    try {
      // Validate action block exists
      const block = getBlock(rule.action_block);
      if (!block) {
        throw new Error(`Unknown action block: ${rule.action_block}`);
      }

      const { data, error } = await this.ruleRepo.create(userId, rule);

      if (error) throw error;

      logger.info({ ruleId: data!.id, userId, name: rule.name }, 'Automation rule created');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to create automation rule');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Update an automation rule
   */
  async updateRule(
    ruleId: string,
    userId: string,
    updates: Partial<AutomationRule>
  ): Promise<AutomationEngineResult<AutomationRule>> {
    try {
      // Validate action block if being updated
      if (updates.action_block) {
        const block = getBlock(updates.action_block);
        if (!block) {
          throw new Error(`Unknown action block: ${updates.action_block}`);
        }
      }

      const { data, error } = await this.ruleRepo.update(ruleId, userId, updates);

      if (error) throw error;

      logger.info({ ruleId, userId }, 'Automation rule updated');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, ruleId, userId }, 'Failed to update automation rule');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Delete an automation rule
   */
  async deleteRule(ruleId: string, userId: string): Promise<AutomationEngineResult<void>> {
    try {
      const { error } = await this.ruleRepo.delete(ruleId, userId);

      if (error) throw error;

      logger.info({ ruleId, userId }, 'Automation rule deleted');
      return { data: null, error: null };
    } catch (error) {
      logger.error({ err: error, ruleId, userId }, 'Failed to delete automation rule');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Create default rules for a user (idempotent — delegates to the shared seed).
   */
  async createDefaultRules(userId: string): Promise<AutomationEngineResult<void>> {
    try {
      await ensureDefaultPaymentRules(userId, this.ruleRepo);
      return { data: null, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to create default rules');
      return { data: null, error: error as Error };
    }
  }

  // ==================== CRON DRAIN ====================

  /**
   * Process due automation executions (called by cron).
   *
   * Durable claim-based drain (§8.1): reap stale rows, atomically claim a batch of
   * due `pending` rows, then for each — load its rule + trigger event, enforce the
   * per-entity guardrails at THIS single choke point (so no path can bypass them),
   * execute the block, and mark the claimed row terminal. The claimed row itself is
   * the unit of work and of idempotency (fixes the old phantom-second-row bug).
   */
  async processScheduledExecutions(): Promise<void> {
    const runnerId = crypto.randomUUID();

    // 1. Reaper first (safety-net sweep) — its own RPC (Q1).
    const { data: reaped, error: reapError } = await paymentAutomationExecutionRepository.reapStale(
      LEASE_SECONDS,
      MAX_ATTEMPTS
    );
    if (reapError) {
      logger.warn({ err: reapError }, 'Reaper sweep failed (non-fatal)');
    } else if (reaped && reaped.length > 0) {
      logger.info({ reclaimed: reaped.length }, 'Reaped stale automation executions');
    }

    // 2. Claim a batch of due pending rows.
    const { data: claimed, error: claimError } = await paymentAutomationExecutionRepository.claimDue(
      runnerId,
      BATCH
    );
    if (claimError) {
      logger.error({ err: claimError, runnerId }, 'Failed to claim due executions');
      return;
    }
    if (!claimed || claimed.length === 0) {
      logger.info('No due automation executions to process');
      return;
    }

    logger.info({ count: claimed.length, runnerId }, 'Processing claimed automation executions');

    // 3. Drain each claimed row.
    for (const execution of claimed) {
      try {
        // Load rule + trigger event (cross-user cron reads — unscoped by design).
        const { data: rule } = await this.ruleRepo.findByIdUnscoped(execution.rule_id);
        const { data: event } = await this.eventRepo.findByIdUnscoped(execution.trigger_event_id);

        if (!rule || !event) {
          await paymentAutomationExecutionRepository.fail(execution.id, 'rule/event not found');
          continue;
        }

        // M3 choke-point guardrail: max executions per entity (counts PRIOR terminal
        // `completed` rows, excluding self, so the row being drained can't self-block).
        if (rule.max_executions_per_entity) {
          const { data: count } = await paymentAutomationExecutionRepository.countCompletedForEntity(
            rule.id,
            execution.entity_type,
            execution.entity_id,
            execution.id
          );
          if ((count ?? 0) >= rule.max_executions_per_entity) {
            await paymentAutomationExecutionRepository.fail(execution.id, 'max executions reached');
            continue;
          }
        }

        // M3 choke-point guardrail: cooldown (excludes self).
        if (rule.cooldown_hours) {
          const since = new Date(Date.now() - rule.cooldown_hours * 60 * 60 * 1000).toISOString();
          const { data: recent } = await paymentAutomationExecutionRepository.hasRecentForEntity(
            rule.id,
            execution.entity_type,
            execution.entity_id,
            since,
            execution.id
          );
          if (recent) {
            await paymentAutomationExecutionRepository.fail(execution.id, 'cooldown active');
            continue;
          }
        }

        // Execute the block on the claimed row.
        const params = buildActionParameters(rule.action_parameters, event as PaymentEvent);
        const result = await this.callBlockExecutor(rule.user_id, rule.action_block, params);
        await paymentAutomationExecutionRepository.complete(execution.id, result);

        logger.info(
          { executionId: execution.id, ruleId: rule.id, blockId: rule.action_block },
          'Automation execution completed'
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error({ err: error, executionId: execution.id }, 'Automation execution failed');
        await paymentAutomationExecutionRepository.fail(execution.id, message);
      }
    }
  }
}

// Singleton export
import { supabaseServer } from '@/lib/supabaseServer';
export const paymentAutomationEngine = new PaymentAutomationEngine(supabaseServer);
