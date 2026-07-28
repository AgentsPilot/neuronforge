/**
 * Payment Building Blocks Registry
 *
 * Central registry of all payment building blocks that can be:
 * 1. Triggered by the AI automation kernel
 * 2. Used in automation rules
 * 3. Executed directly via API
 *
 * Each block is a discrete, composable unit that performs a specific payment action.
 * Blocks are processor-agnostic and work with any configured payment processor.
 */

import { PaymentEventType, PaymentProcessorType } from '@/lib/services/PaymentEventService';

// ==================== BLOCK CATEGORIES ====================

export type PaymentBlockCategory =
  | 'collection'  // Collecting payments
  | 'refund'      // Refunding payments
  | 'plan'        // Payment plan management
  | 'reminder'    // Payment reminders
  | 'retry';      // Automatic retry

// ==================== PARAMETER TYPES ====================

export interface BlockParameterDefinition {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'date' | 'uuid';
  required: boolean;
  description: string;
  default?: unknown;
  enum?: string[];  // For restricted values
}

// ==================== BLOCK DEFINITION ====================

export interface PaymentBuildingBlock {
  id: string;
  category: PaymentBlockCategory;
  name: string;
  description: string;
  parameters: BlockParameterDefinition[];
  configurable: string[];  // User-configurable settings
  emits_events: PaymentEventType[];
  requires_processor: boolean;  // Does this block need a connected processor?
  supported_processors: PaymentProcessorType[];  // Which processors support this block?
}

// ==================== BUILDING BLOCKS ====================

export const PAYMENT_BUILDING_BLOCKS: Record<string, PaymentBuildingBlock> = {
  // ==================== COLLECTION BLOCKS ====================

  collect_payment: {
    id: 'collect_payment',
    category: 'collection',
    name: 'Collect Payment',
    description: 'Create a checkout session to collect payment via any connected processor',
    parameters: [
      { name: 'invoice_id', type: 'uuid', required: false, description: 'Invoice to collect payment for' },
      { name: 'booking_id', type: 'uuid', required: false, description: 'Booking to collect payment for' },
      { name: 'installment_id', type: 'uuid', required: false, description: 'Installment to collect payment for' },
      { name: 'amount', type: 'number', required: false, description: 'Amount to collect (uses entity amount if not provided)' },
      { name: 'currency', type: 'string', required: false, description: 'Currency code (e.g., USD, EUR, ILS)' },
      { name: 'processor', type: 'string', required: false, description: 'Processor to use (uses default if not provided)', enum: ['stripe', 'paypal', 'square'] },
      { name: 'success_url', type: 'string', required: false, description: 'Redirect URL on success' },
      { name: 'cancel_url', type: 'string', required: false, description: 'Redirect URL on cancel' }
    ],
    configurable: ['default_processor', 'success_redirect_path', 'cancel_redirect_path'],
    emits_events: ['payment.checkout_created', 'payment.completed', 'payment.failed'],
    requires_processor: true,
    supported_processors: ['stripe', 'paypal', 'square']
  },

  record_manual_payment: {
    id: 'record_manual_payment',
    category: 'collection',
    name: 'Record Manual Payment',
    description: 'Record a payment received via cash, bank transfer, check, or other manual method',
    parameters: [
      { name: 'invoice_id', type: 'uuid', required: false, description: 'Invoice this payment is for' },
      { name: 'booking_id', type: 'uuid', required: false, description: 'Booking this payment is for' },
      { name: 'installment_id', type: 'uuid', required: false, description: 'Installment this payment is for' },
      { name: 'contact_id', type: 'uuid', required: false, description: 'Contact who made the payment' },
      { name: 'amount', type: 'number', required: true, description: 'Payment amount' },
      { name: 'currency', type: 'string', required: true, description: 'Currency code' },
      { name: 'method', type: 'string', required: true, description: 'Payment method', enum: ['cash', 'bank_transfer', 'check', 'other'] },
      { name: 'notes', type: 'string', required: false, description: 'Optional notes about the payment' },
      { name: 'received_at', type: 'date', required: false, description: 'When payment was received (defaults to now)' }
    ],
    configurable: ['allowed_methods'],
    emits_events: ['payment.manual_recorded'],
    requires_processor: false,
    supported_processors: ['manual']
  },

  charge_saved_method: {
    id: 'charge_saved_method',
    category: 'collection',
    name: 'Charge Saved Payment Method',
    description: 'Charge a saved payment method for a contact (used for auto-retry)',
    parameters: [
      { name: 'contact_id', type: 'uuid', required: true, description: 'Contact whose saved method to charge' },
      { name: 'invoice_id', type: 'uuid', required: false, description: 'Invoice to charge for' },
      { name: 'installment_id', type: 'uuid', required: false, description: 'Installment to charge for' },
      { name: 'amount', type: 'number', required: true, description: 'Amount to charge' },
      { name: 'currency', type: 'string', required: true, description: 'Currency code' },
      { name: 'saved_method_id', type: 'uuid', required: false, description: 'Specific saved method to use (uses default if not provided)' }
    ],
    configurable: [],
    emits_events: ['payment.completed', 'payment.failed'],
    requires_processor: true,
    supported_processors: ['stripe', 'paypal', 'square']
  },

  // ==================== REFUND BLOCKS ====================

  refund_full: {
    id: 'refund_full',
    category: 'refund',
    name: 'Full Refund',
    description: 'Issue a full refund for a transaction',
    parameters: [
      { name: 'transaction_id', type: 'uuid', required: true, description: 'Transaction to refund' },
      { name: 'reason', type: 'string', required: false, description: 'Reason for refund' },
      { name: 'notify_contact', type: 'boolean', required: false, description: 'Send notification to contact', default: true }
    ],
    configurable: ['refund_notification_template'],
    emits_events: ['refund.initiated', 'refund.completed', 'refund.failed'],
    requires_processor: true,
    supported_processors: ['stripe', 'paypal', 'square', 'manual']
  },

  refund_partial: {
    id: 'refund_partial',
    category: 'refund',
    name: 'Partial Refund',
    description: 'Issue a partial refund for a transaction',
    parameters: [
      { name: 'transaction_id', type: 'uuid', required: true, description: 'Transaction to refund' },
      { name: 'amount', type: 'number', required: true, description: 'Amount to refund' },
      { name: 'reason', type: 'string', required: false, description: 'Reason for refund' },
      { name: 'notify_contact', type: 'boolean', required: false, description: 'Send notification to contact', default: true }
    ],
    configurable: ['refund_notification_template'],
    emits_events: ['refund.initiated', 'refund.completed', 'refund.failed'],
    requires_processor: true,
    supported_processors: ['stripe', 'paypal', 'square', 'manual']
  },

  // ==================== PLAN BLOCKS ====================

  create_payment_plan: {
    id: 'create_payment_plan',
    category: 'plan',
    name: 'Create Payment Plan',
    description: 'Create a new payment plan template',
    parameters: [
      { name: 'name', type: 'string', required: true, description: 'Plan name' },
      { name: 'description', type: 'string', required: false, description: 'Plan description' },
      { name: 'total_amount', type: 'number', required: true, description: 'Total amount for the plan' },
      { name: 'currency', type: 'string', required: true, description: 'Default currency' },
      { name: 'supported_currencies', type: 'array', required: false, description: 'Supported currencies', default: ['USD'] },
      { name: 'installment_count', type: 'number', required: true, description: 'Number of installments' },
      { name: 'frequency', type: 'string', required: true, description: 'Installment frequency', enum: ['weekly', 'biweekly', 'monthly'] },
      { name: 'service_id', type: 'uuid', required: false, description: 'Link to a service' },
      { name: 'allowed_processors', type: 'array', required: false, description: 'Allowed payment processors' }
    ],
    configurable: [],
    emits_events: ['plan.created'],
    requires_processor: false,
    supported_processors: ['stripe', 'paypal', 'square', 'manual']
  },

  apply_payment_plan: {
    id: 'apply_payment_plan',
    category: 'plan',
    name: 'Apply Payment Plan',
    description: 'Apply a payment plan to a booking/contact, creating installment schedule',
    parameters: [
      { name: 'plan_id', type: 'uuid', required: true, description: 'Payment plan to apply' },
      { name: 'contact_id', type: 'uuid', required: true, description: 'Contact to apply plan to' },
      { name: 'booking_id', type: 'uuid', required: false, description: 'Booking to link installments to' },
      { name: 'currency', type: 'string', required: false, description: 'Currency to use (uses contact preference or plan default)' },
      { name: 'start_date', type: 'date', required: true, description: 'First installment due date' },
      { name: 'custom_amount', type: 'number', required: false, description: 'Override total amount' }
    ],
    configurable: [],
    emits_events: ['plan.applied', 'installment.created'],
    requires_processor: false,
    supported_processors: ['stripe', 'paypal', 'square', 'manual']
  },

  modify_installment: {
    id: 'modify_installment',
    category: 'plan',
    name: 'Modify Installment',
    description: 'Modify an installment (amount, due date, status)',
    parameters: [
      { name: 'installment_id', type: 'uuid', required: true, description: 'Installment to modify' },
      { name: 'amount', type: 'number', required: false, description: 'New amount' },
      { name: 'due_date', type: 'date', required: false, description: 'New due date' },
      { name: 'status', type: 'string', required: false, description: 'New status', enum: ['pending', 'paid', 'cancelled'] },
      { name: 'notes', type: 'string', required: false, description: 'Notes about the modification' }
    ],
    configurable: [],
    emits_events: ['installment.modified'],
    requires_processor: false,
    supported_processors: ['stripe', 'paypal', 'square', 'manual']
  },

  cancel_plan: {
    id: 'cancel_plan',
    category: 'plan',
    name: 'Cancel Payment Plan',
    description: 'Cancel a payment plan and its remaining installments',
    parameters: [
      { name: 'plan_id', type: 'uuid', required: true, description: 'Plan to cancel (specific application)' },
      { name: 'contact_id', type: 'uuid', required: true, description: 'Contact whose plan to cancel' },
      { name: 'reason', type: 'string', required: false, description: 'Cancellation reason' },
      { name: 'refund_paid', type: 'boolean', required: false, description: 'Refund already paid installments', default: false }
    ],
    configurable: [],
    emits_events: ['plan.cancelled', 'installment.cancelled'],
    requires_processor: false,
    supported_processors: ['stripe', 'paypal', 'square', 'manual']
  },

  // ==================== REMINDER BLOCKS ====================

  send_payment_reminder: {
    id: 'send_payment_reminder',
    category: 'reminder',
    name: 'Send Payment Reminder',
    description: 'Send a payment reminder to a contact',
    parameters: [
      { name: 'invoice_id', type: 'uuid', required: false, description: 'Invoice to remind about' },
      { name: 'installment_id', type: 'uuid', required: false, description: 'Installment to remind about' },
      { name: 'contact_id', type: 'uuid', required: true, description: 'Contact to send reminder to' },
      { name: 'channel', type: 'string', required: true, description: 'Communication channel', enum: ['email', 'sms', 'in_app'] },
      { name: 'template', type: 'string', required: false, description: 'Reminder template to use' },
      { name: 'include_payment_link', type: 'boolean', required: false, description: 'Include payment link', default: true }
    ],
    configurable: ['default_channel', 'email_template', 'sms_template'],
    emits_events: ['reminder.sent', 'reminder.failed'],
    requires_processor: false,
    supported_processors: ['stripe', 'paypal', 'square', 'manual']
  },

  schedule_reminder: {
    id: 'schedule_reminder',
    category: 'reminder',
    name: 'Schedule Payment Reminder',
    description: 'Schedule a payment reminder for future delivery',
    parameters: [
      { name: 'invoice_id', type: 'uuid', required: false, description: 'Invoice to remind about' },
      { name: 'installment_id', type: 'uuid', required: false, description: 'Installment to remind about' },
      { name: 'contact_id', type: 'uuid', required: true, description: 'Contact to send reminder to' },
      { name: 'scheduled_at', type: 'date', required: true, description: 'When to send the reminder' },
      { name: 'reminder_type', type: 'string', required: true, description: 'Reminder type', enum: ['upcoming_due', 'overdue', 'retry_failed', 'payment_received'] },
      { name: 'channel', type: 'string', required: true, description: 'Communication channel', enum: ['email', 'sms', 'in_app'] }
    ],
    configurable: [],
    emits_events: ['reminder.scheduled'],
    requires_processor: false,
    supported_processors: ['stripe', 'paypal', 'square', 'manual']
  },

  cancel_reminder: {
    id: 'cancel_reminder',
    category: 'reminder',
    name: 'Cancel Payment Reminder',
    description: 'Cancel a scheduled reminder',
    parameters: [
      { name: 'reminder_id', type: 'uuid', required: false, description: 'Specific reminder to cancel' },
      { name: 'invoice_id', type: 'uuid', required: false, description: 'Cancel all reminders for invoice' },
      { name: 'installment_id', type: 'uuid', required: false, description: 'Cancel all reminders for installment' }
    ],
    configurable: [],
    emits_events: ['reminder.cancelled'],
    requires_processor: false,
    supported_processors: ['stripe', 'paypal', 'square', 'manual']
  },

  // ==================== RETRY BLOCKS ====================

  retry_payment: {
    id: 'retry_payment',
    category: 'retry',
    name: 'Retry Payment',
    description: 'Attempt to retry a failed payment using saved payment method',
    parameters: [
      { name: 'invoice_id', type: 'uuid', required: false, description: 'Invoice to retry payment for' },
      { name: 'installment_id', type: 'uuid', required: false, description: 'Installment to retry payment for' },
      { name: 'force', type: 'boolean', required: false, description: 'Retry even if max retries reached', default: false }
    ],
    configurable: ['max_retries'],
    emits_events: ['payment.retry_attempted', 'payment.retry_succeeded', 'payment.retry_failed'],
    requires_processor: true,
    supported_processors: ['stripe', 'paypal', 'square']
  },

  schedule_retry: {
    id: 'schedule_retry',
    category: 'retry',
    name: 'Schedule Payment Retry',
    description: 'Schedule a payment retry for later',
    parameters: [
      { name: 'invoice_id', type: 'uuid', required: false, description: 'Invoice to schedule retry for' },
      { name: 'installment_id', type: 'uuid', required: false, description: 'Installment to schedule retry for' },
      { name: 'delay_hours', type: 'number', required: true, description: 'Hours to wait before retrying' }
    ],
    configurable: ['default_retry_intervals', 'max_retries'],
    emits_events: ['payment.retry_scheduled'],
    requires_processor: true,
    supported_processors: ['stripe', 'paypal', 'square']
  },

  cancel_retry: {
    id: 'cancel_retry',
    category: 'retry',
    name: 'Cancel Scheduled Retry',
    description: 'Cancel a scheduled payment retry',
    parameters: [
      { name: 'invoice_id', type: 'uuid', required: false, description: 'Invoice to cancel retry for' },
      { name: 'installment_id', type: 'uuid', required: false, description: 'Installment to cancel retry for' }
    ],
    configurable: [],
    emits_events: [],
    requires_processor: false,
    supported_processors: ['stripe', 'paypal', 'square', 'manual']
  }
};

// ==================== HELPER FUNCTIONS ====================

/**
 * Get all building blocks
 */
export function getAllBlocks(): PaymentBuildingBlock[] {
  return Object.values(PAYMENT_BUILDING_BLOCKS);
}

/**
 * Get a specific building block by ID
 */
export function getBlock(blockId: string): PaymentBuildingBlock | null {
  return PAYMENT_BUILDING_BLOCKS[blockId] || null;
}

/**
 * Get blocks by category
 */
export function getBlocksByCategory(category: PaymentBlockCategory): PaymentBuildingBlock[] {
  return Object.values(PAYMENT_BUILDING_BLOCKS).filter(block => block.category === category);
}

/**
 * Get blocks that can be triggered by a specific event
 */
export function getBlocksForEvent(eventType: string): PaymentBuildingBlock[] {
  return Object.values(PAYMENT_BUILDING_BLOCKS).filter(block =>
    block.emits_events.includes(eventType as PaymentEventType)
  );
}

/**
 * Get blocks that work with a specific processor
 */
export function getBlocksForProcessor(processorType: PaymentProcessorType): PaymentBuildingBlock[] {
  return Object.values(PAYMENT_BUILDING_BLOCKS).filter(block =>
    block.supported_processors.includes(processorType)
  );
}

/**
 * Validate parameters for a block
 */
export function validateBlockParameters(
  blockId: string,
  params: Record<string, unknown>
): { valid: boolean; errors: string[] } {
  const block = getBlock(blockId);
  if (!block) {
    return { valid: false, errors: [`Unknown block: ${blockId}`] };
  }

  const errors: string[] = [];

  for (const paramDef of block.parameters) {
    const value = params[paramDef.name];

    // Check required
    if (paramDef.required && (value === undefined || value === null)) {
      errors.push(`Missing required parameter: ${paramDef.name}`);
      continue;
    }

    // Check type if value provided
    if (value !== undefined && value !== null) {
      const actualType = typeof value;
      const expectedType = paramDef.type;

      if (expectedType === 'uuid' && (actualType !== 'string' || !isValidUUID(value as string))) {
        errors.push(`Parameter ${paramDef.name} must be a valid UUID`);
      } else if (expectedType === 'number' && actualType !== 'number') {
        errors.push(`Parameter ${paramDef.name} must be a number`);
      } else if (expectedType === 'boolean' && actualType !== 'boolean') {
        errors.push(`Parameter ${paramDef.name} must be a boolean`);
      } else if (expectedType === 'array' && !Array.isArray(value)) {
        errors.push(`Parameter ${paramDef.name} must be an array`);
      } else if (expectedType === 'object' && (actualType !== 'object' || Array.isArray(value))) {
        errors.push(`Parameter ${paramDef.name} must be an object`);
      }

      // Check enum
      if (paramDef.enum && !paramDef.enum.includes(value as string)) {
        errors.push(`Parameter ${paramDef.name} must be one of: ${paramDef.enum.join(', ')}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Simple UUID validation
 */
function isValidUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

/**
 * Get block schema for API documentation / AI consumption
 */
export function getBlockSchemas(): Record<string, {
  id: string;
  name: string;
  description: string;
  category: string;
  parameters: Record<string, {
    type: string;
    required: boolean;
    description: string;
    enum?: string[];
  }>;
}> {
  const schemas: Record<string, {
    id: string;
    name: string;
    description: string;
    category: string;
    parameters: Record<string, {
      type: string;
      required: boolean;
      description: string;
      enum?: string[];
    }>;
  }> = {};

  for (const [blockId, block] of Object.entries(PAYMENT_BUILDING_BLOCKS)) {
    const params: Record<string, {
      type: string;
      required: boolean;
      description: string;
      enum?: string[];
    }> = {};

    for (const param of block.parameters) {
      params[param.name] = {
        type: param.type,
        required: param.required,
        description: param.description,
        ...(param.enum ? { enum: param.enum } : {})
      };
    }

    schemas[blockId] = {
      id: block.id,
      name: block.name,
      description: block.description,
      category: block.category,
      parameters: params
    };
  }

  return schemas;
}
