// lib/server/airtable-plugin-executor.ts

import { UserPluginConnections } from './user-plugin-connections';
import { PluginManagerV2 } from './plugin-manager-v2';
import { BasePluginExecutor } from './base-plugin-executor';

const pluginName = 'airtable';

export class AirtablePluginExecutor extends BasePluginExecutor {
  private apiBaseUrl = 'https://api.airtable.com/v0';
  private metaApiUrl = 'https://api.airtable.com/v0/meta';

  constructor(userConnections: UserPluginConnections, pluginManager: PluginManagerV2) {
    super(pluginName, userConnections, pluginManager);
  }

  protected async executeSpecificAction(
    connection: any,
    actionName: string,
    parameters: any
  ): Promise<any> {
    switch (actionName) {
      case 'list_bases':
        return await this.listBases(connection, parameters);
      case 'list_records':
        return await this.listRecords(connection, parameters);
      case 'get_record':
        return await this.getRecord(connection, parameters);
      case 'create_records':
        return await this.createRecords(connection, parameters);
      case 'update_records':
        return await this.updateRecords(connection, parameters);
      case 'list_tables':
        return await this.listTables(connection, parameters);
      case 'upload_attachment':
        return await this.uploadAttachment(connection, parameters);
      case 'get_attachment_urls':
        return await this.getAttachmentUrls(connection, parameters);
      default:
        throw new Error(`Action ${actionName} not supported`);
    }
  }

  // Action 0: List Bases
  private async listBases(connection: any, parameters: any): Promise<any> {
    this.logger.debug('Listing Airtable bases');

    const url = `${this.metaApiUrl}/bases`;

    const response = await fetch(url, {
      headers: this.buildAuthHeader(connection.access_token)
    });

    const data = await this.handleApiResponse(response, 'list_bases');

    const bases = (data.bases || []).map((base: any) => ({
      id: base.id,
      name: base.name,
      permission_level: base.permissionLevel
    }));

    return {
      bases: bases,
      base_count: bases.length
    };
  }

  // Action 1: List Records
  private async listRecords(connection: any, parameters: any): Promise<any> {
    this.logger.debug('Listing Airtable records');

    const {
      base_id,
      table_name,
      view,
      fields,
      filter_by_formula,
      sort,
      max_records = 100,
      page_size = 100
    } = parameters;

    // Build URL with table name (encode it properly)
    const encodedTableName = encodeURIComponent(table_name);
    let url = `${this.apiBaseUrl}/${base_id}/${encodedTableName}`;

    // Build query parameters
    const queryParams = new URLSearchParams();

    if (view) {
      queryParams.append('view', view);
    }

    if (fields && fields.length > 0) {
      fields.forEach((field: string) => {
        queryParams.append('fields[]', field);
      });
    }

    if (filter_by_formula) {
      queryParams.append('filterByFormula', filter_by_formula);
    }

    if (sort && sort.length > 0) {
      sort.forEach((s: any, index: number) => {
        queryParams.append(`sort[${index}][field]`, s.field);
        queryParams.append(`sort[${index}][direction]`, s.direction);
      });
    }

    if (max_records) {
      queryParams.append('maxRecords', max_records.toString());
    }

    if (page_size) {
      queryParams.append('pageSize', page_size.toString());
    }

    const queryString = queryParams.toString();
    if (queryString) {
      url += `?${queryString}`;
    }

    const response = await fetch(url, {
      headers: this.buildAuthHeader(connection.access_token)
    });

    const data = await this.handleApiResponse(response, 'list_records');

    return {
      records: data.records || [],
      record_count: data.records?.length || 0,
      offset: data.offset || null,
      has_more: !!data.offset
    };
  }

  // Action 2: Get Record
  private async getRecord(connection: any, parameters: any): Promise<any> {
    this.logger.debug('Getting Airtable record');

    const { base_id, table_name, record_id } = parameters;

    const encodedTableName = encodeURIComponent(table_name);
    const url = `${this.apiBaseUrl}/${base_id}/${encodedTableName}/${record_id}`;

    const response = await fetch(url, {
      headers: this.buildAuthHeader(connection.access_token)
    });

    const data = await this.handleApiResponse(response, 'get_record');

    return {
      id: data.id,
      fields: data.fields || {},
      created_time: data.createdTime
    };
  }

  // Action 3: Create Records
  private async createRecords(connection: any, parameters: any): Promise<any> {
    this.logger.debug('Creating Airtable records');

    const { base_id, table_name, records, typecast = false } = parameters;

    const encodedTableName = encodeURIComponent(table_name);
    const url = `${this.apiBaseUrl}/${base_id}/${encodedTableName}`;

    const requestBody: any = {
      records: records,
      typecast: typecast
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...this.buildAuthHeader(connection.access_token),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    const data = await this.handleApiResponse(response, 'create_records');

    return {
      records: data.records || [],
      record_count: data.records?.length || 0,
      created_at: new Date().toISOString()
    };
  }

  // Action 4: Update Records
  private async updateRecords(connection: any, parameters: any): Promise<any> {
    this.logger.debug('Updating Airtable records');

    const { base_id, table_name, records, typecast = false, destructive = false } = parameters;

    const encodedTableName = encodeURIComponent(table_name);
    const url = `${this.apiBaseUrl}/${base_id}/${encodedTableName}`;

    const requestBody: any = {
      records: records,
      typecast: typecast
    };

    // Use PATCH for partial updates, PUT for full replacement (destructive)
    const method = destructive ? 'PUT' : 'PATCH';

    const response = await fetch(url, {
      method: method,
      headers: {
        ...this.buildAuthHeader(connection.access_token),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    const data = await this.handleApiResponse(response, 'update_records');

    return {
      records: data.records || [],
      record_count: data.records?.length || 0,
      updated_at: new Date().toISOString(),
      destructive: destructive
    };
  }

  // Action 8: List Tables
  private async listTables(connection: any, parameters: any): Promise<any> {
    this.logger.debug('Listing Airtable tables');

    const { base_id } = parameters;

    const url = `${this.metaApiUrl}/bases/${base_id}/tables`;

    const response = await fetch(url, {
      headers: this.buildAuthHeader(connection.access_token)
    });

    const data = await this.handleApiResponse(response, 'list_tables');

    const tables = (data.tables || []).map((table: any) => ({
      id: table.id,
      name: table.name,
      primary_field_id: table.primaryFieldId,
      field_count: table.fields?.length || 0,
      view_count: table.views?.length || 0
    }));

    return {
      tables: tables,
      table_count: tables.length
    };
  }

  // Action 9: Upload Attachment
  private async uploadAttachment(connection: any, parameters: any): Promise<any> {
    this.logger.debug('Uploading attachment to Airtable record');

    const { base_id, table_name, record_id, field_name, attachment } = parameters;

    const encodedTableName = encodeURIComponent(table_name);
    const url = `${this.apiBaseUrl}/${base_id}/${encodedTableName}`;

    // First, get the existing record to preserve other attachments
    const getResponse = await fetch(`${url}/${record_id}`, {
      headers: this.buildAuthHeader(connection.access_token)
    });

    const existingRecord = await this.handleApiResponse(getResponse, 'get_record_for_attachment');

    // Get existing attachments from the field
    const existingAttachments = existingRecord.fields[field_name] || [];

    // Add new attachment
    const newAttachments = [
      ...existingAttachments,
      {
        url: attachment.url,
        filename: attachment.filename
      }
    ];

    // Update the record with the new attachment
    const updateBody = {
      records: [
        {
          id: record_id,
          fields: {
            [field_name]: newAttachments
          }
        }
      ]
    };

    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        ...this.buildAuthHeader(connection.access_token),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(updateBody)
    });

    const data = await this.handleApiResponse(response, 'upload_attachment');

    const updatedRecord = data.records[0];
    const attachments = updatedRecord.fields[field_name] || [];

    return {
      record_id: updatedRecord.id,
      field_name: field_name,
      attachments: attachments.map((att: any) => ({
        id: att.id,
        url: att.url,
        filename: att.filename,
        size: att.size,
        type: att.type
      })),
      attachment_count: attachments.length
    };
  }

  // Action 10: Get Attachment URLs
  private async getAttachmentUrls(connection: any, parameters: any): Promise<any> {
    this.logger.debug('Getting attachment URLs from Airtable record');

    const { base_id, table_name, record_id, field_name } = parameters;

    const encodedTableName = encodeURIComponent(table_name);
    const url = `${this.apiBaseUrl}/${base_id}/${encodedTableName}/${record_id}`;

    const response = await fetch(url, {
      headers: this.buildAuthHeader(connection.access_token)
    });

    const data = await this.handleApiResponse(response, 'get_attachment_urls');

    const attachments = data.fields[field_name] || [];

    return {
      attachments: attachments.map((att: any) => ({
        id: att.id,
        url: att.url,
        filename: att.filename,
        size: att.size,
        type: att.type,
        width: att.width || null,
        height: att.height || null,
        expires_warning: 'URL expires in approximately 2 hours'
      })),
      attachment_count: attachments.length,
      expiry_note: 'Download URLs expire after ~2 hours for security'
    };
  }

  // Override error mapping for Airtable-specific errors
  protected mapPluginSpecificError(error: any, commonErrors: Record<string, string>): string | null {
    const errorMsg = error.message || '';

    // Airtable-specific error codes
    if (errorMsg.includes('INVALID_REQUEST_BODY')) {
      return 'Invalid request: Check that field names and values match the table schema.';
    }

    if (errorMsg.includes('INVALID_VALUE_FOR_COLUMN')) {
      return 'Invalid value for field: The provided value does not match the expected field type.';
    }

    if (errorMsg.includes('UNKNOWN_FIELD_NAME')) {
      return 'Unknown field name: One or more field names do not exist in the table schema.';
    }

    if (errorMsg.includes('NOT_FOUND') || errorMsg.includes('MODEL_ID_NOT_FOUND')) {
      return 'Record, table, or base not found: Verify that the IDs are correct.';
    }

    if (errorMsg.includes('INVALID_PERMISSIONS')) {
      return commonErrors.insufficient_permissions || 'Insufficient permissions: Check OAuth scopes or base permissions.';
    }

    if (errorMsg.includes('REQUEST_LIMIT_EXCEEDED')) {
      return commonErrors.rate_limit_exceeded || 'Rate limit exceeded: Airtable allows 5 requests per second per base.';
    }

    if (errorMsg.includes('INVALID_ATTACHMENT')) {
      return 'Invalid attachment: URL must be publicly accessible, or the file format is not supported.';
    }

    // Return null to fall back to common error handling
    return null;
  }

  // Override connection test
  protected async performConnectionTest(connection: any): Promise<any> {
    const response = await fetch(`${this.metaApiUrl}/whoami`, {
      headers: this.buildAuthHeader(connection.access_token)
    });

    const data = await this.handleApiResponse(response, 'connection_test');

    return {
      user_id: data.id,
      email: data.email || null,
      scopes: data.scopes || []
    };
  }

  /**
   * List all Airtable bases for dynamic dropdown options
   * This method is called by the fetch-options API route
   */
  async list_bases(connection: any, options: { page?: number; limit?: number } = {}): Promise<Array<{value: string; label: string; description?: string; icon?: string; group?: string}>> {
    try {
      const result = await this.listBases(connection, {});

      if (!result.bases || !Array.isArray(result.bases)) {
        return [];
      }

      // Transform to option format
      return result.bases.map((base: any) => ({
        value: base.id,
        label: base.name,
        description: base.permission_level ? `Permission: ${base.permission_level}` : undefined,
        icon: '📊',
        group: 'My Bases',
      }));

    } catch (error: any) {
      this.logger.error({ err: error }, 'Error listing Airtable bases for options');
      throw error;
    }
  }

  /**
   * List all tables in an Airtable base for dynamic dropdown options
   * This method is called by the fetch-options API route
   * Note: Requires base_id parameter from dependent field
   */
  async list_tables_in_base(connection: any, options: { page?: number; limit?: number; base_id?: string } = {}): Promise<Array<{value: string; label: string; description?: string; icon?: string; group?: string}>> {
    try {
      const { base_id } = options;

      if (!base_id) {
        throw new Error('base_id is required to list tables');
      }

      const result = await this.listTables(connection, { base_id });

      if (!result.tables || !Array.isArray(result.tables)) {
        return [];
      }

      // Transform to option format
      return result.tables.map((table: any) => ({
        value: table.id,
        label: table.name,
        description: table.primary_field_id ? `Primary field: ${table.primary_field_id}` : undefined,
        icon: '📋',
        group: 'Tables',
      }));

    } catch (error: any) {
      this.logger.error({ err: error }, 'Error listing Airtable tables for options');
      throw error;
    }
  }
}
