/**
 * Integration tests for GoogleDrivePluginExecutor
 *
 * Tests real Google Drive API interactions: list files, create temp file, delete.
 * Skips gracefully when GOOGLE_DRIVE_TEST_TOKEN is not set.
 *
 * Requires env vars:
 * - GOOGLE_DRIVE_TEST_TOKEN: OAuth access token
 * - GOOGLE_DRIVE_TEST_FOLDER_ID: (optional) Folder ID to use as test sandbox
 *
 * IMPORTANT: These tests are idempotent -- all created files are
 * deleted in afterAll/afterEach blocks.
 */

import { GoogleDrivePluginExecutor } from '@/lib/server/google-drive-plugin-executor';
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';
import { createTestPluginManager } from '../common/mock-plugin-manager';
import {
  describeIfCredentials,
  getTestConnection,
  getCredentials,
  generateTestId,
} from './integration-config';

const PLUGIN_KEY = 'google-drive';
const USER_ID = 'integration-test-user';

const conditionalDescribe = describeIfCredentials(PLUGIN_KEY);

conditionalDescribe('GoogleDrivePluginExecutor [integration]', () => {
  let executor: GoogleDrivePluginExecutor;
  let pluginManager: PluginManagerV2;
  const cleanupFileIds: string[] = [];

  beforeAll(async () => {
    pluginManager = await createTestPluginManager();
    const connection = getTestConnection(PLUGIN_KEY);

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

    executor = new GoogleDrivePluginExecutor(userConnections, pluginManager);
  });

  afterAll(async () => {
    // Delete any files created during tests
    for (const fileId of cleanupFileIds) {
      try {
        await executor.executeAction(USER_ID, 'delete_file', {
          file_id: fileId,
        });
      } catch {
        // Best-effort cleanup
      }
    }
  });

  describe('[smoke]', () => {
    it('should list files in Drive', async () => {
      const result = await executor.executeAction(USER_ID, 'list_files', {
        max_results: 5,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });
  });

  describe('[full]', () => {
    it('should create a temporary file and then delete it', async () => {
      const creds = getCredentials(PLUGIN_KEY);
      const folderId = creds?.extras.folderId;
      const testId = generateTestId();

      // Step 1: Create a folder (as a test artifact)
      const createResult = await executor.executeAction(USER_ID, 'create_folder', {
        folder_name: `agentpilot-integration-test-${testId}`,
        ...(folderId ? { parent_folder_id: folderId } : {}),
      });

      expect(createResult.success).toBe(true);
      expect(createResult.data).toBeDefined();
      const createdId = createResult.data?.folder_id || createResult.data?.id;
      expect(createdId).toBeDefined();

      if (createdId) {
        cleanupFileIds.push(createdId);
      }

      // Step 2: Delete the created folder
      if (createdId) {
        const deleteResult = await executor.executeAction(USER_ID, 'delete_file', {
          file_id: createdId,
        });
        expect(deleteResult.success).toBe(true);

        // Remove from cleanup list
        const idx = cleanupFileIds.indexOf(createdId);
        if (idx >= 0) cleanupFileIds.splice(idx, 1);
      }
    });

    it('should search for files by name', async () => {
      const result = await executor.executeAction(USER_ID, 'search_files', {
        query: 'agentpilot-integration-test-nonexistent',
        max_results: 1,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });
  });
});
