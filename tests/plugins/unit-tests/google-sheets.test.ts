/**
 * Unit tests for GoogleSheetsPluginExecutor — 7 actions
 */

import { GoogleSheetsPluginExecutor } from '@/lib/server/google-sheets-plugin-executor';
import { createTestExecutor, expectSuccessResult, expectErrorResult, expectFetchCalledWith } from '../common/test-helpers';
import { mockFetchSuccess, mockFetchError, mockFetchSequence, restoreFetch, getAllFetchCalls } from '../common/mock-fetch';

const PLUGIN_KEY = 'google-sheets';
const USER_ID = 'test-user-id';

describe('GoogleSheetsPluginExecutor', () => {
  let executor: any;

  beforeAll(async () => {
    const ctx = await createTestExecutor(GoogleSheetsPluginExecutor, PLUGIN_KEY);
    executor = ctx.executor;
  });

  afterEach(() => {
    restoreFetch();
  });

  // ---- read_range ----
  describe('read_range', () => {
    it('should fetch range values with FORMATTED_VALUE render option', async () => {
      mockFetchSuccess({
        range: 'Sheet1!A1:B2',
        majorDimension: 'ROWS',
        values: [['Name', 'Age'], ['Alice', '30']],
      });

      const result = await executor.executeAction(USER_ID, 'read_range', {
        spreadsheet_id: 'spreadsheet-123',
        range: 'Sheet1!A1:B2',
      });

      expectSuccessResult(result);
      expect(result.data.values).toHaveLength(2);
      expect(result.data.row_count).toBe(2);
      expect(result.data.column_count).toBe(2);
      expectFetchCalledWith('sheets.googleapis.com/v4/spreadsheets/spreadsheet-123/values/');
    });

    it('should set FORMULA render option when include_formula_values is true', async () => {
      mockFetchSuccess({ range: 'Sheet1!A1', values: [['=SUM(A2:A10)']] });

      await executor.executeAction(USER_ID, 'read_range', {
        spreadsheet_id: 'ss-1',
        range: 'Sheet1!A1',
        include_formula_values: true,
      });

      const lastCall = getAllFetchCalls().pop();
      expect(lastCall?.url).toContain('valueRenderOption=FORMULA');
    });

    // SA review item #3: Google JSON error body
    it('should parse Google JSON error body for invalid range', async () => {
      mockFetchError(400, JSON.stringify({
        error: { code: 400, message: 'Unable to parse range: BadRange', status: 'INVALID_ARGUMENT' },
      }));

      const result = await executor.executeAction(USER_ID, 'read_range', {
        spreadsheet_id: 'ss-1',
        range: 'BadRange',
      });

      expectErrorResult(result);
      expect(result.message).toContain('Unable to parse range');
    });
  });

  // ---- write_range ----
  describe('write_range', () => {
    it('should PUT values to Sheets API', async () => {
      mockFetchSuccess({
        updatedRange: 'Sheet1!A1:B1',
        updatedRows: 1,
        updatedColumns: 2,
        updatedCells: 2,
      });

      const result = await executor.executeAction(USER_ID, 'write_range', {
        spreadsheet_id: 'ss-1',
        range: 'Sheet1!A1:B1',
        values: [['Hello', 'World']],
      });

      expectSuccessResult(result);
      expect(result.data.updated_rows).toBe(1);
      expectFetchCalledWith('sheets.googleapis.com/v4/spreadsheets/ss-1/values/', 'PUT');
    });
  });

  // ---- append_rows ----
  describe('append_rows', () => {
    it('should POST rows to the append endpoint', async () => {
      mockFetchSuccess({
        updates: { updatedRange: 'Sheet1!A3:B3', updatedRows: 1, updatedColumns: 2, updatedCells: 2 },
        tableRange: 'Sheet1!A1:B2',
      });

      const result = await executor.executeAction(USER_ID, 'append_rows', {
        spreadsheet_id: 'ss-1',
        range: 'Sheet1',
        values: [['New', 'Row']],
      });

      expectSuccessResult(result);
      expect(result.data.appended_rows).toBe(1);
      expectFetchCalledWith(':append', 'POST');
    });
  });

  // ---- create_spreadsheet ----
  describe('create_spreadsheet', () => {
    it('should create a new spreadsheet and return metadata', async () => {
      mockFetchSuccess({
        spreadsheetId: 'new-ss-id',
        spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/new-ss-id',
        properties: { title: 'My Spreadsheet' },
        sheets: [{ properties: { sheetId: 0, title: 'Sheet1', index: 0 } }],
      });

      const result = await executor.executeAction(USER_ID, 'create_spreadsheet', {
        title: 'My Spreadsheet',
      });

      expectSuccessResult(result);
      expect(result.data.spreadsheet_id).toBe('new-ss-id');
      expect(result.data.title).toBe('My Spreadsheet');
      expectFetchCalledWith('sheets.googleapis.com/v4/spreadsheets', 'POST');
    });
  });

  // ---- get_or_create_spreadsheet ----
  describe('get_or_create_spreadsheet', () => {
    it('should return existing spreadsheet when found via Drive search', async () => {
      mockFetchSequence([
        // Drive search returns existing file
        { body: { files: [{ id: 'existing-ss', name: 'My Sheet', webViewLink: 'https://link' }] } },
        // getSpreadsheetInfo call
        {
          body: {
            spreadsheetId: 'existing-ss',
            spreadsheetUrl: 'https://link',
            properties: { title: 'My Sheet', locale: 'en', timeZone: 'UTC' },
            sheets: [{ properties: { sheetId: 0, title: 'Sheet1', index: 0, sheetType: 'GRID' } }],
          },
        },
      ]);

      const result = await executor.executeAction(USER_ID, 'get_or_create_spreadsheet', {
        title: 'My Sheet',
      });

      expectSuccessResult(result);
      expect(result.data.created).toBe(false);
      expect(result.data.spreadsheet_id).toBe('existing-ss');
    });

    it('should create new spreadsheet when not found', async () => {
      mockFetchSequence([
        // Drive search returns no files
        { body: { files: [] } },
        // createSpreadsheet POST
        {
          body: {
            spreadsheetId: 'new-ss',
            spreadsheetUrl: 'https://new-link',
            properties: { title: 'New Sheet' },
            sheets: [{ properties: { sheetId: 0, title: 'Sheet1', index: 0 } }],
          },
        },
      ]);

      const result = await executor.executeAction(USER_ID, 'get_or_create_spreadsheet', {
        title: 'New Sheet',
      });

      expectSuccessResult(result);
      expect(result.data.created).toBe(true);
    });
  });

  // ---- get_spreadsheet_info ----
  describe('get_spreadsheet_info', () => {
    it('should return spreadsheet metadata', async () => {
      mockFetchSuccess({
        spreadsheetId: 'ss-info',
        spreadsheetUrl: 'https://link',
        properties: { title: 'Info Sheet', locale: 'en', timeZone: 'America/New_York' },
        sheets: [
          { properties: { sheetId: 0, title: 'Sheet1', index: 0, sheetType: 'GRID' } },
          { properties: { sheetId: 1, title: 'Sheet2', index: 1, sheetType: 'GRID' } },
        ],
      });

      const result = await executor.executeAction(USER_ID, 'get_spreadsheet_info', {
        spreadsheet_id: 'ss-info',
      });

      expectSuccessResult(result);
      expect(result.data.sheet_count).toBe(2);
      expect(result.data.title).toBe('Info Sheet');
    });
  });

  // ---- get_or_create_sheet_tab ----
  describe('get_or_create_sheet_tab', () => {
    it('should return existing tab when found', async () => {
      // getSpreadsheetInfo returns sheet with matching name
      mockFetchSuccess({
        spreadsheetId: 'ss-tab',
        spreadsheetUrl: 'https://link',
        properties: { title: 'Tab Sheet', locale: 'en', timeZone: 'UTC' },
        sheets: [
          { properties: { sheetId: 0, title: 'Sheet1', index: 0, sheetType: 'GRID' } },
          { properties: { sheetId: 1, title: 'DataTab', index: 1, sheetType: 'GRID' } },
        ],
      });

      const result = await executor.executeAction(USER_ID, 'get_or_create_sheet_tab', {
        spreadsheet_id: 'ss-tab',
        tab_name: 'DataTab',
      });

      expectSuccessResult(result);
      expect(result.data.existed).toBe(true);
      expect(result.data.sheet_id).toBe(1);
    });

    it('should create new tab when not found', async () => {
      mockFetchSequence([
        // getSpreadsheetInfo - no matching tab
        {
          body: {
            spreadsheetId: 'ss-tab2',
            spreadsheetUrl: 'https://link',
            properties: { title: 'Sheet', locale: 'en', timeZone: 'UTC' },
            sheets: [{ properties: { sheetId: 0, title: 'Sheet1', index: 0, sheetType: 'GRID' } }],
          },
        },
        // batchUpdate to create tab
        {
          body: {
            replies: [{ addSheet: { properties: { sheetId: 99, title: 'NewTab' } } }],
          },
        },
      ]);

      const result = await executor.executeAction(USER_ID, 'get_or_create_sheet_tab', {
        spreadsheet_id: 'ss-tab2',
        tab_name: 'NewTab',
      });

      expectSuccessResult(result);
      expect(result.data.existed).toBe(false);
      expect(result.data.sheet_id).toBe(99);
    });
  });
});
