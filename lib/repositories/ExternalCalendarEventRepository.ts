/**
 * External Calendar Event Repository
 * Handles database operations for external calendar events (Google Calendar, Outlook)
 * Used to block scheduling availability based on events from external calendars
 *
 * Following the repository pattern defined in REPOSITORY_STRATEGY.md
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ service: 'ExternalCalendarEventRepository' });

// ==================== TYPES ====================

export type CalendarProvider = 'google_calendar' | 'outlook';

export interface ExternalCalendarEvent {
  id: string;
  user_id: string;
  external_event_id: string;
  provider: CalendarProvider;
  title: string | null;
  start_time: string;
  end_time: string;
  is_all_day: boolean;
  last_synced_at: string;
  created_at: string;
  updated_at: string;
}

export interface ExternalCalendarEventInsert {
  user_id: string;
  external_event_id: string;
  provider: CalendarProvider;
  title?: string | null;
  start_time: string;
  end_time: string;
  is_all_day?: boolean;
}

export interface ExternalCalendarEventUpdate {
  title?: string | null;
  start_time?: string;
  end_time?: string;
  is_all_day?: boolean;
  last_synced_at?: string;
}

export interface BusySlot {
  start: string;
  end: string;
  source: CalendarProvider;
  is_all_day: boolean;
}

export interface ExternalCalendarEventRepositoryResult<T> {
  data: T | null;
  error: Error | null;
}

// ==================== REPOSITORY ====================

export class ExternalCalendarEventRepository {
  private supabase: SupabaseClient;

  constructor(supabaseClient: SupabaseClient) {
    this.supabase = supabaseClient;
  }

  /**
   * Upsert an external calendar event
   * Updates if event with same external_event_id + provider exists, otherwise inserts
   */
  async upsert(
    event: ExternalCalendarEventInsert
  ): Promise<ExternalCalendarEventRepositoryResult<ExternalCalendarEvent>> {
    try {
      logger.debug({
        userId: event.user_id,
        provider: event.provider,
        externalEventId: event.external_event_id
      }, 'Upserting external calendar event');

      const { data, error } = await this.supabase
        .from('external_calendar_events')
        .upsert(
          {
            ...event,
            is_all_day: event.is_all_day ?? false,
            last_synced_at: new Date().toISOString()
          },
          {
            onConflict: 'user_id,external_event_id,provider',
            ignoreDuplicates: false
          }
        )
        .select()
        .single();

      if (error) throw error;

      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, userId: event.user_id }, 'Failed to upsert external calendar event');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Upsert multiple external calendar events in batch
   * More efficient for sync operations
   */
  async upsertMany(
    events: ExternalCalendarEventInsert[]
  ): Promise<ExternalCalendarEventRepositoryResult<ExternalCalendarEvent[]>> {
    try {
      if (events.length === 0) {
        return { data: [], error: null };
      }

      const userId = events[0].user_id;
      logger.info({ userId, count: events.length }, 'Upserting multiple external calendar events');

      const eventsWithDefaults = events.map(event => ({
        ...event,
        is_all_day: event.is_all_day ?? false,
        last_synced_at: new Date().toISOString()
      }));

      const { data, error } = await this.supabase
        .from('external_calendar_events')
        .upsert(eventsWithDefaults, {
          onConflict: 'user_id,external_event_id,provider',
          ignoreDuplicates: false
        })
        .select();

      if (error) throw error;

      logger.info({ userId, upserted: data?.length || 0 }, 'External calendar events upserted');
      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error }, 'Failed to upsert multiple external calendar events');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Find event by ID
   */
  async findById(
    id: string,
    userId: string
  ): Promise<ExternalCalendarEventRepositoryResult<ExternalCalendarEvent>> {
    try {
      const { data, error } = await this.supabase
        .from('external_calendar_events')
        .select('*')
        .eq('id', id)
        .eq('user_id', userId)
        .single();

      if (error) throw error;

      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, eventId: id, userId }, 'Failed to find external calendar event');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Find event by external event ID and provider
   */
  async findByExternalId(
    externalEventId: string,
    provider: CalendarProvider,
    userId: string
  ): Promise<ExternalCalendarEventRepositoryResult<ExternalCalendarEvent>> {
    try {
      const { data, error } = await this.supabase
        .from('external_calendar_events')
        .select('*')
        .eq('external_event_id', externalEventId)
        .eq('provider', provider)
        .eq('user_id', userId)
        .single();

      if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows

      return { data: data || null, error: null };
    } catch (error) {
      logger.error({ err: error, externalEventId, provider, userId }, 'Failed to find external calendar event by external ID');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get busy slots for a user within a time range
   * Used to block availability in scheduling
   */
  async getBusySlots(
    userId: string,
    startDate: string,
    endDate: string
  ): Promise<ExternalCalendarEventRepositoryResult<BusySlot[]>> {
    try {
      logger.debug({ userId, startDate, endDate }, 'Getting busy slots from external calendar events');

      const { data, error } = await this.supabase
        .from('external_calendar_events')
        .select('start_time, end_time, provider, is_all_day')
        .eq('user_id', userId)
        .lt('start_time', endDate)
        .gt('end_time', startDate)
        .order('start_time', { ascending: true });

      if (error) throw error;

      const busySlots: BusySlot[] = (data || []).map(event => ({
        start: event.start_time,
        end: event.end_time,
        source: event.provider as CalendarProvider,
        is_all_day: event.is_all_day
      }));

      return { data: busySlots, error: null };
    } catch (error) {
      logger.error({ err: error, userId, startDate, endDate }, 'Failed to get busy slots');
      return { data: null, error: error as Error };
    }
  }

  /**
   * List all external events for a user with optional provider filter
   */
  async list(
    userId: string,
    options: {
      provider?: CalendarProvider;
      startDate?: string;
      endDate?: string;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<ExternalCalendarEventRepositoryResult<ExternalCalendarEvent[]>> {
    try {
      const { provider, startDate, endDate, limit = 100, offset = 0 } = options;

      let query = this.supabase
        .from('external_calendar_events')
        .select('*')
        .eq('user_id', userId);

      if (provider) {
        query = query.eq('provider', provider);
      }

      if (startDate) {
        query = query.gte('start_time', startDate);
      }

      if (endDate) {
        query = query.lte('end_time', endDate);
      }

      query = query
        .order('start_time', { ascending: true })
        .range(offset, offset + limit - 1);

      const { data, error } = await query;

      if (error) throw error;

      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error, userId, options }, 'Failed to list external calendar events');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Delete an external event
   */
  async delete(
    id: string,
    userId: string
  ): Promise<ExternalCalendarEventRepositoryResult<void>> {
    try {
      logger.info({ eventId: id, userId }, 'Deleting external calendar event');

      const { error } = await this.supabase
        .from('external_calendar_events')
        .delete()
        .eq('id', id)
        .eq('user_id', userId);

      if (error) throw error;

      return { data: null, error: null };
    } catch (error) {
      logger.error({ err: error, eventId: id, userId }, 'Failed to delete external calendar event');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Delete events by external event IDs
   * Used when external events no longer exist in the external calendar
   */
  async deleteByExternalIds(
    externalEventIds: string[],
    provider: CalendarProvider,
    userId: string
  ): Promise<ExternalCalendarEventRepositoryResult<number>> {
    try {
      if (externalEventIds.length === 0) {
        return { data: 0, error: null };
      }

      logger.info({ userId, provider, count: externalEventIds.length }, 'Deleting external calendar events by external IDs');

      const { data, error } = await this.supabase
        .from('external_calendar_events')
        .delete()
        .eq('user_id', userId)
        .eq('provider', provider)
        .in('external_event_id', externalEventIds)
        .select();

      if (error) throw error;

      const deletedCount = data?.length || 0;
      logger.info({ userId, provider, deleted: deletedCount }, 'External calendar events deleted');
      return { data: deletedCount, error: null };
    } catch (error) {
      logger.error({ err: error, userId, provider }, 'Failed to delete external calendar events by external IDs');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Delete all events for a user and provider
   * Used when user disconnects their calendar
   */
  async deleteAllForProvider(
    userId: string,
    provider: CalendarProvider
  ): Promise<ExternalCalendarEventRepositoryResult<number>> {
    try {
      logger.info({ userId, provider }, 'Deleting all external calendar events for provider');

      const { data, error } = await this.supabase
        .from('external_calendar_events')
        .delete()
        .eq('user_id', userId)
        .eq('provider', provider)
        .select();

      if (error) throw error;

      const deletedCount = data?.length || 0;
      logger.info({ userId, provider, deleted: deletedCount }, 'All external calendar events for provider deleted');
      return { data: deletedCount, error: null };
    } catch (error) {
      logger.error({ err: error, userId, provider }, 'Failed to delete all external calendar events for provider');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Delete all events for a user (all providers)
   * Used when completely disabling calendar sync
   */
  async deleteAllForUser(
    userId: string
  ): Promise<ExternalCalendarEventRepositoryResult<number>> {
    try {
      logger.info({ userId }, 'Deleting all external calendar events for user');

      const { data, error } = await this.supabase
        .from('external_calendar_events')
        .delete()
        .eq('user_id', userId)
        .select();

      if (error) throw error;

      const deletedCount = data?.length || 0;
      logger.info({ userId, deleted: deletedCount }, 'All external calendar events for user deleted');
      return { data: deletedCount, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to delete all external calendar events for user');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Delete old events (before a certain date)
   * Used for cleanup of past events
   */
  async deleteOldEvents(
    userId: string,
    beforeDate: string
  ): Promise<ExternalCalendarEventRepositoryResult<number>> {
    try {
      logger.info({ userId, beforeDate }, 'Deleting old external calendar events');

      const { data, error } = await this.supabase
        .from('external_calendar_events')
        .delete()
        .eq('user_id', userId)
        .lt('end_time', beforeDate)
        .select();

      if (error) throw error;

      const deletedCount = data?.length || 0;
      logger.info({ userId, deleted: deletedCount }, 'Old external calendar events deleted');
      return { data: deletedCount, error: null };
    } catch (error) {
      logger.error({ err: error, userId, beforeDate }, 'Failed to delete old external calendar events');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get users who need external calendar sync
   * Returns user IDs with their last sync time for users with calendar sync enabled
   */
  async getUsersNeedingSync(
    staleAfterMinutes: number = 5
  ): Promise<ExternalCalendarEventRepositoryResult<{ userId: string; provider: CalendarProvider; lastSyncedAt: string | null }[]>> {
    try {
      const staleThreshold = new Date(Date.now() - staleAfterMinutes * 60 * 1000).toISOString();

      // Query business_profiles for users with calendar_sync_enabled
      const { data, error } = await this.supabase
        .from('business_profiles')
        .select('user_id, calendar_sync_provider, calendar_last_synced_at')
        .eq('calendar_sync_enabled', true)
        .not('calendar_sync_provider', 'is', null)
        .or(`calendar_last_synced_at.is.null,calendar_last_synced_at.lt.${staleThreshold}`);

      if (error) throw error;

      const usersNeedingSync = (data || []).map(profile => ({
        userId: profile.user_id,
        provider: profile.calendar_sync_provider as CalendarProvider,
        lastSyncedAt: profile.calendar_last_synced_at
      }));

      logger.info({ count: usersNeedingSync.length, staleAfterMinutes }, 'Found users needing calendar sync');
      return { data: usersNeedingSync, error: null };
    } catch (error) {
      logger.error({ err: error, staleAfterMinutes }, 'Failed to get users needing sync');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Check if a time slot overlaps with any external events
   * Returns true if there's an overlap (slot is busy)
   */
  async isSlotBlocked(
    userId: string,
    startTime: string,
    endTime: string
  ): Promise<ExternalCalendarEventRepositoryResult<boolean>> {
    try {
      // Find events that overlap with the requested time slot
      // Overlap occurs when: existing_start < new_end AND existing_end > new_start
      const { data, error } = await this.supabase
        .from('external_calendar_events')
        .select('id')
        .eq('user_id', userId)
        .lt('start_time', endTime)
        .gt('end_time', startTime)
        .limit(1);

      if (error) throw error;

      const isBlocked = (data?.length || 0) > 0;
      return { data: isBlocked, error: null };
    } catch (error) {
      logger.error({ err: error, userId, startTime, endTime }, 'Failed to check if slot is blocked');
      return { data: null, error: error as Error };
    }
  }
}

// Singleton export (initialized with server-side Supabase client)
import { supabaseServer } from '@/lib/supabaseServer';
export const externalCalendarEventRepository = new ExternalCalendarEventRepository(supabaseServer);
