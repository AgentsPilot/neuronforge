/**
 * Pulls channel reach into Postgres so the reports page, the detectors and the
 * chat can all read it as ordinary rows.
 *
 * Modelled on lib/services/CalendarSyncService.ts, which already does
 * plugin-executor -> repository -> Postgres driven by a staleness cursor.
 *
 * READ-ONLY BY CONSTRUCTION
 * Every platform call goes through `callChannelAction`, which refuses any action
 * not on the allowlist. The plugins themselves request no write permission, so
 * this is defence in depth rather than the only guard — but it means a future
 * edit that reaches for a write action fails loudly here instead of quietly
 * posting something to a customer's Facebook Page.
 */

import { createLogger } from '@/lib/logger';
import { PluginExecuterV2 } from '@/lib/server/plugin-executer-v2';
import {
  channelConnectionRepository,
  ChannelConnectionRepository,
  type ChannelConnection,
} from '@/lib/repositories/ChannelConnectionRepository';
import {
  channelMetricsRepository,
  ChannelMetricsRepository,
  type ChannelMetricRow,
} from '@/lib/repositories/ChannelMetricsRepository';
import { ga4SourceToChannel } from './ga4Source';

const logger = createLogger({ service: 'ChannelMetricsSyncService' });

/** The only platform actions this service may ever invoke. */
const READ_ONLY_CHANNEL_ACTIONS = new Set([
  'list_pages',
  'get_page_insights',
  'get_instagram_insights',
  'get_recent_posts',
  'list_locations',
  'get_location_metrics',
  'list_properties',
  'run_report',
]);

/** First connect pulls this much history. */
const BACKFILL_DAYS = 90;
/**
 * Nightly runs re-fetch this trailing window rather than just yesterday.
 * Platforms keep revising recent days as late engagement is attributed, so a
 * write-once-per-day approach would freeze numbers that are still moving.
 */
const ROLLING_WINDOW_DAYS = 28;

export interface SyncResult {
  connectionId: string;
  platform: string;
  daysWritten: number;
  error?: string;
}

export class ChannelMetricsSyncService {
  constructor(
    private readonly connections: ChannelConnectionRepository = channelConnectionRepository,
    private readonly metrics: ChannelMetricsRepository = channelMetricsRepository
  ) {}

  /** Syncs every enabled connection for one user. Used by the manual refresh. */
  async syncUser(userId: string): Promise<SyncResult[]> {
    const { data: connections } = await this.connections.findEnabledByUser(userId);
    if (!connections?.length) return [];

    const results: SyncResult[] = [];
    for (const connection of connections) {
      results.push(await this.syncConnection(connection));
    }
    return results;
  }

  /** Syncs connections whose cursor is stale. Used by the nightly cron. */
  async syncDue(staleAfterHours = 20, limit = 25, retryAfterHours = 3): Promise<SyncResult[]> {
    const staleBefore = new Date(Date.now() - staleAfterHours * 3600 * 1000).toISOString();
    // A connection that failed is retried on a shorter clock than one that
    // succeeded — an outage or a bad token should not cost a full day of data.
    const retryBefore = new Date(Date.now() - retryAfterHours * 3600 * 1000).toISOString();
    const { data: due } = await this.connections.findDueForSync(staleBefore, retryBefore, limit);
    if (!due?.length) return [];

    logger.info({ count: due.length }, 'Syncing channel connections');

    const results: SyncResult[] = [];
    for (const connection of due) {
      // Sequential rather than parallel: these are per-user API quotas and a
      // burst across connections is the fastest way to get rate limited.
      results.push(await this.syncConnection(connection));
    }
    return results;
  }

  async syncConnection(connection: ChannelConnection): Promise<SyncResult> {
    const isBackfill = !connection.backfill_completed_at;
    const days = isBackfill ? BACKFILL_DAYS : ROLLING_WINDOW_DAYS;
    const since = this.isoDate(new Date(Date.now() - days * 86400000));
    const until = this.isoDate(new Date());

    try {
      const rows = await this.fetchRows(connection, since, until);
      const { error } = await this.metrics.upsertMany(rows);
      if (error) throw error;

      await this.connections.markSynced(connection.id, { backfillCompleted: isBackfill });

      logger.info(
        { connectionId: connection.id, platform: connection.platform, days: rows.length, isBackfill },
        'Channel sync complete'
      );

      return { connectionId: connection.id, platform: connection.platform, daysWritten: rows.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Recorded rather than thrown: one broken connection must not stop the
      // cron from syncing everyone else.
      await this.connections.markSyncFailed(connection.id, message);

      logger.error(
        { err: error, connectionId: connection.id, platform: connection.platform },
        'Channel sync failed'
      );

      return {
        connectionId: connection.id,
        platform: connection.platform,
        daysWritten: 0,
        error: message,
      };
    }
  }

  // ======================
  // Per-platform fetch
  // ======================

  private async fetchRows(
    connection: ChannelConnection,
    since: string,
    until: string
  ): Promise<ChannelMetricRow[]> {
    switch (connection.platform) {
      case 'facebook_page':
        return this.fetchFacebookPage(connection, since, until);
      case 'instagram':
        return this.fetchInstagram(connection, since, until);
      case 'ga4':
        return this.fetchGa4(connection, since, until);
      default:
        // google_business_profile arrives with its plugin.
        logger.warn({ platform: connection.platform }, 'No fetcher for platform yet');
        return [];
    }
  }

  private async fetchFacebookPage(
    connection: ChannelConnection,
    since: string,
    until: string
  ): Promise<ChannelMetricRow[]> {
    const result = await this.callChannelAction(
      connection.user_id,
      connection.plugin_key,
      'get_page_insights',
      {
        page_id: connection.account_id,
        since,
        until,
        // Omitted rather than sent as null: the action's schema types this as a
        // string, and `typeof null === 'object'` fails validation. The executor
        // resolves the Page token itself when it isn't supplied.
        ...(connection.account_token ? { page_token: connection.account_token } : {}),
      }
    );

    return (result.days || []).map((day: any) =>
      this.toRow(connection, day.date, {
        // Meta retired page impressions and reach; a Page now reports what
        // people did, not how many saw it. Left at zero rather than invented.
        impressions: 0,
        reach: 0,
        engagements: day.engagements,
        profile_views: day.profile_views,
        website_clicks: day.website_clicks,
        followers_count: result.followers_count ?? null,
        raw: day,
      })
    );
  }

  private async fetchInstagram(
    connection: ChannelConnection,
    since: string,
    until: string
  ): Promise<ChannelMetricRow[]> {
    // Instagram serves at most 30 days per call, so a 90-day backfill has to be
    // requested in chunks rather than one range.
    const chunks = this.splitRange(since, until, 30);
    const rows: ChannelMetricRow[] = [];

    for (const chunk of chunks) {
      const result = await this.callChannelAction(
        connection.user_id,
        connection.plugin_key,
        'get_instagram_insights',
        {
          instagram_account_id: connection.account_id,
          since: chunk.since,
          until: chunk.until,
          ...(connection.account_token ? { page_token: connection.account_token } : {}),
        }
      );

      for (const day of result.days || []) {
        rows.push(
          this.toRow(connection, day.date, {
            impressions: day.impressions,
            reach: day.reach,
            engagements: 0, // Instagram's account-level insights carry no engagement metric.
            profile_views: day.profile_views,
            website_clicks: day.website_clicks,
            followers_count: result.followers_count ?? null,
            raw: day,
          })
        );
      }
    }

    return rows;
  }

  /**
   * GA4 traffic, one row per (day, channel).
   *
   * The only platform where one account produces many channels: a single
   * property reports visits arriving from Instagram, Google, direct and
   * referrals all on the same day. Hence the channel dimension on the table.
   *
   * Writes `sessions`/`visitors` and leaves `reach` at zero. A GA4 session is a
   * visit that reached the business's own website; Meta reach is people who saw
   * a post. Putting one in the other's column would make a channel look an order
   * of magnitude better purely because of which account was connected.
   */
  private async fetchGa4(
    connection: ChannelConnection,
    since: string,
    until: string
  ): Promise<ChannelMetricRow[]> {
    const result = await this.callChannelAction(
      connection.user_id,
      connection.plugin_key,
      'run_report',
      {
        property_id: connection.account_id,
        since,
        until,
        // hostName is requested so overlap with an AgentPilot-hosted page can be
        // detected from the data, rather than asked of the user.
        dimensions: ['date', 'sessionSource', 'hostName'],
        metrics: ['sessions', 'activeUsers', 'screenPageViews'],
      }
    );

    const reportRows = (result.rows || []) as Array<Record<string, string | number>>;

    // The executor caps the report at 10,000 rows. Three dimensions over 90 days
    // can approach that, and GA4 truncates silently — so say so rather than
    // reporting a quietly incomplete total as fact.
    if (reportRows.length >= 10000) {
      logger.warn(
        { connectionId: connection.id, rowCount: reportRows.length },
        'GA4 report hit the row limit; totals for this window may be truncated'
      );
    }

    // Many (source, host) pairs collapse into one channel, so accumulate before
    // building rows — otherwise each pair would overwrite the last on upsert.
    const byDateChannel = new Map<
      string,
      { date: string; channel: string; sessions: number; visitors: number; pageViews: number }
    >();
    const hosts = new Set<string>();

    for (const row of reportRows) {
      const date = String(row.date || '');
      if (!date) continue;

      const host = String(row.hostName || '').trim();
      if (host) hosts.add(host);

      const { channel } = ga4SourceToChannel(String(row.sessionSource || ''));
      const key = `${date}|${channel}`;

      const bucket = byDateChannel.get(key) ?? {
        date,
        channel,
        sessions: 0,
        visitors: 0,
        pageViews: 0,
      };
      bucket.sessions += Number(row.sessions) || 0;
      bucket.visitors += Number(row.activeUsers) || 0;
      bucket.pageViews += Number(row.screenPageViews) || 0;
      byDateChannel.set(key, bucket);
    }

    // Record which hosts this property measures, for the overlap check. Failing
    // here must not lose a successful sync, so it is not awaited into the result.
    if (hosts.size > 0) {
      this.connections
        .setMeasuredHosts(connection.id, [...hosts])
        .catch(err => logger.warn({ err, connectionId: connection.id }, 'Could not record measured hosts'));
    }

    return [...byDateChannel.values()].map(bucket =>
      this.toRow(connection, bucket.date, {
        channel: bucket.channel,
        sessions: bucket.sessions,
        visitors: bucket.visitors,
        impressions: bucket.pageViews,
        // Not reach. GA4 cannot say how many people saw the business elsewhere.
        reach: 0,
        raw: bucket,
      })
    );
  }

  // ======================
  // Helpers
  // ======================

  /**
   * The single point at which this service talks to a platform.
   * Anything not on the read-only allowlist is refused before it reaches the
   * executor.
   */
  private async callChannelAction(
    userId: string,
    pluginKey: string,
    action: string,
    parameters: Record<string, unknown>
  ): Promise<any> {
    if (!READ_ONLY_CHANNEL_ACTIONS.has(action)) {
      throw new Error(
        `Refused: '${action}' is not a read-only channel action. Business OS insight sync must never write to a connected account.`
      );
    }

    const executer = await PluginExecuterV2.getInstance();
    const result = await executer.execute(userId, pluginKey, action, parameters);

    if (!result?.success) {
      const raw = result?.message || result?.error || `${pluginKey}.${action} failed`;

      // Meta reports a missing permission as a generic API error. Translate it
      // into something the UI can act on, rather than showing the raw text and
      // leaving the user to guess that their app is missing a product.
      if (/permission|OAuth|scope|#(10|200|294)\b/i.test(raw)) {
        throw new Error(
          `missing_permission: ${pluginKey}.${action} needs a permission this connection was not granted. Original: ${raw}`
        );
      }

      throw new Error(raw);
    }

    return result.data ?? {};
  }

  private toRow(
    connection: ChannelConnection,
    metricDate: string,
    values: {
      impressions?: number;
      reach?: number;
      engagements?: number;
      profile_views?: number;
      website_clicks?: number;
      followers_count?: number | null;
      sessions?: number;
      visitors?: number;
      /** GA4 reports many channels per property; Meta's account IS the channel. */
      channel?: string;
      raw?: unknown;
    }
  ): ChannelMetricRow {
    return {
      user_id: connection.user_id,
      platform: connection.platform,
      account_id: connection.account_id,
      metric_date: metricDate,
      channel: values.channel ?? '_account',
      impressions: Number(values.impressions) || 0,
      reach: Number(values.reach) || 0,
      engagements: Number(values.engagements) || 0,
      profile_views: Number(values.profile_views) || 0,
      website_clicks: Number(values.website_clicks) || 0,
      actions_calls: 0,
      actions_directions: 0,
      followers_count:
        values.followers_count === null || values.followers_count === undefined
          ? null
          : Number(values.followers_count),
      sessions: Number(values.sessions) || 0,
      visitors: Number(values.visitors) || 0,
      raw: (values.raw as Record<string, unknown>) ?? {},
    };
  }

  private splitRange(
    since: string,
    until: string,
    maxDays: number
  ): { since: string; until: string }[] {
    const chunks: { since: string; until: string }[] = [];
    const end = new Date(until);
    let cursor = new Date(since);

    while (cursor < end) {
      const chunkEnd = new Date(
        Math.min(cursor.getTime() + maxDays * 86400000, end.getTime())
      );
      chunks.push({ since: this.isoDate(cursor), until: this.isoDate(chunkEnd) });
      // +1 day so consecutive chunks don't both include the boundary date.
      cursor = new Date(chunkEnd.getTime() + 86400000);
    }

    return chunks;
  }

  private isoDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }
}

export const channelMetricsSyncService = new ChannelMetricsSyncService();
