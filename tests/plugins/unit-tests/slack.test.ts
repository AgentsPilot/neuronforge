/**
 * Unit tests for SlackPluginExecutor — 11 actions
 */

import { SlackPluginExecutor } from '@/lib/server/slack-plugin-executor';
import { createTestExecutor, expectSuccessResult, expectErrorResult, expectFetchCalledWith, expectAllFetchCallsAuthorized } from '../common/test-helpers';
import { mockFetchSuccess, mockFetchError, mockFetchSequence, restoreFetch, getAllFetchCalls } from '../common/mock-fetch';

const PLUGIN_KEY = 'slack';
const USER_ID = 'test-user-id';

describe('SlackPluginExecutor', () => {
  let executor: any;

  beforeAll(async () => {
    const ctx = await createTestExecutor(SlackPluginExecutor, PLUGIN_KEY);
    executor = ctx.executor;
  });

  afterEach(() => {
    restoreFetch();
  });

  // ---- send_message ----
  describe('send_message', () => {
    it('should POST message to chat.postMessage', async () => {
      mockFetchSuccess({ ok: true, ts: '1234567890.123', channel: 'C123' });

      const result = await executor.executeAction(USER_ID, 'send_message', {
        channel_id: 'C123',
        message_text: 'Hello Slack!',
      });

      expectSuccessResult(result);
      expect(result.data.message_timestamp).toBe('1234567890.123');
      expect(result.data.channel_id).toBe('C123');
      expectFetchCalledWith('slack.com/api/chat.postMessage', 'POST');
      expectAllFetchCallsAuthorized();
    });

    it('should handle Slack API error response', async () => {
      mockFetchSuccess({ ok: false, error: 'channel_not_found' });

      const result = await executor.executeAction(USER_ID, 'send_message', {
        channel_id: 'C999',
        message_text: 'Hello',
      });

      expectErrorResult(result);
    });
  });

  // ---- read_messages ----
  describe('read_messages', () => {
    it('should fetch conversation history', async () => {
      mockFetchSuccess({
        ok: true,
        messages: [
          { ts: '111', user: 'U1', text: 'msg 1' },
          { ts: '222', user: 'U2', text: 'msg 2' },
        ],
        has_more: false,
      });

      const result = await executor.executeAction(USER_ID, 'read_messages', {
        channel_id: 'C123',
      });

      expectSuccessResult(result);
      expect(result.data.messages).toHaveLength(2);
      expect(result.data.message_count).toBe(2);
      expectFetchCalledWith('slack.com/api/conversations.history');
    });
  });

  // ---- update_message ----
  describe('update_message', () => {
    it('should call chat.update with new text', async () => {
      mockFetchSuccess({ ok: true, ts: '111', channel: 'C123', text: 'Updated!' });

      const result = await executor.executeAction(USER_ID, 'update_message', {
        channel_id: 'C123',
        message_timestamp: '111',
        new_message_text: 'Updated!',
      });

      expectSuccessResult(result);
      expect(result.data.text).toBe('Updated!');
      expectFetchCalledWith('slack.com/api/chat.update', 'POST');
    });
  });

  // ---- add_reaction ----
  describe('add_reaction', () => {
    it('should call reactions.add', async () => {
      mockFetchSuccess({ ok: true });

      const result = await executor.executeAction(USER_ID, 'add_reaction', {
        channel_id: 'C123',
        message_timestamp: '111',
        emoji_name: 'thumbsup',
      });

      expectSuccessResult(result);
      expect(result.data.emoji).toBe('thumbsup');
      expectFetchCalledWith('slack.com/api/reactions.add', 'POST');
    });
  });

  // ---- remove_reaction ----
  describe('remove_reaction', () => {
    it('should call reactions.remove', async () => {
      mockFetchSuccess({ ok: true });

      const result = await executor.executeAction(USER_ID, 'remove_reaction', {
        channel_id: 'C123',
        message_timestamp: '111',
        emoji_name: 'thumbsup',
      });

      expectSuccessResult(result);
      expectFetchCalledWith('slack.com/api/reactions.remove', 'POST');
    });
  });

  // ---- get_or_create_channel ----
  describe('get_or_create_channel', () => {
    it('should return existing channel when found', async () => {
      mockFetchSuccess({
        ok: true,
        channels: [{ id: 'C-EXISTING', name: 'general', is_private: false }],
      });

      const result = await executor.executeAction(USER_ID, 'get_or_create_channel', {
        channel_name: 'general',
      });

      expectSuccessResult(result);
      expect(result.data.channel_id).toBe('C-EXISTING');
      expect(result.data.created).toBe(false);
    });

    it('should create channel when not found', async () => {
      mockFetchSequence([
        // Search returns empty list
        { body: { ok: true, channels: [] } },
        // Create channel
        { body: { ok: true, channel: { id: 'C-NEW', name: 'new-channel', is_private: false } } },
      ]);

      const result = await executor.executeAction(USER_ID, 'get_or_create_channel', {
        channel_name: 'new-channel',
      });

      expectSuccessResult(result);
      expect(result.data.created).toBe(true);
    });
  });

  // ---- create_channel ----
  describe('create_channel', () => {
    it('should create a new channel', async () => {
      mockFetchSuccess({
        ok: true,
        channel: { id: 'C-CREATED', name: 'test-channel', is_private: false },
      });

      const result = await executor.executeAction(USER_ID, 'create_channel', {
        channel_name: 'test-channel',
      });

      expectSuccessResult(result);
      expect(result.data.channel_id).toBe('C-CREATED');
      expectFetchCalledWith('slack.com/api/conversations.create', 'POST');
    });
  });

  // ---- list_channels ----
  describe('list_channels', () => {
    it('should list channels', async () => {
      mockFetchSuccess({
        ok: true,
        channels: [
          { id: 'C1', name: 'general', is_private: false, is_archived: false, num_members: 50 },
          { id: 'C2', name: 'random', is_private: false, is_archived: false, num_members: 30 },
        ],
      });

      const result = await executor.executeAction(USER_ID, 'list_channels', {});

      expectSuccessResult(result);
      expect(result.data.channels).toHaveLength(2);
      expect(result.data.total_count).toBe(2);
    });
  });

  // ---- list_users ----
  describe('list_users', () => {
    it('should list workspace users', async () => {
      mockFetchSuccess({
        ok: true,
        members: [
          { id: 'U1', name: 'alice', real_name: 'Alice Smith', is_bot: false, is_admin: true, deleted: false, profile: { display_name: 'Alice', email: 'alice@co.com' } },
          { id: 'U2', name: 'bot', real_name: 'Bot User', is_bot: true, deleted: false, profile: {} },
        ],
      });

      const result = await executor.executeAction(USER_ID, 'list_users', {});

      expectSuccessResult(result);
      expect(result.data.users).toHaveLength(2);
      expect(result.data.users[0].real_name).toBe('Alice Smith');
    });
  });

  // ---- get_user_info ----
  describe('get_user_info', () => {
    it('should return user details', async () => {
      mockFetchSuccess({
        ok: true,
        user: {
          id: 'U1',
          name: 'alice',
          real_name: 'Alice Smith',
          is_bot: false,
          is_admin: true,
          is_owner: false,
          is_primary_owner: false,
          tz: 'US/Eastern',
          tz_label: 'Eastern Standard Time',
          profile: { display_name: 'Alice', email: 'alice@co.com', phone: '555-1234', title: 'Engineer', status_text: 'Working' },
        },
      });

      const result = await executor.executeAction(USER_ID, 'get_user_info', {
        user_id: 'U1',
      });

      expectSuccessResult(result);
      expect(result.data.real_name).toBe('Alice Smith');
      expect(result.data.email).toBe('alice@co.com');
      expectFetchCalledWith('slack.com/api/users.info');
    });
  });

  // ---- upload_file ----
  describe('upload_file', () => {
    it('should follow 3-step upload workflow', async () => {
      mockFetchSequence([
        // Step 1: Get upload URL
        { body: { ok: true, upload_url: 'https://files.slack.com/upload/v1/abc', file_id: 'F-NEW' } },
        // Step 2: Upload to URL
        { body: 'OK' },
        // Step 3: Complete upload
        { body: { ok: true, files: [{ id: 'F-NEW', name: 'test.txt', title: 'test.txt', permalink: 'https://slack.com/files/F-NEW' }] } },
      ]);

      const result = await executor.executeAction(USER_ID, 'upload_file', {
        filename: 'test.txt',
        file_content: Buffer.from('file data').toString('base64'),
        channel_ids: ['C123'],
      });

      expectSuccessResult(result);
      expect(result.data.file_id).toBe('F-NEW');
      expect(getAllFetchCalls()).toHaveLength(3);
    });
  });
});
