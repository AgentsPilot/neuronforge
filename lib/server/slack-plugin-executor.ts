// lib/server/slack-plugin-executor.ts

import { UserPluginConnections } from './user-plugin-connections';
import { PluginManagerV2 } from './plugin-manager-v2';
import { ExecutionResult } from '@/lib/types/plugin-types';
import { BasePluginExecutor } from './base-plugin-executor';

const pluginName = 'slack';

export class SlackPluginExecutor extends BasePluginExecutor {
  constructor(userConnections: UserPluginConnections, pluginManager: PluginManagerV2) {
    super(pluginName, userConnections, pluginManager);
  }

  // Execute Slack action with validation and error handling
  protected async executeSpecificAction(
    connection: any,
    actionName: string,
    parameters: any
  ): Promise<any> {
    // Execute the specific action
    let result: any;
    switch (actionName) {
      case 'send_message':
        result = await this.sendMessage(connection, parameters);
        break;
      case 'read_messages':
        result = await this.readMessages(connection, parameters);
        break;
      case 'update_message':
        result = await this.updateMessage(connection, parameters);
        break;
      case 'add_reaction':
        result = await this.addReaction(connection, parameters);
        break;
      case 'remove_reaction':
        result = await this.removeReaction(connection, parameters);
        break;
      case 'create_channel':
        result = await this.createChannel(connection, parameters);
        break;
      case 'list_channels':
        result = await this.listChannels(connection, parameters);
        break;
      case 'list_users':
        result = await this.listUsers(connection, parameters);
        break;
      case 'get_user_info':
        result = await this.getUserInfo(connection, parameters);
        break;
      case 'upload_file':
        result = await this.uploadFile(connection, parameters);
        break;
      default:
        return {
          success: false,
          error: 'Unknown action',
          message: `Action ${actionName} not supported`
        };
    }

    return result;
  }

  // Send a message to a channel, DM, or thread
  private async sendMessage(connection: any, parameters: any): Promise<any> {
    this.logger.debug('Sending Slack message');

    let { channel_id, message_text, thread_timestamp, as_user } = parameters;

    // If channel_id starts with # or is a name, try to resolve it to an ID
    if (channel_id && (channel_id.startsWith('#') || !channel_id.startsWith('C') && !channel_id.startsWith('D'))) {
      const channelName = channel_id.replace('#', '');
      this.logger.debug(`Resolving channel name "${channelName}" to ID...`);

      try {
        const resolvedId = await this.resolveChannelNameToId(connection, channelName);
        if (resolvedId) {
          this.logger.debug(`Resolved "${channelName}" to "${resolvedId}"`);
          channel_id = resolvedId;
        }
      } catch (error) {
        this.logger.warn({ err: error }, `Could not resolve channel name "${channelName}"`);
        // Continue with original channel_id and let Slack API handle the error
      }
    }

    const requestBody: any = {
      channel: channel_id,
      text: message_text,
      as_user: as_user !== undefined ? as_user : true
    };

    if (thread_timestamp) {
      requestBody.thread_ts = thread_timestamp;
    }

    // Try to send the message
    let response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    let responseData = await response.json();

    // If bot is not in channel, try to join it first
    if (!responseData.ok && responseData.error === 'not_in_channel') {
      this.logger.debug('Bot not in channel, attempting to join...');

      try {
        // Try to join the channel
        const joinResponse = await fetch('https://slack.com/api/conversations.join', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${connection.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ channel: channel_id })
        });

        const joinData = await joinResponse.json();

        if (joinData.ok) {
          this.logger.debug('Successfully joined channel, retrying message send...');

          // Retry sending the message
          response = await fetch('https://slack.com/api/chat.postMessage', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${connection.access_token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody)
          });

          responseData = await response.json();
        } else {
          this.logger.debug({ data: joinData.error }, 'Failed to join channel:');
        }
      } catch (joinError) {
        this.logger.error({ err: joinError }, 'Error joining channel:');
        // Continue to error handling below
      }
    }

    // Handle the final response
    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error({ err: errorText }, 'send_message HTTP failed:');
      throw new Error(`Slack API HTTP error: ${response.status} - ${errorText}`);
    }

    if (!responseData.ok) {
      const errorMsg = responseData.error || 'Unknown Slack error';
      this.logger.error({ err: errorMsg }, 'send_message Slack error:');
      throw new Error(`Slack API error: ${errorMsg}`);
    }

    return {
      message_timestamp: responseData.ts,
      channel_id: responseData.channel,
      success: true,
      message_text: message_text,
      is_threaded: !!thread_timestamp
    };
  }

  // Read message history from a channel or DM
  private async readMessages(connection: any, parameters: any): Promise<any> {
    this.logger.debug('Reading Slack messages');

    const { channel_id, limit, oldest_timestamp, latest_timestamp, include_all_metadata } = parameters;

    const url = new URL('https://slack.com/api/conversations.history');
    url.searchParams.set('channel', channel_id);
    url.searchParams.set('limit', (limit || 15).toString());

    if (oldest_timestamp) {
      url.searchParams.set('oldest', oldest_timestamp);
    }

    if (latest_timestamp) {
      url.searchParams.set('latest', latest_timestamp);
    }

    if (include_all_metadata) {
      url.searchParams.set('inclusive', 'true');
    }

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
      },
    });

    const data = await this.handleSlackResponse(response, 'read_messages');

    // Format messages
    const messages = (data.messages || []).map((msg: any) => ({
      timestamp: msg.ts,
      user: msg.user,
      text: msg.text,
      thread_timestamp: msg.thread_ts,
      reply_count: msg.reply_count || 0,
      reactions: include_all_metadata ? msg.reactions : undefined,
      attachments: include_all_metadata ? msg.attachments : undefined,
      is_thread_parent: !!msg.thread_ts && msg.reply_count > 0
    }));

    return {
      messages: messages,
      message_count: messages.length,
      has_more: data.has_more || false,
      channel_id: channel_id
    };
  }

  // Update/edit a previously sent message
  private async updateMessage(connection: any, parameters: any): Promise<any> {
    this.logger.debug('Updating Slack message');

    const { channel_id, message_timestamp, new_message_text } = parameters;

    const requestBody = {
      channel: channel_id,
      ts: message_timestamp,
      text: new_message_text
    };

    const response = await fetch('https://slack.com/api/chat.update', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    const data = await this.handleSlackResponse(response, 'update_message');

    return {
      message_timestamp: data.ts,
      channel_id: data.channel,
      text: data.text,
      success: true,
      updated_at: new Date().toISOString()
    };
  }

  // Add emoji reaction to a message
  private async addReaction(connection: any, parameters: any): Promise<any> {
    this.logger.debug('Adding Slack reaction');

    const { channel_id, message_timestamp, emoji_name } = parameters;

    const requestBody = {
      channel: channel_id,
      timestamp: message_timestamp,
      name: emoji_name
    };

    const response = await fetch('https://slack.com/api/reactions.add', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    const data = await this.handleSlackResponse(response, 'add_reaction');

    return {
      success: true,
      emoji: emoji_name,
      message_timestamp: message_timestamp,
      channel_id: channel_id
    };
  }

  // Remove emoji reaction from a message
  private async removeReaction(connection: any, parameters: any): Promise<any> {
    this.logger.debug('Removing Slack reaction');

    const { channel_id, message_timestamp, emoji_name } = parameters;

    const requestBody = {
      channel: channel_id,
      timestamp: message_timestamp,
      name: emoji_name
    };

    const response = await fetch('https://slack.com/api/reactions.remove', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    const data = await this.handleSlackResponse(response, 'remove_reaction');

    return {
      success: true,
      emoji: emoji_name,
      message_timestamp: message_timestamp,
      channel_id: channel_id
    };
  }

  // Create a new public or private channel
  private async createChannel(connection: any, parameters: any): Promise<any> {
    this.logger.debug('Creating Slack channel');

    const { channel_name, is_private, description } = parameters;

    const requestBody: any = {
      name: channel_name,
      is_private: is_private || false
    };

    const response = await fetch('https://slack.com/api/conversations.create', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    const data = await this.handleSlackResponse(response, 'create_channel');

    const channelId = data.channel.id;

    // Set channel description/topic if provided
    if (description) {
      try {
        await fetch('https://slack.com/api/conversations.setTopic', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${connection.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            channel: channelId,
            topic: description
          })
        });
      } catch (error) {
        if (this.debug) console.warn('DEBUG: Failed to set channel description:', error);
      }
    }

    return {
      channel_id: channelId,
      channel_name: data.channel.name,
      is_private: data.channel.is_private,
      success: true,
      created_at: new Date().toISOString()
    };
  }

  // List all channels the bot has access to
  private async listChannels(connection: any, parameters: any): Promise<any> {
    this.logger.debug('Listing Slack channels');

    const { types, limit, exclude_archived } = parameters;

    const url = new URL('https://slack.com/api/conversations.list');
    url.searchParams.set('types', types || 'public_channel,private_channel');
    url.searchParams.set('limit', (limit || 100).toString());
    url.searchParams.set('exclude_archived', (exclude_archived !== false).toString());

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
      },
    });

    const data = await this.handleSlackResponse(response, 'list_channels');

    const channels = (data.channels || []).map((channel: any) => ({
      channel_id: channel.id,
      name: channel.name,
      is_private: channel.is_private,
      is_archived: channel.is_archived,
      member_count: channel.num_members,
      topic: channel.topic?.value || '',
      purpose: channel.purpose?.value || '',
      created: channel.created
    }));

    return {
      channels: channels,
      total_count: channels.length,
      has_more: !!data.response_metadata?.next_cursor
    };
  }

  // List all users in the workspace
  private async listUsers(connection: any, parameters: any): Promise<any> {
    this.logger.debug('Listing Slack users');

    const { limit, include_deleted } = parameters;

    const url = new URL('https://slack.com/api/users.list');
    url.searchParams.set('limit', (limit || 100).toString());

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
      },
    });

    const data = await this.handleSlackResponse(response, 'list_users');

    let users = data.members || [];

    // Filter out deleted users if requested
    if (!include_deleted) {
      users = users.filter((user: any) => !user.deleted);
    }

    const formattedUsers = users.map((user: any) => ({
      user_id: user.id,
      name: user.name,
      real_name: user.real_name,
      display_name: user.profile?.display_name || user.real_name,
      email: user.profile?.email,
      is_bot: user.is_bot,
      is_admin: user.is_admin,
      is_owner: user.is_owner,
      status: user.profile?.status_text || '',
      avatar: user.profile?.image_72
    }));

    return {
      users: formattedUsers,
      total_count: formattedUsers.length
    };
  }

  // Get detailed information about a specific user
  private async getUserInfo(connection: any, parameters: any): Promise<any> {
    this.logger.debug('Getting Slack user info');

    const { user_id } = parameters;

    const url = new URL('https://slack.com/api/users.info');
    url.searchParams.set('user', user_id);

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
      },
    });

    const data = await this.handleSlackResponse(response, 'get_user_info');

    const user = data.user;

    return {
      user_id: user.id,
      name: user.name,
      real_name: user.real_name,
      display_name: user.profile?.display_name || user.real_name,
      email: user.profile?.email,
      phone: user.profile?.phone,
      title: user.profile?.title,
      status_text: user.profile?.status_text,
      status_emoji: user.profile?.status_emoji,
      is_bot: user.is_bot,
      is_admin: user.is_admin,
      is_owner: user.is_owner,
      is_primary_owner: user.is_primary_owner,
      timezone: user.tz,
      timezone_label: user.tz_label,
      avatar_512: user.profile?.image_512,
      avatar_192: user.profile?.image_192,
      avatar_72: user.profile?.image_72
    };
  }

  // Upload and share a file (using new 3-step workflow)
  private async uploadFile(connection: any, parameters: any): Promise<any> {
    this.logger.debug('Uploading file to Slack (new workflow)');

    const { filename, file_content, channel_ids, title, initial_comment } = parameters;

    // Decode file content (assuming base64 for binary, or plain text)
    let fileBuffer: Buffer;
    try {
      // Try to decode as base64 first
      fileBuffer = Buffer.from(file_content, 'base64');
    } catch {
      // If not base64, treat as plain text
      fileBuffer = Buffer.from(file_content, 'utf-8');
    }

    const fileSize = fileBuffer.length;

    // Step 1: Get upload URL
    const getUrlResponse = await fetch('https://slack.com/api/files.getUploadURLExternal', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filename: filename,
        length: fileSize
      })
    });

    const urlData = await this.handleSlackResponse(getUrlResponse, 'get_upload_url');
    const uploadUrl = urlData.upload_url;
    const fileId = urlData.file_id;

    // Step 2: Upload file to the URL
    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      body: fileBuffer
    });

    if (!uploadResponse.ok) {
      throw new Error(`File upload failed: ${uploadResponse.status}`);
    }

    // Step 3: Complete upload and share to channels
    const completeBody: any = {
      files: [
        {
          id: fileId,
          title: title || filename
        }
      ]
    };

    if (channel_ids && channel_ids.length > 0) {
      completeBody.channel_id = channel_ids[0]; // Primary channel
    }

    if (initial_comment) {
      completeBody.initial_comment = initial_comment;
    }

    const completeResponse = await fetch('https://slack.com/api/files.completeUploadExternal', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(completeBody)
    });

    const completeData = await this.handleSlackResponse(completeResponse, 'complete_upload');

    const uploadedFile = completeData.files?.[0];

    return {
      file_id: uploadedFile?.id || fileId,
      filename: uploadedFile?.name || filename,
      title: uploadedFile?.title || title || filename,
      url: uploadedFile?.permalink || uploadedFile?.url_private,
      channels: channel_ids || [],
      success: true,
      uploaded_at: new Date().toISOString()
    };
  }

  /**
   * List all available Slack channels for dynamic dropdown options
   * This method is called by the fetch-options API route
   */
  async list_channels(connection: any, options: { page?: number; limit?: number } = {}): Promise<Array<{value: string; label: string; description?: string; icon?: string; group?: string}>> {
    try {
      const { limit = 100 } = options;

      const url = new URL('https://slack.com/api/conversations.list');
      url.searchParams.set('types', 'public_channel,private_channel');
      url.searchParams.set('limit', limit.toString());
      url.searchParams.set('exclude_archived', 'true');

      const response = await fetch(url.toString(), {
        headers: {
          'Authorization': `Bearer ${connection.access_token}`,
        },
      });

      const data = await response.json();

      if (!data.ok) {
        this.logger.error({ error: data.error }, 'Slack API error listing channels');
        throw new Error(`Slack API error: ${data.error}`);
      }

      if (!data.channels || !Array.isArray(data.channels)) {
        return [];
      }

      // Transform to option format
      return data.channels.map((ch: any) => ({
        value: ch.id,
        label: `#${ch.name}`,
        description: ch.purpose?.value || ch.topic?.value || undefined,
        icon: '💬',
        group: ch.is_private ? 'Private Channels' : 'Public Channels',
      }));

    } catch (error) {
      this.logger.error({ err: error }, 'Error listing Slack channels for options');
      throw error;
    }
  }

  // Resolve channel name to channel ID
  private async resolveChannelNameToId(connection: any, channelName: string): Promise<string | null> {
    try {
      const url = new URL('https://slack.com/api/conversations.list');
      url.searchParams.set('types', 'public_channel,private_channel');
      url.searchParams.set('limit', '1000');

      const response = await fetch(url.toString(), {
        headers: {
          'Authorization': `Bearer ${connection.access_token}`,
        },
      });

      const data = await response.json();

      if (data.ok && data.channels) {
        const channel = data.channels.find((ch: any) => ch.name === channelName);
        return channel ? channel.id : null;
      }

      return null;
    } catch (error) {
      this.logger.error({ err: error }, 'Error resolving channel name');
      return null;
    }
  }

  // Handle Slack API responses (all responses have {ok: true/false})
  private async handleSlackResponse(response: Response, operationName: string): Promise<any> {
    if (!response.ok) {
      const errorText = await response.text();
      if (this.debug) console.error(`DEBUG: ${operationName} HTTP failed:`, errorText);
      throw new Error(`Slack API HTTP error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    if (!data.ok) {
      const errorMsg = data.error || 'Unknown Slack error';
      if (this.debug) console.error(`DEBUG: ${operationName} Slack error:`, errorMsg);
      throw new Error(`Slack API error: ${errorMsg}`);
    }

    return data;
  }

  // Override to handle Slack-specific errors
  protected mapPluginSpecificError(error: any, commonErrors: Record<string, string>): string | null {
    const errorMsg = error.message || '';

    // Slack-specific error codes
    if (errorMsg.includes('channel_not_found')) {
      return commonErrors.channel_not_found || 'Channel not found. Check the channel ID.';
    }

    if (errorMsg.includes('message_not_found')) {
      return commonErrors.message_not_found || 'Message not found. Check the timestamp.';
    }

    if (errorMsg.includes('cant_update_message')) {
      return commonErrors.cant_update_message || 'Cannot update this message. Only messages sent by the bot can be updated.';
    }

    if (errorMsg.includes('already_reacted')) {
      return 'This reaction has already been added to the message.';
    }

    if (errorMsg.includes('no_reaction')) {
      return 'This reaction does not exist on the message.';
    }

    if (errorMsg.includes('name_taken')) {
      return commonErrors.name_taken || 'A channel with this name already exists.';
    }

    if (errorMsg.includes('invalid_name')) {
      return commonErrors.invalid_name || 'Invalid channel name. Use lowercase letters, numbers, hyphens, and underscores only.';
    }

    if (errorMsg.includes('user_not_found')) {
      return commonErrors.user_not_found || 'User not found. Check the user ID.';
    }

    if (errorMsg.includes('not_in_channel')) {
      return 'Unable to access this channel. This usually means the channel is private or the bot lacks permissions. Please use a public channel or provide the actual channel ID (e.g., C1234567890) instead of a channel name.';
    }

    if (errorMsg.includes('rate_limited') || errorMsg.includes('ratelimited')) {
      return commonErrors.api_rate_limit || 'Slack rate limit exceeded. Please wait and try again.';
    }

    // Return null to fall back to common error handling
    return null;
  }

  // Test connection with a simple API call
  protected async performConnectionTest(connection: any): Promise<any> {
    // Test with auth.test API
    const response = await fetch('https://slack.com/api/auth.test', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
      },
    });

    const data = await this.handleSlackResponse(response, 'connection_test');

    return {
      success: true,
      data: {
        team: data.team,
        team_id: data.team_id,
        user: data.user,
        user_id: data.user_id,
        bot_id: data.bot_id
      },
      message: 'Slack connection active'
    };
  }
}
