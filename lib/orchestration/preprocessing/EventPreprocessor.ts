/**
 * EventPreprocessor - Preprocess calendar event data
 *
 * Phase 2: Preprocessing System
 * Normalizes event structures, extracts timing metadata, identifies patterns
 */

import type { PreprocessingResult, PreprocessorConfig, ExtractedMetadata, PreprocessingOperation } from './types';

export class EventPreprocessor {
  /**
   * Preprocess event data
   */
  static async preprocess(
    data: any,
    config: Required<PreprocessorConfig>
  ): Promise<PreprocessingResult> {
    const operations: PreprocessingOperation[] = [];
    const warnings: string[] = [];

    // Ensure array
    const events = Array.isArray(data) ? data : [data];

    // Apply max items limit
    const limitedEvents = events.slice(0, config.maxItems);
    if (events.length > config.maxItems) {
      warnings.push(`Truncated from ${events.length} to ${config.maxItems} events`);
    }

    // Normalize structures if requested
    let cleanedEvents = limitedEvents;
    if (config.normalizeData) {
      cleanedEvents = this.normalizeStructures(limitedEvents);
      operations.push({
        type: 'normalize',
        target: 'structure',
        description: 'Normalized event field structures',
        itemsAffected: cleanedEvents.length,
      });
    }

    // Validate events
    if (config.removeNoise) {
      const beforeCount = cleanedEvents.length;
      cleanedEvents = this.validateEvents(cleanedEvents, warnings);
      const invalidCount = beforeCount - cleanedEvents.length;
      if (invalidCount > 0) {
        operations.push({
          type: 'filter',
          target: 'dates',
          description: 'Removed events with invalid dates',
          itemsAffected: invalidCount,
        });
      }
    }

    // Deduplicate if requested
    if (config.deduplicate) {
      const beforeCount = cleanedEvents.length;
      cleanedEvents = this.deduplicate(cleanedEvents);
      operations.push({
        type: 'deduplicate',
        target: 'events',
        description: 'Removed duplicate events',
        itemsAffected: beforeCount - cleanedEvents.length,
      });
    }

    // Extract metadata
    const metadata: ExtractedMetadata = {};
    if (config.extractMetadata) {
      metadata.dateRange = this.extractDateRange(cleanedEvents);
      metadata.counts = this.extractCounts(cleanedEvents);
      metadata.event = this.extractEventMetadata(cleanedEvents);

      operations.push({
        type: 'extract',
        target: 'metadata',
        description: 'Extracted event metadata',
        itemsAffected: cleanedEvents.length,
      });
    }

    return {
      cleanedInput: cleanedEvents,
      metadata,
      operations,
      dataType: 'event',
      success: true,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  /**
   * Normalize event structures to consistent format
   */
  private static normalizeStructures(events: any[]): any[] {
    return events.map(event => {
      // Extract start time
      const startTime = event.startTime || event.start?.dateTime || event.start?.date || event.start;

      // Extract end time
      const endTime = event.endTime || event.end?.dateTime || event.end?.date || event.end;

      // Determine if all-day event
      const isAllDay = event.isAllDay ?? event.is_all_day ??
                      (!event.start?.dateTime && !!event.start?.date) ??
                      false;

      // Extract organizer
      const organizer = {
        email: event.organizer?.email || event.organizer?.emailAddress?.address || '',
        name: event.organizer?.name || event.organizer?.displayName || event.organizer?.emailAddress?.name,
      };

      return {
        id: event.id || event.eventId,
        title: event.title || event.summary || event.subject || '(No Title)',
        description: event.description || event.body?.content || event.bodyPreview,
        startTime,
        endTime,
        timezone: event.timezone || event.start?.timeZone || event.end?.timeZone,
        isAllDay,
        organizer,
        attendees: event.attendees || [],
        location: event.location?.displayName || event.location || event.where?.[0]?.displayName,
        meetingUrl: event.meetingUrl || event.hangoutLink || event.onlineMeeting?.joinUrl ||
                   event.conferenceData?.entryPoints?.[0]?.uri,
        recurrence: event.recurrence || event.recurrence?.[0],
        status: event.status || 'confirmed',
      };
    });
  }

  /**
   * Validate events (require valid dates)
   */
  private static validateEvents(events: any[], warnings: string[]): any[] {
    return events.filter(event => {
      // Check for start time
      if (!event.startTime) {
        warnings.push(`Event ${event.title || event.id || 'unknown'} has no start time`);
        return false;
      }

      // Validate start time
      const startDate = new Date(event.startTime);
      if (isNaN(startDate.getTime())) {
        warnings.push(`Event ${event.title || event.id} has invalid start time: ${event.startTime}`);
        return false;
      }

      // Validate end time if present
      if (event.endTime) {
        const endDate = new Date(event.endTime);
        if (isNaN(endDate.getTime())) {
          warnings.push(`Event ${event.title || event.id} has invalid end time: ${event.endTime}`);
          return false;
        }

        // Check that end is after start
        if (endDate < startDate) {
          warnings.push(`Event ${event.title || event.id} has end time before start time`);
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Deduplicate events by ID or title+start
   */
  private static deduplicate(events: any[]): any[] {
    const seen = new Set<string>();
    return events.filter(event => {
      const key = event.id || `${event.title}:${event.startTime}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  /**
   * Extract date range from events
   */
  private static extractDateRange(events: any[]): ExtractedMetadata['dateRange'] {
    const dates = events
      .map(e => e.startTime)
      .filter(d => d)
      .map(d => new Date(d))
      .filter(d => !isNaN(d.getTime()));

    if (dates.length === 0) {
      return undefined;
    }

    const earliest = new Date(Math.min(...dates.map(d => d.getTime())));
    const latest = new Date(Math.max(...dates.map(d => d.getTime())));

    return {
      earliest: earliest.toISOString(),
      latest: latest.toISOString(),
      formattedRange: this.formatDateRange(earliest, latest),
      count: dates.length,
    };
  }

  /**
   * Format date range as human-readable string
   */
  private static formatDateRange(earliest: Date, latest: Date): string {
    const options: Intl.DateTimeFormatOptions = {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    };

    const earliestStr = earliest.toLocaleDateString('en-US', options);
    const latestStr = latest.toLocaleDateString('en-US', options);

    if (earliestStr === latestStr) {
      return earliestStr;
    }

    if (earliest.getFullYear() === latest.getFullYear()) {
      const earliestShort = earliest.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
      return `${earliestShort} - ${latestStr}`;
    }

    return `${earliestStr} - ${latestStr}`;
  }

  /**
   * Extract count metadata
   */
  private static extractCounts(events: any[]): ExtractedMetadata['counts'] {
    return {
      total: events.length,
    };
  }

  /**
   * Extract event-specific metadata
   */
  private static extractEventMetadata(events: any[]): ExtractedMetadata['event'] {
    const now = new Date();
    const upcomingEvents = events.filter(e => new Date(e.startTime) > now).length;
    const pastEvents = events.length - upcomingEvents;
    const allDayEvents = events.filter(e => e.isAllDay).length;
    const withAttendees = events.filter(e => e.attendees?.length > 0).length;
    const recurringEvents = events.filter(e => e.recurrence).length;

    // Calculate average duration
    const durations = events
      .filter(e => e.startTime && e.endTime && !e.isAllDay)
      .map(e => {
        const start = new Date(e.startTime).getTime();
        const end = new Date(e.endTime).getTime();
        return (end - start) / (1000 * 60); // minutes
      })
      .filter(d => d > 0 && d < 1440); // Filter out invalid durations (0 or > 24h)

    const avgDuration = durations.length > 0
      ? Math.round(durations.reduce((sum, d) => sum + d, 0) / durations.length)
      : 0;

    // Count by organizer
    const byOrganizer: Record<string, number> = {};
    for (const event of events) {
      if (event.organizer?.email) {
        const key = event.organizer.name || event.organizer.email;
        byOrganizer[key] = (byOrganizer[key] || 0) + 1;
      }
    }

    return {
      totalEvents: events.length,
      upcomingEvents,
      pastEvents,
      allDayEvents,
      withAttendees,
      avgDuration,
      byOrganizer,
      recurringEvents,
    };
  }
}
