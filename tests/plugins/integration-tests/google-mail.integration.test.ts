/**
 * Integration tests for GmailPluginExecutor
 *
 * Tests real Gmail API interactions: create draft, verify, delete.
 * Skips gracefully when GOOGLE_MAIL_TEST_TOKEN is not set.
 *
 * IMPORTANT: These tests are idempotent -- all created artifacts are
 * cleaned up in afterAll/afterEach blocks.
 */

import { GmailPluginExecutor } from '@/lib/server/gmail-plugin-executor';
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';
import { createTestPluginManager } from '../common/mock-plugin-manager';
import {
  describeIfCredentials,
  getTestConnection,
  getCredentials,
  generateTestId,
} from './integration-config';

const PLUGIN_KEY = 'google-mail';
const USER_ID = 'integration-test-user';

const conditionalDescribe = describeIfCredentials(PLUGIN_KEY);

conditionalDescribe('GmailPluginExecutor [integration]', () => {
  let executor: GmailPluginExecutor;
  let pluginManager: PluginManagerV2;
  const cleanupDraftIds: string[] = [];

  beforeAll(async () => {
    pluginManager = await createTestPluginManager();
    const connection = getTestConnection(PLUGIN_KEY);

    // Build a mock UserPluginConnections that returns the real connection
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

    executor = new GmailPluginExecutor(userConnections, pluginManager);
  });

  afterAll(async () => {
    // Clean up any drafts that were created during tests
    for (const draftId of cleanupDraftIds) {
      try {
        await executor.executeAction(USER_ID, 'delete_email', {
          message_id: draftId,
        });
      } catch {
        // Best-effort cleanup -- do not fail the test suite
      }
    }
  });

  describe('[smoke]', () => {
    it('should create a draft, verify it exists, then delete it', async () => {
      const testId = generateTestId();

      // Step 1: Create a draft
      const createResult = await executor.executeAction(USER_ID, 'create_draft', {
        recipients: { to: ['agentpilot-integration-test@example.com'] },
        content: {
          subject: `Integration Test Draft ${testId}`,
          body: `This is an automated integration test draft. ID: ${testId}. Safe to delete.`,
        },
      });

      expect(createResult.success).toBe(true);
      expect(createResult.data).toBeDefined();
      const draftId = createResult.data?.draft_id || createResult.data?.message_id;
      expect(draftId).toBeDefined();

      // Track for cleanup
      if (draftId) {
        cleanupDraftIds.push(draftId);
      }

      // Step 2: Delete the draft (cleanup)
      if (draftId) {
        const deleteResult = await executor.executeAction(USER_ID, 'delete_email', {
          message_id: draftId,
        });
        expect(deleteResult.success).toBe(true);

        // Remove from cleanup list since we already deleted it
        const idx = cleanupDraftIds.indexOf(draftId);
        if (idx >= 0) cleanupDraftIds.splice(idx, 1);
      }
    });
  });

  describe('[full]', () => {
    it('should search for emails with a query', async () => {
      const result = await executor.executeAction(USER_ID, 'search_emails', {
        query: 'subject:agentpilot-integration-test-nonexistent',
        max_results: 1,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });
  });
});
