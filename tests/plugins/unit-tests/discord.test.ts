/**
 * Unit tests for DiscordPluginExecutor -- 6 actions
 *
 * Actions: send_message, get_channels, list_guilds, get_messages,
 *          create_channel, delete_message
 */

import { DiscordPluginExecutor } from '@/lib/server/discord-plugin-executor';
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

const PLUGIN_KEY = 'discord';
const USER_ID = 'test-user-id';

describe('DiscordPluginExecutor', () => {
  let executor: any;

  beforeAll(async () => {
    const ctx = await createTestExecutor(DiscordPluginExecutor, PLUGIN_KEY);
    executor = ctx.executor;
  });

  afterEach(() => {
    restoreFetch();
  });

  describe('[smoke]', () => {
    describe('send_message', () => {
      it('should POST message to the correct channel endpoint', async () => {
        mockFetchSuccess({
          id: 'msg-1',
          channel_id: 'ch-100',
          content: 'Hello Discord!',
          timestamp: '2026-04-12T00:00:00Z',
        });

        const result = await executor.executeAction(USER_ID, 'send_message', {
          channel_id: 'ch-100',
          content: 'Hello Discord!',
        });

        expectSuccessResult(result);
        expect(result.data.id).toBe('msg-1');
        expect(result.data.channel_id).toBe('ch-100');
        expectFetchCalledWith('discord.com/api/v10/channels/ch-100/messages', 'POST');
        expectAllFetchCallsAuthorized();
      });
    });

    describe('get_channels', () => {
      it('should return channels for a guild', async () => {
        mockFetchSuccess([
          { id: 'ch-1', name: 'general', type: 0 },
          { id: 'ch-2', name: 'random', type: 0 },
        ]);

        const result = await executor.executeAction(USER_ID, 'get_channels', {
          guild_id: 'guild-1',
        });

        expectSuccessResult(result);
        expect(result.data.channels).toHaveLength(2);
        expect(result.data.channels[0].name).toBe('general');
        expectFetchCalledWith('discord.com/api/v10/guilds/guild-1/channels', 'GET');
      });
    });

    describe('list_guilds', () => {
      it('should return guilds for the current user', async () => {
        mockFetchSuccess([
          { id: 'g-1', name: 'My Server', icon: 'icon-hash' },
        ]);

        const result = await executor.executeAction(USER_ID, 'list_guilds', {});

        expectSuccessResult(result);
        expect(result.data.guilds).toHaveLength(1);
        expect(result.data.guilds[0].name).toBe('My Server');
        expectFetchCalledWith('discord.com/api/v10/users/@me/guilds', 'GET');
      });
    });

    describe('get_messages', () => {
      it('should return messages from a channel', async () => {
        mockFetchSuccess([
          {
            id: 'msg-1',
            content: 'Hello',
            author: { id: 'u-1', username: 'alice' },
            timestamp: '2026-04-12T00:00:00Z',
          },
        ]);

        const result = await executor.executeAction(USER_ID, 'get_messages', {
          channel_id: 'ch-1',
          limit: 10,
        });

        expectSuccessResult(result);
        expect(result.data.messages).toHaveLength(1);
        expect(result.data.messages[0].author.username).toBe('alice');
        expectFetchCalledWith('discord.com/api/v10/channels/ch-1/messages', 'GET');
      });
    });

    describe('create_channel', () => {
      it('should create a channel in a guild', async () => {
        mockFetchSuccess({
          id: 'ch-new',
          name: 'test-channel',
          type: 0,
        });

        const result = await executor.executeAction(USER_ID, 'create_channel', {
          guild_id: 'guild-1',
          name: 'test-channel',
        });

        expectSuccessResult(result);
        expect(result.data.id).toBe('ch-new');
        expect(result.data.name).toBe('test-channel');
        expectFetchCalledWith('discord.com/api/v10/guilds/guild-1/channels', 'POST');
      });
    });

    describe('delete_message', () => {
      it('should delete a message and return 204', async () => {
        // Discord DELETE returns 204 No Content
        mockFetchSuccess({}, 204);

        const result = await executor.executeAction(USER_ID, 'delete_message', {
          channel_id: 'ch-1',
          message_id: 'msg-1',
        });

        expectSuccessResult(result);
        expect(result.data.success).toBe(true);
        expectFetchCalledWith('discord.com/api/v10/channels/ch-1/messages/msg-1', 'DELETE');
      });
    });
  });

  describe('[full]', () => {
    describe('send_message', () => {
      it('should handle Discord API error', async () => {
        mockFetchError(403, 'Missing Permissions');

        const result = await executor.executeAction(USER_ID, 'send_message', {
          channel_id: 'ch-1',
          content: 'Hello',
        });

        expectErrorResult(result);
      });

      it('should include embed when provided', async () => {
        mockFetchSuccess({
          id: 'msg-2',
          channel_id: 'ch-1',
          content: 'With embed',
          timestamp: '2026-04-12T00:00:00Z',
        });

        const result = await executor.executeAction(USER_ID, 'send_message', {
          channel_id: 'ch-1',
          content: 'With embed',
          embed: { title: 'Embed Title', description: 'Embed desc' },
        });

        expectSuccessResult(result);
      });
    });

    describe('get_channels', () => {
      it('should handle API error for invalid guild', async () => {
        mockFetchError(404, 'Unknown Guild');

        const result = await executor.executeAction(USER_ID, 'get_channels', {
          guild_id: 'invalid-guild',
        });

        expectErrorResult(result);
      });
    });

    describe('get_messages', () => {
      it('should handle 401 unauthorized error', async () => {
        mockFetchError(401, 'Unauthorized');

        const result = await executor.executeAction(USER_ID, 'get_messages', {
          channel_id: 'ch-1',
        });

        expectErrorResult(result);
      });
    });

    describe('delete_message', () => {
      it('should handle 404 not found error', async () => {
        mockFetchError(404, 'Unknown Message');

        const result = await executor.executeAction(USER_ID, 'delete_message', {
          channel_id: 'ch-1',
          message_id: 'msg-nonexistent',
        });

        expectErrorResult(result);
      });
    });

    // ---- P3-T2: Standard error scenarios ----
    runStandardErrorScenarios(
      () => executor,
      DiscordPluginExecutor,
      PLUGIN_KEY,
      'send_message',
      { channel_id: 'ch-1', content: 'Hello' }
    );

    // ---- P3-T3: Malformed response tests ----
    describe('malformed responses', () => {
      it('handles response missing expected fields', async () => {
        mockFetchSuccess({}); // Missing id, channel_id, content
        const result = await executor.executeAction(USER_ID, 'send_message', {
          channel_id: 'ch-1',
          content: 'Hello',
        });
        expect(result).toBeDefined();
      });

      it('handles null response body', async () => {
        mockFetchSuccess(null);
        const result = await executor.executeAction(USER_ID, 'send_message', {
          channel_id: 'ch-1',
          content: 'Hello',
        });
        expect(result).toBeDefined();
      });
    });

    // ---- P3-T4: Authentication edge cases ----
    describe('authentication edge cases', () => {
      it('handles empty access_token', async () => {
        const ctx = await createTestExecutor(DiscordPluginExecutor, PLUGIN_KEY, {
          access_token: '',
        });
        mockFetchError(401, { code: 0, message: '401: Unauthorized' });
        const result = await ctx.executor.executeAction(USER_ID, 'send_message', {
          channel_id: 'ch-1',
          content: 'Hello',
        });
        expectErrorResult(result);
      });
    });
  });
});
