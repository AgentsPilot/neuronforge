// lib/repositories/PaymentAutomationRepository.ts
// Repository for the `payment_automation_rules` table (RULES only).
//
// Phase-2 of the Payments repo-layer conformance work. Mirrors PaymentRepository.ts
// (constructor DI with a supabaseServer default, module-level Pino logger,
// { data, error } results, singleton export, direct-path import — no barrel).
//
// SCOPE: `payment_automation_executions` is intentionally NOT wrapped this phase
// (deferred — its `trigger_event_id` write/read is a phantom column and the
// delayed-automation path is already broken; wrapping it would not be behaviour
// preserving). The engine keeps direct DB access for executions.
//
// `payment_automation_rules` has an `updated_at` column but NO update trigger, so
// `update` sets `updated_at` manually.

import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';
import type { PaymentRepositoryResult } from '@/lib/repositories/PaymentRepository';
import type { AutomationRule } from '@/lib/services/PaymentAutomationEngine';
import type { PaymentEventType } from '@/lib/services/PaymentEventService';

const logger = createLogger({ service: 'PaymentAutomationRepository' });

export interface ListRulesOptions {
  isActive?: boolean;
  limit?: number;
  offset?: number;
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

// Singleton export
export const paymentAutomationRuleRepository = new PaymentAutomationRuleRepository();
