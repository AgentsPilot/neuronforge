/**
 * Unit tests for DropboxPluginExecutor -- 11 actions
 *
 * Actions: list_files, search_files, download_file, upload_file,
 *          create_folder, get_or_create_folder, delete_file,
 *          move_file, copy_file, create_shared_link, get_file_metadata
 */

import { DropboxPluginExecutor } from '@/lib/server/dropbox-plugin-executor';
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

const PLUGIN_KEY = 'dropbox';
const USER_ID = 'test-user-id';

describe('DropboxPluginExecutor', () => {
  let executor: any;

  beforeAll(async () => {
    const ctx = await createTestExecutor(DropboxPluginExecutor, PLUGIN_KEY);
    executor = ctx.executor;
  });

  afterEach(() => {
    restoreFetch();
  });

  describe('[smoke]', () => {
    describe('list_files', () => {
      it('should list files in a folder', async () => {
        mockFetchSuccess({
          entries: [
            {
              '.tag': 'file',
              id: 'id:file-1',
              name: 'doc.txt',
              path_display: '/doc.txt',
              path_lower: '/doc.txt',
              size: 1024,
              client_modified: '2026-01-01T00:00:00Z',
              server_modified: '2026-01-01T00:00:00Z',
              is_downloadable: true,
              content_hash: 'abc123',
            },
            {
              '.tag': 'folder',
              id: 'id:folder-1',
              name: 'Photos',
              path_display: '/Photos',
              path_lower: '/photos',
            },
          ],
          has_more: false,
          cursor: 'cursor-abc',
        });

        const result = await executor.executeAction(USER_ID, 'list_files', {
          path: '',
        });

        expectSuccessResult(result);
        expect(result.data.files).toHaveLength(2);
        expect(result.data.files[0].name).toBe('doc.txt');
        expect(result.data.files[1].is_folder).toBe(true);
        expect(result.data.has_more).toBe(false);
        expectFetchCalledWith('api.dropboxapi.com/2/files/list_folder', 'POST');
        expectAllFetchCallsAuthorized();
      });
    });

    describe('search_files', () => {
      it('should search files by query', async () => {
        mockFetchSuccess({
          matches: [
            {
              metadata: {
                metadata: {
                  '.tag': 'file',
                  id: 'id:match-1',
                  name: 'report.pdf',
                  path_display: '/report.pdf',
                  path_lower: '/report.pdf',
                  size: 2048,
                  server_modified: '2026-01-05T00:00:00Z',
                },
              },
            },
          ],
          has_more: false,
        });

        const result = await executor.executeAction(USER_ID, 'search_files', {
          query: 'report',
        });

        expectSuccessResult(result);
        expect(result.data.files).toHaveLength(1);
        expect(result.data.files[0].name).toBe('report.pdf');
        expectFetchCalledWith('api.dropboxapi.com/2/files/search_v2', 'POST');
      });
    });

    describe('create_folder', () => {
      it('should create a folder', async () => {
        mockFetchSuccess({
          metadata: {
            id: 'id:new-folder',
            name: 'NewFolder',
            path_display: '/NewFolder',
            path_lower: '/newfolder',
          },
        });

        const result = await executor.executeAction(USER_ID, 'create_folder', {
          path: '/NewFolder',
        });

        expectSuccessResult(result);
        expect(result.data.id).toBe('id:new-folder');
        expect(result.data.name).toBe('NewFolder');
        expectFetchCalledWith('api.dropboxapi.com/2/files/create_folder_v2', 'POST');
      });
    });

    describe('delete_file', () => {
      it('should delete a file by path', async () => {
        mockFetchSuccess({
          metadata: { '.tag': 'file', id: 'id:deleted', name: 'old.txt' },
        });

        const result = await executor.executeAction(USER_ID, 'delete_file', {
          path: '/old.txt',
        });

        expectSuccessResult(result);
        expect(result.data.deleted_path).toBe('/old.txt');
        expectFetchCalledWith('api.dropboxapi.com/2/files/delete_v2', 'POST');
      });
    });

    describe('move_file', () => {
      it('should move a file to a new path', async () => {
        mockFetchSuccess({
          metadata: {
            id: 'id:moved',
            name: 'doc.txt',
            path_display: '/Archive/doc.txt',
            path_lower: '/archive/doc.txt',
          },
        });

        const result = await executor.executeAction(USER_ID, 'move_file', {
          from_path: '/doc.txt',
          to_path: '/Archive/doc.txt',
        });

        expectSuccessResult(result);
        expect(result.data.path_display).toBe('/Archive/doc.txt');
        expectFetchCalledWith('api.dropboxapi.com/2/files/move_v2', 'POST');
      });
    });

    describe('copy_file', () => {
      it('should copy a file to a new path', async () => {
        mockFetchSuccess({
          metadata: {
            id: 'id:copied',
            name: 'doc-copy.txt',
            path_display: '/Backup/doc-copy.txt',
            path_lower: '/backup/doc-copy.txt',
          },
        });

        const result = await executor.executeAction(USER_ID, 'copy_file', {
          from_path: '/doc.txt',
          to_path: '/Backup/doc-copy.txt',
        });

        expectSuccessResult(result);
        expect(result.data.name).toBe('doc-copy.txt');
        expectFetchCalledWith('api.dropboxapi.com/2/files/copy_v2', 'POST');
      });
    });

    describe('create_shared_link', () => {
      it('should create a shared link for a file', async () => {
        mockFetchSuccess({
          url: 'https://www.dropbox.com/s/abc/doc.txt?dl=0',
          path_lower: '/doc.txt',
          expires: null,
          visibility: { '.tag': 'public' },
        });

        const result = await executor.executeAction(USER_ID, 'create_shared_link', {
          path: '/doc.txt',
        });

        expectSuccessResult(result);
        expect(result.data.url).toContain('dropbox.com');
        expectFetchCalledWith('api.dropboxapi.com/2/sharing/create_shared_link_with_settings', 'POST');
      });
    });

    describe('get_file_metadata', () => {
      it('should return metadata for a file', async () => {
        mockFetchSuccess({
          '.tag': 'file',
          id: 'id:file-1',
          name: 'image.png',
          path_display: '/image.png',
          path_lower: '/image.png',
          size: 4096,
          client_modified: '2026-02-01T00:00:00Z',
          server_modified: '2026-02-01T00:00:00Z',
          is_downloadable: true,
          content_hash: 'hash-xyz',
        });

        const result = await executor.executeAction(USER_ID, 'get_file_metadata', {
          path: '/image.png',
        });

        expectSuccessResult(result);
        expect(result.data.name).toBe('image.png');
        expect(result.data.size).toBe(4096);
        expect(result.data.is_folder).toBe(false);
        expectFetchCalledWith('api.dropboxapi.com/2/files/get_metadata', 'POST');
      });
    });

    describe('get_or_create_folder', () => {
      it('should return existing folder when found', async () => {
        // get_or_create_folder first calls get_file_metadata, which succeeds
        mockFetchSuccess({
          '.tag': 'folder',
          id: 'id:existing-folder',
          name: 'Docs',
          path_display: '/Docs',
          path_lower: '/docs',
          is_downloadable: false,
        });

        const result = await executor.executeAction(USER_ID, 'get_or_create_folder', {
          path: '/Docs',
        });

        expectSuccessResult(result);
        expect(result.data.already_existed).toBe(true);
        expect(result.data.name).toBe('Docs');
      });
    });

    describe('download_file', () => {
      it('should download a file and return its content', async () => {
        // download_file uses makeDropboxContentRequest which returns a raw Response;
        // we need custom headers including 'dropbox-api-result' with file metadata
        const fileContent = 'Hello, Dropbox!';
        const metadata = {
          name: 'hello.txt',
          size: fileContent.length,
          path_display: '/hello.txt',
          server_modified: '2026-03-01T00:00:00Z',
        };
        const contentBuffer = Buffer.from(fileContent, 'utf-8');

        // Install custom fetch mock to provide the dropbox-api-result header
        restoreFetch();
        const originalFetch = global.fetch;
        const calls: Array<{ url: string; options?: RequestInit }> = [];
        global.fetch = (async (url: string, opts?: RequestInit) => {
          calls.push({ url, options: opts });
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: new Headers({
              'content-type': 'application/octet-stream',
              'dropbox-api-result': JSON.stringify(metadata),
            }),
            json: async () => ({}),
            text: async () => fileContent,
            arrayBuffer: async () => contentBuffer.buffer.slice(
              contentBuffer.byteOffset,
              contentBuffer.byteOffset + contentBuffer.byteLength
            ),
            clone: () => ({}),
            body: null,
            bodyUsed: false,
            blob: async () => new Blob([fileContent]),
            formData: async () => new FormData(),
            redirected: false,
            type: 'basic' as ResponseType,
            url: '',
            bytes: async () => new Uint8Array(),
          } as Response;
        }) as typeof global.fetch;

        const result = await executor.executeAction(USER_ID, 'download_file', {
          path: '/hello.txt',
        });

        // Restore fetch before assertions so afterEach cleanup works
        global.fetch = originalFetch;

        expectSuccessResult(result);
        expect(result.data.name).toBe('hello.txt');
        expect(result.data.size).toBe(fileContent.length);
        expect(result.data.content).toBe(fileContent);
        expect(result.data.is_base64).toBe(false);
        expect(calls[0].url).toContain('content.dropboxapi.com/2/files/download');
      });
    });

    describe('upload_file', () => {
      it('should upload a file and return metadata', async () => {
        // upload_file uses makeDropboxContentRequest, then calls response.json()
        // The standard mock works because buildResponse provides a working .json()
        mockFetchSuccess({
          id: 'id:uploaded-1',
          name: 'notes.txt',
          path_display: '/notes.txt',
          path_lower: '/notes.txt',
          size: 512,
          server_modified: '2026-04-01T00:00:00Z',
          content_hash: 'hash-upload-1',
        });

        const result = await executor.executeAction(USER_ID, 'upload_file', {
          path: '/notes.txt',
          content: 'Some file content here',
        });

        expectSuccessResult(result);
        expect(result.data.id).toBe('id:uploaded-1');
        expect(result.data.name).toBe('notes.txt');
        expect(result.data.path_display).toBe('/notes.txt');
        expect(result.data.size).toBe(512);
        expectFetchCalledWith('content.dropboxapi.com/2/files/upload', 'POST');
      });
    });
  });

  describe('[full]', () => {
    describe('list_files', () => {
      it('should handle API error', async () => {
        mockFetchError(400, JSON.stringify({ error_summary: 'path/not_found/.' }));

        const result = await executor.executeAction(USER_ID, 'list_files', {
          path: '/nonexistent',
        });

        expectErrorResult(result);
      });
    });

    describe('search_files', () => {
      it('should handle 500 server error', async () => {
        mockFetchError(500, 'Internal Server Error');

        const result = await executor.executeAction(USER_ID, 'search_files', {
          query: 'test',
        });

        expectErrorResult(result);
      });
    });

    describe('get_or_create_folder', () => {
      it('should create folder when not found', async () => {
        mockFetchSequence([
          // get_file_metadata returns 409 (not found for Dropbox)
          { body: JSON.stringify({ error_summary: 'path/not_found/.' }), status: 409 },
          // create_folder succeeds
          {
            body: {
              metadata: {
                id: 'id:new-folder',
                name: 'NewDocs',
                path_display: '/NewDocs',
                path_lower: '/newdocs',
              },
            },
          },
        ]);

        const result = await executor.executeAction(USER_ID, 'get_or_create_folder', {
          path: '/NewDocs',
        });

        expectSuccessResult(result);
        expect(result.data.already_existed).toBe(false);
        expect(getAllFetchCalls()).toHaveLength(2);
      });
    });

    describe('create_shared_link', () => {
      it('should return existing link when shared_link_already_exists', async () => {
        mockFetchSequence([
          // First call fails with shared_link_already_exists
          {
            body: JSON.stringify({
              error_summary: 'shared_link_already_exists/.',
            }),
            status: 409,
          },
          // Fallback: list_shared_links returns existing link
          {
            body: {
              links: [
                {
                  url: 'https://www.dropbox.com/s/existing/doc.txt',
                  path_lower: '/doc.txt',
                  expires: null,
                  visibility: { '.tag': 'public' },
                },
              ],
            },
          },
        ]);

        const result = await executor.executeAction(USER_ID, 'create_shared_link', {
          path: '/doc.txt',
        });

        expectSuccessResult(result);
        expect(result.data.url).toContain('existing');
        expect(getAllFetchCalls()).toHaveLength(2);
      });
    });

    describe('move_file', () => {
      it('should handle conflict error', async () => {
        mockFetchError(409, JSON.stringify({ error_summary: 'to/conflict/file' }));

        const result = await executor.executeAction(USER_ID, 'move_file', {
          from_path: '/doc.txt',
          to_path: '/existing/doc.txt',
        });

        expectErrorResult(result);
      });
    });

    describe('delete_file', () => {
      it('should handle 404 path not found', async () => {
        mockFetchError(409, JSON.stringify({ error_summary: 'path_lookup/not_found/.' }));

        const result = await executor.executeAction(USER_ID, 'delete_file', {
          path: '/nonexistent.txt',
        });

        expectErrorResult(result);
      });
    });

    // ---- P3-T2: Standard error scenarios ----
    runStandardErrorScenarios(
      () => executor,
      DropboxPluginExecutor,
      PLUGIN_KEY,
      'list_files',
      { path: '/Documents' }
    );

    // ---- P3-T3: Malformed response tests ----
    describe('malformed responses', () => {
      it('handles response missing entries field', async () => {
        mockFetchSuccess({}); // Missing entries array
        const result = await executor.executeAction(USER_ID, 'list_files', {
          path: '/Documents',
        });
        expect(result).toBeDefined();
      });

      it('handles null response body', async () => {
        mockFetchSuccess(null);
        const result = await executor.executeAction(USER_ID, 'list_files', {
          path: '/Documents',
        });
        expect(result).toBeDefined();
      });
    });

    // ---- P3-T4: Authentication edge cases ----
    describe('authentication edge cases', () => {
      it('handles empty access_token', async () => {
        const ctx = await createTestExecutor(DropboxPluginExecutor, PLUGIN_KEY, {
          access_token: '',
        });
        mockFetchError(401, { error_summary: 'invalid_access_token/' });
        const result = await ctx.executor.executeAction(USER_ID, 'list_files', {
          path: '/Documents',
        });
        expectErrorResult(result);
      });
    });
  });
});
