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
        case 'create_folder':
          result = await this.createFolder(connection, parameters);
          break;
        case 'get_or_create_folder':
          result = await this.getOrCreateFolder(connection, parameters);
          break;
        case 'upload_file':
          result = await this.uploadFile(connection, parameters);
          break;
        case 'share_file':
          result = await this.shareFile(connection, parameters);
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
      this.logger.error({ err: errorData, status: response.status }, 'Drive list failed');
      throw new Error(`Drive API error: ${response.status} - ${errorData}`);
    }

    const data = await response.json();
    
    return {
      files: data.files || [],
      // Primary format (snake_case to match schema)
      file_count: (data.files || []).length,
      next_page_token: data.nextPageToken,
      has_more: !!data.nextPageToken,
      query_used: query,
      retrieved_at: new Date().toISOString(),
      // Legacy format (camelCase for backward compatibility)
      fileCount: (data.files || []).length,
      nextPageToken: data.nextPageToken,
      hasMore: !!data.nextPageToken,
      queryUsed: query,
      retrievedAt: new Date().toISOString()
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
      this.logger.error({ err: errorData, status: response.status }, 'Drive search failed');
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
      // Primary format (snake_case to match schema)
      file_count: data.files.length,
      search_query: query,
      next_page_token: data.nextPageToken,
      has_more: !!data.nextPageToken,
      searched_at: new Date().toISOString(),
      // Legacy format (camelCase for backward compatibility)
      fileCount: data.files.length,
      searchQuery: query,
      nextPageToken: data.nextPageToken,
      hasMore: !!data.nextPageToken,
      searchedAt: new Date().toISOString()
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
      this.logger.error({ err: errorData, status: response.status }, 'Get file metadata failed');
      throw new Error(`Failed to get file metadata: ${response.status} - ${errorData}`);
    }

    const fileData = await response.json();
    
    return {
      file: fileData,
      // Primary format (snake_case to match schema)
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
      retrieved_at: new Date().toISOString(),
      // Legacy format (camelCase for backward compatibility)
      fileId: fileData.id,
      fileName: fileData.name,
      fileType: this.mimeTypeToFileType(fileData.mimeType),
      mimeType: fileData.mimeType,
      sizeBytes: fileData.size ? parseInt(fileData.size) : 0,
      createdAt: fileData.createdTime,
      modifiedAt: fileData.modifiedTime,
      webViewLink: fileData.webViewLink,
      isFolder: fileData.mimeType === 'application/vnd.google-apps.folder',
      retrievedAt: new Date().toISOString()
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
      // Primary format (snake_case to match schema)
      file_id: fileId,
      file_name: metadata.name,
      file_size: this.formatFileSize(metadata.size),
      mime_type: metadata.mimeType,
      content: content,
      content_length: content.length,
      export_format: isGoogleDoc ? exportFormat : 'original',
      read_at: new Date().toISOString(),
      // Legacy format (camelCase for backward compatibility)
      fileId: fileId,
      fileName: metadata.name,
      fileSize: this.formatFileSize(metadata.size),
      mimeType: metadata.mimeType,
      contentLength: content.length,
      exportFormat: isGoogleDoc ? exportFormat : 'original',
      readAt: new Date().toISOString()
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
      this.logger.error({ err: errorData, status: response.status }, 'Get folder contents failed');
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
      // Primary format (snake_case to match schema)
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
      retrieved_at: new Date().toISOString(),
      // Legacy format (camelCase for backward compatibility)
      folderId: folderId,
      folderName: folderName,
      itemCount: (data.files || []).length,
      folderCount: folders.length,
      fileCount: files.length,
      nextPageToken: data.nextPageToken,
      hasMore: !!data.nextPageToken,
      retrievedAt: new Date().toISOString()
    };
  }

  // Create a new folder
  private async createFolder(connection: any, parameters: any): Promise<any> {
    this.logger.debug('DEBUG: Creating folder via Google Drive API');

    const folderName = parameters.folder_name;
    if (!folderName) {
      throw new Error('folder_name is required');
    }

    // Build request body
    const requestBody: any = {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder'
    };

    // Add parent folder if specified
    if (parameters.parent_folder_id) {
      requestBody.parents = [parameters.parent_folder_id];
    }

    // Add description if specified
    if (parameters.description) {
      requestBody.description = parameters.description;
    }

    const response = await fetch(`${this.googleApisUrl}/drive/v3/files`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.text();
      this.logger.error({ err: errorData }, 'DEBUG: Create folder failed:', errorData);
      throw new Error(`Failed to create folder: ${response.status} - ${errorData}`);
    }

    const folder = await response.json();

    return {
      // Primary format (snake_case to match schema)
      folder_id: folder.id,
      folder_name: folder.name,
      web_view_link: folder.webViewLink || `https://drive.google.com/drive/folders/${folder.id}`,
      created_at: new Date().toISOString(),
      // Legacy format (camelCase for backward compatibility)
      folderId: folder.id,
      folderName: folder.name,
      webViewLink: folder.webViewLink || `https://drive.google.com/drive/folders/${folder.id}`,
      createdAt: new Date().toISOString()
    };
  }

  // Get existing folder by name or create if it doesn't exist (prevents duplicates)
  private async getOrCreateFolder(connection: any, parameters: any): Promise<any> {
    this.logger.debug('DEBUG: Get or create folder via Google Drive API');

    const folderName = parameters.folder_name;
    if (!folderName) {
      throw new Error('folder_name is required');
    }

    // Build search query
    let query = `name='${folderName.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;

    // Add parent folder constraint if specified
    if (parameters.parent_folder_id) {
      query += ` and '${parameters.parent_folder_id}' in parents`;
    }

    // Search for existing folder
    const searchUrl = new URL(`${this.googleApisUrl}/drive/v3/files`);
    searchUrl.searchParams.set('q', query);
    searchUrl.searchParams.set('pageSize', '1');
    searchUrl.searchParams.set('fields', 'files(id, name, webViewLink)');

    const searchResponse = await fetch(searchUrl.toString(), {
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Accept': 'application/json',
      },
    });

    if (!searchResponse.ok) {
      const errorData = await searchResponse.text();
      this.logger.error({ err: errorData }, 'DEBUG: Folder search failed:', errorData);
      throw new Error(`Failed to search for folder: ${searchResponse.status} - ${errorData}`);
    }

    const searchData = await searchResponse.json();

    // If folder exists, return it
    if (searchData.files && searchData.files.length > 0) {
      const existingFolder = searchData.files[0];
      this.logger.debug({ folderId: existingFolder.id }, 'DEBUG: Found existing folder');

      return {
        // Primary format (snake_case to match schema)
        folder_id: existingFolder.id,
        folder_name: existingFolder.name,
        web_view_link: existingFolder.webViewLink || `https://drive.google.com/drive/folders/${existingFolder.id}`,
        parent_folder_id: parameters.parent_folder_id,
        created: false, // Folder already existed
        created_at: new Date().toISOString(),
        // Legacy format (camelCase for backward compatibility)
        folderId: existingFolder.id,
        folderName: existingFolder.name,
        webViewLink: existingFolder.webViewLink || `https://drive.google.com/drive/folders/${existingFolder.id}`,
        createdAt: new Date().toISOString()
      };
    }

    // Folder doesn't exist - create it
    this.logger.debug('DEBUG: Folder not found, creating new one');

    const requestBody: any = {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder'
    };

    if (parameters.parent_folder_id) {
      requestBody.parents = [parameters.parent_folder_id];
    }

    if (parameters.description) {
      requestBody.description = parameters.description;
    }

    const createResponse = await fetch(`${this.googleApisUrl}/drive/v3/files`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    if (!createResponse.ok) {
      const errorData = await createResponse.text();
      this.logger.error({ err: errorData }, 'DEBUG: Create folder failed:', errorData);
      throw new Error(`Failed to create folder: ${createResponse.status} - ${errorData}`);
    }

    const newFolder = await createResponse.json();
    this.logger.debug({ folderId: newFolder.id }, 'DEBUG: Created new folder');

    return {
      // Primary format (snake_case to match schema)
      folder_id: newFolder.id,
      folder_name: newFolder.name,
      web_view_link: newFolder.webViewLink || `https://drive.google.com/drive/folders/${newFolder.id}`,
      parent_folder_id: parameters.parent_folder_id,
      created: true, // Folder was newly created
      created_at: new Date().toISOString(),
      // Legacy format (camelCase for backward compatibility)
      folderId: newFolder.id,
      folderName: newFolder.name,
      webViewLink: newFolder.webViewLink || `https://drive.google.com/drive/folders/${newFolder.id}`,
      createdAt: new Date().toISOString()
    };
  }

  // Upload a file to Drive
  private async uploadFile(connection: any, parameters: any): Promise<any> {
    this.logger.debug('DEBUG: Uploading file via Google Drive API');

    const fileName = parameters.file_name;
    const fileContent = parameters.file_content;

    if (!fileName) {
      throw new Error('file_name is required');
    }
    if (!fileContent) {
      throw new Error('file_content is required');
    }

    // Determine MIME type
    const mimeType = parameters.mime_type || 'application/octet-stream';

    // Build metadata
    const metadata: any = {
      name: fileName,
      mimeType: mimeType
    };

    // Add parent folder if specified
    if (parameters.folder_id) {
      metadata.parents = [parameters.folder_id];
    }

    // Add description if specified
    if (parameters.description) {
      metadata.description = parameters.description;
    }

    // Decode base64 content if needed
    let binaryContent: string;
    try {
      // Check if content is base64 encoded
      if (fileContent.match(/^[A-Za-z0-9+/]+=*$/)) {
        binaryContent = fileContent;
      } else {
        // Encode to base64 if not already encoded
        binaryContent = Buffer.from(fileContent).toString('base64');
      }
    } catch (error) {
      this.logger.warn({ err: error }, 'DEBUG: Content encoding issue, using as-is');
      binaryContent = fileContent;
    }

    // Create multipart upload body
    const boundary = '-------314159265358979323846';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const multipartBody =
      delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) +
      delimiter +
      `Content-Type: ${mimeType}\r\n` +
      'Content-Transfer-Encoding: base64\r\n\r\n' +
      binaryContent +
      closeDelimiter;

    const response = await fetch(`${this.googleApisUrl}/upload/drive/v3/files?uploadType=multipart`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Accept': 'application/json',
      },
      body: multipartBody
    });

    if (!response.ok) {
      const errorData = await response.text();
      this.logger.error({ err: errorData }, 'DEBUG: Upload file failed:', errorData);
      throw new Error(`Failed to upload file: ${response.status} - ${errorData}`);
    }

    const file = await response.json();

    return {
      // Primary format (snake_case to match schema)
      file_id: file.id,
      file_name: file.name,
      file_size: this.formatFileSize(file.size),
      mime_type: file.mimeType,
      web_view_link: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
      uploaded_at: new Date().toISOString(),
      // Legacy format (camelCase for backward compatibility)
      fileId: file.id,
      fileName: file.name,
      fileSize: this.formatFileSize(file.size),
      mimeType: file.mimeType,
      webViewLink: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
      uploadedAt: new Date().toISOString()
    };
  }

  // Share a file with permissions
  private async shareFile(connection: any, parameters: any): Promise<any> {
    this.logger.debug('DEBUG: Sharing file via Google Drive API');

    const fileId = parameters.file_id;
    if (!fileId) {
      throw new Error('file_id is required');
    }

    // Default permission: anyone with link can view
    const permissionType = parameters.permission_type || 'anyone';
    const role = parameters.role || 'reader';

    // Build permission request
    const permission: any = {
      type: permissionType,
      role: role
    };

    // Add email addresses if specified (for user/group permissions)
    if (parameters.email_addresses && Array.isArray(parameters.email_addresses)) {
      // For user/group type, we need to create individual permissions
      if (permissionType === 'user' || permissionType === 'group') {
        const permissionIds: string[] = [];

        for (const email of parameters.email_addresses) {
          const userPermission = {
            type: permissionType,
            role: role,
            emailAddress: email
          };

          const response = await fetch(`${this.googleApisUrl}/drive/v3/files/${fileId}/permissions`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${connection.access_token}`,
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            body: JSON.stringify(userPermission)
          });

          if (!response.ok) {
            const errorData = await response.text();
            this.logger.error({ err: errorData }, `DEBUG: Failed to share with ${email}:`, errorData);
            throw new Error(`Failed to share file with ${email}: ${response.status} - ${errorData}`);
          }

          const permissionData = await response.json();
          permissionIds.push(permissionData.id);
        }

        // Get file metadata for web view link
        const fileMetadata = await this.getFileMetadata(connection, { file_id: fileId });

        return {
          // Primary format (snake_case to match schema)
          permission_ids: permissionIds,
          file_id: fileId,
          web_view_link: fileMetadata.web_view_link,
          shared_with: parameters.email_addresses,
          shared_at: new Date().toISOString(),
          // Legacy format (camelCase for backward compatibility)
          permissionIds: permissionIds,
          fileId: fileId,
          webViewLink: fileMetadata.web_view_link,
          sharedWith: parameters.email_addresses,
          sharedAt: new Date().toISOString()
        };
      }
    }

    // Create single permission (for 'anyone' or 'domain' type)
    const response = await fetch(`${this.googleApisUrl}/drive/v3/files/${fileId}/permissions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(permission)
    });

    if (!response.ok) {
      const errorData = await response.text();
      this.logger.error({ err: errorData }, 'DEBUG: Share file failed:', errorData);
      throw new Error(`Failed to share file: ${response.status} - ${errorData}`);
    }

    const permissionData = await response.json();

    // Get file metadata for web view link
    const fileMetadata = await this.getFileMetadata(connection, { file_id: fileId });

    return {
      // Primary format (snake_case to match schema)
      permission_id: permissionData.id,
      file_id: fileId,
      web_view_link: fileMetadata.web_view_link,
      permission_type: permissionType,
      role: role,
      shared_at: new Date().toISOString(),
      // Legacy format (camelCase for backward compatibility)
      permissionId: permissionData.id,
      fileId: fileId,
      webViewLink: fileMetadata.web_view_link,
      permissionType: permissionType,
      sharedAt: new Date().toISOString()
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