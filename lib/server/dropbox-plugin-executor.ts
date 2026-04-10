// lib/server/dropbox-plugin-executor.ts
// Dropbox plugin executor using Dropbox API v2

import { BasePluginExecutor } from './base-plugin-executor';
import { UserPluginConnections } from './user-plugin-connections';
import { PluginManagerV2 } from './plugin-manager-v2';

const pluginName = 'dropbox';

export class DropboxPluginExecutor extends BasePluginExecutor {
  private apiBaseUrl = 'https://api.dropboxapi.com/2';
  private contentBaseUrl = 'https://content.dropboxapi.com/2';

  constructor(userConnections: UserPluginConnections, pluginManager: PluginManagerV2) {
    super(pluginName, userConnections, pluginManager);
  }

  protected async executeSpecificAction(
    connection: any,
    actionName: string,
    parameters: any
  ): Promise<any> {
    this.logger.debug({ actionName, params: parameters }, 'Executing Dropbox action');

    switch (actionName) {
      case 'list_files':
        return await this.listFiles(connection, parameters);
      case 'search_files':
        return await this.searchFiles(connection, parameters);
      case 'download_file':
        return await this.downloadFile(connection, parameters);
      case 'upload_file':
        return await this.uploadFile(connection, parameters);
      case 'create_folder':
        return await this.createFolder(connection, parameters);
      case 'get_or_create_folder':
        return await this.getOrCreateFolder(connection, parameters);
      case 'delete_file':
        return await this.deleteFile(connection, parameters);
      case 'move_file':
        return await this.moveFile(connection, parameters);
      case 'copy_file':
        return await this.copyFile(connection, parameters);
      case 'create_shared_link':
        return await this.createSharedLink(connection, parameters);
      case 'get_file_metadata':
        return await this.getFileMetadata(connection, parameters);
      default:
        throw new Error(`Unsupported Dropbox action: ${actionName}`);
    }
  }

  // === FILE OPERATIONS ===

  private async listFiles(connection: any, params: any): Promise<any> {
    const { path = '', recursive = false, limit = 100, include_deleted = false } = params;

    const endpoint = `${this.apiBaseUrl}/files/list_folder`;
    const requestBody = {
      path: path || '', // Empty string for root
      recursive,
      limit: Math.min(limit, 2000), // Dropbox max is 2000
      include_deleted,
      include_mounted_folders: true,
      include_non_downloadable_files: false
    };

    const response = await this.makeDropboxRequest(connection, endpoint, 'POST', requestBody);

    const files = response.entries.map((entry: any) => ({
      id: entry.id,
      name: entry.name,
      path_display: entry.path_display,
      path_lower: entry.path_lower,
      size: entry.size || 0,
      client_modified: entry.client_modified,
      server_modified: entry.server_modified,
      is_folder: entry['.tag'] === 'folder',
      is_downloadable: entry.is_downloadable !== false,
      content_hash: entry.content_hash
    }));

    return {
      files,
      file_count: files.length,
      has_more: response.has_more,
      cursor: response.cursor,
      retrieved_at: new Date().toISOString()
    };
  }

  private async searchFiles(connection: any, params: any): Promise<any> {
    const { query, path = '', max_results = 50, file_extensions } = params;

    const endpoint = `${this.apiBaseUrl}/files/search_v2`;

    // Build search options
    const options: any = {
      file_status: 'active',
      filename_only: false // Search in content too
    };

    if (file_extensions && file_extensions.length > 0) {
      options.file_extensions = file_extensions;
    }

    const requestBody = {
      query,
      options,
      match_field_options: {
        include_highlights: false
      }
    };

    // Add path scope if specified
    if (path) {
      requestBody['include_highlights'] = false;
    }

    const response = await this.makeDropboxRequest(connection, endpoint, 'POST', requestBody);

    const files = response.matches
      .slice(0, max_results)
      .map((match: any) => {
        const metadata = match.metadata.metadata;
        return {
          id: metadata.id,
          name: metadata.name,
          path_display: metadata.path_display,
          path_lower: metadata.path_lower,
          size: metadata.size || 0,
          server_modified: metadata.server_modified,
          is_folder: metadata['.tag'] === 'folder'
        };
      });

    return {
      files,
      match_count: files.length,
      has_more: response.has_more,
      searched_at: new Date().toISOString()
    };
  }

  private async downloadFile(connection: any, params: any): Promise<any> {
    const { path, return_base64 = false } = params;

    const endpoint = `${this.contentBaseUrl}/files/download`;

    const response = await this.makeDropboxContentRequest(
      connection,
      endpoint,
      'POST',
      null,
      { 'Dropbox-API-Arg': JSON.stringify({ path }) }
    );

    // Get metadata from response headers
    const metadata = JSON.parse(response.headers.get('dropbox-api-result') || '{}');

    // Read response body
    const buffer = await response.arrayBuffer();
    const content = return_base64
      ? Buffer.from(buffer).toString('base64')
      : Buffer.from(buffer).toString('utf-8');

    return {
      name: metadata.name,
      size: metadata.size,
      path_display: metadata.path_display,
      content,
      content_type: response.headers.get('content-type'),
      server_modified: metadata.server_modified,
      is_base64: return_base64
    };
  }

  private async uploadFile(connection: any, params: any): Promise<any> {
    const {
      path,
      content,
      mode = 'add',
      autorename = false,
      mute = false
    } = params;

    const endpoint = `${this.contentBaseUrl}/files/upload`;

    // Convert content to buffer
    const buffer = Buffer.isBuffer(content)
      ? content
      : Buffer.from(content, content.includes('base64') ? 'base64' : 'utf-8');

    const dropboxArgs = {
      path,
      mode: mode === 'overwrite' ? 'overwrite' : mode === 'update' ? 'update' : 'add',
      autorename,
      mute,
      strict_conflict: false
    };

    const response = await this.makeDropboxContentRequest(
      connection,
      endpoint,
      'POST',
      buffer,
      {
        'Dropbox-API-Arg': JSON.stringify(dropboxArgs),
        'Content-Type': 'application/octet-stream'
      }
    );

    const result = await response.json();

    return {
      id: result.id,
      name: result.name,
      path_display: result.path_display,
      path_lower: result.path_lower,
      size: result.size,
      server_modified: result.server_modified,
      content_hash: result.content_hash,
      uploaded_at: new Date().toISOString()
    };
  }

  private async createFolder(connection: any, params: any): Promise<any> {
    const { path, autorename = false } = params;

    const endpoint = `${this.apiBaseUrl}/files/create_folder_v2`;
    const requestBody = {
      path,
      autorename
    };

    const response = await this.makeDropboxRequest(connection, endpoint, 'POST', requestBody);

    return {
      id: response.metadata.id,
      name: response.metadata.name,
      path_display: response.metadata.path_display,
      path_lower: response.metadata.path_lower,
      created_at: new Date().toISOString()
    };
  }

  private async getOrCreateFolder(connection: any, params: any): Promise<any> {
    const { path } = params;

    // First try to get metadata
    try {
      const metadata = await this.getFileMetadata(connection, { path });

      if (metadata.is_folder) {
        return {
          ...metadata,
          already_existed: true
        };
      } else {
        throw new Error(`Path ${path} exists but is not a folder`);
      }
    } catch (error: any) {
      // If not found, create it
      if (error.message?.includes('not_found') || error.message?.includes('path/not_found')) {
        const created = await this.createFolder(connection, { path, autorename: false });
        return {
          ...created,
          already_existed: false
        };
      }
      throw error;
    }
  }

  private async deleteFile(connection: any, params: any): Promise<any> {
    const { path } = params;

    const endpoint = `${this.apiBaseUrl}/files/delete_v2`;
    const requestBody = { path };

    await this.makeDropboxRequest(connection, endpoint, 'POST', requestBody);

    return {
      deleted_path: path,
      deleted_at: new Date().toISOString()
    };
  }

  private async moveFile(connection: any, params: any): Promise<any> {
    const {
      from_path,
      to_path,
      autorename = false,
      allow_ownership_transfer = false
    } = params;

    const endpoint = `${this.apiBaseUrl}/files/move_v2`;
    const requestBody = {
      from_path,
      to_path,
      autorename,
      allow_ownership_transfer
    };

    const response = await this.makeDropboxRequest(connection, endpoint, 'POST', requestBody);

    return {
      id: response.metadata.id,
      name: response.metadata.name,
      path_display: response.metadata.path_display,
      path_lower: response.metadata.path_lower,
      moved_at: new Date().toISOString()
    };
  }

  private async copyFile(connection: any, params: any): Promise<any> {
    const { from_path, to_path, autorename = false } = params;

    const endpoint = `${this.apiBaseUrl}/files/copy_v2`;
    const requestBody = {
      from_path,
      to_path,
      autorename
    };

    const response = await this.makeDropboxRequest(connection, endpoint, 'POST', requestBody);

    return {
      id: response.metadata.id,
      name: response.metadata.name,
      path_display: response.metadata.path_display,
      path_lower: response.metadata.path_lower,
      copied_at: new Date().toISOString()
    };
  }

  private async createSharedLink(connection: any, params: any): Promise<any> {
    const { path, short_url = false, expires } = params;

    // Try to create shared link
    const endpoint = `${this.apiBaseUrl}/sharing/create_shared_link_with_settings`;

    const settings: any = {
      requested_visibility: 'public'
    };

    if (expires) {
      settings.expires = expires;
    }

    const requestBody = {
      path,
      settings
    };

    try {
      const response = await this.makeDropboxRequest(connection, endpoint, 'POST', requestBody);

      return {
        url: response.url,
        path: response.path_lower,
        expires: response.expires,
        visibility: response.visibility?.['.tag']
      };
    } catch (error: any) {
      // If link already exists, get existing link
      if (error.message?.includes('shared_link_already_exists')) {
        const listEndpoint = `${this.apiBaseUrl}/sharing/list_shared_links`;
        const listResponse = await this.makeDropboxRequest(connection, listEndpoint, 'POST', { path });

        if (listResponse.links && listResponse.links.length > 0) {
          const link = listResponse.links[0];
          return {
            url: link.url,
            path: link.path_lower,
            expires: link.expires,
            visibility: link.visibility?.['.tag']
          };
        }
      }
      throw error;
    }
  }

  private async getFileMetadata(connection: any, params: any): Promise<any> {
    const { path, include_media_info = false } = params;

    const endpoint = `${this.apiBaseUrl}/files/get_metadata`;
    const requestBody = {
      path,
      include_media_info,
      include_deleted: false
    };

    const response = await this.makeDropboxRequest(connection, endpoint, 'POST', requestBody);

    return {
      id: response.id,
      name: response.name,
      path_display: response.path_display,
      path_lower: response.path_lower,
      size: response.size || 0,
      client_modified: response.client_modified,
      server_modified: response.server_modified,
      is_folder: response['.tag'] === 'folder',
      content_hash: response.content_hash,
      is_downloadable: response.is_downloadable !== false,
      media_info: response.media_info
    };
  }

  // === HELPER METHODS ===

  private async makeDropboxRequest(
    connection: any,
    endpoint: string,
    method: string = 'POST',
    body?: any
  ): Promise<any> {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${connection.access_token}`,
      'Content-Type': 'application/json'
    };

    const options: RequestInit = {
      method,
      headers
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    this.logger.debug({ endpoint, method }, 'Making Dropbox API request');

    const response = await fetch(endpoint, options);

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `Dropbox API error: ${response.status} ${response.statusText}`;

      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error_summary || errorJson.error?.error_summary || errorMessage;
      } catch {
        // Use default error message
      }

      this.logger.error({ endpoint, status: response.status, error: errorText }, 'Dropbox API error');
      throw new Error(errorMessage);
    }

    return await response.json();
  }

  private async makeDropboxContentRequest(
    connection: any,
    endpoint: string,
    method: string = 'POST',
    body?: any,
    additionalHeaders?: Record<string, string>
  ): Promise<Response> {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${connection.access_token}`,
      ...additionalHeaders
    };

    const options: RequestInit = {
      method,
      headers
    };

    if (body) {
      options.body = body;
    }

    this.logger.debug({ endpoint, method }, 'Making Dropbox content request');

    const response = await fetch(endpoint, options);

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `Dropbox API error: ${response.status} ${response.statusText}`;

      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error_summary || errorJson.error?.error_summary || errorMessage;
      } catch {
        // Use default error message
      }

      this.logger.error({ endpoint, status: response.status, error: errorText }, 'Dropbox content API error');
      throw new Error(errorMessage);
    }

    return response;
  }
}
