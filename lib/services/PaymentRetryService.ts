/**
 * Payment Retry Service
 *
 * Handles automatic payment retries for failed payments.
 * This service:
 * 1. Schedules retries with configurable intervals
 * 2. Executes retries using saved payment methods
 * 3. Respects user-configured retry limits and intervals
 * 4. Emits events for AI kernel consumption
 *
 * The retry system works with both invoices and installments.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';
import { emitPaymentEvent, PaymentProcessorType } from '@/lib/services/PaymentEventService';
import { paymentProcessorService } from '@/lib/services/PaymentProcessorService';
import {
  paymentInvoiceRepository,
  PaymentInvoice
} from '@/lib/repositories/PaymentRepository';
import {
  paymentPlanRepository,
  PaymentPlanInstallment
} from '@/lib/repositories/PaymentPlanRepository';

const logger = createLogger({ service: 'PaymentRetryService' });

// ==================== TYPES ====================

export interface RetryConfig {
  enabled: boolean;
  intervals: number[]; // Hours between retries
  maxRetries: number;
}

export interface RetryResult {
  success: boolean;
  entityType: 'invoice' | 'installment';
  entityId: string;
  retryCount: number;
  nextRetryAt: string | null;
  error?: string;
}

export interface PaymentRetryServiceResult<T> {
  data: T | null;
  error: Error | null;
}

// Default retry config
const DEFAULT_RETRY_CONFIG: RetryConfig = {
  enabled: true,
  intervals: [1, 4, 24], // 1 hour, 4 hours, 24 hours
  maxRetries: 3
};

// ==================== SERVICE ====================

export class PaymentRetryService {
  private supabase: SupabaseClient;

  constructor(supabaseClient: SupabaseClient) {
    this.supabase = supabaseClient;
  }

  // ==================== RETRY SCHEDULING ====================

  /**
   * Schedule a retry for an invoice
   */
  async scheduleInvoiceRetry(
    invoiceId: string,
    userId: string,
    delayHours?: number
  ): Promise<PaymentRetryServiceResult<RetryResult>> {
    try {
      logger.info({ invoiceId, userId, delayHours }, 'Scheduling invoice retry');

      // Get invoice
      const invoiceResult = await paymentInvoiceRepository.findById(invoiceId, userId);
      if (invoiceResult.error || !invoiceResult.data) {
        throw new Error('Invoice not found');
      }

      const invoice = invoiceResult.data;

      // Get retry config
      const config = await this.getUserRetryConfig(userId);
      if (!config.enabled) {
        return {
          data: {
            success: false,
            entityType: 'invoice',
            entityId: invoiceId,
            retryCount: invoice.retry_count,
            nextRetryAt: null,
            error: 'Automatic retry is disabled'
          },
          error: null
        };
      }

      // Check if max retries reached
      if (invoice.retry_count >= config.maxRetries) {
        // Emit retry exhausted event
        await emitPaymentEvent(userId, {
          eventType: 'payment.retry_exhausted',
          entityType: 'invoice',
          entityId: invoiceId,
          contactId: invoice.contact_id,
          metadata: {
            retryCount: invoice.retry_count,
            maxRetries: config.maxRetries
          }
        });

        return {
          data: {
            success: false,
            entityType: 'invoice',
            entityId: invoiceId,
            retryCount: invoice.retry_count,
            nextRetryAt: null,
            error: 'Max retries reached'
          },
          error: null
        };
      }

      // Calculate next retry time
      const hours = delayHours ?? config.intervals[invoice.retry_count] ?? config.intervals[config.intervals.length - 1];
      const nextRetryAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

      // Update invoice
      await paymentInvoiceRepository.updateRetryInfo(invoiceId, userId, {
        retryCount: invoice.retry_count,
        lastRetryAt: new Date().toISOString(),
        nextRetryAt
      });

      // Emit event
      await emitPaymentEvent(userId, {
        eventType: 'payment.retry_scheduled',
        entityType: 'invoice',
        entityId: invoiceId,
        contactId: invoice.contact_id,
        metadata: {
          retryCount: invoice.retry_count,
          nextRetryAt,
          delayHours: hours
        }
      });

      logger.info({ invoiceId, nextRetryAt }, 'Invoice retry scheduled');

      return {
        data: {
          success: true,
          entityType: 'invoice',
          entityId: invoiceId,
          retryCount: invoice.retry_count,
          nextRetryAt
        },
        error: null
      };
    } catch (error) {
      logger.error({ err: error, invoiceId, userId }, 'Failed to schedule invoice retry');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Schedule a retry for an installment
   */
  async scheduleInstallmentRetry(
    installmentId: string,
    userId: string,
    delayHours?: number
  ): Promise<PaymentRetryServiceResult<RetryResult>> {
    try {
      logger.info({ installmentId, userId, delayHours }, 'Scheduling installment retry');

      // Get installment
      const { data: installment, error: fetchError } = await this.supabase
        .from('payment_plan_installments')
        .select('*')
        .eq('id', installmentId)
        .eq('user_id', userId)
        .single();

      if (fetchError || !installment) {
        throw new Error('Installment not found');
      }

      // Get retry config
      const config = await this.getUserRetryConfig(userId);
      if (!config.enabled) {
        return {
          data: {
            success: false,
            entityType: 'installment',
            entityId: installmentId,
            retryCount: installment.retry_count,
            nextRetryAt: null,
            error: 'Automatic retry is disabled'
          },
          error: null
        };
      }

      // Check if max retries reached
      if (installment.retry_count >= config.maxRetries) {
        await emitPaymentEvent(userId, {
          eventType: 'payment.retry_exhausted',
          entityType: 'installment',
          entityId: installmentId,
          contactId: installment.contact_id,
          metadata: {
            retryCount: installment.retry_count,
            maxRetries: config.maxRetries
          }
        });

        return {
          data: {
            success: false,
            entityType: 'installment',
            entityId: installmentId,
            retryCount: installment.retry_count,
            nextRetryAt: null,
            error: 'Max retries reached'
          },
          error: null
        };
      }

      // Calculate next retry time
      const hours = delayHours ?? config.intervals[installment.retry_count] ?? config.intervals[config.intervals.length - 1];
      const nextRetryAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

      // Update installment
      await paymentPlanRepository.updateInstallment(installmentId, userId, {
        last_retry_at: new Date().toISOString(),
        next_retry_at: nextRetryAt
      });

      // Emit event
      await emitPaymentEvent(userId, {
        eventType: 'payment.retry_scheduled',
        entityType: 'installment',
        entityId: installmentId,
        contactId: installment.contact_id,
        metadata: {
          retryCount: installment.retry_count,
          nextRetryAt,
          delayHours: hours
        }
      });

      logger.info({ installmentId, nextRetryAt }, 'Installment retry scheduled');

      return {
        data: {
          success: true,
          entityType: 'installment',
          entityId: installmentId,
          retryCount: installment.retry_count,
          nextRetryAt
        },
        error: null
      };
    } catch (error) {
      logger.error({ err: error, installmentId, userId }, 'Failed to schedule installment retry');
      return { data: null, error: error as Error };
    }
  }

  // ==================== RETRY EXECUTION ====================

  /**
   * Execute retry for an invoice
   */
  async executeInvoiceRetry(
    invoiceId: string,
    userId: string,
    force: boolean = false
  ): Promise<PaymentRetryServiceResult<RetryResult>> {
    try {
      logger.info({ invoiceId, userId, force }, 'Executing invoice retry');

      // Get invoice
      const invoiceResult = await paymentInvoiceRepository.findById(invoiceId, userId);
      if (invoiceResult.error || !invoiceResult.data) {
        throw new Error('Invoice not found');
      }

      const invoice = invoiceResult.data;

      // Check if already paid
      if (invoice.status === 'paid') {
        return {
          data: {
            success: true,
            entityType: 'invoice',
            entityId: invoiceId,
            retryCount: invoice.retry_count,
            nextRetryAt: null,
            error: 'Invoice already paid'
          },
          error: null
        };
      }

      // Get retry config
      const config = await this.getUserRetryConfig(userId);

      // Check max retries (unless forced)
      if (!force && invoice.retry_count >= config.maxRetries) {
        return {
          data: {
            success: false,
            entityType: 'invoice',
            entityId: invoiceId,
            retryCount: invoice.retry_count,
            nextRetryAt: null,
            error: 'Max retries reached'
          },
          error: null
        };
      }

      // Emit retry attempted event
      await emitPaymentEvent(userId, {
        eventType: 'payment.retry_attempted',
        entityType: 'invoice',
        entityId: invoiceId,
        contactId: invoice.contact_id,
        processorType: invoice.processor_type as PaymentProcessorType,
        metadata: { retryCount: invoice.retry_count + 1 }
      });

      // Try to charge saved payment method
      if (invoice.contact_id && invoice.processor_payment_method_id) {
        const chargeResult = await paymentProcessorService.chargeWithSavedMethod(
          userId,
          {
            amount: invoice.amount,
            currency: invoice.currency,
            contactId: invoice.contact_id,
            savedMethodId: invoice.processor_payment_method_id,
            invoiceId: invoiceId,
            description: `Retry payment for invoice ${invoice.invoice_number}`
          },
          invoice.processor_type as PaymentProcessorType
        );

        if (chargeResult.data && chargeResult.data.status === 'succeeded') {
          // Mark invoice as paid
          await paymentInvoiceRepository.markAsPaid(invoiceId, userId, {
            paymentMethod: 'card',
            processorType: invoice.processor_type || undefined,
            notes: `Paid via automatic retry (attempt ${invoice.retry_count + 1})`
          });

          // Emit success event
          await emitPaymentEvent(userId, {
            eventType: 'payment.retry_succeeded',
            entityType: 'invoice',
            entityId: invoiceId,
            contactId: invoice.contact_id,
            processorType: invoice.processor_type as PaymentProcessorType,
            metadata: {
              retryCount: invoice.retry_count + 1,
              transactionId: chargeResult.data.transactionId
            }
          });

          logger.info({ invoiceId, retryCount: invoice.retry_count + 1 }, 'Invoice retry succeeded');

          return {
            data: {
              success: true,
              entityType: 'invoice',
              entityId: invoiceId,
              retryCount: invoice.retry_count + 1,
              nextRetryAt: null
            },
            error: null
          };
        }

        // Retry failed
        const newRetryCount = invoice.retry_count + 1;

        // Emit failure event
        await emitPaymentEvent(userId, {
          eventType: 'payment.retry_failed',
          entityType: 'invoice',
          entityId: invoiceId,
          contactId: invoice.contact_id,
          processorType: invoice.processor_type as PaymentProcessorType,
          metadata: {
            retryCount: newRetryCount,
            error: chargeResult.error?.message || chargeResult.data?.failureReason
          }
        });

        // Schedule next retry if not at max
        let nextRetryAt: string | null = null;
        if (newRetryCount < config.maxRetries) {
          const hours = config.intervals[newRetryCount] ?? config.intervals[config.intervals.length - 1];
          nextRetryAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
        }

        // Update invoice
        await paymentInvoiceRepository.updateRetryInfo(invoiceId, userId, {
          retryCount: newRetryCount,
          lastRetryAt: new Date().toISOString(),
          nextRetryAt
        });

        logger.info({ invoiceId, retryCount: newRetryCount, nextRetryAt }, 'Invoice retry failed');

        return {
          data: {
            success: false,
            entityType: 'invoice',
            entityId: invoiceId,
            retryCount: newRetryCount,
            nextRetryAt,
            error: chargeResult.error?.message || 'Payment failed'
          },
          error: null
        };
      }

      // No saved payment method
      return {
        data: {
          success: false,
          entityType: 'invoice',
          entityId: invoiceId,
          retryCount: invoice.retry_count,
          nextRetryAt: null,
          error: 'No saved payment method available'
        },
        error: null
      };
    } catch (error) {
      logger.error({ err: error, invoiceId, userId }, 'Failed to execute invoice retry');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Execute retry for an installment
   */
  async executeInstallmentRetry(
    installmentId: string,
    userId: string,
    force: boolean = false
  ): Promise<PaymentRetryServiceResult<RetryResult>> {
    try {
      logger.info({ installmentId, userId, force }, 'Executing installment retry');

      // Get installment
      const { data: installment, error: fetchError } = await this.supabase
        .from('payment_plan_installments')
        .select('*')
        .eq('id', installmentId)
        .eq('user_id', userId)
        .single();

      if (fetchError || !installment) {
        throw new Error('Installment not found');
      }

      // Check if already paid
      if (installment.status === 'paid') {
        return {
          data: {
            success: true,
            entityType: 'installment',
            entityId: installmentId,
            retryCount: installment.retry_count,
            nextRetryAt: null,
            error: 'Installment already paid'
          },
          error: null
        };
      }

      // Get retry config
      const config = await this.getUserRetryConfig(userId);

      // Check max retries
      if (!force && installment.retry_count >= config.maxRetries) {
        return {
          data: {
            success: false,
            entityType: 'installment',
            entityId: installmentId,
            retryCount: installment.retry_count,
            nextRetryAt: null,
            error: 'Max retries reached'
          },
          error: null
        };
      }

      // Get contact's saved payment method
      const savedMethodsResult = await paymentProcessorService.getSavedPaymentMethods(
        userId,
        installment.contact_id
      );

      if (!savedMethodsResult.data || savedMethodsResult.data.length === 0) {
        return {
          data: {
            success: false,
            entityType: 'installment',
            entityId: installmentId,
            retryCount: installment.retry_count,
            nextRetryAt: null,
            error: 'No saved payment method available'
          },
          error: null
        };
      }

      const savedMethod = savedMethodsResult.data.find(m => m.isDefault) || savedMethodsResult.data[0];

      // Emit retry attempted event
      await emitPaymentEvent(userId, {
        eventType: 'payment.retry_attempted',
        entityType: 'installment',
        entityId: installmentId,
        contactId: installment.contact_id,
        processorType: savedMethod.processorType,
        metadata: { retryCount: installment.retry_count + 1 }
      });

      // Try to charge
      const chargeResult = await paymentProcessorService.chargeWithSavedMethod(
        userId,
        {
          amount: installment.amount,
          currency: installment.currency,
          contactId: installment.contact_id,
          savedMethodId: savedMethod.id,
          installmentId: installmentId,
          description: `Retry payment for installment ${installment.installment_number}`
        },
        savedMethod.processorType
      );

      if (chargeResult.data && chargeResult.data.status === 'succeeded') {
        // Mark installment as paid
        await paymentPlanRepository.markInstallmentPaid(installmentId, userId, {
          paymentMethod: 'card',
          processorType: savedMethod.processorType,
          transactionId: chargeResult.data.transactionId
        });

        // Emit success event
        await emitPaymentEvent(userId, {
          eventType: 'payment.retry_succeeded',
          entityType: 'installment',
          entityId: installmentId,
          contactId: installment.contact_id,
          processorType: savedMethod.processorType,
          metadata: {
            retryCount: installment.retry_count + 1,
            transactionId: chargeResult.data.transactionId
          }
        });

        logger.info({ installmentId, retryCount: installment.retry_count + 1 }, 'Installment retry succeeded');

        return {
          data: {
            success: true,
            entityType: 'installment',
            entityId: installmentId,
            retryCount: installment.retry_count + 1,
            nextRetryAt: null
          },
          error: null
        };
      }

      // Retry failed
      const newRetryCount = installment.retry_count + 1;

      // Emit failure event
      await emitPaymentEvent(userId, {
        eventType: 'payment.retry_failed',
        entityType: 'installment',
        entityId: installmentId,
        contactId: installment.contact_id,
        processorType: savedMethod.processorType,
        metadata: {
          retryCount: newRetryCount,
          error: chargeResult.error?.message || chargeResult.data?.failureReason
        }
      });

      // Schedule next retry
      let nextRetryAt: string | null = null;
      if (newRetryCount < config.maxRetries) {
        const hours = config.intervals[newRetryCount] ?? config.intervals[config.intervals.length - 1];
        nextRetryAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
      }

      // Update installment
      await paymentPlanRepository.updateInstallment(installmentId, userId, {
        retry_count: newRetryCount,
        last_retry_at: new Date().toISOString(),
        next_retry_at: nextRetryAt
      });

      logger.info({ installmentId, retryCount: newRetryCount, nextRetryAt }, 'Installment retry failed');

      return {
        data: {
          success: false,
          entityType: 'installment',
          entityId: installmentId,
          retryCount: newRetryCount,
          nextRetryAt,
          error: chargeResult.error?.message || 'Payment failed'
        },
        error: null
      };
    } catch (error) {
      logger.error({ err: error, installmentId, userId }, 'Failed to execute installment retry');
      return { data: null, error: error as Error };
    }
  }

  // ==================== CANCELLATION ====================

  /**
   * Cancel scheduled retries for an invoice
   */
  async cancelInvoiceRetry(invoiceId: string, userId: string): Promise<PaymentRetryServiceResult<void>> {
    try {
      await paymentInvoiceRepository.updateRetryInfo(invoiceId, userId, {
        retryCount: 0,
        lastRetryAt: new Date().toISOString(),
        nextRetryAt: null
      });

      logger.info({ invoiceId }, 'Invoice retry cancelled');
      return { data: null, error: null };
    } catch (error) {
      logger.error({ err: error, invoiceId, userId }, 'Failed to cancel invoice retry');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Cancel scheduled retries for an installment
   */
  async cancelInstallmentRetry(installmentId: string, userId: string): Promise<PaymentRetryServiceResult<void>> {
    try {
      await paymentPlanRepository.updateInstallment(installmentId, userId, {
        next_retry_at: null
      });

      logger.info({ installmentId }, 'Installment retry cancelled');
      return { data: null, error: null };
    } catch (error) {
      logger.error({ err: error, installmentId, userId }, 'Failed to cancel installment retry');
      return { data: null, error: error as Error };
    }
  }

  // ==================== BATCH PROCESSING (CRON) ====================

  /**
   * Process all due retries (called by cron)
   */
  async processDueRetries(): Promise<{
    processedInvoices: number;
    processedInstallments: number;
    successCount: number;
    failureCount: number;
  }> {
    const now = new Date().toISOString();
    const stats = {
      processedInvoices: 0,
      processedInstallments: 0,
      successCount: 0,
      failureCount: 0
    };

    logger.info('Processing due retries');

    try {
      // Get invoices due for retry
      const { data: invoices } = await this.supabase
        .from('payment_invoices')
        .select('id, user_id')
        .in('status', ['sent', 'overdue'])
        .not('next_retry_at', 'is', null)
        .lte('next_retry_at', now)
        .limit(100);

      if (invoices && invoices.length > 0) {
        logger.info({ count: invoices.length }, 'Processing invoice retries');

        for (const invoice of invoices) {
          try {
            const result = await this.executeInvoiceRetry(invoice.id, invoice.user_id);
            stats.processedInvoices++;
            if (result.data?.success) {
              stats.successCount++;
            } else {
              stats.failureCount++;
            }
          } catch (error) {
            logger.error({ err: error, invoiceId: invoice.id }, 'Error processing invoice retry');
            stats.failureCount++;
          }
        }
      }

      // Get installments due for retry
      const { data: installments } = await this.supabase
        .from('payment_plan_installments')
        .select('id, user_id')
        .eq('status', 'pending')
        .not('next_retry_at', 'is', null)
        .lte('next_retry_at', now)
        .limit(100);

      if (installments && installments.length > 0) {
        logger.info({ count: installments.length }, 'Processing installment retries');

        for (const installment of installments) {
          try {
            const result = await this.executeInstallmentRetry(installment.id, installment.user_id);
            stats.processedInstallments++;
            if (result.data?.success) {
              stats.successCount++;
            } else {
              stats.failureCount++;
            }
          } catch (error) {
            logger.error({ err: error, installmentId: installment.id }, 'Error processing installment retry');
            stats.failureCount++;
          }
        }
      }

      logger.info(stats, 'Completed processing due retries');
      return stats;
    } catch (error) {
      logger.error({ err: error }, 'Failed to process due retries');
      throw error;
    }
  }

  // ==================== CONFIGURATION ====================

  /**
   * Get user's retry configuration
   */
  async getUserRetryConfig(userId: string): Promise<RetryConfig> {
    try {
      const { data: profile } = await this.supabase
        .from('business_profiles')
        .select('payment_retry_enabled, payment_retry_intervals, payment_max_retries')
        .eq('user_id', userId)
        .single();

      if (profile) {
        return {
          enabled: profile.payment_retry_enabled ?? DEFAULT_RETRY_CONFIG.enabled,
          intervals: profile.payment_retry_intervals || DEFAULT_RETRY_CONFIG.intervals,
          maxRetries: profile.payment_max_retries ?? DEFAULT_RETRY_CONFIG.maxRetries
        };
      }

      return DEFAULT_RETRY_CONFIG;
    } catch (error) {
      logger.warn({ err: error, userId }, 'Failed to get user retry config, using defaults');
      return DEFAULT_RETRY_CONFIG;
    }
  }

  /**
   * Update user's retry configuration
   */
  async updateUserRetryConfig(
    userId: string,
    config: Partial<RetryConfig>
  ): Promise<PaymentRetryServiceResult<RetryConfig>> {
    try {
      const updates: Record<string, unknown> = {};

      if (config.enabled !== undefined) {
        updates.payment_retry_enabled = config.enabled;
      }
      if (config.intervals !== undefined) {
        updates.payment_retry_intervals = config.intervals;
      }
      if (config.maxRetries !== undefined) {
        updates.payment_max_retries = config.maxRetries;
      }

      await this.supabase
        .from('business_profiles')
        .update(updates)
        .eq('user_id', userId);

      const newConfig = await this.getUserRetryConfig(userId);
      return { data: newConfig, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to update retry config');
      return { data: null, error: error as Error };
    }
  }
}

// Singleton export
import { supabaseServer } from '@/lib/supabaseServer';
export const paymentRetryService = new PaymentRetryService(supabaseServer);
