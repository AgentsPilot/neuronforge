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
});
