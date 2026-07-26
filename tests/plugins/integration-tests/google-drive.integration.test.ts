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

    it('should download a real file as base64 (round-trips to bytes, not .text())', async () => {
      const creds = getCredentials(PLUGIN_KEY);
      const fileId = creds?.extras.fileId;
      if (!fileId) {
        // No specific test file configured — set GOOGLE_DRIVE_TEST_FILE_ID to a binary
        // file (e.g. a PDF invoice) to exercise the real download_file → base64 path (WP-57).
        return;
      }

      const dl = await executor.executeAction(USER_ID, 'download_file', { file_id: fileId });

      expect(dl.success).toBe(true);
      expect(dl.data.mimeType).toBeTruthy();
      // content must be non-empty base64 that decodes to real bytes
      expect(typeof dl.data.content).toBe('string');
      expect(dl.data.content.length).toBeGreaterThan(0);
      const bytes = Buffer.from(dl.data.content, 'base64');
      expect(bytes.length).toBeGreaterThan(0);
      // canonical base64 — proves no corruption from a .text() round-trip
      expect(bytes.toString('base64')).toBe(dl.data.content);
    });

    it('should search for files by name', async () => {
      const result = await executor.executeAction(USER_ID, 'search_files', {
        query: 'agentpilot-integration-test-nonexistent',
        max_results: 1,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    // ---- Phase 1 file-management lifecycle: upload → rename → copy → move → trash ----
    it('should upload, rename, copy, move, then trash files (Phase 1)', async () => {
      const creds = getCredentials(PLUGIN_KEY);
      const folderId = creds?.extras.folderId;
      const testId = generateTestId();

      // Upload a temp text file.
      const uploadResult = await executor.executeAction(USER_ID, 'upload_file', {
        file_name: `agentpilot-phase1-${testId}.txt`,
        file_content: Buffer.from('phase1 test content').toString('base64'),
        mime_type: 'text/plain',
        ...(folderId ? { folder_id: folderId } : {}),
      });
      expect(uploadResult.success).toBe(true);
      const uploadedId = uploadResult.data?.file_id;
      expect(uploadedId).toBeDefined();
      cleanupFileIds.push(uploadedId);

      // Rename it.
      const renameResult = await executor.executeAction(USER_ID, 'rename_file', {
        file_id: uploadedId,
        new_name: `agentpilot-phase1-renamed-${testId}.txt`,
      });
      expect(renameResult.success).toBe(true);
      expect(renameResult.data?.file_name).toContain('renamed');
      expect(renameResult.data?.previous_name).toBeDefined();

      // Copy it.
      const copyResult = await executor.executeAction(USER_ID, 'copy_file', {
        file_id: uploadedId,
        new_name: `agentpilot-phase1-copy-${testId}.txt`,
        ...(folderId ? { target_folder_id: folderId } : {}),
      });
      expect(copyResult.success).toBe(true);
      const copyId = copyResult.data?.file_id;
      expect(copyId).toBeDefined();
      expect(copyId).not.toBe(uploadedId);
      cleanupFileIds.push(copyId);

      // Create a destination folder and move the copy into it.
      const destFolder = await executor.executeAction(USER_ID, 'create_folder', {
        folder_name: `agentpilot-phase1-dest-${testId}`,
        ...(folderId ? { parent_folder_id: folderId } : {}),
      });
      expect(destFolder.success).toBe(true);
      const destFolderId = destFolder.data?.folder_id;
      cleanupFileIds.push(destFolderId);

      const moveResult = await executor.executeAction(USER_ID, 'move_file', {
        file_id: copyId,
        target_folder_id: destFolderId,
      });
      expect(moveResult.success).toBe(true);
      expect(moveResult.data?.moved).toBe(true);
      expect(moveResult.data?.parents).toContain(destFolderId);

      // Trash both files.
      for (const id of [uploadedId, copyId]) {
        const del = await executor.executeAction(USER_ID, 'delete_file', { file_id: id });
        expect(del.success).toBe(true);
        expect(del.data?.trashed).toBe(true);
        expect(del.data?.restorable).toBe(true);
      }
    });

    // ---- share_file → revoke_access (Phase 1) ----
    it('should share a file then revoke the permission (Phase 1)', async () => {
      const creds = getCredentials(PLUGIN_KEY);
      const folderId = creds?.extras.folderId;
      const testId = generateTestId();

      const uploadResult = await executor.executeAction(USER_ID, 'upload_file', {
        file_name: `agentpilot-phase1-share-${testId}.txt`,
        file_content: Buffer.from('shareable content').toString('base64'),
        mime_type: 'text/plain',
        ...(folderId ? { folder_id: folderId } : {}),
      });
      expect(uploadResult.success).toBe(true);
      const uploadedId = uploadResult.data?.file_id;
      cleanupFileIds.push(uploadedId);

      // Share with anyone-with-link (no external recipient needed).
      const shareResult = await executor.executeAction(USER_ID, 'share_file', {
        file_id: uploadedId,
        permission_type: 'anyone',
        role: 'reader',
      });
      expect(shareResult.success).toBe(true);
      const permissionId = shareResult.data?.permission_id;
      expect(permissionId).toBeDefined();

      // Revoke it.
      const revokeResult = await executor.executeAction(USER_ID, 'revoke_access', {
        file_id: uploadedId,
        permission_id: permissionId,
      });
      expect(revokeResult.success).toBe(true);
      expect(revokeResult.data?.revoked).toBe(true);

      // Revoking again is idempotent: already_absent.
      const revokeAgain = await executor.executeAction(USER_ID, 'revoke_access', {
        file_id: uploadedId,
        permission_id: permissionId,
      });
      expect(revokeAgain.success).toBe(true);
      expect(revokeAgain.data?.already_absent).toBe(true);
    });
  });
});
