/**
 * BusinessProfileRepository
 * Repository for business_profiles table
 * Handles CRUD operations for user business profiles
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ service: 'BusinessProfileRepository' });

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

/**
 * Supported external calendar providers for two-way sync.
 * DB-enforced via `valid_profile_calendar_sync_provider` CHECK constraint.
 */
export type CalendarSyncProvider = 'google_calendar' | 'outlook';

/**
 * Weekly availability for scheduling, keyed by day name (e.g. "monday").
 * Backs the `scheduling_availability` JSONB column. Mirrors the shape read by
 * OpsUtilizationLowDetector's `WeeklyAvailability`.
 */
export type SchedulingAvailability = Record<string, { start: string; end: string }[]>;

/**
 * Row shape for the `business_profiles` table.
 *
 * Hand-written to mirror the generated Supabase types the rest of the repo layer
 * avoids depending on (see CRMContactRepository / PaymentRepository). Column set
 * covers the base CREATE (20260721) plus every later ALTER:
 * services (20260722), scheduling_availability (20260722), calendar sync fields
 * (20260723), setup_checklist_dismissed (20260723), process_steps (20260728),
 * dismissed_setup_steps (20260802). Nullability follows the DB: only id/user_id/
 * vertical are NOT NULL; defaulted-but-nullable columns are `| null`.
 */
export interface BusinessProfile {
  id: string;
  user_id: string;

  // Vertical identification
  vertical: string;
  sub_vertical: string | null;

  // Business metrics
  company_name: string | null;
  company_size: string | null;
  clients_per_week: number | null;
  revenue_tier: string | null;

  // Online presence
  website_url: string | null;
  landing_pages: string[] | null;
  website_analysis: Record<string, unknown> | null;

  // Connected tools
  connected_plugins: string[] | null;
  primary_crm: string | null;
  primary_calendar: string | null;
  primary_payment: string | null;

  // Onboarding state
  onboarding_completed: boolean | null;
  onboarding_conversation: Record<string, unknown> | null;
  profile_completeness: number | null;

  // Language preference
  language: string | null;

  // Services offered (20260722)
  services: string[] | null;

  // Weekly scheduling availability (20260722)
  scheduling_availability: SchedulingAvailability | null;

  // Calendar sync preferences (20260723)
  calendar_sync_enabled: boolean | null;
  calendar_sync_provider: CalendarSyncProvider | null;
  calendar_last_synced_at: string | null;

  // Dashboard setup checklist (20260723 / 20260802)
  setup_checklist_dismissed: boolean | null;
  dismissed_setup_steps: string[] | null;

  // Website "How It Works" steps (20260728)
  process_steps: ProcessStep[] | null;

  // Payment settings — processor agnostic (20260723 enhance_payments)
  default_payment_processor: string | null;
  payment_retry_enabled: boolean | null;
  payment_retry_intervals: number[] | null;
  payment_max_retries: number | null;
  payment_reminder_enabled: boolean | null;
  payment_reminder_days_before: number[] | null;
  payment_overdue_reminder_days: number[] | null;
  payment_reminder_channels: string[] | null;

  // Timestamps
  created_at: string | null;
  updated_at: string | null;

  // --- Not backed by a physical column ---
  // No migration defines `currency`, `timezone`, or `contact_email` on
  // business_profiles (the scheduling availability route even carries a
  // "TODO: Add timezone column" note). Existing consumers nonetheless read them
  // defensively with a fallback (ContextBuilder, SafeExecutionLayer,
  // BookingEmailService). Typed here as optional, read-only extras to preserve
  // that behavior; deliberately absent from Insert/Update so nobody writes a
  // non-existent column (cf. the documented `tools` PGRST204 bug in the
  // onboarding build route). Follow-up: add real columns or drop the reads.
  currency?: string | null;
  timezone?: string | null;
  contact_email?: string | null;
}

/**
 * Insert shape for `business_profiles`. Only NOT NULL columns without a default
 * are required; everything else is optional (DB defaults or nullable).
 */
export interface BusinessProfileInsert {
  id?: string;
  user_id: string;
  // NOT NULL at the DB, but the onboarding build route writes
  // `profile.vertical || null` (its request schema treats vertical as optional).
  // Allow null here to mirror that call site; the NOT NULL constraint is enforced
  // by Postgres, not the type.
  vertical: string | null;
  sub_vertical?: string | null;
  company_name?: string | null;
  company_size?: string | null;
  clients_per_week?: number | null;
  revenue_tier?: string | null;
  website_url?: string | null;
  landing_pages?: string[] | null;
  website_analysis?: Record<string, unknown> | null;
  connected_plugins?: string[] | null;
  primary_crm?: string | null;
  primary_calendar?: string | null;
  primary_payment?: string | null;
  onboarding_completed?: boolean | null;
  onboarding_conversation?: Record<string, unknown> | null;
  profile_completeness?: number | null;
  language?: string | null;
  services?: string[] | null;
  scheduling_availability?: SchedulingAvailability | null;
  calendar_sync_enabled?: boolean | null;
  calendar_sync_provider?: CalendarSyncProvider | null;
  calendar_last_synced_at?: string | null;
  setup_checklist_dismissed?: boolean | null;
  dismissed_setup_steps?: string[] | null;
  process_steps?: ProcessStep[] | null;
  default_payment_processor?: string | null;
  payment_retry_enabled?: boolean | null;
  payment_retry_intervals?: number[] | null;
  payment_max_retries?: number | null;
  payment_reminder_enabled?: boolean | null;
  payment_reminder_days_before?: number[] | null;
  payment_overdue_reminder_days?: number[] | null;
  payment_reminder_channels?: string[] | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/**
 * Update shape for `business_profiles`. All columns optional.
 */
export type BusinessProfileUpdate = Partial<BusinessProfileInsert>;

export class BusinessProfileRepository {
  private supabase: SupabaseClient;

  // Constructor injection so callers with an injected (service-role) client can reuse it,
  // while the singleton export below stays byte-compatible (`new BusinessProfileRepository()`).
  constructor(supabase: SupabaseClient = supabaseServer) {
    this.supabase = supabase;
  }

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
