// lib/repositories/PaymentAutomationRepository.ts
// Repositories for the payment automation tables (grouped multi-class, matching
// PaymentProcessorRepository.ts):
//   - PaymentAutomationRuleRepository       → `payment_automation_rules`
//   - PaymentAutomationExecutionRepository  → `payment_automation_executions` (the queue)
//
// Mirrors PaymentRepository.ts (constructor DI with a supabaseServer default,
// module-level Pino logger, { data, error } results, singleton exports,
// direct-path import — no barrel).
//
// The executions repo (added by the queue-drain cycle) closes the phase-2 §5
// deferral: ALL `payment_automation_executions` `.from()`/`.rpc()` access now
// routes through it, so a scope grep outside lib/repositories/ returns zero.
//
// `payment_automation_rules` has an `updated_at` column but NO update trigger, so
// `update` sets `updated_at` manually. `payment_automation_executions` has no
// `updated_at` column.

import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';
import type { PaymentRepositoryResult } from '@/lib/repositories/PaymentRepository';
import type { AutomationRule, RuleExecution } from '@/lib/services/PaymentAutomationEngine';
import type { PaymentEventType } from '@/lib/services/PaymentEventService';

const logger = createLogger({ service: 'PaymentAutomationRepository' });

export interface ListRulesOptions {
  isActive?: boolean;
  limit?: number;
  offset?: number;
}

/** Row shape accepted by PaymentAutomationExecutionRepository.enqueue. */
export interface PaymentAutomationExecutionInsert {
  user_id: string;
  rule_id: string;
  entity_type: string;
  entity_id: string;
  trigger_event_id: string;
  scheduled_at: string;
  status?: RuleExecution['status'];
}

export class PaymentAutomationRuleRepository {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient = supabaseServer) {
    this.supabase = supabase;
  }

  /** Active rules whose trigger matches an event type. User-scoped. */
  async findActiveForEvent(
    userId: string,
    eventType: PaymentEventType
  ): Promise<PaymentRepositoryResult<AutomationRule[]>> {
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
      logger.error({ err: error, userId, eventType }, 'Failed to find active rules for event');
      return { data: null, error: error as Error };
    }
  }

  /** All rules for a user (newest first), optionally filtered by active state. */
  async list(
    userId: string,
    options: ListRulesOptions = {}
  ): Promise<PaymentRepositoryResult<AutomationRule[]>> {
    try {
      const { isActive, limit = 50, offset = 0 } = options;

      let query = this.supabase
        .from('payment_automation_rules')
        .select('*')
        .eq('user_id', userId);

      if (isActive !== undefined) query = query.eq('is_active', isActive);

      query = query
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      const { data, error } = await query;
      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to list automation rules');
      return { data: null, error: error as Error };
    }
  }

  async create(
    userId: string,
    rule: Omit<AutomationRule, 'id' | 'user_id' | 'created_at' | 'updated_at'>
  ): Promise<PaymentRepositoryResult<AutomationRule>> {
    try {
      const { data, error } = await this.supabase
        .from('payment_automation_rules')
        .insert({ user_id: userId, ...rule })
        .select()
        .single();

      if (error) throw error;
      logger.info({ ruleId: data.id, userId }, 'Automation rule created');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to create automation rule');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Insert default rules for a user, ignoring any whose (user_id, name) already
   * exists. Backed by the `idx_payment_automation_rules_user_name` unique index —
   * this is what makes the lazy default-rule seed race-safe: two concurrent
   * first-emit seeders both attempt the insert, but `ON CONFLICT DO NOTHING`
   * (ignoreDuplicates) means only one set of rows actually lands. Returns the
   * count of rows genuinely inserted (ignored duplicates are not returned).
   */
  async insertDefaultsIgnoringDuplicates(
    userId: string,
    rules: Array<Omit<AutomationRule, 'id' | 'user_id' | 'created_at' | 'updated_at'>>
  ): Promise<PaymentRepositoryResult<number>> {
    try {
      if (rules.length === 0) return { data: 0, error: null };

      const rows = rules.map((rule) => ({ user_id: userId, ...rule }));
      const { data, error } = await this.supabase
        .from('payment_automation_rules')
        .upsert(rows, { onConflict: 'user_id,name', ignoreDuplicates: true })
        .select();

      if (error) throw error;
      const created = data?.length ?? 0;
      logger.info({ userId, created }, 'Seeded default automation rules (ignoring duplicates)');
      return { data: created, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to seed default automation rules');
      return { data: null, error: error as Error };
    }
  }

  async update(
    id: string,
    userId: string,
    patch: Partial<AutomationRule>
  ): Promise<PaymentRepositoryResult<AutomationRule>> {
    try {
      const { data, error } = await this.supabase
        .from('payment_automation_rules')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;
      logger.info({ ruleId: id, userId }, 'Automation rule updated');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, id, userId }, 'Failed to update automation rule');
      return { data: null, error: error as Error };
    }
  }

  async delete(id: string, userId: string): Promise<PaymentRepositoryResult<null>> {
    try {
      const { error } = await this.supabase
        .from('payment_automation_rules')
        .delete()
        .eq('id', id)
        .eq('user_id', userId);

      if (error) throw error;
      logger.info({ ruleId: id, userId }, 'Automation rule deleted');
      return { data: null, error: null };
    } catch (error) {
      logger.error({ err: error, id, userId }, 'Failed to delete automation rule');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Fetch a rule by id WITHOUT a user_id filter.
   *
   * ⟨unscoped-by-design⟩ — called only by the cross-user automation cron
   * (PaymentAutomationEngine.processScheduledExecutions) which resolves the rule for
   * a scheduled execution across all users. Precedent: PluginConnectionRepository.markExpired.
   */
  async findByIdUnscoped(id: string): Promise<PaymentRepositoryResult<AutomationRule>> {
    try {
      const { data, error } = await this.supabase
        .from('payment_automation_rules')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, id }, 'Failed to find automation rule by id');
      return { data: null, error: error as Error };
    }
  }
}

// ==================== EXECUTION QUEUE REPOSITORY ====================

/**
 * Repository for `payment_automation_executions` — the durable automation queue.
 *
 * `enqueue` is user_id-scoped (the row embeds `user_id`). The cron drain methods
 * operate cross-user by row id / rule+entity key and are ⟨unscoped-by-design⟩,
 * each doc-commented with the PluginConnectionRepository precedent — the crons
 * run on `supabaseServer` (service role) and iterate every user's queue rows.
 */
export class PaymentAutomationExecutionRepository {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient = supabaseServer) {
    this.supabase = supabase;
  }

  /** Enqueue a pending execution row. User-scoped (embeds user_id). */
  async enqueue(
    row: PaymentAutomationExecutionInsert
  ): Promise<PaymentRepositoryResult<RuleExecution>> {
    try {
      const { data, error } = await this.supabase
        .from('payment_automation_executions')
        .insert({
          user_id: row.user_id,
          rule_id: row.rule_id,
          entity_type: row.entity_type,
          entity_id: row.entity_id,
          trigger_event_id: row.trigger_event_id,
          scheduled_at: row.scheduled_at,
          status: row.status ?? 'pending',
        })
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, userId: row.user_id, ruleId: row.rule_id }, 'Failed to enqueue execution');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Count PRIOR terminal `completed` executions for a (rule, entity), excluding
   * the current row. Backs the choke-point `max_executions_per_entity` guardrail
   * (M3 — excludes self so the row being drained can't block itself).
   *
   * ⟨unscoped-by-design⟩ — the cron choke point keyed by rule/entity; the rule id
   * already localises ownership. Precedent: PluginConnectionRepository.markExpired.
   */
  async countCompletedForEntity(
    ruleId: string,
    entityType: string,
    entityId: string,
    excludeId: string
  ): Promise<PaymentRepositoryResult<number>> {
    try {
      const { count, error } = await this.supabase
        .from('payment_automation_executions')
        .select('*', { count: 'exact', head: true })
        .eq('rule_id', ruleId)
        .eq('entity_type', entityType)
        .eq('entity_id', entityId)
        .eq('status', 'completed')
        .neq('id', excludeId);

      if (error) throw error;
      return { data: count ?? 0, error: null };
    } catch (error) {
      logger.error({ err: error, ruleId, entityId }, 'Failed to count completed executions');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Cooldown check: does a recent `completed`/`running` execution exist for the
   * (rule, entity) since `sinceIso`, excluding the current row (M3)?
   *
   * ⟨unscoped-by-design⟩ — the cron choke point keyed by rule/entity.
   * Precedent: PluginConnectionRepository.markExpired.
   */
  async hasRecentForEntity(
    ruleId: string,
    entityType: string,
    entityId: string,
    sinceIso: string,
    excludeId: string
  ): Promise<PaymentRepositoryResult<boolean>> {
    try {
      const { data, error } = await this.supabase
        .from('payment_automation_executions')
        .select('id')
        .eq('rule_id', ruleId)
        .eq('entity_type', entityType)
        .eq('entity_id', entityId)
        .in('status', ['completed', 'running'])
        .neq('id', excludeId)
        .gte('created_at', sinceIso)
        .limit(1);

      if (error) throw error;
      return { data: (data?.length ?? 0) > 0, error: null };
    } catch (error) {
      logger.error({ err: error, ruleId, entityId }, 'Failed to check recent execution');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Atomically claim a batch of due pending executions (flips pending→running).
   *
   * ⟨unscoped-by-design⟩ — the automation cron drains every user's due rows via
   * the SECURITY DEFINER RPC (SELECT ... FOR UPDATE SKIP LOCKED). Precedent:
   * PluginConnectionRepository.markExpired.
   */
  async claimDue(runnerId: string, batch: number): Promise<PaymentRepositoryResult<RuleExecution[]>> {
    try {
      const { data, error } = await this.supabase.rpc('claim_due_payment_automation_executions', {
        p_runner: runnerId,
        p_batch: batch,
      });

      if (error) throw error;
      return { data: (data as RuleExecution[]) || [], error: null };
    } catch (error) {
      logger.error({ err: error, runnerId }, 'Failed to claim due executions');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Reap executions stuck in `running` past the lease (back to pending, or
   * dead_letter at max attempts).
   *
   * ⟨unscoped-by-design⟩ — cross-user safety-net sweep via SECURITY DEFINER RPC.
   * Precedent: PluginConnectionRepository.markExpired.
   */
  async reapStale(
    leaseSeconds: number,
    maxAttempts: number
  ): Promise<PaymentRepositoryResult<RuleExecution[]>> {
    try {
      const { data, error } = await this.supabase.rpc('reap_stale_payment_automation_executions', {
        p_lease_seconds: leaseSeconds,
        p_max_attempts: maxAttempts,
      });

      if (error) throw error;
      return { data: (data as RuleExecution[]) || [], error: null };
    } catch (error) {
      logger.error({ err: error, leaseSeconds, maxAttempts }, 'Failed to reap stale executions');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Mark a claimed execution completed.
   *
   * ⟨unscoped-by-design⟩ — the cron operates by row id across users.
   * Precedent: PluginConnectionRepository.markExpired.
   */
  async complete(id: string, result: Record<string, unknown>): Promise<PaymentRepositoryResult<null>> {
    try {
      const { error } = await this.supabase
        .from('payment_automation_executions')
        .update({ status: 'completed', executed_at: new Date().toISOString(), result })
        .eq('id', id);

      if (error) throw error;
      return { data: null, error: null };
    } catch (error) {
      logger.error({ err: error, id }, 'Failed to complete execution');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Mark a claimed execution failed (also used for guardrail-skips at the choke point).
   *
   * ⟨unscoped-by-design⟩ — the cron operates by row id across users.
   * Precedent: PluginConnectionRepository.markExpired.
   */
  async fail(id: string, message: string): Promise<PaymentRepositoryResult<null>> {
    try {
      const { error } = await this.supabase
        .from('payment_automation_executions')
        .update({ status: 'failed', executed_at: new Date().toISOString(), error_message: message })
        .eq('id', id);

      if (error) throw error;
      return { data: null, error: null };
    } catch (error) {
      logger.error({ err: error, id }, 'Failed to fail execution');
      return { data: null, error: error as Error };
    }
  }
}

// Singleton exports
export const paymentAutomationRuleRepository = new PaymentAutomationRuleRepository();
export const paymentAutomationExecutionRepository = new PaymentAutomationExecutionRepository();
