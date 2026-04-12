/**
 * Unit tests for MetaAdsPluginExecutor -- 16 actions
 *
 * Actions: get_campaigns, get_campaign_insights, get_adsets, get_adset_insights,
 *          get_ads, get_ad_insights, create_campaign, update_campaign,
 *          get_ad_account, create_adset, update_adset, create_ad,
 *          upload_image, create_ad_creative, create_custom_audience, get_audiences
 */

import { MetaAdsPluginExecutor } from '@/lib/server/meta-ads-plugin-executor';
import {
  createTestExecutor,
  expectSuccessResult,
  expectErrorResult,
  expectFetchCalledWith,
} from '../common/test-helpers';
import {
  mockFetchSuccess,
  mockFetchError,
  mockFetchSequence,
  restoreFetch,
  getAllFetchCalls,
} from '../common/mock-fetch';
import { runStandardErrorScenarios } from '../common/error-scenarios';

const PLUGIN_KEY = 'meta-ads';
const USER_ID = 'test-user-id';

describe('MetaAdsPluginExecutor', () => {
  let executor: any;

  beforeAll(async () => {
    const ctx = await createTestExecutor(MetaAdsPluginExecutor, PLUGIN_KEY);
    executor = ctx.executor;
  });

  afterEach(() => {
    restoreFetch();
  });

  describe('[smoke]', () => {
    describe('get_campaigns', () => {
      it('should list campaigns for an ad account', async () => {
        mockFetchSuccess({
          data: [
            {
              id: 'camp-1',
              name: 'Summer Sale',
              status: 'ACTIVE',
              objective: 'CONVERSIONS',
              daily_budget: '5000',
              lifetime_budget: null,
              created_time: '2026-03-01T00:00:00Z',
            },
          ],
        });

        const result = await executor.executeAction(USER_ID, 'get_campaigns', {
          ad_account_id: 'act_123',
        });

        expectSuccessResult(result);
        expect(result.data.campaigns).toHaveLength(1);
        expect(result.data.campaigns[0].name).toBe('Summer Sale');
        expect(result.data.campaigns[0].daily_budget).toBe(5000);
        expect(result.data.campaign_count).toBe(1);
        expectFetchCalledWith('graph.facebook.com');
      });
    });

    describe('get_campaign_insights', () => {
      it('should return campaign performance metrics', async () => {
        mockFetchSequence([
          // insights response
          {
            body: {
              data: [
                {
                  date_start: '2026-04-05',
                  date_stop: '2026-04-11',
                  spend: '150.50',
                  impressions: '10000',
                  clicks: '250',
                  ctr: '2.5',
                  cpc: '0.60',
                  cpm: '15.05',
                  reach: '8000',
                  frequency: '1.25',
                },
              ],
            },
          },
          // campaign name response
          { body: { name: 'Summer Sale' } },
        ]);

        const result = await executor.executeAction(USER_ID, 'get_campaign_insights', {
          campaign_id: 'camp-1',
        });

        expectSuccessResult(result);
        expect(result.data.campaign_name).toBe('Summer Sale');
        expect(result.data.spend).toBe(150.5);
        expect(result.data.impressions).toBe(10000);
        expect(result.data.clicks).toBe(250);
        expect(getAllFetchCalls()).toHaveLength(2);
      });
    });

    describe('get_adsets', () => {
      it('should return ad sets for a campaign', async () => {
        mockFetchSuccess({
          data: [
            {
              id: 'adset-1',
              name: 'Young Adults',
              status: 'ACTIVE',
              campaign_id: 'camp-1',
              daily_budget: '2000',
              optimization_goal: 'CONVERSIONS',
              billing_event: 'IMPRESSIONS',
            },
          ],
        });

        const result = await executor.executeAction(USER_ID, 'get_adsets', {
          campaign_id: 'camp-1',
        });

        expectSuccessResult(result);
        expect(result.data.adsets).toHaveLength(1);
        expect(result.data.adsets[0].name).toBe('Young Adults');
        expect(result.data.adset_count).toBe(1);
      });
    });

    describe('get_ads', () => {
      it('should return ads for an ad set', async () => {
        mockFetchSuccess({
          data: [
            {
              id: 'ad-1',
              name: 'Banner Ad',
              status: 'ACTIVE',
              adset_id: 'adset-1',
              campaign_id: 'camp-1',
              creative: { id: 'creative-1', name: 'Summer Banner' },
            },
          ],
        });

        const result = await executor.executeAction(USER_ID, 'get_ads', {
          adset_id: 'adset-1',
        });

        expectSuccessResult(result);
        expect(result.data.ads).toHaveLength(1);
        expect(result.data.ads[0].name).toBe('Banner Ad');
        expect(result.data.ad_count).toBe(1);
      });
    });

    describe('create_campaign', () => {
      it('should create a campaign and fetch details', async () => {
        mockFetchSequence([
          // create response
          { body: { id: 'camp-new' } },
          // get details
          {
            body: {
              id: 'camp-new',
              name: 'Winter Sale',
              objective: 'BRAND_AWARENESS',
              status: 'PAUSED',
              created_time: '2026-04-12T00:00:00Z',
            },
          },
        ]);

        const result = await executor.executeAction(USER_ID, 'create_campaign', {
          ad_account_id: 'act_123',
          name: 'Winter Sale',
          objective: 'BRAND_AWARENESS',
        });

        expectSuccessResult(result);
        expect(result.data.id).toBe('camp-new');
        expect(result.data.name).toBe('Winter Sale');
        expect(getAllFetchCalls()).toHaveLength(2);
      });
    });

    describe('update_campaign', () => {
      it('should update a campaign', async () => {
        mockFetchSuccess({ success: true });

        const result = await executor.executeAction(USER_ID, 'update_campaign', {
          campaign_id: 'camp-1',
          status: 'PAUSED',
        });

        expectSuccessResult(result);
        expect(result.data.id).toBe('camp-1');
        expect(result.data.success).toBe(true);
      });
    });

    describe('get_ad_account', () => {
      it('should return ad account info', async () => {
        mockFetchSuccess({
          id: 'act_123',
          name: 'My Ad Account',
          account_status: 1,
          currency: 'USD',
          timezone_name: 'US/Eastern',
          amount_spent: '5000.00',
          balance: '1000.00',
          spend_cap: '10000.00',
        });

        const result = await executor.executeAction(USER_ID, 'get_ad_account', {
          ad_account_id: 'act_123',
        });

        expectSuccessResult(result);
        expect(result.data.id).toBe('act_123');
        expect(result.data.currency).toBe('USD');
        expect(result.data.amount_spent).toBe(5000);
      });
    });

    describe('get_audiences', () => {
      it('should list custom audiences', async () => {
        mockFetchSuccess({
          data: [
            {
              id: 'aud-1',
              name: 'Website Visitors',
              subtype: 'WEBSITE',
              approximate_count: 5000,
              delivery_status: { status: 'ready' },
            },
          ],
        });

        const result = await executor.executeAction(USER_ID, 'get_audiences', {
          ad_account_id: 'act_123',
        });

        expectSuccessResult(result);
        expect(result.data.audiences).toHaveLength(1);
        expect(result.data.audiences[0].name).toBe('Website Visitors');
        expect(result.data.audience_count).toBe(1);
      });
    });

    describe('get_adset_insights', () => {
      it('should return adset performance metrics', async () => {
        mockFetchSequence([
          {
            body: {
              data: [
                {
                  date_start: '2026-04-05',
                  date_stop: '2026-04-11',
                  spend: '75.00',
                  impressions: '5000',
                  clicks: '125',
                  ctr: '2.5',
                  cpc: '0.60',
                  cpm: '15.00',
                  reach: '4000',
                },
              ],
            },
          },
          { body: { name: 'Young Adults' } },
        ]);

        const result = await executor.executeAction(USER_ID, 'get_adset_insights', {
          adset_id: 'adset-1',
        });

        expectSuccessResult(result);
        expect(result.data.adset_name).toBe('Young Adults');
        expect(result.data.spend).toBe(75);
      });
    });

    describe('get_ad_insights', () => {
      it('should return ad performance metrics', async () => {
        mockFetchSequence([
          {
            body: {
              data: [
                {
                  date_start: '2026-04-05',
                  date_stop: '2026-04-11',
                  spend: '25.00',
                  impressions: '2000',
                  clicks: '50',
                  ctr: '2.5',
                  cpc: '0.50',
                  cpm: '12.50',
                },
              ],
            },
          },
          { body: { name: 'Banner Ad' } },
        ]);

        const result = await executor.executeAction(USER_ID, 'get_ad_insights', {
          ad_id: 'ad-1',
        });

        expectSuccessResult(result);
        expect(result.data.ad_name).toBe('Banner Ad');
        expect(result.data.spend).toBe(25);
      });
    });

    describe('upload_image', () => {
      it('should upload an image and return hash', async () => {
        mockFetchSuccess({
          images: {
            'my-image': {
              hash: 'abcdef123456',
              url: 'https://scontent.facebook.com/image.jpg',
              width: 800,
              height: 600,
            },
          },
        });

        const result = await executor.executeAction(USER_ID, 'upload_image', {
          ad_account_id: 'act_123',
          image_data: 'base64encodeddata',
          filename: 'banner.jpg',
        });

        expectSuccessResult(result);
        expect(result.data.hash).toBe('abcdef123456');
      });
    });

    describe('create_adset', () => {
      it('should create an ad set and fetch details', async () => {
        mockFetchSequence([
          { body: { id: 'adset-new' } },
          {
            body: {
              id: 'adset-new',
              name: 'New AdSet',
              campaign_id: 'camp-1',
              status: 'PAUSED',
              created_time: '2026-04-12T00:00:00Z',
            },
          },
        ]);

        const result = await executor.executeAction(USER_ID, 'create_adset', {
          campaign_id: 'camp-1',
          name: 'New AdSet',
          optimization_goal: 'CONVERSIONS',
          billing_event: 'IMPRESSIONS',
          bid_amount: 500,
          targeting: { geo_locations: { countries: ['US'] } },
        });

        expectSuccessResult(result);
        expect(result.data.id).toBe('adset-new');
      });
    });

    describe('update_adset', () => {
      it('should update an ad set', async () => {
        mockFetchSuccess({ success: true });

        const result = await executor.executeAction(USER_ID, 'update_adset', {
          adset_id: 'adset-1',
          status: 'PAUSED',
        });

        expectSuccessResult(result);
        expect(result.data.id).toBe('adset-1');
        expect(result.data.success).toBe(true);
      });
    });

    describe('create_ad', () => {
      it('should create an ad and fetch details', async () => {
        mockFetchSequence([
          { body: { id: 'ad-new' } },
          {
            body: {
              id: 'ad-new',
              name: 'New Ad',
              adset_id: 'adset-1',
              status: 'PAUSED',
              created_time: '2026-04-12T00:00:00Z',
            },
          },
        ]);

        const result = await executor.executeAction(USER_ID, 'create_ad', {
          adset_id: 'adset-1',
          name: 'New Ad',
          creative_id: 'creative-1',
        });

        expectSuccessResult(result);
        expect(result.data.id).toBe('ad-new');
        expect(result.data.name).toBe('New Ad');
      });
    });

    describe('create_ad_creative', () => {
      it('should create a creative and fetch details', async () => {
        mockFetchSequence([
          { body: { id: 'creative-new' } },
          {
            body: {
              id: 'creative-new',
              name: 'Banner Creative',
              object_story_spec: { page_id: 'page-123' },
            },
          },
        ]);

        const result = await executor.executeAction(USER_ID, 'create_ad_creative', {
          ad_account_id: 'act_123',
          name: 'Banner Creative',
          object_story_spec: { page_id: 'page-123' },
        });

        expectSuccessResult(result);
        expect(result.data.id).toBe('creative-new');
      });
    });

    describe('create_custom_audience', () => {
      it('should create a custom audience and fetch details', async () => {
        mockFetchSequence([
          { body: { id: 'aud-new' } },
          {
            body: {
              id: 'aud-new',
              name: 'Email List',
              subtype: 'CUSTOM',
              approximate_count: 0,
              time_created: '2026-04-12T00:00:00Z',
            },
          },
        ]);

        const result = await executor.executeAction(USER_ID, 'create_custom_audience', {
          ad_account_id: 'act_123',
          name: 'Email List',
          subtype: 'CUSTOM',
          customer_file_source: 'USER_PROVIDED_ONLY',
        });

        expectSuccessResult(result);
        expect(result.data.id).toBe('aud-new');
        expect(result.data.name).toBe('Email List');
      });
    });
  });

  describe('[full]', () => {
    describe('get_campaigns', () => {
      it('should handle API error', async () => {
        mockFetchSuccess({
          error: { message: 'Invalid OAuth 2.0 Access Token', type: 'OAuthException', code: 190 },
        }, 400);

        const result = await executor.executeAction(USER_ID, 'get_campaigns', {
          ad_account_id: 'act_invalid',
        });

        expectErrorResult(result);
      });
    });

    describe('get_ads', () => {
      it('should require at least one scope parameter', async () => {
        // No ad_account_id, adset_id, or campaign_id provided
        // The executor throws directly
        mockFetchSuccess({ data: [] });

        const result = await executor.executeAction(USER_ID, 'get_ads', {});

        expectErrorResult(result);
      });
    });

    describe('get_adsets', () => {
      it('should require ad_account_id or campaign_id', async () => {
        mockFetchSuccess({ data: [] });

        const result = await executor.executeAction(USER_ID, 'get_adsets', {});

        expectErrorResult(result);
      });
    });

    describe('create_campaign', () => {
      it('should handle 400 error from API', async () => {
        mockFetchSuccess({
          error: { message: 'Invalid parameter', type: 'OAuthException', code: 100 },
        }, 400);

        const result = await executor.executeAction(USER_ID, 'create_campaign', {
          ad_account_id: 'act_123',
          name: 'Bad Campaign',
          objective: 'INVALID',
        });

        expectErrorResult(result);
      });
    });

    describe('get_campaign_insights', () => {
      it('should handle empty insights data', async () => {
        mockFetchSequence([
          { body: { data: [] } },
          { body: { name: 'Empty Campaign' } },
        ]);

        const result = await executor.executeAction(USER_ID, 'get_campaign_insights', {
          campaign_id: 'camp-empty',
        });

        expectSuccessResult(result);
        expect(result.data.spend).toBe(0);
        expect(result.data.impressions).toBe(0);
      });
    });

    // ---- P3-T2: Standard error scenarios ----
    runStandardErrorScenarios(
      () => executor,
      MetaAdsPluginExecutor,
      PLUGIN_KEY,
      'get_campaigns',
      { ad_account_id: 'act_123' }
    );

    // ---- P3-T3: Malformed response tests ----
    describe('malformed responses', () => {
      it('handles response missing data field', async () => {
        mockFetchSuccess({});
        const result = await executor.executeAction(USER_ID, 'get_campaigns', {
          ad_account_id: 'act_123',
        });
        expect(result).toBeDefined();
      });

      it('handles null response body', async () => {
        mockFetchSuccess(null);
        const result = await executor.executeAction(USER_ID, 'get_campaigns', {
          ad_account_id: 'act_123',
        });
        expect(result).toBeDefined();
      });
    });

    // ---- P3-T4: Authentication edge cases ----
    describe('authentication edge cases', () => {
      it('handles empty access_token', async () => {
        const ctx = await createTestExecutor(MetaAdsPluginExecutor, PLUGIN_KEY, {
          access_token: '',
        });
        mockFetchError(401, { error: { message: 'Invalid OAuth 2.0 Access Token', code: 190 } });
        const result = await ctx.executor.executeAction(USER_ID, 'get_campaigns', {
          ad_account_id: 'act_123',
        });
        expectErrorResult(result);
      });
    });
  });
});
