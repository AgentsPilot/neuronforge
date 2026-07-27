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
      case 'get_or_create_spreadsheet':
        result = await this.getOrCreateSpreadsheet(connection, parameters);
        break;
      case 'get_spreadsheet_info':
        result = await this.getSpreadsheetInfo(connection, parameters);
        break;
      case 'get_or_create_sheet_tab':
        result = await this.getOrCreateSheetTab(connection, parameters);
        break;
      case 'format_cells':
        result = await this.formatCells(connection, parameters);
        break;
      case 'clear_range':
        result = await this.clearRange(connection, parameters);
        break;
      case 'delete_rows':
        result = await this.deleteRows(connection, parameters);
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
      // Primary format (snake_case to match schema)
      row_count: rowCount,
      column_count: columnCount,
      major_dimension: data.majorDimension || major_dimension || 'ROWS',
      retrieved_at: new Date().toISOString(),
      // Legacy format (camelCase for backward compatibility)
      rowCount: rowCount,
      columnCount: columnCount,
      majorDimension: data.majorDimension || major_dimension || 'ROWS',
      retrievedAt: new Date().toISOString()
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
      // Primary format (snake_case to match schema)
      updated_range: data.updatedRange,
      updated_rows: data.updatedRows || 0,
      updated_columns: data.updatedColumns || 0,
      updated_cells: data.updatedCells || 0,
      values: values,
      updated_at: new Date().toISOString(),
      // Legacy format (camelCase for backward compatibility)
      updatedRange: data.updatedRange,
      updatedRows: data.updatedRows || 0,
      updatedColumns: data.updatedColumns || 0,
      updatedCells: data.updatedCells || 0,
      updatedAt: new Date().toISOString()
    };
  }

  // Append rows to the end of a sheet
  private async appendRows(connection: any, parameters: any): Promise<any> {
    this.logger.info({ paramKeys: Object.keys(parameters), hasValues: !!parameters.values, hasFields: !!parameters.fields }, 'appendRows: received parameters');

    const { spreadsheet_id, range, input_option, insert_data_option, fields } = parameters;
    let { values } = parameters;

    // Smart value resolution: support multiple input formats
    // 1. values = [[...]] — standard 2D array, pass through
    // 2. values = [{...}, {...}] — array of objects, convert to 2D array using object keys
    // 3. fields = { "Column": "variable.field", ... } — field mapping, convert to 2D array
    // 4. values = {...} — single object, wrap as single row using object values
    if (!values && fields && typeof fields === 'object') {
      // fields mapping: { "Column Header": "source.field" } or { "values": objectData }
      // If fields.values is an object (resolved variable), extract its values as a row
      if (fields.values && typeof fields.values === 'object' && !Array.isArray(fields.values)) {
        const obj = fields.values;
        values = [Object.values(obj).map((v: any) => v != null ? String(v) : '')];
        this.logger.debug({ fieldCount: Object.keys(obj).length }, 'Converted object to single sheet row via fields.values');
      } else if (fields.values && Array.isArray(fields.values)) {
        values = fields.values;
      } else {
        // fields is a column-to-field mapping: { "Name": "item.name", "Email": "item.email" }
        // Values should already be resolved by the runtime — extract values in order
        values = [Object.values(fields).map((v: any) => v != null ? String(v) : '')];
        this.logger.debug({ columns: Object.keys(fields) }, 'Converted fields mapping to single sheet row');
      }
    } else if (values && !Array.isArray(values) && typeof values === 'object') {
      // Single object — convert to single row using object values
      values = [Object.values(values).map((v: any) => v != null ? String(v) : '')];
      this.logger.debug('Converted single object to sheet row');
    } else if (values && Array.isArray(values) && values.length > 0 && !Array.isArray(values[0]) && typeof values[0] === 'object') {
      // Array of objects — convert each to a row
      const keys = Object.keys(values[0]);
      values = values.map((obj: any) => keys.map(k => obj[k] != null ? String(obj[k]) : ''));
      this.logger.debug({ rowCount: values.length, columns: keys }, 'Converted array of objects to 2D sheet array');
    }

    if (!values || !Array.isArray(values) || values.length === 0) {
      this.logger.warn({ parameters: Object.keys(parameters) }, 'append_rows: no values to append');
      return {
        updated_range: range,
        appended_rows: 0,
        appended_columns: 0,
        appended_cells: 0,
        sheet_name: range,
        values: [],
        appended_at: new Date().toISOString(),
        updatedRange: range,
        appendedRows: 0,
        appendedColumns: 0,
        appendedCells: 0,
        sheetName: range,
        appendedAt: new Date().toISOString()
      };
    }

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
      this.logger.error(
        { status: response.status, statusText: response.statusText, spreadsheet_id, range, err: errorData },
        'Google Sheets append_rows failed'
      );

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
      // Primary format (snake_case to match schema)
      updated_range: updates.updatedRange,
      appended_rows: updates.updatedRows || 0,
      appended_columns: updates.updatedColumns || 0,
      appended_cells: updates.updatedCells || 0,
      table_range: data.tableRange,
      sheet_name: range.split('!')[0] || range,
      values: values,
      appended_at: new Date().toISOString(),
      // Legacy format (camelCase for backward compatibility)
      updatedRange: updates.updatedRange,
      appendedRows: updates.updatedRows || 0,
      appendedColumns: updates.updatedColumns || 0,
      appendedCells: updates.updatedCells || 0,
      tableRange: data.tableRange,
      sheetName: range.split('!')[0] || range,
      appendedAt: new Date().toISOString()
    };
  }

  // Get existing spreadsheet by title or create if it doesn't exist (prevents duplicates)
  private async getOrCreateSpreadsheet(connection: any, parameters: any): Promise<any> {
    this.logger.debug('Get or create spreadsheet via Google Drive API');

    const title = parameters.title;
    if (!title) {
      throw new Error('title is required');
    }

    // Search for existing spreadsheet by title using Drive API
    const driveUrl = new URL('https://www.googleapis.com/drive/v3/files');
    const query = `name='${title.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
    driveUrl.searchParams.set('q', query);
    driveUrl.searchParams.set('pageSize', '1');
    driveUrl.searchParams.set('fields', 'files(id, name, webViewLink)');

    const searchResponse = await fetch(driveUrl.toString(), {
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Accept': 'application/json',
      },
    });

    if (!searchResponse.ok) {
      const errorData = await searchResponse.text();
      this.logger.error({ err: errorData }, 'Spreadsheet search failed');
      throw new Error(`Failed to search for spreadsheet: ${searchResponse.status} - ${errorData}`);
    }

    const searchData = await searchResponse.json();

    // If spreadsheet exists, return it
    if (searchData.files && searchData.files.length > 0) {
      const existingFile = searchData.files[0];
      this.logger.debug({ spreadsheetId: existingFile.id }, 'Found existing spreadsheet');

      // Get full spreadsheet info
      const infoResponse = await this.getSpreadsheetInfo(connection, {
        spreadsheet_id: existingFile.id,
        include_sheet_data: false
      });

      return {
        ...infoResponse,
        created: false
      };
    }

    // Spreadsheet doesn't exist - create it
    this.logger.debug('Spreadsheet not found, creating new one');
    const created = await this.createSpreadsheet(connection, parameters);

    return {
      ...created,
      created: true
    };
  }

  /**
   * Get existing sheet tab or create it if it doesn't exist within a spreadsheet.
   * Idempotent — safe to call multiple times with the same tab_name.
   * Uses Sheets API: getSpreadsheetInfo to list tabs, batchUpdate to add if missing.
   */
  private async getOrCreateSheetTab(connection: any, parameters: any): Promise<any> {
    const { spreadsheet_id, tab_name } = parameters;

    if (!spreadsheet_id) throw new Error('spreadsheet_id is required');
    if (!tab_name) throw new Error('tab_name is required');

    this.logger.debug({ spreadsheet_id, tab_name }, 'Get or create sheet tab');

    // Step 1: Get spreadsheet info to list existing tabs
    const info = await this.getSpreadsheetInfo(connection, {
      spreadsheet_id,
      include_sheet_data: false,
    });

    // Step 2: Check if tab already exists (case-insensitive match)
    const existingTab = (info.sheets || []).find(
      (s: any) => s.title?.toLowerCase() === tab_name.toLowerCase() ||
                   s.sheet_name?.toLowerCase() === tab_name.toLowerCase()
    );

    if (existingTab) {
      this.logger.debug({ tab_name, sheet_id: existingTab.sheet_id }, 'Sheet tab already exists');
      return {
        spreadsheet_id,
        sheet_id: existingTab.sheet_id || existingTab.sheetId,
        sheet_name: existingTab.title || existingTab.sheet_name || tab_name,
        tab_name: existingTab.title || existingTab.sheet_name || tab_name,
        existed: true,
      };
    }

    // Step 3: Tab doesn't exist — create it via batchUpdate
    this.logger.debug({ tab_name }, 'Sheet tab not found, creating');

    const batchUpdateUrl = `${this.sheetsApisUrl}/${spreadsheet_id}:batchUpdate`;
    const response = await fetch(batchUpdateUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: [
          {
            addSheet: {
              properties: {
                title: tab_name,
              },
            },
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      this.logger.error({ errorData, status: response.status }, 'Failed to create sheet tab');
      throw new Error(`Failed to create sheet tab "${tab_name}": ${response.status} - ${errorData}`);
    }

    const result = await response.json();
    const newSheet = result.replies?.[0]?.addSheet?.properties;

    return {
      spreadsheet_id,
      sheet_id: newSheet?.sheetId,
      sheet_name: newSheet?.title || tab_name,
      tab_name: newSheet?.title || tab_name,
      existed: false,
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
      // Primary format (snake_case to match schema)
      spreadsheet_id: data.spreadsheetId,
      spreadsheet_url: data.spreadsheetUrl,
      title: data.properties.title,
      sheet_count: data.sheets?.length || 1,
      sheets: data.sheets?.map((sheet: any) => ({
        sheet_id: sheet.properties.sheetId,
        title: sheet.properties.title,
        index: sheet.properties.index,
        // Legacy format (camelCase)
        sheetId: sheet.properties.sheetId
      })) || [],
      created_at: new Date().toISOString(),
      // Legacy format (camelCase for backward compatibility)
      spreadsheetId: data.spreadsheetId,
      spreadsheetUrl: data.spreadsheetUrl,
      sheetCount: data.sheets?.length || 1,
      createdAt: new Date().toISOString()
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
        // Primary format (snake_case)
        sheet_id: sheet.properties.sheetId,
        title: sheet.properties.title,
        index: sheet.properties.index,
        sheet_type: sheet.properties.sheetType || 'GRID',
        // Legacy format (camelCase)
        sheetId: sheet.properties.sheetId,
        sheetType: sheet.properties.sheetType || 'GRID'
      };

      if (include_sheet_data && sheet.properties.gridProperties) {
        sheetInfo.row_count = sheet.properties.gridProperties.rowCount;
        sheetInfo.column_count = sheet.properties.gridProperties.columnCount;
        sheetInfo.frozen_row_count = sheet.properties.gridProperties.frozenRowCount || 0;
        sheetInfo.frozen_column_count = sheet.properties.gridProperties.frozenColumnCount || 0;
        // Legacy format (camelCase)
        sheetInfo.rowCount = sheet.properties.gridProperties.rowCount;
        sheetInfo.columnCount = sheet.properties.gridProperties.columnCount;
        sheetInfo.frozenRowCount = sheet.properties.gridProperties.frozenRowCount || 0;
        sheetInfo.frozenColumnCount = sheet.properties.gridProperties.frozenColumnCount || 0;
      }

      return sheetInfo;
    });

    return {
      // Primary format (snake_case to match schema)
      spreadsheet_id: data.spreadsheetId,
      spreadsheet_url: data.spreadsheetUrl,
      title: data.properties.title,
      locale: data.properties.locale,
      time_zone: data.properties.timeZone,
      sheet_count: sheets.length,
      sheets: sheets,
      retrieved_at: new Date().toISOString(),
      // Legacy format (camelCase for backward compatibility)
      spreadsheetId: data.spreadsheetId,
      spreadsheetUrl: data.spreadsheetUrl,
      timeZone: data.properties.timeZone,
      sheetCount: sheets.length,
      retrievedAt: new Date().toISOString()
    };
  }

  // ==========================================================================
  // Shared helpers for the batchUpdate-based structural/formatting actions.
  // These are executor-internal Google-Sheets-API adapters — no plugin-specific
  // rules leak into any prompt or the compiler.
  // ==========================================================================

  /**
   * Thin POST wrapper over `…/{spreadsheetId}:batchUpdate`, mirroring the existing
   * getOrCreateSheetTab precedent (raw fetch + manual error throw). Returns the
   * `replies` array. Used by format_cells and delete_rows.
   */
  private async sheetsBatchUpdate(connection: any, spreadsheetId: string, requests: any[]): Promise<any[]> {
    const url = `${this.sheetsApisUrl}/${spreadsheetId}:batchUpdate`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ requests }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      this.logger.error({ errorData, status: response.status, spreadsheet_id: spreadsheetId }, 'Sheets batchUpdate failed');
      throw new Error(`Sheets API error: ${response.status} - ${errorData}`);
    }

    const data = await response.json();
    return data.replies || [];
  }

  /**
   * Resolve a tab name (or, if omitted, the first tab) to its numeric sheetId via
   * the existing getSpreadsheetInfo. batchUpdate requests (repeatCell,
   * updateSheetProperties, deleteDimension) operate on a numeric sheetId — not the
   * A1 sheet-*name* the value-level actions use. Case-insensitive title match,
   * mirroring getOrCreateSheetTab. Throws a clean sheet_not_found when the named
   * tab does not exist.
   */
  private async resolveSheetId(
    connection: any,
    spreadsheetId: string,
    sheetName?: string
  ): Promise<{ sheetId: number; title: string }> {
    const info = await this.getSpreadsheetInfo(connection, {
      spreadsheet_id: spreadsheetId,
      include_sheet_data: false,
    });

    const sheets: any[] = info.sheets || [];
    if (sheets.length === 0) {
      throw new Error(`No sheets found in spreadsheet "${spreadsheetId}"`);
    }

    // No tab specified → default to the first tab (index 0). Documented behaviour.
    if (!sheetName) {
      const first = sheets[0];
      return { sheetId: first.sheet_id ?? first.sheetId, title: first.title || first.sheet_name };
    }

    const match = sheets.find(
      (s) => (s.title || s.sheet_name || '').toLowerCase() === sheetName.toLowerCase()
    );
    if (!match) {
      throw new Error(`sheet_not_found: Sheet tab "${sheetName}" was not found in the spreadsheet.`);
    }

    return { sheetId: match.sheet_id ?? match.sheetId, title: match.title || match.sheet_name };
  }

  /**
   * Convert A1 column letters (e.g. 'A', 'D', 'AA') to a 0-based column index.
   */
  private columnLettersToIndex(letters: string): number {
    let index = 0;
    const upper = letters.toUpperCase();
    for (let i = 0; i < upper.length; i++) {
      index = index * 26 + (upper.charCodeAt(i) - 64); // 'A' → 1
    }
    return index - 1; // 0-based
  }

  /**
   * Pure, deterministic parse of an A1 range into a GridRange (0-based half-open).
   * Handles 'A1:D1', "Sheet1!A1:D1", "'My Sheet'!A2:D100", 'A:D' (whole columns),
   * '2:5' (whole rows), and single cells ('B2'). The sheet-name prefix (if present)
   * is stripped here — sheetId is supplied by the caller (resolveSheetId). Open-ended
   * bounds omit the corresponding index (whole-column / whole-row semantics).
   * Unit-testable; issues no network calls.
   */
  private a1RangeToGridRange(
    range: string,
    sheetId: number
  ): { sheetId: number; startRowIndex?: number; endRowIndex?: number; startColumnIndex?: number; endColumnIndex?: number } {
    // Strip the sheet-name prefix (handled separately by resolveSheetId).
    const bang = range.lastIndexOf('!');
    const a1 = bang >= 0 ? range.slice(bang + 1) : range;

    const [startPart, endPart] = a1.includes(':') ? a1.split(':') : [a1, a1];

    const parseCell = (cell: string): { col?: number; row?: number } => {
      const m = cell.trim().match(/^([A-Za-z]*)(\d*)$/);
      if (!m || (!m[1] && !m[2])) {
        throw new Error(`invalid_range: "${cell}" is not a valid A1 cell reference.`);
      }
      const [, letters, digits] = m;
      return {
        col: letters ? this.columnLettersToIndex(letters) : undefined,
        row: digits ? parseInt(digits, 10) - 1 : undefined, // 0-based
      };
    };

    const start = parseCell(startPart);
    const end = parseCell(endPart);

    const gridRange: {
      sheetId: number;
      startRowIndex?: number;
      endRowIndex?: number;
      startColumnIndex?: number;
      endColumnIndex?: number;
    } = { sheetId };

    // 1-based inclusive A1 rows → 0-based half-open [start, end).
    if (start.row !== undefined) gridRange.startRowIndex = start.row;
    if (end.row !== undefined) gridRange.endRowIndex = end.row + 1;
    if (start.col !== undefined) gridRange.startColumnIndex = start.col;
    if (end.col !== undefined) gridRange.endColumnIndex = end.col + 1;

    return gridRange;
  }

  /**
   * Normalize a hex color (e.g. '#FDE68A' or 'FDE68A' or '#fff') to a Google Sheets
   * Color object with 0–1 red/green/blue components.
   */
  private hexToColor(hex: string): { red: number; green: number; blue: number } {
    const clean = hex.replace(/^#/, '').trim();
    const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
    if (!/^[0-9a-fA-F]{6}$/.test(full)) {
      throw new Error(`invalid_color: "${hex}" is not a valid hex color (expected #RRGGBB).`);
    }
    return {
      red: parseInt(full.slice(0, 2), 16) / 255,
      green: parseInt(full.slice(2, 4), 16) / 255,
      blue: parseInt(full.slice(4, 6), 16) / 255,
    };
  }

  // ==========================================================================
  // Phase 1 formatting / structural actions: format_cells, clear_range,
  // delete_rows.
  // ==========================================================================

  /**
   * Apply cell formatting (bold and/or background color via repeatCell) and/or a
   * frozen header row (via updateSheetProperties) in a single batchUpdate.
   * Non-destructive and idempotent. If no format field is supplied it is a no-op
   * success.
   */
  private async formatCells(connection: any, parameters: any): Promise<any> {
    const { spreadsheet_id, range, bold, background_color, freeze_rows } = parameters;

    if (!spreadsheet_id) throw new Error('spreadsheet_id is required');
    if (!range) throw new Error('range is required');

    // The A1 sheet-name prefix (if any) resolves the numeric sheetId; no prefix
    // ⇒ default to the first tab (documented in usage_context).
    const bang = range.lastIndexOf('!');
    const sheetName = bang >= 0 ? range.slice(0, bang).replace(/^'(.*)'$/, '$1') : undefined;
    const { sheetId, title } = await this.resolveSheetId(connection, spreadsheet_id, sheetName);

    const gridRange = this.a1RangeToGridRange(range, sheetId);

    const requests: any[] = [];

    const hasBold = typeof bold === 'boolean';
    const hasBackground = typeof background_color === 'string' && background_color.length > 0;

    // repeatCell: build the `fields` mask from ONLY the supplied subfields (CR-C).
    // A broad `userEnteredFormat` mask would clobber the user's unrelated existing
    // cell formatting — a silent data-loss bug — so we never emit it.
    if (hasBold || hasBackground) {
      const userEnteredFormat: any = {};
      const fieldMasks: string[] = [];
      if (hasBold) {
        userEnteredFormat.textFormat = { bold };
        fieldMasks.push('userEnteredFormat.textFormat.bold');
      }
      if (hasBackground) {
        userEnteredFormat.backgroundColor = this.hexToColor(background_color);
        fieldMasks.push('userEnteredFormat.backgroundColor');
      }
      requests.push({
        repeatCell: {
          range: gridRange,
          cell: { userEnteredFormat },
          fields: fieldMasks.join(','),
        },
      });
    }

    // updateSheetProperties: frozen rows are sheet-level and independent of the
    // row bounds in `range` (documented in usage_context). 0 unfreezes.
    const hasFreeze = typeof freeze_rows === 'number' && Number.isInteger(freeze_rows) && freeze_rows >= 0;
    if (hasFreeze) {
      requests.push({
        updateSheetProperties: {
          properties: { sheetId, gridProperties: { frozenRowCount: freeze_rows } },
          fields: 'gridProperties.frozenRowCount',
        },
      });
    }

    const formatSummary = {
      bold_applied: hasBold ? bold === true : false,
      background_applied: hasBackground,
      frozen_rows: hasFreeze ? freeze_rows : 0,
    };

    // Nothing to format → no-op success (no batchUpdate issued).
    if (requests.length > 0) {
      await this.sheetsBatchUpdate(connection, spreadsheet_id, requests);
    }

    return {
      spreadsheet_id,
      sheet_id: sheetId,
      sheet_name: title,
      range,
      format_summary: formatSummary,
      formatted_at: new Date().toISOString(),
    };
  }

  /**
   * Clear the VALUES in an A1 range (formatting/notes preserved) via the value-level
   * `values/{range}:clear` endpoint. Destructive but narrowly scoped to the exact
   * A1 range requested — never the whole sheet. Idempotent (clearing an empty range
   * still succeeds).
   */
  private async clearRange(connection: any, parameters: any): Promise<any> {
    const { spreadsheet_id, range } = parameters;

    if (!spreadsheet_id) throw new Error('spreadsheet_id is required');
    if (!range) throw new Error('range is required');

    const url = `${this.sheetsApisUrl}/${spreadsheet_id}/values/${encodeURIComponent(range)}:clear`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      const errorData = await response.text();
      this.logger.error({ errorData, status: response.status, spreadsheet_id, range }, 'Sheets clear_range failed');
      throw new Error(`Sheets API error: ${response.status} - ${errorData}`);
    }

    const data = await response.json();

    return {
      spreadsheet_id: data.spreadsheetId || spreadsheet_id,
      cleared_range: data.clearedRange || range,
      cleared_at: new Date().toISOString(),
    };
  }

  /**
   * Delete a row-index range via batchUpdate `deleteDimension`. Inputs are 1-based
   * inclusive (matching the row numbers a user sees in the Sheets UI) and converted
   * internally to Google's 0-based half-open [startIndex, endIndex).
   *
   * NOT idempotent — deleteDimension shifts subsequent row indices up, so re-running
   * the same start_row/end_row deletes a different set of rows.
   *
   * Safety-critical (CR-D): the bounds guard runs BEFORE any network call, and the
   * emitted deleteDimension.range ALWAYS carries a finite endIndex. An omitted
   * endIndex would be interpreted by Google as "delete to the end of the sheet" — the
   * exact whole-sheet wipe this action must never produce.
   */
  private async deleteRows(connection: any, parameters: any): Promise<any> {
    const { spreadsheet_id, sheet_name, start_row, end_row } = parameters;

    if (!spreadsheet_id) throw new Error('spreadsheet_id is required');

    // Bounds guard — runs before any fetch so a malformed range can never widen
    // into a full-sheet delete.
    if (
      typeof start_row !== 'number' || typeof end_row !== 'number' ||
      !Number.isInteger(start_row) || !Number.isInteger(end_row)
    ) {
      throw new Error('invalid_range: start_row and end_row must be integers.');
    }
    if (start_row < 1) {
      throw new Error('invalid_range: start_row must be >= 1 (rows are 1-based).');
    }
    if (end_row < start_row) {
      throw new Error(`invalid_range: end_row (${end_row}) must be >= start_row (${start_row}).`);
    }

    const { sheetId, title } = await this.resolveSheetId(connection, spreadsheet_id, sheet_name);

    // 1-based inclusive → 0-based half-open. endIndex is ALWAYS finite (CR-D).
    const startIndex = start_row - 1;
    const endIndex = end_row;

    await this.sheetsBatchUpdate(connection, spreadsheet_id, [
      {
        deleteDimension: {
          range: { sheetId, dimension: 'ROWS', startIndex, endIndex },
        },
      },
    ]);

    return {
      spreadsheet_id,
      sheet_id: sheetId,
      sheet_name: title,
      deleted_row_count: end_row - start_row + 1,
      start_row,
      end_row,
      deleted_at: new Date().toISOString(),
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
}
