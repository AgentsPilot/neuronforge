/**
 * BusinessProfileRepository
 * Repository for business_profiles table
 * Handles CRUD operations for user business profiles
 */

import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import type { Database } from '@/types/database';

const logger = createLogger({ service: 'BusinessProfileRepository' });

type BusinessProfile = Database['public']['Tables']['business_profiles']['Row'];
type BusinessProfileInsert = Database['public']['Tables']['business_profiles']['Insert'];
type BusinessProfileUpdate = Database['public']['Tables']['business_profiles']['Update'];

export interface BusinessProfileRepositoryResult<T> {
  data: T | null;
  error: Error | null;
}

/**
 * Process step structure for "How It Works" section
 */
export interface ProcessStep {
  title: string;
  description: string;
  icon?: string;
  number?: number;
}

export class BusinessProfileRepository {
  private supabase = supabaseServer;

  /**
   * Find business profile by user ID
   */
  async findByUserId(userId: string): Promise<BusinessProfileRepositoryResult<BusinessProfile>> {
    try {
      logger.info({ userId }, 'Finding business profile by user ID');

      const { data, error } = await this.supabase
        .from('business_profiles')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // No rows found - this is expected for new users
          logger.debug({ userId }, 'No business profile found for user');
          return { data: null, error: null };
        }
        throw error;
      }

      logger.info({ userId, profileId: data.id }, 'Business profile found');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to find business profile');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Create a new business profile
   */
  async create(profile: BusinessProfileInsert): Promise<BusinessProfileRepositoryResult<BusinessProfile>> {
    try {
      logger.info({ userId: profile.user_id }, 'Creating business profile');

      const { data, error } = await this.supabase
        .from('business_profiles')
        .insert(profile)
        .select()
        .single();

      if (error) throw error;

      logger.info({ userId: profile.user_id, profileId: data.id }, 'Business profile created');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, userId: profile.user_id }, 'Failed to create business profile');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Update business profile
   */
  async update(
    userId: string,
    updates: BusinessProfileUpdate
  ): Promise<BusinessProfileRepositoryResult<BusinessProfile>> {
    try {
      logger.info({ userId }, 'Updating business profile');

      const { data, error } = await this.supabase
        .from('business_profiles')
        .update(updates)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;

      logger.info({ userId, profileId: data.id }, 'Business profile updated');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to update business profile');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Upsert business profile (create if doesn't exist, update if it does)
   */
  async upsert(profile: BusinessProfileInsert): Promise<BusinessProfileRepositoryResult<BusinessProfile>> {
    try {
      logger.info({ userId: profile.user_id }, 'Upserting business profile');

      const { data, error } = await this.supabase
        .from('business_profiles')
        .upsert(profile, { onConflict: 'user_id' })
        .select()
        .single();

      if (error) throw error;

      logger.info({ userId: profile.user_id, profileId: data.id }, 'Business profile upserted');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, userId: profile.user_id }, 'Failed to upsert business profile');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Mark onboarding as completed
   */
  async completeOnboarding(userId: string): Promise<BusinessProfileRepositoryResult<BusinessProfile>> {
    try {
      logger.info({ userId }, 'Marking onboarding as completed');

      const { data, error } = await this.supabase
        .from('business_profiles')
        .update({
          onboarding_completed: true,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;

      logger.info({ userId, profileId: data.id }, 'Onboarding marked as completed');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to mark onboarding as completed');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Calculate profile completeness percentage
   */
  calculateCompleteness(profile: Partial<BusinessProfile>): number {
    const fields = [
      'vertical',
      'company_name',
      'website_url',
      'primary_calendar',
      'primary_payment',
      'clients_per_week'
    ];

    const filledFields = fields.filter(field => {
      const value = profile[field as keyof typeof profile];
      return value !== null && value !== undefined && value !== '';
    });

    return Math.round((filledFields.length / fields.length) * 100);
  }

  // ==================== CALENDAR SYNC METHODS ====================

  /**
   * Enable calendar sync for a user
   */
  async enableCalendarSync(
    userId: string,
    provider: 'google_calendar' | 'outlook'
  ): Promise<BusinessProfileRepositoryResult<BusinessProfile>> {
    try {
      logger.info({ userId, provider }, 'Enabling calendar sync');

      const { data, error } = await this.supabase
        .from('business_profiles')
        .update({
          calendar_sync_enabled: true,
          calendar_sync_provider: provider,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;

      logger.info({ userId, provider }, 'Calendar sync enabled');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, userId, provider }, 'Failed to enable calendar sync');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Disable calendar sync for a user
   */
  async disableCalendarSync(
    userId: string
  ): Promise<BusinessProfileRepositoryResult<BusinessProfile>> {
    try {
      logger.info({ userId }, 'Disabling calendar sync');

      const { data, error } = await this.supabase
        .from('business_profiles')
        .update({
          calendar_sync_enabled: false,
          calendar_sync_provider: null,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;

      logger.info({ userId }, 'Calendar sync disabled');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to disable calendar sync');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get calendar sync settings for a user
   */
  async getCalendarSyncSettings(
    userId: string
  ): Promise<BusinessProfileRepositoryResult<{
    enabled: boolean;
    provider: 'google_calendar' | 'outlook' | null;
    lastSyncedAt: string | null;
  }>> {
    try {
      const { data, error } = await this.supabase
        .from('business_profiles')
        .select('calendar_sync_enabled, calendar_sync_provider, calendar_last_synced_at')
        .eq('user_id', userId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // No profile found - return defaults
          return {
            data: { enabled: false, provider: null, lastSyncedAt: null },
            error: null
          };
        }
        throw error;
      }

      return {
        data: {
          enabled: data.calendar_sync_enabled ?? false,
          provider: data.calendar_sync_provider as 'google_calendar' | 'outlook' | null,
          lastSyncedAt: data.calendar_last_synced_at
        },
        error: null
      };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to get calendar sync settings');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Update last synced timestamp
   */
  async updateCalendarLastSynced(
    userId: string
  ): Promise<BusinessProfileRepositoryResult<BusinessProfile>> {
    try {
      const { data, error } = await this.supabase
        .from('business_profiles')
        .update({
          calendar_last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;

      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to update calendar last synced');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get users with calendar sync enabled (for cron job)
   * Returns users whose sync is stale (not synced in the last N minutes)
   */
  async getUsersWithCalendarSyncEnabled(
    staleAfterMinutes: number = 5
  ): Promise<BusinessProfileRepositoryResult<Array<{
    userId: string;
    provider: 'google_calendar' | 'outlook';
    lastSyncedAt: string | null;
  }>>> {
    try {
      const staleThreshold = new Date(Date.now() - staleAfterMinutes * 60 * 1000).toISOString();

      const { data, error } = await this.supabase
        .from('business_profiles')
        .select('user_id, calendar_sync_provider, calendar_last_synced_at')
        .eq('calendar_sync_enabled', true)
        .not('calendar_sync_provider', 'is', null)
        .or(`calendar_last_synced_at.is.null,calendar_last_synced_at.lt.${staleThreshold}`);

      if (error) throw error;

      const users = (data || []).map(profile => ({
        userId: profile.user_id,
        provider: profile.calendar_sync_provider as 'google_calendar' | 'outlook',
        lastSyncedAt: profile.calendar_last_synced_at
      }));

      logger.info({ count: users.length, staleAfterMinutes }, 'Found users with calendar sync enabled');
      return { data: users, error: null };
    } catch (error) {
      logger.error({ err: error, staleAfterMinutes }, 'Failed to get users with calendar sync enabled');
      return { data: null, error: error as Error };
    }
  }

  // ==================== PROCESS STEPS METHODS ====================

  /**
   * Get user-defined process steps
   */
  async getProcessSteps(userId: string): Promise<BusinessProfileRepositoryResult<ProcessStep[]>> {
    try {
      const { data, error } = await this.supabase
        .from('business_profiles')
        .select('process_steps')
        .eq('user_id', userId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // No profile found - return empty array
          return { data: [], error: null };
        }
        throw error;
      }

      const steps = (data?.process_steps || []) as ProcessStep[];
      logger.debug({ userId, stepCount: steps.length }, 'Retrieved process steps');
      return { data: steps, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to get process steps');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Update user-defined process steps
   */
  async updateProcessSteps(
    userId: string,
    steps: ProcessStep[]
  ): Promise<BusinessProfileRepositoryResult<ProcessStep[]>> {
    try {
      logger.info({ userId, stepCount: steps.length }, 'Updating process steps');

      // Ensure steps have sequential numbers
      const numberedSteps = steps.map((step, index) => ({
        ...step,
        number: index + 1
      }));

      const { error } = await this.supabase
        .from('business_profiles')
        .update({
          process_steps: numberedSteps,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId);

      if (error) throw error;

      logger.info({ userId, stepCount: numberedSteps.length }, 'Process steps updated');
      return { data: numberedSteps, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to update process steps');
      return { data: null, error: error as Error };
    }
  }
}

// Singleton export
export const businessProfileRepository = new BusinessProfileRepository();
