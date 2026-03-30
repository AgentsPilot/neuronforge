// lib/server/notion-plugin-executor.ts

import { UserPluginConnections } from './user-plugin-connections';
import { PluginManagerV2 } from './plugin-manager-v2';
import { BasePluginExecutor } from './base-plugin-executor';

const pluginName = 'notion';

export class NotionPluginExecutor extends BasePluginExecutor {
  private apiBaseUrl = 'https://api.notion.com/v1';
  private notionVersion = '2022-06-28';

  constructor(userConnections: UserPluginConnections, pluginManager: PluginManagerV2) {
    super(pluginName, userConnections, pluginManager);
  }

  protected async executeSpecificAction(
    connection: any,
    actionName: string,
    parameters: any
  ): Promise<any> {
    switch (actionName) {
      case 'search':
        return await this.search(connection, parameters);
      case 'get_page':
        return await this.getPage(connection, parameters);
      case 'get_page_content':
        return await this.getPageContent(connection, parameters);
      case 'create_page':
        return await this.createPage(connection, parameters);
      case 'update_page':
        return await this.updatePage(connection, parameters);
      case 'query_database':
        return await this.queryDatabase(connection, parameters);
      case 'get_database':
        return await this.getDatabase(connection, parameters);
      case 'append_block_children':
        return await this.appendBlockChildren(connection, parameters);
      default:
        throw new Error(`Action ${actionName} not supported`);
    }
  }

  // Action: Search
  private async search(connection: any, parameters: any): Promise<any> {
    this.logger.debug('Searching Notion workspace');

    const { query, filter, sort, page_size = 50 } = parameters;

    const url = `${this.apiBaseUrl}/search`;

    const requestBody: any = {
      page_size
    };

    if (query) {
      requestBody.query = query;
    }

    if (filter) {
      requestBody.filter = filter;
    }

    if (sort) {
      requestBody.sort = sort;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: this.buildNotionHeaders(connection.access_token),
      body: JSON.stringify(requestBody)
    });

    const data = await this.handleApiResponse(response, 'search');

    // Extract simplified results
    const results = (data.results || []).map((item: any) => ({
      id: item.id,
      object: item.object,
      created_time: item.created_time,
      last_edited_time: item.last_edited_time,
      title: this.extractTitle(item),
      url: item.url
    }));

    return {
      results,
      has_more: data.has_more || false,
      next_cursor: data.next_cursor || null,
      result_count: results.length
    };
  }

  // Action: Get Page
  private async getPage(connection: any, parameters: any): Promise<any> {
    this.logger.debug('Getting Notion page');

    const { page_id } = parameters;

    const url = `${this.apiBaseUrl}/pages/${page_id}`;

    const response = await fetch(url, {
      headers: this.buildNotionHeaders(connection.access_token)
    });

    const data = await this.handleApiResponse(response, 'get_page');

    return {
      id: data.id,
      created_time: data.created_time,
      last_edited_time: data.last_edited_time,
      properties: data.properties,
      url: data.url,
      parent: data.parent
    };
  }

  // Action: Get Page Content
  private async getPageContent(connection: any, parameters: any): Promise<any> {
    this.logger.debug('Getting Notion page content');

    const { page_id, page_size = 100 } = parameters;

    const url = `${this.apiBaseUrl}/blocks/${page_id}/children?page_size=${page_size}`;

    const response = await fetch(url, {
      headers: this.buildNotionHeaders(connection.access_token)
    });

    const data = await this.handleApiResponse(response, 'get_page_content');

    // Extract plain text content from blocks
    const textContent = this.extractTextFromBlocks(data.results || []);

    return {
      blocks: data.results || [],
      text_content: textContent,
      has_more: data.has_more || false,
      block_count: data.results?.length || 0
    };
  }

  // Action: Create Page
  private async createPage(connection: any, parameters: any): Promise<any> {
    this.logger.debug('Creating Notion page');

    const { parent, properties, children } = parameters;

    const url = `${this.apiBaseUrl}/pages`;

    const requestBody: any = {
      parent
    };

    if (properties) {
      requestBody.properties = properties;
    }

    if (children) {
      requestBody.children = children;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: this.buildNotionHeaders(connection.access_token),
      body: JSON.stringify(requestBody)
    });

    const data = await this.handleApiResponse(response, 'create_page');

    return {
      id: data.id,
      url: data.url,
      created_time: data.created_time,
      properties: data.properties
    };
  }

  // Action: Update Page
  private async updatePage(connection: any, parameters: any): Promise<any> {
    this.logger.debug('Updating Notion page');

    const { page_id, properties } = parameters;

    const url = `${this.apiBaseUrl}/pages/${page_id}`;

    const requestBody: any = {
      properties
    };

    const response = await fetch(url, {
      method: 'PATCH',
      headers: this.buildNotionHeaders(connection.access_token),
      body: JSON.stringify(requestBody)
    });

    const data = await this.handleApiResponse(response, 'update_page');

    return {
      id: data.id,
      last_edited_time: data.last_edited_time,
      properties: data.properties
    };
  }

  // Action: Query Database
  private async queryDatabase(connection: any, parameters: any): Promise<any> {
    this.logger.debug('Querying Notion database');

    const { database_id, filter, sorts, page_size = 50 } = parameters;

    const url = `${this.apiBaseUrl}/databases/${database_id}/query`;

    const requestBody: any = {
      page_size
    };

    if (filter) {
      requestBody.filter = filter;
    }

    if (sorts) {
      requestBody.sorts = sorts;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: this.buildNotionHeaders(connection.access_token),
      body: JSON.stringify(requestBody)
    });

    const data = await this.handleApiResponse(response, 'query_database');

    return {
      results: data.results || [],
      has_more: data.has_more || false,
      next_cursor: data.next_cursor || null,
      result_count: data.results?.length || 0
    };
  }

  // Action: Get Database
  private async getDatabase(connection: any, parameters: any): Promise<any> {
    this.logger.debug('Getting Notion database');

    const { database_id } = parameters;

    const url = `${this.apiBaseUrl}/databases/${database_id}`;

    const response = await fetch(url, {
      headers: this.buildNotionHeaders(connection.access_token)
    });

    const data = await this.handleApiResponse(response, 'get_database');

    return {
      id: data.id,
      title: data.title,
      properties: data.properties,
      created_time: data.created_time,
      url: data.url
    };
  }

  // Action: Append Block Children
  private async appendBlockChildren(connection: any, parameters: any): Promise<any> {
    this.logger.debug('Appending blocks to Notion page');

    const { block_id, children } = parameters;

    const url = `${this.apiBaseUrl}/blocks/${block_id}/children`;

    const requestBody: any = {
      children
    };

    const response = await fetch(url, {
      method: 'PATCH',
      headers: this.buildNotionHeaders(connection.access_token),
      body: JSON.stringify(requestBody)
    });

    const data = await this.handleApiResponse(response, 'append_block_children');

    return {
      results: data.results || [],
      block_count: data.results?.length || 0
    };
  }

  // Helper: Build Notion-specific headers
  private buildNotionHeaders(accessToken: string): Record<string, string> {
    return {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Notion-Version': this.notionVersion
    };
  }

  // Helper: Extract title from page or database object
  private extractTitle(item: any): string {
    // For pages
    if (item.object === 'page' && item.properties) {
      // Find the title property
      for (const [key, value] of Object.entries(item.properties)) {
        const prop = value as any;
        if (prop.type === 'title' && prop.title && prop.title.length > 0) {
          return prop.title.map((t: any) => t.plain_text || t.text?.content || '').join('');
        }
      }
    }

    // For databases
    if (item.object === 'database' && item.title && item.title.length > 0) {
      return item.title.map((t: any) => t.plain_text || t.text?.content || '').join('');
    }

    return 'Untitled';
  }

  // Helper: Extract plain text from blocks
  private extractTextFromBlocks(blocks: any[]): string {
    const textParts: string[] = [];

    for (const block of blocks) {
      const blockType = block.type;
      const blockContent = block[blockType];

      if (blockContent && blockContent.rich_text) {
        const text = blockContent.rich_text
          .map((rt: any) => rt.plain_text || rt.text?.content || '')
          .join('');
        if (text) {
          textParts.push(text);
        }
      }
    }

    return textParts.join('\n');
  }

  // Override error mapping for Notion-specific errors
  protected mapPluginSpecificError(error: any, commonErrors: Record<string, string>): string | null {
    const errorMsg = error.message || '';

    // Notion-specific error codes
    if (errorMsg.includes('validation_error')) {
      return 'Invalid request: Check that properties and values match the expected schema.';
    }

    if (errorMsg.includes('object_not_found')) {
      return commonErrors.not_found || 'Page or database not found. Please check the ID and try again.';
    }

    if (errorMsg.includes('unauthorized')) {
      return commonErrors.auth_failed || 'Notion connection has expired. Please reconnect in Settings.';
    }

    if (errorMsg.includes('restricted_resource')) {
      return commonErrors.permission_denied || 'You don\'t have permission to access this resource.';
    }

    if (errorMsg.includes('rate_limited')) {
      return commonErrors.rate_limit || 'Rate limit exceeded. Please wait a moment and try again.';
    }

    if (errorMsg.includes('invalid_json')) {
      return 'Invalid data format. Please check the request body.';
    }

    if (errorMsg.includes('conflict_error')) {
      return 'Conflict error: The resource was modified by another request.';
    }

    // Return null to fall back to common error handling
    return null;
  }

  // Override connection test
  protected async performConnectionTest(connection: any): Promise<any> {
    const response = await fetch(`${this.apiBaseUrl}/users/me`, {
      headers: this.buildNotionHeaders(connection.access_token)
    });

    const data = await this.handleApiResponse(response, 'connection_test');

    return {
      user_id: data.id,
      name: data.name || null,
      type: data.type || null
    };
  }

  /**
   * Search for pages dynamically for dropdown options
   * This method is called by the fetch-options API route
   */
  async search_pages(connection: any, options: { page?: number; limit?: number; query?: string } = {}): Promise<Array<{value: string; label: string; description?: string; icon?: string; group?: string}>> {
    try {
      const result = await this.search(connection, {
        filter: {
          property: 'object',
          value: 'page'
        },
        query: options.query || '',
        page_size: options.limit || 20
      });

      if (!result.results || !Array.isArray(result.results)) {
        return [];
      }

      // Transform to option format
      return result.results.map((page: any) => ({
        value: page.id,
        label: page.title || 'Untitled',
        description: `Last edited: ${new Date(page.last_edited_time).toLocaleDateString()}`,
        icon: '📄',
        group: 'Pages',
      }));

    } catch (error: any) {
      this.logger.error({ err: error }, 'Error searching Notion pages for options');
      throw error;
    }
  }

  /**
   * Search for databases dynamically for dropdown options
   * This method is called by the fetch-options API route
   */
  async search_databases(connection: any, options: { page?: number; limit?: number; query?: string } = {}): Promise<Array<{value: string; label: string; description?: string; icon?: string; group?: string}>> {
    try {
      const result = await this.search(connection, {
        filter: {
          property: 'object',
          value: 'database'
        },
        query: options.query || '',
        page_size: options.limit || 20
      });

      if (!result.results || !Array.isArray(result.results)) {
        return [];
      }

      // Transform to option format
      return result.results.map((db: any) => ({
        value: db.id,
        label: db.title || 'Untitled',
        description: `Database • Last edited: ${new Date(db.last_edited_time).toLocaleDateString()}`,
        icon: '🗄️',
        group: 'Databases',
      }));

    } catch (error: any) {
      this.logger.error({ err: error }, 'Error searching Notion databases for options');
      throw error;
    }
  }
}
