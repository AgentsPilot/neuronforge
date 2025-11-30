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
      this.logger.error({ err: error }, 'DEBUG: Calendar list failed:', errorData);
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
        response_status: a.responseStatus
      })) || [],
      organizer: event.organizer?.email,
      html_link: event.htmlLink,
      conference_data: event.conferenceData
    }));

    return {
      calendar_id: calendar_id,
      event_count: formattedEvents.length,
      events: formattedEvents,
      time_range: {
        start: time_min,
        end: time_max || 'unbounded'
      },
      retrieved_at: new Date().toISOString()
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
      this.logger.error({ err: error }, 'DEBUG: Event creation failed:', errorData);
      throw new Error(`Calendar API error: ${response.status} - ${errorData}`);
    }

    const data = await response.json();

    return {
      event_id: data.id,
      summary: data.summary,
      start_time: data.start?.dateTime || data.start?.date,
      end_time: data.end?.dateTime || data.end?.date,
      html_link: data.htmlLink,
      hangout_link: data.hangoutLink,
      meet_link: data.conferenceData?.entryPoints?.find((ep: any) => ep.entryPointType === 'video')?.uri,
      attendee_count: data.attendees?.length || 0,
      created_at: new Date().toISOString()
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
      this.logger.error({ err: error }, 'DEBUG: Get event failed:', errorData);
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
      this.logger.error({ err: error }, 'DEBUG: Event update failed:', errorData);
      throw new Error(`Calendar API error: ${response.status} - ${errorData}`);
    }

    const data = await response.json();

    return {
      event_id: data.id,
      summary: data.summary,
      start_time: data.start?.dateTime || data.start?.date,
      end_time: data.end?.dateTime || data.end?.date,
      html_link: data.htmlLink,
      updated_at: new Date().toISOString()
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
      this.logger.error({ err: error }, 'DEBUG: Event deletion failed:', errorData);
      throw new Error(`Calendar API error: ${response.status} - ${errorData}`);
    }

    return {
      event_id: event_id,
      deleted: true,
      deleted_at: new Date().toISOString()
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
      this.logger.error({ err: error }, 'DEBUG: Get event details failed:', errorData);
      throw new Error(`Calendar API error: ${response.status} - ${errorData}`);
    }

    const data = await response.json();

    return {
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
        optional: a.optional || false
      })) || [],
      organizer: {
        email: data.organizer?.email,
        display_name: data.organizer?.displayName
      },
      reminders: data.reminders,
      html_link: data.htmlLink,
      hangout_link: data.hangoutLink,
      meet_link: data.conferenceData?.entryPoints?.find((ep: any) => ep.entryPointType === 'video')?.uri,
      status: data.status,
      created: data.created,
      updated: data.updated,
      retrieved_at: new Date().toISOString()
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
}
