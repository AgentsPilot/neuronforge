/**
 * Unit tests for OutlookPluginExecutor -- 10 actions
 *
 * Actions: send_email, search_emails, create_draft, modify_message,
 *          get_email_attachment, list_events, create_event, update_event,
 *          delete_event, get_event_details
 */

/*
 * PROD-1b.2: every logger call is recorded, so the calendar guard's cases can
 * prove no address, subject or body reaches a log line. Only `createLogger` is
 * replaced; the module's other exports stay real.
 */
const mockLogged: Array<{ level: string; args: unknown[] }> = [];
jest.mock('@/lib/logger', () => {
  const actual = jest.requireActual('@/lib/logger');
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
      logger[level] = (...args: unknown[]) => mockLogged.push({ level, args });
    }
    logger.child = () => logger;
    return logger;
  };
  return { ...actual, createLogger: () => make() };
});

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

/*
 * PROD-1b (A7): the recipient guard is on under Jest (no VERCEL_ENV). Every
 * test below lists its fixture domains, so the pre-existing cases exercise the
 * same paths as before; the guard's own cases are in the PROD-1b describe.
 */
const ENV_BEFORE_GUARD = { ...process.env };
const FIXTURE_ALLOWLIST = '@example.com';
beforeEach(() => {
  process.env.EMAIL_RECIPIENT_ALLOWLIST = FIXTURE_ALLOWLIST;
});
afterEach(() => {
  process.env = { ...ENV_BEFORE_GUARD };
});

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
        /*
         * PROD-1b.2 (SA condition 2): the guard is on under Jest, so the
         * executor reads the event first. A realistic read (the user organises
         * it, nobody else is on it), then the write's response.
         */
        mockFetchSequence([
          { body: { isOrganizer: true, attendees: [], subject: 'Standup' } },
          {
            body: {
              id: 'evt-1',
              subject: 'Updated Standup',
              start: { dateTime: '2026-04-12T09:00:00Z' },
              end: { dateTime: '2026-04-12T09:30:00Z' },
            },
          },
        ]);

        const result = await executor.executeAction(USER_ID, 'update_event', {
          event_id: 'evt-1',
          subject: 'Updated Standup',
        });

        expectSuccessResult(result);
        expect(result.data.subject).toBe('Updated Standup');
        const calls = getAllFetchCalls();
        expect(calls).toHaveLength(2);
        expect(calls[0].url).toContain('graph.microsoft.com/v1.0/me/events/evt-1?');
        expect(calls[0].options?.method ?? 'GET').toBe('GET');
        expectFetchCalledWith('graph.microsoft.com/v1.0/me/events/evt-1', 'PATCH');
      });
    });

    describe('delete_event', () => {
      it('should delete an event', async () => {
        /* PROD-1b.2 (SA condition 2): a realistic read first, then the 204. */
        mockFetchSequence([
          { body: { isOrganizer: true, attendees: [] } },
          { body: {}, status: 204 },
        ]);

        const result = await executor.executeAction(USER_ID, 'delete_event', {
          event_id: 'evt-1',
        });

        expectSuccessResult(result);
        expect(result.data.status).toBe('deleted');
        const calls = getAllFetchCalls();
        expect(calls).toHaveLength(2);
        expect(calls[0].options?.method ?? 'GET').toBe('GET');
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

// ─── PROD-1b (A7): the recipient guard on send_email, workplan 11.4 ────────
describe('OutlookPluginExecutor — PROD-1b recipient guard', () => {
  let executor: any;

  beforeAll(async () => {
    const ctx = await createTestExecutor(OutlookPluginExecutor, PLUGIN_KEY);
    executor = ctx.executor;
  });

  afterEach(() => {
    restoreFetch();
  });

  const graphSends = () => getAllFetchCalls().filter((c) => c.url.includes('/me/sendMail'));

  it('send_email with a refused cc: no Graph call, suppressed result', async () => {
    mockFetchSuccess({}, 202);
    const result = await executor.executeAction(USER_ID, 'send_email', {
      to: ['user@example.com'],
      cc: ['client@customer.example'],
      subject: 'S',
      body: 'B',
    });
    expectSuccessResult(result);
    expect(result.data.allowlist_suppressed).toBe(true);
    expect(graphSends()).toHaveLength(0);
  });

  it('send_email to listed recipients is sent', async () => {
    mockFetchSuccess({}, 202);
    const result = await executor.executeAction(USER_ID, 'send_email', { to: ['user@example.com'], subject: 'S', body: 'B' });
    expectSuccessResult(result);
    expect(result.data.allowlist_suppressed).toBeUndefined();
    expect(graphSends()).toHaveLength(1);
  });

  it('production with the list absent: unchanged, anyone', async () => {
    process.env.VERCEL_ENV = 'production';
    delete process.env.EMAIL_RECIPIENT_ALLOWLIST;
    mockFetchSuccess({}, 202);
    const result = await executor.executeAction(USER_ID, 'send_email', { to: ['client@customer.example'], subject: 'S', body: 'B' });
    expect(result.data.allowlist_suppressed).toBeUndefined();
    expect(graphSends()).toHaveLength(1);
  });
});

// ─── PROD-1b.2 (E-9): Outlook calendar meeting mail, workplan 10.1 ─────────
describe('OutlookPluginExecutor — PROD-1b.2 calendar guard', () => {
  let executor: any;

  const LISTED = 'colleague@example.com';
  const UNLISTED = 'client@customer.example';
  const SUBJECT = 'Private consultation';
  const BODY = 'Notes about the client';
  const SUPPRESSED_LINE = 'Calendar notifications suppressed: attendee not on the email allow-list';
  const REFUSED_LINE = 'Calendar event not changed: attendee not on the email allow-list';

  const eventResponse = (id: string) => ({
    id,
    subject: SUBJECT,
    start: { dateTime: '2026-04-15T14:00:00Z' },
    end: { dateTime: '2026-04-15T15:00:00Z' },
    webLink: `https://outlook.example/${id}`,
  });
  const attendee = (address: string) => ({ emailAddress: { address, name: 'N' }, type: 'required' });
  const readOf = (attendees: unknown[], extra: Record<string, unknown> = {}) => ({
    isOrganizer: true,
    attendees,
    subject: SUBJECT,
    start: { dateTime: '2026-04-15T14:00:00Z' },
    end: { dateTime: '2026-04-15T15:00:00Z' },
    ...extra,
  });

  const calls = () => getAllFetchCalls();
  const methodOf = (c: { options?: RequestInit }) => String(c.options?.method ?? 'GET').toUpperCase();
  const methods = () => calls().map(methodOf);
  const bodyOf = (c: { options?: RequestInit }) => JSON.parse(String(c.options?.body ?? '{}'));
  const logsAt = (level: string) => mockLogged.filter((l) => l.level === level);
  const messages = (level: string) => logsAt(level).map((l) => l.args[l.args.length - 1]);

  /*
   * P-1: no info/warn/error line carries an address, the subject or the body.
   * Debug lines are left out: the executor's pre-existing "Executing Outlook
   * action" debug line logs the raw parameters (workplan O-5), and production
   * logs at info.
   */
  const expectNothingPersonalLogged = () => {
    const text = JSON.stringify(mockLogged.filter((l) => l.level !== 'debug' && l.level !== 'trace').map((l) => l.args));
    for (const needle of [UNLISTED, LISTED, 'customer.example', SUBJECT, BODY]) expect(text).not.toContain(needle);
  };

  const createParams = (attendees?: unknown) => ({
    subject: SUBJECT,
    start: '2026-04-15T14:00:00Z',
    end: '2026-04-15T15:00:00Z',
    body: BODY,
    ...(attendees !== undefined && { attendees }),
  });

  const asProduction = (list?: string) => {
    process.env.VERCEL_ENV = 'production';
    if (list === undefined) delete process.env.EMAIL_RECIPIENT_ALLOWLIST;
    else process.env.EMAIL_RECIPIENT_ALLOWLIST = list;
  };

  beforeAll(async () => {
    const ctx = await createTestExecutor(OutlookPluginExecutor, PLUGIN_KEY);
    executor = ctx.executor;
  });

  beforeEach(() => {
    mockLogged.length = 0;
  });

  afterEach(() => {
    restoreFetch();
  });

  describe('create_event', () => {
    it('C-1 all attendees listed: one POST, attendees kept', async () => {
      mockFetchSuccess(eventResponse('evt-new'));
      const result = await executor.executeAction(USER_ID, 'create_event', createParams([LISTED]));
      expectSuccessResult(result);
      expect(methods()).toEqual(['POST']);
      expect(bodyOf(calls()[0]).attendees).toEqual([{ emailAddress: { address: LISTED }, type: 'required' }]);
      expect(result.data.invitations_suppressed).toBeUndefined();
    });

    it('C-2 one listed and one unlisted: written with NO attendees, flagged, counts-only log', async () => {
      mockFetchSuccess(eventResponse('evt-new'));
      const result = await executor.executeAction(USER_ID, 'create_event', createParams([LISTED, UNLISTED]));
      expectSuccessResult(result);
      expect(methods()).toEqual(['POST']);
      const sent = bodyOf(calls()[0]);
      expect('attendees' in sent).toBe(false);
      expect(sent.subject).toBe(SUBJECT);
      expect(result.data.id).toBe('evt-new');
      expect(result.data.invitations_suppressed).toBe(true);
      expect(result.data.allowlist_suppressed).toBeUndefined();
      const line = logsAt('info').find((l) => l.args[1] === SUPPRESSED_LINE);
      expect(line?.args[0]).toEqual(
        expect.objectContaining({ action: 'create_event', reason: 'recipient_not_allowed', recipientCount: 2, refusedCount: 1 })
      );
      expectNothingPersonalLogged();
    });

    it('C-3 list unset: attendees stripped', async () => {
      delete process.env.EMAIL_RECIPIENT_ALLOWLIST;
      mockFetchSuccess(eventResponse('evt-new'));
      const result = await executor.executeAction(USER_ID, 'create_event', createParams([LISTED]));
      expect('attendees' in bodyOf(calls()[0])).toBe(false);
      expect(result.data.invitations_suppressed).toBe(true);
    });

    it('C-4 an attendee that is not a string: stripped (fail closed)', async () => {
      mockFetchSuccess(eventResponse('evt-new'));
      const result = await executor.executeAction(USER_ID, 'create_event', createParams([LISTED, { email: LISTED }]));
      expect('attendees' in bodyOf(calls()[0])).toBe(false);
      expect(result.data.invitations_suppressed).toBe(true);
    });

    it('C-5 no attendees: POST as today, nothing flagged', async () => {
      mockFetchSuccess(eventResponse('evt-new'));
      const result = await executor.executeAction(USER_ID, 'create_event', createParams());
      expect(methods()).toEqual(['POST']);
      expect('attendees' in bodyOf(calls()[0])).toBe(false);
      expect(result.data.invitations_suppressed).toBeUndefined();
      expect(messages('info')).not.toContain(SUPPRESSED_LINE);
    });

    it('C-6 production, list absent: unlisted attendee kept (unchanged)', async () => {
      asProduction();
      mockFetchSuccess(eventResponse('evt-new'));
      const result = await executor.executeAction(USER_ID, 'create_event', createParams([UNLISTED]));
      expect(methods()).toEqual(['POST']);
      expect(bodyOf(calls()[0]).attendees).toEqual([{ emailAddress: { address: UNLISTED }, type: 'required' }]);
      expect(result.data.invitations_suppressed).toBeUndefined();
    });

    it('C-7 production, list set: stripped (same switch)', async () => {
      asProduction(FIXTURE_ALLOWLIST);
      mockFetchSuccess(eventResponse('evt-new'));
      const result = await executor.executeAction(USER_ID, 'create_event', createParams([UNLISTED]));
      expect('attendees' in bodyOf(calls()[0])).toBe(false);
      expect(result.data.invitations_suppressed).toBe(true);
    });
  });

  describe('update_event', () => {
    it('U-1 production, list absent: exactly one call (PATCH), no read', async () => {
      asProduction();
      mockFetchSuccess(eventResponse('evt-1'));
      const result = await executor.executeAction(USER_ID, 'update_event', { event_id: 'evt-1', attendees: [UNLISTED] });
      expectSuccessResult(result);
      expect(methods()).toEqual(['PATCH']);
      expect(bodyOf(calls()[0]).attendees).toHaveLength(1);
    });

    it('U-2 existing none, new one unlisted (booking-sync shape): time moved, attendee change dropped', async () => {
      mockFetchSequence([{ body: readOf([]) }, { body: eventResponse('evt-1') }]);
      const result = await executor.executeAction(USER_ID, 'update_event', {
        event_id: 'evt-1',
        start: '2026-04-16T14:00:00Z',
        end: '2026-04-16T15:00:00Z',
        attendees: [UNLISTED],
      });
      expectSuccessResult(result);
      expect(methods()).toEqual(['GET', 'PATCH']);
      const patch = bodyOf(calls()[1]);
      expect(patch.start).toEqual({ dateTime: '2026-04-16T14:00:00Z', timeZone: 'UTC' });
      expect('attendees' in patch).toBe(false);
      expect(result.data.invitations_suppressed).toBe(true);
      expect(result.data.allowlist_suppressed).toBeUndefined();
      expect(messages('info')).toContain(SUPPRESSED_LINE);
      expectNothingPersonalLogged();
    });

    it('U-3 existing listed, new listed: PATCH with attendees', async () => {
      mockFetchSequence([{ body: readOf([attendee(LISTED)]) }, { body: eventResponse('evt-1') }]);
      const result = await executor.executeAction(USER_ID, 'update_event', { event_id: 'evt-1', subject: 'S2', attendees: [LISTED] });
      expect(methods()).toEqual(['GET', 'PATCH']);
      expect(bodyOf(calls()[1]).attendees).toHaveLength(1);
      expect(result.data.invitations_suppressed).toBeUndefined();
    });

    it('U-4 an existing attendee unlisted, subject change only: no PATCH, not_updated, warn line', async () => {
      mockFetchSequence([{ body: readOf([attendee(UNLISTED)]) }, { body: eventResponse('evt-1') }]);
      const result = await executor.executeAction(USER_ID, 'update_event', { event_id: 'evt-1', subject: 'Renamed', body: BODY });
      expectSuccessResult(result);
      expect(methods()).toEqual(['GET']);
      expect(result.data).toEqual(
        expect.objectContaining({ id: 'evt-1', status: 'not_updated', allowlist_suppressed: true, updated_at: null, subject: SUBJECT })
      );
      expect(result.data.invitations_suppressed).toBeUndefined();
      expect(messages('warn')).toContain(REFUSED_LINE);
      expectNothingPersonalLogged();
    });

    it('U-5 an existing attendee unlisted, attendees: [] (removal): no PATCH', async () => {
      mockFetchSequence([{ body: readOf([attendee(UNLISTED)]) }, { body: eventResponse('evt-1') }]);
      const result = await executor.executeAction(USER_ID, 'update_event', { event_id: 'evt-1', attendees: [] });
      expect(methods()).toEqual(['GET']);
      expect(result.data.allowlist_suppressed).toBe(true);
    });

    it('U-6 an existing attendee with no address: no PATCH (fail closed)', async () => {
      mockFetchSequence([{ body: readOf([attendee(LISTED), { type: 'required' }]) }, { body: eventResponse('evt-1') }]);
      const result = await executor.executeAction(USER_ID, 'update_event', { event_id: 'evt-1', subject: 'S2' });
      expect(methods()).toEqual(['GET']);
      expect(result.data.allowlist_suppressed).toBe(true);
    });

    it('U-7 the user is not the organizer and the organizer is unlisted: no PATCH (D-6)', async () => {
      mockFetchSequence([
        { body: readOf([attendee(LISTED)], { isOrganizer: false, organizer: { emailAddress: { address: UNLISTED } } }) },
        { body: eventResponse('evt-1') },
      ]);
      const result = await executor.executeAction(USER_ID, 'update_event', { event_id: 'evt-1', subject: 'S2' });
      expect(methods()).toEqual(['GET']);
      expect(result.data.allowlist_suppressed).toBe(true);
    });

    it('U-8 the only change was a refused attendee change: not_updated, allowlist_suppressed (SA condition 3)', async () => {
      mockFetchSequence([{ body: readOf([]) }, { body: eventResponse('evt-1') }]);
      const result = await executor.executeAction(USER_ID, 'update_event', { event_id: 'evt-1', attendees: [UNLISTED] });
      expectSuccessResult(result);
      expect(methods()).toEqual(['GET']);
      expect(result.data.status).toBe('not_updated');
      expect(result.data.allowlist_suppressed).toBe(true);
      expect(result.data.invitations_suppressed).toBeUndefined();
      expect(messages('warn')).toContain(REFUSED_LINE);
    });

    it('U-12 isOrganizer is the STRING "true" and the organizer is unlisted: no PATCH (only exactly true counts)', async () => {
      mockFetchSequence([
        { body: readOf([], { isOrganizer: 'true', organizer: { emailAddress: { address: UNLISTED } } }) },
        { body: eventResponse('evt-1') },
      ]);
      const result = await executor.executeAction(USER_ID, 'update_event', { event_id: 'evt-1', subject: 'S2' });
      expect(methods()).toEqual(['GET']);
      expect(result.data.allowlist_suppressed).toBe(true);
    });

    it.each([404, 500])('U-9 the read answers %i: an error, no PATCH', async (status) => {
      mockFetchError(status, 'nope');
      const result = await executor.executeAction(USER_ID, 'update_event', { event_id: 'evt-1', subject: 'S2' });
      expectErrorResult(result);
      expect(methods()).toEqual(['GET']);
    });

    it('U-10 read body {} (the shape of a 204): no PATCH (SA condition 1)', async () => {
      mockFetchSequence([{ body: {}, status: 204 }, { body: eventResponse('evt-1') }]);
      const result = await executor.executeAction(USER_ID, 'update_event', { event_id: 'evt-1', subject: 'S2' });
      expect(methods()).toEqual(['GET']);
      expect(result.data.allowlist_suppressed).toBe(true);
    });

    it('U-11 isOrganizer true and no attendees key: refused (SA condition 1)', async () => {
      mockFetchSequence([{ body: { isOrganizer: true, subject: SUBJECT } }, { body: eventResponse('evt-1') }]);
      const result = await executor.executeAction(USER_ID, 'update_event', { event_id: 'evt-1', subject: 'S2' });
      expect(methods()).toEqual(['GET']);
      expect(result.data.allowlist_suppressed).toBe(true);
    });
  });

  describe('delete_event', () => {
    it('D-1 production, list absent: exactly one call (DELETE), no read', async () => {
      asProduction();
      mockFetchSuccess({}, 204);
      const result = await executor.executeAction(USER_ID, 'delete_event', { event_id: 'evt-1' });
      expect(methods()).toEqual(['DELETE']);
      expect(result.data.status).toBe('deleted');
    });

    it('D-2 no attendees, the user is the organizer: GET then DELETE', async () => {
      mockFetchSequence([{ body: readOf([]) }, { body: {}, status: 204 }]);
      const result = await executor.executeAction(USER_ID, 'delete_event', { event_id: 'evt-1' });
      expect(methods()).toEqual(['GET', 'DELETE']);
      expect(result.data.status).toBe('deleted');
    });

    it('D-3 all attendees listed: GET then DELETE', async () => {
      mockFetchSequence([{ body: readOf([attendee(LISTED)]) }, { body: {}, status: 204 }]);
      const result = await executor.executeAction(USER_ID, 'delete_event', { event_id: 'evt-1' });
      expect(methods()).toEqual(['GET', 'DELETE']);
      expect(result.data.status).toBe('deleted');
    });

    it('D-4 one unlisted: no DELETE, not_deleted, warn line', async () => {
      mockFetchSequence([{ body: readOf([attendee(LISTED), attendee(UNLISTED)]) }, { body: {}, status: 204 }]);
      const result = await executor.executeAction(USER_ID, 'delete_event', { event_id: 'evt-1' });
      expectSuccessResult(result);
      expect(methods()).toEqual(['GET']);
      expect(result.data).toEqual(
        expect.objectContaining({ event_id: 'evt-1', status: 'not_deleted', deleted_at: null, allowlist_suppressed: true })
      );
      expect(messages('warn')).toContain(REFUSED_LINE);
      expectNothingPersonalLogged();
    });

    it('D-5 the read answers 404: the same error as an unguarded DELETE 404, and no DELETE', async () => {
      mockFetchError(404, 'Not Found');
      const guarded = await executor.executeAction(USER_ID, 'delete_event', { event_id: 'evt-1' });
      expect(methods()).toEqual(['GET']);
      restoreFetch();

      asProduction();
      mockFetchError(404, 'Not Found');
      const unguarded = await executor.executeAction(USER_ID, 'delete_event', { event_id: 'evt-1' });
      expect(methods()).toEqual(['DELETE']);

      expectErrorResult(guarded);
      expect(guarded).toEqual(unguarded);
    });

    it('D-6 the read answers 500: an error, no DELETE', async () => {
      mockFetchError(500, 'Server Error');
      const result = await executor.executeAction(USER_ID, 'delete_event', { event_id: 'evt-1' });
      expectErrorResult(result);
      expect(methods()).toEqual(['GET']);
    });

    it('D-7 production, list set, unlisted attendee: no DELETE (same switch)', async () => {
      asProduction(FIXTURE_ALLOWLIST);
      mockFetchSequence([{ body: readOf([attendee(UNLISTED)]) }, { body: {}, status: 204 }]);
      const result = await executor.executeAction(USER_ID, 'delete_event', { event_id: 'evt-1' });
      expect(methods()).toEqual(['GET']);
      expect(result.data.allowlist_suppressed).toBe(true);
    });

    it('D-8 read body {} (204 shape): no DELETE (SA condition 1)', async () => {
      mockFetchSequence([{ body: {}, status: 204 }, { body: {}, status: 204 }]);
      const result = await executor.executeAction(USER_ID, 'delete_event', { event_id: 'evt-1' });
      expect(methods()).toEqual(['GET']);
      expect(result.data.allowlist_suppressed).toBe(true);
    });

    it('D-9 isOrganizer true and no attendees key: no DELETE (SA condition 1)', async () => {
      mockFetchSequence([{ body: { isOrganizer: true } }, { body: {}, status: 204 }]);
      const result = await executor.executeAction(USER_ID, 'delete_event', { event_id: 'evt-1' });
      expect(methods()).toEqual(['GET']);
      expect(result.data.allowlist_suppressed).toBe(true);
    });

    it('D-10 isOrganizer is the STRING "true" and the organizer is unlisted: no DELETE (only exactly true counts)', async () => {
      mockFetchSequence([
        { body: readOf([], { isOrganizer: 'true', organizer: { emailAddress: { address: UNLISTED } } }) },
        { body: {}, status: 204 },
      ]);
      const result = await executor.executeAction(USER_ID, 'delete_event', { event_id: 'evt-1' });
      expect(methods()).toEqual(['GET']);
      expect(result.data.allowlist_suppressed).toBe(true);
    });
  });
});
