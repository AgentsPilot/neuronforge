import { BasePluginExecutor } from './base-plugin-executor';
import { UserPluginConnections } from './user-plugin-connections';
import { PluginManagerV2 } from './plugin-manager-v2';
import pino from 'pino';

const pluginName = 'meta-ads';
const API_VERSION = 'v19.0';
const BASE_URL = `https://graph.facebook.com/${API_VERSION}`;

export class MetaAdsPluginExecutor extends BasePluginExecutor {
  protected logger = pino({ name: `${pluginName}-plugin-executor` });

  constructor(userConnections: UserPluginConnections, pluginManager: PluginManagerV2) {
    super(pluginName, userConnections, pluginManager);
  }

  protected async executeSpecificAction(connection: any, actionName: string, parameters: any): Promise<any> {
    this.logger.debug({ actionName, params: parameters }, 'Executing Meta Ads action');

    switch (actionName) {
      // Tier 1: Insights & Read
      case 'get_campaigns':
        return this.getCampaigns(connection, parameters);
      case 'get_campaign_insights':
        return this.getCampaignInsights(connection, parameters);
      case 'get_adsets':
        return this.getAdSets(connection, parameters);
      case 'get_adset_insights':
        return this.getAdSetInsights(connection, parameters);
      case 'get_ads':
        return this.getAds(connection, parameters);
      case 'get_ad_insights':
        return this.getAdInsights(connection, parameters);

      // Tier 2: Campaign Management
      case 'create_campaign':
        return this.createCampaign(connection, parameters);
      case 'update_campaign':
        return this.updateCampaign(connection, parameters);
      case 'get_ad_account':
        return this.getAdAccount(connection, parameters);

      // Tier 3: Ad Set Operations
      case 'create_adset':
        return this.createAdSet(connection, parameters);
      case 'update_adset':
        return this.updateAdSet(connection, parameters);

      // Tier 4: Creative & Ads
      case 'create_ad':
        return this.createAd(connection, parameters);
      case 'upload_image':
        return this.uploadImage(connection, parameters);
      case 'create_ad_creative':
        return this.createAdCreative(connection, parameters);

      // Tier 5: Audience Management
      case 'create_custom_audience':
        return this.createCustomAudience(connection, parameters);
      case 'get_audiences':
        return this.getAudiences(connection, parameters);

      default:
        throw new Error(`Unknown action: ${actionName}`);
    }
  }

  // ======================
  // Tier 1: Insights & Read
  // ======================

  private async getCampaigns(connection: any, params: any): Promise<any> {
    const { ad_account_id, status, effective_status, limit = 100 } = params;

    const fields = ['id', 'name', 'status', 'objective', 'daily_budget', 'lifetime_budget', 'created_time'];
    let url = `${ad_account_id}/campaigns?fields=${fields.join(',')}`;

    if (status) url += `&filtering=[{"field":"status","operator":"EQUAL","value":"${status}"}]`;
    if (effective_status) url += `&effective_status=${effective_status}`;
    url += `&limit=${limit}`;

    const response = await this.makeMetaRequest(connection, url, 'GET');

    return {
      campaigns: response.data.map((campaign: any) => ({
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        objective: campaign.objective,
        daily_budget: campaign.daily_budget ? parseInt(campaign.daily_budget) : null,
        lifetime_budget: campaign.lifetime_budget ? parseInt(campaign.lifetime_budget) : null,
        created_time: campaign.created_time,
      })),
      campaign_count: response.data.length,
      retrieved_at: new Date().toISOString(),
    };
  }

  private async getCampaignInsights(connection: any, params: any): Promise<any> {
    const {
      campaign_id,
      date_preset = 'last_7d',
      time_range_start,
      time_range_end,
      fields = ['spend', 'impressions', 'clicks', 'ctr', 'cpc', 'cpm', 'reach', 'frequency'],
    } = params;

    let url = `${campaign_id}/insights?fields=${fields.join(',')}`;

    if (time_range_start && time_range_end) {
      url += `&time_range={"since":"${time_range_start}","until":"${time_range_end}"}`;
    } else {
      url += `&date_preset=${date_preset}`;
    }

    const response = await this.makeMetaRequest(connection, url, 'GET');
    const insights = response.data[0] || {};

    // Get campaign name
    const campaignResponse = await this.makeMetaRequest(connection, `${campaign_id}?fields=name`, 'GET');

    return {
      campaign_id,
      campaign_name: campaignResponse.name,
      date_start: insights.date_start,
      date_end: insights.date_stop,
      spend: parseFloat(insights.spend || 0),
      impressions: parseInt(insights.impressions || 0),
      clicks: parseInt(insights.clicks || 0),
      ctr: parseFloat(insights.ctr || 0),
      cpc: parseFloat(insights.cpc || 0),
      cpm: parseFloat(insights.cpm || 0),
      reach: parseInt(insights.reach || 0),
      frequency: parseFloat(insights.frequency || 0),
      conversions: this.extractConversions(insights.actions),
      cost_per_conversion: this.extractCostPerConversion(insights.cost_per_action_type),
      roas: this.calculateROAS(insights.purchase_roas),
      retrieved_at: new Date().toISOString(),
    };
  }

  private async getAdSets(connection: any, params: any): Promise<any> {
    const { ad_account_id, campaign_id, status, limit = 100 } = params;

    const fields = ['id', 'name', 'status', 'campaign_id', 'daily_budget', 'lifetime_budget', 'bid_amount', 'optimization_goal', 'billing_event'];
    let url: string;

    if (campaign_id) {
      url = `${campaign_id}/adsets?fields=${fields.join(',')}`;
    } else if (ad_account_id) {
      url = `${ad_account_id}/adsets?fields=${fields.join(',')}`;
    } else {
      throw new Error('Either ad_account_id or campaign_id must be provided');
    }

    if (status) url += `&filtering=[{"field":"status","operator":"EQUAL","value":"${status}"}]`;
    url += `&limit=${limit}`;

    const response = await this.makeMetaRequest(connection, url, 'GET');

    return {
      adsets: response.data.map((adset: any) => ({
        id: adset.id,
        name: adset.name,
        status: adset.status,
        campaign_id: adset.campaign_id,
        daily_budget: adset.daily_budget ? parseInt(adset.daily_budget) : null,
        lifetime_budget: adset.lifetime_budget ? parseInt(adset.lifetime_budget) : null,
        bid_amount: adset.bid_amount ? parseInt(adset.bid_amount) : null,
        optimization_goal: adset.optimization_goal,
        billing_event: adset.billing_event,
      })),
      adset_count: response.data.length,
      retrieved_at: new Date().toISOString(),
    };
  }

  private async getAdSetInsights(connection: any, params: any): Promise<any> {
    const { adset_id, date_preset = 'last_7d', time_range_start, time_range_end } = params;

    const fields = ['spend', 'impressions', 'clicks', 'ctr', 'cpc', 'cpm', 'reach'];
    let url = `${adset_id}/insights?fields=${fields.join(',')}`;

    if (time_range_start && time_range_end) {
      url += `&time_range={"since":"${time_range_start}","until":"${time_range_end}"}`;
    } else {
      url += `&date_preset=${date_preset}`;
    }

    const response = await this.makeMetaRequest(connection, url, 'GET');
    const insights = response.data[0] || {};

    // Get adset name
    const adsetResponse = await this.makeMetaRequest(connection, `${adset_id}?fields=name`, 'GET');

    return {
      adset_id,
      adset_name: adsetResponse.name,
      date_start: insights.date_start,
      date_end: insights.date_stop,
      spend: parseFloat(insights.spend || 0),
      impressions: parseInt(insights.impressions || 0),
      clicks: parseInt(insights.clicks || 0),
      ctr: parseFloat(insights.ctr || 0),
      cpc: parseFloat(insights.cpc || 0),
      cpm: parseFloat(insights.cpm || 0),
      reach: parseInt(insights.reach || 0),
      conversions: this.extractConversions(insights.actions),
      cost_per_conversion: this.extractCostPerConversion(insights.cost_per_action_type),
      retrieved_at: new Date().toISOString(),
    };
  }

  private async getAds(connection: any, params: any): Promise<any> {
    const { ad_account_id, adset_id, campaign_id, status, limit = 100 } = params;

    const fields = ['id', 'name', 'status', 'adset_id', 'campaign_id', 'creative'];
    let url: string;

    if (adset_id) {
      url = `${adset_id}/ads?fields=${fields.join(',')}`;
    } else if (campaign_id) {
      url = `${campaign_id}/ads?fields=${fields.join(',')}`;
    } else if (ad_account_id) {
      url = `${ad_account_id}/ads?fields=${fields.join(',')}`;
    } else {
      throw new Error('At least one of ad_account_id, adset_id, or campaign_id must be provided');
    }

    if (status) url += `&filtering=[{"field":"status","operator":"EQUAL","value":"${status}"}]`;
    url += `&limit=${limit}`;

    const response = await this.makeMetaRequest(connection, url, 'GET');

    return {
      ads: response.data.map((ad: any) => ({
        id: ad.id,
        name: ad.name,
        status: ad.status,
        adset_id: ad.adset_id,
        campaign_id: ad.campaign_id,
        creative: ad.creative ? {
          id: ad.creative.id,
          name: ad.creative.name,
          title: ad.creative.title,
          body: ad.creative.body,
          image_url: ad.creative.image_url,
        } : null,
      })),
      ad_count: response.data.length,
      retrieved_at: new Date().toISOString(),
    };
  }

  private async getAdInsights(connection: any, params: any): Promise<any> {
    const { ad_id, date_preset = 'last_7d', time_range_start, time_range_end } = params;

    const fields = ['spend', 'impressions', 'clicks', 'ctr', 'cpc', 'cpm'];
    let url = `${ad_id}/insights?fields=${fields.join(',')}`;

    if (time_range_start && time_range_end) {
      url += `&time_range={"since":"${time_range_start}","until":"${time_range_end}"}`;
    } else {
      url += `&date_preset=${date_preset}`;
    }

    const response = await this.makeMetaRequest(connection, url, 'GET');
    const insights = response.data[0] || {};

    // Get ad name
    const adResponse = await this.makeMetaRequest(connection, `${ad_id}?fields=name`, 'GET');

    return {
      ad_id,
      ad_name: adResponse.name,
      date_start: insights.date_start,
      date_end: insights.date_stop,
      spend: parseFloat(insights.spend || 0),
      impressions: parseInt(insights.impressions || 0),
      clicks: parseInt(insights.clicks || 0),
      ctr: parseFloat(insights.ctr || 0),
      cpc: parseFloat(insights.cpc || 0),
      cpm: parseFloat(insights.cpm || 0),
      conversions: this.extractConversions(insights.actions),
      cost_per_conversion: this.extractCostPerConversion(insights.cost_per_action_type),
      retrieved_at: new Date().toISOString(),
    };
  }

  // ===========================
  // Tier 2: Campaign Management
  // ===========================

  private async createCampaign(connection: any, params: any): Promise<any> {
    const { ad_account_id, name, objective, status = 'PAUSED', special_ad_categories, daily_budget, lifetime_budget } = params;

    const payload: any = {
      name,
      objective,
      status,
      special_ad_categories: special_ad_categories || ['NONE'],
    };

    if (daily_budget) payload.daily_budget = daily_budget;
    if (lifetime_budget) payload.lifetime_budget = lifetime_budget;

    const response = await this.makeMetaRequest(connection, `${ad_account_id}/campaigns`, 'POST', payload);

    // Get full campaign details
    const campaignDetails = await this.makeMetaRequest(
      connection,
      `${response.id}?fields=id,name,objective,status,created_time`,
      'GET'
    );

    return {
      id: campaignDetails.id,
      name: campaignDetails.name,
      objective: campaignDetails.objective,
      status: campaignDetails.status,
      created_time: campaignDetails.created_time,
    };
  }

  private async updateCampaign(connection: any, params: any): Promise<any> {
    const { campaign_id, name, status, daily_budget, lifetime_budget } = params;

    const payload: any = {};
    if (name) payload.name = name;
    if (status) payload.status = status;
    if (daily_budget) payload.daily_budget = daily_budget;
    if (lifetime_budget) payload.lifetime_budget = lifetime_budget;

    await this.makeMetaRequest(connection, campaign_id, 'POST', payload);

    return {
      id: campaign_id,
      success: true,
      updated_at: new Date().toISOString(),
    };
  }

  private async getAdAccount(connection: any, params: any): Promise<any> {
    const { ad_account_id } = params;

    const fields = ['id', 'name', 'account_status', 'currency', 'timezone_name', 'amount_spent', 'balance', 'spend_cap'];
    const response = await this.makeMetaRequest(connection, `${ad_account_id}?fields=${fields.join(',')}`, 'GET');

    return {
      id: response.id,
      name: response.name,
      account_status: response.account_status,
      currency: response.currency,
      timezone_name: response.timezone_name,
      amount_spent: parseFloat(response.amount_spent || 0),
      balance: parseFloat(response.balance || 0),
      spend_cap: parseFloat(response.spend_cap || 0),
      retrieved_at: new Date().toISOString(),
    };
  }

  // ==========================
  // Tier 3: Ad Set Operations
  // ==========================

  private async createAdSet(connection: any, params: any): Promise<any> {
    const {
      campaign_id,
      name,
      optimization_goal,
      billing_event,
      bid_amount,
      targeting,
      status = 'PAUSED',
      daily_budget,
      lifetime_budget,
      start_time,
      end_time,
    } = params;

    const payload: any = {
      campaign_id,
      name,
      optimization_goal,
      billing_event,
      bid_amount,
      targeting: JSON.stringify(targeting),
      status,
    };

    if (daily_budget) payload.daily_budget = daily_budget;
    if (lifetime_budget) payload.lifetime_budget = lifetime_budget;
    if (start_time) payload.start_time = start_time;
    if (end_time) payload.end_time = end_time;

    const response = await this.makeMetaRequest(connection, `${campaign_id}/adsets`, 'POST', payload);

    // Get full adset details
    const adsetDetails = await this.makeMetaRequest(
      connection,
      `${response.id}?fields=id,name,campaign_id,status,created_time`,
      'GET'
    );

    return {
      id: adsetDetails.id,
      name: adsetDetails.name,
      campaign_id: adsetDetails.campaign_id,
      status: adsetDetails.status,
      created_time: adsetDetails.created_time,
    };
  }

  private async updateAdSet(connection: any, params: any): Promise<any> {
    const { adset_id, name, status, daily_budget, lifetime_budget, bid_amount, targeting } = params;

    const payload: any = {};
    if (name) payload.name = name;
    if (status) payload.status = status;
    if (daily_budget) payload.daily_budget = daily_budget;
    if (lifetime_budget) payload.lifetime_budget = lifetime_budget;
    if (bid_amount) payload.bid_amount = bid_amount;
    if (targeting) payload.targeting = JSON.stringify(targeting);

    await this.makeMetaRequest(connection, adset_id, 'POST', payload);

    return {
      id: adset_id,
      success: true,
      updated_at: new Date().toISOString(),
    };
  }

  // ==========================
  // Tier 4: Creative & Ads
  // ==========================

  private async createAd(connection: any, params: any): Promise<any> {
    const { adset_id, name, creative_id, status = 'PAUSED' } = params;

    const payload: any = {
      adset_id,
      name,
      creative: { creative_id },
      status,
    };

    const response = await this.makeMetaRequest(connection, `${adset_id}/ads`, 'POST', payload);

    // Get full ad details
    const adDetails = await this.makeMetaRequest(
      connection,
      `${response.id}?fields=id,name,adset_id,status,created_time`,
      'GET'
    );

    return {
      id: adDetails.id,
      name: adDetails.name,
      adset_id: adDetails.adset_id,
      status: adDetails.status,
      created_time: adDetails.created_time,
    };
  }

  private async uploadImage(connection: any, params: any): Promise<any> {
    const { ad_account_id, image_data, filename } = params;

    const payload: any = {
      bytes: image_data,
    };
    if (filename) payload.filename = filename;

    const response = await this.makeMetaRequest(connection, `${ad_account_id}/adimages`, 'POST', payload);

    // The response structure is unusual for images
    const imageData = response.images ? Object.values(response.images)[0] as any : response;

    return {
      id: imageData.id || Object.keys(response.images || {})[0],
      hash: imageData.hash,
      url: imageData.url || imageData.permalink_url,
      width: imageData.width,
      height: imageData.height,
      uploaded_at: new Date().toISOString(),
    };
  }

  private async createAdCreative(connection: any, params: any): Promise<any> {
    const { ad_account_id, name, object_story_spec } = params;

    const payload: any = {
      name,
      object_story_spec,
    };

    const response = await this.makeMetaRequest(connection, `${ad_account_id}/adcreatives`, 'POST', payload);

    // Get full creative details
    const creativeDetails = await this.makeMetaRequest(
      connection,
      `${response.id}?fields=id,name,object_story_spec`,
      'GET'
    );

    return {
      id: creativeDetails.id,
      name: creativeDetails.name,
      object_story_spec: creativeDetails.object_story_spec,
      created_time: new Date().toISOString(),
    };
  }

  // ============================
  // Tier 5: Audience Management
  // ============================

  private async createCustomAudience(connection: any, params: any): Promise<any> {
    const { ad_account_id, name, subtype = 'CUSTOM', description, customer_file_source = 'USER_PROVIDED_ONLY' } = params;

    const payload: any = {
      name,
      subtype,
      customer_file_source,
    };
    if (description) payload.description = description;

    const response = await this.makeMetaRequest(connection, `${ad_account_id}/customaudiences`, 'POST', payload);

    // Get full audience details
    const audienceDetails = await this.makeMetaRequest(
      connection,
      `${response.id}?fields=id,name,subtype,approximate_count,time_created`,
      'GET'
    );

    return {
      id: audienceDetails.id,
      name: audienceDetails.name,
      subtype: audienceDetails.subtype,
      approximate_count: audienceDetails.approximate_count || 0,
      created_time: audienceDetails.time_created,
    };
  }

  private async getAudiences(connection: any, params: any): Promise<any> {
    const { ad_account_id, limit = 100 } = params;

    const fields = ['id', 'name', 'subtype', 'approximate_count', 'delivery_status'];
    const url = `${ad_account_id}/customaudiences?fields=${fields.join(',')}&limit=${limit}`;

    const response = await this.makeMetaRequest(connection, url, 'GET');

    return {
      audiences: response.data.map((audience: any) => ({
        id: audience.id,
        name: audience.name,
        subtype: audience.subtype,
        approximate_count: audience.approximate_count || 0,
        delivery_status: audience.delivery_status,
      })),
      audience_count: response.data.length,
      retrieved_at: new Date().toISOString(),
    };
  }

  // ======================
  // Helper Methods
  // ======================

  private async makeMetaRequest(connection: any, endpoint: string, method: string = 'GET', body?: any): Promise<any> {
    const url = endpoint.startsWith('http') ? endpoint : `${BASE_URL}/${endpoint}`;
    const accessToken = connection.accessToken;

    const options: any = {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    // Add access token to URL for GET requests, body for POST
    let fullUrl = url;
    if (method === 'GET') {
      const separator = url.includes('?') ? '&' : '?';
      fullUrl = `${url}${separator}access_token=${accessToken}`;
    } else {
      if (!body) body = {};
      body.access_token = accessToken;
      options.body = JSON.stringify(body);
    }

    this.logger.debug({ url: fullUrl, method }, 'Making Meta API request');

    const response = await fetch(fullUrl, options);
    const data = await response.json();

    if (!response.ok) {
      this.logger.error({ status: response.status, error: data }, 'Meta API request failed');
      throw new Error(data.error?.message || `Meta API error: ${response.status}`);
    }

    return data;
  }

  private extractConversions(actions: any[]): number {
    if (!actions || !Array.isArray(actions)) return 0;

    const conversionActions = actions.filter(
      (action) => action.action_type === 'offsite_conversion' || action.action_type === 'purchase' || action.action_type === 'lead'
    );

    return conversionActions.reduce((sum, action) => sum + parseInt(action.value || 0), 0);
  }

  private extractCostPerConversion(costPerActionType: any[]): number {
    if (!costPerActionType || !Array.isArray(costPerActionType)) return 0;

    const conversionCost = costPerActionType.find(
      (cost) => cost.action_type === 'offsite_conversion' || cost.action_type === 'purchase' || cost.action_type === 'lead'
    );

    return conversionCost ? parseFloat(conversionCost.value || 0) : 0;
  }

  private calculateROAS(purchaseRoas: any[]): number {
    if (!purchaseRoas || !Array.isArray(purchaseRoas) || purchaseRoas.length === 0) return 0;

    const roas = purchaseRoas.find((r) => r.action_type === 'offsite_conversion.fb_pixel_purchase');
    return roas ? parseFloat(roas.value || 0) : 0;
  }
}
