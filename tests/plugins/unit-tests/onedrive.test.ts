/**
 * Unit tests for OneDrivePluginExecutor -- 12 actions
 *
 * Actions: list_files, search_files, get_file_metadata, download_file,
 *          upload_file, create_folder, get_or_create_folder, delete_file,
 *          move_file, copy_file, create_share_link, get_thumbnails
 */

import { OneDrivePluginExecutor } from '@/lib/server/onedrive-plugin-executor';
import {
  createTestExecutor,
  expectSuccessResult,
  expectErrorResult,
  expectFetchCalledWith,
  expectAllFetchCallsAuthorized,
} from '../common/test-helpers';
import {
  mockFetchSuccess,
  mockFetchError,
  mockFetchSequence,
  restoreFetch,
  getAllFetchCalls,
} from '../common/mock-fetch';
import { runStandardErrorScenarios } from '../common/error-scenarios';

const PLUGIN_KEY = 'onedrive';
const USER_ID = 'test-user-id';

describe('OneDrivePluginExecutor', () => {
  let executor: any;

  beforeAll(async () => {
    const ctx = await createTestExecutor(OneDrivePluginExecutor, PLUGIN_KEY);
    executor = ctx.executor;
  });

  afterEach(() => {
    restoreFetch();
  });

  describe('[smoke]', () => {
    describe('list_files', () => {
      it('should list files in root when no folder_id given', async () => {
        mockFetchSuccess({
          value: [
            {
              id: 'item-1',
              name: 'doc.docx',
              size: 1024,
              createdDateTime: '2026-01-01T00:00:00Z',
              lastModifiedDateTime: '2026-01-02T00:00:00Z',
              webUrl: 'https://onedrive.live.com/item-1',
              file: { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
            },
          ],
        });

        const result = await executor.executeAction(USER_ID, 'list_files', {});

        expectSuccessResult(result);
        expect(result.data.files).toHaveLength(1);
        expect(result.data.files[0].name).toBe('doc.docx');
        expect(result.data.files[0].isFolder).toBe(false);
        expectFetchCalledWith('graph.microsoft.com/v1.0/me/drive/root/children');
        expectAllFetchCallsAuthorized();
      });
    });

    describe('search_files', () => {
      it('should search files by query', async () => {
        mockFetchSuccess({
          value: [
            {
              id: 'item-2',
              name: 'report.pdf',
              size: 2048,
              lastModifiedDateTime: '2026-02-01T00:00:00Z',
              webUrl: 'https://onedrive.live.com/item-2',
              file: { mimeType: 'application/pdf' },
            },
          ],
        });

        const result = await executor.executeAction(USER_ID, 'search_files', {
          query: 'report',
        });

        expectSuccessResult(result);
        expect(result.data.files).toHaveLength(1);
        expect(result.data.files[0].name).toBe('report.pdf');
        expectFetchCalledWith('graph.microsoft.com/v1.0/me/drive/root/search');
      });
    });

    describe('get_file_metadata', () => {
      it('should return metadata for a file', async () => {
        mockFetchSuccess({
          id: 'item-1',
          name: 'photo.jpg',
          size: 4096,
          file: { mimeType: 'image/jpeg' },
          createdDateTime: '2026-01-01T00:00:00Z',
          lastModifiedDateTime: '2026-01-02T00:00:00Z',
          webUrl: 'https://onedrive.live.com/item-1',
          createdBy: { user: { displayName: 'Test User' } },
          lastModifiedBy: { user: { displayName: 'Test User' } },
        });

        const result = await executor.executeAction(USER_ID, 'get_file_metadata', {
          file_id: 'item-1',
        });

        expectSuccessResult(result);
        expect(result.data.name).toBe('photo.jpg');
        expect(result.data.mimeType).toBe('image/jpeg');
        expectFetchCalledWith('graph.microsoft.com/v1.0/me/drive/items/item-1');
      });
    });

    describe('create_folder', () => {
      it('should create a folder in root', async () => {
        mockFetchSuccess({
          id: 'folder-new',
          name: 'NewFolder',
          webUrl: 'https://onedrive.live.com/folder-new',
          createdDateTime: '2026-04-12T00:00:00Z',
          folder: { childCount: 0 },
        });

        const result = await executor.executeAction(USER_ID, 'create_folder', {
          folder_name: 'NewFolder',
        });

        expectSuccessResult(result);
        expect(result.data.folder_id).toBe('folder-new');
        expect(result.data.folder_name).toBe('NewFolder');
        expectFetchCalledWith('graph.microsoft.com/v1.0/me/drive/root/children', 'POST');
      });
    });

    describe('get_or_create_folder', () => {
      it('should return existing folder when found', async () => {
        mockFetchSuccess({
          value: [
            {
              id: 'folder-existing',
              name: 'Docs',
              webUrl: 'https://onedrive.live.com/folder-existing',
              createdDateTime: '2026-01-01T00:00:00Z',
              folder: { childCount: 5 },
            },
          ],
        });

        const result = await executor.executeAction(USER_ID, 'get_or_create_folder', {
          folder_name: 'Docs',
        });

        expectSuccessResult(result);
        expect(result.data.folder_id).toBe('folder-existing');
        expect(result.data.created).toBe(false);
      });
    });

    describe('delete_file', () => {
      it('should delete a file by ID', async () => {
        mockFetchSequence([
          // First call: get metadata
          { body: { id: 'item-del', name: 'old.txt', size: 100 } },
          // Second call: DELETE returns 204
          { body: {}, status: 204 },
        ]);

        const result = await executor.executeAction(USER_ID, 'delete_file', {
          file_id: 'item-del',
        });

        expectSuccessResult(result);
        expect(result.data.deleted).toBe(true);
        expect(result.data.file_name).toBe('old.txt');
        expect(getAllFetchCalls()).toHaveLength(2);
      });
    });

    describe('move_file', () => {
      it('should move a file to a destination folder', async () => {
        mockFetchSuccess({
          id: 'item-moved',
          name: 'doc.txt',
          webUrl: 'https://onedrive.live.com/item-moved',
        });

        const result = await executor.executeAction(USER_ID, 'move_file', {
          file_id: 'item-1',
          destination_folder_id: 'folder-dest',
        });

        expectSuccessResult(result);
        expect(result.data.new_parent_id).toBe('folder-dest');
        expectFetchCalledWith('graph.microsoft.com/v1.0/me/drive/items/item-1', 'PATCH');
      });
    });

    describe('get_thumbnails', () => {
      it('should return thumbnail URLs for a file', async () => {
        mockFetchSuccess({
          value: [
            {
              small: { url: 'https://thumb.small.jpg' },
              medium: { url: 'https://thumb.medium.jpg' },
              large: { url: 'https://thumb.large.jpg' },
            },
          ],
        });

        const result = await executor.executeAction(USER_ID, 'get_thumbnails', {
          file_id: 'item-1',
        });

        expectSuccessResult(result);
        expect(result.data.thumbnails.medium).toContain('thumb.medium');
        expectFetchCalledWith('graph.microsoft.com/v1.0/me/drive/items/item-1/thumbnails');
      });
    });

    describe('download_file', () => {
      it('should download a file and return metadata with download URL', async () => {
        // download_file first calls makeGraphRequest to get metadata,
        // then fetches the downloadUrl. We use mockFetchSequence for both calls.
        mockFetchSequence([
          // First: get file metadata (includes download URL)
          {
            body: {
              id: 'item-dl',
              name: 'report.pdf',
              size: 8192,
              file: { mimeType: 'application/pdf' },
              '@microsoft.graph.downloadUrl': 'https://download.onedrive.com/file-content',
            },
          },
          // Second: actual file download (arrayBuffer is used but returns empty in mock)
          { body: '' },
        ]);

        const result = await executor.executeAction(USER_ID, 'download_file', {
          file_id: 'item-dl',
        });

        expectSuccessResult(result);
        expect(result.data.file_name).toBe('report.pdf');
        expect(result.data.mime_type).toBe('application/pdf');
        expect(result.data.size).toBe(8192);
        expect(result.data.download_url).toContain('download.onedrive.com');
        expect(getAllFetchCalls()).toHaveLength(2);
      });
    });

    describe('upload_file', () => {
      it('should upload a file and return file metadata', async () => {
        // upload_file uses raw fetch (not makeGraphRequest) with PUT method
        mockFetchSuccess({
          id: 'item-uploaded',
          name: 'notes.txt',
          webUrl: 'https://onedrive.live.com/item-uploaded',
          size: 256,
        });

        const result = await executor.executeAction(USER_ID, 'upload_file', {
          file_name: 'notes.txt',
          file_content: Buffer.from('Hello OneDrive').toString('base64'),
        });

        expectSuccessResult(result);
        expect(result.data.file_id).toBe('item-uploaded');
        expect(result.data.file_name).toBe('notes.txt');
        expect(result.data.web_url).toContain('onedrive.live.com');
        expectFetchCalledWith('graph.microsoft.com/v1.0/me/drive/root:/notes.txt:/content', 'PUT');
      });
    });

    describe('create_share_link', () => {
      it('should create a sharing link', async () => {
        mockFetchSequence([
          // First: get file metadata
          { body: { id: 'item-1', name: 'shared.pdf', size: 1000 } },
          // Second: createLink
          {
            body: {
              link: { webUrl: 'https://1drv.ms/share-link' },
            },
          },
        ]);

        const result = await executor.executeAction(USER_ID, 'create_share_link', {
          file_id: 'item-1',
        });

        expectSuccessResult(result);
        expect(result.data.share_link).toContain('1drv.ms');
        expect(getAllFetchCalls()).toHaveLength(2);
      });
    });
  });

  describe('[full]', () => {
    describe('list_files', () => {
      it('should handle 401 auth error', async () => {
        mockFetchError(401, 'Unauthorized');

        const result = await executor.executeAction(USER_ID, 'list_files', {});

        expectErrorResult(result);
      });
    });

    describe('search_files', () => {
      it('should handle 403 permission denied', async () => {
        mockFetchError(403, 'Forbidden');

        const result = await executor.executeAction(USER_ID, 'search_files', {
          query: 'secret',
        });

        expectErrorResult(result);
      });
    });

    describe('get_or_create_folder', () => {
      it('should create folder when search returns empty', async () => {
        mockFetchSequence([
          // Search returns empty
          { body: { value: [] } },
          // Create folder
          {
            body: {
              id: 'folder-created',
              name: 'NewDocs',
              webUrl: 'https://onedrive.live.com/folder-created',
              createdDateTime: '2026-04-12T00:00:00Z',
            },
          },
        ]);

        const result = await executor.executeAction(USER_ID, 'get_or_create_folder', {
          folder_name: 'NewDocs',
        });

        expectSuccessResult(result);
        expect(result.data.created).toBe(true);
      });
    });

    describe('get_thumbnails', () => {
      it('should handle file with no thumbnails', async () => {
        mockFetchSuccess({ value: [] });

        const result = await executor.executeAction(USER_ID, 'get_thumbnails', {
          file_id: 'item-text',
        });

        expectErrorResult(result);
      });
    });

    describe('copy_file', () => {
      it('should handle 202 async copy response', async () => {
        // copy_file uses raw fetch, not makeGraphRequest, so we mock 202 response
        mockFetchSuccess(
          '', // 202 responses may have empty body
          202
        );

        const result = await executor.executeAction(USER_ID, 'copy_file', {
          file_id: 'item-1',
          destination_folder_id: 'folder-dest',
        });

        expectSuccessResult(result);
        expect(result.data.file_id).toBe('pending');
      });
    });

    describe('delete_file', () => {
      it('should handle 404 not found error', async () => {
        mockFetchError(404, 'Not Found');

        const result = await executor.executeAction(USER_ID, 'delete_file', {
          file_id: 'nonexistent',
        });

        expectErrorResult(result);
      });
    });

    // ---- P3-T2: Standard error scenarios ----
    runStandardErrorScenarios(
      () => executor,
      OneDrivePluginExecutor,
      PLUGIN_KEY,
      'list_files',
      {}
    );

    // ---- P3-T3: Malformed response tests ----
    describe('malformed responses', () => {
      it('handles response missing value field', async () => {
        mockFetchSuccess({});
        const result = await executor.executeAction(USER_ID, 'list_files', {});
        expect(result).toBeDefined();
      });

      it('handles null response body', async () => {
        mockFetchSuccess(null);
        const result = await executor.executeAction(USER_ID, 'list_files', {});
        expect(result).toBeDefined();
      });
    });

    // ---- P3-T4: Authentication edge cases ----
    describe('authentication edge cases', () => {
      it('handles empty access_token', async () => {
        const ctx = await createTestExecutor(OneDrivePluginExecutor, PLUGIN_KEY, {
          access_token: '',
        });
        mockFetchError(401, { error: { code: 'InvalidAuthenticationToken', message: 'Access token is empty' } });
        const result = await ctx.executor.executeAction(USER_ID, 'list_files', {});
        expectErrorResult(result);
      });
    });
  });
});
