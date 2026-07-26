/**
 * Unit tests for GoogleDocsPluginExecutor — 5 actions
 */

import { GoogleDocsPluginExecutor } from '@/lib/server/google-docs-plugin-executor';
import { createTestExecutor, expectSuccessResult, expectErrorResult, expectFetchCalledWith } from '../common/test-helpers';
import { mockFetchSuccess, mockFetchError, mockFetchSequence, restoreFetch, getLastFetchCall } from '../common/mock-fetch';
import { runStandardErrorScenarios } from '../common/error-scenarios';

const PLUGIN_KEY = 'google-docs';
const USER_ID = 'test-user-id';

describe('GoogleDocsPluginExecutor', () => {
  let executor: any;

  beforeAll(async () => {
    const ctx = await createTestExecutor(GoogleDocsPluginExecutor, PLUGIN_KEY);
    executor = ctx.executor;
  });

  afterEach(() => {
    restoreFetch();
  });

  describe('[smoke]', () => {
    // ---- read_document ----
    describe('read_document', () => {
      it('should extract text content from document structure', async () => {
        mockFetchSuccess({
          documentId: 'doc-1',
          title: 'My Document',
          body: {
            content: [
              {
                paragraph: {
                  elements: [{ textRun: { content: 'Hello World' } }],
                },
              },
            ],
          },
        });

        const result = await executor.executeAction(USER_ID, 'read_document', {
          document_id: 'doc-1',
        });

        expectSuccessResult(result);
        expect(result.data.title).toBe('My Document');
        expect(result.data.content).toContain('Hello World');
        expectFetchCalledWith('docs.googleapis.com/v1/documents/doc-1');
      });
    });

    // ---- insert_text ----
    describe('insert_text', () => {
      it('should call batchUpdate with insertText request', async () => {
        mockFetchSuccess({ documentId: 'doc-2' });

        const result = await executor.executeAction(USER_ID, 'insert_text', {
          document_id: 'doc-2',
          text: 'Inserted text',
          index: 1,
        });

        expectSuccessResult(result);
        expect(result.data.char_count).toBe(13); // 'Inserted text'.length
        expectFetchCalledWith('docs.googleapis.com/v1/documents/doc-2:batchUpdate', 'POST');
      });
    });

    // ---- append_text ----
    describe('append_text', () => {
      it('should get end index then insert text', async () => {
        mockFetchSequence([
          // Get document to find end index
          {
            body: {
              documentId: 'doc-3',
              title: 'Append Doc',
              body: {
                content: [{ paragraph: { elements: [{ textRun: { content: 'Existing' } }] }, endIndex: 10 }],
              },
            },
          },
          // batchUpdate to insert
          { body: { documentId: 'doc-3' } },
        ]);

        const result = await executor.executeAction(USER_ID, 'append_text', {
          document_id: 'doc-3',
          text: 'Appended content',
        });

        expectSuccessResult(result);
        expect(result.data.document_id).toBe('doc-3');
      });
    });

    // ---- create_document ----
    describe('create_document', () => {
      it('should create a new document and return metadata', async () => {
        mockFetchSuccess({
          documentId: 'new-doc-id',
          title: 'New Doc',
        });

        const result = await executor.executeAction(USER_ID, 'create_document', {
          title: 'New Doc',
        });

        expectSuccessResult(result);
        expect(result.data.document_id).toBe('new-doc-id');
        expect(result.data.document_url).toContain('new-doc-id');
        expectFetchCalledWith('docs.googleapis.com/v1/documents', 'POST');
      });
    });

    // ---- get_document_info ----
    describe('get_document_info', () => {
      it('should return document info with end index', async () => {
        mockFetchSuccess({
          documentId: 'doc-info-1',
          title: 'Info Doc',
          body: {
            content: [
              { paragraph: { elements: [{ textRun: { content: 'Content' } }] }, endIndex: 50 },
            ],
          },
        });

        const result = await executor.executeAction(USER_ID, 'get_document_info', {
          document_id: 'doc-info-1',
        });

        expectSuccessResult(result);
        expect(result.data.title).toBe('Info Doc');
        expect(result.data.end_index).toBe(50);
      });
    });

    // ---- replace_text ----
    describe('replace_text', () => {
      it('should call batchUpdate with a replaceAllText request and parse occurrences_changed', async () => {
        mockFetchSuccess({
          documentId: 'doc-1',
          replies: [{ replaceAllText: { occurrencesChanged: 3 } }],
        });

        const result = await executor.executeAction(USER_ID, 'replace_text', {
          document_id: 'doc-1',
          text_to_find: '{name}',
          replace_text: 'Alice',
        });

        expectSuccessResult(result);
        expect(result.data.occurrences_changed).toBe(3);
        expectFetchCalledWith('docs.googleapis.com/v1/documents/doc-1:batchUpdate', 'POST');

        // Request body must carry a replaceAllText request with the search string.
        const body = JSON.parse((getLastFetchCall()!.options!.body as string));
        expect(body.requests[0].replaceAllText.containsText.text).toBe('{name}');
        expect(body.requests[0].replaceAllText.replaceText).toBe('Alice');
      });
    });
  });

  describe('[full]', () => {
    // ---- read_document error ----
    describe('read_document', () => {
      it('should handle 400 error response', async () => {
        mockFetchError(400, JSON.stringify({
          error: { code: 400, message: 'Invalid document ID', status: 'INVALID_ARGUMENT' },
        }));

        const result = await executor.executeAction(USER_ID, 'read_document', {
          document_id: 'bad-id',
        });

        expectErrorResult(result);
      });
    });

    // ---- get_document_info error ----
    describe('get_document_info', () => {
      it('should handle 404 error', async () => {
        mockFetchError(404, 'Document not found');

        const result = await executor.executeAction(USER_ID, 'get_document_info', {
          document_id: 'nonexistent',
        });

        expectErrorResult(result);
      });
    });

    // ---- replace_text errors ----
    describe('replace_text', () => {
      it('should handle 401 auth failure', async () => {
        mockFetchError(401, { error: { code: 401, message: 'Invalid credentials' } });

        const result = await executor.executeAction(USER_ID, 'replace_text', {
          document_id: 'doc-1',
          text_to_find: 'foo',
          replace_text: 'bar',
        });

        expectErrorResult(result);
      });

      it('should reject empty text_to_find without issuing a fetch', async () => {
        // No fetch mock installed — the pre-fetch guard must reject before any network call.
        const result = await executor.executeAction(USER_ID, 'replace_text', {
          document_id: 'doc-1',
          text_to_find: '',
          replace_text: 'bar',
        });

        expectErrorResult(result);
        expect(getLastFetchCall()).toBeUndefined();
      });
    });

    // ---- P3-T2: Standard error scenarios ----
    runStandardErrorScenarios(
      () => executor,
      GoogleDocsPluginExecutor,
      PLUGIN_KEY,
      'read_document',
      { document_id: 'doc-1' }
    );

    // ---- P3-T3: Malformed response tests ----
    describe('malformed responses', () => {
      it('handles response missing body/content fields', async () => {
        mockFetchSuccess({ documentId: 'doc-1', title: 'Empty' });
        const result = await executor.executeAction(USER_ID, 'read_document', {
          document_id: 'doc-1',
        });
        expect(result).toBeDefined();
      });

      it('handles null response body', async () => {
        mockFetchSuccess(null);
        const result = await executor.executeAction(USER_ID, 'read_document', {
          document_id: 'doc-1',
        });
        expect(result).toBeDefined();
      });
    });

    // ---- P3-T4: Authentication edge cases ----
    describe('authentication edge cases', () => {
      it('handles empty access_token', async () => {
        const ctx = await createTestExecutor(GoogleDocsPluginExecutor, PLUGIN_KEY, {
          access_token: '',
        });
        mockFetchError(401, { error: { code: 401, message: 'Invalid credentials' } });
        const result = await ctx.executor.executeAction(USER_ID, 'read_document', {
          document_id: 'doc-1',
        });
        expectErrorResult(result);
      });
    });
  });
});
