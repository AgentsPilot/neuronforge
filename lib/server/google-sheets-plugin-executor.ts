// lib/server/google-sheets-plugin-executor.ts

import { UserPluginConnections } from './user-plugin-connections';
import { PluginManagerV2 } from './plugin-manager-v2';
import { ExecutionResult } from '@/lib/types/plugin-types';
import { GoogleBasePluginExecutor } from './google-base-plugin-executor';

const pluginName = 'google-sheets';

export class GoogleSheetsPluginExecutor extends GoogleBasePluginExecutor {
  protected sheetsApisUrl: string;

  constructor(userConnections: UserPluginConnections, pluginManager: PluginManagerV2) {
    super(pluginName, userConnections, pluginManager);

    this.sheetsApisUrl = 'https://sheets.googleapis.com/v4/spreadsheets';
  }

  // Execute Google Sheets action with validation and error handling
  protected async executeSpecificAction(
    connection: any,
    actionName: string,
    parameters: any
  ): Promise<any> {
    // Execute the specific action
    let result: any;
    switch (actionName) {
      case 'read_range':
        result = await this.readRange(connection, parameters);
        break;
      case 'write_range':
        result = await this.writeRange(connection, parameters);
        break;
      case 'append_rows':
        result = await this.appendRows(connection, parameters);
        break;
      case 'create_spreadsheet':
        result = await this.createSpreadsheet(connection, parameters);
        break;
      case 'get_spreadsheet_info':
        result = await this.getSpreadsheetInfo(connection, parameters);
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

  // Read data from a specific range
  private async readRange(connection: any, parameters: any): Promise<any> {
    this.logger.debug('DEBUG: Reading range from Google Sheets');

    const { spreadsheet_id, range, include_formula_values, major_dimension } = parameters;

    // Build request URL
    const url = new URL(`${this.sheetsApisUrl}/${spreadsheet_id}/values/${encodeURIComponent(range)}`);

    if (major_dimension) {
      url.searchParams.set('majorDimension', major_dimension);
    }

    if (include_formula_values) {
      url.searchParams.set('valueRenderOption', 'FORMULA');
    } else {
      url.searchParams.set('valueRenderOption', 'FORMATTED_VALUE');
    }

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.text();
      this.logger.error({ errorData, status: response.status }, 'Sheets read_range failed');
      throw new Error(`Sheets API error: ${response.status} - ${errorData}`);
    }

    const data = await response.json();
    const values = data.values || [];
    const rowCount = values.length;
    const columnCount = rowCount > 0 ? Math.max(...values.map((row: any[]) => row.length)) : 0;

    return {
      range: data.range,
      values: values,
      row_count: rowCount,
      column_count: columnCount,
      major_dimension: data.majorDimension || major_dimension || 'ROWS',
      retrieved_at: new Date().toISOString()
    };
  }

  // Write data to a specific range
  private async writeRange(connection: any, parameters: any): Promise<any> {
    this.logger.debug('DEBUG: Writing range to Google Sheets');

    const { spreadsheet_id, range, values, input_option } = parameters;

    // Build request URL
    const valueInputOption = input_option || 'USER_ENTERED';
    const url = new URL(`${this.sheetsApisUrl}/${spreadsheet_id}/values/${encodeURIComponent(range)}`);
    url.searchParams.set('valueInputOption', valueInputOption);

    const requestBody = {
      range: range,
      majorDimension: 'ROWS',
      values: values
    };

    const response = await fetch(url.toString(), {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.text();
      this.logger.error({ errorData, status: response.status }, 'Sheets write_range failed');
      throw new Error(`Sheets API error: ${response.status} - ${errorData}`);
    }

    const data = await response.json();

    return {
      updated_range: data.updatedRange,
      updated_rows: data.updatedRows || 0,
      updated_columns: data.updatedColumns || 0,
      updated_cells: data.updatedCells || 0,
      values: values,
      updated_at: new Date().toISOString()
    };
  }

  // Append rows to the end of a sheet
  private async appendRows(connection: any, parameters: any): Promise<any> {
    this.logger.debug('DEBUG: Appending rows to Google Sheets');

    const { spreadsheet_id, range, values, input_option, insert_data_option } = parameters;

    // ✅ FIX: Normalize values - convert objects to flat arrays
    // Google Sheets API expects: [["val1", "val2"], ["val3", "val4"]]
    // But workflows may pass: [[{field1: "val1", field2: "val2"}]] or [{...}]
    const normalizedValues = this.normalizeValuesForSheets(values);
    this.logger.debug({
      originalFormat: this.describeValueFormat(values),
      normalizedRowCount: normalizedValues.length,
      normalizedColCount: normalizedValues[0]?.length || 0
    }, 'Values normalized for Sheets API');

    // Build request URL
    const valueInputOption = input_option || 'USER_ENTERED';
    const insertDataOption = insert_data_option || 'INSERT_ROWS';
    const url = new URL(`${this.sheetsApisUrl}/${spreadsheet_id}/values/${encodeURIComponent(range)}:append`);
    url.searchParams.set('valueInputOption', valueInputOption);
    url.searchParams.set('insertDataOption', insertDataOption);

    const requestBody = {
      range: range,
      majorDimension: 'ROWS',
      values: normalizedValues
    };

    const response = await fetch(url.toString(), {
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
      console.error('❌ Google Sheets append_rows failed:', {
        status: response.status,
        statusText: response.statusText,
        spreadsheet_id,
        range,
        error: errorData
      });

      // Parse error for better messaging
      let errorMessage = `Google Sheets API error (${response.status})`;
      try {
        const parsedError = JSON.parse(errorData);
        errorMessage = parsedError.error?.message || errorMessage;
      } catch (e) {
        errorMessage = errorData || errorMessage;
      }

      // Provide helpful context for common errors
      if (response.status === 403) {
        throw new Error(`Permission denied: Cannot edit spreadsheet "${spreadsheet_id}". Make sure:\n1. The spreadsheet exists and you own it\n2. Your OAuth connection has edit permissions\n3. The spreadsheet ID is correct\n\nGoogle's error: ${errorMessage}`);
      }
      if (response.status === 404) {
        throw new Error(`Spreadsheet not found: "${spreadsheet_id}" doesn't exist or you don't have access. Please verify the spreadsheet ID from the URL.`);
      }

      throw new Error(`Sheets API error: ${errorMessage}`);
    }

    const data = await response.json();
    const updates = data.updates || {};

    return {
      updated_range: updates.updatedRange,
      appended_rows: updates.updatedRows || 0,
      appended_columns: updates.updatedColumns || 0,
      appended_cells: updates.updatedCells || 0,
      table_range: data.tableRange,
      sheet_name: range.split('!')[0] || range,
      values: values,
      appended_at: new Date().toISOString()
    };
  }

  // Create a new spreadsheet
  private async createSpreadsheet(connection: any, parameters: any): Promise<any> {
    this.logger.debug('DEBUG: Creating new spreadsheet');

    const { title, sheet_names, initial_data } = parameters;

    // Build request body
    const requestBody: any = {
      properties: {
        title: title
      }
    };

    // Add custom sheet names if provided
    if (sheet_names && sheet_names.length > 0) {
      requestBody.sheets = sheet_names.map((name: string) => ({
        properties: {
          title: name
        }
      }));
    }

    const url = `${this.sheetsApisUrl}`;
    const response = await fetch(url, {
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
      this.logger.error({ errorData, status: response.status }, 'Sheets create_spreadsheet failed');
      throw new Error(`Sheets API error: ${response.status} - ${errorData}`);
    }

    const data = await response.json();

    // If initial data provided, write it to the first sheet
    if (initial_data && initial_data.values && initial_data.values.length > 0) {
      try {
        const firstSheetName = sheet_names?.[0] || 'Sheet1';
        const dataRange = initial_data.range || 'A1';
        const fullRange = `${firstSheetName}!${dataRange}`;

        await this.writeRange(connection, {
          spreadsheet_id: data.spreadsheetId,
          range: fullRange,
          values: initial_data.values,
          input_option: 'USER_ENTERED'
        });
      } catch (error) {
        this.logger.warn({ err: error }, 'DEBUG: Failed to write initial data:', error);
        // Continue anyway - spreadsheet was created successfully
      }
    }

    return {
      spreadsheet_id: data.spreadsheetId,
      spreadsheet_url: data.spreadsheetUrl,
      title: data.properties.title,
      sheet_count: data.sheets?.length || 1,
      sheets: data.sheets?.map((sheet: any) => ({
        sheet_id: sheet.properties.sheetId,
        title: sheet.properties.title,
        index: sheet.properties.index
      })) || [],
      created_at: new Date().toISOString()
    };
  }

  // Get spreadsheet metadata and information
  private async getSpreadsheetInfo(connection: any, parameters: any): Promise<any> {
    this.logger.debug('DEBUG: Getting spreadsheet info');

    const { spreadsheet_id, include_sheet_data, include_data_ranges } = parameters;

    // Build request URL with fields parameter
    const url = new URL(`${this.sheetsApisUrl}/${spreadsheet_id}`);

    let fields = 'spreadsheetId,spreadsheetUrl,properties';

    if (include_sheet_data) {
      fields += ',sheets(properties,data.rowMetadata,data.columnMetadata)';
    } else {
      fields += ',sheets.properties';
    }

    if (include_data_ranges) {
      fields += ',sheets.data.rowData';
    }

    url.searchParams.set('fields', fields);

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.text();
      this.logger.error({ errorData, status: response.status }, 'Sheets get_spreadsheet_info failed');
      throw new Error(`Sheets API error: ${response.status} - ${errorData}`);
    }

    const data = await response.json();

    // Format sheet information
    const sheets = (data.sheets || []).map((sheet: any) => {
      const sheetInfo: any = {
        sheet_id: sheet.properties.sheetId,
        title: sheet.properties.title,
        index: sheet.properties.index,
        sheet_type: sheet.properties.sheetType || 'GRID'
      };

      if (include_sheet_data && sheet.properties.gridProperties) {
        sheetInfo.row_count = sheet.properties.gridProperties.rowCount;
        sheetInfo.column_count = sheet.properties.gridProperties.columnCount;
        sheetInfo.frozen_row_count = sheet.properties.gridProperties.frozenRowCount || 0;
        sheetInfo.frozen_column_count = sheet.properties.gridProperties.frozenColumnCount || 0;
      }

      return sheetInfo;
    });

    return {
      spreadsheet_id: data.spreadsheetId,
      spreadsheet_url: data.spreadsheetUrl,
      title: data.properties.title,
      locale: data.properties.locale,
      time_zone: data.properties.timeZone,
      sheet_count: sheets.length,
      sheets: sheets,
      retrieved_at: new Date().toISOString()
    };
  }

  // Override to handle Sheets-specific errors
  protected mapGoogleServiceSpecificError(error: any, commonErrors: Record<string, string>): string | null {
    // Sheets-specific: spreadsheet not found
    if (error.message?.includes('404')) {
      return commonErrors.spreadsheet_not_found || error.message;
    }

    // Sheets-specific: invalid range format
    if (error.message?.includes('invalid') && error.message?.includes('range')) {
      return commonErrors.invalid_range || error.message;
    }

    // Sheets-specific: invalid values/array data
    if (error.message?.includes('values') || error.message?.includes('array')) {
      return commonErrors.invalid_values || error.message;
    }

    // Return null to fall back to common Google error handling
    return null;
  }

  // Test connection with a simple API call
  protected async performConnectionTest(connection: any): Promise<any> {
    // Test with a simple API call (create test spreadsheet)
    const response = await fetch(`${this.sheetsApisUrl}?fields=kind`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        properties: {
          title: 'Connection Test - Can Be Deleted'
        }
      })
    });

    if (!response.ok) {
      return {
        success: false,
        error: 'connection_test_failed',
        message: `Google Sheets connection test failed: ${response.status}`
      };
    }

    const testData = await response.json();

    // Clean up test spreadsheet using parent's cleanup method
    if (testData.spreadsheetId) {
      await this.cleanupTestResource(connection.access_token, testData.spreadsheetId);
    }

    return {
      success: true,
      data: {
        can_create: true,
        can_read: true,
        can_write: true
      },
      message: 'Google Sheets connection active'
    };
  }

  /**
   * List all available Google Spreadsheets for dynamic dropdown options
   * This method is called by the fetch-options API route
   */
  async list_spreadsheets(connection: any, options: { page?: number; limit?: number } = {}): Promise<Array<{value: string; label: string; description?: string; icon?: string; group?: string}>> {
    try {
      const { limit = 100 } = options;

      // Use Google Drive API to list spreadsheets
      const driveUrl = new URL('https://www.googleapis.com/drive/v3/files');
      driveUrl.searchParams.set('q', "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false");
      driveUrl.searchParams.set('fields', 'files(id,name,modifiedTime,owners)');
      driveUrl.searchParams.set('pageSize', limit.toString());
      driveUrl.searchParams.set('orderBy', 'modifiedTime desc');

      const response = await fetch(driveUrl.toString(), {
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
        icon: '📊',
        group: 'My Spreadsheets',
      }));

    } catch (error: any) {
      this.logger.error({ err: error }, 'Error listing Google Spreadsheets for options');
      throw error;
    }
  }

  // List sheet names within a specific spreadsheet for cascading dropdown
  async list_sheet_names(connection: any, options: { spreadsheet_id?: string; page?: number; limit?: number } = {}): Promise<Array<{value: string; label: string; description?: string; icon?: string; group?: string}>> {
    try {
      const { spreadsheet_id } = options;

      if (!spreadsheet_id) {
        this.logger.warn('list_sheet_names called without spreadsheet_id');
        return [];
      }

      // Use Google Sheets API to get spreadsheet metadata
      const sheetsUrl = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheet_id}`);
      sheetsUrl.searchParams.set('fields', 'sheets(properties(sheetId,title,index,sheetType,gridProperties))');

      const response = await fetch(sheetsUrl.toString(), {
        headers: {
          'Authorization': `Bearer ${connection.access_token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Google Sheets API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      if (!data.sheets || !Array.isArray(data.sheets)) {
        return [];
      }

      // Transform to option format - return sheet names that can be used in A1 notation
      return data.sheets.map((sheet: any) => ({
        value: sheet.properties.title,
        label: sheet.properties.title,
        description: sheet.properties.gridProperties
          ? `${sheet.properties.gridProperties.rowCount || 0} rows × ${sheet.properties.gridProperties.columnCount || 0} columns`
          : undefined,
        icon: '📄',
        group: 'Sheets',
      }));

    } catch (error: any) {
      this.logger.error({ err: error }, 'Error listing sheet names for options');
      throw error;
    }
  }

  /**
   * Normalize values array for Google Sheets API
   * Converts objects to flat value arrays
   *
   * Input formats handled:
   * 1. [[{obj}], [{obj}]] -> [["v1","v2"], ["v1","v2"]]  (array of arrays containing objects)
   * 2. [{obj}, {obj}] -> [["v1","v2"], ["v1","v2"]]      (array of objects)
   * 3. [["v1","v2"]] -> [["v1","v2"]]                    (already correct format)
   * 4. [] or null -> []                                   (empty/null)
   */
  private normalizeValuesForSheets(values: any): any[][] {
    if (!values || !Array.isArray(values) || values.length === 0) {
      return [];
    }

    const firstRow = values[0];

    // Case 1: Already in correct format - array of arrays of primitives [[primitive, primitive, ...]]
    if (Array.isArray(firstRow) && (firstRow.length === 0 || typeof firstRow[0] !== 'object' || firstRow[0] === null)) {
      return values;
    }

    // Case 2: Array of objects [{...}, {...}] - each object is a row
    if (!Array.isArray(firstRow) && typeof firstRow === 'object' && firstRow !== null) {
      this.logger.debug('Converting array of objects to value arrays');
      return values.map((obj: any) => this.objectToValueArray(obj));
    }

    // Case 3: Array of arrays containing objects [[{...}], [{...}]] - unwrap and convert
    if (Array.isArray(firstRow) && firstRow.length > 0 && typeof firstRow[0] === 'object' && firstRow[0] !== null) {
      this.logger.debug('Converting nested array of objects to value arrays');
      return values.map((row: any[]) => {
        // Each row is an array with one object, extract the object and convert
        const obj = row[0];
        return this.objectToValueArray(obj);
      });
    }

    // Fallback: return as-is and let the API handle any errors
    this.logger.warn({ valueType: typeof firstRow }, 'Unknown values format, passing through as-is');
    return values;
  }

  /**
   * Convert an object to an array of values (preserving key order)
   * Handles nested objects by stringifying them
   */
  private objectToValueArray(obj: any): any[] {
    if (obj === null || obj === undefined) {
      return [''];
    }

    if (typeof obj !== 'object') {
      return [String(obj)];
    }

    // Extract values in key order
    return Object.values(obj).map(val => {
      if (val === null || val === undefined) return '';
      if (typeof val === 'object') return JSON.stringify(val);
      return String(val);
    });
  }

  /**
   * Describe the format of values for logging
   */
  private describeValueFormat(values: any): string {
    if (!values) return 'null/undefined';
    if (!Array.isArray(values)) return `non-array (${typeof values})`;
    if (values.length === 0) return 'empty array';

    const first = values[0];
    if (!Array.isArray(first)) {
      return typeof first === 'object' ? 'array of objects' : `array of ${typeof first}`;
    }

    if (first.length === 0) return 'array of empty arrays';
    const innerFirst = first[0];
    return typeof innerFirst === 'object' ? 'array of arrays of objects' : `array of arrays of ${typeof innerFirst}`;
  }
}
