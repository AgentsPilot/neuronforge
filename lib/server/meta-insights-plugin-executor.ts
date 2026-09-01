import { BasePluginExecutor } from './base-plugin-executor';
import { UserPluginConnections } from './user-plugin-connections';
import { PluginManagerV2 } from './plugin-manager-v2';
import { createLogger } from '@/lib/logger';

const pluginName = 'meta-insights';
const GRAPH_VERSION = 'v19.0';
const BASE_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;

/**
 * Read-only Facebook Page and Instagram Business insights.
 *
 * Deliberately separate from meta-ads: this plugin requests no advertising
 * permission and implements no write action, so a Business OS sync driven by it
 * cannot create or modify anything even if calling code were wrong.
 *
 * Two Graph API shapes are handled here. Page and Instagram insights come back
 * as a list of metric objects, each with its own `values` array — the caller
 * wants one row per day, so those are transposed. Post insights come back per
 * post and are flattened onto the post itself.
 */
export class MetaInsightsPluginExecutor extends BasePluginExecutor {
  protected logger = createLogger({ module: 'PluginExecutor' }).child({ plugin: pluginName });

  constructor(userConnections: UserPluginConnections, pluginManager: PluginManagerV2) {
    super(pluginName, userConnections, pluginManager);
  }

  protected async executeSpecificAction(
    connection: any,
    actionName: string,
    parameters: any
  ): Promise<any> {
    this.logger.debug({ actionName }, 'Executing Meta insights action');

    switch (actionName) {
      case 'list_pages':
        return this.listPages(connection);
      case 'get_page_insights':
        return this.getPageInsights(connection, parameters);
      case 'get_instagram_insights':
        return this.getInstagramInsights(connection, parameters);
      case 'get_recent_posts':
        return this.getRecentPosts(connection, parameters);
      default:
        throw new Error(`Unknown action: ${actionName}`);
    }
  }

  // ======================
  // Actions
  // ======================

  private async listPages(connection: any): Promise<any> {
    // The Instagram account is requested in the same call: it hangs off the Page,
    // so connecting a Page connects Instagram with it — the user never performs a
    // second connect step.
    // access_token must be named explicitly: specifying `fields` suppresses the
    // defaults, so omitting it silently yields undefined — which is what left
    // every Page insights call authenticating as the user and failing.
    const response = await this.graphRequest(
      connection,
      'me/accounts',
      'name,category,access_token,picture{url},instagram_business_account{id,username}'
    );

    const pages = (response.data || []).map((page: any) => ({
      id: page.id,
      name: page.name,
      category: page.category ?? null,
      picture_url: page.picture?.data?.url ?? null,
      instagram_account_id: page.instagram_business_account?.id ?? null,
      instagram_username: page.instagram_business_account?.username ?? null,
      // Page-scoped token: required for that Page's insights, and different from
      // the user token used here. Kept so the caller can pass it back.
      access_token: page.access_token ?? null,
    }));

    return {
      pages,
      page_count: pages.length,
      retrieved_at: new Date().toISOString(),
    };
  }

  private async getPageInsights(connection: any, params: any): Promise<any> {
    const { page_id, page_token, since, until } = params;
    const range = this.resolveRange(since, until, 30);

    // Resolved on demand when the caller has none, so an existing connection
    // stored before the token was captured keeps working without a reconnect.
    const pageToken = page_token || (await this.resolvePageToken(connection, page_id));

    /**
     * Only metrics Meta still serves.
     *
     * page_impressions, page_impressions_unique and page_fans were retired in
     * the Page Insights deprecation and now return error #100 even with a valid
     * Page token — verified directly against the API. That removes reach and
     * impressions for Pages entirely; what remains is what people DID rather
     * than how many saw it.
     */
    const metricToField: Record<string, string> = {
      page_post_engagements: 'engagements',
      page_views_total: 'profile_views',
      page_total_actions: 'website_clicks',
      page_daily_follows: 'new_followers',
    };

    const insightData = await this.fetchInsightsResilient(
      connection,
      `${page_id}/insights`,
      Object.keys(metricToField),
      { period: 'day', since: range.since, until: range.until },
      pageToken
    );

    const byDate = this.transposeInsights(insightData, metricToField);

    // Follower count is a live total rather than a daily series, so it comes
    // from the Page object, not the insights edge.
    let followersCount: number | null = null;
    try {
      const page = await this.graphRequest(
        connection,
        page_id,
        'followers_count,fan_count',
        {},
        pageToken
      );
      followersCount = page.followers_count ?? page.fan_count ?? null;
    } catch (error) {
      // A missing follower count must not lose a month of usable daily metrics.
      this.logger.warn({ err: error, page_id }, 'Could not read Page follower count');
    }

    return {
      page_id,
      days: byDate,
      followers_count: followersCount,
      retrieved_at: new Date().toISOString(),
    };
  }

  private async getInstagramInsights(connection: any, params: any): Promise<any> {
    const { instagram_account_id, page_token, since, until } = params;
    // Instagram serves at most 30 days per request, unlike the Page edge's 93.
    const range = this.resolveRange(since, until, 30, 30);

    const metricToField: Record<string, string> = {
      impressions: 'impressions',
      reach: 'reach',
      profile_views: 'profile_views',
      website_clicks: 'website_clicks',
    };

    const insightData = await this.fetchInsightsResilient(
      connection,
      `${instagram_account_id}/insights`,
      Object.keys(metricToField),
      { period: 'day', since: range.since, until: range.until },
      page_token
    );

    const byDate = this.transposeInsights(insightData, metricToField);

    let username: string | null = null;
    let followersCount: number | null = null;
    try {
      const account = await this.graphRequest(
        connection,
        instagram_account_id,
        'username,followers_count',
        {},
        page_token
      );
      username = account.username ?? null;
      followersCount = account.followers_count ?? null;
    } catch (error) {
      this.logger.warn({ err: error, instagram_account_id }, 'Could not read Instagram profile');
    }

    return {
      instagram_account_id,
      username,
      days: byDate,
      followers_count: followersCount,
      retrieved_at: new Date().toISOString(),
    };
  }

  private async getRecentPosts(connection: any, params: any): Promise<any> {
    const { page_id, limit = 25, since } = params;

    const query: Record<string, string> = { limit: String(Math.min(Number(limit) || 25, 100)) };
    if (since) query.since = this.toUnixDate(since);

    const response = await this.graphRequest(
      connection,
      `${page_id}/posts`,
      'id,message,created_time,permalink_url,insights.metric(post_impressions,post_impressions_organic,post_impressions_paid,post_engaged_users)',
      query
    );

    const posts = (response.data || []).map((post: any) => {
      const metrics = this.flattenPostInsights(post.insights?.data || []);
      const paid = metrics.post_impressions_paid ?? 0;

      return {
        id: post.id,
        message: post.message ?? null,
        created_time: post.created_time,
        permalink_url: post.permalink_url ?? null,
        impressions: metrics.post_impressions ?? 0,
        impressions_organic: metrics.post_impressions_organic ?? 0,
        impressions_paid: paid,
        engagements: metrics.post_engaged_users ?? 0,
        // Paid impressions on a Page post mean it was boosted. Note this says
        // nothing about spend — that is only in the Ads API.
        was_boosted: paid > 0,
      };
    });

    return {
      posts,
      post_count: posts.length,
      retrieved_at: new Date().toISOString(),
    };
  }

  // ======================
  // Helpers
  // ======================

  /**
   * Find a Page's own access token from the user's Page list.
   *
   * Needed because Page insights reject the user token. Kept as a lookup rather
   * than a hard requirement so connections stored before the token was captured
   * do not have to be re-authorised.
   */
  private async resolvePageToken(connection: any, pageId: string): Promise<string | undefined> {
    try {
      const response = await this.graphRequest(connection, 'me/accounts', 'access_token');
      const page = (response.data || []).find((p: any) => String(p.id) === String(pageId));
      return page?.access_token;
    } catch (error) {
      this.logger.warn({ err: error, pageId }, 'Could not resolve Page access token');
      return undefined;
    }
  }

  /**
   * Fetch insight metrics, surviving the ones Meta has retired.
   *
   * Meta fails the WHOLE request with error #100 if a single requested metric is
   * invalid — so one deprecated name loses every good metric alongside it. It
   * also retires metrics on a rolling schedule (a large batch lapsed on
   * 15 June 2026), which means any hardcoded list eventually breaks.
   *
   * So: ask for everything at once, and only if that is rejected as an invalid
   * metric, fall back to probing each metric on its own and keep whatever
   * answers. Costs one extra round trip in the failure case and nothing in the
   * normal one, and the plugin degrades to fewer metrics instead of no data.
   */
  private async fetchInsightsResilient(
    connection: any,
    endpoint: string,
    metrics: string[],
    query: Record<string, string>,
    tokenOverride?: string
  ): Promise<any[]> {
    try {
      const response = await this.graphRequest(
        connection,
        endpoint,
        undefined,
        { ...query, metric: metrics.join(',') },
        tokenOverride
      );
      return response.data || [];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // Only an invalid-metric rejection is worth probing. A token or
      // permission failure would fail identically for every metric.
      if (!/valid insights metric|does not support the metric/i.test(message)) {
        throw error;
      }

      this.logger.warn(
        { endpoint, metrics },
        'Metric set rejected by Meta; probing metrics individually'
      );

      const collected: any[] = [];
      const rejected: string[] = [];

      for (const metric of metrics) {
        try {
          const response = await this.graphRequest(
            connection,
            endpoint,
            undefined,
            { ...query, metric },
            tokenOverride
          );
          collected.push(...(response.data || []));
        } catch {
          rejected.push(metric);
        }
      }

      if (rejected.length) {
        // Named explicitly so a deprecation shows up as a specific log line
        // rather than as numbers quietly going missing.
        this.logger.warn(
          { endpoint, rejected },
          'Meta no longer supports these insight metrics; they will read as zero'
        );
      }

      if (collected.length === 0) {
        throw error;
      }

      return collected;
    }
  }

  /**
   * Graph returns insights as one object per metric, each holding a `values`
   * array of {value, end_time}. Callers want one object per day, so pivot.
   */
  private transposeInsights(
    metricObjects: any[],
    metricToField: Record<string, string>
  ): Array<Record<string, unknown>> {
    const byDate = new Map<string, Record<string, unknown>>();

    for (const metric of metricObjects) {
      const field = metricToField[metric.name];
      if (!field) continue;

      for (const point of metric.values || []) {
        // end_time marks the close of the day's window; the date is what matters.
        const date = String(point.end_time || '').slice(0, 10);
        if (!date) continue;

        const row = byDate.get(date) || { date };
        row[field] = Number(point.value) || 0;
        byDate.set(date, row);
      }
    }

    // Fill absent metrics with zero: Graph omits a metric for days with no
    // activity, and a missing key would read as unknown rather than none.
    const fields = Object.values(metricToField);
    return [...byDate.values()]
      .map(row => {
        for (const field of fields) {
          if (row[field] === undefined) row[field] = 0;
        }
        return row;
      })
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }

  private flattenPostInsights(insightData: any[]): Record<string, number> {
    const flat: Record<string, number> = {};
    for (const metric of insightData) {
      const value = metric.values?.[0]?.value;
      if (typeof value === 'number') flat[metric.name] = value;
    }
    return flat;
  }

  /**
   * @param defaultDays how far back to look when no start date is given
   * @param maxDays     platform ceiling; a wider request is clamped rather than
   *                    rejected, so a caller asking for 90 days of Instagram
   *                    gets the 30 it can have instead of an error
   */
  private resolveRange(
    since: string | undefined,
    until: string | undefined,
    defaultDays: number,
    maxDays = 93
  ): { since: string; until: string } {
    const end = until ? new Date(until) : new Date();
    const requestedStart = since
      ? new Date(since)
      : new Date(end.getTime() - defaultDays * 24 * 60 * 60 * 1000);

    const earliestAllowed = new Date(end.getTime() - maxDays * 24 * 60 * 60 * 1000);
    const start = requestedStart < earliestAllowed ? earliestAllowed : requestedStart;

    return { since: this.toIsoDate(start), until: this.toIsoDate(end) };
  }

  private toIsoDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private toUnixDate(value: string): string {
    return String(Math.floor(new Date(value).getTime() / 1000));
  }

  private async graphRequest(
    connection: any,
    endpoint: string,
    fields?: string,
    query: Record<string, string> = {},
    tokenOverride?: string
  ): Promise<any> {
    // Page and Instagram insights must be read with that Page's own token; the
    // user token returns "(#190) This method must be called with a Page Access
    // Token". Everything else uses the user token.
    const accessToken = tokenOverride || connection.access_token;
    if (!accessToken) {
      throw new Error('Meta connection is missing an access token. Please reconnect in Settings.');
    }

    const search = new URLSearchParams({ ...query, access_token: accessToken });
    if (fields) search.set('fields', fields);

    const url = `${BASE_URL}/${endpoint}?${search.toString()}`;

    // Log the endpoint and the non-secret query keys only. The assembled URL
    // carries the access token and must never reach the log stream.
    this.logger.debug({ endpoint, query: Object.keys(query) }, 'Making Meta Graph request');

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await response.json();

    if (!response.ok) {
      const metaError = data?.error;
      this.logger.error(
        { status: response.status, endpoint, code: metaError?.code, type: metaError?.type },
        'Meta Graph request failed'
      );
      throw new Error(metaError?.message || `Meta API error: ${response.status}`);
    }

    return data;
  }
}
