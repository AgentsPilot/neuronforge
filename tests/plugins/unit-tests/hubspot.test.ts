/**
 * Unit tests for HubSpotPluginExecutor — 9 actions
 *
 * Note: The executor only implements 5 actions (get_contact, get_contact_deals,
 * get_contact_activities, search_contacts, get_deal). The remaining 4
 * (create_contact, create_task, create_deal, create_contact_note) are defined
 * in the JSON schema but hit the default "Unknown action" branch. Tests verify
 * both implemented actions and the unsupported action fallback.
 */

import { HubSpotPluginExecutor } from '@/lib/server/hubspot-plugin-executor';
import { createTestExecutor, expectSuccessResult, expectErrorResult, expectFetchCalledWith, expectAllFetchCallsAuthorized } from '../common/test-helpers';
import { mockFetchSuccess, mockFetchError, mockFetchSequence, restoreFetch, getAllFetchCalls } from '../common/mock-fetch';

const PLUGIN_KEY = 'hubspot';
const USER_ID = 'test-user-id';

describe('HubSpotPluginExecutor', () => {
  let executor: any;

  beforeAll(async () => {
    const ctx = await createTestExecutor(HubSpotPluginExecutor, PLUGIN_KEY);
    executor = ctx.executor;
  });

  afterEach(() => {
    restoreFetch();
  });

  // ---- get_contact ----
  describe('get_contact', () => {
    it('should search contact by email', async () => {
      mockFetchSuccess({
        results: [{
          id: 'contact-1',
          properties: { email: 'alice@example.com', firstname: 'Alice', lastname: 'Smith' },
          createdAt: '2026-01-01',
          updatedAt: '2026-03-01',
        }],
      });

      const result = await executor.executeAction(USER_ID, 'get_contact', {
        contact_identifier: 'alice@example.com',
        identifier_type: 'email',
      });

      expectSuccessResult(result);
      expect(result.data.data.contact_id).toBe('contact-1');
      expectFetchCalledWith('api.hubapi.com/crm/v3/objects/contacts/search', 'POST');
      expectAllFetchCallsAuthorized();
    });

    it('should get contact by ID', async () => {
      mockFetchSuccess({
        id: 'contact-2',
        properties: { email: 'bob@example.com' },
        createdAt: '2026-01-01',
        updatedAt: '2026-03-01',
      });

      const result = await executor.executeAction(USER_ID, 'get_contact', {
        contact_identifier: 'contact-2',
        identifier_type: 'id',
      });

      expectSuccessResult(result);
      expect(result.data.data.contact_id).toBe('contact-2');
    });

    it('should handle contact not found', async () => {
      mockFetchSuccess({ results: [] });

      const result = await executor.executeAction(USER_ID, 'get_contact', {
        contact_identifier: 'nobody@example.com',
        identifier_type: 'email',
      });

      // Returns success=false from executor, but wrapped in executeAction success
      expectSuccessResult(result);
      expect(result.data.success).toBe(false);
    });
  });

  // ---- get_contact_deals ----
  describe('get_contact_deals', () => {
    it('should fetch deal associations and details', async () => {
      mockFetchSequence([
        // Associations
        { body: { results: [{ toObjectId: 'deal-1' }] } },
        // Deal batch read
        {
          body: {
            results: [{
              id: 'deal-1',
              properties: { dealname: 'Big Deal', amount: '50000', dealstage: 'closedwon', closedate: '2026-04-01', pipeline: 'sales', hubspot_owner_id: 'owner-1', createdate: '2026-01-01' },
            }],
          },
        },
      ]);

      const result = await executor.executeAction(USER_ID, 'get_contact_deals', {
        contact_id: 'contact-1',
      });

      expectSuccessResult(result);
      expect(result.data.data.deals).toHaveLength(1);
      expect(result.data.data.deals[0].deal_name).toBe('Big Deal');
    });
  });

  // ---- get_contact_activities ----
  describe('get_contact_activities', () => {
    it('should fetch activities for a contact', async () => {
      // The executor fetches each activity type sequentially
      mockFetchSequence([
        // calls
        { body: { results: [] } },
        // emails
        { body: { results: [] } },
        // notes
        { body: { results: [{ id: 'note-1', properties: { hs_timestamp: '2026-03-01', hs_note_body: 'Test note', hubspot_owner_id: 'o1' }, createdAt: '2026-03-01', associations: { contacts: { results: [{ id: 'contact-1' }] } } }] } },
        // meetings
        { body: { results: [] } },
        // tasks
        { body: { results: [] } },
      ]);

      const result = await executor.executeAction(USER_ID, 'get_contact_activities', {
        contact_id: 'contact-1',
        activity_types: ['calls', 'emails', 'notes', 'meetings', 'tasks'],
      });

      expectSuccessResult(result);
      expect(result.data.data.total_count).toBe(1);
    });
  });

  // ---- search_contacts ----
  describe('search_contacts', () => {
    it('should search contacts by query', async () => {
      mockFetchSuccess({
        results: [
          { id: 'c1', properties: { firstname: 'Alice' }, createdAt: '2026-01-01', updatedAt: '2026-03-01' },
          { id: 'c2', properties: { firstname: 'Bob' }, createdAt: '2026-01-01', updatedAt: '2026-03-01' },
        ],
        paging: null,
      });

      const result = await executor.executeAction(USER_ID, 'search_contacts', {
        query: 'Alice',
      });

      expectSuccessResult(result);
      expect(result.data.data.contacts).toHaveLength(2);
      expectFetchCalledWith('api.hubapi.com/crm/v3/objects/contacts/search', 'POST');
    });
  });

  // ---- get_deal ----
  describe('get_deal', () => {
    it('should fetch deal by ID', async () => {
      mockFetchSuccess({
        id: 'deal-100',
        properties: { dealname: 'My Deal', amount: '10000', dealstage: 'appointment' },
        createdAt: '2026-01-01',
        updatedAt: '2026-03-01',
      });

      const result = await executor.executeAction(USER_ID, 'get_deal', {
        deal_id: 'deal-100',
      });

      expectSuccessResult(result);
      expect(result.data.data.deal_id).toBe('deal-100');
    });

    it('should handle 404 error', async () => {
      mockFetchError(404, JSON.stringify({ message: 'resource not found', category: 'OBJECT_NOT_FOUND' }));

      const result = await executor.executeAction(USER_ID, 'get_deal', {
        deal_id: 'nonexistent',
      });

      expectErrorResult(result);
    });
  });

  // ---- Unimplemented actions ----
  // These 4 actions are defined in the JSON schema but not implemented in the
  // executor's switch statement. They hit the default branch which returns
  // { success: false, error: 'Unknown action' }. The base class wraps this as
  // success: true with data containing the inner error — so the outer result
  // is "successful" but data.success is false. This is expected behavior for
  // actions that are schema-defined but not yet coded.
  describe('unimplemented actions (schema-defined, not yet coded)', () => {
    it.each([
      ['create_contact', { email: 'new@example.com', firstname: 'New', lastname: 'User' }],
      ['create_task', { subject: 'Follow up', body: 'Call client' }],
      ['create_deal', { dealname: 'New Deal', amount: 5000 }],
      ['create_contact_note', { contact_id: 'c1', note_body: 'Test note' }],
    ])('%s should return unsupported action result', async (actionName, params) => {
      mockFetchSuccess({});

      const result = await executor.executeAction(USER_ID, actionName, params);

      // Outer wrapper is success (base class didn't throw), inner data.success is false
      expectSuccessResult(result);
      expect(result.data.success).toBe(false);
    });
  });
});
