// lib/repositories/UserProfileRepository.ts
// Repository for managing user profile persistence

import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, Logger } from '@/lib/logger';
import type {
  UserProfile,
  CreateUserProfileInput,
  UpdateUserProfileInput,
  UserProfileWithEmail,
  AgentRepositoryResult,
} from './types';

export class UserProfileRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'UserProfileRepository' });
  }

  // ============ Query Operations ============

  /**
   * Find a user profile by user ID
   */
  async findById(userId: string): Promise<AgentRepositoryResult<UserProfile>> {
    const methodLogger = this.logger.child({ method: 'findById', userId });

    try {
      methodLogger.debug('Fetching user profile');

      const { data, error } = await this.supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) throw error;

      methodLogger.debug('User profile fetched');
      return { data, error: null };
    } catch (error) {
      methodLogger.error({ err: error }, 'Failed to fetch user profile');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Find a user profile with email from auth
   * Note: This requires service role access to get auth user email
   */
  async findByIdWithEmail(userId: string): Promise<AgentRepositoryResult<UserProfileWithEmail>> {
    const methodLogger = this.logger.child({ method: 'findByIdWithEmail', userId });

    try {
      methodLogger.debug('Fetching user profile with email');

      const { data: profile, error } = await this.supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) throw error;

      // Get email from auth.users (requires service role)
      const { data: authData } = await this.supabase.auth.admin.getUserById(userId);

      const profileWithEmail: UserProfileWithEmail = {
        ...profile,
        email: authData?.user?.email,
      };

      methodLogger.debug('User profile with email fetched');
      return { data: profileWithEmail, error: null };
    } catch (error) {
      methodLogger.error({ err: error }, 'Failed to fetch user profile with email');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Check if a user profile exists
   */
  async exists(userId: string): Promise<boolean> {
    const { data } = await this.supabase
      .from('profiles')
      .select('id')
      .eq('id', userId)
      .single();

    return !!data;
  }

  /**
   * Find profiles by role (admin only)
   */
  async findByRole(role: 'admin' | 'user' | 'viewer'): Promise<AgentRepositoryResult<UserProfile[]>> {
    try {
      const { data, error } = await this.supabase
        .from('profiles')
        .select('*')
        .eq('role', role)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }

  /**
   * Search profiles by name or company (admin only)
   */
  async search(query: string, limit: number = 20): Promise<AgentRepositoryResult<UserProfile[]>> {
    try {
      const { data, error } = await this.supabase
        .from('profiles')
        .select('*')
        .or(`full_name.ilike.%${query}%,company.ilike.%${query}%`)
        .limit(limit)
        .order('full_name', { ascending: true });

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }

  // ============ CRUD Operations ============

  /**
   * Create a new user profile
   * Typically called during user registration/onboarding
   */
  async create(input: CreateUserProfileInput): Promise<AgentRepositoryResult<UserProfile>> {
    const methodLogger = this.logger.child({ method: 'create', userId: input.id });
    const startTime = Date.now();

    try {
      methodLogger.debug('Creating user profile');

      const { data, error } = await this.supabase
        .from('profiles')
        .insert({
          ...input,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) throw error;

      const duration = Date.now() - startTime;
      methodLogger.info({ duration }, 'User profile created');

      return { data, error: null };
    } catch (error) {
      const duration = Date.now() - startTime;
      methodLogger.error({ err: error, duration }, 'Failed to create user profile');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Update a user profile
   * Returns the updated profile and previous state for audit purposes
   */
  async update(
    userId: string,
    input: UpdateUserProfileInput
  ): Promise<AgentRepositoryResult<{ profile: UserProfile; previousProfile: UserProfile }>> {
    const methodLogger = this.logger.child({ method: 'update', userId });
    const startTime = Date.now();

    try {
      methodLogger.debug({ fields: Object.keys(input) }, 'Updating user profile');

      // Fetch current profile for audit trail
      const { data: previousProfile, error: fetchError } = await this.findById(userId);
      if (fetchError) throw fetchError;
      if (!previousProfile) throw new Error('Profile not found');

      // Build update data (only include provided fields)
      const updateData: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };

      // Only include fields that are explicitly provided (including null values)
      if (input.full_name !== undefined) updateData.full_name = input.full_name;
      if (input.company !== undefined) updateData.company = input.company;
      if (input.role !== undefined) updateData.role = input.role;
      if (input.avatar_url !== undefined) updateData.avatar_url = input.avatar_url;
      if (input.bio !== undefined) updateData.bio = input.bio;
      if (input.timezone !== undefined) updateData.timezone = input.timezone;
      if (input.language !== undefined) updateData.language = input.language;
      if (input.job_title !== undefined) updateData.job_title = input.job_title;

      const { data: profile, error: updateError } = await this.supabase
        .from('profiles')
        .update(updateData)
        .eq('id', userId)
        .select()
        .single();

      if (updateError) throw updateError;

      const duration = Date.now() - startTime;
      methodLogger.info({ updatedFields: Object.keys(input), duration }, 'User profile updated');

      return { data: { profile, previousProfile }, error: null };
    } catch (error) {
      const duration = Date.now() - startTime;
      methodLogger.error({ err: error, duration }, 'Failed to update user profile');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Upsert a user profile (create if not exists, update if exists)
   * Useful for onboarding flows
   */
  async upsert(input: CreateUserProfileInput): Promise<AgentRepositoryResult<UserProfile>> {
    const methodLogger = this.logger.child({ method: 'upsert', userId: input.id });

    try {
      methodLogger.debug('Upserting user profile');

      const { data, error } = await this.supabase
        .from('profiles')
        .upsert({
          ...input,
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) throw error;

      methodLogger.info('User profile upserted');
      return { data, error: null };
    } catch (error) {
      methodLogger.error({ err: error }, 'Failed to upsert user profile');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Delete a user profile (hard delete)
   * Use with caution - typically only for GDPR data deletion requests
   */
  async delete(userId: string): Promise<AgentRepositoryResult<boolean>> {
    const methodLogger = this.logger.child({ method: 'delete', userId });

    try {
      methodLogger.warn('Deleting user profile - this cannot be undone');

      const { error } = await this.supabase
        .from('profiles')
        .delete()
        .eq('id', userId);

      if (error) throw error;

      methodLogger.info('User profile permanently deleted');
      return { data: true, error: null };
    } catch (error) {
      methodLogger.error({ err: error }, 'Failed to delete user profile');
      return { data: false, error: error as Error };
    }
  }

  // ============ Specific Field Updates ============

  /**
   * Update user avatar URL
   */
  async updateAvatar(userId: string, avatarUrl: string | null): Promise<AgentRepositoryResult<UserProfile>> {
    const methodLogger = this.logger.child({ method: 'updateAvatar', userId });

    try {
      const { data, error } = await this.supabase
        .from('profiles')
        .update({
          avatar_url: avatarUrl,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId)
        .select()
        .single();

      if (error) throw error;

      methodLogger.info('User avatar updated');
      return { data, error: null };
    } catch (error) {
      methodLogger.error({ err: error }, 'Failed to update user avatar');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Update user role (admin only)
   */
  async updateRole(userId: string, role: 'admin' | 'user' | 'viewer'): Promise<AgentRepositoryResult<UserProfile>> {
    const methodLogger = this.logger.child({ method: 'updateRole', userId, role });

    try {
      const { data, error } = await this.supabase
        .from('profiles')
        .update({
          role,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId)
        .select()
        .single();

      if (error) throw error;

      methodLogger.info({ newRole: role }, 'User role updated');
      return { data, error: null };
    } catch (error) {
      methodLogger.error({ err: error }, 'Failed to update user role');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Update user timezone and language preferences
   */
  async updateLocale(
    userId: string,
    timezone?: string,
    language?: string
  ): Promise<AgentRepositoryResult<UserProfile>> {
    const methodLogger = this.logger.child({ method: 'updateLocale', userId });

    try {
      const updateData: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (timezone !== undefined) updateData.timezone = timezone;
      if (language !== undefined) updateData.language = language;

      const { data, error } = await this.supabase
        .from('profiles')
        .update(updateData)
        .eq('id', userId)
        .select()
        .single();

      if (error) throw error;

      methodLogger.info({ timezone, language }, 'User locale updated');
      return { data, error: null };
    } catch (error) {
      methodLogger.error({ err: error }, 'Failed to update user locale');
      return { data: null, error: error as Error };
    }
  }

  // ============ Bulk Operations (Admin) ============

  /**
   * Get all profiles (admin only, paginated)
   */
  async findAll(options?: {
    limit?: number;
    offset?: number;
    orderBy?: keyof UserProfile;
    ascending?: boolean;
  }): Promise<AgentRepositoryResult<UserProfile[]>> {
    try {
      let query = this.supabase
        .from('profiles')
        .select('*')
        .order(options?.orderBy || 'created_at', { ascending: options?.ascending ?? false });

      if (options?.limit) {
        query = query.limit(options.limit);
      }
      if (options?.offset) {
        query = query.range(options.offset, options.offset + (options.limit || 10) - 1);
      }

      const { data, error } = await query;
      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }

  /**
   * Count total profiles (admin only)
   */
  async count(): Promise<AgentRepositoryResult<number>> {
    try {
      const { count, error } = await this.supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true });

      if (error) throw error;
      return { data: count || 0, error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }
}

// Export singleton instance for convenience
export const userProfileRepository = new UserProfileRepository();
