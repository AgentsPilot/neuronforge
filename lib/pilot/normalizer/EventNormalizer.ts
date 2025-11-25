/**
 * EventNormalizer - Normalize calendar events from different providers
 *
 * Phase 1: Data Normalization Layer
 * Supports: Google Calendar, Outlook Calendar, Apple Calendar
 */

import type { UnifiedEvent } from './types';

export class EventNormalizer {
  /**
   * Normalize event from any provider to UnifiedEvent
   * Plugin-agnostic: Detects format by data structure
   */
  static normalize(event: any, sourcePlugin: string): UnifiedEvent {
    // Detect format by structure, not plugin name

    // Google Calendar format: has 'summary' and start/end with nested objects
    if (event.summary && event.start && typeof event.start === 'object') {
      return this.normalizeGoogleCalendar(event, sourcePlugin);
    }

    // Outlook Calendar format: has 'subject' and 'isAllDay' field
    if (event.subject && event.isAllDay !== undefined) {
      return this.normalizeOutlookCalendar(event, sourcePlugin);
    }

    // Generic fallback
    return this.normalizeGeneric(event, sourcePlugin);
  }

  /**
   * Normalize Google Calendar event
   */
  private static normalizeGoogleCalendar(event: any, sourcePlugin: string): UnifiedEvent {
    // Google Calendar has start/end as objects with dateTime or date
    const startTime = event.start?.dateTime || event.start?.date;
    const endTime = event.end?.dateTime || event.end?.date;
    const isAllDay = !event.start?.dateTime; // If no dateTime, it's an all-day event

    // Parse attendees
    const attendees = (event.attendees || []).map((a: any) => ({
      email: a.email,
      name: a.displayName,
      status: this.mapGoogleAttendeeStatus(a.responseStatus),
    }));

    return {
      id: event.id,
      title: event.summary || '(No Title)',
      description: event.description,
      startTime,
      endTime,
      timezone: event.start?.timeZone,
      isAllDay,
      organizer: {
        email: event.organizer?.email || '',
        name: event.organizer?.displayName,
      },
      attendees: attendees.length > 0 ? attendees : undefined,
      location: event.location,
      meetingUrl: event.hangoutLink || event.conferenceData?.entryPoints?.[0]?.uri,
      recurrence: event.recurrence?.[0], // Google uses RRULE format
      _source: {
        plugin: sourcePlugin,
        originalId: event.id,
        normalizedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Map Google attendee status to unified format
   */
  private static mapGoogleAttendeeStatus(status: string): 'accepted' | 'declined' | 'tentative' | 'needs_action' {
    switch (status) {
      case 'accepted':
        return 'accepted';
      case 'declined':
        return 'declined';
      case 'tentative':
        return 'tentative';
      default:
        return 'needs_action';
    }
  }

  /**
   * Normalize Outlook Calendar event
   */
  private static normalizeOutlookCalendar(event: any, sourcePlugin: string): UnifiedEvent {
    const attendees = (event.attendees || []).map((a: any) => ({
      email: a.emailAddress?.address || '',
      name: a.emailAddress?.name,
      status: this.mapOutlookAttendeeStatus(a.status?.response),
    }));

    return {
      id: event.id,
      title: event.subject || '(No Title)',
      description: event.body?.content || event.bodyPreview,
      startTime: event.start?.dateTime || event.start,
      endTime: event.end?.dateTime || event.end,
      timezone: event.start?.timeZone,
      isAllDay: event.isAllDay || false,
      organizer: {
        email: event.organizer?.emailAddress?.address || '',
        name: event.organizer?.emailAddress?.name,
      },
      attendees: attendees.length > 0 ? attendees : undefined,
      location: event.location?.displayName || event.location,
      meetingUrl: event.onlineMeeting?.joinUrl,
      recurrence: event.recurrence?.pattern ? this.outlookRecurrenceToRRule(event.recurrence) : undefined,
      _source: {
        plugin: sourcePlugin,
        originalId: event.id,
        normalizedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Map Outlook attendee status to unified format
   */
  private static mapOutlookAttendeeStatus(status: string): 'accepted' | 'declined' | 'tentative' | 'needs_action' {
    switch (status) {
      case 'accepted':
        return 'accepted';
      case 'declined':
        return 'declined';
      case 'tentativelyAccepted':
        return 'tentative';
      default:
        return 'needs_action';
    }
  }

  /**
   * Convert Outlook recurrence to RRULE format (simplified)
   */
  private static outlookRecurrenceToRRule(recurrence: any): string {
    const pattern = recurrence.pattern;
    if (!pattern) return '';

    let rrule = 'RRULE:';

    // Frequency
    switch (pattern.type) {
      case 'daily':
        rrule += 'FREQ=DAILY';
        break;
      case 'weekly':
        rrule += 'FREQ=WEEKLY';
        break;
      case 'monthly':
        rrule += 'FREQ=MONTHLY';
        break;
      case 'yearly':
        rrule += 'FREQ=YEARLY';
        break;
      default:
        return '';
    }

    // Interval
    if (pattern.interval > 1) {
      rrule += `;INTERVAL=${pattern.interval}`;
    }

    // End date
    if (recurrence.range?.endDate) {
      rrule += `;UNTIL=${recurrence.range.endDate.replace(/-/g, '')}`;
    }

    return rrule;
  }

  /**
   * Generic normalization (fallback)
   */
  private static normalizeGeneric(event: any, sourcePlugin: string): UnifiedEvent {
    const startTime = event.startTime || event.start_time || event.start || new Date().toISOString();
    const endTime = event.endTime || event.end_time || event.end || startTime;

    return {
      id: event.id || '',
      title: event.title || event.summary || event.name || '(No Title)',
      description: event.description || event.body,
      startTime,
      endTime,
      isAllDay: event.isAllDay || event.is_all_day || false,
      organizer: {
        email: event.organizer?.email || event.organizer_email || '',
        name: event.organizer?.name || event.organizer_name,
      },
      location: event.location,
      meetingUrl: event.meetingUrl || event.meeting_url || event.joinUrl,
      _source: {
        plugin: sourcePlugin,
        originalId: event.id || '',
        normalizedAt: new Date().toISOString(),
      },
    };
  }
}
