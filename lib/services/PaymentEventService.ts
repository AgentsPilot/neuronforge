/**
 * Payment Event Service
 *
 * Central event emission system for all payment activities.
 * Events are used by:
 * 1. PaymentAutomationEngine - to trigger automation rules
 * 2. AI Kernel - for analysis and insights
 * 3. Audit trail - for compliance and debugging
 *
 * This service is processor-agnostic and works with any payment processor.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ service: 'PaymentEventService' });

// ==================== EVENT TYPES ====================

export type PaymentEventType =
  // Invoice events
  | 'invoice.created'
  | 'invoice.updated'
  | 'invoice.paid'
  | 'invoice.cancelled'
  | 'invoice.overdue'
  // Payment events
  | 'payment.checkout_created'
  | 'payment.completed'
  | 'payment.failed'
  | 'payment.manual_recorded'
  // Retry events
  | 'payment.retry_scheduled'
  | 'payment.retry_attempted'
  | 'payment.retry_succeeded'
  | 'payment.retry_failed'
  | 'payment.retry_exhausted'
  // Refund events
  | 'refund.initiated'
  | 'refund.completed'
  | 'refund.failed'
  // Installment events
  | 'installment.created'
  | 'installment.due_approaching'
  | 'installment.overdue'
  | 'installment.paid'
  | 'installment.cancelled'
  | 'installment.modified'
  // Plan events
  | 'plan.created'
  | 'plan.applied'
  | 'plan.completed'
  | 'plan.cancelled'
  // Reminder events
  | 'reminder.scheduled'
  | 'reminder.sent'
  | 'reminder.failed'
  | 'reminder.cancelled'
  // Processor events
  | 'processor.connected'
  | 'processor.disconnected'
  | 'processor.error';

export type PaymentEntityType =
  | 'invoice'
  | 'installment'
  | 'transaction'
  | 'plan'
  | 'processor'
  | 'reminder';

export type PaymentProcessorType =
  | 'stripe'
  | 'paypal'
  | 'square'
  | 'manual';

// ==================== INTERFACES ====================

export interface PaymentEvent {
  id: string;
  user_id: string;
  event_type: PaymentEventType;
  entity_type: PaymentEntityType;
  entity_id: string;
  contact_id?: string | null;
  processor_type?: PaymentProcessorType | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface EmitEventParams {
  eventType: PaymentEventType;
  entityType: PaymentEntityType;
  entityId: string;
  contactId?: string | null;
  processorType?: PaymentProcessorType | null;
  metadata?: Record<string, unknown>;
}

export interface GetEventsOptions {
  eventType?: PaymentEventType;
  entityType?: PaymentEntityType;
  entityId?: string;
  contactId?: string;
  processorType?: PaymentProcessorType;
  fromDate?: string;
  toDate?: string;
  limit?: number;
  offset?: number;
}

export interface PaymentEventServiceResult<T> {
  data: T | null;
  error: Error | null;
}

// ==================== EVENT SUBSCRIBERS ====================

type EventCallback = (event: PaymentEvent) => void | Promise<void>;
const eventSubscribers: EventCallback[] = [];

// ==================== SERVICE ====================

export class PaymentEventService {
  private supabase: SupabaseClient;

  constructor(supabaseClient: SupabaseClient) {
    this.supabase = supabaseClient;
  }

  /**
   * Emit a payment event
   * This is the core method - all payment activities should emit events through here
   */
  async emit(
    userId: string,
    params: EmitEventParams
  ): Promise<PaymentEventServiceResult<PaymentEvent>> {
    try {
      const { eventType, entityType, entityId, contactId, processorType, metadata = {} } = params;

      logger.info({
        userId,
        eventType,
        entityType,
        entityId,
        contactId,
        processorType
      }, 'Emitting payment event');

      const { data, error } = await this.supabase
        .from('payment_events')
        .insert({
          user_id: userId,
          event_type: eventType,
          entity_type: entityType,
          entity_id: entityId,
          contact_id: contactId || null,
          processor_type: processorType || null,
          metadata
        })
        .select()
        .single();

      if (error) throw error;

      // Notify subscribers (non-blocking)
      this.notifySubscribers(data).catch(err => {
        logger.warn({ err, eventId: data.id }, 'Event subscriber notification failed');
      });

      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, userId, params }, 'Failed to emit payment event');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Emit multiple events in a batch (more efficient)
   */
  async emitBatch(
    userId: string,
    events: EmitEventParams[]
  ): Promise<PaymentEventServiceResult<PaymentEvent[]>> {
    try {
      if (events.length === 0) {
        return { data: [], error: null };
      }

      logger.info({ userId, count: events.length }, 'Emitting batch payment events');

      const eventsToInsert = events.map(params => ({
        user_id: userId,
        event_type: params.eventType,
        entity_type: params.entityType,
        entity_id: params.entityId,
        contact_id: params.contactId || null,
        processor_type: params.processorType || null,
        metadata: params.metadata || {}
      }));

      const { data, error } = await this.supabase
        .from('payment_events')
        .insert(eventsToInsert)
        .select();

      if (error) throw error;

      // Notify subscribers for each event (non-blocking)
      for (const event of data || []) {
        this.notifySubscribers(event).catch(err => {
          logger.warn({ err, eventId: event.id }, 'Event subscriber notification failed');
        });
      }

      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error, userId, count: events.length }, 'Failed to emit batch payment events');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get events for a contact (payment history)
   */
  async getEventsForContact(
    contactId: string,
    userId: string,
    options: Omit<GetEventsOptions, 'contactId'> = {}
  ): Promise<PaymentEventServiceResult<PaymentEvent[]>> {
    return this.getEvents(userId, { ...options, contactId });
  }

  /**
   * Get events for a specific entity
   */
  async getEventsForEntity(
    entityType: PaymentEntityType,
    entityId: string,
    userId: string,
    options: Omit<GetEventsOptions, 'entityType' | 'entityId'> = {}
  ): Promise<PaymentEventServiceResult<PaymentEvent[]>> {
    return this.getEvents(userId, { ...options, entityType, entityId });
  }

  /**
   * Get events with flexible filtering
   */
  async getEvents(
    userId: string,
    options: GetEventsOptions = {}
  ): Promise<PaymentEventServiceResult<PaymentEvent[]>> {
    try {
      const {
        eventType,
        entityType,
        entityId,
        contactId,
        processorType,
        fromDate,
        toDate,
        limit = 100,
        offset = 0
      } = options;

      let query = this.supabase
        .from('payment_events')
        .select('*')
        .eq('user_id', userId);

      if (eventType) {
        query = query.eq('event_type', eventType);
      }

      if (entityType) {
        query = query.eq('entity_type', entityType);
      }

      if (entityId) {
        query = query.eq('entity_id', entityId);
      }

      if (contactId) {
        query = query.eq('contact_id', contactId);
      }

      if (processorType) {
        query = query.eq('processor_type', processorType);
      }

      if (fromDate) {
        query = query.gte('created_at', fromDate);
      }

      if (toDate) {
        query = query.lte('created_at', toDate);
      }

      query = query
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      const { data, error } = await query;

      if (error) throw error;

      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error, userId, options }, 'Failed to get payment events');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get event count by type (useful for dashboards)
   */
  async getEventCounts(
    userId: string,
    options: { fromDate?: string; toDate?: string } = {}
  ): Promise<PaymentEventServiceResult<Record<PaymentEventType, number>>> {
    try {
      const { fromDate, toDate } = options;

      let query = this.supabase
        .from('payment_events')
        .select('event_type')
        .eq('user_id', userId);

      if (fromDate) {
        query = query.gte('created_at', fromDate);
      }

      if (toDate) {
        query = query.lte('created_at', toDate);
      }

      const { data, error } = await query;

      if (error) throw error;

      // Count by event type
      const counts: Record<string, number> = {};
      for (const row of data || []) {
        counts[row.event_type] = (counts[row.event_type] || 0) + 1;
      }

      return { data: counts as Record<PaymentEventType, number>, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to get event counts');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Subscribe to events (for real-time processing like automation engine)
   */
  subscribe(callback: EventCallback): () => void {
    eventSubscribers.push(callback);

    // Return unsubscribe function
    return () => {
      const index = eventSubscribers.indexOf(callback);
      if (index > -1) {
        eventSubscribers.splice(index, 1);
      }
    };
  }

  /**
   * Notify all subscribers of a new event
   */
  private async notifySubscribers(event: PaymentEvent): Promise<void> {
    for (const callback of eventSubscribers) {
      try {
        await callback(event);
      } catch (error) {
        logger.warn({ err: error, eventId: event.id }, 'Event subscriber threw error');
      }
    }
  }

  /**
   * Get recent events of specific types (useful for automation)
   */
  async getRecentEventsByTypes(
    userId: string,
    eventTypes: PaymentEventType[],
    limit: number = 50
  ): Promise<PaymentEventServiceResult<PaymentEvent[]>> {
    try {
      const { data, error } = await this.supabase
        .from('payment_events')
        .select('*')
        .eq('user_id', userId)
        .in('event_type', eventTypes)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;

      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error, userId, eventTypes }, 'Failed to get recent events by types');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Check if an event of a specific type exists for an entity within a time window
   * Useful for deduplication and cooldown checks
   */
  async hasRecentEvent(
    userId: string,
    eventType: PaymentEventType,
    entityType: PaymentEntityType,
    entityId: string,
    withinMinutes: number
  ): Promise<PaymentEventServiceResult<boolean>> {
    try {
      const threshold = new Date(Date.now() - withinMinutes * 60 * 1000).toISOString();

      const { data, error } = await this.supabase
        .from('payment_events')
        .select('id')
        .eq('user_id', userId)
        .eq('event_type', eventType)
        .eq('entity_type', entityType)
        .eq('entity_id', entityId)
        .gte('created_at', threshold)
        .limit(1);

      if (error) throw error;

      return { data: (data?.length || 0) > 0, error: null };
    } catch (error) {
      logger.error({ err: error, userId, eventType, entityId }, 'Failed to check recent event');
      return { data: null, error: error as Error };
    }
  }
}

// Singleton export
import { supabaseServer } from '@/lib/supabaseServer';
export const paymentEventService = new PaymentEventService(supabaseServer);

// Helper for convenience
export async function emitPaymentEvent(
  userId: string,
  params: EmitEventParams
): Promise<PaymentEventServiceResult<PaymentEvent>> {
  return paymentEventService.emit(userId, params);
}
