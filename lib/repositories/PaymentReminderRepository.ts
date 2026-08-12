// lib/repositories/PaymentReminderRepository.ts
// Repository for the `payment_reminders` table.
//
// Phase-2 of the Payments repo-layer conformance work. Mirrors PaymentRepository.ts
// (constructor DI with a supabaseServer default, module-level Pino logger,
// { data, error } results, singleton export, direct-path import — no barrel).
//
// IMPORTANT: `payment_reminders` has NO `updated_at` column. None of the update
// methods here may write `updated_at` (B2 — the previous service/route writes to
// this phantom column caused the updates to fail under PostgREST).

import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';
import type { PaymentRepositoryResult } from '@/lib/repositories/PaymentRepository';
import type {
  PaymentReminder,
  ReminderStatus as ServiceReminderStatus,
} from '@/lib/services/PaymentReminderService';

const logger = createLogger({ service: 'PaymentReminderRepository' });

// ==================== TYPES ====================

export type ReminderStatus = ServiceReminderStatus;

/**
 * Raw `payment_reminders` row (no `updated_at` — the column does not exist).
 * Aliased to the service's `PaymentReminder` so rerouted service methods stay
 * type-compatible without casts.
 */
export type PaymentReminderRow = PaymentReminder;

export interface PaymentReminderInsert {
  user_id: string;
  invoice_id?: string | null;
  installment_id?: string | null;
  contact_id: string;
  reminder_type: string;
  scheduled_at: string;
  channel: string;
  template_id?: string | null;
  status?: ReminderStatus;
  metadata?: Record<string, unknown>;
}

export interface ListRemindersOptions {
  invoiceId?: string;
  installmentId?: string;
  contactId?: string;
  status?: ReminderStatus;
  limit?: number;
  offset?: number;
}

export class PaymentReminderRepository {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient = supabaseServer) {
    this.supabase = supabase;
  }

  async create(row: PaymentReminderInsert): Promise<PaymentRepositoryResult<PaymentReminderRow>> {
    try {
      const { data, error } = await this.supabase
        .from('payment_reminders')
        .insert({
          user_id: row.user_id,
          invoice_id: row.invoice_id ?? null,
          installment_id: row.installment_id ?? null,
          contact_id: row.contact_id,
          reminder_type: row.reminder_type,
          scheduled_at: row.scheduled_at,
          channel: row.channel,
          template_id: row.template_id ?? null,
          status: row.status ?? 'pending',
          metadata: row.metadata ?? {},
        })
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, userId: row.user_id }, 'Failed to create payment reminder');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Update a reminder's status/dispatch fields.
   *
   * B1 (security): scoped by BOTH `id` AND `user_id` — the previous service update
   * was id-only, a cross-tenant write gap.
   * B2: never writes `updated_at` (no such column).
   */
  async updateStatus(
    id: string,
    userId: string,
    patch: { status?: ReminderStatus; sent_at?: string | null; error_message?: string | null }
  ): Promise<PaymentRepositoryResult<null>> {
    try {
      const { error } = await this.supabase
        .from('payment_reminders')
        .update(patch)
        .eq('id', id)
        .eq('user_id', userId);

      if (error) throw error;
      return { data: null, error: null };
    } catch (error) {
      logger.error({ err: error, id, userId }, 'Failed to update reminder status');
      return { data: null, error: error as Error };
    }
  }

  /** Cancel a single pending reminder. Returns the number of rows cancelled. B2: no `updated_at`. */
  async cancel(id: string, userId: string): Promise<PaymentRepositoryResult<number>> {
    try {
      const { data, error } = await this.supabase
        .from('payment_reminders')
        .update({ status: 'cancelled' })
        .eq('id', id)
        .eq('user_id', userId)
        .eq('status', 'pending')
        .select();

      if (error) throw error;
      return { data: data?.length || 0, error: null };
    } catch (error) {
      logger.error({ err: error, id, userId }, 'Failed to cancel reminder');
      return { data: null, error: error as Error };
    }
  }

  /** Cancel all pending reminders for an invoice. Returns count. B2: no `updated_at`. */
  async cancelByInvoice(invoiceId: string, userId: string): Promise<PaymentRepositoryResult<number>> {
    try {
      const { data, error } = await this.supabase
        .from('payment_reminders')
        .update({ status: 'cancelled' })
        .eq('invoice_id', invoiceId)
        .eq('user_id', userId)
        .eq('status', 'pending')
        .select();

      if (error) throw error;
      return { data: data?.length || 0, error: null };
    } catch (error) {
      logger.error({ err: error, invoiceId, userId }, 'Failed to cancel invoice reminders');
      return { data: null, error: error as Error };
    }
  }

  /** Cancel all pending reminders for an installment. Returns count. B2: no `updated_at`. */
  async cancelByInstallment(
    installmentId: string,
    userId: string
  ): Promise<PaymentRepositoryResult<number>> {
    try {
      const { data, error } = await this.supabase
        .from('payment_reminders')
        .update({ status: 'cancelled' })
        .eq('installment_id', installmentId)
        .eq('user_id', userId)
        .eq('status', 'pending')
        .select();

      if (error) throw error;
      return { data: data?.length || 0, error: null };
    } catch (error) {
      logger.error({ err: error, installmentId, userId }, 'Failed to cancel installment reminders');
      return { data: null, error: error as Error };
    }
  }

  /** User-scoped reminder query (newest scheduled first). */
  async list(
    userId: string,
    options: ListRemindersOptions = {}
  ): Promise<PaymentRepositoryResult<PaymentReminderRow[]>> {
    try {
      const { invoiceId, installmentId, contactId, status, limit = 50, offset = 0 } = options;

      let query = this.supabase
        .from('payment_reminders')
        .select('*')
        .eq('user_id', userId);

      if (invoiceId) query = query.eq('invoice_id', invoiceId);
      if (installmentId) query = query.eq('installment_id', installmentId);
      if (contactId) query = query.eq('contact_id', contactId);
      if (status) query = query.eq('status', status);

      query = query
        .order('scheduled_at', { ascending: false })
        .range(offset, offset + limit - 1);

      const { data, error } = await query;
      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error, userId, options }, 'Failed to list reminders');
      return { data: null, error: error as Error };
    }
  }

  // ==================== CRON / BATCH (cross-user) ====================

  /**
   * Pending reminders due at or before `now`, oldest first.
   *
   * ⟨unscoped-by-design⟩ — the reminders cron (processDueReminders) iterates every
   * user's due reminders. Not user-scoped by design.
   */
  async findDue(now: string, limit = 100): Promise<PaymentRepositoryResult<PaymentReminderRow[]>> {
    try {
      const { data, error } = await this.supabase
        .from('payment_reminders')
        .select('*')
        .eq('status', 'pending')
        .lte('scheduled_at', now)
        .order('scheduled_at', { ascending: true })
        .limit(limit);

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error }, 'Failed to find due reminders');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Delete a reminder by id.
   *
   * ⟨unscoped-by-design⟩ — the reminders cron deletes the original pending row after
   * dispatching a fresh reminder record; iterates across all users.
   */
  async deleteById(id: string): Promise<PaymentRepositoryResult<null>> {
    try {
      const { error } = await this.supabase
        .from('payment_reminders')
        .delete()
        .eq('id', id);

      if (error) throw error;
      return { data: null, error: null };
    } catch (error) {
      logger.error({ err: error, id }, 'Failed to delete reminder');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Mark a reminder failed by id. B2: no `updated_at`.
   *
   * ⟨unscoped-by-design⟩ — reminders cron failure path; iterates across all users.
   */
  async markFailedById(id: string, message: string): Promise<PaymentRepositoryResult<null>> {
    try {
      const { error } = await this.supabase
        .from('payment_reminders')
        .update({ status: 'failed', error_message: message })
        .eq('id', id);

      if (error) throw error;
      return { data: null, error: null };
    } catch (error) {
      logger.error({ err: error, id }, 'Failed to mark reminder failed');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Recent reminders of a type for an invoice since a threshold (dedup check).
   *
   * ⟨unscoped-by-design⟩ — the overdue-items cron iterates every user's overdue
   * invoices; the invoice id already localises ownership.
   */
  async findRecentByInvoice(
    invoiceId: string,
    reminderType: string,
    since: string
  ): Promise<PaymentRepositoryResult<Array<{ id: string }>>> {
    try {
      const { data, error } = await this.supabase
        .from('payment_reminders')
        .select('id')
        .eq('invoice_id', invoiceId)
        .eq('reminder_type', reminderType)
        .gte('created_at', since)
        .limit(1);

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error, invoiceId }, 'Failed to find recent invoice reminders');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Recent reminders of a type for an installment since a threshold (dedup check).
   *
   * ⟨unscoped-by-design⟩ — the overdue-items cron iterates every user's overdue
   * installments; the installment id already localises ownership.
   */
  async findRecentByInstallment(
    installmentId: string,
    reminderType: string,
    since: string
  ): Promise<PaymentRepositoryResult<Array<{ id: string }>>> {
    try {
      const { data, error } = await this.supabase
        .from('payment_reminders')
        .select('id')
        .eq('installment_id', installmentId)
        .eq('reminder_type', reminderType)
        .gte('created_at', since)
        .limit(1);

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error, installmentId }, 'Failed to find recent installment reminders');
      return { data: null, error: error as Error };
    }
  }
}

// Singleton export
export const paymentReminderRepository = new PaymentReminderRepository();
