// lib/server/outlook-plugin-executor.ts
// Outlook plugin executor using Microsoft Graph API

import { BasePluginExecutor } from './base-plugin-executor';
import { UserPluginConnections } from './user-plugin-connections';
import { PluginManagerV2 } from './plugin-manager-v2';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'OutlookPluginExecutor', service: 'plugin-system' });
const pluginName = 'outlook';

export class OutlookPluginExecutor extends BasePluginExecutor {
  private graphBaseUrl = 'https://graph.microsoft.com/v1.0';

  constructor(userConnections: UserPluginConnections, pluginManager: PluginManagerV2) {
    super(pluginName, userConnections, pluginManager);
  }

  protected async executeSpecificAction(
    connection: any,
    actionName: string,
    parameters: any
  ): Promise<any> {
    logger.debug({ actionName, params: parameters }, 'Executing Outlook action');

    switch (actionName) {
      case 'send_email':
        return await this.sendEmail(connection, parameters);
      case 'search_emails':
        return await this.searchEmails(connection, parameters);
      case 'create_draft':
        return await this.createDraft(connection, parameters);
      case 'modify_message':
        return await this.modifyMessage(connection, parameters);
      case 'get_email_attachment':
        return await this.getEmailAttachment(connection, parameters);
      case 'list_events':
        return await this.listEvents(connection, parameters);
      case 'create_event':
        return await this.createEvent(connection, parameters);
      case 'update_event':
        return await this.updateEvent(connection, parameters);
      case 'delete_event':
        return await this.deleteEvent(connection, parameters);
      case 'get_event_details':
        return await this.getEventDetails(connection, parameters);
      default:
        throw new Error(`Unsupported Outlook action: ${actionName}`);
    }
  }

  // === EMAIL ACTIONS ===

  private async sendEmail(connection: any, params: any): Promise<any> {
    const { to, subject, body, cc, bcc, importance = 'normal' } = params;

    const message = {
      subject,
      body: {
        contentType: 'HTML',
        content: body || ''
      },
      toRecipients: to.map((email: string) => ({
        emailAddress: { address: email }
      })),
      ...(cc && { ccRecipients: cc.map((email: string) => ({ emailAddress: { address: email } })) }),
      ...(bcc && { bccRecipients: bcc.map((email: string) => ({ emailAddress: { address: email } })) }),
      importance
    };

    const response = await this.makeGraphRequest(
      connection,
      '/me/sendMail',
      'POST',
      { message, saveToSentItems: true }
    );

    return {
      message_id: 'sent', // Graph API sendMail doesn't return message ID
      sent_at: new Date().toISOString(),
      status: 'sent'
    };
  }

  private async searchEmails(connection: any, params: any): Promise<any> {
    const { query, folder = 'inbox', max_results = 20, from_date, to_date, has_attachments } = params;

    // Build OData filter
    let filter: string[] = [];

    if (from_date) {
      filter.push(`receivedDateTime ge ${new Date(from_date).toISOString()}`);
    }
    if (to_date) {
      filter.push(`receivedDateTime le ${new Date(to_date).toISOString()}`);
    }
    if (has_attachments !== undefined) {
      filter.push(`hasAttachments eq ${has_attachments}`);
    }

    // Build folder path
    const folderMap: Record<string, string> = {
      inbox: 'inbox',
      sentitems: 'sentitems',
      drafts: 'drafts',
      deleteditems: 'deleteditems'
    };
    const folderName = folderMap[folder] || 'inbox';

    // Build request URL
    let url = `/me/mailFolders/${folderName}/messages?$top=${max_results}&$select=id,subject,from,toRecipients,receivedDateTime,bodyPreview,hasAttachments`;

    if (filter.length > 0) {
      url += `&$filter=${filter.join(' and ')}`;
    }

    if (query) {
      url += `&$search="${query}"`;
    }

    const response = await this.makeGraphRequest(connection, url, 'GET');

    const emails = response.value.map((msg: any) => ({
      id: msg.id,
      subject: msg.subject,
      from: msg.from?.emailAddress?.address,
      to: msg.toRecipients?.map((r: any) => r.emailAddress.address) || [],
      received_at: msg.receivedDateTime,
      body_preview: msg.bodyPreview,
      has_attachments: msg.hasAttachments
    }));

    return {
      emails,
      email_count: emails.length,
      searched_at: new Date().toISOString()
    };
  }

  private async createDraft(connection: any, params: any): Promise<any> {
    const { to, subject, body, cc, bcc } = params;

    const message = {
      subject,
      body: {
        contentType: 'HTML',
        content: body || ''
      },
      ...(to && { toRecipients: to.map((email: string) => ({ emailAddress: { address: email } })) }),
      ...(cc && { ccRecipients: cc.map((email: string) => ({ emailAddress: { address: email } })) }),
      ...(bcc && { bccRecipients: bcc.map((email: string) => ({ emailAddress: { address: email } })) })
    };

    const response = await this.makeGraphRequest(
      connection,
      '/me/messages',
      'POST',
      message
    );

    return {
      message_id: response.id,
      created_at: response.createdDateTime,
      web_link: response.webLink
    };
  }

  private async modifyMessage(connection: any, params: any): Promise<any> {
    const { message_id, is_read, folder, importance } = params;

    const updates: any = {};

    if (is_read !== undefined) {
      updates.isRead = is_read;
    }
    if (importance) {
      updates.importance = importance;
    }

    const response = await this.makeGraphRequest(
      connection,
      `/me/messages/${message_id}`,
      'PATCH',
      updates
    );

    // Handle folder move if specified
    if (folder) {
      const folderMap: Record<string, string> = {
        inbox: 'inbox',
        sentitems: 'sentitems',
        drafts: 'drafts',
        deleteditems: 'deleteditems'
      };
      const targetFolder = folderMap[folder];

      await this.makeGraphRequest(
        connection,
        `/me/messages/${message_id}/move`,
        'POST',
        { destinationId: targetFolder }
      );
    }

    return {
      message_id: response.id,
      is_read: response.isRead,
      updated_at: new Date().toISOString()
    };
  }

  private async getEmailAttachment(connection: any, params: any): Promise<any> {
    const { message_id, attachment_id } = params;

    if (attachment_id) {
      // Get specific attachment
      const attachment = await this.makeGraphRequest(
        connection,
        `/me/messages/${message_id}/attachments/${attachment_id}`,
        'GET'
      );

      return {
        attachments: [{
          attachment_id: attachment.id,
          filename: attachment.name,
          content_type: attachment.contentType,
          size: attachment.size,
          content: attachment.contentBytes
        }],
        attachment_count: 1
      };
    } else {
      // Get all attachments
      const response = await this.makeGraphRequest(
        connection,
        `/me/messages/${message_id}/attachments`,
        'GET'
      );

      const attachments = response.value.map((att: any) => ({
        attachment_id: att.id,
        filename: att.name,
        content_type: att.contentType,
        size: att.size,
        content: att.contentBytes
      }));

      return {
        attachments,
        attachment_count: attachments.length
      };
    }
  }

  // === CALENDAR ACTIONS ===

  private async listEvents(connection: any, params: any): Promise<any> {
    const {
      start_date = new Date().toISOString(),
      end_date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      max_results = 50,
      calendar_id
    } = params;

    const calendarPath = calendar_id ? `/me/calendars/${calendar_id}` : '/me/calendar';

    const url = `${calendarPath}/calendarView?startDateTime=${start_date}&endDateTime=${end_date}&$top=${max_results}&$select=id,subject,start,end,location,attendees,organizer`;

    const response = await this.makeGraphRequest(connection, url, 'GET');

    const events = response.value.map((evt: any) => ({
      id: evt.id,
      subject: evt.subject,
      start: evt.start.dateTime,
      end: evt.end.dateTime,
      location: evt.location?.displayName,
      attendees: evt.attendees?.map((a: any) => a.emailAddress.address) || [],
      organizer: evt.organizer?.emailAddress?.address
    }));

    return {
      events,
      event_count: events.length,
      retrieved_at: new Date().toISOString()
    };
  }

  private async createEvent(connection: any, params: any): Promise<any> {
    const {
      subject,
      start,
      end,
      location,
      attendees,
      body,
      is_online_meeting = false,
      reminder_minutes = 15
    } = params;

    const event = {
      subject,
      start: {
        dateTime: start,
        timeZone: 'UTC'
      },
      end: {
        dateTime: end,
        timeZone: 'UTC'
      },
      ...(location && { location: { displayName: location } }),
      ...(body && { body: { contentType: 'HTML', content: body } }),
      ...(attendees && {
        attendees: attendees.map((email: string) => ({
          emailAddress: { address: email },
          type: 'required'
        }))
      }),
      isOnlineMeeting: is_online_meeting,
      reminderMinutesBeforeStart: reminder_minutes
    };

    const response = await this.makeGraphRequest(
      connection,
      '/me/events',
      'POST',
      event
    );

    return {
      id: response.id,
      subject: response.subject,
      start: response.start.dateTime,
      end: response.end.dateTime,
      web_link: response.webLink,
      ...(is_online_meeting && response.onlineMeeting && {
        online_meeting_url: response.onlineMeeting.joinUrl
      }),
      created_at: new Date().toISOString()
    };
  }

  private async updateEvent(connection: any, params: any): Promise<any> {
    const { event_id, subject, start, end, location, attendees, body } = params;

    const updates: any = {};

    if (subject) updates.subject = subject;
    if (start) updates.start = { dateTime: start, timeZone: 'UTC' };
    if (end) updates.end = { dateTime: end, timeZone: 'UTC' };
    if (location) updates.location = { displayName: location };
    if (body) updates.body = { contentType: 'HTML', content: body };
    if (attendees) {
      updates.attendees = attendees.map((email: string) => ({
        emailAddress: { address: email },
        type: 'required'
      }));
    }

    const response = await this.makeGraphRequest(
      connection,
      `/me/events/${event_id}`,
      'PATCH',
      updates
    );

    return {
      id: response.id,
      subject: response.subject,
      start: response.start.dateTime,
      end: response.end.dateTime,
      updated_at: new Date().toISOString()
    };
  }

  private async deleteEvent(connection: any, params: any): Promise<any> {
    const { event_id } = params;

    await this.makeGraphRequest(
      connection,
      `/me/events/${event_id}`,
      'DELETE'
    );

    return {
      event_id,
      deleted_at: new Date().toISOString(),
      status: 'deleted'
    };
  }

  private async getEventDetails(connection: any, params: any): Promise<any> {
    const { event_id } = params;

    const response = await this.makeGraphRequest(
      connection,
      `/me/events/${event_id}?$select=id,subject,start,end,location,body,attendees,organizer,onlineMeeting`,
      'GET'
    );

    return {
      id: response.id,
      subject: response.subject,
      start: response.start.dateTime,
      end: response.end.dateTime,
      location: response.location?.displayName,
      body: response.body?.content,
      attendees: response.attendees?.map((a: any) => ({
        email: a.emailAddress.address,
        name: a.emailAddress.name,
        response: a.status.response
      })) || [],
      organizer: {
        email: response.organizer?.emailAddress?.address,
        name: response.organizer?.emailAddress?.name
      },
      ...(response.onlineMeeting && {
        online_meeting_url: response.onlineMeeting.joinUrl
      }),
      retrieved_at: new Date().toISOString()
    };
  }

  // === HELPER METHODS ===

  private async makeGraphRequest(
    connection: any,
    endpoint: string,
    method: string = 'GET',
    body?: any
  ): Promise<any> {
    const url = endpoint.startsWith('http') ? endpoint : `${this.graphBaseUrl}${endpoint}`;

    const options: RequestInit = {
      method,
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      ...(body && { body: JSON.stringify(body) })
    };

    logger.debug({ url, method }, 'Making Graph API request');

    const response = await fetch(url, options);

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, errorText }, 'Graph API request failed');

      // Map common errors to user-friendly messages
      if (response.status === 401) {
        throw new Error('auth_failed');
      } else if (response.status === 404) {
        throw new Error('not_found');
      } else if (response.status === 403) {
        throw new Error('insufficient_permissions');
      } else if (response.status === 429) {
        throw new Error('quota_exceeded');
      }

      throw new Error(`Graph API error: ${response.status} - ${errorText}`);
    }

    // DELETE requests may return 204 No Content
    if (response.status === 204) {
      return {};
    }

    return await response.json();
  }
}
