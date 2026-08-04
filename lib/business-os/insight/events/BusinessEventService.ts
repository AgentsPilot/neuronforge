/**
 * Business Event Service
 *
 * Central event emission system for all business activities in the AI Business OS.
 * Events are used by:
 * 1. Insight detectors - to detect patterns across business vectors
 * 2. Metrics computation - aggregated for baseline calculations
 * 3. Automation triggers - to fire standing automations
 *
 * Follows the same pattern as PaymentEventService.
 *
 * @see docs/INSIGHT_SYSTEM_PLAN.md
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';
import {
  BusinessEvent,
  BusinessEventType,
  BusinessEventCategory,
  BusinessEntityType,
  SourceCapability,
  EmitBusinessEventParams,
  GetBusinessEventsOptions,
  BusinessEventServiceResult,
  getCategoryForEventType,
} from './types';

const logger = createLogger({ service: 'BusinessEventService' });

// ==================== EVENT SUBSCRIBERS ====================

type EventCallback = (event: BusinessEvent) => void | Promise<void>;
const eventSubscribers: EventCallback[] = [];

// ==================== SERVICE ====================

export class BusinessEventService {
  private supabase: SupabaseClient;

  constructor(supabaseClient: SupabaseClient) {
    this.supabase = supabaseClient;
  }

  /**
   * Emit a business event
   * This is the core method - all business activities should emit events through here
   */
  async emit(
    userId: string,
    params: EmitBusinessEventParams
  ): Promise<BusinessEventServiceResult<BusinessEvent>> {
    try {
      const {
        eventType,
        category,
        entityType,
        entityId,
        contactId,
        sessionId,
        valueUsd,
        valueDelta,
        metadata = {},
        sourceCapability,
      } = params;

      // Validate category matches event type
      const expectedCategory = getCategoryForEventType(eventType);
      if (expectedCategory !== category) {
        logger.warn(
          { eventType, providedCategory: category, expectedCategory },
          'Event category mismatch - using expected category'
        );
      }

      logger.info(
        {
          userId,
          eventType,
          category: expectedCategory,
          entityType,
          entityId,
          contactId,
          sourceCapability,
        },
        'Emitting business event'
      );

      const { data, error } = await this.supabase
        .from('business_events')
        .insert({
          user_id: userId,
          event_type: eventType,
          category: expectedCategory,
          entity_type: entityType,
          entity_id: entityId,
          contact_id: contactId || null,
          session_id: sessionId || null,
          value_usd: valueUsd || null,
          value_delta: valueDelta || null,
          metadata,
          source_capability: sourceCapability,
        })
        .select()
        .single();

      if (error) throw error;

      // Notify subscribers (non-blocking)
      this.notifySubscribers(data).catch((err) => {
        logger.warn({ err, eventId: data.id }, 'Event subscriber notification failed');
      });

      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, userId, params }, 'Failed to emit business event');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Emit multiple events in a batch (more efficient)
   */
  async emitBatch(
    userId: string,
    events: EmitBusinessEventParams[]
  ): Promise<BusinessEventServiceResult<BusinessEvent[]>> {
    try {
      if (events.length === 0) {
        return { data: [], error: null };
      }

      logger.info({ userId, count: events.length }, 'Emitting batch business events');

      const eventsToInsert = events.map((params) => ({
        user_id: userId,
        event_type: params.eventType,
        category: getCategoryForEventType(params.eventType),
        entity_type: params.entityType,
        entity_id: params.entityId,
        contact_id: params.contactId || null,
        session_id: params.sessionId || null,
        value_usd: params.valueUsd || null,
        value_delta: params.valueDelta || null,
        metadata: params.metadata || {},
        source_capability: params.sourceCapability,
      }));

      const { data, error } = await this.supabase
        .from('business_events')
        .insert(eventsToInsert)
        .select();

      if (error) throw error;

      // Notify subscribers for each event (non-blocking)
      for (const event of data || []) {
        this.notifySubscribers(event).catch((err) => {
          logger.warn({ err, eventId: event.id }, 'Event subscriber notification failed');
        });
      }

      return { data: data || [], error: null };
    } catch (error) {
      logger.error(
        { err: error, userId, count: events.length },
        'Failed to emit batch business events'
      );
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get events for a contact
   */
  async getEventsForContact(
    contactId: string,
    userId: string,
    options: Omit<GetBusinessEventsOptions, 'contactId'> = {}
  ): Promise<BusinessEventServiceResult<BusinessEvent[]>> {
    return this.getEvents(userId, { ...options, contactId });
  }

  /**
   * Get events for a specific entity
   */
  async getEventsForEntity(
    entityType: BusinessEntityType,
    entityId: string,
    userId: string,
    options: Omit<GetBusinessEventsOptions, 'entityType' | 'entityId'> = {}
  ): Promise<BusinessEventServiceResult<BusinessEvent[]>> {
    return this.getEvents(userId, { ...options, entityType, entityId });
  }

  /**
   * Get events by category (business vector)
   */
  async getEventsByCategory(
    category: BusinessEventCategory,
    userId: string,
    options: Omit<GetBusinessEventsOptions, 'category'> = {}
  ): Promise<BusinessEventServiceResult<BusinessEvent[]>> {
    return this.getEvents(userId, { ...options, category });
  }

  /**
   * Get events with flexible filtering
   */
  async getEvents(
    userId: string,
    options: GetBusinessEventsOptions = {}
  ): Promise<BusinessEventServiceResult<BusinessEvent[]>> {
    try {
      const {
        eventType,
        category,
        entityType,
        entityId,
        contactId,
        sourceCapability,
        fromDate,
        toDate,
        limit = 100,
        offset = 0,
      } = options;

      let query = this.supabase
        .from('business_events')
        .select('*')
        .eq('user_id', userId);

      if (eventType) {
        query = query.eq('event_type', eventType);
      }

      if (category) {
        query = query.eq('category', category);
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

      if (sourceCapability) {
        query = query.eq('source_capability', sourceCapability);
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
      logger.error({ err: error, userId, options }, 'Failed to get business events');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get event counts by category (useful for dashboards)
   */
  async getEventCountsByCategory(
    userId: string,
    options: { fromDate?: string; toDate?: string } = {}
  ): Promise<BusinessEventServiceResult<Record<BusinessEventCategory, number>>> {
    try {
      const { fromDate, toDate } = options;

      let query = this.supabase
        .from('business_events')
        .select('category')
        .eq('user_id', userId);

      if (fromDate) {
        query = query.gte('created_at', fromDate);
      }

      if (toDate) {
        query = query.lte('created_at', toDate);
      }

      const { data, error } = await query;

      if (error) throw error;

      // Count by category
      const counts: Record<string, number> = {};
      for (const row of data || []) {
        counts[row.category] = (counts[row.category] || 0) + 1;
      }

      return { data: counts as Record<BusinessEventCategory, number>, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to get event counts by category');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get event counts by type (useful for metrics)
   */
  async getEventCountsByType(
    userId: string,
    options: { fromDate?: string; toDate?: string; category?: BusinessEventCategory } = {}
  ): Promise<BusinessEventServiceResult<Record<BusinessEventType, number>>> {
    try {
      const { fromDate, toDate, category } = options;

      let query = this.supabase
        .from('business_events')
        .select('event_type')
        .eq('user_id', userId);

      if (category) {
        query = query.eq('category', category);
      }

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

      return { data: counts as Record<BusinessEventType, number>, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to get event counts by type');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Subscribe to events (for real-time processing like detector engine)
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
  private async notifySubscribers(event: BusinessEvent): Promise<void> {
    for (const callback of eventSubscribers) {
      try {
        await callback(event);
      } catch (error) {
        logger.warn({ err: error, eventId: event.id }, 'Event subscriber threw error');
      }
    }
  }

  /**
   * Get recent events of specific types (useful for detectors)
   */
  async getRecentEventsByTypes(
    userId: string,
    eventTypes: BusinessEventType[],
    limit: number = 50
  ): Promise<BusinessEventServiceResult<BusinessEvent[]>> {
    try {
      const { data, error } = await this.supabase
        .from('business_events')
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
    eventType: BusinessEventType,
    entityType: BusinessEntityType,
    entityId: string,
    withinMinutes: number
  ): Promise<BusinessEventServiceResult<boolean>> {
    try {
      const threshold = new Date(Date.now() - withinMinutes * 60 * 1000).toISOString();

      const { data, error } = await this.supabase
        .from('business_events')
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
      logger.error(
        { err: error, userId, eventType, entityId },
        'Failed to check recent event'
      );
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get total value for events in a time range (useful for cash flow metrics)
   */
  async getTotalValue(
    userId: string,
    options: {
      category?: BusinessEventCategory;
      eventTypes?: BusinessEventType[];
      fromDate?: string;
      toDate?: string;
    } = {}
  ): Promise<BusinessEventServiceResult<number>> {
    try {
      const { category, eventTypes, fromDate, toDate } = options;

      let query = this.supabase
        .from('business_events')
        .select('value_usd')
        .eq('user_id', userId)
        .not('value_usd', 'is', null);

      if (category) {
        query = query.eq('category', category);
      }

      if (eventTypes && eventTypes.length > 0) {
        query = query.in('event_type', eventTypes);
      }

      if (fromDate) {
        query = query.gte('created_at', fromDate);
      }

      if (toDate) {
        query = query.lte('created_at', toDate);
      }

      const { data, error } = await query;

      if (error) throw error;

      // Sum all values
      const total = (data || []).reduce((sum, row) => sum + (row.value_usd || 0), 0);

      return { data: total, error: null };
    } catch (error) {
      logger.error({ err: error, userId, options }, 'Failed to get total value');
      return { data: null, error: error as Error };
    }
  }
}

// Singleton export
import { supabaseServer } from '@/lib/supabaseServer';
export const businessEventService = new BusinessEventService(supabaseServer);

// Helper for convenience
export async function emitBusinessEvent(
  userId: string,
  params: EmitBusinessEventParams
): Promise<BusinessEventServiceResult<BusinessEvent>> {
  return businessEventService.emit(userId, params);
}

// Re-export types
export * from './types';
