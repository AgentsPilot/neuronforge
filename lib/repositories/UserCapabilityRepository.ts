/**
 * UserCapabilityRepository
 * Repository for querying user capabilities from user_capabilities + capabilities tables
 */

import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ service: 'UserCapabilityRepository' });

export interface UserCapabilityWithDetails {
  id: string;
  user_id: string;
  capability_id: string;
  activated_at: string;
  activation_source: string;
  configuration: Record<string, unknown>;
  is_active: boolean;
  capability_key: string;
  name_en: string;
  name_es: string;
  name_he: string;
  description_en: string | null;
  description_es: string | null;
  description_he: string | null;
  category: string;
  icon: string;
  color: string | null;
  is_core: boolean;
}

export interface RepositoryResult<T> {
  data: T | null;
  error: Error | null;
}

export class UserCapabilityRepository {
  private supabase = supabaseServer;

  /**
   * Get all active capabilities for a user with full capability details
   */
  async findActiveByUserId(userId: string): Promise<RepositoryResult<UserCapabilityWithDetails[]>> {
    try {
      logger.info({ userId }, 'Finding active capabilities for user');

      const { data, error } = await this.supabase
        .from('user_capabilities')
        .select(`
          id,
          user_id,
          capability_id,
          activated_at,
          activation_source,
          configuration,
          is_active,
          capabilities (
            capability_key,
            name_en,
            name_es,
            name_he,
            description_en,
            description_es,
            description_he,
            category,
            icon,
            color,
            is_core
          )
        `)
        .eq('user_id', userId)
        .eq('is_active', true)
        .order('activated_at', { ascending: true });

      if (error) throw error;

      // Flatten the joined data
      const capabilities: UserCapabilityWithDetails[] = (data || []).map((row: any) => ({
        id: row.id,
        user_id: row.user_id,
        capability_id: row.capability_id,
        activated_at: row.activated_at,
        activation_source: row.activation_source,
        configuration: row.configuration || {},
        is_active: row.is_active,
        capability_key: row.capabilities.capability_key,
        name_en: row.capabilities.name_en,
        name_es: row.capabilities.name_es,
        name_he: row.capabilities.name_he,
        description_en: row.capabilities.description_en,
        description_es: row.capabilities.description_es,
        description_he: row.capabilities.description_he,
        category: row.capabilities.category,
        icon: row.capabilities.icon,
        color: row.capabilities.color,
        is_core: row.capabilities.is_core
      }));

      logger.info({ userId, count: capabilities.length }, 'Found active capabilities');
      return { data: capabilities, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to find active capabilities');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Check if user has a specific capability active
   */
  async hasCapability(userId: string, capabilityKey: string): Promise<boolean> {
    try {
      const { data, error } = await this.supabase
        .from('user_capabilities')
        .select(`
          id,
          capabilities!inner (
            capability_key
          )
        `)
        .eq('user_id', userId)
        .eq('is_active', true)
        .eq('capabilities.capability_key', capabilityKey)
        .maybeSingle();

      if (error) throw error;

      return !!data;
    } catch (error) {
      logger.error({ err: error, userId, capabilityKey }, 'Failed to check capability');
      return false;
    }
  }

  /**
   * Get user's capability by key
   */
  async findByCapabilityKey(
    userId: string,
    capabilityKey: string
  ): Promise<RepositoryResult<UserCapabilityWithDetails | null>> {
    try {
      const { data, error } = await this.supabase
        .from('user_capabilities')
        .select(`
          id,
          user_id,
          capability_id,
          activated_at,
          activation_source,
          configuration,
          is_active,
          capabilities!inner (
            capability_key,
            name_en,
            name_es,
            name_he,
            description_en,
            description_es,
            description_he,
            category,
            icon,
            color,
            is_core
          )
        `)
        .eq('user_id', userId)
        .eq('capabilities.capability_key', capabilityKey)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        return { data: null, error: null };
      }

      const capability: UserCapabilityWithDetails = {
        id: data.id,
        user_id: data.user_id,
        capability_id: data.capability_id,
        activated_at: data.activated_at,
        activation_source: data.activation_source,
        configuration: data.configuration || {},
        is_active: data.is_active,
        capability_key: (data.capabilities as any).capability_key,
        name_en: (data.capabilities as any).name_en,
        name_es: (data.capabilities as any).name_es,
        name_he: (data.capabilities as any).name_he,
        description_en: (data.capabilities as any).description_en,
        description_es: (data.capabilities as any).description_es,
        description_he: (data.capabilities as any).description_he,
        category: (data.capabilities as any).category,
        icon: (data.capabilities as any).icon,
        color: (data.capabilities as any).color,
        is_core: (data.capabilities as any).is_core
      };

      return { data: capability, error: null };
    } catch (error) {
      logger.error({ err: error, userId, capabilityKey }, 'Failed to find capability by key');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get capability keys for process step generation (simplified format)
   */
  async getActiveCapabilityKeys(userId: string): Promise<RepositoryResult<Array<{
    capability_key: string;
    name_en: string;
    name_es: string;
    name_he: string;
    icon: string;
    color: string | null;
  }>>> {
    try {
      const { data, error } = await this.supabase
        .from('user_capabilities')
        .select(`
          capabilities (
            capability_key,
            name_en,
            name_es,
            name_he,
            icon,
            color
          )
        `)
        .eq('user_id', userId)
        .eq('is_active', true);

      if (error) throw error;

      const capabilities = (data || []).map((row: any) => ({
        capability_key: row.capabilities.capability_key,
        name_en: row.capabilities.name_en,
        name_es: row.capabilities.name_es,
        name_he: row.capabilities.name_he,
        icon: row.capabilities.icon,
        color: row.capabilities.color
      }));

      return { data: capabilities, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to get capability keys');
      return { data: null, error: error as Error };
    }
  }
}

// Singleton export
export const userCapabilityRepository = new UserCapabilityRepository();
