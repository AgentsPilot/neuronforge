/**
 * Unit tests for LinkedInPluginExecutor — 8 actions
 */

import { LinkedInPluginExecutor } from '@/lib/server/linkedin-plugin-executor';
import { createTestExecutor, expectSuccessResult, expectErrorResult, expectFetchCalledWith, expectAllFetchCallsAuthorized } from '../common/test-helpers';
import { mockFetchSuccess, mockFetchError, mockFetchSequence, restoreFetch, getAllFetchCalls } from '../common/mock-fetch';

const PLUGIN_KEY = 'linkedin';
const USER_ID = 'test-user-id';

describe('LinkedInPluginExecutor', () => {
  let executor: any;

  beforeAll(async () => {
    const ctx = await createTestExecutor(LinkedInPluginExecutor, PLUGIN_KEY, {
      profile_data: { sub: 'linkedin-sub-123' },
    });
    executor = ctx.executor;
  });

  afterEach(() => {
    restoreFetch();
  });

  // ---- get_profile ----
  describe('get_profile', () => {
    it('should fetch user profile from /v2/me', async () => {
      mockFetchSuccess({
        id: 'prof-1',
        localizedFirstName: 'Alice',
        localizedLastName: 'Smith',
        vanityName: 'alicesmith',
      });

      const result = await executor.executeAction(USER_ID, 'get_profile', {});

      expectSuccessResult(result);
      expect(result.data.first_name).toBe('Alice');
      expect(result.data.last_name).toBe('Smith');
      expectFetchCalledWith('api.linkedin.com/v2/me');
      expectAllFetchCallsAuthorized();
    });
  });

  // ---- get_user_info ----
  describe('get_user_info', () => {
    it('should fetch OpenID Connect userinfo', async () => {
      mockFetchSuccess({
        sub: 'sub-123',
        name: 'Alice Smith',
        given_name: 'Alice',
        family_name: 'Smith',
        email: 'alice@linkedin.com',
        email_verified: true,
      });

      const result = await executor.executeAction(USER_ID, 'get_user_info', {});

      expectSuccessResult(result);
      expect(result.data.email).toBe('alice@linkedin.com');
      expectFetchCalledWith('api.linkedin.com/v2/userinfo');
    });
  });

  // ---- create_post ----
  describe('create_post', () => {
    it('should create a post after fetching person URN', async () => {
      // Mock the headers.get('x-restli-id') by making response.headers work
      mockFetchSequence([
        // Profile fetch for person URN
        { body: { sub: 'person-123' } },
        // Post creation — the executor reads response.headers.get('x-restli-id')
        // Our mock returns 200 with empty body; post_id will be null since headers are not fully mocked
        { body: {} },
      ]);

      const result = await executor.executeAction(USER_ID, 'create_post', {
        text: 'Hello LinkedIn!',
        visibility: 'PUBLIC',
      });

      expectSuccessResult(result);
      expect(result.data.text).toBe('Hello LinkedIn!');
      expect(getAllFetchCalls()).toHaveLength(2);
    });
  });

  // ---- get_posts ----
  describe('get_posts', () => {
    it('should fetch user posts', async () => {
      mockFetchSequence([
        // Profile fetch for person URN
        { body: { sub: 'person-123' } },
        // Posts fetch
        {
          body: {
            elements: [
              {
                id: 'post-1',
                specificContent: { 'com.linkedin.ugc.ShareContent': { shareCommentary: { text: 'My post' } } },
                created: { time: 1711584000000 },
                lastModified: { time: 1711584000000 },
                visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
              },
            ],
            paging: { total: 1 },
          },
        },
      ]);

      const result = await executor.executeAction(USER_ID, 'get_posts', {
        count: 10,
      });

      expectSuccessResult(result);
      expect(result.data.posts).toHaveLength(1);
      expect(result.data.posts[0].text).toBe('My post');
    });
  });

  // ---- get_organization ----
  describe('get_organization', () => {
    it('should fetch organization details', async () => {
      mockFetchSuccess({
        id: 'org-1',
        localizedName: 'Acme Corp',
        vanityName: 'acme',
        staffCount: 500,
      });

      const result = await executor.executeAction(USER_ID, 'get_organization', {
        organization_id: 'org-1',
      });

      expectSuccessResult(result);
      expect(result.data.name).toBe('Acme Corp');
      expect(result.data.employee_count).toBe(500);
      expectFetchCalledWith('api.linkedin.com/rest/organizations/org-1');
    });
  });

  // ---- search_organizations ----
  describe('search_organizations', () => {
    it('should search organizations by keywords', async () => {
      mockFetchSuccess({
        elements: [
          { id: 'org-2', name: 'Tech Inc', vanityName: 'techinc', staffCount: 100 },
        ],
        paging: { total: 1 },
      });

      const result = await executor.executeAction(USER_ID, 'search_organizations', {
        keywords: 'Tech',
      });

      expectSuccessResult(result);
      expect(result.data.organizations).toHaveLength(1);
    });

    it('should handle 403 for partner program restriction', async () => {
      mockFetchError(403, 'Forbidden');

      const result = await executor.executeAction(USER_ID, 'search_organizations', {
        keywords: 'Test',
      });

      expectErrorResult(result);
    });
  });

  // ---- get_organization_posts ----
  describe('get_organization_posts', () => {
    it('should fetch organization posts', async () => {
      mockFetchSuccess({
        elements: [
          {
            id: 'orgpost-1',
            specificContent: { 'com.linkedin.ugc.ShareContent': { shareCommentary: { text: 'Org post' } } },
            created: { time: 1711584000000 },
            author: 'urn:li:organization:org-1',
          },
        ],
        paging: { total: 1 },
      });

      const result = await executor.executeAction(USER_ID, 'get_organization_posts', {
        organization_id: 'org-1',
      });

      expectSuccessResult(result);
      expect(result.data.posts).toHaveLength(1);
    });
  });

  // ---- get_connections ----
  describe('get_connections', () => {
    it('should fetch connections', async () => {
      mockFetchSuccess({
        elements: ['urn:li:person:p1', 'urn:li:person:p2'],
        paging: { total: 2 },
      });

      const result = await executor.executeAction(USER_ID, 'get_connections', {
        count: 50,
      });

      expectSuccessResult(result);
      expect(result.data.connections).toHaveLength(2);
    });

    it('should handle 403 for partner program restriction', async () => {
      mockFetchError(403, 'Forbidden');

      const result = await executor.executeAction(USER_ID, 'get_connections', {});

      expectErrorResult(result);
    });
  });
});
