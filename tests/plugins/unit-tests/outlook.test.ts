/**
 * Unit tests for OutlookPluginExecutor -- 10 actions
 *
 * Actions: send_email, search_emails, create_draft, modify_message,
 *          get_email_attachment, list_events, create_event, update_event,
 *          delete_event, get_event_details
 */

import { OutlookPluginExecutor } from '@/lib/server/outlook-plugin-executor';
import {
  createTestExecutor,
  expectSuccessResult,
  expectErrorResult,
  expectFetchCalledWith,
  expectAllFetchCallsAuthorized,
} from '../common/test-helpers';
import {
  mockFetchSuccess,
  mockFetchError,
  mockFetchSequence,
  restoreFetch,
  getAllFetchCalls,
} from '../common/mock-fetch';
import { runStandardErrorScenarios } from '../common/error-scenarios';

const PLUGIN_KEY = 'outlook';
const USER_ID = 'test-user-id';

describe('OutlookPluginExecutor', () => {
  let executor: any;

  beforeAll(async () => {
    const ctx = await createTestExecutor(OutlookPluginExecutor, PLUGIN_KEY);
    executor = ctx.executor;
  });

  afterEach(() => {
    restoreFetch();
  });

  describe('[smoke]', () => {
    describe('send_email', () => {
      it('should send an email via Graph API sendMail', async () => {
        // sendMail returns 202 Accepted with no body; makeGraphRequest handles 202 as non-ok (200-299),
        // but the executor wraps the response. Mock a 202 response as success.
        mockFetchSuccess({}, 202);

        const result = await executor.executeAction(USER_ID, 'send_email', {
          to: ['user@example.com'],
          subject: 'Test Subject',
          body: '<p>Hello</p>',
        });

        expectSuccessResult(result);
        expect(result.data.status).toBe('sent');
        expectFetchCalledWith('graph.microsoft.com/v1.0/me/sendMail', 'POST');
        expectAllFetchCallsAuthorized();
      });
    });

    describe('search_emails', () => {
      it('should search emails in the inbox', async () => {
        mockFetchSuccess({
          value: [
            {
              id: 'msg-1',
              subject: 'Important email',
              from: { emailAddress: { address: 'sender@example.com' } },
              toRecipients: [{ emailAddress: { address: 'me@example.com' } }],
              receivedDateTime: '2026-04-10T00:00:00Z',
              bodyPreview: 'This is important...',
              hasAttachments: false,
            },
          ],
        });

        const result = await executor.executeAction(USER_ID, 'search_emails', {
          query: 'important',
        });

        expectSuccessResult(result);
        expect(result.data.emails).toHaveLength(1);
        expect(result.data.emails[0].subject).toBe('Important email');
        expect(result.data.emails[0].from).toBe('sender@example.com');
        expectFetchCalledWith('graph.microsoft.com/v1.0/me/mailFolders/inbox/messages');
      });
    });

    describe('create_draft', () => {
      it('should create a draft email', async () => {
        mockFetchSuccess({
          id: 'draft-1',
          createdDateTime: '2026-04-12T00:00:00Z',
          webLink: 'https://outlook.live.com/draft-1',
        });

        const result = await executor.executeAction(USER_ID, 'create_draft', {
          to: ['user@example.com'],
          subject: 'Draft Subject',
          body: 'Draft body',
        });

        expectSuccessResult(result);
        expect(result.data.message_id).toBe('draft-1');
        expectFetchCalledWith('graph.microsoft.com/v1.0/me/messages', 'POST');
      });
    });

    describe('modify_message', () => {
      it('should mark a message as read', async () => {
        mockFetchSuccess({
          id: 'msg-1',
          isRead: true,
        });

        const result = await executor.executeAction(USER_ID, 'modify_message', {
          message_id: 'msg-1',
          is_read: true,
        });

        expectSuccessResult(result);
        expect(result.data.message_id).toBe('msg-1');
        expect(result.data.is_read).toBe(true);
        expectFetchCalledWith('graph.microsoft.com/v1.0/me/messages/msg-1', 'PATCH');
      });
    });

    describe('get_email_attachment', () => {
      it('should return all attachments for a message', async () => {
        mockFetchSuccess({
          value: [
            {
              id: 'att-1',
              name: 'report.pdf',
              contentType: 'application/pdf',
              size: 5000,
              contentBytes: 'base64content==',
            },
          ],
        });

        const result = await executor.executeAction(USER_ID, 'get_email_attachment', {
          message_id: 'msg-1',
        });

        expectSuccessResult(result);
        expect(result.data.attachments).toHaveLength(1);
        expect(result.data.attachments[0].filename).toBe('report.pdf');
        expect(result.data.attachment_count).toBe(1);
        expectFetchCalledWith('graph.microsoft.com/v1.0/me/messages/msg-1/attachments');
      });
    });

    describe('list_events', () => {
      it('should list calendar events', async () => {
        mockFetchSuccess({
          value: [
            {
              id: 'evt-1',
              subject: 'Team Standup',
              start: { dateTime: '2026-04-12T09:00:00Z' },
              end: { dateTime: '2026-04-12T09:30:00Z' },
              location: { displayName: 'Room A' },
              attendees: [{ emailAddress: { address: 'colleague@example.com' } }],
              organizer: { emailAddress: { address: 'me@example.com' } },
            },
          ],
        });

        const result = await executor.executeAction(USER_ID, 'list_events', {});

        expectSuccessResult(result);
        expect(result.data.events).toHaveLength(1);
        expect(result.data.events[0].subject).toBe('Team Standup');
        expect(result.data.events[0].location).toBe('Room A');
        expectFetchCalledWith('graph.microsoft.com/v1.0/me/calendar/calendarView');
      });
    });

    describe('create_event', () => {
      it('should create a calendar event', async () => {
        mockFetchSuccess({
          id: 'evt-new',
          subject: 'Meeting',
          start: { dateTime: '2026-04-15T14:00:00Z' },
          end: { dateTime: '2026-04-15T15:00:00Z' },
          webLink: 'https://outlook.live.com/evt-new',
        });

        const result = await executor.executeAction(USER_ID, 'create_event', {
          subject: 'Meeting',
          start: '2026-04-15T14:00:00Z',
          end: '2026-04-15T15:00:00Z',
        });

        expectSuccessResult(result);
        expect(result.data.id).toBe('evt-new');
        expect(result.data.subject).toBe('Meeting');
        expectFetchCalledWith('graph.microsoft.com/v1.0/me/events', 'POST');
      });
    });

    describe('update_event', () => {
      it('should update an event subject', async () => {
        mockFetchSuccess({
          id: 'evt-1',
          subject: 'Updated Standup',
          start: { dateTime: '2026-04-12T09:00:00Z' },
          end: { dateTime: '2026-04-12T09:30:00Z' },
        });

        const result = await executor.executeAction(USER_ID, 'update_event', {
          event_id: 'evt-1',
          subject: 'Updated Standup',
        });

        expectSuccessResult(result);
        expect(result.data.subject).toBe('Updated Standup');
        expectFetchCalledWith('graph.microsoft.com/v1.0/me/events/evt-1', 'PATCH');
      });
    });

    describe('delete_event', () => {
      it('should delete an event', async () => {
        mockFetchSuccess({}, 204);

        const result = await executor.executeAction(USER_ID, 'delete_event', {
          event_id: 'evt-1',
        });

        expectSuccessResult(result);
        expect(result.data.status).toBe('deleted');
        expectFetchCalledWith('graph.microsoft.com/v1.0/me/events/evt-1', 'DELETE');
      });
    });

    describe('get_event_details', () => {
      it('should return full event details', async () => {
        mockFetchSuccess({
          id: 'evt-1',
          subject: 'Team Standup',
          start: { dateTime: '2026-04-12T09:00:00Z' },
          end: { dateTime: '2026-04-12T09:30:00Z' },
          location: { displayName: 'Room A' },
          body: { content: '<p>Agenda</p>' },
          attendees: [
            {
              emailAddress: { address: 'alice@example.com', name: 'Alice' },
              status: { response: 'accepted' },
            },
          ],
          organizer: { emailAddress: { address: 'me@example.com', name: 'Me' } },
        });

        const result = await executor.executeAction(USER_ID, 'get_event_details', {
          event_id: 'evt-1',
        });

        expectSuccessResult(result);
        expect(result.data.attendees).toHaveLength(1);
        expect(result.data.attendees[0].email).toBe('alice@example.com');
        expect(result.data.organizer.email).toBe('me@example.com');
        expectFetchCalledWith('graph.microsoft.com/v1.0/me/events/evt-1');
      });
    });
  });

  describe('[full]', () => {
    describe('send_email', () => {
      it('should handle 401 auth failure', async () => {
        mockFetchError(401, 'Unauthorized');

        const result = await executor.executeAction(USER_ID, 'send_email', {
          to: ['user@example.com'],
          subject: 'Test',
          body: 'Body',
        });

        expectErrorResult(result);
      });
    });

    describe('search_emails', () => {
      it('should handle empty results', async () => {
        mockFetchSuccess({ value: [] });

        const result = await executor.executeAction(USER_ID, 'search_emails', {
          query: 'nonexistent',
        });

        expectSuccessResult(result);
        expect(result.data.emails).toHaveLength(0);
        expect(result.data.email_count).toBe(0);
      });
    });

    describe('modify_message', () => {
      it('should handle move to folder after update', async () => {
        mockFetchSequence([
          // PATCH update
          { body: { id: 'msg-1', isRead: true } },
          // POST move
          { body: { id: 'msg-1' } },
        ]);

        const result = await executor.executeAction(USER_ID, 'modify_message', {
          message_id: 'msg-1',
          is_read: true,
          folder: 'deleteditems',
        });

        expectSuccessResult(result);
        expect(getAllFetchCalls()).toHaveLength(2);
      });
    });

    describe('get_email_attachment', () => {
      it('should return a specific attachment when attachment_id is given', async () => {
        mockFetchSuccess({
          id: 'att-1',
          name: 'invoice.pdf',
          contentType: 'application/pdf',
          size: 3000,
          contentBytes: 'base64==',
        });

        const result = await executor.executeAction(USER_ID, 'get_email_attachment', {
          message_id: 'msg-1',
          attachment_id: 'att-1',
        });

        expectSuccessResult(result);
        expect(result.data.attachment_count).toBe(1);
        expect(result.data.attachments[0].attachment_id).toBe('att-1');
        expectFetchCalledWith('messages/msg-1/attachments/att-1');
      });
    });

    describe('create_event', () => {
      it('should handle 429 rate limit error', async () => {
        mockFetchError(429, 'Too Many Requests');

        const result = await executor.executeAction(USER_ID, 'create_event', {
          subject: 'Meeting',
          start: '2026-04-15T14:00:00Z',
          end: '2026-04-15T15:00:00Z',
        });

        expectErrorResult(result);
      });
    });

    describe('get_event_details', () => {
      it('should handle 404 not found', async () => {
        mockFetchError(404, 'Not Found');

        const result = await executor.executeAction(USER_ID, 'get_event_details', {
          event_id: 'evt-nonexistent',
        });

        expectErrorResult(result);
      });
    });

    // ---- P3-T2: Standard error scenarios ----
    runStandardErrorScenarios(
      () => executor,
      OutlookPluginExecutor,
      PLUGIN_KEY,
      'send_email',
      { to: ['user@example.com'], subject: 'Test', body: 'Body' }
    );

    // ---- P3-T3: Malformed response tests ----
    describe('malformed responses', () => {
      it('handles response missing expected fields', async () => {
        mockFetchSuccess({});
        const result = await executor.executeAction(USER_ID, 'send_email', {
          to: ['user@example.com'],
          subject: 'Test',
          body: 'Body',
        });
        expect(result).toBeDefined();
      });

      it('handles null response body', async () => {
        mockFetchSuccess(null);
        const result = await executor.executeAction(USER_ID, 'send_email', {
          to: ['user@example.com'],
          subject: 'Test',
          body: 'Body',
        });
        expect(result).toBeDefined();
      });
    });

    // ---- P3-T4: Authentication edge cases ----
    describe('authentication edge cases', () => {
      it('handles empty access_token', async () => {
        const ctx = await createTestExecutor(OutlookPluginExecutor, PLUGIN_KEY, {
          access_token: '',
        });
        mockFetchError(401, { error: { code: 'InvalidAuthenticationToken', message: 'Access token is empty' } });
        const result = await ctx.executor.executeAction(USER_ID, 'send_email', {
          to: ['user@example.com'],
          subject: 'Test',
          body: 'Body',
        });
        expectErrorResult(result);
      });
    });
  });
});
