// lib/server/google-drive-plugin-executor.ts

import { UserPluginConnections } from './user-plugin-connections';
import { PluginManagerV2 } from './plugin-manager-v2';
import { ExecutionResult } from '@/lib/types/plugin-types';
import { GoogleBasePluginExecutor } from './google-base-plugin-executor';

const pluginName = 'google-drive'; // Current plugin key

export class GoogleDrivePluginExecutor extends GoogleBasePluginExecutor {
  constructor(userConnections: UserPluginConnections, pluginManager: PluginManagerV2) {
    super(pluginName, userConnections, pluginManager);
  }
  
  // Execute Gmail action with validation and error handling
  protected async executeSpecificAction(
    connection: any,
    actionName: string,
    parameters: any
  ): Promise<any> {
    // Execute the specific action
      let result: any;
      switch (actionName) {
        case 'list_files':
          result = await this.listFiles(connection, parameters);
          break;
        case 'search_files':
          result = await this.searchFiles(connection, parameters);
          break;
        case 'get_file_metadata':
          result = await this.getFileMetadata(connection, parameters);
          break;
        case 'read_file_content':
          result = await this.readFileContent(connection, parameters);
          break;
        case 'get_folder_contents':
          result = await this.getFolderContents(connection, parameters);
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

  // List files with optional filtering
  private async listFiles(connection: any, parameters: any): Promise<any> {
    this.logger.debug('DEBUG: Listing files via Google Drive API');

    // Build query
    let query = this.buildListQuery(parameters);
    
    // Build request URL
    const url = new URL(`${this.googleApisUrl}/drive/v3/files`);
    url.searchParams.set('pageSize', (parameters.max_results || 20).toString());
    url.searchParams.set('fields', 'nextPageToken, files(id, name, mimeType, size, createdTime, modifiedTime, owners, webViewLink, iconLink, thumbnailLink, parents, shared, starred, trashed)');
    
    if (query) {
      url.searchParams.set('q', query);
    }
    
    if (parameters.order_by) {
      const orderByMap: Record<string, string> = {
        'modifiedTime': 'modifiedTime desc',
        'name': 'name',
        'createdTime': 'createdTime desc',
        'folder': 'folder,name',
        'starred': 'starred desc,name'
      };
      url.searchParams.set('orderBy', orderByMap[parameters.order_by] || 'modifiedTime desc');
    }

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.text();
      this.logger.error({ err: error }, 'DEBUG: Drive list failed:', errorData);
      throw new Error(`Drive API error: ${response.status} - ${errorData}`);
    }

    const data = await response.json();
    
    return {
      files: data.files || [],
      file_count: (data.files || []).length,
      next_page_token: data.nextPageToken,
      has_more: !!data.nextPageToken,
      query_used: query,
      retrieved_at: new Date().toISOString()
    };
  }

  // Search files using Drive's query syntax
  private async searchFiles(connection: any, parameters: any): Promise<any> {
    this.logger.debug('DEBUG: Searching files via Google Drive API');

    // Build search query
    let query = parameters.query || '';
    
    // Add search scope
    if (parameters.search_scope) {
      const scopeQueries: Record<string, string> = {
        'owned_by_me': "'me' in owners",
        'shared_with_me': "sharedWithMe = true",
        'starred': "starred = true"
      };
      
      if (scopeQueries[parameters.search_scope]) {
        query = query ? `(${query}) and ${scopeQueries[parameters.search_scope]}` : scopeQueries[parameters.search_scope];
      }
    }
    
    // Add file type filters
    if (parameters.file_types && parameters.file_types.length > 0) {
      const mimeTypes = this.fileTypesToMimeTypes(parameters.file_types);
      if (mimeTypes.length > 0) {
        const mimeQuery = mimeTypes.map(mt => `mimeType = '${mt}'`).join(' or ');
        query = query ? `(${query}) and (${mimeQuery})` : `(${mimeQuery})`;
      }
    }
    
    // Exclude trashed files by default
    query = query ? `(${query}) and trashed = false` : 'trashed = false';

    const url = new URL(`${this.googleApisUrl}/drive/v3/files`);
    url.searchParams.set('q', query);
    url.searchParams.set('pageSize', (parameters.max_results || 20).toString());
    url.searchParams.set('fields', 'nextPageToken, files(id, name, mimeType, size, createdTime, modifiedTime, owners, webViewLink, iconLink, thumbnailLink, parents, shared, starred)');
    url.searchParams.set('orderBy', 'modifiedTime desc');

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.text();
      this.logger.error({ err: error }, 'DEBUG: Drive search failed:', errorData);
      throw new Error(`Drive search failed: ${response.status} - ${errorData}`);
    }

    const data = await response.json();
    
    if (!data.files || data.files.length === 0) {
      return {
        files: [],
        file_count: 0,
        search_query: query,
        message: 'No files found matching search criteria'
      };
    }

    return {
      files: data.files,
      file_count: data.files.length,
      search_query: query,
      next_page_token: data.nextPageToken,
      has_more: !!data.nextPageToken,
      searched_at: new Date().toISOString()
    };
  }

  // Get detailed metadata for a specific file
  private async getFileMetadata(connection: any, parameters: any): Promise<any> {
    this.logger.debug('DEBUG: Getting file metadata via Google Drive API');

    const fileId = parameters.file_id;
    let fields = 'id, name, mimeType, size, createdTime, modifiedTime, description, owners, lastModifyingUser, webViewLink, webContentLink, iconLink, thumbnailLink, parents, shared, starred, trashed, version, originalFilename, fileExtension, md5Checksum, headRevisionId, sharingUser, capabilities';
    
    if (parameters.include_permissions) {
      fields += ', permissions(id, type, emailAddress, role, displayName, photoLink, deleted)';
    }
    
    if (parameters.include_export_links) {
      fields += ', exportLinks';
    }

    const url = new URL(`${this.googleApisUrl}/drive/v3/files/${fileId}`);
    url.searchParams.set('fields', fields);

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.text();
      this.logger.error({ err: error }, 'DEBUG: Get file metadata failed:', errorData);
      throw new Error(`Failed to get file metadata: ${response.status} - ${errorData}`);
    }

    const fileData = await response.json();
    
    return {
      file: fileData,
      file_id: fileData.id,
      file_name: fileData.name,
      file_type: this.mimeTypeToFileType(fileData.mimeType),
      mime_type: fileData.mimeType,
      size_bytes: fileData.size ? parseInt(fileData.size) : 0,
      created_at: fileData.createdTime,
      modified_at: fileData.modifiedTime,
      owner: fileData.owners?.[0]?.displayName || fileData.owners?.[0]?.emailAddress,
      web_view_link: fileData.webViewLink,
      is_folder: fileData.mimeType === 'application/vnd.google-apps.folder',
      retrieved_at: new Date().toISOString()
    };
  }

  // Read file content
  private async readFileContent(connection: any, parameters: any): Promise<any> {
    this.logger.debug('DEBUG: Reading file content via Google Drive API');

    const fileId = parameters.file_id;
    
    // First, get file metadata to determine type
    const metadataUrl = new URL(`${this.googleApisUrl}/drive/v3/files/${fileId}`);
    metadataUrl.searchParams.set('fields', 'id, name, mimeType, size');

    const metadataResponse = await fetch(metadataUrl.toString(), {
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Accept': 'application/json',
      },
    });

    if (!metadataResponse.ok) {
      throw new Error(`File not found: ${metadataResponse.status}`);
    }

    const metadata = await metadataResponse.json();
    const isGoogleDoc = metadata.mimeType.startsWith('application/vnd.google-apps.');
    
    // Check file size limit
    const maxSizeMb = parameters.max_size_mb || 5;
    const maxSizeBytes = maxSizeMb * 1024 * 1024;
    
    if (metadata.size && parseInt(metadata.size) > maxSizeBytes) {
      throw new Error(`File too large: ${this.formatFileSize(metadata.size)}. Maximum allowed: ${maxSizeMb}MB`);
    }

    let content: string;
    let exportFormat = parameters.export_format || 'text/plain';

    if (isGoogleDoc) {
      // Export Google Workspace files
      const exportUrl = `${this.googleApisUrl}/drive/v3/files/${fileId}/export`;
      const exportParams = new URLSearchParams({ mimeType: exportFormat });
      
      const exportResponse = await fetch(`${exportUrl}?${exportParams}`, {
        headers: {
          'Authorization': `Bearer ${connection.access_token}`,
        },
      });

      if (!exportResponse.ok) {
        throw new Error(`Failed to export file: ${exportResponse.status}`);
      }

      content = await exportResponse.text();
    } else {
      // Download regular files
      const downloadUrl = `${this.googleApisUrl}/drive/v3/files/${fileId}?alt=media`;
      
      const downloadResponse = await fetch(downloadUrl, {
        headers: {
          'Authorization': `Bearer ${connection.access_token}`,
        },
      });

      if (!downloadResponse.ok) {
        throw new Error(`Failed to download file: ${downloadResponse.status}`);
      }

      content = await downloadResponse.text();
    }

    return {
      file_id: fileId,
      file_name: metadata.name,
      file_size: this.formatFileSize(metadata.size),
      mime_type: metadata.mimeType,
      content: content,
      content_length: content.length,
      export_format: isGoogleDoc ? exportFormat : 'original',
      read_at: new Date().toISOString()
    };
  }

  // Get folder contents
  private async getFolderContents(connection: any, parameters: any): Promise<any> {
    this.logger.debug('DEBUG: Getting folder contents via Google Drive API');

    const folderId = parameters.folder_id === 'root' ? 'root' : parameters.folder_id;
    
    // Build query for folder contents
    let query = `'${folderId}' in parents and trashed = false`;
    
    const url = new URL(`${this.googleApisUrl}/drive/v3/files`);
    url.searchParams.set('q', query);
    url.searchParams.set('pageSize', (parameters.max_results || 50).toString());
    url.searchParams.set('fields', 'nextPageToken, files(id, name, mimeType, size, createdTime, modifiedTime, iconLink, webViewLink, parents, shared, starred)');
    
    if (parameters.order_by) {
      const orderByMap: Record<string, string> = {
        'name': 'name',
        'modifiedTime': 'modifiedTime desc',
        'createdTime': 'createdTime desc',
        'folder': 'folder,name'
      };
      url.searchParams.set('orderBy', orderByMap[parameters.order_by] || 'name');
    }

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.text();
      this.logger.error({ err: error }, 'DEBUG: Get folder contents failed:', errorData);
      throw new Error(`Failed to get folder contents: ${response.status} - ${errorData}`);
    }

    const data = await response.json();
    
    // Get folder name
    let folderName = folderId === 'root' ? 'My Drive' : 'Unknown Folder';
    if (folderId !== 'root') {
      try {
        const folderMetadata = await this.getFileMetadata(connection, { file_id: folderId });
        folderName = folderMetadata.file_name;
      } catch (error) {
        this.logger.warn({ err: error }, 'DEBUG: Could not get folder name:', error);
      }
    }
    
    // Separate folders and files
    const folders = (data.files || []).filter((f: any) => f.mimeType === 'application/vnd.google-apps.folder');
    const files = (data.files || []).filter((f: any) => f.mimeType !== 'application/vnd.google-apps.folder');

    return {
      folder_id: folderId,
      folder_name: folderName,
      items: data.files || [],
      item_count: (data.files || []).length,
      folder_count: folders.length,
      file_count: files.length,
      folders: folders,
      files: files,
      next_page_token: data.nextPageToken,
      has_more: !!data.nextPageToken,
      retrieved_at: new Date().toISOString()
    };
  }

  // Private helper methods

  // Build query for list_files action
  private buildListQuery(parameters: any): string {
    const conditions: string[] = [];
    
    // Folder filter
    if (parameters.folder_id) {
      conditions.push(`'${parameters.folder_id}' in parents`);
    }
    
    // File type filters
    if (parameters.file_types && parameters.file_types.length > 0 && !parameters.file_types.includes('all')) {
      const mimeTypes = this.fileTypesToMimeTypes(parameters.file_types);
      if (mimeTypes.length > 0) {
        const mimeQuery = mimeTypes.map(mt => `mimeType = '${mt}'`).join(' or ');
        conditions.push(`(${mimeQuery})`);
      }
    }
    
    // Trashed filter
    if (!parameters.include_trashed) {
      conditions.push('trashed = false');
    }
    
    return conditions.join(' and ');
  }

  // Convert file types to MIME types
  private fileTypesToMimeTypes(fileTypes: string[]): string[] {
    const mimeTypeMap: Record<string, string> = {
      'document': 'application/vnd.google-apps.document',
      'spreadsheet': 'application/vnd.google-apps.spreadsheet',
      'presentation': 'application/vnd.google-apps.presentation',
      'pdf': 'application/pdf',
      'image': 'image/',
      'video': 'video/',
      'folder': 'application/vnd.google-apps.folder'
    };
    
    return fileTypes
      .filter(ft => mimeTypeMap[ft])
      .map(ft => mimeTypeMap[ft]);
  }

  // Convert MIME type to friendly file type
  private mimeTypeToFileType(mimeType: string): string {
    if (mimeType === 'application/vnd.google-apps.folder') return 'folder';
    if (mimeType === 'application/vnd.google-apps.document') return 'document';
    if (mimeType === 'application/vnd.google-apps.spreadsheet') return 'spreadsheet';
    if (mimeType === 'application/vnd.google-apps.presentation') return 'presentation';
    if (mimeType === 'application/pdf') return 'pdf';
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType.startsWith('audio/')) return 'audio';
    if (mimeType.startsWith('text/')) return 'text';
    return 'file';
  }

  // Format file size
  private formatFileSize(bytes: string | number | undefined): string {
    if (!bytes) return '0 B';
    const size = typeof bytes === 'string' ? parseInt(bytes) : bytes;
    
    const units = ['B', 'KB', 'MB', 'GB'];
    let unitIndex = 0;
    let fileSize = size;
    
    while (fileSize >= 1024 && unitIndex < units.length - 1) {
      fileSize /= 1024;
      unitIndex++;
    }
    
    return `${fileSize.toFixed(2)} ${units[unitIndex]}`;
  }  

  // Override to handle Drive-specific errors
  protected mapGoogleServiceSpecificError(error: any, commonErrors: Record<string, string>): string | null {
    if (error.message?.includes('too large')) {
      return commonErrors.file_too_large || error.message;
    }

    if (error.message?.includes('export') || error.message?.includes('unsupported')) {
      return commonErrors.export_failed || commonErrors.unsupported_format || error.message;
    }

    // Return null to fall back to common Google error handling
    return null;
  }  

  protected async performConnectionTest(connection: any): Promise<any> {
    // Test with a simple API call (get about info)
      const response = await fetch(`${this.googleApisUrl}/drive/v3/about?fields=user,storageQuota`, {
        headers: {
          'Authorization': `Bearer ${connection.access_token}`,
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        return {
          success: false,
          error: 'connection_test_failed',
          message: `Google Drive connection test failed: ${response.status}`
        };
      }

      const aboutData = await response.json();
      
      return {
        success: true,
        data: {
          user: aboutData.user?.displayName || aboutData.user?.emailAddress,
          email: aboutData.user?.emailAddress,
          storage_limit: this.formatFileSize(aboutData.storageQuota?.limit),
          storage_used: this.formatFileSize(aboutData.storageQuota?.usage)
        },
        message: `Google Drive connection active for ${aboutData.user?.emailAddress}`
      };
  }

  /**
   * List all available folders for dynamic dropdown options
   * This method is called by the fetch-options API route
   */
  async list_folders(connection: any, options: { page?: number; limit?: number } = {}): Promise<Array<{value: string; label: string; description?: string; icon?: string; group?: string}>> {
    try {
      const { limit = 100 } = options;

      const url = new URL('https://www.googleapis.com/drive/v3/files');
      url.searchParams.set('q', "mimeType='application/vnd.google-apps.folder' and trashed=false");
      url.searchParams.set('fields', 'files(id,name,modifiedTime,owners)');
      url.searchParams.set('pageSize', limit.toString());
      url.searchParams.set('orderBy', 'modifiedTime desc');

      const response = await fetch(url.toString(), {
        headers: {
          'Authorization': `Bearer ${connection.access_token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Google Drive API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      if (!data.files || !Array.isArray(data.files)) {
        return [];
      }

      // Transform to option format
      return data.files.map((file: any) => ({
        value: file.id,
        label: file.name,
        description: file.owners?.[0]?.displayName ? `Owner: ${file.owners[0].displayName}` : undefined,
        icon: '📁',
        group: 'My Folders',
      }));

    } catch (error: any) {
      this.logger.error({ err: error }, 'Error listing Google Drive folders for options');
      throw error;
    }
  }

  /**
   * List all available files for dynamic dropdown options
   * This method is called by the fetch-options API route
   */
  async list_files(connection: any, options: { page?: number; limit?: number } = {}): Promise<Array<{value: string; label: string; description?: string; icon?: string; group?: string}>> {
    try {
      const { limit = 100 } = options;

      const url = new URL('https://www.googleapis.com/drive/v3/files');
      url.searchParams.set('q', "trashed=false and mimeType!='application/vnd.google-apps.folder'");
      url.searchParams.set('fields', 'files(id,name,mimeType,modifiedTime,owners)');
      url.searchParams.set('pageSize', limit.toString());
      url.searchParams.set('orderBy', 'modifiedTime desc');

      const response = await fetch(url.toString(), {
        headers: {
          'Authorization': `Bearer ${connection.access_token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Google Drive API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      if (!data.files || !Array.isArray(data.files)) {
        return [];
      }

      // Helper to get icon based on mime type
      const getFileIcon = (mimeType: string): string => {
        if (mimeType.includes('spreadsheet')) return '📊';
        if (mimeType.includes('document')) return '📄';
        if (mimeType.includes('presentation')) return '📊';
        if (mimeType.includes('image')) return '🖼️';
        if (mimeType.includes('video')) return '🎥';
        if (mimeType.includes('audio')) return '🎵';
        if (mimeType.includes('pdf')) return '📕';
        return '📄';
      };

      // Transform to option format
      return data.files.map((file: any) => ({
        value: file.id,
        label: file.name,
        description: file.owners?.[0]?.displayName ? `Owner: ${file.owners[0].displayName}` : undefined,
        icon: getFileIcon(file.mimeType),
        group: 'My Files',
      }));

    } catch (error: any) {
      this.logger.error({ err: error }, 'Error listing Google Drive files for options');
      throw error;
    }
  }
}