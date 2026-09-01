/**
 * Daily reach and engagement per connected channel.
 *
 * Writes are always upserts on (user_id, platform, account_id, metric_date).
 * The nightly sync re-fetches a trailing window rather than only yesterday,
 * because platforms restate recent days as late engagement is counted — so the
 * table has to converge on their numbers rather than freeze the first answer.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import type { ChannelPlatform, RepositoryResult } from './ChannelConnectionRepository';

const logger = createLogger({ service: 'ChannelMetricsRepository' });

export interface ChannelMetricRow {
  user_id: string;
  platform: ChannelPlatform;
  account_id: string;
  metric_date: string;
  /**
   * Acquisition channel. '_account' where the account itself IS the channel
   * (Meta, Business Profile); a real channel name for GA4, which reports many
   * channels from one property.
   */
  channel: string;
  impressions: number;
  reach: number;
  engagements: number;
  profile_views: number;
  website_clicks: number;
  actions_calls: number;
  actions_directions: number;
  followers_count: number | null;
  /** GA4 only. Visits, never reach — the two must not be summed. */
  sessions?: number;
  visitors?: number;
  raw: Record<string, unknown>;
}

/** One channel's numbers on one day, for a single platform. */
export interface ChannelDailyRow {
  channel: string;
  metric_date: string;
  sessions: number;
  visitors: number;
  impressions: number;
  reach: number;
}

export interface ChannelTotals {
  platform: ChannelPlatform;
  account_id: string;
  channel: string;
  impressions: number;
  reach: number;
  engagements: number;
  profile_views: number;
  website_clicks: number;
  /** Most recent non-null snapshot in the window, not a sum. */
  followers_count: number | null;
}

export class ChannelMetricsRepository {
  constructor(private readonly supabase: SupabaseClient = supabaseServer) {}

  /**
   * Insert or update a batch of daily rows.
   *
   * Chunked because a 90-day backfill across several accounts can exceed what a
   * single PostgREST request will accept.
   */
  async upsertMany(rows: ChannelMetricRow[]): Promise<RepositoryResult<number>> {
    if (rows.length === 0) return { data: 0, error: null };

    const CHUNK = 500;
    try {
      let written = 0;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK).map(row => ({
          ...row,
          synced_at: new Date().toISOString(),
        }));

        const { error } = await this.supabase
          .from('channel_metrics_daily')
          .upsert(chunk, { onConflict: 'user_id,platform,account_id,metric_date,channel' });

        if (error) throw error;
        written += chunk.length;
      }

      return { data: written, error: null };
    } catch (error) {
      logger.error({ err: error, rowCount: rows.length }, 'Failed to upsert channel metrics');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Per-channel totals over a window.
   *
   * Summed in application code rather than SQL: PostgREST cannot express a
   * grouped aggregate without a database view or RPC, and the row count here is
   * bounded by (channels x days) — at most a few hundred rows for a year.
   */
  async getTotalsSince(
    userId: string,
    since: string
  ): Promise<RepositoryResult<ChannelTotals[]>> {
    try {
      const { data, error } = await this.supabase
        .from('channel_metrics_daily')
        .select(
          'platform, account_id, channel, metric_date, impressions, reach, engagements, profile_views, website_clicks, followers_count'
        )
        .eq('user_id', userId)
        .gte('metric_date', since)
        .order('metric_date', { ascending: true });

      if (error) throw error;

      const byAccount = new Map<string, ChannelTotals>();

      for (const row of (data as any[]) || []) {
        // The channel belongs in the key: without it every GA4 channel for one
        // property collapses into a single bucket and the numbers are summed
        // across unrelated channels.
        const key = `${row.platform}:${row.account_id}:${row.channel}`;
        const totals = byAccount.get(key) ?? {
          platform: row.platform,
          account_id: row.account_id,
          channel: row.channel,
          impressions: 0,
          reach: 0,
          engagements: 0,
          profile_views: 0,
          website_clicks: 0,
          followers_count: null,
        };

        totals.impressions += Number(row.impressions) || 0;
        // Reach is distinct-people-per-day; summing overcounts anyone who saw
        // the business on more than one day. Kept as a sum because the platforms
        // give no cross-day dedupe, but the UI must label it "daily reach added
        // up", not "people reached".
        totals.reach += Number(row.reach) || 0;
        totals.engagements += Number(row.engagements) || 0;
        totals.profile_views += Number(row.profile_views) || 0;
        totals.website_clicks += Number(row.website_clicks) || 0;

        // Rows arrive oldest first, so the last non-null wins: the latest snapshot.
        if (row.followers_count !== null && row.followers_count !== undefined) {
          totals.followers_count = Number(row.followers_count);
        }

        byAccount.set(key, totals);
      }

      return { data: [...byAccount.values()], error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to load channel totals');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Per-channel, per-day rows for one platform.
   *
   * Deliberately not a window total: whether GA4 supersedes our own page views
   * is decided one day at a time, so that GA4 having no data for a given day
   * falls back to our count instead of leaving a hole in the series.
   */
  async getDailyByPlatformSince(
    userId: string,
    platform: ChannelPlatform,
    since: string
  ): Promise<RepositoryResult<ChannelDailyRow[]>> {
    try {
      const { data, error } = await this.supabase
        .from('channel_metrics_daily')
        .select('channel, metric_date, sessions, visitors, impressions, reach')
        .eq('user_id', userId)
        .eq('platform', platform)
        .gte('metric_date', since)
        .order('metric_date', { ascending: true });

      if (error) throw error;

      const rows: ChannelDailyRow[] = ((data as any[]) || []).map(row => ({
        channel: row.channel,
        metric_date: row.metric_date,
        sessions: Number(row.sessions) || 0,
        visitors: Number(row.visitors) || 0,
        impressions: Number(row.impressions) || 0,
        reach: Number(row.reach) || 0,
      }));

      return { data: rows, error: null };
    } catch (error) {
      logger.error({ err: error, userId, platform }, 'Failed to load daily channel metrics');
      return { data: null, error: error as Error };
    }
  }

  /** Deletes a channel's stored history — the "delete my data" path. */
  async deleteForAccount(
    userId: string,
    platform: ChannelPlatform,
    accountId: string
  ): Promise<RepositoryResult<true>> {
    try {
      const { error } = await this.supabase
        .from('channel_metrics_daily')
        .delete()
        .eq('user_id', userId)
        .eq('platform', platform)
        .eq('account_id', accountId);

      if (error) throw error;
      logger.info({ userId, platform, accountId }, 'Deleted stored channel metrics');
      return { data: true, error: null };
    } catch (error) {
      logger.error({ err: error, userId, platform }, 'Failed to delete channel metrics');
      return { data: null, error: error as Error };
    }
  }
}

export const channelMetricsRepository = new ChannelMetricsRepository();
