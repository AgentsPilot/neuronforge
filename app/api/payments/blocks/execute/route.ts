/**
 * Payment Block Execution API
 *
 * POST /api/payments/blocks/execute - Execute a payment building block
 *
 * This is the core endpoint for:
 * 1. AI automation kernel - to trigger payment actions programmatically
 * 2. Automation rules engine - to execute blocks based on events
 * 3. UI components - to perform payment operations
 *
 * Each block execution:
 * - Validates parameters
 * - Executes the action
 * - Emits relevant events
 * - Returns result with events emitted
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import type { EntityType } from '@/lib/audit/types';
import {
  getBlock,
  validateBlockParameters,
  PaymentBuildingBlock
} from '@/lib/payments/PaymentBuildingBlocks';
import {
  PaymentEventService,
  PaymentEventType,
  PaymentProcessorType,
  emitPaymentEvent
} from '@/lib/services/PaymentEventService';
import { paymentProcessorService } from '@/lib/services/PaymentProcessorService';
import {
  paymentTransactionRepository,
  paymentInvoiceRepository
} from '@/lib/repositories/PaymentRepository';
import { paymentPlanRepository } from '@/lib/repositories/PaymentPlanRepository';
import { paymentReminderRepository } from '@/lib/repositories/PaymentReminderRepository';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ module: 'PaymentBlockExecuteAPI' });
const auditTrail = AuditTrailService.getInstance();

// ==================== REQUEST SCHEMA ====================

const ExecuteBlockSchema = z.object({
  block_id: z.string().min(1, 'Block ID is required'),
  parameters: z.record(z.unknown()).default({})
});

// ==================== TYPES ====================

interface BlockExecutionResult {
  success: boolean;
  block_id: string;
  result: unknown;
  events_emitted: PaymentEventType[];
  error?: string;
}

// ==================== BLOCK EXECUTORS ====================

/**
 * Execute collect_payment block
 */
async function executeCollectPayment(
  userId: string,
  params: Record<string, unknown>
): Promise<{ result: unknown; events: PaymentEventType[] }> {
  const { invoice_id, booking_id, installment_id, amount, currency, processor, success_url, cancel_url } = params;

  // Build checkout request
  const checkoutRequest = {
    amount: amount as number,
    currency: (currency as string) || 'USD',
    invoiceId: invoice_id as string | undefined,
    bookingId: booking_id as string | undefined,
    installmentId: installment_id as string | undefined,
    successUrl: (success_url as string) || `${process.env.NEXT_PUBLIC_APP_URL}/payments/success`,
    cancelUrl: (cancel_url as string) || `${process.env.NEXT_PUBLIC_APP_URL}/payments/cancelled`
  };

  // If invoice_id provided, get invoice amount
  if (invoice_id && !amount) {
    const invoiceResult = await paymentInvoiceRepository.findById(invoice_id as string, userId);
    if (invoiceResult.data) {
      checkoutRequest.amount = invoiceResult.data.amount;
      checkoutRequest.currency = invoiceResult.data.currency;
    }
  }

  // Create checkout session
  const result = await paymentProcessorService.createCheckoutSession(
    userId,
    checkoutRequest,
    processor as PaymentProcessorType | undefined
  );

  if (result.error) {
    throw result.error;
  }

  // Emit checkout created event
  const entityId = invoice_id || booking_id || installment_id || result.data!.sessionId;
  await emitPaymentEvent(userId, {
    eventType: 'payment.checkout_created',
    entityType: 'invoice',
    entityId: entityId as string,
    processorType: result.data!.processorType,
    metadata: {
      sessionId: result.data!.sessionId,
      checkoutUrl: result.data!.checkoutUrl,
      amount: checkoutRequest.amount,
      currency: checkoutRequest.currency
    }
  });

  return {
    result: {
      sessionId: result.data!.sessionId,
      checkoutUrl: result.data!.checkoutUrl,
      processorType: result.data!.processorType
    },
    events: ['payment.checkout_created']
  };
}

/**
 * Execute record_manual_payment block
 */
async function executeRecordManualPayment(
  userId: string,
  params: Record<string, unknown>
): Promise<{ result: unknown; events: PaymentEventType[] }> {
  const { invoice_id, booking_id, installment_id, contact_id, amount, currency, method, notes, received_at } = params;

  // Record the manual payment
  const result = await paymentTransactionRepository.recordManualPayment(userId, {
    contactId: contact_id as string | undefined,
    invoiceId: invoice_id as string | undefined,
    amount: amount as number,
    currency: currency as string,
    paymentMethod: method as 'cash' | 'bank_transfer' | 'check' | 'other',
    notes: notes as string | undefined,
    receivedAt: received_at as string | undefined
  });

  if (result.error) {
    throw result.error;
  }

  // If invoice provided, mark as paid
  if (invoice_id) {
    await paymentInvoiceRepository.markAsPaid(invoice_id as string, userId, {
      paymentMethod: method as string,
      processorType: 'manual',
      notes: notes as string | undefined,
      receivedAt: received_at as string | undefined
    });
  }

  // If installment provided, mark as paid
  if (installment_id) {
    await paymentPlanRepository.markInstallmentPaid(installment_id as string, userId, {
      paymentMethod: method as string,
      processorType: 'manual',
      transactionId: result.data!.id
    });
  }

  // Emit event
  await emitPaymentEvent(userId, {
    eventType: 'payment.manual_recorded',
    entityType: 'transaction',
    entityId: result.data!.id,
    contactId: contact_id as string | undefined,
    processorType: 'manual',
    metadata: {
      amount,
      currency,
      method,
      invoiceId: invoice_id,
      bookingId: booking_id,
      installmentId: installment_id
    }
  });

  return {
    result: {
      transactionId: result.data!.id,
      amount: result.data!.amount,
      currency: result.data!.currency,
      method: result.data!.payment_method
    },
    events: ['payment.manual_recorded']
  };
}

/**
 * Execute refund_full block
 */
async function executeRefundFull(
  userId: string,
  params: Record<string, unknown>
): Promise<{ result: unknown; events: PaymentEventType[] }> {
  const { transaction_id, reason, notify_contact } = params;

  // Get transaction
  const txResult = await paymentTransactionRepository.findById(transaction_id as string, userId);
  if (txResult.error || !txResult.data) {
    throw new Error('Transaction not found');
  }

  const transaction = txResult.data;
  const events: PaymentEventType[] = ['refund.initiated'];

  // Emit initiated event
  await emitPaymentEvent(userId, {
    eventType: 'refund.initiated',
    entityType: 'transaction',
    entityId: transaction_id as string,
    contactId: transaction.contact_id,
    processorType: transaction.processor_type as PaymentProcessorType,
    metadata: { amount: transaction.amount, reason, isFullRefund: true }
  });

  // Process refund based on processor
  if (transaction.processor_type && transaction.processor_type !== 'manual') {
    // Use processor to refund
    const refundResult = await paymentProcessorService.processRefund(
      userId,
      {
        processorTransactionId: transaction.stripe_payment_intent_id || transaction.stripe_charge_id || '',
        amount: transaction.amount,
        reason: reason as string
      },
      transaction.processor_type as PaymentProcessorType
    );

    if (refundResult.error) {
      await emitPaymentEvent(userId, {
        eventType: 'refund.failed',
        entityType: 'transaction',
        entityId: transaction_id as string,
        metadata: { error: refundResult.error.message }
      });
      throw refundResult.error;
    }
  }

  // Update transaction with refund info
  const result = await paymentTransactionRepository.createRefund(transaction_id as string, userId, {
    amount: transaction.amount,
    reason: reason as string | undefined,
    isFullRefund: true
  });

  if (result.error) {
    await emitPaymentEvent(userId, {
      eventType: 'refund.failed',
      entityType: 'transaction',
      entityId: transaction_id as string,
      metadata: { error: result.error.message }
    });
    throw result.error;
  }

  // Emit completed event
  await emitPaymentEvent(userId, {
    eventType: 'refund.completed',
    entityType: 'transaction',
    entityId: transaction_id as string,
    contactId: transaction.contact_id,
    metadata: {
      amount: transaction.amount,
      reason,
      isFullRefund: true,
      notifyContact: notify_contact
    }
  });
  events.push('refund.completed');

  return {
    result: {
      transactionId: transaction_id,
      refundedAmount: transaction.amount,
      refundStatus: 'full'
    },
    events
  };
}

/**
 * Execute refund_partial block
 */
async function executeRefundPartial(
  userId: string,
  params: Record<string, unknown>
): Promise<{ result: unknown; events: PaymentEventType[] }> {
  const { transaction_id, amount, reason, notify_contact } = params;

  // Get transaction
  const txResult = await paymentTransactionRepository.findById(transaction_id as string, userId);
  if (txResult.error || !txResult.data) {
    throw new Error('Transaction not found');
  }

  const transaction = txResult.data;
  const refundAmount = amount as number;

  // Validate refund amount
  const alreadyRefunded = transaction.refunded_amount || 0;
  const maxRefundable = transaction.amount - alreadyRefunded;
  if (refundAmount > maxRefundable) {
    throw new Error(`Cannot refund ${refundAmount}. Maximum refundable: ${maxRefundable}`);
  }

  const events: PaymentEventType[] = ['refund.initiated'];

  // Emit initiated event
  await emitPaymentEvent(userId, {
    eventType: 'refund.initiated',
    entityType: 'transaction',
    entityId: transaction_id as string,
    contactId: transaction.contact_id,
    metadata: { amount: refundAmount, reason, isFullRefund: false }
  });

  // Process refund based on processor
  if (transaction.processor_type && transaction.processor_type !== 'manual') {
    const refundResult = await paymentProcessorService.processRefund(
      userId,
      {
        processorTransactionId: transaction.stripe_payment_intent_id || transaction.stripe_charge_id || '',
        amount: refundAmount,
        reason: reason as string
      },
      transaction.processor_type as PaymentProcessorType
    );

    if (refundResult.error) {
      await emitPaymentEvent(userId, {
        eventType: 'refund.failed',
        entityType: 'transaction',
        entityId: transaction_id as string,
        metadata: { error: refundResult.error.message }
      });
      throw refundResult.error;
    }
  }

  // Update transaction
  const totalRefunded = alreadyRefunded + refundAmount;
  const isNowFullyRefunded = totalRefunded >= transaction.amount;

  const result = await paymentTransactionRepository.createRefund(transaction_id as string, userId, {
    amount: totalRefunded,
    reason: reason as string | undefined,
    isFullRefund: isNowFullyRefunded
  });

  if (result.error) {
    await emitPaymentEvent(userId, {
      eventType: 'refund.failed',
      entityType: 'transaction',
      entityId: transaction_id as string,
      metadata: { error: result.error.message }
    });
    throw result.error;
  }

  await emitPaymentEvent(userId, {
    eventType: 'refund.completed',
    entityType: 'transaction',
    entityId: transaction_id as string,
    contactId: transaction.contact_id,
    metadata: {
      amount: refundAmount,
      totalRefunded,
      reason,
      isFullRefund: isNowFullyRefunded,
      notifyContact: notify_contact
    }
  });
  events.push('refund.completed');

  return {
    result: {
      transactionId: transaction_id,
      refundedAmount: refundAmount,
      totalRefunded,
      refundStatus: isNowFullyRefunded ? 'full' : 'partial'
    },
    events
  };
}

/**
 * Execute create_payment_plan block
 */
async function executeCreatePaymentPlan(
  userId: string,
  params: Record<string, unknown>
): Promise<{ result: unknown; events: PaymentEventType[] }> {
  const {
    name, description, total_amount, currency, supported_currencies,
    installment_count, frequency, service_id, allowed_processors
  } = params;

  const installmentAmount = (total_amount as number) / (installment_count as number);

  const result = await paymentPlanRepository.create({
    user_id: userId,
    name: name as string,
    description: description as string | undefined,
    total_amount: total_amount as number,
    currency: currency as string,
    supported_currencies: (supported_currencies as string[]) || [currency as string],
    installment_count: installment_count as number,
    installment_amount: Math.round(installmentAmount * 100) / 100,
    installment_frequency: frequency as 'weekly' | 'biweekly' | 'monthly',
    service_id: service_id as string | undefined,
    allowed_processors: allowed_processors as string[] | undefined
  });

  if (result.error) {
    throw result.error;
  }

  await emitPaymentEvent(userId, {
    eventType: 'plan.created',
    entityType: 'plan',
    entityId: result.data!.id,
    metadata: {
      name,
      totalAmount: total_amount,
      currency,
      installmentCount: installment_count,
      frequency
    }
  });

  return {
    result: {
      planId: result.data!.id,
      name: result.data!.name,
      totalAmount: result.data!.total_amount,
      installmentCount: result.data!.installment_count,
      installmentAmount: result.data!.installment_amount
    },
    events: ['plan.created']
  };
}

/**
 * Execute apply_payment_plan block
 */
async function executeApplyPaymentPlan(
  userId: string,
  params: Record<string, unknown>
): Promise<{ result: unknown; events: PaymentEventType[] }> {
  const { plan_id, contact_id, booking_id, currency, start_date, custom_amount } = params;

  const result = await paymentPlanRepository.createInstallmentsForBooking(
    plan_id as string,
    userId,
    contact_id as string,
    start_date as string,
    {
      bookingId: booking_id as string | undefined,
      currency: currency as string | undefined,
      customAmount: custom_amount as number | undefined
    }
  );

  if (result.error) {
    throw result.error;
  }

  const events: PaymentEventType[] = ['plan.applied'];

  await emitPaymentEvent(userId, {
    eventType: 'plan.applied',
    entityType: 'plan',
    entityId: plan_id as string,
    contactId: contact_id as string,
    metadata: {
      bookingId: booking_id,
      installmentsCreated: result.data!.length,
      firstDueDate: result.data![0]?.due_date,
      lastDueDate: result.data![result.data!.length - 1]?.due_date
    }
  });

  // Emit event for each installment created
  for (const installment of result.data!) {
    await emitPaymentEvent(userId, {
      eventType: 'installment.created',
      entityType: 'installment',
      entityId: installment.id,
      contactId: contact_id as string,
      metadata: {
        planId: plan_id,
        installmentNumber: installment.installment_number,
        amount: installment.amount,
        currency: installment.currency,
        dueDate: installment.due_date
      }
    });
  }
  events.push('installment.created');

  return {
    result: {
      planId: plan_id,
      installments: result.data!.map(i => ({
        id: i.id,
        number: i.installment_number,
        amount: i.amount,
        currency: i.currency,
        dueDate: i.due_date
      }))
    },
    events
  };
}

/**
 * Execute modify_installment block
 */
async function executeModifyInstallment(
  userId: string,
  params: Record<string, unknown>
): Promise<{ result: unknown; events: PaymentEventType[] }> {
  const { installment_id, amount, due_date, status, notes } = params;

  const updates: Record<string, unknown> = {};
  if (amount !== undefined) updates.amount = amount;
  if (due_date !== undefined) updates.due_date = due_date;
  if (status !== undefined) updates.status = status;

  const result = await paymentPlanRepository.updateInstallment(
    installment_id as string,
    userId,
    updates
  );

  if (result.error) {
    throw result.error;
  }

  await emitPaymentEvent(userId, {
    eventType: 'installment.modified',
    entityType: 'installment',
    entityId: installment_id as string,
    contactId: result.data!.contact_id,
    metadata: {
      changes: updates,
      notes
    }
  });

  return {
    result: {
      installmentId: installment_id,
      amount: result.data!.amount,
      dueDate: result.data!.due_date,
      status: result.data!.status
    },
    events: ['installment.modified']
  };
}

/**
 * Execute cancel_plan block
 */
async function executeCancelPlan(
  userId: string,
  params: Record<string, unknown>
): Promise<{ result: unknown; events: PaymentEventType[] }> {
  const { plan_id, contact_id, reason } = params;

  const result = await paymentPlanRepository.cancelInstallments(
    plan_id as string,
    contact_id as string,
    userId
  );

  if (result.error) {
    throw result.error;
  }

  const events: PaymentEventType[] = ['plan.cancelled'];

  await emitPaymentEvent(userId, {
    eventType: 'plan.cancelled',
    entityType: 'plan',
    entityId: plan_id as string,
    contactId: contact_id as string,
    metadata: {
      reason,
      cancelledInstallments: result.data
    }
  });

  if ((result.data || 0) > 0) {
    await emitPaymentEvent(userId, {
      eventType: 'installment.cancelled',
      entityType: 'plan',
      entityId: plan_id as string,
      contactId: contact_id as string,
      metadata: { count: result.data }
    });
    events.push('installment.cancelled');
  }

  return {
    result: {
      planId: plan_id,
      contactId: contact_id,
      cancelledInstallments: result.data
    },
    events
  };
}

/**
 * Execute schedule_reminder block
 */
async function executeScheduleReminder(
  userId: string,
  params: Record<string, unknown>
): Promise<{ result: unknown; events: PaymentEventType[] }> {
  const { invoice_id, installment_id, contact_id, scheduled_at, reminder_type, channel } = params;

  // Insert reminder into database
  const { data, error } = await paymentReminderRepository.create({
    user_id: userId,
    invoice_id: (invoice_id as string | undefined) || null,
    installment_id: (installment_id as string | undefined) || null,
    contact_id: contact_id as string,
    reminder_type: reminder_type as string,
    scheduled_at: scheduled_at as string,
    channel: channel as string,
    status: 'pending'
  });

  if (error || !data) throw (error ?? new Error('Failed to schedule reminder'));

  await emitPaymentEvent(userId, {
    eventType: 'reminder.scheduled',
    entityType: 'reminder',
    entityId: data.id,
    contactId: contact_id as string,
    metadata: {
      invoiceId: invoice_id,
      installmentId: installment_id,
      scheduledAt: scheduled_at,
      reminderType: reminder_type,
      channel
    }
  });

  return {
    result: {
      reminderId: data.id,
      scheduledAt: data.scheduled_at,
      reminderType: data.reminder_type,
      channel: data.channel
    },
    events: ['reminder.scheduled']
  };
}

/**
 * Execute cancel_reminder block
 */
async function executeCancelReminder(
  userId: string,
  params: Record<string, unknown>
): Promise<{ result: unknown; events: PaymentEventType[] }> {
  const { reminder_id, invoice_id, installment_id } = params;

  // Route to the appropriate user-scoped cancel (repo drops the phantom updated_at).
  let cancelResult;
  if (reminder_id) {
    cancelResult = await paymentReminderRepository.cancel(reminder_id as string, userId);
  } else if (invoice_id) {
    cancelResult = await paymentReminderRepository.cancelByInvoice(invoice_id as string, userId);
  } else if (installment_id) {
    cancelResult = await paymentReminderRepository.cancelByInstallment(installment_id as string, userId);
  } else {
    throw new Error('Must provide reminder_id, invoice_id, or installment_id');
  }

  if (cancelResult.error) throw cancelResult.error;

  const cancelledCount = cancelResult.data || 0;

  if (cancelledCount > 0) {
    await emitPaymentEvent(userId, {
      eventType: 'reminder.cancelled',
      entityType: 'reminder',
      // These come from a z.record(z.unknown()) body, so `unknown || …` narrows to `{}`;
      // cast to string to match the `as string` pattern used at the cancel calls above.
      entityId: (reminder_id as string) || (invoice_id as string) || (installment_id as string) || '',
      metadata: { cancelledCount }
    });
  }

  return {
    result: { cancelledCount },
    events: cancelledCount > 0 ? ['reminder.cancelled'] : []
  };
}

/**
 * Execute schedule_retry block
 */
async function executeScheduleRetry(
  userId: string,
  params: Record<string, unknown>
): Promise<{ result: unknown; events: PaymentEventType[] }> {
  const { invoice_id, installment_id, delay_hours } = params;

  const nextRetryAt = new Date(Date.now() + (delay_hours as number) * 60 * 60 * 1000).toISOString();

  if (invoice_id) {
    const { data, error } = await supabaseServer
      .from('payment_invoices')
      .update({
        next_retry_at: nextRetryAt,
        updated_at: new Date().toISOString()
      })
      .eq('id', invoice_id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;

    await emitPaymentEvent(userId, {
      eventType: 'payment.retry_scheduled',
      entityType: 'invoice',
      entityId: invoice_id as string,
      contactId: data.contact_id,
      metadata: { nextRetryAt, delayHours: delay_hours }
    });

    return {
      result: { invoiceId: invoice_id, nextRetryAt },
      events: ['payment.retry_scheduled']
    };
  }

  if (installment_id) {
    const result = await paymentPlanRepository.updateInstallment(installment_id as string, userId, {
      next_retry_at: nextRetryAt
    });

    if (result.error) throw result.error;

    await emitPaymentEvent(userId, {
      eventType: 'payment.retry_scheduled',
      entityType: 'installment',
      entityId: installment_id as string,
      contactId: result.data!.contact_id,
      metadata: { nextRetryAt, delayHours: delay_hours }
    });

    return {
      result: { installmentId: installment_id, nextRetryAt },
      events: ['payment.retry_scheduled']
    };
  }

  throw new Error('Must provide invoice_id or installment_id');
}

/**
 * Execute cancel_retry block
 */
async function executeCancelRetry(
  userId: string,
  params: Record<string, unknown>
): Promise<{ result: unknown; events: PaymentEventType[] }> {
  const { invoice_id, installment_id } = params;

  if (invoice_id) {
    const { error } = await supabaseServer
      .from('payment_invoices')
      .update({
        next_retry_at: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', invoice_id)
      .eq('user_id', userId);

    if (error) throw error;

    return {
      result: { invoiceId: invoice_id, retryCancelled: true },
      events: []
    };
  }

  if (installment_id) {
    await paymentPlanRepository.updateInstallment(installment_id as string, userId, {
      next_retry_at: null
    });

    return {
      result: { installmentId: installment_id, retryCancelled: true },
      events: []
    };
  }

  throw new Error('Must provide invoice_id or installment_id');
}

// ==================== BLOCK EXECUTOR MAP ====================

const blockExecutors: Record<string, (userId: string, params: Record<string, unknown>) => Promise<{ result: unknown; events: PaymentEventType[] }>> = {
  collect_payment: executeCollectPayment,
  record_manual_payment: executeRecordManualPayment,
  refund_full: executeRefundFull,
  refund_partial: executeRefundPartial,
  create_payment_plan: executeCreatePaymentPlan,
  apply_payment_plan: executeApplyPaymentPlan,
  modify_installment: executeModifyInstallment,
  cancel_plan: executeCancelPlan,
  schedule_reminder: executeScheduleReminder,
  cancel_reminder: executeCancelReminder,
  schedule_retry: executeScheduleRetry,
  cancel_retry: executeCancelRetry
};

// ==================== API HANDLER ====================

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // 1. Authenticate
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // 2. Validate input
    const body = await request.json();
    const parseResult = ExecuteBlockSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request',
          details: parseResult.error.errors
        },
        { status: 400 }
      );
    }

    const { block_id, parameters } = parseResult.data;

    requestLogger.info({
      userId: user.id,
      blockId: block_id,
      parameterKeys: Object.keys(parameters)
    }, 'Executing payment block');

    // 3. Get block definition
    const block = getBlock(block_id);
    if (!block) {
      return NextResponse.json(
        { success: false, error: `Unknown block: ${block_id}` },
        { status: 400 }
      );
    }

    // 4. Validate parameters
    const validation = validateBlockParameters(block_id, parameters);
    if (!validation.valid) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid parameters',
          details: validation.errors
        },
        { status: 400 }
      );
    }

    // 5. Check if processor is required and available
    if (block.requires_processor) {
      const processorType = parameters.processor as PaymentProcessorType | undefined;

      if (processorType) {
        const processorResult = await paymentProcessorService.getProcessor(user.id, processorType);
        if (!processorResult.data) {
          return NextResponse.json(
            {
              success: false,
              error: `Processor ${processorType} is not connected. Please connect it first.`
            },
            { status: 400 }
          );
        }
      } else {
        const defaultResult = await paymentProcessorService.getDefaultProcessor(user.id);
        if (!defaultResult.data) {
          return NextResponse.json(
            {
              success: false,
              error: 'No payment processor configured. Please connect a payment processor.'
            },
            { status: 400 }
          );
        }
      }
    }

    // 6. Get executor
    const executor = blockExecutors[block_id];
    if (!executor) {
      return NextResponse.json(
        { success: false, error: `Block ${block_id} is not yet implemented` },
        { status: 501 }
      );
    }

    // 7. Execute block
    const startTime = Date.now();
    const { result, events } = await executor(user.id, parameters);
    const duration = Date.now() - startTime;

    requestLogger.info({
      userId: user.id,
      blockId: block_id,
      duration,
      eventsEmitted: events.length
    }, 'Payment block executed successfully');

    // 8. Audit log (non-blocking)
    auditTrail.log({
      action: 'PAYMENT_BLOCK_EXECUTED',
      // 'payment_block' is a Business-OS entity outside the audit EntityType vocabulary;
      // store the label as-is (same taxonomy gap as the chat CapabilityEngine audit).
      entityType: 'payment_block' as EntityType,
      entityId: block_id,
      userId: user.id,
      changes: { parameters, result, events_emitted: events },
      request
    }).catch(err => requestLogger.error({ err }, 'Audit failed (non-blocking)'));

    // 9. Return response
    const response: BlockExecutionResult = {
      success: true,
      block_id,
      result,
      events_emitted: events
    };

    return NextResponse.json(response);

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to execute payment block');

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to execute payment block',
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined
      },
      { status: 500 }
    );
  }
}
