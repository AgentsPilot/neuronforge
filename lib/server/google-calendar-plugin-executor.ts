// lib/server/google-calendar-plugin-executor.ts

import { UserPluginConnections } from './user-plugin-connections';
import { PluginManagerV2 } from './plugin-manager-v2';
import { ExecutionResult } from '@/lib/types/plugin-types';
import { GoogleBasePluginExecutor } from './google-base-plugin-executor';

const pluginName = 'google-calendar';

export class GoogleCalendarPluginExecutor extends GoogleBasePluginExecutor {
  constructor(userConnections: UserPluginConnections, pluginManager: PluginManagerV2) {
    super(pluginName, userConnections, pluginManager);    
  }

  // Execute Google Calendar action with validation and error handling
  protected async executeSpecificAction(
    connection: any,
    actionName: string,
    parameters: any
  ): Promise<any> {
    // Execute the specific action
    let result: any;
    switch (actionName) {
      case 'list_events':
        result = await this.listEvents(connection, parameters);
        break;
      case 'create_event':
        result = await this.createEvent(connection, parameters);
        break;
      case 'update_event':
        result = await this.updateEvent(connection, parameters);
        break;
      case 'delete_event':
        result = await this.deleteEvent(connection, parameters);
        break;
      case 'get_event_details':
        result = await this.getEventDetails(connection, parameters);
        break;
      case 'get_free_busy':
        result = await this.getFreeBusy(connection, parameters);
        break;
      case 'list_calendars':
        // NOTE: dispatches to the private listAllCalendars ACTION method — NOT the
        // public `list_calendars(connection, options)` dropdown fetcher (~line 514),
        // which stays the x-dynamic-options source for calendar_id/calendar_ids params.
        result = await this.listAllCalendars(connection, parameters);
        break;
      default:
        return {
          success: false,
          error: 'Unknown action',
          message: `Action ${actionName} not supported`
        };
    }

    return result;
  }

  // List calendar events within a time range
  private async listEvents(connection: any, parameters: any): Promise<any> {
    this.logger.debug('DEBUG: Listing events from Google Calendar');

    const {
      calendar_id = 'primary',
      time_min,
      time_max,
      max_results = 50,
      single_events = true,
      order_by = 'startTime'
    } = parameters;

    // Build request URL
    const url = new URL(`${this.googleApisUrl}/calendar/v3/calendars/${encodeURIComponent(calendar_id)}/events`);

    url.searchParams.set('timeMin', time_min);
    if (time_max) {
      url.searchParams.set('timeMax', time_max);
    }
    url.searchParams.set('maxResults', max_results.toString());
    url.searchParams.set('singleEvents', single_events.toString());
    if (single_events && order_by === 'startTime') {
      url.searchParams.set('orderBy', order_by);
    }

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.text();
      this.logger.error({ err: errorData, status: response.status }, 'Calendar list failed');
      throw new Error(`Calendar API error: ${response.status} - ${errorData}`);
    }

    const data = await response.json();
    const events = data.items || [];

    // Format events for easier consumption
    const formattedEvents = events.map((event: any) => ({
      id: event.id,
      summary: event.summary,
      description: event.description,
      location: event.location,
      start: event.start?.dateTime || event.start?.date,
      end: event.end?.dateTime || event.end?.date,
      attendees: event.attendees?.map((a: any) => ({
        email: a.email,
        // Primary format (snake_case)
        response_status: a.responseStatus,
        // Legacy format (camelCase)
        responseStatus: a.responseStatus
      })) || [],
      organizer: event.organizer?.email,
      // Primary format (snake_case)
      html_link: event.htmlLink,
      conference_data: event.conferenceData,
      // Legacy format (camelCase)
      htmlLink: event.htmlLink,
      conferenceData: event.conferenceData
    }));

    return {
      // Primary format (snake_case to match schema)
      calendar_id: calendar_id,
      event_count: formattedEvents.length,
      events: formattedEvents,
      time_range: {
        start: time_min,
        end: time_max || 'unbounded'
      },
      retrieved_at: new Date().toISOString(),
      // Legacy format (camelCase for backward compatibility)
      calendarId: calendar_id,
      eventCount: formattedEvents.length,
      timeRange: {
        start: time_min,
        end: time_max || 'unbounded'
      },
      retrievedAt: new Date().toISOString()
    };
  }

  // Create a new calendar event
  private async createEvent(connection: any, parameters: any): Promise<any> {
    this.logger.debug('DEBUG: Creating event in Google Calendar');

    const {
      calendar_id = 'primary',
      summary,
      description,
      location,
      start_time,
      end_time,
      attendees = [],
      reminders,
      send_notifications = true,
      conference_solution = 'none'
    } = parameters;

    // Build event object
    const eventBody: any = {
      summary,
      description,
      location,
      start: {
        dateTime: start_time,
        timeZone: 'UTC'
      },
      end: {
        dateTime: end_time,
        timeZone: 'UTC'
      }
    };

    // Add attendees
    if (attendees && attendees.length > 0) {
      eventBody.attendees = attendees.map((email: string) => ({ email }));
    }

    // Add reminders
    if (reminders) {
      eventBody.reminders = {
        useDefault: reminders.use_default !== false,
        overrides: reminders.overrides || []
      };
    }

    // Add Google Meet conference if requested
    if (conference_solution === 'hangoutsMeet') {
      eventBody.conferenceData = {
        createRequest: {
          requestId: `meet-${Date.now()}`,
          conferenceSolutionKey: {
            type: 'hangoutsMeet'
          }
        }
      };
    }

    // Build request URL
    const url = new URL(`${this.googleApisUrl}/calendar/v3/calendars/${encodeURIComponent(calendar_id)}/events`);

    // Add query parameters
    if (send_notifications && attendees && attendees.length > 0) {
      url.searchParams.set('sendUpdates', 'all');
    }
    if (conference_solution === 'hangoutsMeet') {
      url.searchParams.set('conferenceDataVersion', '1');
    }

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(eventBody)
    });

    if (!response.ok) {
      const errorData = await response.text();
      this.logger.error({ err: errorData, status: response.status }, 'Event creation failed');
      throw new Error(`Calendar API error: ${response.status} - ${errorData}`);
    }

    const data = await response.json();

    return {
      // Primary format (snake_case to match schema)
      event_id: data.id,
      summary: data.summary,
      start_time: data.start?.dateTime || data.start?.date,
      end_time: data.end?.dateTime || data.end?.date,
      html_link: data.htmlLink,
      hangout_link: data.hangoutLink,
      meet_link: data.conferenceData?.entryPoints?.find((ep: any) => ep.entryPointType === 'video')?.uri,
      attendee_count: data.attendees?.length || 0,
      created_at: new Date().toISOString(),
      // Legacy format (camelCase for backward compatibility)
      eventId: data.id,
      startTime: data.start?.dateTime || data.start?.date,
      endTime: data.end?.dateTime || data.end?.date,
      htmlLink: data.htmlLink,
      hangoutLink: data.hangoutLink,
      meetLink: data.conferenceData?.entryPoints?.find((ep: any) => ep.entryPointType === 'video')?.uri,
      attendeeCount: data.attendees?.length || 0,
      createdAt: new Date().toISOString()
    };
  }

  // Update an existing calendar event
  private async updateEvent(connection: any, parameters: any): Promise<any> {
    this.logger.debug('DEBUG: Updating event in Google Calendar');

    const {
      calendar_id = 'primary',
      event_id,
      summary,
      description,
      location,
      start_time,
      end_time,
      attendees,
      send_notifications = false
    } = parameters;

    // First, get the existing event
    const getUrl = `${this.googleApisUrl}/calendar/v3/calendars/${encodeURIComponent(calendar_id)}/events/${event_id}`;

    const getResponse = await fetch(getUrl, {
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Accept': 'application/json',
      },
    });

    if (!getResponse.ok) {
      const errorData = await getResponse.text();
      this.logger.error({ err: errorData, status: getResponse.status }, 'Get event failed');
      throw new Error(`Calendar API error: ${getResponse.status} - ${errorData}`);
    }

    const existingEvent = await getResponse.json();

    // Build updated event object (merge with existing)
    const eventBody: any = { ...existingEvent };

    if (summary !== undefined) eventBody.summary = summary;
    if (description !== undefined) eventBody.description = description;
    if (location !== undefined) eventBody.location = location;

    if (start_time !== undefined) {
      eventBody.start = {
        dateTime: start_time,
        timeZone: 'UTC'
      };
    }

    if (end_time !== undefined) {
      eventBody.end = {
        dateTime: end_time,
        timeZone: 'UTC'
      };
    }

    if (attendees !== undefined) {
      eventBody.attendees = attendees.map((email: string) => ({ email }));
    }

    // Build request URL
    const url = new URL(`${this.googleApisUrl}/calendar/v3/calendars/${encodeURIComponent(calendar_id)}/events/${event_id}`);

    if (send_notifications && eventBody.attendees && eventBody.attendees.length > 0) {
      url.searchParams.set('sendUpdates', 'all');
    }

    const response = await fetch(url.toString(), {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(eventBody)
    });

    if (!response.ok) {
      const errorData = await response.text();
      this.logger.error({ err: errorData, status: response.status }, 'Event update failed');
      throw new Error(`Calendar API error: ${response.status} - ${errorData}`);
    }

    const data = await response.json();

    return {
      // Primary format (snake_case to match schema)
      event_id: data.id,
      summary: data.summary,
      start_time: data.start?.dateTime || data.start?.date,
      end_time: data.end?.dateTime || data.end?.date,
      html_link: data.htmlLink,
      updated_at: new Date().toISOString(),
      // Legacy format (camelCase for backward compatibility)
      eventId: data.id,
      startTime: data.start?.dateTime || data.start?.date,
      endTime: data.end?.dateTime || data.end?.date,
      htmlLink: data.htmlLink,
      updatedAt: new Date().toISOString()
    };
  }

  // Delete a calendar event
  private async deleteEvent(connection: any, parameters: any): Promise<any> {
    this.logger.debug('DEBUG: Deleting event from Google Calendar');

    const {
      calendar_id = 'primary',
      event_id,
      send_notifications = false
    } = parameters;

    // Build request URL
    const url = new URL(`${this.googleApisUrl}/calendar/v3/calendars/${encodeURIComponent(calendar_id)}/events/${event_id}`);

    if (send_notifications) {
      url.searchParams.set('sendUpdates', 'all');
    }

    const response = await fetch(url.toString(), {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.text();
      this.logger.error({ err: errorData, status: response.status }, 'Event deletion failed');
      throw new Error(`Calendar API error: ${response.status} - ${errorData}`);
    }

    return {
      // Primary format (snake_case to match schema)
      event_id: event_id,
      deleted: true,
      deleted_at: new Date().toISOString(),
      // Legacy format (camelCase for backward compatibility)
      eventId: event_id,
      deletedAt: new Date().toISOString()
    };
  }

  // Get details about a specific event
  private async getEventDetails(connection: any, parameters: any): Promise<any> {
    this.logger.debug('DEBUG: Getting event details from Google Calendar');

    const {
      calendar_id = 'primary',
      event_id
    } = parameters;

    // Build request URL
    const url = `${this.googleApisUrl}/calendar/v3/calendars/${encodeURIComponent(calendar_id)}/events/${event_id}`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.text();
      this.logger.error({ err: errorData, status: response.status }, 'Get event details failed');
      throw new Error(`Calendar API error: ${response.status} - ${errorData}`);
    }

    const data = await response.json();

    return {
      // Primary format (snake_case to match schema)
      event_id: data.id,
      summary: data.summary,
      description: data.description,
      location: data.location,
      start: data.start?.dateTime || data.start?.date,
      end: data.end?.dateTime || data.end?.date,
      attendees: data.attendees?.map((a: any) => ({
        email: a.email,
        display_name: a.displayName,
        organizer: a.organizer || false,
        response_status: a.responseStatus,
        optional: a.optional || false,
        // Legacy format (camelCase)
        displayName: a.displayName,
        responseStatus: a.responseStatus
      })) || [],
      organizer: {
        email: data.organizer?.email,
        display_name: data.organizer?.displayName,
        // Legacy format (camelCase)
        displayName: data.organizer?.displayName
      },
      reminders: data.reminders,
      html_link: data.htmlLink,
      hangout_link: data.hangoutLink,
      meet_link: data.conferenceData?.entryPoints?.find((ep: any) => ep.entryPointType === 'video')?.uri,
      status: data.status,
      created: data.created,
      updated: data.updated,
      retrieved_at: new Date().toISOString(),
      // Legacy format (camelCase for backward compatibility)
      eventId: data.id,
      htmlLink: data.htmlLink,
      hangoutLink: data.hangoutLink,
      meetLink: data.conferenceData?.entryPoints?.find((ep: any) => ep.entryPointType === 'video')?.uri,
      retrievedAt: new Date().toISOString()
    };
  }

  // Query busy/free intervals over a time window via Calendar freebusy.query.
  // Read-only availability primitive. Returns ONLY busy start/end per calendar —
  // never event summaries/attendees/details (privacy invariant; freebusy itself
  // never returns detail, and this method must not enrich it with a secondary call).
  private async getFreeBusy(connection: any, parameters: any): Promise<any> {
    this.logger.debug('DEBUG: Querying free/busy from Google Calendar');

    const {
      calendar_ids = ['primary'],
      time_min,
      time_max,
      time_zone = 'UTC'
    } = parameters;

    // --- Pre-fetch guards (fail fast before any network call) ---

    // Both bounds must be present RFC3339 timestamps.
    const minMs = Date.parse(time_min);
    const maxMs = Date.parse(time_max);
    if (!time_min || !time_max || Number.isNaN(minMs) || Number.isNaN(maxMs)) {
      throw new Error('invalid_time_format: time_min and time_max must be present RFC3339 timestamps (e.g. "2026-03-27T00:00:00Z").');
    }

    // Reject inverted/degenerate windows (time_min must be strictly before time_max).
    if (minMs >= maxMs) {
      throw new Error('invalid_time_range: time_min must be strictly before time_max.');
    }

    // Google enforces a 50-calendar cap (calendarExpansionMax) server-side; fail fast.
    const calendarIds: string[] = Array.isArray(calendar_ids) ? calendar_ids : [calendar_ids];
    if (calendarIds.length > 50) {
      throw new Error(`invalid_input: get_free_busy supports at most 50 calendars per query (received ${calendarIds.length}).`);
    }

    const response = await fetch(`${this.googleApisUrl}/calendar/v3/freeBusy`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        timeMin: time_min,
        timeMax: time_max,
        timeZone: time_zone,
        items: calendarIds.map((id: string) => ({ id })),
      }),
    });

    // Only a top-level HTTP failure throws. Per-calendar errors inside a 200 are a
    // PARTIAL SUCCESS and are surfaced below, not thrown (CR-1).
    if (!response.ok) {
      const errorData = await response.text();
      this.logger.error({ err: errorData, status: response.status }, 'Free/busy query failed');
      throw new Error(`Calendar API error: ${response.status} - ${errorData}`);
    }

    const data = await response.json();
    const calendarsMap = (data && data.calendars) || {};

    // Map the freebusy response `calendars{}` map into an array. Copy ONLY start/end
    // from each busy block (privacy invariant) and surface any per-calendar `errors`
    // Google returns (e.g. { reason: 'notFound' }) without throwing.
    const calendars = Object.keys(calendarsMap).map((calendarId: string) => {
      const entry = calendarsMap[calendarId] || {};
      const busy = Array.isArray(entry.busy)
        ? entry.busy.map((b: any) => ({ start: b.start, end: b.end }))
        : [];

      const mapped: { calendar_id: string; busy: Array<{ start: string; end: string }>; errors?: any[] } = {
        calendar_id: calendarId,
        busy,
      };

      if (Array.isArray(entry.errors) && entry.errors.length > 0) {
        mapped.errors = entry.errors;
      }

      return mapped;
    });

    return {
      // Primary format (snake_case to match schema)
      calendars,
      time_min,
      time_max,
      time_zone,
      queried_at: new Date().toISOString(),
      // Legacy format (camelCase for backward compatibility)
      timeMin: time_min,
      timeMax: time_max,
      timeZone: time_zone,
      queriedAt: new Date().toISOString()
    };
  }

  // List the user's calendars via calendarList.list (read-only).
  // ⚠️ Distinct method name from the public `list_calendars(connection, options)`
  // dropdown fetcher (~line 514) — this is the ACTION path (switch-dispatched),
  // returning the schema-shaped payload rather than {value,label,...} options.
  private async listAllCalendars(connection: any, parameters: any): Promise<any> {
    this.logger.debug('DEBUG: Listing all calendars from Google Calendar');

    const { min_access_role } = parameters;

    const url = new URL(`${this.googleApisUrl}/calendar/v3/users/me/calendarList`);
    if (min_access_role) {
      url.searchParams.set('minAccessRole', min_access_role);
    }

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.text();
      this.logger.error({ err: errorData, status: response.status }, 'List calendars failed');
      throw new Error(`Calendar API error: ${response.status} - ${errorData}`);
    }

    const data = await response.json();
    const items = (data && Array.isArray(data.items)) ? data.items : [];

    const calendars = items.map((cal: any) => ({
      id: cal.id,
      summary: cal.summary,
      description: cal.description,
      time_zone: cal.timeZone,
      primary: cal.primary || false,
      access_role: cal.accessRole,
      // Legacy format (camelCase for backward compatibility)
      timeZone: cal.timeZone,
      accessRole: cal.accessRole
    }));

    return {
      // Primary format (snake_case to match schema)
      calendars,
      total_found: calendars.length,
      listed_at: new Date().toISOString(),
      // Legacy format (camelCase for backward compatibility)
      totalFound: calendars.length,
      listedAt: new Date().toISOString()
    };
  }

  // Override to handle Calendar-specific errors
  protected mapGoogleServiceSpecificError(error: any, commonErrors: Record<string, string>): string | null {
    // Calendar-specific: event or calendar not found
    if (error.message?.includes('404')) {
      return commonErrors.event_not_found || commonErrors.calendar_not_found || error.message;
    }

    // Calendar-specific: invalid time format
    if (error.message?.includes('invalid') && error.message?.includes('time')) {
      return commonErrors.invalid_time_format || error.message;
    }

    // Calendar-specific: invalid attendee format
    if (error.message?.includes('attendee')) {
      return commonErrors.invalid_attendees || error.message;
    }

    // Return null to fall back to common Google error handling
    return null;
  }

  // Test connection with a simple API call
  protected async performConnectionTest(connection: any): Promise<any> {
    // Test with a simple API call (get primary calendar)
    const response = await fetch(`${this.googleApisUrl}/calendar/v3/calendars/primary`, {
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      return {
        success: false,
        error: 'connection_test_failed',
        message: `Google Calendar connection test failed: ${response.status}`
      };
    }

    const calendarData = await response.json();

    return {
      success: true,
      data: {
        calendar_id: calendarData.id,
        calendar_summary: calendarData.summary,
        can_read: true,
        can_write: true
      },
      message: 'Google Calendar connection active'
    };
  }

  /**
   * List all Google Calendars for dynamic dropdown options
   * This method is called by the fetch-options API route
   */
  async list_calendars(connection: any, options: { page?: number; limit?: number } = {}): Promise<Array<{value: string; label: string; description?: string; icon?: string; group?: string}>> {
    try {
      const response = await fetch(`${this.googleApisUrl}/calendar/v3/users/me/calendarList`, {
        headers: {
          'Authorization': `Bearer ${connection.access_token}`,
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Google Calendar API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      if (!data.items || !Array.isArray(data.items)) {
        return [];
      }

      // Transform to option format
      return data.items.map((calendar: any) => ({
        value: calendar.id,
        label: calendar.summary,
        description: calendar.description || (calendar.primary ? 'Primary calendar' : undefined),
        icon: calendar.primary ? '⭐' : '📅',
        group: calendar.primary ? 'Primary' : (calendar.accessRole === 'owner' ? 'My Calendars' : 'Shared Calendars'),
      }));

    } catch (error: any) {
      this.logger.error({ err: error }, 'Error listing Google Calendars for options');
      throw error;
    }
  }
}
