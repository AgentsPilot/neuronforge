/**
 * Which channels a user has opted into having analysed, and when each was last
 * synced.
 *
 * A row here is the consent record. Connecting the Meta plugin is not enough on
 * its own — a user may have connected it for an agent workflow, which is not
 * permission to ingest and store their business's reach.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ service: 'ChannelConnectionRepository' });

export type ChannelPlatform =
  | 'facebook_page'
  | 'instagram'
  | 'google_business_profile'
  | 'ga4';

export interface ChannelConnection {
  id: string;
  user_id: string;
  platform: ChannelPlatform;
  plugin_key: string;
  account_id: string;
  account_name: string | null;
  account_token: string | null;
  insights_enabled: boolean;
  connected_at: string;
  last_synced_at: string | null;
  last_sync_error: string | null;
  backfill_completed_at: string | null;
  /**
   * Hostnames this property reports traffic for. Used to detect whether a GA4
   * property measures an AgentPilot-hosted page, so the same visit is not
   * counted by both collectors. Derived from the report, never asked of the user.
   */
  measured_hosts?: string[];
}

export interface RepositoryResult<T> {
  data: T | null;
  error: Error | null;
}

export class ChannelConnectionRepository {
  constructor(private readonly supabase: SupabaseClient = supabaseServer) {}

  async findByUser(userId: string): Promise<RepositoryResult<ChannelConnection[]>> {
    try {
      const { data, error } = await this.supabase
        .from('channel_connections')
        .select('*')
        .eq('user_id', userId)
        .order('connected_at', { ascending: true });

      if (error) throw error;
      return { data: (data as ChannelConnection[]) || [], error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to list channel connections');
      return { data: null, error: error as Error };
    }
  }

  /** Enabled connections only — what the reports surface and the sync act on. */
  async findEnabledByUser(userId: string): Promise<RepositoryResult<ChannelConnection[]>> {
    try {
      const { data, error } = await this.supabase
        .from('channel_connections')
        .select('*')
        .eq('user_id', userId)
        .eq('insights_enabled', true);

      if (error) throw error;
      return { data: (data as ChannelConnection[]) || [], error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to list enabled channel connections');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Connections due a sync, oldest cursor first.
   *
   * Service-role read across all users: the cron runs without a user session,
   * mirroring how `getUsersWithCalendarSyncEnabled` drives the calendar sync.
   */
  async findDueForSync(
    staleBefore: string,
    retryBefore: string,
    limit = 25
  ): Promise<RepositoryResult<ChannelConnection[]>> {
    try {
      // Two windows, because a failure and a success are not equally worth
      // waiting on. last_synced_at records the last *attempt* — markSyncFailed
      // stamps it too — so a broken connection used to sit out the full stale
      // window before anyone tried again. A connection carrying an error comes
      // back sooner; a healthy one keeps its once-a-day cadence.
      const { data, error } = await this.supabase
        .from('channel_connections')
        .select('*')
        .eq('insights_enabled', true)
        .or(
          `last_synced_at.is.null,` +
          `and(last_sync_error.is.null,last_synced_at.lt.${staleBefore}),` +
          `and(last_sync_error.not.is.null,last_synced_at.lt.${retryBefore})`
        )
        .order('last_synced_at', { ascending: true, nullsFirst: true })
        .limit(limit);

      if (error) throw error;
      return { data: (data as ChannelConnection[]) || [], error: null };
    } catch (error) {
      logger.error({ err: error }, 'Failed to find connections due for sync');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Record a connected account. Idempotent on (user_id, platform, account_id),
   * so reconnecting refreshes the token instead of creating a duplicate.
   */
  async upsert(
    connection: Omit<ChannelConnection, 'id' | 'connected_at' | 'last_synced_at' | 'last_sync_error' | 'backfill_completed_at'>
  ): Promise<RepositoryResult<ChannelConnection>> {
    try {
      const { data, error } = await this.supabase
        .from('channel_connections')
        .upsert(connection, { onConflict: 'user_id,platform,account_id' })
        .select()
        .single();

      if (error) throw error;
      return { data: data as ChannelConnection, error: null };
    } catch (error) {
      logger.error(
        { err: error, userId: connection.user_id, platform: connection.platform },
        'Failed to upsert channel connection'
      );
      return { data: null, error: error as Error };
    }
  }

  async markSynced(
    id: string,
    options: { backfillCompleted?: boolean } = {}
  ): Promise<RepositoryResult<true>> {
    try {
      const patch: Record<string, unknown> = {
        last_synced_at: new Date().toISOString(),
        last_sync_error: null,
      };
      if (options.backfillCompleted) {
        patch.backfill_completed_at = new Date().toISOString();
      }

      const { error } = await this.supabase.from('channel_connections').update(patch).eq('id', id);
      if (error) throw error;
      return { data: true, error: null };
    } catch (error) {
      logger.error({ err: error, id }, 'Failed to mark channel connection synced');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Record why a sync failed.
   *
   * `last_synced_at` is deliberately advanced too. Without it a permanently
   * failing connection — an expired Meta token, which happens to every user
   * roughly every 60 days — would stay top of the due queue forever and starve
   * every healthy connection behind it.
   */
  async markSyncFailed(id: string, message: string): Promise<RepositoryResult<true>> {
    try {
      const { error } = await this.supabase
        .from('channel_connections')
        .update({
          last_sync_error: message.slice(0, 500),
          last_synced_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (error) throw error;
      return { data: true, error: null };
    } catch (error) {
      logger.error({ err: error, id }, 'Failed to record channel sync failure');
      return { data: null, error: error as Error };
    }
  }

  async setEnabled(
    userId: string,
    id: string,
    enabled: boolean
  ): Promise<RepositoryResult<true>> {
    try {
      const { error } = await this.supabase
        .from('channel_connections')
        .update({ insights_enabled: enabled })
        .eq('id', id)
        .eq('user_id', userId);

      if (error) throw error;
      return { data: true, error: null };
    } catch (error) {
      logger.error({ err: error, userId, id }, 'Failed to toggle channel insights');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Record which hosts a property measures.
   *
   * Written by the sync from the report itself. This is what lets visit
   * precedence be decided without asking the user whether their analytics
   * covers the page we also track.
   */
  async setMeasuredHosts(id: string, hosts: string[]): Promise<RepositoryResult<true>> {
    try {
      const { error } = await this.supabase
        .from('channel_connections')
        .update({ measured_hosts: hosts })
        .eq('id', id);

      if (error) throw error;
      return { data: true, error: null };
    } catch (error) {
      logger.error({ err: error, id }, 'Failed to record measured hosts');
      return { data: null, error: error as Error };
    }
  }

  /** Removes the connection. Stored metrics are deleted separately and explicitly. */
  async remove(userId: string, id: string): Promise<RepositoryResult<true>> {
    try {
      const { error } = await this.supabase
        .from('channel_connections')
        .delete()
        .eq('id', id)
        .eq('user_id', userId);

      if (error) throw error;
      return { data: true, error: null };
    } catch (error) {
      logger.error({ err: error, userId, id }, 'Failed to remove channel connection');
      return { data: null, error: error as Error };
    }
  }
}

export const channelConnectionRepository = new ChannelConnectionRepository();
