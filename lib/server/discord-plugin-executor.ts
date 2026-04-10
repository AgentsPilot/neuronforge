import { BasePluginExecutor } from './base-plugin-executor';
import { UserPluginConnections } from './user-plugin-connections';
import { PluginManagerV2 } from './plugin-manager-v2';
import pino from 'pino';

const pluginName = 'discord';

export class DiscordPluginExecutor extends BasePluginExecutor {
  private apiBaseUrl = 'https://discord.com/api/v10';
  protected logger = pino({ name: `${pluginName}-plugin-executor` });

  constructor(userConnections: UserPluginConnections, pluginManager: PluginManagerV2) {
    super(pluginName, userConnections, pluginManager);
  }

  protected async executeSpecificAction(connection: any, actionName: string, parameters: any): Promise<any> {
    this.logger.debug({ actionName, params: parameters }, 'Executing Discord action');

    switch (actionName) {
      case 'send_message':
        return this.sendMessage(connection, parameters);
      case 'get_channels':
        return this.getChannels(connection, parameters);
      case 'list_guilds':
        return this.listGuilds(connection);
      case 'get_messages':
        return this.getMessages(connection, parameters);
      case 'create_channel':
        return this.createChannel(connection, parameters);
      case 'delete_message':
        return this.deleteMessage(connection, parameters);
      default:
        throw new Error(`Unknown action: ${actionName}`);
    }
  }

  private async sendMessage(connection: any, params: any): Promise<any> {
    const { channel_id, content, embed } = params;

    const payload: any = { content };
    if (embed) {
      payload.embeds = [embed];
    }

    const response = await this.makeDiscordRequest(
      connection,
      `/channels/${channel_id}/messages`,
      'POST',
      payload
    );

    return {
      id: response.id,
      channel_id: response.channel_id,
      content: response.content,
      timestamp: response.timestamp
    };
  }

  private async getChannels(connection: any, params: any): Promise<any> {
    const { guild_id } = params;

    const channels = await this.makeDiscordRequest(
      connection,
      `/guilds/${guild_id}/channels`,
      'GET'
    );

    return {
      channels: channels.map((channel: any) => ({
        id: channel.id,
        name: channel.name,
        type: channel.type
      }))
    };
  }

  private async listGuilds(connection: any): Promise<any> {
    const guilds = await this.makeDiscordRequest(
      connection,
      '/users/@me/guilds',
      'GET'
    );

    return {
      guilds: guilds.map((guild: any) => ({
        id: guild.id,
        name: guild.name,
        icon: guild.icon
      }))
    };
  }

  private async getMessages(connection: any, params: any): Promise<any> {
    const { channel_id, limit = 50 } = params;

    const messages = await this.makeDiscordRequest(
      connection,
      `/channels/${channel_id}/messages?limit=${limit}`,
      'GET'
    );

    return {
      messages: messages.map((msg: any) => ({
        id: msg.id,
        content: msg.content,
        author: {
          id: msg.author.id,
          username: msg.author.username
        },
        timestamp: msg.timestamp
      }))
    };
  }

  private async createChannel(connection: any, params: any): Promise<any> {
    const { guild_id, name, type = 0 } = params;

    const response = await this.makeDiscordRequest(
      connection,
      `/guilds/${guild_id}/channels`,
      'POST',
      { name, type }
    );

    return {
      id: response.id,
      name: response.name,
      type: response.type
    };
  }

  private async deleteMessage(connection: any, params: any): Promise<any> {
    const { channel_id, message_id } = params;

    await this.makeDiscordRequest(
      connection,
      `/channels/${channel_id}/messages/${message_id}`,
      'DELETE'
    );

    return { success: true };
  }

  private async makeDiscordRequest(
    connection: any,
    endpoint: string,
    method: string,
    body?: any
  ): Promise<any> {
    const accessToken = connection.access_token;

    const options: RequestInit = {
      method,
      headers: {
        'Authorization': `Bot ${accessToken}`,
        'Content-Type': 'application/json'
      }
    };

    if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      options.body = JSON.stringify(body);
    }

    const url = `${this.apiBaseUrl}${endpoint}`;
    this.logger.debug({ url, method }, 'Making Discord API request');

    const response = await fetch(url, options);

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error({ status: response.status, error: errorText }, 'Discord API error');
      throw new Error(`Discord API error: ${response.status} - ${errorText}`);
    }

    // DELETE returns 204 No Content
    if (response.status === 204) {
      return {};
    }

    return response.json();
  }
}
