// lib/repositories/PluginConnectionRepository.ts
// Repository for managing plugin connection persistence

import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, Logger } from '@/lib/logger';
import type { UserConnection } from '@/lib/types/plugin-types';
import type { AgentRepositoryResult, UpsertPluginConnectionInput } from './types';

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
}

export const pluginConnectionRepository = new PluginConnectionRepository();
