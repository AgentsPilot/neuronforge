/**
 * Unit tests for NotionPluginExecutor -- 8 actions
 *
 * Actions: search, get_page, get_page_content, create_page,
 *          update_page, query_database, get_database, append_block_children
 */

import { NotionPluginExecutor } from '@/lib/server/notion-plugin-executor';
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
  restoreFetch,
} from '../common/mock-fetch';
import { runStandardErrorScenarios } from '../common/error-scenarios';

const PLUGIN_KEY = 'notion';
const USER_ID = 'test-user-id';

describe('NotionPluginExecutor', () => {
  let executor: any;

  beforeAll(async () => {
    const ctx = await createTestExecutor(NotionPluginExecutor, PLUGIN_KEY);
    executor = ctx.executor;
  });

  afterEach(() => {
    restoreFetch();
  });

  describe('[smoke]', () => {
    describe('search', () => {
      it('should search the Notion workspace and return simplified results', async () => {
        mockFetchSuccess({
          results: [
            {
              id: 'page-1',
              object: 'page',
              created_time: '2026-01-01T00:00:00Z',
              last_edited_time: '2026-01-02T00:00:00Z',
              url: 'https://notion.so/page-1',
              properties: {
                Name: { type: 'title', title: [{ plain_text: 'My Page' }] },
              },
            },
          ],
          has_more: false,
          next_cursor: null,
        });

        const result = await executor.executeAction(USER_ID, 'search', {
          query: 'My Page',
        });

        expectSuccessResult(result);
        expect(result.data.results).toHaveLength(1);
        expect(result.data.results[0].title).toBe('My Page');
        expect(result.data.result_count).toBe(1);
        expectFetchCalledWith('api.notion.com/v1/search', 'POST');
        expectAllFetchCallsAuthorized();
      });
    });

    describe('get_page', () => {
      it('should return page details', async () => {
        mockFetchSuccess({
          id: 'page-1',
          created_time: '2026-01-01T00:00:00Z',
          last_edited_time: '2026-01-02T00:00:00Z',
          properties: { Name: { type: 'title', title: [] } },
          url: 'https://notion.so/page-1',
          parent: { type: 'workspace', workspace: true },
        });

        const result = await executor.executeAction(USER_ID, 'get_page', {
          page_id: 'page-1',
        });

        expectSuccessResult(result);
        expect(result.data.id).toBe('page-1');
        expect(result.data.url).toContain('notion.so');
        expectFetchCalledWith('api.notion.com/v1/pages/page-1');
      });
    });

    describe('get_page_content', () => {
      it('should return blocks and extracted text content', async () => {
        mockFetchSuccess({
          results: [
            {
              type: 'paragraph',
              paragraph: {
                rich_text: [{ plain_text: 'Hello world' }],
              },
            },
            {
              type: 'heading_1',
              heading_1: {
                rich_text: [{ plain_text: 'Section Title' }],
              },
            },
          ],
          has_more: false,
        });

        const result = await executor.executeAction(USER_ID, 'get_page_content', {
          page_id: 'page-1',
        });

        expectSuccessResult(result);
        expect(result.data.block_count).toBe(2);
        expect(result.data.text_content).toContain('Hello world');
        expect(result.data.text_content).toContain('Section Title');
        expectFetchCalledWith('api.notion.com/v1/blocks/page-1/children');
      });
    });

    describe('create_page', () => {
      it('should create a new page', async () => {
        mockFetchSuccess({
          id: 'new-page-1',
          url: 'https://notion.so/new-page-1',
          created_time: '2026-04-12T00:00:00Z',
          properties: {},
        });

        const result = await executor.executeAction(USER_ID, 'create_page', {
          parent: { database_id: 'db-1' },
          properties: {
            Name: { title: [{ text: { content: 'New Page' } }] },
          },
        });

        expectSuccessResult(result);
        expect(result.data.id).toBe('new-page-1');
        expectFetchCalledWith('api.notion.com/v1/pages', 'POST');
      });
    });

    describe('update_page', () => {
      it('should update page properties', async () => {
        mockFetchSuccess({
          id: 'page-1',
          last_edited_time: '2026-04-12T01:00:00Z',
          properties: { Status: { select: { name: 'Done' } } },
        });

        const result = await executor.executeAction(USER_ID, 'update_page', {
          page_id: 'page-1',
          properties: { Status: { select: { name: 'Done' } } },
        });

        expectSuccessResult(result);
        expect(result.data.id).toBe('page-1');
        expectFetchCalledWith('api.notion.com/v1/pages/page-1', 'PATCH');
      });
    });

    describe('query_database', () => {
      it('should query a database with filters', async () => {
        mockFetchSuccess({
          results: [
            { id: 'row-1', properties: {} },
            { id: 'row-2', properties: {} },
          ],
          has_more: false,
          next_cursor: null,
        });

        const result = await executor.executeAction(USER_ID, 'query_database', {
          database_id: 'db-1',
          filter: { property: 'Status', select: { equals: 'Active' } },
        });

        expectSuccessResult(result);
        expect(result.data.results).toHaveLength(2);
        expect(result.data.result_count).toBe(2);
        expectFetchCalledWith('api.notion.com/v1/databases/db-1/query', 'POST');
      });
    });

    describe('get_database', () => {
      it('should return database schema', async () => {
        mockFetchSuccess({
          id: 'db-1',
          title: [{ plain_text: 'Projects' }],
          properties: { Name: { type: 'title' } },
          created_time: '2026-01-01T00:00:00Z',
          url: 'https://notion.so/db-1',
        });

        const result = await executor.executeAction(USER_ID, 'get_database', {
          database_id: 'db-1',
        });

        expectSuccessResult(result);
        expect(result.data.id).toBe('db-1');
        expectFetchCalledWith('api.notion.com/v1/databases/db-1');
      });
    });

    describe('append_block_children', () => {
      it('should append blocks to a page', async () => {
        mockFetchSuccess({
          results: [
            { id: 'block-new-1', type: 'paragraph' },
          ],
        });

        const result = await executor.executeAction(USER_ID, 'append_block_children', {
          block_id: 'page-1',
          children: [
            {
              object: 'block',
              type: 'paragraph',
              paragraph: {
                rich_text: [{ type: 'text', text: { content: 'Appended text' } }],
              },
            },
          ],
        });

        expectSuccessResult(result);
        expect(result.data.block_count).toBe(1);
        expectFetchCalledWith('api.notion.com/v1/blocks/page-1/children', 'PATCH');
      });
    });
  });

  describe('[full]', () => {
    describe('search', () => {
      it('should handle empty results', async () => {
        mockFetchSuccess({
          results: [],
          has_more: false,
          next_cursor: null,
        });

        const result = await executor.executeAction(USER_ID, 'search', {
          query: 'nonexistent',
        });

        expectSuccessResult(result);
        expect(result.data.results).toHaveLength(0);
        expect(result.data.result_count).toBe(0);
      });
    });

    describe('get_page', () => {
      it('should handle 404 page not found', async () => {
        mockFetchError(404, JSON.stringify({
          object: 'error',
          code: 'object_not_found',
          message: 'Could not find page with ID: bad-id',
        }));

        const result = await executor.executeAction(USER_ID, 'get_page', {
          page_id: 'bad-id',
        });

        expectErrorResult(result);
      });
    });

    describe('create_page', () => {
      it('should handle validation error', async () => {
        mockFetchError(400, JSON.stringify({
          object: 'error',
          code: 'validation_error',
          message: 'Invalid property format',
        }));

        const result = await executor.executeAction(USER_ID, 'create_page', {
          parent: { database_id: 'db-1' },
          properties: {},
        });

        expectErrorResult(result);
      });
    });

    describe('update_page', () => {
      it('should handle 401 unauthorized', async () => {
        mockFetchError(401, JSON.stringify({
          object: 'error',
          code: 'unauthorized',
          message: 'API token is invalid',
        }));

        const result = await executor.executeAction(USER_ID, 'update_page', {
          page_id: 'page-1',
          properties: {},
        });

        expectErrorResult(result);
      });
    });

    describe('query_database', () => {
      it('should handle 429 rate limit', async () => {
        mockFetchError(429, JSON.stringify({
          object: 'error',
          code: 'rate_limited',
          message: 'Rate limited',
        }));

        const result = await executor.executeAction(USER_ID, 'query_database', {
          database_id: 'db-1',
        });

        expectErrorResult(result);
      });
    });

    describe('get_page_content', () => {
      it('should handle empty blocks', async () => {
        mockFetchSuccess({
          results: [],
          has_more: false,
        });

        const result = await executor.executeAction(USER_ID, 'get_page_content', {
          page_id: 'empty-page',
        });

        expectSuccessResult(result);
        expect(result.data.block_count).toBe(0);
        expect(result.data.text_content).toBe('');
      });
    });

    describe('append_block_children', () => {
      it('should handle 403 restricted resource', async () => {
        mockFetchError(403, JSON.stringify({
          object: 'error',
          code: 'restricted_resource',
          message: 'Insufficient permissions for this resource',
        }));

        const result = await executor.executeAction(USER_ID, 'append_block_children', {
          block_id: 'page-restricted',
          children: [],
        });

        expectErrorResult(result);
      });
    });

    // ---- P3-T2: Standard error scenarios ----
    runStandardErrorScenarios(
      () => executor,
      NotionPluginExecutor,
      PLUGIN_KEY,
      'search',
      { query: 'test' }
    );

    // ---- P3-T3: Malformed response tests ----
    describe('malformed responses', () => {
      it('handles response missing results field', async () => {
        mockFetchSuccess({});
        const result = await executor.executeAction(USER_ID, 'search', {
          query: 'test',
        });
        expect(result).toBeDefined();
      });

      it('handles null response body', async () => {
        mockFetchSuccess(null);
        const result = await executor.executeAction(USER_ID, 'search', {
          query: 'test',
        });
        expect(result).toBeDefined();
      });
    });

    // ---- P3-T4: Authentication edge cases ----
    describe('authentication edge cases', () => {
      it('handles empty access_token', async () => {
        const ctx = await createTestExecutor(NotionPluginExecutor, PLUGIN_KEY, {
          access_token: '',
        });
        mockFetchError(401, { object: 'error', code: 'unauthorized', message: 'API token is invalid' });
        const result = await ctx.executor.executeAction(USER_ID, 'search', {
          query: 'test',
        });
        expectErrorResult(result);
      });
    });

    // ---- P3-T5: Pagination edge cases ----
    describe('pagination edge cases', () => {
      it('handles empty query_database results', async () => {
        mockFetchSuccess({ results: [], has_more: false, next_cursor: null });
        const result = await executor.executeAction(USER_ID, 'query_database', {
          database_id: 'db-1',
        });
        expectSuccessResult(result);
        expect(result.data.result_count).toBe(0);
      });
    });
  });
});
