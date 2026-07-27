/**
 * Integration tests for GoogleSheetsPluginExecutor
 *
 * Tests real Google Sheets API interactions: read from a known test spreadsheet.
 * Skips gracefully when GOOGLE_SHEETS_TEST_TOKEN is not set.
 *
 * Requires env vars:
 * - GOOGLE_SHEETS_TEST_TOKEN: OAuth access token
 * - GOOGLE_SHEETS_TEST_SPREADSHEET_ID: ID of a test spreadsheet (must exist)
 *
 * IMPORTANT: These tests are idempotent -- read-only operations by default.
 */

import { GoogleSheetsPluginExecutor } from '@/lib/server/google-sheets-plugin-executor';
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';
import { createTestPluginManager } from '../common/mock-plugin-manager';
import {
  describeIfCredentials,
  getTestConnection,
  getCredentials,
  generateTestId,
} from './integration-config';

const PLUGIN_KEY = 'google-sheets';
const USER_ID = 'integration-test-user';

/**
 * Additional skip guard: we need both a token AND a spreadsheet ID.
 */
function canRunTests(): boolean {
  const creds = getCredentials(PLUGIN_KEY);
  return creds !== null && !!creds.extras.spreadsheetId;
}

const conditionalDescribe = canRunTests() ? describe : describe.skip;

conditionalDescribe('GoogleSheetsPluginExecutor [integration]', () => {
  let executor: GoogleSheetsPluginExecutor;
  let pluginManager: PluginManagerV2;
  let spreadsheetId: string;

  beforeAll(async () => {
    pluginManager = await createTestPluginManager();
    const connection = getTestConnection(PLUGIN_KEY);
    const creds = getCredentials(PLUGIN_KEY)!;
    spreadsheetId = creds.extras.spreadsheetId;

    const userConnections = {
      getConnection: jest.fn().mockResolvedValue(connection),
      getConnectionStatus: jest.fn().mockResolvedValue({ connected: true, reason: 'connected' }),
      getConnectedPlugins: jest.fn().mockResolvedValue(connection ? [connection] : []),
      getConnectedPluginKeys: jest.fn().mockResolvedValue([PLUGIN_KEY]),
      getAllActivePlugins: jest.fn().mockResolvedValue(connection ? [connection] : []),
      getDisconnectedPluginKeys: jest.fn().mockResolvedValue([]),
      isTokenValid: jest.fn().mockReturnValue(true),
      shouldRefreshToken: jest.fn().mockReturnValue(false),
      refreshToken: jest.fn().mockResolvedValue(connection),
    } as any;

    executor = new GoogleSheetsPluginExecutor(userConnections, pluginManager);
  });

  describe('[smoke]', () => {
    it('should read data from the test spreadsheet', async () => {
      const result = await executor.executeAction(USER_ID, 'table_read', {
        spreadsheet_id: spreadsheetId,
        sheet_tab_name: 'Sheet1',
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });
  });

  describe('[full]', () => {
    // NOTE: The Google Sheets plugin does not have a row-delete action, so this test
    // creates a row that cannot be automatically cleaned up. Use a dedicated test
    // spreadsheet that can safely accumulate rows. Test data is identifiable by the
    // 'agentpilot-test-' prefix in column A.
    it('should create a row and then read it back', async () => {
      const testId = generateTestId();

      // Create a row with test data
      const createResult = await executor.executeAction(USER_ID, 'table_create', {
        spreadsheet_id: spreadsheetId,
        sheet_tab_name: 'Sheet1',
        row_data: { A: testId, B: 'integration-test-value' },
      });

      expect(createResult.success).toBe(true);

      // Read back to verify
      const readResult = await executor.executeAction(USER_ID, 'table_read', {
        spreadsheet_id: spreadsheetId,
        sheet_tab_name: 'Sheet1',
      });

      expect(readResult.success).toBe(true);
    });
  });

  // ==========================================================================
  // Phase 1 formatting / structural actions — deeper lifecycle coverage that
  // needs a live spreadsheet. Creates a throwaway spreadsheet, seeds a few rows,
  // then exercises format_cells → clear_range → delete_rows end-to-end. Skips
  // without credentials (same guard as the rest of this file).
  // ==========================================================================
  describe('[full] Phase 1 formatting / structural lifecycle', () => {
    it('creates → formats → clears → deletes rows on a live spreadsheet', async () => {
      // 1. Create a dedicated throwaway spreadsheet so we never mutate the shared one.
      const createResult = await executor.executeAction(USER_ID, 'create_spreadsheet', {
        title: `agentpilot-phase1-test-${generateTestId()}`,
      });
      expect(createResult.success).toBe(true);
      const newSpreadsheetId = createResult.data.spreadsheet_id;
      expect(newSpreadsheetId).toBeDefined();

      // 2. Seed a header + a few data rows.
      const writeResult = await executor.executeAction(USER_ID, 'write_range', {
        spreadsheet_id: newSpreadsheetId,
        range: 'Sheet1!A1:C5',
        values: [
          ['Name', 'Email', 'Status'],
          ['Alice', 'alice@example.com', 'Active'],
          ['Bob', 'bob@example.com', 'Pending'],
          ['Carol', 'carol@example.com', 'Active'],
          ['Dave', 'dave@example.com', 'Inactive'],
        ],
      });
      expect(writeResult.success).toBe(true);

      // 3. Format the header row: bold + background + freeze row 1.
      const formatResult = await executor.executeAction(USER_ID, 'format_cells', {
        spreadsheet_id: newSpreadsheetId,
        range: 'Sheet1!A1:C1',
        bold: true,
        background_color: '#FDE68A',
        freeze_rows: 1,
      });
      expect(formatResult.success).toBe(true);
      expect(formatResult.data.format_summary).toEqual({
        bold_applied: true,
        background_applied: true,
        frozen_rows: 1,
      });

      // 4. Clear the values in a data range (formatting preserved).
      const clearResult = await executor.executeAction(USER_ID, 'clear_range', {
        spreadsheet_id: newSpreadsheetId,
        range: 'Sheet1!A5:C5',
      });
      expect(clearResult.success).toBe(true);
      expect(clearResult.data.cleared_range).toBeDefined();

      // 5. Delete rows 2–3 (1-based inclusive) → 2 rows removed.
      const deleteResult = await executor.executeAction(USER_ID, 'delete_rows', {
        spreadsheet_id: newSpreadsheetId,
        sheet_name: 'Sheet1',
        start_row: 2,
        end_row: 3,
      });
      expect(deleteResult.success).toBe(true);
      expect(deleteResult.data.deleted_row_count).toBe(2);
    }, 60000);

    it('rejects an inverted row range (end_row < start_row) without deleting anything', async () => {
      const createResult = await executor.executeAction(USER_ID, 'create_spreadsheet', {
        title: `agentpilot-phase1-guard-${generateTestId()}`,
      });
      expect(createResult.success).toBe(true);

      const result = await executor.executeAction(USER_ID, 'delete_rows', {
        spreadsheet_id: createResult.data.spreadsheet_id,
        sheet_name: 'Sheet1',
        start_row: 5,
        end_row: 2,
      });
      expect(result.success).toBe(false);
    }, 60000);
  });
});
