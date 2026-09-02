// lib/repositories/PaymentEventRepository.ts
// Repository for the append-only `payment_events` table.
//
// Phase-2 of the Payments repo-layer conformance work. Mirrors PaymentRepository.ts
// (constructor DI with a supabaseServer default, module-level Pino logger,
// { data, error } results, singleton export, direct-path import — no barrel).
//
// NOTE: `payment_events` is append-only and has NO `updated_at` column — this
// repository never writes/reads one.

import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';
import type { PaymentRepositoryResult } from '@/lib/repositories/PaymentRepository';
import type {
  PaymentEvent,
  PaymentEventType,
  PaymentEntityType,
} from '@/lib/services/PaymentEventService';

const logger = createLogger({ service: 'PaymentEventRepository' });

/** Insertable event fields (user_id is supplied separately + created_at is DB-defaulted). */
export interface PaymentEventInsert {
  event_type: PaymentEventType;
  entity_type: PaymentEntityType;
  entity_id: string;
  contact_id?: string | null;
  processor_type?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ListEventsOptions {
  eventType?: PaymentEventType;
  entityType?: PaymentEntityType;
  entityId?: string;
  contactId?: string;
  processorType?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
  offset?: number;
}

export class PaymentEventRepository {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient = supabaseServer) {
    this.supabase = supabase;
  }

  async create(
    userId: string,
    event: PaymentEventInsert
  ): Promise<PaymentRepositoryResult<PaymentEvent>> {
    try {
      const { data, error } = await this.supabase
        .from('payment_events')
        .insert({
          user_id: userId,
          event_type: event.event_type,
          entity_type: event.entity_type,
          entity_id: event.entity_id,
          contact_id: event.contact_id ?? null,
          processor_type: event.processor_type ?? null,
          metadata: event.metadata ?? {},
        })
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to create payment event');
      return { data: null, error: error as Error };
    }
  }

  async createMany(
    userId: string,
    events: PaymentEventInsert[]
  ): Promise<PaymentRepositoryResult<PaymentEvent[]>> {
    try {
      if (events.length === 0) return { data: [], error: null };

      const rows = events.map(e => ({
        user_id: userId,
        event_type: e.event_type,
        entity_type: e.entity_type,
        entity_id: e.entity_id,
        contact_id: e.contact_id ?? null,
        processor_type: e.processor_type ?? null,
        metadata: e.metadata ?? {},
      }));

      const { data, error } = await this.supabase
        .from('payment_events')
        .insert(rows)
        .select();

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error, userId, count: events.length }, 'Failed to create payment events');
      return { data: null, error: error as Error };
    }
  }

  /** Flexible, user-scoped event query (newest first). */
  async list(
    userId: string,
    options: ListEventsOptions = {}
  ): Promise<PaymentRepositoryResult<PaymentEvent[]>> {
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
        offset = 0,
      } = options;

      let query = this.supabase
        .from('payment_events')
        .select('*')
        .eq('user_id', userId);

      if (eventType) query = query.eq('event_type', eventType);
      if (entityType) query = query.eq('entity_type', entityType);
      if (entityId) query = query.eq('entity_id', entityId);
      if (contactId) query = query.eq('contact_id', contactId);
      if (processorType) query = query.eq('processor_type', processorType);
      if (fromDate) query = query.gte('created_at', fromDate);
      if (toDate) query = query.lte('created_at', toDate);

      query = query
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      const { data, error } = await query;
      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error, userId, options }, 'Failed to list payment events');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Return the raw `event_type` values within an optional date range (for count
   * aggregation by the caller). User-scoped.
   */
  async listEventTypes(
    userId: string,
    range: { fromDate?: string; toDate?: string } = {}
  ): Promise<PaymentRepositoryResult<Array<{ event_type: PaymentEventType }>>> {
    try {
      const { fromDate, toDate } = range;

      let query = this.supabase
        .from('payment_events')
        .select('event_type')
        .eq('user_id', userId);

      if (fromDate) query = query.gte('created_at', fromDate);
      if (toDate) query = query.lte('created_at', toDate);

      const { data, error } = await query;
      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to list event types');
      return { data: null, error: error as Error };
    }
  }

  /** Most recent events matching any of the given types. User-scoped. */
  async findRecentByTypes(
    userId: string,
    eventTypes: PaymentEventType[],
    limit = 50
  ): Promise<PaymentRepositoryResult<PaymentEvent[]>> {
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
      logger.error({ err: error, userId, eventTypes }, 'Failed to find recent events by types');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Whether an event of a type exists for an entity since a threshold timestamp.
   * Used for dedup / cooldown checks. User-scoped.
   */
  async existsRecent(
    userId: string,
    params: {
      eventType: PaymentEventType;
      entityType: PaymentEntityType;
      entityId: string;
      since: string;
    }
  ): Promise<PaymentRepositoryResult<boolean>> {
    try {
      const { data, error } = await this.supabase
        .from('payment_events')
        .select('id')
        .eq('user_id', userId)
        .eq('event_type', params.eventType)
        .eq('entity_type', params.entityType)
        .eq('entity_id', params.entityId)
        .gte('created_at', params.since)
        .limit(1);

      if (error) throw error;
      return { data: (data?.length || 0) > 0, error: null };
    } catch (error) {
      logger.error({ err: error, userId, params }, 'Failed to check recent event');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Fetch an event by id WITHOUT a user_id filter.
   *
   * ⟨unscoped-by-design⟩ — called only by the cross-user automation cron
   * (PaymentAutomationEngine.processScheduledExecutions) which resolves the
   * original trigger event for a scheduled execution across all users. Precedent:
   * PluginConnectionRepository.markExpired / findActiveByProfileData.
   */
  async findByIdUnscoped(id: string): Promise<PaymentRepositoryResult<PaymentEvent>> {
    try {
      const { data, error } = await this.supabase
        .from('payment_events')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, id }, 'Failed to find payment event by id');
      return { data: null, error: error as Error };
    }
  }
}

// Singleton export
export const paymentEventRepository = new PaymentEventRepository();
