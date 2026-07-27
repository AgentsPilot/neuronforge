/**
 * Unit tests for GmailPluginExecutor — 5 original + 6 Phase 1 actions
 *
 * Tests call executeAction() on the executor (full flow through base class)
 * to validate parameter validation, connection retrieval, action dispatch,
 * response parsing, and error mapping.
 *
 * Phase 1 (get_or_create_label, list_labels, delete_label, reply_to_email,
 * send_draft, batch_modify_emails) follows a LEAN policy: exactly 3 unit tests
 * per action (happy + 401 + invalid-input) + 4 safety assertions (S1–S4) + one
 * CR-3 regression assertion protecting the buildEmailMessage extraHeaders change.
 */

import { GmailPluginExecutor } from '@/lib/server/gmail-plugin-executor';
import { createTestExecutor, expectSuccessResult, expectErrorResult, expectFetchCalledWith, expectAllFetchCallsAuthorized } from '../common/test-helpers';
import { mockFetchSuccess, mockFetchError, mockFetchSequence, restoreFetch, getAllFetchCalls } from '../common/mock-fetch';
import { runStandardErrorScenarios } from '../common/error-scenarios';

const PLUGIN_KEY = 'google-mail';
const USER_ID = 'test-user-id';

describe('GmailPluginExecutor', () => {
  let executor: any;

  beforeAll(async () => {
    const ctx = await createTestExecutor(GmailPluginExecutor, PLUGIN_KEY);
    executor = ctx.executor;
  });

  afterEach(() => {
    restoreFetch();
  });

  describe('[smoke]', () => {
    // ---- send_email ----
    describe('send_email', () => {
      it('should call Gmail send endpoint with base64url encoded message', async () => {
        mockFetchSuccess({ id: 'msg-123', threadId: 'thread-456' });

        const result = await executor.executeAction(USER_ID, 'send_email', {
          recipients: { to: ['user@example.com'] },
          content: { subject: 'Test Subject', body: 'Hello World' },
        });

        expectSuccessResult(result);
        expect(result.data.message_id).toBe('msg-123');
        expect(result.data.thread_id).toBe('thread-456');
        expect(result.data.recipient_count).toBe(1);
        expectFetchCalledWith('gmail.googleapis.com/gmail/v1/users/me/messages/send', 'POST');
        expectAllFetchCallsAuthorized();
      });
    });

    // ---- search_emails ----
    describe('search_emails', () => {
      it('should make list + detail fetch calls and return formatted emails', async () => {
        mockFetchSequence([
          // List response
          {
            body: {
              messages: [{ id: 'msg-1' }, { id: 'msg-2' }],
              resultSizeEstimate: 2,
            },
          },
          // Detail for msg-1
          {
            body: {
              id: 'msg-1',
              threadId: 't-1',
              snippet: 'Hello',
              labelIds: ['INBOX'],
              payload: {
                headers: [
                  { name: 'Subject', value: 'Test 1' },
                  { name: 'From', value: 'a@b.com' },
                  { name: 'To', value: 'c@d.com' },
                  { name: 'Date', value: '2026-01-01' },
                ],
              },
            },
          },
          // Detail for msg-2
          {
            body: {
              id: 'msg-2',
              threadId: 't-2',
              snippet: 'World',
              labelIds: ['INBOX'],
              payload: {
                headers: [
                  { name: 'Subject', value: 'Test 2' },
                  { name: 'From', value: 'e@f.com' },
                  { name: 'To', value: 'g@h.com' },
                  { name: 'Date', value: '2026-01-02' },
                ],
              },
            },
          },
        ]);

        const result = await executor.executeAction(USER_ID, 'search_emails', {
          query: 'in:inbox',
          max_results: 2,
        });

        expectSuccessResult(result);
        expect(result.data.emails).toHaveLength(2);
        expect(result.data.total_found).toBe(2);
        // 1 list call + 2 detail calls = 3 total
        expect(getAllFetchCalls()).toHaveLength(3);
      });
    });

    // ---- create_draft ----
    describe('create_draft', () => {
      it('should call Gmail drafts endpoint and return draft info', async () => {
        mockFetchSuccess({ id: 'draft-789', message: { id: 'msg-draft-1' } });

        const result = await executor.executeAction(USER_ID, 'create_draft', {
          recipients: { to: ['draft@example.com'] },
          content: { subject: 'Draft Subject', body: 'Draft body' },
        });

        expectSuccessResult(result);
        expect(result.data.draft_id).toBe('draft-789');
        expectFetchCalledWith('gmail.googleapis.com/gmail/v1/users/me/drafts', 'POST');
      });
    });

    // ---- get_email_attachment ----
    describe('get_email_attachment', () => {
      it('should fetch attachment and detect MIME type from filename', async () => {
        mockFetchSuccess({ data: 'dGVzdGRhdGE=', size: 1024 });

        const result = await executor.executeAction(USER_ID, 'get_email_attachment', {
          message_id: 'msg-100',
          attachment_id: 'att-200',
          filename: 'report.pdf',
        });

        expectSuccessResult(result);
        expect(result.data.mimeType).toBe('application/pdf');
        expect(result.data.filename).toBe('report.pdf');
        expectFetchCalledWith('messages/msg-100/attachments/att-200');
      });
    });

    // ---- modify_email ----
    describe('modify_email', () => {
      it('should mark email as read using system labels only (no label list fetch)', async () => {
        // mark_read: true only uses UNREAD (system label) — no GET /labels call needed
        mockFetchSuccess({
          id: 'msg-200',
          labelIds: ['INBOX'],
        });

        const result = await executor.executeAction(USER_ID, 'modify_email', {
          message_id: 'msg-200',
          mark_read: true,
        });

        expectSuccessResult(result);
        expect(result.data.message_id).toBe('msg-200');
        expect(result.data.labels_removed).toContain('UNREAD');
        expect(result.data.labels_added).toEqual([]);
        // Only the modify call — no labels list call
        expect(getAllFetchCalls()).toHaveLength(1);
        expectFetchCalledWith('messages/msg-200/modify', 'POST');
      });
    });
  });

  describe('[full]', () => {
    // ---- send_email error ----
    describe('send_email', () => {
      it('should handle API error and map through GoogleBasePluginExecutor', async () => {
        mockFetchError(401, 'Unauthorized');

        const result = await executor.executeAction(USER_ID, 'send_email', {
          recipients: { to: ['user@example.com'] },
          content: { subject: 'Test', body: 'Body' },
        });

        expectErrorResult(result);
      });

      // SA review item #3: Google-specific JSON error body to exercise mapPluginSpecificError JSON parsing
      it('should parse Google JSON error body for 400 errors', async () => {
        mockFetchError(400, JSON.stringify({
          error: { code: 400, message: 'Invalid to header', status: 'INVALID_ARGUMENT' },
        }));

        const result = await executor.executeAction(USER_ID, 'send_email', {
          recipients: { to: ['user@example.com'] },
          content: { subject: 'Test', body: 'Body' },
        });

        expectErrorResult(result);
        // The GoogleBasePluginExecutor.mapPluginSpecificError should extract the nested message
        expect(result.message).toContain('Invalid to header');
      });
    });

    // ---- search_emails empty ----
    describe('search_emails', () => {
      it('should return empty array when no messages found', async () => {
        // Gmail API omits the `messages` key entirely when there are 0 results
        mockFetchSuccess({ resultSizeEstimate: 0 });

        const result = await executor.executeAction(USER_ID, 'search_emails', {
          query: 'from:nonexistent@example.com',
        });

        expectSuccessResult(result);
        expect(result.data.emails).toHaveLength(0);
        expect(result.data.total_found).toBe(0);
      });
    });

    // ---- create_draft error ----
    describe('create_draft', () => {
      it('should handle error response', async () => {
        mockFetchError(500, 'Internal Server Error');

        const result = await executor.executeAction(USER_ID, 'create_draft', {
          recipients: { to: ['draft@example.com'] },
          content: { subject: 'Draft', body: 'Body' },
        });

        expectErrorResult(result);
      });
    });

    // ---- get_email_attachment error ----
    describe('get_email_attachment', () => {
      it('should handle 404 error', async () => {
        mockFetchError(404, 'Not Found');

        const result = await executor.executeAction(USER_ID, 'get_email_attachment', {
          message_id: 'msg-100',
          attachment_id: 'att-999',
          filename: 'missing.pdf',
        });

        expectErrorResult(result);
      });
    });

    // ---- modify_email advanced ----
    describe('modify_email', () => {
      it('should mark email as important and resolve custom label', async () => {
        // When add_labels contains a custom name ("AgentsPilot"), the executor
        // fetches GET /users/me/labels to resolve it, then calls POST .../modify
        mockFetchSequence([
          // GET /users/me/labels — resolve "AgentsPilot" to its ID
          {
            body: {
              labels: [
                { id: 'Label_456', name: 'AgentsPilot', type: 'user' },
                { id: 'INBOX', name: 'INBOX', type: 'system' },
              ],
            },
          },
          // POST /users/me/messages/msg-123/modify — success
          {
            body: {
              id: 'msg-123',
              labelIds: ['IMPORTANT', 'Label_456', 'INBOX'],
            },
          },
        ]);

        const result = await executor.executeAction(USER_ID, 'modify_email', {
          message_id: 'msg-123',
          mark_important: true,
          add_labels: ['AgentsPilot'],
        });

        expectSuccessResult(result);
        expect(result.data.message_id).toBe('msg-123');
        expect(result.data.labels_added).toContain('IMPORTANT');
        expect(result.data.labels_added).toContain('Label_456');
        expect(result.data.labels_removed).toEqual([]);
        expectAllFetchCallsAuthorized();
      });

      it('should handle 404 message not found error', async () => {
        // System-only labels so no label list fetch; modify endpoint returns 404
        mockFetchError(404, JSON.stringify({
          error: { code: 404, message: 'Requested entity was not found.', status: 'NOT_FOUND' },
        }));

        const result = await executor.executeAction(USER_ID, 'modify_email', {
          message_id: 'msg-nonexistent',
          mark_important: true,
        });

        expectErrorResult(result);
      });

      it('should create a new label when custom label is not found', async () => {
        mockFetchSequence([
          // GET /users/me/labels — label "NewLabel" does not exist
          {
            body: {
              labels: [
                { id: 'INBOX', name: 'INBOX', type: 'system' },
              ],
            },
          },
          // POST /users/me/labels — create "NewLabel"
          {
            body: {
              id: 'Label_new_789',
              name: 'NewLabel',
              type: 'user',
            },
          },
          // POST /users/me/messages/msg-300/modify — success
          {
            body: {
              id: 'msg-300',
              labelIds: ['Label_new_789', 'INBOX'],
            },
          },
        ]);

        const result = await executor.executeAction(USER_ID, 'modify_email', {
          message_id: 'msg-300',
          add_labels: ['NewLabel'],
        });

        expectSuccessResult(result);
        expect(result.data.message_id).toBe('msg-300');
        expect(result.data.labels_added).toContain('Label_new_789');
        // Verify all 3 calls were made: GET labels, POST labels, POST modify
        expect(getAllFetchCalls()).toHaveLength(3);
      });
    });

    // ---- P3-T2: Standard error scenarios ----
    runStandardErrorScenarios(
      () => executor,
      GmailPluginExecutor,
      PLUGIN_KEY,
      'send_email',
      { recipients: { to: ['user@example.com'] }, content: { subject: 'Test', body: 'Body' } }
    );

    // ---- P3-T3: Malformed response tests ----
    describe('malformed responses', () => {
      it('handles response missing id/threadId fields', async () => {
        mockFetchSuccess({});
        const result = await executor.executeAction(USER_ID, 'send_email', {
          recipients: { to: ['user@example.com'] },
          content: { subject: 'Test', body: 'Body' },
        });
        expect(result).toBeDefined();
      });

      it('handles null response body', async () => {
        mockFetchSuccess(null);
        const result = await executor.executeAction(USER_ID, 'send_email', {
          recipients: { to: ['user@example.com'] },
          content: { subject: 'Test', body: 'Body' },
        });
        expect(result).toBeDefined();
      });
    });

    // ---- P3-T4: Authentication edge cases ----
    describe('authentication edge cases', () => {
      it('handles empty access_token', async () => {
        const ctx = await createTestExecutor(GmailPluginExecutor, PLUGIN_KEY, {
          access_token: '',
        });
        mockFetchError(401, { error: { code: 401, message: 'Invalid credentials' } });
        const result = await ctx.executor.executeAction(USER_ID, 'send_email', {
          recipients: { to: ['user@example.com'] },
          content: { subject: 'Test', body: 'Body' },
        });
        expectErrorResult(result);
      });
    });
  });
});

/**
 * Decode a Gmail base64url raw message back to its RFC822 string.
 * Used to assert MIME header content (In-Reply-To, References, etc.).
 */
function decodeRawMessage(raw: string): string {
  const base64 = raw.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf-8');
}

/** Parse the JSON body of a recorded fetch call. */
function bodyOf(call: { options?: any } | undefined): any {
  return call?.options?.body ? JSON.parse(call.options.body as string) : undefined;
}

describe('GmailPluginExecutor — Phase 1 actions', () => {
  let executor: any;

  beforeAll(async () => {
    const ctx = await createTestExecutor(GmailPluginExecutor, PLUGIN_KEY);
    executor = ctx.executor;
  });

  afterEach(() => {
    restoreFetch();
  });

  // ─── get_or_create_label (3 + S1) ───────────────────────────────────────
  describe('get_or_create_label', () => {
    it('[happy] creates the label on a miss and returns created:true', async () => {
      mockFetchSequence([
        // GET /labels — "Invoices" absent
        { body: { labels: [{ id: 'INBOX', name: 'INBOX', type: 'system' }] } },
        // POST /labels — create "Invoices"
        { body: { id: 'Label_1', name: 'Invoices', type: 'user' } },
      ]);

      const result = await executor.executeAction(USER_ID, 'get_or_create_label', {
        label_name: 'Invoices',
      });

      expectSuccessResult(result);
      expect(result.data.label_id).toBe('Label_1');
      expect(result.data.created).toBe(true);
      expectFetchCalledWith('gmail.googleapis.com/gmail/v1/users/me/labels', 'POST');
    });

    it('[401] returns error result on auth failure', async () => {
      mockFetchError(401, 'Unauthorized');
      const result = await executor.executeAction(USER_ID, 'get_or_create_label', {
        label_name: 'Invoices',
      });
      expectErrorResult(result);
    });

    it('[invalid] empty label_name is rejected before any fetch', async () => {
      mockFetchSuccess({ labels: [] });
      const result = await executor.executeAction(USER_ID, 'get_or_create_label', {
        label_name: '   ',
      });
      expectErrorResult(result);
      expect(getAllFetchCalls()).toHaveLength(0);
    });

    it('[S1] does NOT POST create when the label already exists (find path)', async () => {
      // Case-insensitive match against an existing label → GET only, no POST.
      mockFetchSuccess({ labels: [{ id: 'Label_1', name: 'Invoices', type: 'user' }] });

      const result = await executor.executeAction(USER_ID, 'get_or_create_label', {
        label_name: 'invoices',
      });

      expectSuccessResult(result);
      expect(result.data.created).toBe(false);
      expect(result.data.label_id).toBe('Label_1');
      const calls = getAllFetchCalls();
      expect(calls).toHaveLength(1);
      expect((calls[0].options?.method || 'GET').toUpperCase()).toBe('GET');
    });
  });

  // ─── list_labels (3) ─────────────────────────────────────────────────────
  describe('list_labels', () => {
    it('[happy] returns labels[] + total_found', async () => {
      mockFetchSuccess({
        labels: [
          { id: 'INBOX', name: 'INBOX', type: 'system' },
          { id: 'Label_1', name: 'Invoices', type: 'user' },
        ],
      });

      const result = await executor.executeAction(USER_ID, 'list_labels', {});

      expectSuccessResult(result);
      expect(result.data.labels).toHaveLength(2);
      expect(result.data.total_found).toBe(2);
      expectFetchCalledWith('gmail.googleapis.com/gmail/v1/users/me/labels');
    });

    it('[401] returns error result on auth failure', async () => {
      mockFetchError(401, 'Unauthorized');
      const result = await executor.executeAction(USER_ID, 'list_labels', {});
      expectErrorResult(result);
    });

    it('[invalid] out-of-enum label_type is clamped to default and still succeeds', async () => {
      // The param-constraint guard clamps an invalid enum back to the declared
      // default ('all'), so the run self-heals rather than failing.
      mockFetchSuccess({
        labels: [
          { id: 'INBOX', name: 'INBOX', type: 'system' },
          { id: 'Label_1', name: 'Invoices', type: 'user' },
        ],
      });

      const result = await executor.executeAction(USER_ID, 'list_labels', {
        label_type: 'bogus',
      });

      expectSuccessResult(result);
      expect(result.data.total_found).toBe(2);
    });
  });

  // ─── delete_label (3 + S3) ───────────────────────────────────────────────
  describe('delete_label', () => {
    it('[happy] issues DELETE and returns deleted:true (204, no .json())', async () => {
      mockFetchSuccess({}, 204);

      const result = await executor.executeAction(USER_ID, 'delete_label', {
        label_id: 'Label_1',
      });

      expectSuccessResult(result);
      expect(result.data.deleted).toBe(true);
      expect(result.data.already_absent).toBe(false);
      expectFetchCalledWith('/labels/Label_1', 'DELETE');
    });

    it('[401] returns error result on auth failure', async () => {
      mockFetchError(401, 'Unauthorized');
      const result = await executor.executeAction(USER_ID, 'delete_label', {
        label_id: 'Label_1',
      });
      expectErrorResult(result);
    });

    it('[invalid] a system label id is rejected before any DELETE', async () => {
      mockFetchSuccess({}, 204);
      const result = await executor.executeAction(USER_ID, 'delete_label', {
        label_id: 'INBOX',
      });
      expectErrorResult(result);
      expect(getAllFetchCalls()).toHaveLength(0);
    });

    it('[S3] 404 resolves to already-absent success; system label rejected pre-fetch', async () => {
      // (a) 404 → already-absent success, not a thrown error.
      mockFetchError(404, 'Not Found');
      const absentResult = await executor.executeAction(USER_ID, 'delete_label', {
        label_id: 'Label_gone',
      });
      expectSuccessResult(absentResult);
      expect(absentResult.data.already_absent).toBe(true);
      expect(absentResult.data.deleted).toBe(true);

      restoreFetch();

      // (b) system label rejected before any network call.
      mockFetchSuccess({}, 204);
      const systemResult = await executor.executeAction(USER_ID, 'delete_label', {
        label_id: 'SENT',
      });
      expectErrorResult(systemResult);
      expect(getAllFetchCalls()).toHaveLength(0);
    });
  });

  // ─── reply_to_email (3 + S2) ─────────────────────────────────────────────
  describe('reply_to_email', () => {
    it('[happy] fetches original metadata then sends into the same thread', async () => {
      mockFetchSequence([
        // GET original message metadata
        {
          body: {
            threadId: 'thread-1',
            payload: {
              headers: [
                { name: 'Message-ID', value: '<orig@mail.gmail.com>' },
                { name: 'Subject', value: 'Project Update' },
                { name: 'From', value: 'sender@example.com' },
              ],
            },
          },
        },
        // POST send
        { body: { id: 'msg-reply', threadId: 'thread-1' } },
      ]);

      const result = await executor.executeAction(USER_ID, 'reply_to_email', {
        message_id: 'msg-orig',
        content: { body: 'Thanks, got it.' },
      });

      expectSuccessResult(result);
      expect(result.data.message_id).toBe('msg-reply');
      expect(result.data.thread_id).toBe('thread-1');
      expect(result.data.subject).toBe('Re: Project Update');
      expectFetchCalledWith('gmail.googleapis.com/gmail/v1/users/me/messages/send', 'POST');
    });

    it('[401] returns error result when the metadata fetch is unauthorized', async () => {
      mockFetchError(401, 'Unauthorized');
      const result = await executor.executeAction(USER_ID, 'reply_to_email', {
        message_id: 'msg-orig',
        content: { body: 'Reply' },
      });
      expectErrorResult(result);
    });

    it('[invalid] content without body/html_body is rejected before any fetch', async () => {
      mockFetchSuccess({});
      const result = await executor.executeAction(USER_ID, 'reply_to_email', {
        message_id: 'msg-orig',
        content: {},
      });
      expectErrorResult(result);
      expect(getAllFetchCalls()).toHaveLength(0);
    });

    it('[S2] send body carries threadId AND raw MIME has In-Reply-To to the original', async () => {
      mockFetchSequence([
        {
          body: {
            threadId: 'thread-1',
            payload: {
              headers: [
                { name: 'Message-ID', value: '<orig@mail.gmail.com>' },
                { name: 'Subject', value: 'Project Update' },
                { name: 'From', value: 'sender@example.com' },
              ],
            },
          },
        },
        { body: { id: 'msg-reply', threadId: 'thread-1' } },
      ]);

      await executor.executeAction(USER_ID, 'reply_to_email', {
        message_id: 'msg-orig',
        content: { body: 'Thanks, got it.' },
      });

      const sendCall = getAllFetchCalls().find((c) => c.url.includes('/messages/send'));
      expect(sendCall).toBeDefined();
      const body = bodyOf(sendCall);
      // Continues the thread, not a new one.
      expect(body.threadId).toBe('thread-1');
      const mime = decodeRawMessage(body.raw);
      expect(mime).toContain('In-Reply-To: <orig@mail.gmail.com>');
      expect(mime).toContain('References: <orig@mail.gmail.com>');
    });
  });

  // ─── send_draft (3) ──────────────────────────────────────────────────────
  describe('send_draft', () => {
    it('[happy] posts drafts/send and returns message + thread ids', async () => {
      mockFetchSuccess({ id: 'msg-sent', threadId: 'thread-9' });

      const result = await executor.executeAction(USER_ID, 'send_draft', {
        draft_id: 'r123',
      });

      expectSuccessResult(result);
      expect(result.data.message_id).toBe('msg-sent');
      expect(result.data.thread_id).toBe('thread-9');
      expect(result.data.draft_id).toBe('r123');
      expectFetchCalledWith('gmail.googleapis.com/gmail/v1/users/me/drafts/send', 'POST');
    });

    it('[401] returns error result on auth failure', async () => {
      mockFetchError(401, 'Unauthorized');
      const result = await executor.executeAction(USER_ID, 'send_draft', {
        draft_id: 'r123',
      });
      expectErrorResult(result);
    });

    it('[invalid] missing draft_id is rejected before any fetch', async () => {
      mockFetchSuccess({ id: 'msg-sent' });
      const result = await executor.executeAction(USER_ID, 'send_draft', {});
      expectErrorResult(result);
      expect(getAllFetchCalls()).toHaveLength(0);
    });
  });

  // ─── batch_modify_emails (3 + S4) ────────────────────────────────────────
  describe('batch_modify_emails', () => {
    it('[happy] archives a set of messages (204, no .json())', async () => {
      // archive uses only the system INBOX label → no GET /labels needed.
      mockFetchSuccess({}, 204);

      const result = await executor.executeAction(USER_ID, 'batch_modify_emails', {
        message_ids: ['m1', 'm2'],
        archive: true,
      });

      expectSuccessResult(result);
      expect(result.data.modified_count).toBe(2);
      expect(result.data.labels_removed).toContain('INBOX');
      expectFetchCalledWith('gmail.googleapis.com/gmail/v1/users/me/messages/batchModify', 'POST');
    });

    it('[401] returns error result on auth failure', async () => {
      mockFetchError(401, 'Unauthorized');
      const result = await executor.executeAction(USER_ID, 'batch_modify_emails', {
        message_ids: ['m1'],
        archive: true,
      });
      expectErrorResult(result);
    });

    it('[invalid] empty message_ids is rejected before any fetch', async () => {
      mockFetchSuccess({}, 204);
      const result = await executor.executeAction(USER_ID, 'batch_modify_emails', {
        message_ids: [],
        archive: true,
      });
      expectErrorResult(result);
      expect(getAllFetchCalls()).toHaveLength(0);
    });

    it('[S4] sends exactly the bounded id set; rejects > 1000 before fetch', async () => {
      // (a) exact bounded id set forwarded, never widened.
      mockFetchSuccess({}, 204);
      await executor.executeAction(USER_ID, 'batch_modify_emails', {
        message_ids: ['m1', 'm2', 'm3'],
        add_labels: ['IMPORTANT'], // system label → no GET /labels
      });
      const batchCall = getAllFetchCalls().find((c) => c.url.includes('/messages/batchModify'));
      expect(batchCall).toBeDefined();
      expect(bodyOf(batchCall).ids).toEqual(['m1', 'm2', 'm3']);

      restoreFetch();

      // (b) > 1000 ids hard-rejected before any network call.
      mockFetchSuccess({}, 204);
      const tooMany = Array.from({ length: 1001 }, (_, i) => `m${i}`);
      const result = await executor.executeAction(USER_ID, 'batch_modify_emails', {
        message_ids: tooMany,
        archive: true,
      });
      expectErrorResult(result);
      expect(getAllFetchCalls()).toHaveLength(0);
    });
  });

  // ─── CR-3 regression: buildEmailMessage extraHeaders must not leak ───────
  describe('buildEmailMessage regression (CR-3)', () => {
    it('send_email raw is unaffected by the reply extraHeaders change', async () => {
      mockFetchSuccess({ id: 'msg-1', threadId: 'thread-1' });

      await executor.executeAction(USER_ID, 'send_email', {
        recipients: { to: ['user@example.com'] },
        content: { subject: 'Plain Send', body: 'No threading headers here.' },
      });

      const sendCall = getAllFetchCalls().find((c) => c.url.includes('/messages/send'));
      expect(sendCall).toBeDefined();
      const mime = decodeRawMessage(bodyOf(sendCall).raw);
      // The non-reply send path must never emit threading headers.
      expect(mime).not.toContain('In-Reply-To');
      expect(mime).not.toContain('References');
      // Sanity: the normal headers are still present.
      expect(mime).toContain('To: user@example.com');
      expect(mime).toContain('Subject: Plain Send');
    });
  });
});
