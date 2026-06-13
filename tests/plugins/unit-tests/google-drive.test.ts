/**
 * Unit tests for GoogleDrivePluginExecutor — 9 actions
 */

import { GoogleDrivePluginExecutor } from '@/lib/server/google-drive-plugin-executor';
import { createTestExecutor, expectSuccessResult, expectErrorResult, expectFetchCalledWith } from '../common/test-helpers';
import { mockFetchSuccess, mockFetchError, mockFetchSequence, restoreFetch, getAllFetchCalls } from '../common/mock-fetch';
import { runStandardErrorScenarios } from '../common/error-scenarios';
import * as fs from 'fs';
import * as path from 'path';

const PLUGIN_KEY = 'google-drive';
const USER_ID = 'test-user-id';

describe('GoogleDrivePluginExecutor', () => {
  let executor: any;

  beforeAll(async () => {
    const ctx = await createTestExecutor(GoogleDrivePluginExecutor, PLUGIN_KEY);
    executor = ctx.executor;
  });

  afterEach(() => {
    restoreFetch();
  });

  describe('[smoke]', () => {
    // ---- list_files ----
    describe('list_files', () => {
      it('should list files via Drive API', async () => {
        mockFetchSuccess({
          files: [{ id: 'f1', name: 'Doc1', mimeType: 'application/pdf' }],
          nextPageToken: null,
        });

        const result = await executor.executeAction(USER_ID, 'list_files', {});

        expectSuccessResult(result);
        expect(result.data.files).toHaveLength(1);
        expectFetchCalledWith('drive/v3/files');
      });
    });

    // ---- search_files ----
    describe('search_files', () => {
      it('should search files with query parameter', async () => {
        mockFetchSuccess({
          files: [{ id: 'f2', name: 'Report.docx', mimeType: 'application/msword' }],
        });

        const result = await executor.executeAction(USER_ID, 'search_files', {
          query: "name contains 'Report'",
        });

        expectSuccessResult(result);
        expect(result.data.file_count).toBe(1);
      });
    });

    // ---- get_file_metadata ----
    describe('get_file_metadata', () => {
      it('should return detailed file metadata', async () => {
        mockFetchSuccess({
          id: 'file-meta-1',
          name: 'Presentation.pptx',
          mimeType: 'application/vnd.google-apps.presentation',
          size: '1048576',
          createdTime: '2026-01-01T00:00:00Z',
          modifiedTime: '2026-03-01T00:00:00Z',
          webViewLink: 'https://docs.google.com/presentation/d/file-meta-1',
        });

        const result = await executor.executeAction(USER_ID, 'get_file_metadata', {
          file_id: 'file-meta-1',
        });

        expectSuccessResult(result);
        expect(result.data.file_name).toBe('Presentation.pptx');
        expect(result.data.file_type).toBe('presentation');
      });
    });

    // ---- read_file_content ----
    describe('read_file_content', () => {
      it('should read file content (Google Doc export)', async () => {
        mockFetchSequence([
          // Metadata call
          { body: { id: 'gdoc-1', name: 'Notes.doc', mimeType: 'application/vnd.google-apps.document', size: '500' } },
          // Export call
          { body: 'Exported plain text content' },
        ]);

        const result = await executor.executeAction(USER_ID, 'read_file_content', {
          file_id: 'gdoc-1',
        });

        expectSuccessResult(result);
        expect(result.data.file_name).toBe('Notes.doc');
      });
    });

    // ---- download_file ----
    describe('download_file', () => {
      it('should download binary file bytes as base64 (not .text())', async () => {
        const pdfBytes = Buffer.from('%PDF-1.4\n0xDE 0xAD 0xBE 0xEF fake invoice bytes', 'utf-8');
        mockFetchSequence([
          // Metadata call
          { body: { id: 'pdf-1', name: 'invoice.pdf', mimeType: 'application/pdf', size: String(pdfBytes.length) } },
          // Binary download call (alt=media)
          { body: pdfBytes },
        ]);

        const result = await executor.executeAction(USER_ID, 'download_file', {
          file_id: 'pdf-1',
        });

        expectSuccessResult(result);
        expect(result.data.file_id).toBe('pdf-1');
        expect(result.data.filename).toBe('invoice.pdf');
        expect(result.data.mimeType).toBe('application/pdf');
        // content is base64 of the RAW bytes, and round-trips back exactly
        expect(result.data.content).toBe(pdfBytes.toString('base64'));
        expect(Buffer.from(result.data.content, 'base64').equals(pdfBytes)).toBe(true);
      });

      it('should reject native Google files (no downloadable bytes)', async () => {
        // Only the metadata call happens — the native-file guard throws before download
        mockFetchSuccess({ id: 'gdoc-1', name: 'Notes', mimeType: 'application/vnd.google-apps.document', size: '500' });

        const result = await executor.executeAction(USER_ID, 'download_file', {
          file_id: 'gdoc-1',
        });

        expectErrorResult(result, 'native Google');
      });
    });

    // ---- get_folder_contents ----
    describe('get_folder_contents', () => {
      it('should list folder items separated into folders and files', async () => {
        mockFetchSuccess({
          files: [
            { id: 'f1', name: 'SubFolder', mimeType: 'application/vnd.google-apps.folder' },
            { id: 'f2', name: 'File.txt', mimeType: 'text/plain' },
          ],
        });

        const result = await executor.executeAction(USER_ID, 'get_folder_contents', {
          folder_id: 'root',
        });

        expectSuccessResult(result);
        expect(result.data.folder_count).toBe(1);
        expect(result.data.file_count).toBe(1);
      });
    });

    // ---- upload_file ----
    describe('upload_file', () => {
      it('should upload file via multipart endpoint', async () => {
        mockFetchSuccess({
          id: 'uploaded-1',
          name: 'upload.txt',
          mimeType: 'text/plain',
          size: '100',
          webViewLink: 'https://drive.google.com/file/d/uploaded-1/view',
        });

        const result = await executor.executeAction(USER_ID, 'upload_file', {
          file_name: 'upload.txt',
          file_content: Buffer.from('Hello').toString('base64'),
          mime_type: 'text/plain',
        });

        expectSuccessResult(result);
        expect(result.data.file_id).toBe('uploaded-1');
        expectFetchCalledWith('upload/drive/v3/files', 'POST');
      });
    });

    // ---- create_folder ----
    describe('create_folder', () => {
      it('should create a folder with correct MIME type', async () => {
        mockFetchSuccess({
          id: 'folder-new',
          name: 'New Folder',
          mimeType: 'application/vnd.google-apps.folder',
        });

        const result = await executor.executeAction(USER_ID, 'create_folder', {
          folder_name: 'New Folder',
        });

        expectSuccessResult(result);
        expect(result.data.folder_id).toBe('folder-new');
        expectFetchCalledWith('drive/v3/files', 'POST');
      });
    });

    // ---- get_or_create_folder ----
    describe('get_or_create_folder', () => {
      it('should return existing folder when found', async () => {
        mockFetchSuccess({
          files: [{ id: 'existing-folder', name: 'Projects', webViewLink: 'https://link' }],
        });

        const result = await executor.executeAction(USER_ID, 'get_or_create_folder', {
          folder_name: 'Projects',
        });

        expectSuccessResult(result);
        expect(result.data.created).toBe(false);
        expect(result.data.folder_id).toBe('existing-folder');
      });
    });

    // ---- share_file ----
    describe('share_file', () => {
      it('should create permission and return share info', async () => {
        mockFetchSequence([
          // Create permission
          { body: { id: 'perm-1' } },
          // getFileMetadata call
          {
            body: {
              id: 'shared-file',
              name: 'Shared.doc',
              mimeType: 'text/plain',
              webViewLink: 'https://drive.google.com/file/d/shared-file/view',
            },
          },
        ]);

        const result = await executor.executeAction(USER_ID, 'share_file', {
          file_id: 'shared-file',
          permission_type: 'anyone',
          role: 'reader',
        });

        expectSuccessResult(result);
        expect(result.data.permission_id).toBe('perm-1');
      });
    });
  });

  describe('[full]', () => {
    // ---- search_files empty result ----
    describe('search_files', () => {
      it('should return empty result when nothing found', async () => {
        mockFetchSuccess({ files: [] });

        const result = await executor.executeAction(USER_ID, 'search_files', {
          query: "name contains 'NonExistent'",
        });

        expectSuccessResult(result);
        expect(result.data.file_count).toBe(0);
      });
    });

    // ---- get_file_metadata error ----
    describe('get_file_metadata', () => {
      it('should handle 400 error response', async () => {
        mockFetchError(400, JSON.stringify({
          error: { code: 400, message: 'Invalid file ID format', status: 'INVALID_ARGUMENT' },
        }));

        const result = await executor.executeAction(USER_ID, 'get_file_metadata', {
          file_id: 'bad-id!!!',
        });

        expectErrorResult(result);
      });
    });

    // ---- get_or_create_folder create path ----
    describe('get_or_create_folder', () => {
      it('should create folder when not found', async () => {
        mockFetchSequence([
          // Search returns empty
          { body: { files: [] } },
          // Create folder
          { body: { id: 'new-folder', name: 'Projects', mimeType: 'application/vnd.google-apps.folder' } },
        ]);

        const result = await executor.executeAction(USER_ID, 'get_or_create_folder', {
          folder_name: 'Projects',
        });

        expectSuccessResult(result);
        expect(result.data.created).toBe(true);
      });
    });

    // ---- P3-T2: Standard error scenarios ----
    runStandardErrorScenarios(
      () => executor,
      GoogleDrivePluginExecutor,
      PLUGIN_KEY,
      'list_files',
      {}
    );

    // ---- P3-T3: Malformed response tests ----
    describe('malformed responses', () => {
      it('handles response missing files field', async () => {
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
        const ctx = await createTestExecutor(GoogleDrivePluginExecutor, PLUGIN_KEY, {
          access_token: '',
        });
        mockFetchError(401, { error: { code: 401, message: 'Invalid credentials' } });
        const result = await ctx.executor.executeAction(USER_ID, 'list_files', {});
        expectErrorResult(result);
      });
    });
  });

  // ---- read_file_content: real PDF text extraction (WP-57 #2) ----
  describe('read_file_content — PDF text extraction', () => {
    const fixturePath = path.join(process.cwd(), 'tests', 'plugins', 'fixtures', 'Invoice677931.pdf');
    const run = fs.existsSync(fixturePath) ? it : it.skip;

    run('extracts real text from a PDF (not corrupted binary)', async () => {
      const pdfBytes = fs.readFileSync(fixturePath);
      mockFetchSequence([
        // Metadata call (mimeType drives the PDF text-extraction branch)
        { body: { id: 'pdf-1', name: 'Invoice677931.pdf', mimeType: 'application/pdf', size: String(pdfBytes.length) } },
        // alt=media binary download
        { body: pdfBytes },
      ]);

      const result = await executor.executeAction(USER_ID, 'read_file_content', { file_id: 'pdf-1' });

      expectSuccessResult(result);
      expect(result.data.mime_type).toBe('application/pdf');
      expect(result.data.export_format).toBe('text/plain');
      // Real extracted text — contains the invoice number, NOT UTF-8-mangled binary.
      expect(result.data.content.length).toBeGreaterThan(0);
      expect(result.data.content).toContain('677931');
    }, 30000);
  });
});
