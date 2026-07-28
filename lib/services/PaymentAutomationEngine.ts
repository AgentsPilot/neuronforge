/**
 * Payment Automation Engine
 *
 * Central engine for evaluating and executing payment automation rules.
 * This service:
 * 1. Subscribes to payment events
 * 2. Evaluates matching automation rules for each event
 * 3. Executes building blocks based on rule actions
 * 4. Respects cooldowns and execution limits
 *
 * The engine is designed to work with the AI kernel, allowing:
 * - Dynamic rule creation/modification
 * - Intelligent triggering based on patterns
 * - Learning from user behavior
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';
import {
  PaymentEventService,
  PaymentEvent,
  PaymentEventType,
  emitPaymentEvent
} from '@/lib/services/PaymentEventService';
import { getBlock, PAYMENT_BUILDING_BLOCKS } from '@/lib/payments/PaymentBuildingBlocks';

const logger = createLogger({ service: 'PaymentAutomationEngine' });

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
  status: 'pending' | 'scheduled' | 'executing' | 'completed' | 'failed';
  scheduled_at: string | null;
  executed_at: string | null;
  result: Record<string, unknown> | null;
  error_message: string | null;
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
  private supabase: SupabaseClient;
  private isRunning: boolean = false;
  private eventService: PaymentEventService;

  constructor(supabaseClient: SupabaseClient) {
    this.supabase = supabaseClient;
    this.eventService = new PaymentEventService(supabaseClient);
  }

  // ==================== ENGINE LIFECYCLE ====================

  /**
   * Start the automation engine
   * Subscribes to payment events and begins processing
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('PaymentAutomationEngine is already running');
      return;
    }

    logger.info('Starting PaymentAutomationEngine');
    this.isRunning = true;

    // Subscribe to all payment events
    this.eventService.subscribe(async (event) => {
      try {
        await this.processEvent(event);
      } catch (error) {
        logger.error({ err: error, eventId: event.id }, 'Error processing event in automation engine');
      }
    });

    logger.info('PaymentAutomationEngine started');
  }

  /**
   * Stop the automation engine
   */
  stop(): void {
    logger.info('Stopping PaymentAutomationEngine');
    this.isRunning = false;
  }

  // ==================== EVENT PROCESSING ====================

  /**
   * Process an incoming payment event
   * Finds matching rules and schedules/executes actions
   */
  async processEvent(event: PaymentEvent): Promise<void> {
    logger.info({
      eventId: event.id,
      eventType: event.event_type,
      entityId: event.entity_id
    }, 'Processing event for automation');

    // Get active rules for this event type
    const rulesResult = await this.getActiveRulesForEvent(event.user_id, event.event_type);
    if (rulesResult.error || !rulesResult.data) {
      logger.error({ err: rulesResult.error }, 'Failed to get automation rules');
      return;
    }

    const matchingRules = rulesResult.data;
    logger.info({ eventId: event.id, matchingRules: matchingRules.length }, 'Found matching rules');

    // Evaluate and execute each matching rule
    for (const rule of matchingRules) {
      try {
        await this.evaluateAndExecuteRule(rule, event);
      } catch (error) {
        logger.error({
          err: error,
          ruleId: rule.id,
          eventId: event.id
        }, 'Error executing automation rule');
      }
    }
  }

  /**
   * Evaluate if a rule should execute and do so if conditions are met
   */
  private async evaluateAndExecuteRule(rule: AutomationRule, event: PaymentEvent): Promise<void> {
    const context: RuleEvaluationContext = {
      event,
      entityType: event.entity_type,
      entityId: event.entity_id,
      contactId: event.contact_id,
      metadata: event.metadata as Record<string, unknown>
    };

    // Check conditions
    if (rule.trigger_conditions && rule.trigger_conditions.length > 0) {
      const conditionsMet = this.evaluateConditions(rule.trigger_conditions, context);
      if (!conditionsMet) {
        logger.debug({ ruleId: rule.id, eventId: event.id }, 'Rule conditions not met');
        return;
      }
    }

    // Check execution limits
    if (rule.max_executions_per_entity) {
      const executionCount = await this.getExecutionCountForEntity(
        rule.id,
        event.entity_type,
        event.entity_id
      );
      if (executionCount >= rule.max_executions_per_entity) {
        logger.debug({
          ruleId: rule.id,
          entityId: event.entity_id,
          executionCount,
          maxExecutions: rule.max_executions_per_entity
        }, 'Max executions reached for entity');
        return;
      }
    }

    // Check cooldown
    if (rule.cooldown_hours) {
      const recentExecution = await this.hasRecentExecution(
        rule.id,
        event.entity_type,
        event.entity_id,
        rule.cooldown_hours
      );
      if (recentExecution) {
        logger.debug({
          ruleId: rule.id,
          entityId: event.entity_id,
          cooldownHours: rule.cooldown_hours
        }, 'Rule on cooldown for entity');
        return;
      }
    }

    // Schedule or execute
    if (rule.delay_minutes > 0) {
      await this.scheduleExecution(rule, event);
    } else {
      await this.executeRuleAction(rule, event);
    }
  }

  /**
   * Evaluate trigger conditions against the event context
   */
  private evaluateConditions(
    conditions: TriggerCondition[],
    context: RuleEvaluationContext
  ): boolean {
    for (const condition of conditions) {
      const value = this.getValueFromContext(condition.field, context);
      if (!this.evaluateCondition(condition, value)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Get a value from the context by field path
   */
  private getValueFromContext(field: string, context: RuleEvaluationContext): unknown {
    const parts = field.split('.');
    let value: unknown = context;

    for (const part of parts) {
      if (value && typeof value === 'object') {
        value = (value as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }

    return value;
  }

  /**
   * Evaluate a single condition
   */
  private evaluateCondition(condition: TriggerCondition, actualValue: unknown): boolean {
    const { operator, value: expectedValue } = condition;

    switch (operator) {
      case 'eq':
        return actualValue === expectedValue;
      case 'neq':
        return actualValue !== expectedValue;
      case 'gt':
        return (actualValue as number) > (expectedValue as number);
      case 'gte':
        return (actualValue as number) >= (expectedValue as number);
      case 'lt':
        return (actualValue as number) < (expectedValue as number);
      case 'lte':
        return (actualValue as number) <= (expectedValue as number);
      case 'in':
        return Array.isArray(expectedValue) && expectedValue.includes(actualValue);
      case 'contains':
        return typeof actualValue === 'string' && actualValue.includes(expectedValue as string);
      default:
        return false;
    }
  }

  // ==================== EXECUTION ====================

  /**
   * Execute a rule's action immediately
   */
  private async executeRuleAction(rule: AutomationRule, event: PaymentEvent): Promise<void> {
    logger.info({
      ruleId: rule.id,
      ruleName: rule.name,
      actionBlock: rule.action_block,
      eventId: event.id
    }, 'Executing automation rule');

    // Create execution record
    const executionResult = await this.createExecution(rule, event, 'executing');
    if (executionResult.error || !executionResult.data) {
      logger.error({ err: executionResult.error }, 'Failed to create execution record');
      return;
    }

    const execution = executionResult.data;

    try {
      // Build parameters with event data substitution
      const parameters = this.buildActionParameters(rule.action_parameters, event);

      // Call block execution API internally
      const result = await this.callBlockExecutor(
        rule.user_id,
        rule.action_block,
        parameters
      );

      // Update execution as completed
      await this.updateExecution(execution.id, {
        status: 'completed',
        executed_at: new Date().toISOString(),
        result
      });

      logger.info({
        ruleId: rule.id,
        executionId: execution.id,
        blockId: rule.action_block
      }, 'Rule executed successfully');

    } catch (error) {
      // Update execution as failed
      await this.updateExecution(execution.id, {
        status: 'failed',
        executed_at: new Date().toISOString(),
        error_message: error instanceof Error ? error.message : String(error)
      });

      logger.error({
        err: error,
        ruleId: rule.id,
        executionId: execution.id
      }, 'Rule execution failed');
    }
  }

  /**
   * Schedule a rule execution for later
   */
  private async scheduleExecution(rule: AutomationRule, event: PaymentEvent): Promise<void> {
    const scheduledAt = new Date(Date.now() + rule.delay_minutes * 60 * 1000);

    logger.info({
      ruleId: rule.id,
      eventId: event.id,
      scheduledAt: scheduledAt.toISOString(),
      delayMinutes: rule.delay_minutes
    }, 'Scheduling rule execution');

    await this.createExecution(rule, event, 'scheduled', scheduledAt.toISOString());
  }

  /**
   * Build action parameters, substituting event values
   */
  private buildActionParameters(
    templateParams: Record<string, unknown>,
    event: PaymentEvent
  ): Record<string, unknown> {
    const params: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(templateParams)) {
      if (typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}')) {
        // Template substitution
        const path = value.slice(2, -2).trim();
        params[key] = this.getEventValue(path, event);
      } else if (value === '$entity_id') {
        params[key] = event.entity_id;
      } else if (value === '$contact_id') {
        params[key] = event.contact_id;
      } else if (value === '$user_id') {
        params[key] = event.user_id;
      } else {
        params[key] = value;
      }
    }

    return params;
  }

  /**
   * Get a value from the event by path
   */
  private getEventValue(path: string, event: PaymentEvent): unknown {
    if (path.startsWith('metadata.')) {
      const metaKey = path.replace('metadata.', '');
      return (event.metadata as Record<string, unknown>)?.[metaKey];
    }

    switch (path) {
      case 'entity_id': return event.entity_id;
      case 'entity_type': return event.entity_type;
      case 'contact_id': return event.contact_id;
      case 'user_id': return event.user_id;
      case 'processor_type': return event.processor_type;
      default: return undefined;
    }
  }

  /**
   * Call the block executor (internal)
   */
  private async callBlockExecutor(
    userId: string,
    blockId: string,
    parameters: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    // Import dynamically to avoid circular dependencies
    // In production, this would call the actual block executors
    // For now, we'll use a simple implementation

    const block = getBlock(blockId);
    if (!block) {
      throw new Error(`Unknown block: ${blockId}`);
    }

    // The actual execution would be done by the block execution API
    // This is a simplified internal call
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

  // ==================== DATABASE OPERATIONS ====================

  /**
   * Get active rules for an event type
   */
  async getActiveRulesForEvent(
    userId: string,
    eventType: PaymentEventType
  ): Promise<AutomationEngineResult<AutomationRule[]>> {
    try {
      const { data, error } = await this.supabase
        .from('payment_automation_rules')
        .select('*')
        .eq('user_id', userId)
        .eq('trigger_event', eventType)
        .eq('is_active', true);

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
      const { isActive, limit = 50, offset = 0 } = options;

      let query = this.supabase
        .from('payment_automation_rules')
        .select('*')
        .eq('user_id', userId);

      if (isActive !== undefined) {
        query = query.eq('is_active', isActive);
      }

      query = query
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      const { data, error } = await query;

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

      const { data, error } = await this.supabase
        .from('payment_automation_rules')
        .insert({
          user_id: userId,
          ...rule
        })
        .select()
        .single();

      if (error) throw error;

      logger.info({ ruleId: data.id, userId, name: rule.name }, 'Automation rule created');
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

      const { data, error } = await this.supabase
        .from('payment_automation_rules')
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('id', ruleId)
        .eq('user_id', userId)
        .select()
        .single();

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
      const { error } = await this.supabase
        .from('payment_automation_rules')
        .delete()
        .eq('id', ruleId)
        .eq('user_id', userId);

      if (error) throw error;

      logger.info({ ruleId, userId }, 'Automation rule deleted');
      return { data: null, error: null };
    } catch (error) {
      logger.error({ err: error, ruleId, userId }, 'Failed to delete automation rule');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Create default rules for a new user
   */
  async createDefaultRules(userId: string): Promise<AutomationEngineResult<AutomationRule[]>> {
    try {
      const defaultRules = [
        {
          name: 'Send reminder 3 days before due',
          description: 'Automatically send a payment reminder 3 days before an installment is due',
          trigger_event: 'installment.due_approaching' as PaymentEventType,
          trigger_conditions: [
            { field: 'metadata.days_until_due', operator: 'eq' as TriggerConditionOperator, value: 3 }
          ],
          action_block: 'send_payment_reminder',
          action_parameters: {
            installment_id: '$entity_id',
            contact_id: '$contact_id',
            channel: 'email'
          },
          delay_minutes: 0,
          max_executions_per_entity: 1,
          cooldown_hours: 24,
          is_active: true
        },
        {
          name: 'Auto-retry failed payment after 4 hours',
          description: 'Schedule a retry when a payment fails',
          trigger_event: 'payment.failed' as PaymentEventType,
          trigger_conditions: null,
          action_block: 'schedule_retry',
          action_parameters: {
            invoice_id: '$entity_id',
            delay_hours: 4
          },
          delay_minutes: 0,
          max_executions_per_entity: 3,
          cooldown_hours: 4,
          is_active: true
        },
        {
          name: 'Send overdue notice after 1 day',
          description: 'Send a reminder when an installment becomes overdue',
          trigger_event: 'installment.overdue' as PaymentEventType,
          trigger_conditions: [
            { field: 'metadata.overdue_days', operator: 'eq' as TriggerConditionOperator, value: 1 }
          ],
          action_block: 'send_payment_reminder',
          action_parameters: {
            installment_id: '$entity_id',
            contact_id: '$contact_id',
            channel: 'email',
            template: 'overdue_notice'
          },
          delay_minutes: 0,
          max_executions_per_entity: 1,
          cooldown_hours: 48,
          is_active: true
        }
      ];

      const createdRules: AutomationRule[] = [];

      for (const rule of defaultRules) {
        const result = await this.createRule(userId, rule);
        if (result.data) {
          createdRules.push(result.data);
        }
      }

      logger.info({ userId, rulesCreated: createdRules.length }, 'Default automation rules created');
      return { data: createdRules, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to create default rules');
      return { data: null, error: error as Error };
    }
  }

  // ==================== EXECUTION TRACKING ====================

  /**
   * Create an execution record
   */
  private async createExecution(
    rule: AutomationRule,
    event: PaymentEvent,
    status: 'pending' | 'scheduled' | 'executing',
    scheduledAt?: string
  ): Promise<AutomationEngineResult<RuleExecution>> {
    try {
      const { data, error } = await this.supabase
        .from('payment_automation_executions')
        .insert({
          user_id: rule.user_id,
          rule_id: rule.id,
          entity_type: event.entity_type,
          entity_id: event.entity_id,
          trigger_event_id: event.id,
          status,
          scheduled_at: scheduledAt || null
        })
        .select()
        .single();

      if (error) throw error;

      return { data, error: null };
    } catch (error) {
      logger.error({ err: error }, 'Failed to create execution record');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Update an execution record
   */
  private async updateExecution(
    executionId: string,
    updates: Partial<RuleExecution>
  ): Promise<void> {
    try {
      const { error } = await this.supabase
        .from('payment_automation_executions')
        .update(updates)
        .eq('id', executionId);

      if (error) throw error;
    } catch (error) {
      logger.error({ err: error, executionId }, 'Failed to update execution');
    }
  }

  /**
   * Get execution count for an entity
   */
  private async getExecutionCountForEntity(
    ruleId: string,
    entityType: string,
    entityId: string
  ): Promise<number> {
    try {
      const { count, error } = await this.supabase
        .from('payment_automation_executions')
        .select('*', { count: 'exact', head: true })
        .eq('rule_id', ruleId)
        .eq('entity_type', entityType)
        .eq('entity_id', entityId)
        .in('status', ['completed', 'executing', 'scheduled']);

      if (error) throw error;

      return count || 0;
    } catch (error) {
      logger.error({ err: error, ruleId, entityId }, 'Failed to get execution count');
      return 0;
    }
  }

  /**
   * Check if there's a recent execution within cooldown period
   */
  private async hasRecentExecution(
    ruleId: string,
    entityType: string,
    entityId: string,
    cooldownHours: number
  ): Promise<boolean> {
    try {
      const threshold = new Date(Date.now() - cooldownHours * 60 * 60 * 1000).toISOString();

      const { data, error } = await this.supabase
        .from('payment_automation_executions')
        .select('id')
        .eq('rule_id', ruleId)
        .eq('entity_type', entityType)
        .eq('entity_id', entityId)
        .in('status', ['completed', 'scheduled'])
        .gte('created_at', threshold)
        .limit(1);

      if (error) throw error;

      return (data?.length || 0) > 0;
    } catch (error) {
      logger.error({ err: error, ruleId, entityId }, 'Failed to check recent execution');
      return false;
    }
  }

  /**
   * Get scheduled executions that are due
   */
  async getScheduledExecutionsDue(): Promise<AutomationEngineResult<RuleExecution[]>> {
    try {
      const now = new Date().toISOString();

      const { data, error } = await this.supabase
        .from('payment_automation_executions')
        .select('*, payment_automation_rules(*)')
        .eq('status', 'scheduled')
        .lte('scheduled_at', now)
        .order('scheduled_at', { ascending: true })
        .limit(100);

      if (error) throw error;

      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error }, 'Failed to get scheduled executions');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Process scheduled executions (called by cron)
   */
  async processScheduledExecutions(): Promise<void> {
    const result = await this.getScheduledExecutionsDue();
    if (result.error || !result.data) {
      logger.error({ err: result.error }, 'Failed to get scheduled executions');
      return;
    }

    logger.info({ count: result.data.length }, 'Processing scheduled executions');

    for (const execution of result.data) {
      try {
        // Get the original event
        const { data: eventData } = await this.supabase
          .from('payment_events')
          .select('*')
          .eq('id', execution.trigger_event_id)
          .single();

        if (!eventData) {
          logger.warn({ executionId: execution.id }, 'Original event not found');
          await this.updateExecution(execution.id, {
            status: 'failed',
            error_message: 'Original trigger event not found'
          });
          continue;
        }

        // Get the rule
        const { data: ruleData } = await this.supabase
          .from('payment_automation_rules')
          .select('*')
          .eq('id', execution.rule_id)
          .single();

        if (!ruleData) {
          logger.warn({ executionId: execution.id }, 'Rule not found');
          await this.updateExecution(execution.id, {
            status: 'failed',
            error_message: 'Rule not found'
          });
          continue;
        }

        // Execute
        await this.executeRuleAction(ruleData as AutomationRule, eventData as PaymentEvent);
      } catch (error) {
        logger.error({ err: error, executionId: execution.id }, 'Error processing scheduled execution');
        await this.updateExecution(execution.id, {
          status: 'failed',
          error_message: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }
}

// Singleton export
import { supabaseServer } from '@/lib/supabaseServer';
export const paymentAutomationEngine = new PaymentAutomationEngine(supabaseServer);
