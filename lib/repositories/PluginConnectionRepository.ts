// lib/repositories/PluginConnectionRepository.ts
// Repository for managing plugin connection persistence

import { SupabaseClient, type PostgrestError } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, Logger } from '@/lib/logger';
import type { UserConnection } from '@/lib/types/plugin-types';
import type { AgentRepositoryResult, UpsertPluginConnectionInput } from './types';

/**
 * The only columns the GDPR export reads (DATA_EXPORT_FOLLOWUPS_WORKPLAN.md
 * §4.5). Changing this changes what the export holds: a privacy decision.
 *
 * Never read: `access_token` / `refresh_token` (credentials), `expires_at` /
 * `last_refreshed_at` (token plumbing), `settings` (free-form, so a secret could
 * land there unseen) and `id`. `profile_data` IS read, because it holds the
 * person's own provider profile, but some providers also store an access token
 * inside it: the route must never send it raw. It passes only the allow-listed
 * string fields (route.ts `accountProfile`, SA C-1).
 */
const USER_DATA_EXPORT_COLUMNS =
  'user_id, plugin_key, plugin_name, username, email, scope, status, connected_at, ' +
  'created_at, updated_at, last_used, disconnected_at, profile_data';

export interface PluginConnectionExportRow {
  user_id: string;
  plugin_key: string;
  plugin_name: string | null;
  username: string | null;
  email: string | null;
  scope: string | null;
  status: string | null;
  connected_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  last_used: string | null;
  disconnected_at: string | null;
  /** Raw provider profile JSON. May hold credentials: never export it as is. */
  profile_data: unknown;
}

export class PluginConnectionRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'PluginConnectionRepository' });
  }

  // ============ Query Operations ============

  /**
   * Find all active connections for a user
   */
  async findActiveByUser(userId: string): Promise<AgentRepositoryResult<UserConnection[]>> {
    try {
      const { data, error } = await this.supabase
        .from('plugin_connections')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active');

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }

  /**
   * Find a connection by user and plugin key (any status)
   */
  async findByUserAndPlugin(userId: string, pluginKey: string): Promise<AgentRepositoryResult<UserConnection>> {
    try {
      const { data, error } = await this.supabase
        .from('plugin_connections')
        .select('*')
        .eq('user_id', userId)
        .eq('plugin_key', pluginKey)
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }

  /**
   * Find an active connection by user and plugin key
   */
  async findActiveByUserAndPlugin(userId: string, pluginKey: string): Promise<AgentRepositoryResult<UserConnection>> {
    try {
      const { data, error } = await this.supabase
        .from('plugin_connections')
        .select('*')
        .eq('user_id', userId)
        .eq('plugin_key', pluginKey)
        .eq('status', 'active')
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }

  /**
   * Check if a connection exists for a user and plugin key
   */
  async existsByUserAndPlugin(userId: string, pluginKey: string): Promise<AgentRepositoryResult<boolean>> {
    try {
      const { data, error } = await this.supabase
        .from('plugin_connections')
        .select('id')
        .eq('user_id', userId)
        .eq('plugin_key', pluginKey)
        .single();

      if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
      return { data: !!data, error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }

  /**
   * Find only the profile_data field for a connection
   */
  async findProfileData(userId: string, pluginKey: string): Promise<AgentRepositoryResult<{ profile_data: Record<string, unknown> | null }>> {
    try {
      const { data, error } = await this.supabase
        .from('plugin_connections')
        .select('profile_data')
        .eq('user_id', userId)
        .eq('plugin_key', pluginKey)
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }

  /**
   * Find an active connection by matching fields in profile_data (JSONB @> operator).
   * Used by webhook routes to look up which user owns a given external identifier.
   * Does NOT require userId — matches across all users.
   */
  async findActiveByProfileData(
    pluginKey: string,
    profileDataMatch: Record<string, string>
  ): Promise<AgentRepositoryResult<UserConnection>> {
    try {
      const { data, error } = await this.supabase
        .from('plugin_connections')
        .select('*')
        .eq('plugin_key', pluginKey)
        .eq('status', 'active')
        .contains('profile_data', profileDataMatch)
        .maybeSingle();

      if (error) throw error;
      return { data: data || null, error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }

  /**
   * Find all connections for a user (any status), ordered by connected_at DESC
   */
  async findAllByUser(userId: string): Promise<AgentRepositoryResult<UserConnection[]>> {
    try {
      const { data, error } = await this.supabase
        .from('plugin_connections')
        .select('*')
        .eq('user_id', userId)
        .order('connected_at', { ascending: false });

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }

  // ============ Write Operations ============

  /**
   * Upsert a plugin connection (insert or update on user_id + plugin_key conflict).
   * Forces status to 'active' and sets timestamps.
   */
  async upsert(input: UpsertPluginConnectionInput): Promise<AgentRepositoryResult<UserConnection>> {
    const methodLogger = this.logger.child({ method: 'upsert', userId: input.user_id, pluginKey: input.plugin_key });

    try {
      const upsertData = {
        ...input,
        status: 'active',
        connected_at: input.connected_at || new Date().toISOString(),
        last_used: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      methodLogger.debug('Upserting plugin connection');

      const { data, error } = await this.supabase
        .from('plugin_connections')
        .upsert(upsertData, { onConflict: 'user_id,plugin_key' })
        .select()
        .single();

      if (error) throw error;

      methodLogger.info({ connectionId: data?.id }, 'Plugin connection upserted');
      return { data, error: null };
    } catch (error) {
      methodLogger.error({ err: error }, 'Failed to upsert plugin connection');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Update the status of a connection, with optional extra fields (e.g. disconnected_at)
   */
  async updateStatus(
    userId: string,
    pluginKey: string,
    status: string,
    extra?: Record<string, unknown>
  ): Promise<AgentRepositoryResult<boolean>> {
    try {
      const { error } = await this.supabase
        .from('plugin_connections')
        .update({
          status,
          updated_at: new Date().toISOString(),
          ...extra,
        })
        .eq('user_id', userId)
        .eq('plugin_key', pluginKey);

      if (error) throw error;
      return { data: true, error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }

  /**
   * Update the profile_data field of a connection.
   * Caller is responsible for merging — this writes the final value.
   */
  async updateProfileData(
    userId: string,
    pluginKey: string,
    profileData: Record<string, unknown>
  ): Promise<AgentRepositoryResult<boolean>> {
    try {
      const { error } = await this.supabase
        .from('plugin_connections')
        .update({
          profile_data: profileData,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
        .eq('plugin_key', pluginKey);

      if (error) throw error;
      return { data: true, error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }

  /**
   * Mark all active connections with expired tokens as 'expired'
   */
  async markExpired(): Promise<AgentRepositoryResult<number>> {
    try {
      const now = new Date().toISOString();

      const { data, error } = await this.supabase
        .from('plugin_connections')
        .update({ status: 'expired' })
        .lt('expires_at', now)
        .eq('status', 'active')
        .select('id');

      if (error) throw error;
      return { data: data?.length || 0, error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }

  /**
   * GDPR export only (GET /api/user/data-export, Art. 15 / 20). Every plugin
   * connection of the caller, any status, unordered, with
   * USER_DATA_EXPORT_COLUMNS only: credentials are never read. The column set is
   * fixed; changing it changes what the export holds, which is a privacy
   * decision. `profile_data` comes back raw; the route filters it (see the
   * constant).
   */
  async listForUserDataExport(userId: string): Promise<AgentRepositoryResult<PluginConnectionExportRow[]>> {
    try {
      const { data, error } = await this.supabase
        .from('plugin_connections')
        .select(USER_DATA_EXPORT_COLUMNS)
        .eq('user_id', userId);

      if (error) throw error;
      return { data: (data ?? []) as unknown as PluginConnectionExportRow[], error: null };
    } catch (error) {
      this.logger.error({ err: error, userId }, 'Failed to list plugin connections for the data export');
      return { data: null, error: error as Error };
    }
  }

  // Stripe webhook: keyed by Stripe ids or rows the route has already proved owned (⟨unscoped-by-design⟩)
  //
  // Moved out of `lib/payments/stripeAccountContext.ts` (`resolveAccountOwner`)
  // with no behaviour change (CF-5 PR 5, FU-5 SA rule-1 ruling). It issues
  // exactly the read the resolver issued inline, on the client the resolver was
  // handed. Not `findActiveByProfileData`: that filters `status = 'active'`,
  // which would change which connected accounts map to a business.
  //
  // Errors: supabase-js's own `{ data, error }`, with no try/catch and no
  // logging, unlike the methods above. The resolver turns a returned error into
  // its own throw (FU-5), and a rejected query must still reach the webhook,
  // which answers 500 so Stripe retries.

  /**
   * ⟨unscoped-by-design⟩ Every connection of one plugin, ANY status, across all
   * businesses: `user_id, profile_data, status` only, never the token columns.
   *
   * Owner check relied on: none can apply, because the owner is the OUTPUT. The
   * OAuth path keeps the Stripe account id inside `profile_data`, which cannot
   * be filtered as a column, so `resolveAccountOwner` reads these rows and
   * matches the `event.account` of a signature-verified Connect event in
   * memory, returning one `user_id`. The rows never leave the server. Some
   * providers keep a token inside `profile_data`: do not return these rows to a
   * client or log them. The plugin key is a closed set.
   */
  async listByPluginKey(pluginKey: OwnerLookupPluginKey): Promise<PluginConnectionOwnerRowsResult> {
    const { data, error } = await this.supabase
      .from('plugin_connections')
      .select('user_id, profile_data, status')
      .eq('plugin_key', pluginKey);
    return { data: data as PluginConnectionOwnerRow[] | null, error };
  }
}

/** The plugin keys `listByPluginKey` may read (closed set, CF-5 PR 5). */
export type OwnerLookupPluginKey = 'stripe';

/** One row of `listByPluginKey`. `profile_data` is raw provider JSON. */
export interface PluginConnectionOwnerRow {
  user_id: string;
  profile_data: unknown;
  status: string | null;
}

/** supabase-js's own result for `listByPluginKey`, error object kept. */
export interface PluginConnectionOwnerRowsResult {
  data: PluginConnectionOwnerRow[] | null;
  error: PostgrestError | null;
}

export const pluginConnectionRepository = new PluginConnectionRepository();
