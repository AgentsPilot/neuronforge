/**
 * CalendarSyncService
 *
 * Orchestrates two-way calendar synchronization:
 * - Push (Outbound): AgentPilot bookings -> External calendar events
 * - Pull (Inbound): External calendar events -> Blocked time slots
 *
 * Uses existing Google Calendar and Outlook plugin executors for API calls.
 * Sync failures are non-blocking - they don't break booking operations.
 */

import { createLogger } from '@/lib/logger';
import { PluginExecuterV2 } from '@/lib/server/plugin-executer-v2';
import { schedulingBookingRepository, schedulingServiceRepository } from '@/lib/repositories/SchedulingRepository';
import { externalCalendarEventRepository } from '@/lib/repositories/ExternalCalendarEventRepository';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { pluginConnectionRepository } from '@/lib/repositories/PluginConnectionRepository';
import type { SchedulingBooking, SchedulingService, CalendarSyncProvider } from '@/lib/repositories/SchedulingRepository';
import type { ExternalCalendarEventInsert, CalendarProvider } from '@/lib/repositories/ExternalCalendarEventRepository';

const logger = createLogger({ service: 'CalendarSyncService' });

// Map our provider names to plugin names
const PROVIDER_TO_PLUGIN: Record<CalendarSyncProvider, string> = {
  'google_calendar': 'google-calendar',
  'outlook': 'outlook'
};

/**
 * The row a calendar event is recorded ON, when it is not the booking.
 *
 * A package is one booking with N meetings, so N events cannot share the
 * booking's single set of calendar columns — the last would win and the next
 * sync would re-create the rest. Each session's event lives on its own meeting
 * row (`external_calendar_event_id` and `calendar_synced_at` from 20261073,
 * the provider and the error from 20261087), and this is what the update and
 * delete paths are handed to find it.
 */
export interface CalendarEventRow {
  id: string;
  external_calendar_event_id: string | null;
  /* The same union the booking's column carries, so `PROVIDER_TO_PLUGIN` can
     be indexed with it rather than widened to `string`. */
  calendar_sync_provider: CalendarSyncProvider | null;
}

export interface SyncResult {
  success: boolean;
  eventId?: string;
  error?: string;
}

export interface SyncAllResult {
  total: number;
  synced: number;
  failed: number;
  errors: Array<{ bookingId: string; error: string }>;
}

export interface ExternalSyncResult {
  total: number;
  added: number;
  updated: number;
  removed: number;
  errors: string[];
}

class CalendarSyncServiceImpl {
  private static instance: CalendarSyncServiceImpl;

  private constructor() {}

  static getInstance(): CalendarSyncServiceImpl {
    if (!CalendarSyncServiceImpl.instance) {
      CalendarSyncServiceImpl.instance = new CalendarSyncServiceImpl();
    }
    return CalendarSyncServiceImpl.instance;
  }

  /**
   * Sync a single booking to the external calendar
   * Creates a calendar event with client as attendee
   */
  async syncBookingToCalendar(
    booking: SchedulingBooking,
    service: SchedulingService,
    userId: string,
    /**
     * The MEETING this event is for, when the booking has several.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * A package is one booking with N meetings, so N events would all record
     * themselves on that booking's single `external_calendar_event_id` — the
     * last one wins, and the next sync re-creates the other five because
     * nothing says they already exist. Six appointments, twelve diary entries.
     *
     * Given a meeting, the event id is recorded on the MEETING instead, which
     * has its own column for it. Absent — the ordinary case — nothing changes:
     * one booking, one appointment, one event, recorded where it always was.
     * ─────────────────────────────────────────────────────────────────────────
     */
    meetingId?: string | null
  ): Promise<SyncResult> {
    try {
      // Get user's sync settings
      const settingsResult = await businessProfileRepository.getCalendarSyncSettings(userId);
      if (settingsResult.error || !settingsResult.data?.enabled || !settingsResult.data.provider) {
        logger.debug({ userId, bookingId: booking.id }, 'Calendar sync not enabled for user');
        return { success: false, error: 'Calendar sync not enabled' };
      }

      const provider = settingsResult.data.provider;
      const pluginName = PROVIDER_TO_PLUGIN[provider];

      logger.info({ userId, bookingId: booking.id, provider }, 'Syncing booking to external calendar');

      // Get plugin executor
      const pluginExecuter = await PluginExecuterV2.getInstance();

      // Build event details
      const clientName = [booking.client_first_name, booking.client_last_name].filter(Boolean).join(' ');
      const summary = `${service.service_name} - ${clientName}`;
      const description = this.buildEventDescription(booking, service);
      const attendees = booking.client_email ? [booking.client_email] : [];

      // Create calendar event
      const result = await pluginExecuter.execute(userId, pluginName, 'create_event', {
        summary,
        description,
        start_time: booking.start_time,
        end_time: booking.end_time,
        attendees,
        send_notifications: true
      });

      if (!result.success) {
        logger.warn({ userId, bookingId: booking.id, error: result.error }, 'Failed to create calendar event');

        const syncError = result.message || result.error || 'Unknown error';

        if (meetingId) {
          await schedulingBookingRepository.updateMeetingCalendarSync(meetingId, userId, {
            calendar_sync_error: syncError
          });
        } else {
          await schedulingBookingRepository.updateCalendarSync(booking.id, userId, {
            calendar_sync_error: syncError
          });
        }

        return { success: false, error: result.message || result.error };
      }

      const eventId = result.data?.event_id || result.data?.eventId;

      if (meetingId) {
        await schedulingBookingRepository.updateMeetingCalendarSync(meetingId, userId, {
          external_calendar_event_id: eventId,
          /* 20261087. Without it this event could never be updated or deleted:
             both paths look it up by provider. */
          calendar_sync_provider: provider,
          calendar_synced_at: new Date().toISOString(),
          calendar_sync_error: null
        });
      } else {
        // Update booking with sync info
        await schedulingBookingRepository.updateCalendarSync(booking.id, userId, {
          external_calendar_event_id: eventId,
          calendar_sync_provider: provider,
          calendar_synced_at: new Date().toISOString(),
          calendar_sync_error: null
        });
      }

      logger.info({ userId, bookingId: booking.id, meetingId, eventId }, 'Booking synced to calendar');
      return { success: true, eventId };
    } catch (error) {
      logger.error({ err: error, userId, bookingId: booking.id }, 'Error syncing booking to calendar');
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Update an existing calendar event when booking is updated
   */
  async updateCalendarEvent(
    booking: SchedulingBooking,
    service: SchedulingService,
    userId: string,
    /**
     * The SESSION whose event this is, when the booking has several.
     *
     * A package's six events are recorded on their own meeting rows, so the
     * booking carries no event id to look one up by — and without this, moving
     * one session left a stale entry in the owner's diary while the client had
     * been told a new time.
     */
    meeting?: CalendarEventRow | null,
    /**
     * What happened at it, written in front of the title.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * For an appointment whose hour has passed, the diary entry is a RECORD
     * rather than a reservation, and the useful thing is that it says which
     * kind. "לא הגיע: טיפול ADHD - דני" read at a glance beats an entry that
     * looks exactly like one somebody attended, and it makes a repeat no-show
     * obvious without opening the CRM.
     *
     * Only ever a prefix. The service and the client stay in the title, so
     * searching the calendar for either still finds it.
     *
     * Resolved by the caller, which is where the outcome and the business's
     * language are both known. Undefined leaves the title exactly as it was,
     * which is what every existing caller passes.
     * ─────────────────────────────────────────────────────────────────────────
     */
    outcomeLabel?: string | null
  ): Promise<SyncResult> {
    try {
      /* The row the event was recorded on. */
      const on = meeting ?? booking;

      if (!on.external_calendar_event_id || !on.calendar_sync_provider) {
        logger.debug({ userId, bookingId: booking.id, meetingId: meeting?.id }, 'Nothing has a calendar event to update');
        return { success: false, error: 'No calendar event linked' };
      }

      const provider = on.calendar_sync_provider;
      const pluginName = PROVIDER_TO_PLUGIN[provider];

      logger.info({ userId, bookingId: booking.id, meetingId: meeting?.id, eventId: on.external_calendar_event_id }, 'Updating calendar event');

      const pluginExecuter = await PluginExecuterV2.getInstance();

      // Build updated event details
      const clientName = [booking.client_first_name, booking.client_last_name].filter(Boolean).join(' ');
      const base = `${service.service_name} - ${clientName}`;
      /* The outcome first, so it survives a calendar view that truncates. */
      const summary = outcomeLabel ? `${outcomeLabel}: ${base}` : base;
      const description = this.buildEventDescription(booking, service);
      const attendees = booking.client_email ? [booking.client_email] : [];

      const result = await pluginExecuter.execute(userId, pluginName, 'update_event', {
        event_id: on.external_calendar_event_id,
        summary,
        description,
        start_time: booking.start_time,
        end_time: booking.end_time,
        attendees,
        send_notifications: true
      });

      if (!result.success) {
        logger.warn({ userId, bookingId: booking.id, meetingId: meeting?.id, error: result.error }, 'Failed to update calendar event');

        const syncError = result.message || result.error || 'Unknown error';

        if (meeting) {
          await schedulingBookingRepository.updateMeetingCalendarSync(meeting.id, userId, { calendar_sync_error: syncError });
        } else {
          await schedulingBookingRepository.updateCalendarSync(booking.id, userId, { calendar_sync_error: syncError });
        }

        return { success: false, error: result.message || result.error };
      }

      // Update sync timestamp
      if (meeting) {
        await schedulingBookingRepository.updateMeetingCalendarSync(meeting.id, userId, {
          calendar_synced_at: new Date().toISOString(),
          calendar_sync_error: null
        });
      } else {
        await schedulingBookingRepository.updateCalendarSync(booking.id, userId, {
          calendar_synced_at: new Date().toISOString(),
          calendar_sync_error: null
        });
      }

      logger.info({ userId, bookingId: booking.id, meetingId: meeting?.id }, 'Calendar event updated');
      return { success: true, eventId: on.external_calendar_event_id };
    } catch (error) {
      logger.error({ err: error, userId, bookingId: booking.id }, 'Error updating calendar event');
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Delete a calendar event when booking is cancelled
   */
  async deleteCalendarEvent(
    booking: SchedulingBooking,
    userId: string,
    /**
     * The SESSION whose event this is, when the booking has several.
     *
     * Calling off one session of a package must take ONE entry out of the
     * owner's diary. Without this it found no event on the booking and left
     * all six standing.
     */
    meeting?: CalendarEventRow | null
  ): Promise<SyncResult> {
    try {
      const on = meeting ?? booking;

      if (!on.external_calendar_event_id || !on.calendar_sync_provider) {
        logger.debug({ userId, bookingId: booking.id, meetingId: meeting?.id }, 'Nothing has a calendar event to delete');
        return { success: false, error: 'No calendar event linked' };
      }

      const provider = on.calendar_sync_provider;
      const pluginName = PROVIDER_TO_PLUGIN[provider];

      logger.info({ userId, bookingId: booking.id, meetingId: meeting?.id, eventId: on.external_calendar_event_id }, 'Deleting calendar event');

      const pluginExecuter = await PluginExecuterV2.getInstance();

      const result = await pluginExecuter.execute(userId, pluginName, 'delete_event', {
        event_id: on.external_calendar_event_id,
        send_notifications: true
      });

      if (!result.success) {
        // If event not found, consider it a success (already deleted)
        if (result.error === 'event_not_found' || result.message?.includes('404')) {
          logger.info({ userId, bookingId: booking.id, meetingId: meeting?.id }, 'Calendar event already deleted');
        } else {
          logger.warn({ userId, bookingId: booking.id, meetingId: meeting?.id, error: result.error }, 'Failed to delete calendar event');
          return { success: false, error: result.message || result.error };
        }
      }

      /*
       * Clear it where it was recorded. Clearing the BOOKING's columns for a
       * session would say the package has no calendar events at all, and the
       * next sync would create five duplicates.
       */
      if (meeting) {
        await schedulingBookingRepository.updateMeetingCalendarSync(meeting.id, userId, {
          external_calendar_event_id: null,
          calendar_sync_provider: null,
          calendar_synced_at: null,
          calendar_sync_error: null
        });
      } else {
        await schedulingBookingRepository.clearCalendarSync(booking.id, userId);
      }

      logger.info({ userId, bookingId: booking.id, meetingId: meeting?.id }, 'Calendar event deleted');
      return { success: true };
    } catch (error) {
      logger.error({ err: error, userId, bookingId: booking.id }, 'Error deleting calendar event');
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Sync all confirmed bookings that don't have a calendar event yet
   */
  async syncAllBookings(userId: string): Promise<SyncAllResult> {
    const result: SyncAllResult = { total: 0, synced: 0, failed: 0, errors: [] };

    try {
      // Get user's sync settings
      const settingsResult = await businessProfileRepository.getCalendarSyncSettings(userId);
      if (settingsResult.error || !settingsResult.data?.enabled || !settingsResult.data.provider) {
        return { ...result, errors: [{ bookingId: '', error: 'Calendar sync not enabled' }] };
      }

      // Get bookings that need sync
      const bookingsResult = await schedulingBookingRepository.getBookingsNeedingSync(userId);
      if (bookingsResult.error || !bookingsResult.data) {
        return { ...result, errors: [{ bookingId: '', error: 'Failed to fetch bookings' }] };
      }

      const bookings = bookingsResult.data;
      result.total = bookings.length;

      logger.info({ userId, count: bookings.length }, 'Syncing all bookings to calendar');

      // Process each booking
      for (const booking of bookings) {
        // Get the service for this booking
        const serviceResult = await schedulingServiceRepository.findById(booking.service_id, userId);
        if (serviceResult.error || !serviceResult.data) {
          result.failed++;
          result.errors.push({ bookingId: booking.id, error: 'Service not found' });
          continue;
        }

        const syncResult = await this.syncBookingToCalendar(booking, serviceResult.data, userId);
        if (syncResult.success) {
          result.synced++;
        } else {
          result.failed++;
          result.errors.push({ bookingId: booking.id, error: syncResult.error || 'Unknown error' });
        }
      }

      logger.info({ userId, ...result }, 'Sync all bookings completed');
      return result;
    } catch (error) {
      logger.error({ err: error, userId }, 'Error syncing all bookings');
      return { ...result, errors: [{ bookingId: '', error: (error as Error).message }] };
    }
  }

  /**
   * Get sync statistics for a user
   */
  async getSyncStatus(userId: string): Promise<{
    enabled: boolean;
    provider: CalendarSyncProvider | null;
    lastSyncedAt: string | null;
    stats: { total: number; synced: number; failed: number };
  }> {
    const settingsResult = await businessProfileRepository.getCalendarSyncSettings(userId);
    const statsResult = await schedulingBookingRepository.getSyncStats(userId);

    const provider = settingsResult.data?.provider ?? null;
    const storedEnabled = settingsResult.data?.enabled ?? false;

    // Sync cannot be on without the plugin it runs through. Disconnecting the
    // calendar leaves the profile flag set — from the plugins page, the footer,
    // or a revoked grant on Google's side — and the settings card then showed a
    // green "synced with Google Calendar" banner over a connection that no
    // longer exists. Reported as off; the stored flag is left for the user to
    // change deliberately rather than written from a read.
    let enabled = storedEnabled;
    if (storedEnabled && provider) {
      const { data: pluginConnected } = await pluginConnectionRepository.existsByUserAndPlugin(
        userId,
        PROVIDER_TO_PLUGIN[provider]
      );
      if (pluginConnected === false) {
        logger.warn({ userId, provider }, 'Calendar sync is enabled but its plugin is disconnected');
        enabled = false;
      }
    }

    return {
      enabled,
      provider,
      lastSyncedAt: settingsResult.data?.lastSyncedAt ?? null,
      stats: statsResult.data ?? { total: 0, synced: 0, failed: 0 }
    };
  }

  /**
   * Enable calendar sync for a user
   */
  async enableSync(userId: string, provider: CalendarSyncProvider): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await businessProfileRepository.enableCalendarSync(userId, provider);
      if (result.error) {
        return { success: false, error: result.error.message };
      }
      logger.info({ userId, provider }, 'Calendar sync enabled');
      return { success: true };
    } catch (error) {
      logger.error({ err: error, userId, provider }, 'Error enabling calendar sync');
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Disable calendar sync for a user
   */
  async disableSync(userId: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Disable sync in business profile
      const result = await businessProfileRepository.disableCalendarSync(userId);
      if (result.error) {
        return { success: false, error: result.error.message };
      }

      // Clear ALL external calendar events for this user (regardless of provider)
      // This ensures cleanup even if there are leftover events from previous syncs
      const deleteResult = await externalCalendarEventRepository.deleteAllForUser(userId);
      logger.info({ userId, deleted: deleteResult.data }, 'Cleared all external calendar events');

      logger.info({ userId }, 'Calendar sync disabled');
      return { success: true };
    } catch (error) {
      logger.error({ err: error, userId }, 'Error disabling calendar sync');
      return { success: false, error: (error as Error).message };
    }
  }

  // ==================== INBOUND SYNC (External Calendar -> Blocked Slots) ====================

  /**
   * Fetch and store external calendar events for a user
   * Called by the background cron job and on-demand refresh
   */
  async syncExternalEvents(userId: string): Promise<ExternalSyncResult> {
    const result: ExternalSyncResult = { total: 0, added: 0, updated: 0, removed: 0, errors: [] };

    try {
      // Get user's sync settings
      const settingsResult = await businessProfileRepository.getCalendarSyncSettings(userId);
      if (settingsResult.error || !settingsResult.data?.enabled || !settingsResult.data.provider) {
        return result;
      }

      const provider = settingsResult.data.provider;
      const pluginName = PROVIDER_TO_PLUGIN[provider];

      logger.info({ userId, provider }, 'Fetching external calendar events');

      const pluginExecuter = await PluginExecuterV2.getInstance();

      // Fetch events for the next 30 days
      const now = new Date();
      const timeMin = now.toISOString();
      const timeMax = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

      const listResult = await pluginExecuter.execute(userId, pluginName, 'list_events', {
        time_min: timeMin,
        time_max: timeMax,
        max_results: 250, // Google Calendar max
        single_events: true
      });

      if (!listResult.success) {
        logger.warn({ userId, provider, error: listResult.error }, 'Failed to fetch external events');
        result.errors.push(listResult.message || listResult.error || 'Failed to fetch events');
        return result;
      }

      const externalEvents = listResult.data?.events || [];
      result.total = externalEvents.length;

      logger.info({ userId, eventCount: externalEvents.length }, 'Fetched external events');

      // Get existing event IDs in our database
      const existingEventsResult = await externalCalendarEventRepository.list(userId, {
        provider,
        startDate: timeMin,
        endDate: timeMax
      });
      const existingEventIds = new Set(
        (existingEventsResult.data || []).map(e => e.external_event_id)
      );

      // Prepare events for upsert
      const eventsToUpsert: ExternalCalendarEventInsert[] = [];
      const newEventIds = new Set<string>();

      for (const event of externalEvents) {
        const eventId = event.id;
        if (!eventId) continue;

        newEventIds.add(eventId);

        // Parse start/end times (handle all-day events)
        const startTime = event.start;
        const endTime = event.end;
        if (!startTime || !endTime) continue;

        // Detect all-day events (date format without time)
        const isAllDay = !startTime.includes('T');

        eventsToUpsert.push({
          user_id: userId,
          external_event_id: eventId,
          provider: provider as CalendarProvider,
          title: event.summary || null, // May be null for privacy
          start_time: isAllDay ? `${startTime}T00:00:00Z` : startTime,
          end_time: isAllDay ? `${endTime}T00:00:00Z` : endTime,
          is_all_day: isAllDay
        });

        if (existingEventIds.has(eventId)) {
          result.updated++;
        } else {
          result.added++;
        }
      }

      // Upsert all events
      if (eventsToUpsert.length > 0) {
        const upsertResult = await externalCalendarEventRepository.upsertMany(eventsToUpsert);
        if (upsertResult.error) {
          result.errors.push('Failed to save some events');
        }
      }

      // Remove events that no longer exist in external calendar
      const eventsToRemove = Array.from(existingEventIds).filter(id => !newEventIds.has(id));
      if (eventsToRemove.length > 0) {
        const deleteResult = await externalCalendarEventRepository.deleteByExternalIds(
          eventsToRemove,
          provider as CalendarProvider,
          userId
        );
        result.removed = deleteResult.data || 0;
      }

      // Update last synced timestamp
      await businessProfileRepository.updateCalendarLastSynced(userId);

      // Clean up old events (before today)
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      await externalCalendarEventRepository.deleteOldEvents(userId, yesterday);

      logger.info({ userId, ...result }, 'External calendar sync completed');
      return result;
    } catch (error) {
      logger.error({ err: error, userId }, 'Error syncing external events');
      result.errors.push((error as Error).message);
      return result;
    }
  }

  /**
   * Get busy slots from stored external calendar events
   * Used to block availability in booking flow
   */
  async getExternalBusySlots(
    userId: string,
    startDate: string,
    endDate: string
  ): Promise<{ start: string; end: string; source: CalendarProvider; is_all_day: boolean }[]> {
    try {
      // First check if sync is enabled - if not, return empty (and clean up any orphaned events)
      const settingsResult = await businessProfileRepository.getCalendarSyncSettings(userId);
      const syncEnabled = settingsResult.data?.enabled;

      logger.info({ userId, syncEnabled, provider: settingsResult.data?.provider }, 'Checking calendar sync status for busy slots');

      if (!syncEnabled) {
        // Clean up any orphaned events that might exist from before a bug fix
        const deleteResult = await externalCalendarEventRepository.deleteAllForUser(userId);
        logger.info({ userId, deleted: deleteResult.data }, 'Cleaned up orphaned external calendar events');
        return [];
      }

      const result = await externalCalendarEventRepository.getBusySlots(userId, startDate, endDate);
      return result.data || [];
    } catch (error) {
      logger.error({ err: error, userId, startDate, endDate }, 'Error getting external busy slots');
      return [];
    }
  }

  /**
   * Check if a time slot is blocked by an external event
   */
  async isSlotBlockedByExternalEvent(
    userId: string,
    startTime: string,
    endTime: string
  ): Promise<boolean> {
    try {
      // If sync is not enabled, slot is not blocked by external events
      const settingsResult = await businessProfileRepository.getCalendarSyncSettings(userId);
      if (!settingsResult.data?.enabled) {
        return false;
      }

      const result = await externalCalendarEventRepository.isSlotBlocked(userId, startTime, endTime);
      return result.data || false;
    } catch (error) {
      logger.error({ err: error, userId, startTime, endTime }, 'Error checking if slot is blocked');
      return false;
    }
  }

  // ==================== HELPER METHODS ====================

  private buildEventDescription(booking: SchedulingBooking, service: SchedulingService): string {
    const parts: string[] = [];

    parts.push(`Service: ${service.service_name}`);

    if (service.description) {
      parts.push(`\n${service.description}`);
    }

    parts.push(`\nClient: ${booking.client_first_name}${booking.client_last_name ? ' ' + booking.client_last_name : ''}`);

    if (booking.client_email) {
      parts.push(`Email: ${booking.client_email}`);
    }

    if (booking.client_phone) {
      parts.push(`Phone: ${booking.client_phone}`);
    }

    if (booking.notes) {
      parts.push(`\nNotes: ${booking.notes}`);
    }

    parts.push('\n---\nBooked via AgentPilot');

    return parts.join('\n');
  }
}

// Export singleton instance
export const CalendarSyncService = CalendarSyncServiceImpl.getInstance();
