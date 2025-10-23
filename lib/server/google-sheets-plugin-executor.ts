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
    if (this.debug) console.log('DEBUG: Reading range from Google Sheets');

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
      if (this.debug) console.error('DEBUG: Sheets read failed:', errorData);
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
    if (this.debug) console.log('DEBUG: Writing range to Google Sheets');

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
      if (this.debug) console.error('DEBUG: Sheets write failed:', errorData);
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
    if (this.debug) console.log('DEBUG: Appending rows to Google Sheets');

    const { spreadsheet_id, range, values, input_option, insert_data_option } = parameters;

    // Build request URL
    const valueInputOption = input_option || 'USER_ENTERED';
    const insertDataOption = insert_data_option || 'INSERT_ROWS';
    const url = new URL(`${this.sheetsApisUrl}/${spreadsheet_id}/values/${encodeURIComponent(range)}:append`);
    url.searchParams.set('valueInputOption', valueInputOption);
    url.searchParams.set('insertDataOption', insertDataOption);

    const requestBody = {
      range: range,
      majorDimension: 'ROWS',
      values: values
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
    if (this.debug) console.log('DEBUG: Creating new spreadsheet');

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
      if (this.debug) console.error('DEBUG: Spreadsheet creation failed:', errorData);
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
        if (this.debug) console.warn('DEBUG: Failed to write initial data:', error);
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
    if (this.debug) console.log('DEBUG: Getting spreadsheet info');

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
      if (this.debug) console.error('DEBUG: Get spreadsheet info failed:', errorData);
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
}
