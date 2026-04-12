/**
 * Integration tests for SlackPluginExecutor
 *
 * Tests real Slack API interactions: post message, verify, delete.
 * Skips gracefully when SLACK_TEST_TOKEN is not set.
 *
 * Requires env vars:
 * - SLACK_TEST_TOKEN: Slack Bot User OAuth Token (xoxb-...)
 * - SLACK_TEST_CHANNEL_ID: Channel ID to post test messages in
 *
 * IMPORTANT: These tests are idempotent -- all created messages are
 * cleaned up in afterAll/afterEach blocks.
 */

import { SlackPluginExecutor } from '@/lib/server/slack-plugin-executor';
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';
import { createTestPluginManager } from '../common/mock-plugin-manager';
import {
  describeIfCredentials,
  getTestConnection,
  getCredentials,
  generateTestId,
} from './integration-config';

const PLUGIN_KEY = 'slack';
const USER_ID = 'integration-test-user';

/**
 * Additional skip guard: we need both a token AND a channel ID.
 */
function canRunTests(): boolean {
  const creds = getCredentials(PLUGIN_KEY);
  return creds !== null && !!creds.extras.channelId;
}

const conditionalDescribe = canRunTests() ? describe : describe.skip;

conditionalDescribe('SlackPluginExecutor [integration]', () => {
  let executor: SlackPluginExecutor;
  let pluginManager: PluginManagerV2;
  let channelId: string;
  const cleanupTimestamps: string[] = [];

  beforeAll(async () => {
    pluginManager = await createTestPluginManager();
    const connection = getTestConnection(PLUGIN_KEY);
    const creds = getCredentials(PLUGIN_KEY)!;
    channelId = creds.extras.channelId;

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

    executor = new SlackPluginExecutor(userConnections, pluginManager);
  });

  afterAll(async () => {
    // Clean up any messages that were created during tests
    for (const ts of cleanupTimestamps) {
      try {
        await executor.executeAction(USER_ID, 'delete_message', {
          channel: channelId,
          message_ts: ts,
        });
      } catch {
        // Best-effort cleanup
      }
    }
  });

  describe('[smoke]', () => {
    it('should post a message to the test channel, then delete it', async () => {
      const testId = generateTestId();

      // Step 1: Post a message
      const postResult = await executor.executeAction(USER_ID, 'send_message', {
        channel: channelId,
        text: `AgentPilot integration test message. ID: ${testId}. Safe to delete.`,
      });

      expect(postResult.success).toBe(true);
      expect(postResult.data).toBeDefined();
      const messageTs = postResult.data?.ts || postResult.data?.message_ts;
      expect(messageTs).toBeDefined();

      // Track for cleanup
      if (messageTs) {
        cleanupTimestamps.push(messageTs);
      }

      // Step 2: Delete the message
      if (messageTs) {
        const deleteResult = await executor.executeAction(USER_ID, 'delete_message', {
          channel: channelId,
          message_ts: messageTs,
        });
        expect(deleteResult.success).toBe(true);

        // Remove from cleanup list
        const idx = cleanupTimestamps.indexOf(messageTs);
        if (idx >= 0) cleanupTimestamps.splice(idx, 1);
      }
    });
  });

  describe('[full]', () => {
    it('should list channels in the workspace', async () => {
      const result = await executor.executeAction(USER_ID, 'get_channels', {});

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('should read message history from the test channel', async () => {
      const result = await executor.executeAction(USER_ID, 'get_messages', {
        channel: channelId,
        limit: 5,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });
  });
});
