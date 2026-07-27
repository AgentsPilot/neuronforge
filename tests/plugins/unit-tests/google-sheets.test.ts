/**
 * Unit tests for GoogleSheetsPluginExecutor — 7 actions
 */

import { GoogleSheetsPluginExecutor } from '@/lib/server/google-sheets-plugin-executor';
import { createTestExecutor, expectSuccessResult, expectErrorResult, expectFetchCalledWith } from '../common/test-helpers';
import { mockFetchSuccess, mockFetchError, mockFetchSequence, restoreFetch, getAllFetchCalls } from '../common/mock-fetch';
import { runStandardErrorScenarios } from '../common/error-scenarios';

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

  describe('[smoke]', () => {
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
    });
  });

  describe('[full]', () => {
    // ---- read_range formula option ----
    describe('read_range', () => {
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

    // ---- get_or_create_spreadsheet create path ----
    describe('get_or_create_spreadsheet', () => {
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

    // ---- get_or_create_sheet_tab create path ----
    describe('get_or_create_sheet_tab', () => {
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

    // ---- P3-T2: Standard error scenarios ----
    runStandardErrorScenarios(
      () => executor,
      GoogleSheetsPluginExecutor,
      PLUGIN_KEY,
      'read_range',
      { spreadsheet_id: 'ss-1', range: 'Sheet1!A1:B2' }
    );

    // ---- P3-T3: Malformed response tests ----
    describe('malformed responses', () => {
      it('handles response missing values field', async () => {
        mockFetchSuccess({ range: 'Sheet1!A1:B2' });
        const result = await executor.executeAction(USER_ID, 'read_range', {
          spreadsheet_id: 'ss-1',
          range: 'Sheet1!A1:B2',
        });
        expect(result).toBeDefined();
      });

      it('handles null response body', async () => {
        mockFetchSuccess(null);
        const result = await executor.executeAction(USER_ID, 'read_range', {
          spreadsheet_id: 'ss-1',
          range: 'Sheet1!A1:B2',
        });
        expect(result).toBeDefined();
      });
    });

    // ---- P3-T4: Authentication edge cases ----
    describe('authentication edge cases', () => {
      it('handles empty access_token', async () => {
        const ctx = await createTestExecutor(GoogleSheetsPluginExecutor, PLUGIN_KEY, {
          access_token: '',
        });
        mockFetchError(401, { error: { code: 401, message: 'Invalid credentials' } });
        const result = await ctx.executor.executeAction(USER_ID, 'read_range', {
          spreadsheet_id: 'ss-1',
          range: 'Sheet1!A1:B2',
        });
        expectErrorResult(result);
      });
    });

    // ---- P3-T5: Pagination edge cases ----
    describe('pagination edge cases', () => {
      it('handles empty values in range response', async () => {
        mockFetchSuccess({ range: 'Sheet1!A1:Z1000', values: [] });
        const result = await executor.executeAction(USER_ID, 'read_range', {
          spreadsheet_id: 'ss-1',
          range: 'Sheet1!A1:Z1000',
        });
        expectSuccessResult(result);
        expect(result.data.row_count).toBe(0);
      });
    });
  });

  // ==========================================================================
  // Phase 1 formatting / structural actions: format_cells, clear_range,
  // delete_rows. LEAN policy — exactly 3 tests per action (happy + 401 auth +
  // invalid-input) + one safety-critical delete_rows bounded-range assertion +
  // a couple of pure a1RangeToGridRange checks.
  // ==========================================================================
  describe('Phase 1 formatting / structural actions', () => {
    // A spreadsheet-info body with one tab named 'Sheet1' (sheetId 0), used to
    // resolve the numeric sheetId for the batchUpdate-based actions.
    const infoBody = {
      spreadsheetId: 'ss-fmt',
      spreadsheetUrl: 'https://link',
      properties: { title: 'Fmt Sheet', locale: 'en', timeZone: 'UTC' },
      sheets: [{ properties: { sheetId: 0, title: 'Sheet1', index: 0, sheetType: 'GRID' } }],
    };

    // ---- format_cells ----
    describe('format_cells', () => {
      it('applies bold + background + freeze via a single batchUpdate', async () => {
        mockFetchSequence([
          { body: infoBody }, // resolveSheetId → getSpreadsheetInfo
          { body: { replies: [{}, {}] } }, // batchUpdate
        ]);

        const result = await executor.executeAction(USER_ID, 'format_cells', {
          spreadsheet_id: 'ss-fmt',
          range: 'Sheet1!A1:D1',
          bold: true,
          background_color: '#FDE68A',
          freeze_rows: 1,
        });

        expectSuccessResult(result);
        expect(result.data.format_summary).toEqual({
          bold_applied: true,
          background_applied: true,
          frozen_rows: 1,
        });
        expectFetchCalledWith(':batchUpdate', 'POST');

        // The batchUpdate carries BOTH a repeatCell and an updateSheetProperties.
        const batchCall = getAllFetchCalls().find(c => c.url.includes(':batchUpdate'));
        const body = JSON.parse((batchCall!.options as any).body);
        const kinds = body.requests.map((r: any) => Object.keys(r)[0]);
        expect(kinds).toContain('repeatCell');
        expect(kinds).toContain('updateSheetProperties');

        // CR-C: the repeatCell fields mask is scoped to ONLY the supplied subfields —
        // never a broad `userEnteredFormat` that would clobber unrelated formatting.
        const repeatCell = body.requests.find((r: any) => r.repeatCell).repeatCell;
        const maskFields = repeatCell.fields.split(',');
        expect(maskFields).toContain('userEnteredFormat.textFormat.bold');
        expect(maskFields).toContain('userEnteredFormat.backgroundColor');
        expect(maskFields).not.toContain('userEnteredFormat');
      });

      it('returns an error on 401 auth failure', async () => {
        mockFetchError(401, { error: { code: 401, message: 'Invalid credentials' } });

        const result = await executor.executeAction(USER_ID, 'format_cells', {
          spreadsheet_id: 'ss-fmt',
          range: 'Sheet1!A1:D1',
          bold: true,
        });

        expectErrorResult(result);
      });

      it('rejects missing range (invalid input)', async () => {
        const result = await executor.executeAction(USER_ID, 'format_cells', {
          spreadsheet_id: 'ss-fmt',
          bold: true,
        });

        expectErrorResult(result);
      });
    });

    // ---- clear_range ----
    describe('clear_range', () => {
      it('clears a range via the values :clear endpoint', async () => {
        mockFetchSuccess({ spreadsheetId: 'ss-clr', clearedRange: 'Sheet1!A2:D100' });

        const result = await executor.executeAction(USER_ID, 'clear_range', {
          spreadsheet_id: 'ss-clr',
          range: 'Sheet1!A2:D100',
        });

        expectSuccessResult(result);
        expect(result.data.cleared_range).toBe('Sheet1!A2:D100');
        expectFetchCalledWith(':clear', 'POST');
      });

      it('returns an error on 401 auth failure', async () => {
        mockFetchError(401, { error: { code: 401, message: 'Invalid credentials' } });

        const result = await executor.executeAction(USER_ID, 'clear_range', {
          spreadsheet_id: 'ss-clr',
          range: 'Sheet1!A2:D100',
        });

        expectErrorResult(result);
      });

      it('rejects missing range (invalid input)', async () => {
        const result = await executor.executeAction(USER_ID, 'clear_range', {
          spreadsheet_id: 'ss-clr',
        });

        expectErrorResult(result);
      });
    });

    // ---- delete_rows ----
    describe('delete_rows', () => {
      it('deletes a bounded row range via batchUpdate deleteDimension', async () => {
        mockFetchSequence([
          { body: infoBody }, // resolveSheetId
          { body: { replies: [{}] } }, // batchUpdate
        ]);

        const result = await executor.executeAction(USER_ID, 'delete_rows', {
          spreadsheet_id: 'ss-del',
          sheet_name: 'Sheet1',
          start_row: 2,
          end_row: 5,
        });

        expectSuccessResult(result);
        expect(result.data.deleted_row_count).toBe(4);
        expectFetchCalledWith(':batchUpdate', 'POST');
      });

      it('returns an error on 401 auth failure', async () => {
        mockFetchError(401, { error: { code: 401, message: 'Invalid credentials' } });

        const result = await executor.executeAction(USER_ID, 'delete_rows', {
          spreadsheet_id: 'ss-del',
          sheet_name: 'Sheet1',
          start_row: 2,
          end_row: 5,
        });

        expectErrorResult(result);
      });

      it('rejects end_row < start_row and issues NO fetch (invalid input)', async () => {
        // No mock installed — if a fetch were issued it would throw, surfacing the
        // guard-before-network contract.
        const result = await executor.executeAction(USER_ID, 'delete_rows', {
          spreadsheet_id: 'ss-del',
          sheet_name: 'Sheet1',
          start_row: 5,
          end_row: 2,
        });

        expectErrorResult(result);
        expect(getAllFetchCalls()).toHaveLength(0);
      });

      // ---- Safety-critical: DELETE-INTENDED-RANGE-ONLY ----
      it('SAFETY: sends a bounded deleteDimension range with a finite endIndex (never whole-sheet)', async () => {
        mockFetchSequence([
          { body: infoBody },
          { body: { replies: [{}] } },
        ]);

        await executor.executeAction(USER_ID, 'delete_rows', {
          spreadsheet_id: 'ss-del',
          sheet_name: 'Sheet1',
          start_row: 2,
          end_row: 5,
        });

        const batchCall = getAllFetchCalls().find(c => c.url.includes(':batchUpdate'));
        expect(batchCall).toBeDefined();
        const body = JSON.parse((batchCall!.options as any).body);
        const range = body.requests[0].deleteDimension.range;

        // rows 2–5 (1-based inclusive) → 0-based half-open [1, 5).
        expect(range).toEqual({ sheetId: 0, dimension: 'ROWS', startIndex: 1, endIndex: 5 });
        // CR-D: both bounds are finite — an omitted/undefined endIndex would let
        // Google delete to the end of the sheet.
        expect(Number.isFinite(range.startIndex)).toBe(true);
        expect(Number.isFinite(range.endIndex)).toBe(true);
      });
    });

    // ---- Pure a1RangeToGridRange (deterministic, no network) ----
    describe('a1RangeToGridRange (pure)', () => {
      it('parses a header range into a 0-based half-open GridRange', () => {
        const gr = (executor as any).a1RangeToGridRange('Sheet1!A1:D1', 7);
        expect(gr).toEqual({
          sheetId: 7,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: 4,
        });
      });

      it('omits row bounds for a whole-column range (A:D)', () => {
        const gr = (executor as any).a1RangeToGridRange('A:D', 0);
        expect(gr).toEqual({ sheetId: 0, startColumnIndex: 0, endColumnIndex: 4 });
      });
    });
  });
});
