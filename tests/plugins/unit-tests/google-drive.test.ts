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

  // ---- Drive URL → ID normalization (WP-57 2B) ----
  // Users paste full Drive/Docs URLs where actions expect a bare ID. The executor
  // normalises url-shaped id params (folder_id/file_id/parent_folder_id) before use.
  describe('Drive URL → ID normalization', () => {
    it('list_files: extracts the folder ID from a pasted folder URL', async () => {
      mockFetchSuccess({ files: [{ id: 'f1', name: 'Invoice.pdf', mimeType: 'application/pdf' }] });

      await executor.executeAction(USER_ID, 'list_files', {
        folder_id: 'https://drive.google.com/drive/u/0/folders/1Wszlm9qgqPVQyHYp1lWmlkipRFLVQLAk',
      });

      const call = getAllFetchCalls().find(c => c.url.includes('drive/v3/files'));
      expect(call).toBeDefined();
      // URLSearchParams encodes spaces as '+'; normalise before asserting.
      const decoded = decodeURIComponent(call!.url).replace(/\+/g, ' ');
      // The bare ID reaches the query; the raw URL does not leak into it.
      expect(decoded).toContain("'1Wszlm9qgqPVQyHYp1lWmlkipRFLVQLAk' in parents");
      expect(decoded).not.toContain('drive.google.com');
    });

    it('get_file_metadata: extracts the file ID from a /file/d/<id>/view link', async () => {
      mockFetchSuccess({ id: '1AbC_dEf-123', name: 'Doc.pdf', mimeType: 'application/pdf', size: '10' });

      await executor.executeAction(USER_ID, 'get_file_metadata', {
        file_id: 'https://drive.google.com/file/d/1AbC_dEf-123/view?usp=sharing',
      });

      const call = getAllFetchCalls().find(c => c.url.includes('drive/v3/files'));
      expect(call).toBeDefined();
      expect(call!.url).toContain('1AbC_dEf-123');
      expect(call!.url).not.toContain('https%3A');
    });

    it('passes a bare ID through unchanged', async () => {
      mockFetchSuccess({ files: [] });

      await executor.executeAction(USER_ID, 'list_files', {
        folder_id: '1TAUlds9R8r2lznDszbOwovpdM0cN7aFK',
      });

      const call = getAllFetchCalls().find(c => c.url.includes('drive/v3/files'));
      const decoded = decodeURIComponent(call!.url).replace(/\+/g, ' ');
      expect(decoded).toContain("'1TAUlds9R8r2lznDszbOwovpdM0cN7aFK' in parents");
    });
  });

  // ==========================================================================
  // Phase 1 file-management actions: move_file, rename_file, copy_file,
  // delete_file (trash-by-default), revoke_access.
  // ==========================================================================
  describe('Phase 1 file-management actions', () => {
    // ---- move_file ----
    describe('[smoke] move_file', () => {
      it('moves a file: GET live parents then PATCH addParents/removeParents', async () => {
        mockFetchSequence([
          // GET current parents
          { body: { id: 'file-1', name: 'Report.docx', parents: ['old-folder'] } },
          // PATCH move result
          { body: { id: 'file-1', name: 'Report.docx', parents: ['target-folder'], webViewLink: 'https://drive.google.com/file/d/file-1/view' } },
        ]);

        const result = await executor.executeAction(USER_ID, 'move_file', {
          file_id: 'file-1',
          target_folder_id: 'target-folder',
        });

        expectSuccessResult(result);
        expect(result.data.moved).toBe(true);
        expect(result.data.previous_parents).toEqual(['old-folder']);
        expect(result.data.parents).toEqual(['target-folder']);

        // The PATCH carries the computed add/remove parents.
        const patchCall = getAllFetchCalls().find(c => (c.options?.method || 'GET').toUpperCase() === 'PATCH');
        expect(patchCall).toBeDefined();
        const decoded = decodeURIComponent(patchCall!.url);
        expect(decoded).toContain('addParents=target-folder');
        expect(decoded).toContain('removeParents=old-folder');
      });
    });

    describe('[full] move_file', () => {
      it('is an idempotent no-op when the file is already solely in the target (moved:false, no PATCH)', async () => {
        // Only the GET-parents call happens; the file is already in the target.
        mockFetchSuccess({ id: 'file-1', name: 'Report.docx', parents: ['target-folder'] });

        const result = await executor.executeAction(USER_ID, 'move_file', {
          file_id: 'file-1',
          target_folder_id: 'target-folder',
        });

        expectSuccessResult(result);
        expect(result.data.moved).toBe(false);

        const calls = getAllFetchCalls();
        expect(calls).toHaveLength(1); // GET only — no PATCH churn
        expect(calls.every(c => (c.options?.method || 'GET').toUpperCase() !== 'PATCH')).toBe(true);
      });

      it('handles 404 file-not-found', async () => {
        mockFetchError(404, { error: { code: 404, message: 'File not found' } });

        const result = await executor.executeAction(USER_ID, 'move_file', {
          file_id: 'missing',
          target_folder_id: 'target-folder',
        });

        expectErrorResult(result);
      });

      it('handles 401 auth_failed (on the live-parents fetch)', async () => {
        mockFetchError(401, { error: { code: 401, message: 'Invalid credentials' } });

        const result = await executor.executeAction(USER_ID, 'move_file', {
          file_id: 'file-1',
          target_folder_id: 'target-folder',
        });

        expectErrorResult(result);
      });

      it('rejects missing target_folder_id (invalid input)', async () => {
        const result = await executor.executeAction(USER_ID, 'move_file', {
          file_id: 'file-1',
        });

        expectErrorResult(result);
      });
    });

    // ---- rename_file ----
    describe('[smoke] rename_file', () => {
      it('renames a file and reports previous_name', async () => {
        mockFetchSequence([
          // GET current name
          { body: { id: 'file-2', name: 'Old Name.docx' } },
          // PATCH rename result
          { body: { id: 'file-2', name: 'New Name.docx', webViewLink: 'https://drive.google.com/file/d/file-2/view' } },
        ]);

        const result = await executor.executeAction(USER_ID, 'rename_file', {
          file_id: 'file-2',
          new_name: 'New Name.docx',
        });

        expectSuccessResult(result);
        expect(result.data.file_name).toBe('New Name.docx');
        expect(result.data.previous_name).toBe('Old Name.docx');

        const patchCall = getAllFetchCalls().find(c => (c.options?.method || 'GET').toUpperCase() === 'PATCH');
        expect(patchCall).toBeDefined();
        expect(patchCall!.options?.body).toContain('New Name.docx');
      });
    });

    describe('[full] rename_file', () => {
      it('handles 403 permission_denied', async () => {
        mockFetchError(403, { error: { code: 403, message: 'The user does not have sufficient permissions' } });

        const result = await executor.executeAction(USER_ID, 'rename_file', {
          file_id: 'file-2',
          new_name: 'New Name.docx',
        });

        expectErrorResult(result);
      });

      it('handles 401 auth_failed', async () => {
        mockFetchError(401, { error: { code: 401, message: 'Invalid credentials' } });

        const result = await executor.executeAction(USER_ID, 'rename_file', {
          file_id: 'file-2',
          new_name: 'New Name.docx',
        });

        expectErrorResult(result);
      });

      it('rejects missing new_name (invalid input)', async () => {
        const result = await executor.executeAction(USER_ID, 'rename_file', {
          file_id: 'file-2',
        });

        expectErrorResult(result);
      });
    });

    // ---- copy_file ----
    describe('[smoke] copy_file', () => {
      it('copies a file and returns a NEW id distinct from the source', async () => {
        mockFetchSuccess({
          id: 'new-copy-id',
          name: 'Copy of Report.docx',
          mimeType: 'application/vnd.google-apps.document',
          parents: ['target-folder'],
          webViewLink: 'https://drive.google.com/file/d/new-copy-id/view',
        });

        const result = await executor.executeAction(USER_ID, 'copy_file', {
          file_id: 'source-id',
          new_name: 'Copy of Report.docx',
          target_folder_id: 'target-folder',
        });

        expectSuccessResult(result);
        expect(result.data.file_id).toBe('new-copy-id');
        expect(result.data.source_file_id).toBe('source-id');
        expect(result.data.file_id).not.toBe(result.data.source_file_id);
        expectFetchCalledWith('files/source-id/copy', 'POST');
      });
    });

    describe('[full] copy_file', () => {
      it('handles 404 source-not-found', async () => {
        mockFetchError(404, { error: { code: 404, message: 'File not found' } });

        const result = await executor.executeAction(USER_ID, 'copy_file', {
          file_id: 'missing',
        });

        expectErrorResult(result);
      });

      it('handles 401 auth_failed', async () => {
        mockFetchError(401, { error: { code: 401, message: 'Invalid credentials' } });

        const result = await executor.executeAction(USER_ID, 'copy_file', {
          file_id: 'source-id',
        });

        expectErrorResult(result);
      });

      it('rejects missing file_id (invalid input)', async () => {
        const result = await executor.executeAction(USER_ID, 'copy_file', {
          new_name: 'Copy of Report.docx',
        });

        expectErrorResult(result);
      });
    });

    // ---- delete_file (trash-by-default) ----
    describe('[smoke] delete_file', () => {
      it('trashes a file: returns trashed:true + restorable:true', async () => {
        mockFetchSuccess({ id: 'trash-me', name: 'Old Draft.docx', trashed: true });

        const result = await executor.executeAction(USER_ID, 'delete_file', {
          file_id: 'trash-me',
        });

        expectSuccessResult(result);
        expect(result.data.trashed).toBe(true);
        expect(result.data.restorable).toBe(true);
      });

      it('TRASH-NOT-DELETE: issues a PATCH {trashed:true} and NEVER a hard DELETE', async () => {
        mockFetchSuccess({ id: 'trash-me', name: 'Old Draft.docx', trashed: true });

        await executor.executeAction(USER_ID, 'delete_file', {
          file_id: 'trash-me',
        });

        const calls = getAllFetchCalls();
        const fileCall = calls.find(c => c.url.includes('drive/v3/files/trash-me'));
        expect(fileCall).toBeDefined();
        // The mutation is a trash update...
        expect((fileCall!.options?.method || 'GET').toUpperCase()).toBe('PATCH');
        expect(fileCall!.options?.body).toContain('"trashed":true');
        // ...and no hard DELETE is ever issued.
        const hardDelete = calls.find(c => (c.options?.method || 'GET').toUpperCase() === 'DELETE');
        expect(hardDelete).toBeUndefined();
      });
    });

    describe('[full] delete_file', () => {
      it('handles 404 file-not-found', async () => {
        mockFetchError(404, { error: { code: 404, message: 'File not found' } });

        const result = await executor.executeAction(USER_ID, 'delete_file', {
          file_id: 'missing',
        });

        expectErrorResult(result);
      });

      it('handles 401 auth_failed', async () => {
        mockFetchError(401, { error: { code: 401, message: 'Invalid credentials' } });

        const result = await executor.executeAction(USER_ID, 'delete_file', {
          file_id: 'trash-me',
        });

        expectErrorResult(result);
      });
    });

    // ---- revoke_access ----
    describe('[smoke] revoke_access', () => {
      it('revokes a permission (204 No Content) → revoked:true, already_absent:false', async () => {
        mockFetchSuccess({}, 204);

        const result = await executor.executeAction(USER_ID, 'revoke_access', {
          file_id: 'file-3',
          permission_id: 'perm-1',
        });

        expectSuccessResult(result);
        expect(result.data.revoked).toBe(true);
        expect(result.data.already_absent).toBe(false);
        expectFetchCalledWith('files/file-3/permissions/perm-1', 'DELETE');
      });
    });

    describe('[full] revoke_access', () => {
      it('idempotency: 404 (permission already gone) → revoked:true, already_absent:true (not thrown)', async () => {
        mockFetchError(404, { error: { code: 404, message: 'Permission not found' } });

        const result = await executor.executeAction(USER_ID, 'revoke_access', {
          file_id: 'file-3',
          permission_id: 'perm-gone',
        });

        expectSuccessResult(result);
        expect(result.data.revoked).toBe(true);
        expect(result.data.already_absent).toBe(true);
      });

      it('handles 401 auth_failed', async () => {
        mockFetchError(401, { error: { code: 401, message: 'Invalid credentials' } });

        const result = await executor.executeAction(USER_ID, 'revoke_access', {
          file_id: 'file-3',
          permission_id: 'perm-1',
        });

        expectErrorResult(result);
      });

      it('rejects missing permission_id (invalid input)', async () => {
        const result = await executor.executeAction(USER_ID, 'revoke_access', {
          file_id: 'file-3',
        });

        expectErrorResult(result);
      });
    });
  });
});
