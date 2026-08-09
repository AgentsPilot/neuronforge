/**
 * Payment Reminder Service
 *
 * Handles payment reminders for invoices and installments.
 * This service:
 * 1. Schedules reminders based on due dates
 * 2. Sends reminders via configured channels (email, SMS, in-app)
 * 3. Tracks reminder history
 * 4. Emits events for AI kernel consumption
 *
 * Reminders work with the automation engine and can be triggered
 * by events or scheduled directly.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';
import { emitPaymentEvent, PaymentProcessorType } from '@/lib/services/PaymentEventService';
import { crmContactRepository } from '@/lib/repositories/CRMContactRepository';

const logger = createLogger({ service: 'PaymentReminderService' });

// ==================== TYPES ====================

export type ReminderType = 'upcoming_due' | 'due_today' | 'overdue' | 'retry_failed' | 'payment_received';
export type ReminderChannel = 'email' | 'sms' | 'in_app';
export type ReminderStatus = 'pending' | 'sent' | 'failed' | 'cancelled';

export interface PaymentReminder {
  id: string;
  user_id: string;
  invoice_id: string | null;
  installment_id: string | null;
  contact_id: string;
  reminder_type: ReminderType;
  scheduled_at: string;
  sent_at: string | null;
  channel: ReminderChannel;
  template_id: string | null;
  status: ReminderStatus;
  metadata: Record<string, unknown>;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReminderConfig {
  enabled: boolean;
  daysBefore: number[]; // Days before due date to send reminders
  overdueDays: number[]; // Days after due date to send overdue reminders
  channels: ReminderChannel[];
  defaultChannel: ReminderChannel;
}

export interface ScheduleReminderParams {
  invoiceId?: string;
  installmentId?: string;
  contactId: string;
  reminderType: ReminderType;
  scheduledAt: string;
  channel?: ReminderChannel;
  templateId?: string;
  metadata?: Record<string, unknown>;
}

export interface SendReminderParams {
  invoiceId?: string;
  installmentId?: string;
  contactId: string;
  channel: ReminderChannel;
  templateId?: string;
  includePaymentLink?: boolean;
  metadata?: Record<string, unknown>;
}

export interface PaymentReminderServiceResult<T> {
  data: T | null;
  error: Error | null;
}

// Default config
const DEFAULT_REMINDER_CONFIG: ReminderConfig = {
  enabled: true,
  daysBefore: [3, 1], // 3 days and 1 day before
  overdueDays: [1, 3, 7], // 1, 3, and 7 days after due
  channels: ['email'],
  defaultChannel: 'email'
};

// ==================== SERVICE ====================

export class PaymentReminderService {
  private supabase: SupabaseClient;

  constructor(supabaseClient: SupabaseClient) {
    this.supabase = supabaseClient;
  }

  // ==================== SCHEDULING ====================

  /**
   * Schedule a payment reminder
   */
  async scheduleReminder(
    userId: string,
    params: ScheduleReminderParams
  ): Promise<PaymentReminderServiceResult<PaymentReminder>> {
    try {
      const config = await this.getUserReminderConfig(userId);
      if (!config.enabled) {
        return {
          data: null,
          error: new Error('Payment reminders are disabled')
        };
      }

      logger.info({
        userId,
        contactId: params.contactId,
        reminderType: params.reminderType,
        scheduledAt: params.scheduledAt
      }, 'Scheduling payment reminder');

      const channel = params.channel || config.defaultChannel;

      const { data, error } = await this.supabase
        .from('payment_reminders')
        .insert({
          user_id: userId,
          invoice_id: params.invoiceId || null,
          installment_id: params.installmentId || null,
          contact_id: params.contactId,
          reminder_type: params.reminderType,
          scheduled_at: params.scheduledAt,
          channel,
          template_id: params.templateId || null,
          status: 'pending',
          metadata: params.metadata || {}
        })
        .select()
        .single();

      if (error) throw error;

      // Emit event
      await emitPaymentEvent(userId, {
        eventType: 'reminder.scheduled',
        entityType: 'reminder',
        entityId: data.id,
        contactId: params.contactId,
        metadata: {
          reminderType: params.reminderType,
          scheduledAt: params.scheduledAt,
          channel,
          invoiceId: params.invoiceId,
          installmentId: params.installmentId
        }
      });

      logger.info({ reminderId: data.id }, 'Reminder scheduled');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, userId, params }, 'Failed to schedule reminder');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Schedule reminders for an invoice based on due date
   */
  async scheduleInvoiceReminders(
    userId: string,
    invoiceId: string,
    contactId: string,
    dueDate: string
  ): Promise<PaymentReminderServiceResult<PaymentReminder[]>> {
    try {
      const config = await this.getUserReminderConfig(userId);
      if (!config.enabled) {
        return { data: [], error: null };
      }

      const dueDateObj = new Date(dueDate);
      const reminders: PaymentReminder[] = [];

      // Schedule "days before" reminders
      for (const daysBefore of config.daysBefore) {
        const reminderDate = new Date(dueDateObj);
        reminderDate.setDate(reminderDate.getDate() - daysBefore);

        // Only schedule if in the future
        if (reminderDate > new Date()) {
          const result = await this.scheduleReminder(userId, {
            invoiceId,
            contactId,
            reminderType: 'upcoming_due',
            scheduledAt: reminderDate.toISOString(),
            channel: config.defaultChannel,
            metadata: { daysBefore }
          });

          if (result.data) {
            reminders.push(result.data);
          }
        }
      }

      // Schedule due day reminder
      if (dueDateObj > new Date()) {
        const result = await this.scheduleReminder(userId, {
          invoiceId,
          contactId,
          reminderType: 'due_today',
          scheduledAt: dueDateObj.toISOString(),
          channel: config.defaultChannel
        });

        if (result.data) {
          reminders.push(result.data);
        }
      }

      logger.info({
        invoiceId,
        remindersScheduled: reminders.length
      }, 'Invoice reminders scheduled');

      return { data: reminders, error: null };
    } catch (error) {
      logger.error({ err: error, userId, invoiceId }, 'Failed to schedule invoice reminders');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Schedule reminders for an installment
   */
  async scheduleInstallmentReminders(
    userId: string,
    installmentId: string,
    contactId: string,
    dueDate: string
  ): Promise<PaymentReminderServiceResult<PaymentReminder[]>> {
    try {
      const config = await this.getUserReminderConfig(userId);
      if (!config.enabled) {
        return { data: [], error: null };
      }

      const dueDateObj = new Date(dueDate);
      const reminders: PaymentReminder[] = [];

      // Schedule "days before" reminders
      for (const daysBefore of config.daysBefore) {
        const reminderDate = new Date(dueDateObj);
        reminderDate.setDate(reminderDate.getDate() - daysBefore);

        if (reminderDate > new Date()) {
          const result = await this.scheduleReminder(userId, {
            installmentId,
            contactId,
            reminderType: 'upcoming_due',
            scheduledAt: reminderDate.toISOString(),
            channel: config.defaultChannel,
            metadata: { daysBefore }
          });

          if (result.data) {
            reminders.push(result.data);
          }
        }
      }

      logger.info({
        installmentId,
        remindersScheduled: reminders.length
      }, 'Installment reminders scheduled');

      return { data: reminders, error: null };
    } catch (error) {
      logger.error({ err: error, userId, installmentId }, 'Failed to schedule installment reminders');
      return { data: null, error: error as Error };
    }
  }

  // ==================== SENDING ====================

  /**
   * Send a payment reminder immediately
   */
  async sendReminder(
    userId: string,
    params: SendReminderParams
  ): Promise<PaymentReminderServiceResult<{ sent: boolean; reminderId: string }>> {
    try {
      logger.info({
        userId,
        contactId: params.contactId,
        channel: params.channel
      }, 'Sending payment reminder');

      // Get contact info (user-scoped via the repository)
      const { data: contact } = await crmContactRepository.findById(params.contactId, userId);

      if (!contact) {
        throw new Error('Contact not found');
      }

      // Get invoice/installment details
      let entityDetails: Record<string, unknown> = {};

      if (params.invoiceId) {
        const { data: invoice } = await this.supabase
          .from('payment_invoices')
          .select('*')
          .eq('id', params.invoiceId)
          .eq('user_id', userId)
          .single();

        if (invoice) {
          entityDetails = {
            type: 'invoice',
            invoiceNumber: invoice.invoice_number,
            amount: invoice.amount,
            currency: invoice.currency,
            dueDate: invoice.due_date,
            status: invoice.status
          };
        }
      } else if (params.installmentId) {
        const { data: installment } = await this.supabase
          .from('payment_plan_installments')
          .select('*')
          .eq('id', params.installmentId)
          .eq('user_id', userId)
          .single();

        if (installment) {
          entityDetails = {
            type: 'installment',
            installmentNumber: installment.installment_number,
            amount: installment.amount,
            currency: installment.currency,
            dueDate: installment.due_date,
            status: installment.status
          };
        }
      }

      // Create reminder record
      const { data: reminder, error: createError } = await this.supabase
        .from('payment_reminders')
        .insert({
          user_id: userId,
          invoice_id: params.invoiceId || null,
          installment_id: params.installmentId || null,
          contact_id: params.contactId,
          reminder_type: 'upcoming_due',
          scheduled_at: new Date().toISOString(),
          channel: params.channel,
          template_id: params.templateId || null,
          status: 'pending',
          metadata: {
            ...params.metadata,
            ...entityDetails,
            includePaymentLink: params.includePaymentLink ?? true
          }
        })
        .select()
        .single();

      if (createError) throw createError;

      // Send based on channel
      let sent = false;
      let errorMessage: string | null = null;

      try {
        switch (params.channel) {
          case 'email':
            sent = await this.sendEmailReminder(
              userId,
              {
                email: contact.email ?? '',
                first_name: contact.first_name ?? '',
                last_name: contact.last_name ?? '',
              },
              entityDetails,
              params
            );
            break;
          case 'sms':
            sent = await this.sendSmsReminder({ phone: contact.phone ?? '' }, entityDetails);
            break;
          case 'in_app':
            sent = await this.sendInAppReminder(userId, params.contactId, entityDetails);
            break;
        }
      } catch (sendError) {
        errorMessage = sendError instanceof Error ? sendError.message : String(sendError);
        logger.error({ err: sendError, reminderId: reminder.id }, 'Failed to send reminder');
      }

      // Update reminder status
      await this.supabase
        .from('payment_reminders')
        .update({
          status: sent ? 'sent' : 'failed',
          sent_at: sent ? new Date().toISOString() : null,
          error_message: errorMessage,
          updated_at: new Date().toISOString()
        })
        .eq('id', reminder.id);

      // Emit event
      await emitPaymentEvent(userId, {
        eventType: sent ? 'reminder.sent' : 'reminder.failed',
        entityType: 'reminder',
        entityId: reminder.id,
        contactId: params.contactId,
        metadata: {
          channel: params.channel,
          invoiceId: params.invoiceId,
          installmentId: params.installmentId,
          error: errorMessage
        }
      });

      return {
        data: { sent, reminderId: reminder.id },
        error: null
      };
    } catch (error) {
      logger.error({ err: error, userId, params }, 'Failed to send reminder');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Send email reminder (placeholder - integrate with email service)
   */
  private async sendEmailReminder(
    userId: string,
    contact: { email: string; first_name: string; last_name: string },
    entityDetails: Record<string, unknown>,
    params: SendReminderParams
  ): Promise<boolean> {
    // TODO: Integrate with actual email service (SendGrid, Resend, etc.)
    // For now, log the email that would be sent

    logger.info({
      to: contact.email,
      contactName: `${contact.first_name} ${contact.last_name}`,
      entityType: entityDetails.type,
      amount: entityDetails.amount,
      currency: entityDetails.currency,
      dueDate: entityDetails.dueDate,
      includePaymentLink: params.includePaymentLink
    }, 'Would send payment reminder email');

    // In production, this would send an actual email
    // return await emailService.send({
    //   to: contact.email,
    //   template: params.templateId || 'payment_reminder',
    //   data: { ...entityDetails, contactName: contact.first_name }
    // });

    return true; // Simulated success
  }

  /**
   * Send SMS reminder (placeholder)
   */
  private async sendSmsReminder(
    contact: { phone: string },
    entityDetails: Record<string, unknown>
  ): Promise<boolean> {
    // TODO: Integrate with SMS service (Twilio, etc.)
    logger.info({
      to: contact.phone,
      amount: entityDetails.amount,
      dueDate: entityDetails.dueDate
    }, 'Would send payment reminder SMS');

    return true; // Simulated success
  }

  /**
   * Send in-app notification
   */
  private async sendInAppReminder(
    userId: string,
    contactId: string,
    entityDetails: Record<string, unknown>
  ): Promise<boolean> {
    // TODO: Integrate with in-app notification system
    logger.info({
      userId,
      contactId,
      amount: entityDetails.amount,
      dueDate: entityDetails.dueDate
    }, 'Would send in-app payment reminder');

    return true; // Simulated success
  }

  // ==================== CANCELLATION ====================

  /**
   * Cancel a specific reminder
   */
  async cancelReminder(
    reminderId: string,
    userId: string
  ): Promise<PaymentReminderServiceResult<void>> {
    try {
      const { error } = await this.supabase
        .from('payment_reminders')
        .update({
          status: 'cancelled',
          updated_at: new Date().toISOString()
        })
        .eq('id', reminderId)
        .eq('user_id', userId)
        .eq('status', 'pending');

      if (error) throw error;

      await emitPaymentEvent(userId, {
        eventType: 'reminder.cancelled',
        entityType: 'reminder',
        entityId: reminderId,
        metadata: {}
      });

      logger.info({ reminderId }, 'Reminder cancelled');
      return { data: null, error: null };
    } catch (error) {
      logger.error({ err: error, reminderId, userId }, 'Failed to cancel reminder');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Cancel all reminders for an invoice
   */
  async cancelInvoiceReminders(
    invoiceId: string,
    userId: string
  ): Promise<PaymentReminderServiceResult<number>> {
    try {
      const { data, error } = await this.supabase
        .from('payment_reminders')
        .update({
          status: 'cancelled',
          updated_at: new Date().toISOString()
        })
        .eq('invoice_id', invoiceId)
        .eq('user_id', userId)
        .eq('status', 'pending')
        .select();

      if (error) throw error;

      const cancelledCount = data?.length || 0;
      logger.info({ invoiceId, cancelledCount }, 'Invoice reminders cancelled');
      return { data: cancelledCount, error: null };
    } catch (error) {
      logger.error({ err: error, invoiceId, userId }, 'Failed to cancel invoice reminders');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Cancel all reminders for an installment
   */
  async cancelInstallmentReminders(
    installmentId: string,
    userId: string
  ): Promise<PaymentReminderServiceResult<number>> {
    try {
      const { data, error } = await this.supabase
        .from('payment_reminders')
        .update({
          status: 'cancelled',
          updated_at: new Date().toISOString()
        })
        .eq('installment_id', installmentId)
        .eq('user_id', userId)
        .eq('status', 'pending')
        .select();

      if (error) throw error;

      const cancelledCount = data?.length || 0;
      logger.info({ installmentId, cancelledCount }, 'Installment reminders cancelled');
      return { data: cancelledCount, error: null };
    } catch (error) {
      logger.error({ err: error, installmentId, userId }, 'Failed to cancel installment reminders');
      return { data: null, error: error as Error };
    }
  }

  // ==================== BATCH PROCESSING (CRON) ====================

  /**
   * Process all due reminders (called by cron)
   */
  async processDueReminders(): Promise<{
    processed: number;
    sent: number;
    failed: number;
  }> {
    const now = new Date().toISOString();
    const stats = { processed: 0, sent: 0, failed: 0 };

    logger.info('Processing due reminders');

    try {
      // Get pending reminders that are due
      const { data: reminders } = await this.supabase
        .from('payment_reminders')
        .select('*')
        .eq('status', 'pending')
        .lte('scheduled_at', now)
        .order('scheduled_at', { ascending: true })
        .limit(100);

      if (!reminders || reminders.length === 0) {
        logger.info('No due reminders to process');
        return stats;
      }

      logger.info({ count: reminders.length }, 'Found due reminders');

      for (const reminder of reminders) {
        try {
          const result = await this.sendReminder(reminder.user_id, {
            invoiceId: reminder.invoice_id || undefined,
            installmentId: reminder.installment_id || undefined,
            contactId: reminder.contact_id,
            channel: reminder.channel as ReminderChannel,
            templateId: reminder.template_id || undefined,
            includePaymentLink: true,
            metadata: reminder.metadata
          });

          stats.processed++;

          // Delete the pending reminder since we created a new one during send
          if (reminder.id) {
            await this.supabase
              .from('payment_reminders')
              .delete()
              .eq('id', reminder.id);
          }

          if (result.data?.sent) {
            stats.sent++;
          } else {
            stats.failed++;
          }
        } catch (error) {
          logger.error({ err: error, reminderId: reminder.id }, 'Error processing reminder');
          stats.failed++;

          // Mark as failed
          await this.supabase
            .from('payment_reminders')
            .update({
              status: 'failed',
              error_message: error instanceof Error ? error.message : String(error),
              updated_at: new Date().toISOString()
            })
            .eq('id', reminder.id);
        }
      }

      logger.info(stats, 'Completed processing due reminders');
      return stats;
    } catch (error) {
      logger.error({ err: error }, 'Failed to process due reminders');
      throw error;
    }
  }

  /**
   * Check for overdue items and schedule overdue reminders
   */
  async processOverdueItems(): Promise<{
    overdueInvoices: number;
    overdueInstallments: number;
    remindersScheduled: number;
  }> {
    const stats = { overdueInvoices: 0, overdueInstallments: 0, remindersScheduled: 0 };
    const today = new Date().toISOString().split('T')[0];

    logger.info('Checking for overdue items');

    try {
      // Get overdue invoices that don't have a recent overdue reminder
      const { data: overdueInvoices } = await this.supabase
        .from('payment_invoices')
        .select('id, user_id, contact_id, due_date')
        .eq('status', 'sent')
        .lt('due_date', today)
        .limit(100);

      if (overdueInvoices && overdueInvoices.length > 0) {
        stats.overdueInvoices = overdueInvoices.length;

        for (const invoice of overdueInvoices) {
          const dueDate = new Date(invoice.due_date);
          const overdueDays = Math.floor((Date.now() - dueDate.getTime()) / (1000 * 60 * 60 * 24));

          // Get user's overdue reminder days
          const config = await this.getUserReminderConfig(invoice.user_id);

          // Check if we should send an overdue reminder
          if (config.overdueDays.includes(overdueDays)) {
            // Check if we haven't already sent one for this day
            const { data: existingReminder } = await this.supabase
              .from('payment_reminders')
              .select('id')
              .eq('invoice_id', invoice.id)
              .eq('reminder_type', 'overdue')
              .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
              .limit(1);

            if (!existingReminder || existingReminder.length === 0) {
              if (invoice.contact_id) {
                const result = await this.scheduleReminder(invoice.user_id, {
                  invoiceId: invoice.id,
                  contactId: invoice.contact_id,
                  reminderType: 'overdue',
                  scheduledAt: new Date().toISOString(),
                  metadata: { overdueDays }
                });

                if (result.data) {
                  stats.remindersScheduled++;
                }

                // Emit overdue event
                await emitPaymentEvent(invoice.user_id, {
                  eventType: 'invoice.overdue',
                  entityType: 'invoice',
                  entityId: invoice.id,
                  contactId: invoice.contact_id,
                  metadata: { overdueDays }
                });
              }
            }
          }
        }
      }

      // Get overdue installments
      const { data: overdueInstallments } = await this.supabase
        .from('payment_plan_installments')
        .select('id, user_id, contact_id, due_date')
        .eq('status', 'pending')
        .lt('due_date', today)
        .limit(100);

      if (overdueInstallments && overdueInstallments.length > 0) {
        stats.overdueInstallments = overdueInstallments.length;

        for (const installment of overdueInstallments) {
          const dueDate = new Date(installment.due_date);
          const overdueDays = Math.floor((Date.now() - dueDate.getTime()) / (1000 * 60 * 60 * 24));

          const config = await this.getUserReminderConfig(installment.user_id);

          if (config.overdueDays.includes(overdueDays)) {
            const { data: existingReminder } = await this.supabase
              .from('payment_reminders')
              .select('id')
              .eq('installment_id', installment.id)
              .eq('reminder_type', 'overdue')
              .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
              .limit(1);

            if (!existingReminder || existingReminder.length === 0) {
              if (installment.contact_id) {
                const result = await this.scheduleReminder(installment.user_id, {
                  installmentId: installment.id,
                  contactId: installment.contact_id,
                  reminderType: 'overdue',
                  scheduledAt: new Date().toISOString(),
                  metadata: { overdueDays }
                });

                if (result.data) {
                  stats.remindersScheduled++;
                }

                // Emit overdue event
                await emitPaymentEvent(installment.user_id, {
                  eventType: 'installment.overdue',
                  entityType: 'installment',
                  entityId: installment.id,
                  contactId: installment.contact_id,
                  metadata: { overdueDays }
                });
              }
            }
          }

          // Update status to overdue
          await this.supabase
            .from('payment_plan_installments')
            .update({ status: 'overdue', updated_at: new Date().toISOString() })
            .eq('id', installment.id)
            .eq('status', 'pending');
        }
      }

      logger.info(stats, 'Completed processing overdue items');
      return stats;
    } catch (error) {
      logger.error({ err: error }, 'Failed to process overdue items');
      throw error;
    }
  }

  // ==================== CONFIGURATION ====================

  /**
   * Get user's reminder configuration
   */
  async getUserReminderConfig(userId: string): Promise<ReminderConfig> {
    try {
      const { data: profile } = await this.supabase
        .from('business_profiles')
        .select('payment_reminder_enabled, payment_reminder_days_before, payment_overdue_reminder_days, payment_reminder_channels')
        .eq('user_id', userId)
        .single();

      if (profile) {
        return {
          enabled: profile.payment_reminder_enabled ?? DEFAULT_REMINDER_CONFIG.enabled,
          daysBefore: profile.payment_reminder_days_before || DEFAULT_REMINDER_CONFIG.daysBefore,
          overdueDays: profile.payment_overdue_reminder_days || DEFAULT_REMINDER_CONFIG.overdueDays,
          channels: profile.payment_reminder_channels || DEFAULT_REMINDER_CONFIG.channels,
          defaultChannel: (profile.payment_reminder_channels?.[0] as ReminderChannel) || DEFAULT_REMINDER_CONFIG.defaultChannel
        };
      }

      return DEFAULT_REMINDER_CONFIG;
    } catch (error) {
      logger.warn({ err: error, userId }, 'Failed to get user reminder config, using defaults');
      return DEFAULT_REMINDER_CONFIG;
    }
  }

  /**
   * Update user's reminder configuration
   */
  async updateUserReminderConfig(
    userId: string,
    config: Partial<ReminderConfig>
  ): Promise<PaymentReminderServiceResult<ReminderConfig>> {
    try {
      const updates: Record<string, unknown> = {};

      if (config.enabled !== undefined) {
        updates.payment_reminder_enabled = config.enabled;
      }
      if (config.daysBefore !== undefined) {
        updates.payment_reminder_days_before = config.daysBefore;
      }
      if (config.overdueDays !== undefined) {
        updates.payment_overdue_reminder_days = config.overdueDays;
      }
      if (config.channels !== undefined) {
        updates.payment_reminder_channels = config.channels;
      }

      await this.supabase
        .from('business_profiles')
        .update(updates)
        .eq('user_id', userId);

      const newConfig = await this.getUserReminderConfig(userId);
      return { data: newConfig, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to update reminder config');
      return { data: null, error: error as Error };
    }
  }

  // ==================== QUERIES ====================

  /**
   * Get reminders for an entity
   */
  async getReminders(
    userId: string,
    options: {
      invoiceId?: string;
      installmentId?: string;
      contactId?: string;
      status?: ReminderStatus;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<PaymentReminderServiceResult<PaymentReminder[]>> {
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
      logger.error({ err: error, userId, options }, 'Failed to get reminders');
      return { data: null, error: error as Error };
    }
  }
}

// Singleton export
import { supabaseServer } from '@/lib/supabaseServer';
export const paymentReminderService = new PaymentReminderService(supabaseServer);
