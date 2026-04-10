// lib/server/onedrive-plugin-executor.ts
// OneDrive plugin executor using Microsoft Graph API

import { BasePluginExecutor } from './base-plugin-executor';
import { UserPluginConnections } from './user-plugin-connections';
import { PluginManagerV2 } from './plugin-manager-v2';

const pluginName = 'onedrive';

export class OneDrivePluginExecutor extends BasePluginExecutor {
  private graphBaseUrl = 'https://graph.microsoft.com/v1.0';

  constructor(userConnections: UserPluginConnections, pluginManager: PluginManagerV2) {
    super(pluginName, userConnections, pluginManager);
  }

  protected async executeSpecificAction(
    connection: any,
    actionName: string,
    parameters: any
  ): Promise<any> {
    this.logger.debug({ actionName, params: parameters }, 'Executing OneDrive action');

    switch (actionName) {
      case 'list_files':
        return await this.listFiles(connection, parameters);
      case 'search_files':
        return await this.searchFiles(connection, parameters);
      case 'get_file_metadata':
        return await this.getFileMetadata(connection, parameters);
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
      case 'create_share_link':
        return await this.createShareLink(connection, parameters);
      case 'get_thumbnails':
        return await this.getThumbnails(connection, parameters);
      default:
        throw new Error(`Unsupported OneDrive action: ${actionName}`);
    }
  }

  // === FILE OPERATIONS ===

  private async listFiles(connection: any, params: any): Promise<any> {
    const { folder_id, max_results = 20, order_by = 'lastModifiedDateTime', file_types } = params;

    // Build endpoint
    const endpoint = folder_id
      ? `/me/drive/items/${folder_id}/children`
      : '/me/drive/root/children';

    // Build query parameters
    const queryParams = new URLSearchParams({
      $top: max_results.toString(),
      $select: 'id,name,size,createdDateTime,lastModifiedDateTime,webUrl,file,folder,@microsoft.graph.downloadUrl'
    });

    // Add ordering
    const orderMap: Record<string, string> = {
      lastModifiedDateTime: 'lastModifiedDateTime desc',
      name: 'name',
      createdDateTime: 'createdDateTime desc',
      size: 'size desc'
    };
    if (order_by && orderMap[order_by]) {
      queryParams.append('$orderby', orderMap[order_by]);
    }

    // Add file type filter if specified
    if (file_types && file_types.length > 0) {
      const filters = this.buildFileTypeFilter(file_types);
      if (filters) {
        queryParams.append('$filter', filters);
      }
    }

    const url = `${endpoint}?${queryParams.toString()}`;
    const response = await this.makeGraphRequest(connection, url, 'GET');

    const files = response.value.map((item: any) => ({
      id: item.id,
      name: item.name,
      size: item.size || 0,
      mimeType: this.getMimeType(item),
      createdDateTime: item.createdDateTime,
      lastModifiedDateTime: item.lastModifiedDateTime,
      webUrl: item.webUrl,
      isFolder: !!item.folder,
      downloadUrl: item['@microsoft.graph.downloadUrl']
    }));

    return {
      files,
      file_count: files.length,
      retrieved_at: new Date().toISOString()
    };
  }

  private async searchFiles(connection: any, params: any): Promise<any> {
    const { query, folder_id, max_results = 20 } = params;

    // Build search endpoint
    const endpoint = folder_id
      ? `/me/drive/items/${folder_id}/search(q='${encodeURIComponent(query)}')`
      : `/me/drive/root/search(q='${encodeURIComponent(query)}')`;

    const queryParams = new URLSearchParams({
      $top: max_results.toString(),
      $select: 'id,name,size,createdDateTime,lastModifiedDateTime,webUrl,file,folder'
    });

    const url = `${endpoint}?${queryParams.toString()}`;
    const response = await this.makeGraphRequest(connection, url, 'GET');

    const files = response.value.map((item: any) => ({
      id: item.id,
      name: item.name,
      size: item.size || 0,
      mimeType: this.getMimeType(item),
      lastModifiedDateTime: item.lastModifiedDateTime,
      webUrl: item.webUrl
    }));

    return {
      files,
      file_count: files.length,
      searched_at: new Date().toISOString()
    };
  }

  private async getFileMetadata(connection: any, params: any): Promise<any> {
    const { file_id, include_permissions = false } = params;

    let url = `/me/drive/items/${file_id}`;
    if (include_permissions) {
      url += '?$expand=permissions';
    }

    const item = await this.makeGraphRequest(connection, url, 'GET');

    return {
      id: item.id,
      name: item.name,
      size: item.size || 0,
      mimeType: this.getMimeType(item),
      createdDateTime: item.createdDateTime,
      lastModifiedDateTime: item.lastModifiedDateTime,
      webUrl: item.webUrl,
      createdBy: item.createdBy,
      lastModifiedBy: item.lastModifiedBy,
      ...(include_permissions && { permissions: item.permissions })
    };
  }

  private async downloadFile(connection: any, params: any): Promise<any> {
    const { file_id, return_url_only = false } = params;

    // Get file metadata first
    const metadata = await this.makeGraphRequest(connection, `/me/drive/items/${file_id}`, 'GET');

    // Get download URL
    const downloadUrl = metadata['@microsoft.graph.downloadUrl'];

    if (return_url_only || !downloadUrl) {
      return {
        file_id,
        file_name: metadata.name,
        mime_type: this.getMimeType(metadata),
        size: metadata.size,
        download_url: downloadUrl,
        downloaded_at: new Date().toISOString()
      };
    }

    // Download the actual content
    const downloadResponse = await fetch(downloadUrl);
    if (!downloadResponse.ok) {
      throw new Error(`Failed to download file: ${downloadResponse.status}`);
    }

    const buffer = await downloadResponse.arrayBuffer();
    const base64Content = Buffer.from(buffer).toString('base64');

    return {
      file_id,
      file_name: metadata.name,
      mime_type: this.getMimeType(metadata),
      size: metadata.size,
      content: base64Content,
      download_url: downloadUrl,
      downloaded_at: new Date().toISOString()
    };
  }

  private async uploadFile(connection: any, params: any): Promise<any> {
    const { file_content, file_name, folder_id, mime_type, conflict_behavior = 'rename' } = params;

    // Determine upload path
    const parentPath = folder_id
      ? `/me/drive/items/${folder_id}:/${file_name}:`
      : `/me/drive/root:/${file_name}:`;

    // Decode base64 content if needed
    const content = Buffer.from(file_content, 'base64');

    // Upload file (simple upload for files < 4MB)
    const url = `${parentPath}/content?@microsoft.graph.conflictBehavior=${conflict_behavior}`;

    const uploadResponse = await fetch(`${this.graphBaseUrl}${url}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Content-Type': mime_type || 'application/octet-stream',
        'Accept': 'application/json'
      },
      body: content
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      this.logger.error({ status: uploadResponse.status, errorText }, 'Upload failed');
      throw new Error(`Upload failed: ${uploadResponse.status} - ${errorText}`);
    }

    const item = await uploadResponse.json();

    return {
      file_id: item.id,
      file_name: item.name,
      web_url: item.webUrl,
      size: item.size,
      uploaded_at: new Date().toISOString()
    };
  }

  private async createFolder(connection: any, params: any): Promise<any> {
    const { folder_name, parent_folder_id, conflict_behavior = 'rename' } = params;

    const endpoint = parent_folder_id
      ? `/me/drive/items/${parent_folder_id}/children`
      : '/me/drive/root/children';

    const body = {
      name: folder_name,
      folder: {},
      '@microsoft.graph.conflictBehavior': conflict_behavior
    };

    const item = await this.makeGraphRequest(connection, endpoint, 'POST', body);

    return {
      folder_id: item.id,
      folder_name: item.name,
      web_url: item.webUrl,
      created_at: item.createdDateTime
    };
  }

  private async getOrCreateFolder(connection: any, params: any): Promise<any> {
    const { folder_name, parent_folder_id } = params;

    // First, try to find existing folder
    const endpoint = parent_folder_id
      ? `/me/drive/items/${parent_folder_id}/children`
      : '/me/drive/root/children';

    // Search for folder with exact name
    const searchUrl = `${endpoint}?$filter=name eq '${folder_name}' and folder ne null`;

    try {
      const searchResult = await this.makeGraphRequest(connection, searchUrl, 'GET');

      if (searchResult.value && searchResult.value.length > 0) {
        // Folder exists
        const existing = searchResult.value[0];
        return {
          folder_id: existing.id,
          folder_name: existing.name,
          web_url: existing.webUrl,
          created: false,
          created_at: existing.createdDateTime
        };
      }
    } catch (error) {
      this.logger.debug({ error }, 'Search failed, will create folder');
    }

    // Folder doesn't exist, create it
    const body = {
      name: folder_name,
      folder: {},
      '@microsoft.graph.conflictBehavior': 'fail' // Fail if exists (shouldn't happen)
    };

    const item = await this.makeGraphRequest(connection, endpoint, 'POST', body);

    return {
      folder_id: item.id,
      folder_name: item.name,
      web_url: item.webUrl,
      created: true,
      created_at: item.createdDateTime
    };
  }

  private async deleteFile(connection: any, params: any): Promise<any> {
    const { file_id } = params;

    // Get file name before deleting
    const metadata = await this.makeGraphRequest(connection, `/me/drive/items/${file_id}`, 'GET');

    // Delete the file
    await this.makeGraphRequest(connection, `/me/drive/items/${file_id}`, 'DELETE');

    return {
      file_id,
      file_name: metadata.name,
      deleted: true,
      deleted_at: new Date().toISOString()
    };
  }

  private async moveFile(connection: any, params: any): Promise<any> {
    const { file_id, destination_folder_id, new_name } = params;

    const updates: any = {
      parentReference: {
        id: destination_folder_id
      }
    };

    if (new_name) {
      updates.name = new_name;
    }

    const item = await this.makeGraphRequest(connection, `/me/drive/items/${file_id}`, 'PATCH', updates);

    return {
      file_id: item.id,
      file_name: item.name,
      new_parent_id: destination_folder_id,
      web_url: item.webUrl,
      moved_at: new Date().toISOString()
    };
  }

  private async copyFile(connection: any, params: any): Promise<any> {
    const { file_id, destination_folder_id, new_name } = params;

    const body: any = {};

    if (destination_folder_id) {
      body.parentReference = { id: destination_folder_id };
    }

    if (new_name) {
      body.name = new_name;
    }

    // Copy is an async operation, returns 202 Accepted with monitor URL
    const response = await fetch(`${this.graphBaseUrl}/me/drive/items/${file_id}/copy`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (response.status !== 202) {
      const errorText = await response.text();
      throw new Error(`Copy failed: ${response.status} - ${errorText}`);
    }

    // Get monitor URL from Location header
    const monitorUrl = response.headers.get('Location');

    return {
      file_id: 'pending', // Copy is async, ID not immediately available
      file_name: new_name || 'Copy in progress',
      monitor_url: monitorUrl,
      copied_at: new Date().toISOString()
    };
  }

  private async createShareLink(connection: any, params: any): Promise<any> {
    const { file_id, link_type = 'view', scope = 'anonymous', expiration_date_time, password } = params;

    // Get file metadata
    const metadata = await this.makeGraphRequest(connection, `/me/drive/items/${file_id}`, 'GET');

    const body: any = {
      type: link_type,
      scope: scope
    };

    if (expiration_date_time) {
      body.expirationDateTime = expiration_date_time;
    }

    if (password) {
      body.password = password;
    }

    const permission = await this.makeGraphRequest(
      connection,
      `/me/drive/items/${file_id}/createLink`,
      'POST',
      body
    );

    return {
      file_id,
      file_name: metadata.name,
      share_link: permission.link.webUrl,
      link_type,
      scope,
      expires_at: expiration_date_time || null,
      created_at: new Date().toISOString()
    };
  }

  private async getThumbnails(connection: any, params: any): Promise<any> {
    const { file_id, size = 'medium' } = params;

    const response = await this.makeGraphRequest(
      connection,
      `/me/drive/items/${file_id}/thumbnails`,
      'GET'
    );

    if (!response.value || response.value.length === 0) {
      throw new Error('Thumbnails not available for this file');
    }

    const thumbnailSet = response.value[0];

    return {
      file_id,
      thumbnails: {
        small: thumbnailSet.small?.url,
        medium: thumbnailSet.medium?.url,
        large: thumbnailSet.large?.url
      },
      retrieved_at: new Date().toISOString()
    };
  }

  // === HELPER METHODS ===

  private async makeGraphRequest(
    connection: any,
    endpoint: string,
    method: string = 'GET',
    body?: any
  ): Promise<any> {
    const url = endpoint.startsWith('http') ? endpoint : `${this.graphBaseUrl}${endpoint}`;

    const options: RequestInit = {
      method,
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      ...(body && { body: JSON.stringify(body) })
    };

    this.logger.debug({ url, method }, 'Making Graph API request');

    const response = await fetch(url, options);

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error({ status: response.status, errorText }, 'Graph API request failed');

      // Map common errors to user-friendly messages
      if (response.status === 401) {
        throw new Error('auth_failed');
      } else if (response.status === 404) {
        throw new Error('not_found');
      } else if (response.status === 403) {
        throw new Error('insufficient_permissions');
      } else if (response.status === 429) {
        throw new Error('quota_exceeded');
      }

      throw new Error(`Graph API error: ${response.status} - ${errorText}`);
    }

    // DELETE requests may return 204 No Content
    if (response.status === 204) {
      return {};
    }

    return await response.json();
  }

  private buildFileTypeFilter(fileTypes: string[]): string | null {
    const filters: string[] = [];

    const mimeTypeMap: Record<string, string[]> = {
      document: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword'],
      spreadsheet: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'],
      presentation: ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/vnd.ms-powerpoint'],
      pdf: ['application/pdf'],
      image: ['image/jpeg', 'image/png', 'image/gif'],
      video: ['video/mp4', 'video/quicktime'],
      folder: ['folder']
    };

    for (const type of fileTypes) {
      if (type === 'folder') {
        filters.push('folder ne null');
      } else if (type === 'all') {
        return null; // No filter needed
      } else if (mimeTypeMap[type]) {
        const mimeFilters = mimeTypeMap[type].map(mime => `file/mimeType eq '${mime}'`);
        filters.push(`(${mimeFilters.join(' or ')})`);
      }
    }

    return filters.length > 0 ? filters.join(' or ') : null;
  }

  private getMimeType(item: any): string {
    if (item.folder) {
      return 'application/vnd.microsoft.folder';
    }
    if (item.file && item.file.mimeType) {
      return item.file.mimeType;
    }
    return 'application/octet-stream';
  }
}
