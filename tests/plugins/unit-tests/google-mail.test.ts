/**
 * Unit tests for GmailPluginExecutor — 4 actions
 *
 * Tests call executeAction() on the executor (full flow through base class)
 * to validate parameter validation, connection retrieval, action dispatch,
 * response parsing, and error mapping.
 */

import { GmailPluginExecutor } from '@/lib/server/gmail-plugin-executor';
import { createTestExecutor, expectSuccessResult, expectErrorResult, expectFetchCalledWith, expectAllFetchCallsAuthorized } from '../common/test-helpers';
import { mockFetchSuccess, mockFetchError, mockFetchSequence, restoreFetch, getAllFetchCalls } from '../common/mock-fetch';

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

    it('should handle error response', async () => {
      mockFetchError(500, 'Internal Server Error');

      const result = await executor.executeAction(USER_ID, 'create_draft', {
        recipients: { to: ['draft@example.com'] },
        content: { subject: 'Draft', body: 'Body' },
      });

      expectErrorResult(result);
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
});
