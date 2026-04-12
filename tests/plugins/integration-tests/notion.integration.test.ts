/**
 * Integration tests for NotionPluginExecutor
 *
 * Tests real Notion API interactions: search workspace, create page, delete.
 * Skips gracefully when NOTION_TEST_TOKEN is not set.
 *
 * Requires env vars:
 * - NOTION_TEST_TOKEN: Notion internal integration token
 * - NOTION_TEST_PARENT_PAGE_ID: (optional) Parent page ID for creating test pages
 *
 * IMPORTANT: These tests are idempotent -- all created pages are
 * archived (soft-deleted) in afterAll/afterEach blocks.
 */

import { NotionPluginExecutor } from '@/lib/server/notion-plugin-executor';
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';
import { createTestPluginManager } from '../common/mock-plugin-manager';
import {
  describeIfCredentials,
  getTestConnection,
  getCredentials,
  generateTestId,
} from './integration-config';

const PLUGIN_KEY = 'notion';
const USER_ID = 'integration-test-user';

const conditionalDescribe = describeIfCredentials(PLUGIN_KEY);

conditionalDescribe('NotionPluginExecutor [integration]', () => {
  let executor: NotionPluginExecutor;
  let pluginManager: PluginManagerV2;
  const cleanupPageIds: string[] = [];

  beforeAll(async () => {
    pluginManager = await createTestPluginManager();
    const connection = getTestConnection(PLUGIN_KEY);

    const userConnections = {
      getConnection: jest.fn().mockResolvedValue(connection),
      getConnectionStatus: jest.fn().mockResolvedValue({ connected: true, reason: 'connected' }),
      getConnectedPlugins: jest.fn().mockResolvedValue(connection ? [connection] : []),
      getConnectedPluginKeys: jest.fn().mockResolvedValue([PLUGIN_KEY]),
      getAllActivePlugins: jest.fn().mockResolvedValue(connection ? [connection] : []),
      getDisconnectedPluginKeys: jest.fn().mockResolvedValue([]),
      isTokenValid: jest.fn().mockReturnValue(true),
      shouldRefreshToken: jest.fn().mockReturnValue(false),
      refreshToken: jest.fn().mockResolvedValue(connection),
    } as any;

    executor = new NotionPluginExecutor(userConnections, pluginManager);
  });

  afterAll(async () => {
    // Archive (soft-delete) any pages created during tests.
    // Notion does not have a hard delete API -- archiving is the standard cleanup.
    for (const pageId of cleanupPageIds) {
      try {
        await executor.executeAction(USER_ID, 'update_page', {
          page_id: pageId,
          properties: {},
          archived: true,
        });
      } catch {
        // Best-effort cleanup
      }
    }
  });

  describe('[smoke]', () => {
    it('should search the workspace', async () => {
      const result = await executor.executeAction(USER_ID, 'search', {
        query: 'agentpilot-integration-test-nonexistent',
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });
  });

  describe('[full]', () => {
    it('should create a test page and then archive it', async () => {
      const creds = getCredentials(PLUGIN_KEY);
      const parentPageId = creds?.extras.parentPageId;

      // Skip this specific test if no parent page ID is configured
      if (!parentPageId) {
        console.log('Skipping page creation test: NOTION_TEST_PARENT_PAGE_ID not set');
        return;
      }

      const testId = generateTestId();

      // Step 1: Create a page
      const createResult = await executor.executeAction(USER_ID, 'create_page', {
        parent_page_id: parentPageId,
        title: `AgentPilot Integration Test ${testId}`,
        content: `This is an automated integration test page. ID: ${testId}. Safe to delete.`,
      });

      expect(createResult.success).toBe(true);
      expect(createResult.data).toBeDefined();
      const pageId = createResult.data?.page_id || createResult.data?.id;
      expect(pageId).toBeDefined();

      if (pageId) {
        cleanupPageIds.push(pageId);
      }

      // Step 2: Archive the page (cleanup)
      if (pageId) {
        const archiveResult = await executor.executeAction(USER_ID, 'update_page', {
          page_id: pageId,
          properties: {},
          archived: true,
        });
        expect(archiveResult.success).toBe(true);

        // Remove from cleanup list since we already archived it
        const idx = cleanupPageIds.indexOf(pageId);
        if (idx >= 0) cleanupPageIds.splice(idx, 1);
      }
    });
  });
});
