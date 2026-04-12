/**
 * Unit tests for AirtablePluginExecutor — 8 actions
 */

import { AirtablePluginExecutor } from '@/lib/server/airtable-plugin-executor';
import { createTestExecutor, expectSuccessResult, expectErrorResult, expectFetchCalledWith, expectAllFetchCallsAuthorized } from '../common/test-helpers';
import { mockFetchSuccess, mockFetchError, mockFetchSequence, restoreFetch, getAllFetchCalls } from '../common/mock-fetch';
import { runStandardErrorScenarios } from '../common/error-scenarios';

const PLUGIN_KEY = 'airtable';
const USER_ID = 'test-user-id';

describe('AirtablePluginExecutor', () => {
  let executor: any;

  beforeAll(async () => {
    const ctx = await createTestExecutor(AirtablePluginExecutor, PLUGIN_KEY);
    executor = ctx.executor;
  });

  afterEach(() => {
    restoreFetch();
  });

  describe('[smoke]', () => {
    // ---- list_bases ----
    describe('list_bases', () => {
      it('should list accessible bases', async () => {
        mockFetchSuccess({
          bases: [
            { id: 'app123', name: 'My Base', permissionLevel: 'create' },
            { id: 'app456', name: 'Shared Base', permissionLevel: 'read' },
          ],
        });

        const result = await executor.executeAction(USER_ID, 'list_bases', {});

        expectSuccessResult(result);
        expect(result.data.bases).toHaveLength(2);
        expect(result.data.base_count).toBe(2);
        expectFetchCalledWith('api.airtable.com/v0/meta/bases');
        expectAllFetchCallsAuthorized();
      });
    });

    // ---- list_records ----
    describe('list_records', () => {
      it('should list records from a table', async () => {
        mockFetchSuccess({
          records: [
            { id: 'rec1', fields: { Name: 'Alice', Email: 'alice@test.com' }, createdTime: '2026-01-01' },
          ],
        });

        const result = await executor.executeAction(USER_ID, 'list_records', {
          base_id: 'app123',
          table_name: 'Contacts',
        });

        expectSuccessResult(result);
        expect(result.data.records).toHaveLength(1);
        expect(result.data.record_count).toBe(1);
        expectFetchCalledWith('api.airtable.com/v0/app123/Contacts');
      });
    });

    // ---- get_record ----
    describe('get_record', () => {
      it('should get a single record by ID', async () => {
        mockFetchSuccess({
          id: 'rec1',
          fields: { Name: 'Alice', Status: 'Active' },
          createdTime: '2026-01-01',
        });

        const result = await executor.executeAction(USER_ID, 'get_record', {
          base_id: 'app123',
          table_name: 'Contacts',
          record_id: 'rec1',
        });

        expectSuccessResult(result);
        expect(result.data.id).toBe('rec1');
        expect(result.data.fields.Name).toBe('Alice');
      });
    });

    // ---- create_records ----
    describe('create_records', () => {
      it('should create records via POST', async () => {
        mockFetchSuccess({
          records: [
            { id: 'recNew', fields: { Name: 'Bob' }, createdTime: '2026-03-27' },
          ],
        });

        const result = await executor.executeAction(USER_ID, 'create_records', {
          base_id: 'app123',
          table_name: 'Contacts',
          records: [{ fields: { Name: 'Bob' } }],
        });

        expectSuccessResult(result);
        expect(result.data.record_count).toBe(1);
        expectFetchCalledWith('api.airtable.com/v0/app123/Contacts', 'POST');
      });
    });

    // ---- update_records ----
    describe('update_records', () => {
      it('should update records via PATCH (partial)', async () => {
        mockFetchSuccess({
          records: [{ id: 'rec1', fields: { Name: 'Alice Updated' } }],
        });

        const result = await executor.executeAction(USER_ID, 'update_records', {
          base_id: 'app123',
          table_name: 'Contacts',
          records: [{ id: 'rec1', fields: { Name: 'Alice Updated' } }],
        });

        expectSuccessResult(result);
        expect(result.data.record_count).toBe(1);
        expectFetchCalledWith('api.airtable.com/v0/app123/Contacts', 'PATCH');
      });
    });

    // ---- list_tables ----
    describe('list_tables', () => {
      it('should list tables in a base', async () => {
        mockFetchSuccess({
          tables: [
            { id: 'tbl1', name: 'Contacts', primaryFieldId: 'fld1', fields: [1, 2], views: [1] },
            { id: 'tbl2', name: 'Tasks', primaryFieldId: 'fld2', fields: [1], views: [1, 2] },
          ],
        });

        const result = await executor.executeAction(USER_ID, 'list_tables', {
          base_id: 'app123',
        });

        expectSuccessResult(result);
        expect(result.data.tables).toHaveLength(2);
        expect(result.data.table_count).toBe(2);
        expectFetchCalledWith('api.airtable.com/v0/meta/bases/app123/tables');
      });
    });

    // ---- upload_attachment ----
    describe('upload_attachment', () => {
      it('should get existing record then PATCH with new attachment', async () => {
        mockFetchSequence([
          // GET existing record
          { body: { id: 'rec1', fields: { Photos: [] } } },
          // PATCH with new attachment
          { body: { records: [{ id: 'rec1', fields: { Photos: [{ id: 'att1', url: 'https://img.url', filename: 'photo.jpg', size: 1024, type: 'image/jpeg' }] } }] } },
        ]);

        const result = await executor.executeAction(USER_ID, 'upload_attachment', {
          base_id: 'app123',
          table_name: 'Contacts',
          record_id: 'rec1',
          field_name: 'Photos',
          attachment: { url: 'https://img.url', filename: 'photo.jpg' },
        });

        expectSuccessResult(result);
        expect(result.data.attachment_count).toBe(1);
      });
    });

    // ---- get_attachment_urls ----
    describe('get_attachment_urls', () => {
      it('should return attachment URLs from a record field', async () => {
        mockFetchSuccess({
          id: 'rec1',
          fields: {
            Documents: [
              { id: 'att1', url: 'https://dl.airtable.com/att1', filename: 'doc.pdf', size: 2048, type: 'application/pdf' },
            ],
          },
        });

        const result = await executor.executeAction(USER_ID, 'get_attachment_urls', {
          base_id: 'app123',
          table_name: 'Contacts',
          record_id: 'rec1',
          field_name: 'Documents',
        });

        expectSuccessResult(result);
        expect(result.data.attachments).toHaveLength(1);
        expect(result.data.attachments[0].filename).toBe('doc.pdf');
        expect(result.data.attachment_count).toBe(1);
      });
    });
  });

  describe('[full]', () => {
    // ---- list_records error ----
    describe('list_records', () => {
      it('should handle 404 error', async () => {
        mockFetchError(404, JSON.stringify({ error: { type: 'MODEL_ID_NOT_FOUND', message: 'Could not find table' } }));

        const result = await executor.executeAction(USER_ID, 'list_records', {
          base_id: 'app123',
          table_name: 'NonExistent',
        });

        expectErrorResult(result);
      });
    });

    // ---- update_records destructive mode ----
    describe('update_records', () => {
      it('should use PUT for destructive updates', async () => {
        mockFetchSuccess({
          records: [{ id: 'rec1', fields: { Name: 'Full Replace' } }],
        });

        const result = await executor.executeAction(USER_ID, 'update_records', {
          base_id: 'app123',
          table_name: 'Contacts',
          records: [{ id: 'rec1', fields: { Name: 'Full Replace' } }],
          destructive: true,
        });

        expectSuccessResult(result);
        expectFetchCalledWith('api.airtable.com/v0/app123/Contacts', 'PUT');
      });
    });

    // ---- P3-T2: Standard error scenarios ----
    runStandardErrorScenarios(
      () => executor,
      AirtablePluginExecutor,
      PLUGIN_KEY,
      'list_records',
      { base_id: 'app123', table_name: 'Contacts' }
    );

    // ---- P3-T3: Malformed response tests ----
    describe('malformed responses', () => {
      it('handles response missing records field', async () => {
        mockFetchSuccess({}); // Missing records array
        const result = await executor.executeAction(USER_ID, 'list_records', {
          base_id: 'app123',
          table_name: 'Contacts',
        });
        expect(result).toBeDefined();
      });

      it('handles null response body', async () => {
        mockFetchSuccess(null);
        const result = await executor.executeAction(USER_ID, 'list_records', {
          base_id: 'app123',
          table_name: 'Contacts',
        });
        expect(result).toBeDefined();
      });
    });

    // ---- P3-T4: Authentication edge cases ----
    describe('authentication edge cases', () => {
      it('handles empty access_token', async () => {
        const ctx = await createTestExecutor(AirtablePluginExecutor, PLUGIN_KEY, {
          access_token: '',
        });
        mockFetchError(401, { error: { type: 'AUTHENTICATION_REQUIRED' } });
        const result = await ctx.executor.executeAction(USER_ID, 'list_records', {
          base_id: 'app123',
          table_name: 'Contacts',
        });
        expectErrorResult(result);
      });
    });
  });
});
