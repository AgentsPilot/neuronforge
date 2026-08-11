/**
 * CapabilityEngine
 *
 * Executes capabilities deterministically after all parameters are resolved.
 * This is the "execute" phase - no AI involved, just deterministic execution.
 */

import { getCapability, Capability } from './CapabilityRegistry';
import type { CommandSession } from './CommandSessionRepository';
import { crmContactRepository } from '@/lib/repositories/CRMContactRepository';
import { crmTaskRepository, type TaskPriority } from '@/lib/repositories/CRMTaskRepository';
import {
  schedulingServiceRepository,
  schedulingBookingRepository
} from '@/lib/repositories/SchedulingRepository';
import { paymentInvoiceRepository } from '@/lib/repositories/PaymentRepository';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import type { EntityType } from '@/lib/audit/types';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ service: 'CapabilityEngine' });
const auditTrail = AuditTrailService.getInstance();

// ============== TYPES ==============

export interface ExecutionResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
  message?: string;
  message_he?: string;
}

// ============== ENGINE CLASS ==============

export class CapabilityEngine {
  constructor(private userId: string) {}

  /**
   * Execute a capability with resolved parameters
   */
  async execute(session: CommandSession): Promise<ExecutionResult> {
    const capability = getCapability(session.capability_id);
    if (!capability) {
      return { success: false, error: `Unknown capability: ${session.capability_id}` };
    }

    logger.info(
      {
        userId: this.userId,
        capability: session.capability_id,
        params: Object.keys(session.resolved_params)
      },
      'Executing capability'
    );

    try {
      // Execute the capability
      const result = await this.executeCapability(capability, session.resolved_params);

      // Generate messages from templates
      if (result.success) {
        result.message = this.interpolateTemplate(
          capability.successTemplate || 'Done!',
          session.resolved_params,
          result.data
        );
        if (capability.successTemplate_he) {
          result.message_he = this.interpolateTemplate(
            capability.successTemplate_he,
            session.resolved_params,
            result.data
          );
        }

        // Audit log (non-blocking)
        auditTrail.log({
          action: `CHAT_${capability.action.toUpperCase()}_${capability.entity.toUpperCase()}`,
          // The chat capability taxonomy (contact/task/service/booking/invoice) is broader
          // than the audit EntityType vocabulary; store the chat entity label as-is.
          entityType: capability.entity as EntityType,
          entityId: (result.data?.id as string) || session.resolved_params[`${capability.entity}_id`] as string,
          userId: this.userId,
          resourceName: capability.id,
          details: {
            params: session.resolved_params,
            result: result.data
          }
        }).catch(err => logger.error({ err }, 'Audit log failed'));
      } else {
        result.message = this.interpolateTemplate(
          capability.errorTemplate || result.error || 'Operation failed',
          session.resolved_params
        );
        if (capability.errorTemplate_he) {
          result.message_he = this.interpolateTemplate(
            capability.errorTemplate_he,
            session.resolved_params
          );
        }
      }

      return result;
    } catch (error) {
      logger.error(
        { err: error, capability: session.capability_id },
        'Capability execution failed'
      );
      return { success: false, error: 'Execution failed unexpectedly' };
    }
  }

  /**
   * Route to specific executor based on capability
   */
  private async executeCapability(
    capability: Capability,
    params: Record<string, unknown>
  ): Promise<ExecutionResult> {
    switch (capability.id) {
      // ============== CONTACTS ==============
      case 'contact.create':
        return this.createContact(params);
      case 'contact.update':
        return this.updateContact(params);
      case 'contact.delete':
        return this.deleteContact(params);

      // ============== TASKS ==============
      case 'task.create':
        return this.createTask(params);
      case 'task.complete':
        return this.completeTask(params);
      case 'task.update':
        return this.updateTask(params);
      case 'task.delete':
        return this.deleteTask(params);

      // ============== SERVICES ==============
      case 'service.create':
        return this.createService(params);
      case 'service.update':
        return this.updateService(params);
      case 'service.deactivate':
        return this.deactivateService(params);
      case 'service.activate':
        return this.activateService(params);

      // ============== BOOKINGS ==============
      case 'booking.create':
        return this.createBooking(params);
      case 'booking.reschedule':
        return this.rescheduleBooking(params);
      case 'booking.cancel':
        return this.cancelBooking(params);

      // ============== INVOICES ==============
      case 'invoice.create':
        return this.createInvoice(params);
      case 'invoice.send':
        return this.sendInvoice(params);

      // ============== EMAIL ==============
      case 'email.send':
        return this.sendEmail(params);

      default:
        return { success: false, error: `Unimplemented capability: ${capability.id}` };
    }
  }

  // ============== CONTACT EXECUTORS ==============

  private async createContact(params: Record<string, unknown>): Promise<ExecutionResult> {
    const result = await crmContactRepository.create({
      user_id: this.userId,
      first_name: params.first_name as string,
      last_name: (params.last_name as string) || null,
      email: (params.email as string) || null,
      phone: (params.phone as string) || null,
      stage: 'lead',
      tags: [],
      source: 'chat'
    });

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    return { success: true, data: this.toData(result.data) };
  }

  private async updateContact(params: Record<string, unknown>): Promise<ExecutionResult> {
    const contactId = params.contact_id as string;
    const updates: Record<string, unknown> = {};

    if (params.first_name !== undefined) updates.first_name = params.first_name;
    if (params.last_name !== undefined) updates.last_name = params.last_name;
    if (params.email !== undefined) updates.email = params.email;
    if (params.phone !== undefined) updates.phone = params.phone;

    if (Object.keys(updates).length === 0) {
      return { success: false, error: 'No updates provided' };
    }

    const result = await crmContactRepository.update(contactId, this.userId, updates);

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    return { success: true, data: this.toData(result.data) };
  }

  private async deleteContact(params: Record<string, unknown>): Promise<ExecutionResult> {
    const contactId = params.contact_id as string;
    const result = await crmContactRepository.delete(contactId, this.userId);

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    return { success: true };
  }

  // ============== TASK EXECUTORS ==============

  private async createTask(params: Record<string, unknown>): Promise<ExecutionResult> {
    const result = await crmTaskRepository.create({
      user_id: this.userId,
      title: params.title as string,
      due_date: (params.due_date as string) || null,
      priority: ((params.priority as string) || 'medium') as TaskPriority,
      status: 'pending',
      contact_id: (params.contact_id as string) || null
    });

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    return { success: true, data: this.toData(result.data) };
  }

  private async completeTask(params: Record<string, unknown>): Promise<ExecutionResult> {
    const taskId = params.task_id as string;
    const result = await crmTaskRepository.update(taskId, this.userId, {
      status: 'completed'
    });

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    return { success: true, data: this.toData(result.data) };
  }

  private async updateTask(params: Record<string, unknown>): Promise<ExecutionResult> {
    const taskId = params.task_id as string;
    const updates: Record<string, unknown> = {};

    if (params.title !== undefined) updates.title = params.title;
    if (params.due_date !== undefined) updates.due_date = params.due_date;
    if (params.priority !== undefined) updates.priority = params.priority;
    if (params.status !== undefined) updates.status = params.status;

    if (Object.keys(updates).length === 0) {
      return { success: false, error: 'No updates provided' };
    }

    const result = await crmTaskRepository.update(taskId, this.userId, updates);

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    return { success: true, data: this.toData(result.data) };
  }

  private async deleteTask(params: Record<string, unknown>): Promise<ExecutionResult> {
    const taskId = params.task_id as string;
    const result = await crmTaskRepository.delete(taskId, this.userId);

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    return { success: true };
  }

  // ============== SERVICE EXECUTORS ==============

  private async createService(params: Record<string, unknown>): Promise<ExecutionResult> {
    // Handle money type (could be { amount, currency } or just a number)
    let price: number | null = null;
    if (params.price !== undefined) {
      if (typeof params.price === 'object' && params.price !== null) {
        price = (params.price as { amount: number }).amount;
      } else {
        price = params.price as number;
      }
    }

    // Repo `create` takes a SINGLE SchedulingServiceInsert (user_id lives inside the object).
    const result = await schedulingServiceRepository.create({
      user_id: this.userId,
      service_name: params.service_name as string,
      duration_minutes: params.duration_minutes as number,
      price,
      description: (params.description as string) || null,
      is_active: true
    });

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    return { success: true, data: this.toData(result.data) };
  }

  private async updateService(params: Record<string, unknown>): Promise<ExecutionResult> {
    const serviceId = params.service_id as string;
    const updates: Record<string, unknown> = {};

    if (params.service_name !== undefined) updates.service_name = params.service_name;
    if (params.duration_minutes !== undefined) updates.duration_minutes = params.duration_minutes;
    if (params.price !== undefined) {
      if (typeof params.price === 'object' && params.price !== null) {
        updates.price = (params.price as { amount: number }).amount;
      } else {
        updates.price = params.price;
      }
    }
    if (params.description !== undefined) updates.description = params.description;

    if (Object.keys(updates).length === 0) {
      return { success: false, error: 'No updates provided' };
    }

    const result = await schedulingServiceRepository.update(serviceId, this.userId, updates);

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    return { success: true, data: this.toData(result.data) };
  }

  private async deactivateService(params: Record<string, unknown>): Promise<ExecutionResult> {
    const serviceId = params.service_id as string;
    const result = await schedulingServiceRepository.update(serviceId, this.userId, {
      is_active: false
    });

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    return { success: true, data: this.toData(result.data) };
  }

  private async activateService(params: Record<string, unknown>): Promise<ExecutionResult> {
    const serviceId = params.service_id as string;
    const result = await schedulingServiceRepository.update(serviceId, this.userId, {
      is_active: true
    });

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    return { success: true, data: this.toData(result.data) };
  }

  // ============== BOOKING EXECUTORS ==============

  private async createBooking(params: Record<string, unknown>): Promise<ExecutionResult> {
    // Get service for duration
    const serviceResult = await schedulingServiceRepository.findById(
      params.service_id as string,
      this.userId
    );

    if (serviceResult.error || !serviceResult.data) {
      return { success: false, error: 'Service not found' };
    }

    const service = serviceResult.data;

    // Get contact info
    const contactResult = await crmContactRepository.findById(
      params.contact_id as string,
      this.userId
    );

    if (contactResult.error || !contactResult.data) {
      return { success: false, error: 'Contact not found' };
    }

    const contact = contactResult.data;

    // Calculate end time
    const startTime = new Date(params.start_time as string);
    const endTime = new Date(startTime.getTime() + service.duration_minutes * 60 * 1000);

    // Check for conflicts
    const overlapResult = await schedulingBookingRepository.checkOverlap(
      this.userId,
      startTime.toISOString(),
      endTime.toISOString()
    );

    if (overlapResult.data && overlapResult.data.length > 0) {
      return {
        success: false,
        error: `Time slot conflicts with ${overlapResult.data.length} existing booking(s)`
      };
    }

    // Create booking. Repo `create` takes a SINGLE SchedulingBookingInsert (user_id inside).
    // client_first_name/client_email are NOT NULL, so coerce the nullable contact fields.
    const result = await schedulingBookingRepository.create({
      user_id: this.userId,
      service_id: params.service_id as string,
      contact_id: params.contact_id as string,
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
      client_first_name: contact.first_name || '',
      client_last_name: contact.last_name || '',
      client_email: contact.email || '',
      client_phone: contact.phone || '',
      status: 'confirmed'
    });

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    return { success: true, data: this.toData(result.data) };
  }

  private async rescheduleBooking(params: Record<string, unknown>): Promise<ExecutionResult> {
    const bookingId = params.booking_id as string;
    const newStartTime = new Date(params.new_start_time as string);

    // Get existing booking
    const bookingResult = await schedulingBookingRepository.findById(bookingId, this.userId);
    if (bookingResult.error || !bookingResult.data) {
      return { success: false, error: 'Booking not found' };
    }

    const booking = bookingResult.data;

    // Calculate new end time (preserve duration)
    const duration = new Date(booking.end_time).getTime() - new Date(booking.start_time).getTime();
    const newEndTime = new Date(newStartTime.getTime() + duration);

    // Check for conflicts (excluding this booking)
    const overlapResult = await schedulingBookingRepository.checkOverlap(
      this.userId,
      newStartTime.toISOString(),
      newEndTime.toISOString(),
      bookingId
    );

    if (overlapResult.data && overlapResult.data.length > 0) {
      return {
        success: false,
        error: `New time conflicts with ${overlapResult.data.length} existing booking(s)`
      };
    }

    // Update booking
    const result = await schedulingBookingRepository.update(bookingId, this.userId, {
      start_time: newStartTime.toISOString(),
      end_time: newEndTime.toISOString()
    });

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    return { success: true, data: this.toData(result.data) };
  }

  private async cancelBooking(params: Record<string, unknown>): Promise<ExecutionResult> {
    const bookingId = params.booking_id as string;

    const result = await schedulingBookingRepository.update(bookingId, this.userId, {
      status: 'cancelled'
    });

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    return { success: true, data: this.toData(result.data) };
  }

  // ============== INVOICE EXECUTORS ==============

  private async createInvoice(params: Record<string, unknown>): Promise<ExecutionResult> {
    // Handle money type
    let amount: number;
    let currency = 'ILS';

    if (typeof params.amount === 'object' && params.amount !== null) {
      const money = params.amount as { amount: number; currency?: string };
      amount = money.amount;
      currency = money.currency || 'ILS';
    } else {
      amount = params.amount as number;
    }

    // The repo's `create` takes a SINGLE invoice object (not `(userId, invoice)`), and
    // `user_id` + `invoice_number` are NOT NULL. Generate the number first and pass a
    // complete payload — mirrors SafeExecutionLayer.mutateInvoice('create').
    const invoiceNumberResult = await paymentInvoiceRepository.getNextInvoiceNumber(this.userId);
    if (invoiceNumberResult.error || !invoiceNumberResult.data) {
      return { success: false, error: 'Failed to generate invoice number' };
    }

    const result = await paymentInvoiceRepository.create({
      user_id: this.userId,
      contact_id: (params.contact_id as string) || null,
      invoice_number: invoiceNumberResult.data,
      amount,
      currency,
      status: 'draft',
      line_items: [{
        description: params.description as string,
        quantity: 1,
        unit_price: amount,
        total: amount
      }],
      due_date: (params.due_date as string) || null,
      payment_terms: 'due_on_receipt',
      notes: null,
      internal_notes: null,
      sent_at: null,
      paid_at: null,
      payment_method: null,
      payment_received_at: null,
      payment_notes: null,
      processor_type: null,
      processor_checkout_id: null,
      processor_payment_id: null,
      processor_customer_id: null,
      processor_payment_method_id: null,
      retry_count: 0,
      last_retry_at: null,
      next_retry_at: null
    });

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    return { success: true, data: this.toData(result.data) };
  }

  private async sendInvoice(params: Record<string, unknown>): Promise<ExecutionResult> {
    const invoiceId = params.invoice_id as string;

    // Update status to sent
    const result = await paymentInvoiceRepository.update(invoiceId, this.userId, {
      status: 'sent',
      sent_at: new Date().toISOString()
    });

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    // TODO: Actually send the invoice email via BookingEmailService

    return { success: true, data: this.toData(result.data) };
  }

  // ============== EMAIL EXECUTOR ==============

  private async sendEmail(params: Record<string, unknown>): Promise<ExecutionResult> {
    // Get contact email
    const contactResult = await crmContactRepository.findById(
      params.contact_id as string,
      this.userId
    );

    if (contactResult.error || !contactResult.data) {
      return { success: false, error: 'Contact not found' };
    }

    const contact = contactResult.data;

    if (!contact.email) {
      return { success: false, error: 'Contact has no email address' };
    }

    // TODO: Actually send email via EmailService
    // For now, just log it
    logger.info({
      userId: this.userId,
      to: contact.email,
      subject: params.subject,
      bodyLength: (params.body as string)?.length
    }, 'Email send requested (not implemented)');

    return {
      success: true,
      data: {
        to: contact.email,
        subject: params.subject,
        sent: false,  // Not actually sent yet
        reason: 'Email sending not yet implemented'
      }
    };
  }

  // ============== HELPERS ==============

  /**
   * Coerce a repository entity (a plain data object, or null after an error check)
   * into the loosely-typed `ExecutionResult.data` shape. Repository row interfaces
   * have no index signature, so a direct `as Record<string, unknown>` is rejected;
   * routing through `unknown` here is the sanctioned widening and avoids repeating
   * the double-cast at every call site.
   */
  private toData(value: unknown): Record<string, unknown> {
    return (value ?? {}) as Record<string, unknown>;
  }

  /**
   * Interpolate template with parameters
   */
  private interpolateTemplate(
    template: string,
    params: Record<string, unknown>,
    result?: Record<string, unknown>
  ): string {
    const allData = { ...params, ...result };

    return template.replace(/\{([^}]+)\}/g, (match, path) => {
      const parts = path.split('.');
      let value: unknown = allData;

      for (const part of parts) {
        if (value && typeof value === 'object') {
          value = (value as Record<string, unknown>)[part];
        } else {
          return match; // Keep original if path not found
        }
      }

      // Format dates
      if (value instanceof Date) {
        return value.toLocaleDateString();
      }

      // Format dates from ISO strings
      if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
        return new Date(value).toLocaleDateString();
      }

      return String(value ?? match);
    });
  }
}
