/**
 * Unit tests for SalesforcePluginExecutor -- 9 actions
 *
 * Actions: create_lead, query_leads, update_lead, create_account,
 *          query_accounts, create_contact, query_contacts,
 *          create_opportunity, query_opportunities
 */

import { SalesforcePluginExecutor } from '@/lib/server/salesforce-plugin-executor';
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
  restoreFetch,
} from '../common/mock-fetch';
import { runStandardErrorScenarios } from '../common/error-scenarios';

const PLUGIN_KEY = 'salesforce';
const USER_ID = 'test-user-id';

describe('SalesforcePluginExecutor', () => {
  let executor: any;

  beforeAll(async () => {
    const ctx = await createTestExecutor(SalesforcePluginExecutor, PLUGIN_KEY);
    executor = ctx.executor;
  });

  afterEach(() => {
    restoreFetch();
  });

  describe('[smoke]', () => {
    describe('create_lead', () => {
      it('should create a lead via Salesforce REST API', async () => {
        mockFetchSuccess({ id: '00Q1234567890', success: true });

        const result = await executor.executeAction(USER_ID, 'create_lead', {
          last_name: 'Doe',
          company: 'Acme Corp',
          email: 'john@acme.com',
        });

        expectSuccessResult(result);
        expect(result.data.id).toBe('00Q1234567890');
        expect(result.data.last_name).toBe('Doe');
        expect(result.data.company).toBe('Acme Corp');
        expectFetchCalledWith('/services/data/v59.0/sobjects/Lead', 'POST');
        expectAllFetchCallsAuthorized();
      });
    });

    describe('query_leads', () => {
      it('should query leads with filter parameters', async () => {
        mockFetchSuccess({
          records: [
            {
              Id: '00Q111',
              FirstName: 'John',
              LastName: 'Doe',
              Email: 'john@acme.com',
              Company: 'Acme Corp',
              Phone: '555-1234',
              Status: 'Open - Not Contacted',
              CreatedDate: '2026-04-01T00:00:00Z',
            },
          ],
        });

        const result = await executor.executeAction(USER_ID, 'query_leads', {
          company: 'Acme',
        });

        expectSuccessResult(result);
        expect(result.data.leads).toHaveLength(1);
        expect(result.data.leads[0].last_name).toBe('Doe');
        expect(result.data.lead_count).toBe(1);
        expectFetchCalledWith('/services/data/v59.0/query', 'GET');
      });
    });

    describe('update_lead', () => {
      it('should update a lead and return 204', async () => {
        // Salesforce PATCH returns 204 No Content on success
        mockFetchSuccess({}, 204);

        const result = await executor.executeAction(USER_ID, 'update_lead', {
          lead_id: '00Q111',
          status: 'Contacted',
        });

        expectSuccessResult(result);
        expect(result.data.id).toBe('00Q111');
        expect(result.data.success).toBe(true);
        expectFetchCalledWith('/services/data/v59.0/sobjects/Lead/00Q111', 'PATCH');
      });
    });

    describe('create_account', () => {
      it('should create an account', async () => {
        mockFetchSuccess({ id: '001ABC123', success: true });

        const result = await executor.executeAction(USER_ID, 'create_account', {
          name: 'Acme Corporation',
          industry: 'Technology',
          website: 'https://acme.com',
        });

        expectSuccessResult(result);
        expect(result.data.id).toBe('001ABC123');
        expect(result.data.name).toBe('Acme Corporation');
        expectFetchCalledWith('/services/data/v59.0/sobjects/Account', 'POST');
      });
    });

    describe('query_accounts', () => {
      it('should query accounts', async () => {
        mockFetchSuccess({
          records: [
            {
              Id: '001ABC',
              Name: 'Acme Corp',
              Phone: '555-0000',
              Website: 'https://acme.com',
              Industry: 'Technology',
              Type: 'Customer',
            },
          ],
        });

        const result = await executor.executeAction(USER_ID, 'query_accounts', {
          industry: 'Technology',
        });

        expectSuccessResult(result);
        expect(result.data.accounts).toHaveLength(1);
        expect(result.data.accounts[0].name).toBe('Acme Corp');
        expect(result.data.account_count).toBe(1);
      });
    });

    describe('create_contact', () => {
      it('should create a contact', async () => {
        mockFetchSuccess({ id: '003XYZ789', success: true });

        const result = await executor.executeAction(USER_ID, 'create_contact', {
          last_name: 'Smith',
          email: 'jane@acme.com',
          account_id: '001ABC123',
        });

        expectSuccessResult(result);
        expect(result.data.id).toBe('003XYZ789');
        expect(result.data.last_name).toBe('Smith');
        expectFetchCalledWith('/services/data/v59.0/sobjects/Contact', 'POST');
      });
    });

    describe('query_contacts', () => {
      it('should query contacts by email', async () => {
        mockFetchSuccess({
          records: [
            {
              Id: '003XYZ',
              FirstName: 'Jane',
              LastName: 'Smith',
              Email: 'jane@acme.com',
              Phone: '555-9999',
              AccountId: '001ABC',
              Title: 'VP Sales',
            },
          ],
        });

        const result = await executor.executeAction(USER_ID, 'query_contacts', {
          email: 'jane@acme.com',
        });

        expectSuccessResult(result);
        expect(result.data.contacts).toHaveLength(1);
        expect(result.data.contacts[0].email).toBe('jane@acme.com');
        expect(result.data.contact_count).toBe(1);
      });
    });

    describe('create_opportunity', () => {
      it('should create an opportunity', async () => {
        mockFetchSuccess({ id: '006OPP111', success: true });

        const result = await executor.executeAction(USER_ID, 'create_opportunity', {
          name: 'Big Deal',
          close_date: '2026-06-30',
          stage: 'Prospecting',
          amount: 50000,
        });

        expectSuccessResult(result);
        expect(result.data.id).toBe('006OPP111');
        expect(result.data.name).toBe('Big Deal');
        expect(result.data.amount).toBe(50000);
        expectFetchCalledWith('/services/data/v59.0/sobjects/Opportunity', 'POST');
      });
    });

    describe('query_opportunities', () => {
      it('should query opportunities with total amount', async () => {
        mockFetchSuccess({
          records: [
            {
              Id: '006OPP1',
              Name: 'Deal A',
              Amount: 30000,
              StageName: 'Prospecting',
              CloseDate: '2026-06-30',
              AccountId: '001ABC',
              Probability: 25,
            },
            {
              Id: '006OPP2',
              Name: 'Deal B',
              Amount: 70000,
              StageName: 'Negotiation',
              CloseDate: '2026-07-15',
              AccountId: '001ABC',
              Probability: 75,
            },
          ],
        });

        const result = await executor.executeAction(USER_ID, 'query_opportunities', {
          account_id: '001ABC',
        });

        expectSuccessResult(result);
        expect(result.data.opportunities).toHaveLength(2);
        expect(result.data.opportunity_count).toBe(2);
        expect(result.data.total_amount).toBe(100000);
      });
    });
  });

  describe('[full]', () => {
    describe('create_lead', () => {
      it('should handle 401 auth error', async () => {
        mockFetchError(401, 'Session expired or invalid');

        const result = await executor.executeAction(USER_ID, 'create_lead', {
          last_name: 'Doe',
          company: 'Acme',
        });

        expectErrorResult(result);
      });
    });

    describe('query_leads', () => {
      it('should return empty when no records match', async () => {
        mockFetchSuccess({ records: [] });

        const result = await executor.executeAction(USER_ID, 'query_leads', {
          email: 'nonexistent@example.com',
        });

        expectSuccessResult(result);
        expect(result.data.leads).toHaveLength(0);
        expect(result.data.lead_count).toBe(0);
      });
    });

    describe('update_lead', () => {
      it('should handle 404 lead not found', async () => {
        mockFetchError(404, 'entity is deleted');

        const result = await executor.executeAction(USER_ID, 'update_lead', {
          lead_id: 'nonexistent',
          status: 'Closed',
        });

        expectErrorResult(result);
      });
    });

    describe('create_account', () => {
      it('should handle 400 validation error', async () => {
        mockFetchError(400, JSON.stringify([{ message: 'Required fields are missing: [Name]' }]));

        const result = await executor.executeAction(USER_ID, 'create_account', {
          name: '',
        });

        expectErrorResult(result);
      });
    });

    describe('create_opportunity', () => {
      it('should handle 500 server error', async () => {
        mockFetchError(500, 'Internal Server Error');

        const result = await executor.executeAction(USER_ID, 'create_opportunity', {
          name: 'Bad Deal',
          close_date: '2026-06-30',
          stage: 'Prospecting',
        });

        expectErrorResult(result);
      });
    });

    describe('query_opportunities', () => {
      it('should handle empty results with zero total amount', async () => {
        mockFetchSuccess({ records: [] });

        const result = await executor.executeAction(USER_ID, 'query_opportunities', {
          stage: 'Closed Lost',
        });

        expectSuccessResult(result);
        expect(result.data.opportunities).toHaveLength(0);
        expect(result.data.total_amount).toBe(0);
      });
    });

    describe('query_contacts', () => {
      it('should handle 403 insufficient permissions', async () => {
        mockFetchError(403, 'Insufficient access rights on cross-reference id');

        const result = await executor.executeAction(USER_ID, 'query_contacts', {
          account_id: 'restricted-id',
        });

        expectErrorResult(result);
      });
    });

    // ---- P3-T2: Standard error scenarios ----
    runStandardErrorScenarios(
      () => executor,
      SalesforcePluginExecutor,
      PLUGIN_KEY,
      'query_leads',
      {}
    );

    // ---- P3-T3: Malformed response tests ----
    describe('malformed responses', () => {
      it('handles response missing records field', async () => {
        mockFetchSuccess({});
        const result = await executor.executeAction(USER_ID, 'query_leads', {});
        expect(result).toBeDefined();
      });

      it('handles null response body', async () => {
        mockFetchSuccess(null);
        const result = await executor.executeAction(USER_ID, 'query_leads', {});
        expect(result).toBeDefined();
      });
    });

    // ---- P3-T4: Authentication edge cases ----
    describe('authentication edge cases', () => {
      it('handles empty access_token', async () => {
        const ctx = await createTestExecutor(SalesforcePluginExecutor, PLUGIN_KEY, {
          access_token: '',
        });
        mockFetchError(401, 'Session expired or invalid');
        const result = await ctx.executor.executeAction(USER_ID, 'query_leads', {});
        expectErrorResult(result);
      });
    });

    // ---- P3-T5: Pagination edge cases ----
    describe('pagination edge cases', () => {
      it('handles empty query_leads results', async () => {
        mockFetchSuccess({ records: [] });
        const result = await executor.executeAction(USER_ID, 'query_leads', {
          email: 'nobody@nowhere.com',
        });
        expectSuccessResult(result);
        expect(result.data.leads).toHaveLength(0);
      });

      it('handles empty query_accounts results', async () => {
        mockFetchSuccess({ records: [] });
        const result = await executor.executeAction(USER_ID, 'query_accounts', {
          name: 'NonExistent Corp',
        });
        expectSuccessResult(result);
        expect(result.data.accounts).toHaveLength(0);
      });
    });
  });
});
