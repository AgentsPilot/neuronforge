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
 * Invoice address structure
 */
export interface InvoiceAddress {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
}

/**
 * Invoice settings for business profile
 */
export interface InvoiceSettings {
  invoice_company_name: string | null;
  invoice_address: InvoiceAddress;
  invoice_tax_id: string | null;
  invoice_bank_name: string | null;
  invoice_bank_account: string | null;
  invoice_bank_routing: string | null;
  invoice_payment_instructions: string | null;
  invoice_footer_text: string | null;
  invoice_number_prefix: string;
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

  // ---------------------------------------------------------------------------
  // Columns added by the feature branch's own migrations. main's interface was a
  // closed column list written before these landed; without them TypeScript
  // rejects the branch's own reads/writes. Nullability follows each migration.
  // ---------------------------------------------------------------------------

  // Business description (20260812_add_description_to_business_profiles)
  description: string | null;

  // Onboarding intelligence (20260812_add_onboarding_intelligence_columns)
  pain_points: string[] | null;
  goals: string[] | null;
  tools: string[] | null;
  payment_mode: string | null;
  online_presence_mode: string | null;
  needs_stripe_connect: boolean | null;
  extracted_data: Record<string, unknown> | null;

  // Invoice identity and bank details (20260806_add_invoice_profile_fields).
  // `invoice_address` is JSONB DEFAULT '{}' -- see InvoiceAddress above.
  invoice_company_name: string | null;
  invoice_address: InvoiceAddress | null;
  invoice_tax_id: string | null;
  invoice_bank_name: string | null;
  invoice_bank_account: string | null;
  invoice_bank_routing: string | null;
  invoice_payment_instructions: string | null;
  invoice_footer_text: string | null;
  invoice_number_prefix: string | null;
  invoice_logo_url: string | null;

  // Conversion layer -- short public link code (20260824_add_conversion_layer)
  user_code: string | null;

  // Branding. `show_logo_on_smart_links` is NOT NULL DEFAULT true, so it is not
  // nullable. `theme` is nullable JSONB -- NULL means the platform default.
  // No BusinessTheme type exists in the repo yet; typed structurally for now.
  // (20260827_business_logo_single_source / 20260902_business_theme)
  show_logo_on_smart_links: boolean;
  theme: Record<string, unknown> | null;

  // Payment collection method (20260831_collection_method)
  collection_method: string | null;

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
  // --- Feature-branch columns (see BusinessProfile above for provenance) ---
  description?: string | null;
  pain_points?: string[] | null;
  goals?: string[] | null;
  tools?: string[] | null;
  payment_mode?: string | null;
  online_presence_mode?: string | null;
  needs_stripe_connect?: boolean | null;
  extracted_data?: Record<string, unknown> | null;
  invoice_company_name?: string | null;
  invoice_address?: InvoiceAddress | null;
  invoice_tax_id?: string | null;
  invoice_bank_name?: string | null;
  invoice_bank_account?: string | null;
  invoice_bank_routing?: string | null;
  invoice_payment_instructions?: string | null;
  invoice_footer_text?: string | null;
  invoice_number_prefix?: string | null;
  invoice_logo_url?: string | null;
  user_code?: string | null;
  show_logo_on_smart_links?: boolean;
  theme?: Record<string, unknown> | null;
  collection_method?: string | null;
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

  // ==================== INVOICE SETTINGS METHODS ====================

  /**
   * Get invoice settings for a user
   */
  async getInvoiceSettings(userId: string): Promise<BusinessProfileRepositoryResult<InvoiceSettings>> {
    try {
      const { data, error } = await this.supabase
        .from('business_profiles')
        .select(`
          company_name,
          invoice_company_name,
          invoice_address,
          invoice_tax_id,
          invoice_bank_name,
          invoice_bank_account,
          invoice_bank_routing,
          invoice_payment_instructions,
          invoice_footer_text,
          invoice_number_prefix
        `)
        .eq('user_id', userId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // No profile found - return defaults
          return {
            data: {
              invoice_company_name: null,
              invoice_address: {},
              invoice_tax_id: null,
              invoice_bank_name: null,
              invoice_bank_account: null,
              invoice_bank_routing: null,
              invoice_payment_instructions: null,
              invoice_footer_text: null,
              invoice_number_prefix: 'INV'
            },
            error: null
          };
        }
        throw error;
      }

      const settings: InvoiceSettings = {
        // The business already told us its name once. Presenting an empty box
        // asks for it again and gets a slightly different answer — an account
        // here ended up invoicing as "בית הספר הבינלאומי חהורות" against a
        // profile reading "הבית הספר הבינלאומי להורות", and the invoice is the
        // document a client keeps.
        //
        // Only a default: an invoice name that is deliberately different — a
        // registered legal entity behind a trading name — is stored and wins.
        invoice_company_name: data.invoice_company_name || data.company_name || null,
        invoice_address: (data.invoice_address as InvoiceAddress) || {},
        invoice_tax_id: data.invoice_tax_id,
        invoice_bank_name: data.invoice_bank_name,
        invoice_bank_account: data.invoice_bank_account,
        invoice_bank_routing: data.invoice_bank_routing,
        invoice_payment_instructions: data.invoice_payment_instructions,
        invoice_footer_text: data.invoice_footer_text,
        invoice_number_prefix: data.invoice_number_prefix || 'INV'
      };

      logger.debug({ userId }, 'Retrieved invoice settings');
      return { data: settings, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to get invoice settings');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Update the business's branding.
   *
   * The logo is not an invoice setting, a website setting or a booking-page
   * setting: it is a property of the business that all of them read. This is
   * the one path that writes it. Fields left undefined are not touched, so
   * saving one of them cannot blank the other — which is precisely how the
   * invoice-settings save used to wipe the logo on every write.
   */
  async updateBranding(
    userId: string,
    branding: {
      logo_url?: string | null;
      show_logo_on_smart_links?: boolean;
      /** Colours and fonts for every public surface, not just the website. */
      theme?: Record<string, unknown> | null;
    }
  ): Promise<BusinessProfileRepositoryResult<true>> {
    try {
      const updateData: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };

      if (branding.logo_url !== undefined) updateData.logo_url = branding.logo_url;
      if (branding.show_logo_on_smart_links !== undefined) {
        updateData.show_logo_on_smart_links = branding.show_logo_on_smart_links;
      }
      if (branding.theme !== undefined) updateData.theme = branding.theme;

      const { error } = await this.supabase
        .from('business_profiles')
        .update(updateData)
        .eq('user_id', userId);

      if (error) throw error;

      logger.info({ userId, fields: Object.keys(branding) }, 'Business branding updated');
      return { data: true, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to update business branding');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Read the business's branding.
   */
  async getBranding(
    userId: string
  ): Promise<BusinessProfileRepositoryResult<{ logo_url: string | null; show_logo_on_smart_links: boolean }>> {
    try {
      const { data, error } = await this.supabase
        .from('business_profiles')
        .select('logo_url, show_logo_on_smart_links')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) throw error;

      return {
        data: {
          logo_url: data?.logo_url ?? null,
          // A business with no profile row yet is treated as opted in, matching
          // the column default.
          show_logo_on_smart_links: data?.show_logo_on_smart_links ?? true,
        },
        error: null,
      };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to read business branding');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Update invoice settings for a user
   */
  async updateInvoiceSettings(
    userId: string,
    settings: Partial<InvoiceSettings>
  ): Promise<BusinessProfileRepositoryResult<InvoiceSettings>> {
    try {
      logger.info({ userId, fieldsUpdated: Object.keys(settings) }, 'Updating invoice settings');

      // Prepare update object
      const updateData: Record<string, unknown> = {
        updated_at: new Date().toISOString()
      };

      // Map settings to database columns
      if (settings.invoice_company_name !== undefined) {
        updateData.invoice_company_name = settings.invoice_company_name;
      }
      if (settings.invoice_address !== undefined) {
        updateData.invoice_address = settings.invoice_address;
      }
      if (settings.invoice_tax_id !== undefined) {
        updateData.invoice_tax_id = settings.invoice_tax_id;
      }
      if (settings.invoice_bank_name !== undefined) {
        updateData.invoice_bank_name = settings.invoice_bank_name;
      }
      if (settings.invoice_bank_account !== undefined) {
        updateData.invoice_bank_account = settings.invoice_bank_account;
      }
      if (settings.invoice_bank_routing !== undefined) {
        updateData.invoice_bank_routing = settings.invoice_bank_routing;
      }
      if (settings.invoice_payment_instructions !== undefined) {
        updateData.invoice_payment_instructions = settings.invoice_payment_instructions;
      }
      if (settings.invoice_footer_text !== undefined) {
        updateData.invoice_footer_text = settings.invoice_footer_text;
      }
      if (settings.invoice_number_prefix !== undefined) {
        updateData.invoice_number_prefix = settings.invoice_number_prefix;
      }
      const { error } = await this.supabase
        .from('business_profiles')
        .update(updateData)
        .eq('user_id', userId);

      if (error) throw error;

      // Fetch updated settings
      const result = await this.getInvoiceSettings(userId);

      logger.info({ userId }, 'Invoice settings updated');
      return result;
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to update invoice settings');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get invoice settings with business profile info for invoice generation
   * Includes vertical for template selection
   */
  async getInvoiceSettingsWithProfile(userId: string): Promise<BusinessProfileRepositoryResult<
    InvoiceSettings & {
      vertical: string | null;
      company_name: string | null;
      language: string | null;
      /** The business's logo. Not an invoice setting — invoices only render it. */
      logo_url: string | null;
    }
  >> {
    try {
      const { data, error } = await this.supabase
        .from('business_profiles')
        .select(`
          vertical,
          company_name,
          language,
          invoice_company_name,
          invoice_address,
          invoice_tax_id,
          invoice_bank_name,
          invoice_bank_account,
          invoice_bank_routing,
          invoice_payment_instructions,
          invoice_footer_text,
          invoice_number_prefix,
          logo_url
        `)
        .eq('user_id', userId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return { data: null, error: new Error('Business profile not found') };
        }
        throw error;
      }

      const result = {
        vertical: data.vertical,
        company_name: data.company_name,
        language: data.language,
        // Same default the settings screen shows, applied here too — this is
        // the path the PDF and the emailed invoice read, and a business that
        // never opened the invoice screen was sending documents with no name
        // on them while its profile had one all along.
        invoice_company_name: data.invoice_company_name || data.company_name || null,
        invoice_address: (data.invoice_address as InvoiceAddress) || {},
        invoice_tax_id: data.invoice_tax_id,
        invoice_bank_name: data.invoice_bank_name,
        invoice_bank_account: data.invoice_bank_account,
        invoice_bank_routing: data.invoice_bank_routing,
        invoice_payment_instructions: data.invoice_payment_instructions,
        invoice_footer_text: data.invoice_footer_text,
        invoice_number_prefix: data.invoice_number_prefix || 'INV',
        logo_url: data.logo_url
      };

      logger.debug({ userId, vertical: result.vertical }, 'Retrieved invoice settings with profile');
      return { data: result, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to get invoice settings with profile');
      return { data: null, error: error as Error };
    }
  }

  // ==================== USER CODE METHODS (for Conversion Layer) ====================

  /**
   * Get user's conversion code (user_code) for public pages
   * If not set, generates one automatically
   */
  async getUserCode(userId: string): Promise<BusinessProfileRepositoryResult<string>> {
    try {
      const { data, error } = await this.supabase
        .from('business_profiles')
        .select('user_code')
        .eq('user_id', userId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // No profile found
          return { data: null, error: new Error('Business profile not found') };
        }
        throw error;
      }

      // If user_code exists, return it
      if (data.user_code) {
        return { data: data.user_code, error: null };
      }

      // Generate new user_code if not set
      const newCode = await this.generateAndSetUserCode(userId);
      return newCode;
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to get user code');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Generate and set a new user_code for a user
   * Used when user doesn't have one yet
   */
  private async generateAndSetUserCode(userId: string): Promise<BusinessProfileRepositoryResult<string>> {
    try {
      const newCode = this.generateUserCode(6);

      const { data, error } = await this.supabase
        .from('business_profiles')
        .update({ user_code: newCode })
        .eq('user_id', userId)
        .select('user_code')
        .single();

      if (error) {
        // If duplicate code, try again with longer code
        if (error.code === '23505') {
          const longerCode = this.generateUserCode(8);
          const retryResult = await this.supabase
            .from('business_profiles')
            .update({ user_code: longerCode })
            .eq('user_id', userId)
            .select('user_code')
            .single();

          if (retryResult.error) throw retryResult.error;
          return { data: retryResult.data.user_code, error: null };
        }
        throw error;
      }

      logger.info({ userId, userCode: data.user_code }, 'Generated user code');
      return { data: data.user_code, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to generate user code');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Generate a random alphanumeric code
   */
  private generateUserCode(length: number): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * Find business profile by user_code (for public conversion pages)
   * This is used by public endpoints that need to load user's branding/services
   */
  async findByUserCode(userCode: string): Promise<BusinessProfileRepositoryResult<BusinessProfile>> {
    try {
      logger.debug({ userCode }, 'Finding business profile by user code');

      const { data, error } = await this.supabase
        .from('business_profiles')
        .select('*')
        .eq('user_code', userCode)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          logger.debug({ userCode }, 'No business profile found for user code');
          return { data: null, error: null };
        }
        throw error;
      }

      logger.debug({ userCode, userId: data.user_id }, 'Business profile found by user code');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, userCode }, 'Failed to find business profile by user code');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get conversion page config for a user (branding, services, journey)
   * Used by public conversion pages to render user's branded pages
   */
  async getConversionConfig(userCode: string): Promise<BusinessProfileRepositoryResult<{
    userId: string;
    userCode: string;
    companyName: string | null;
    logoUrl: string | null;
    vertical: string | null;
    language: string | null;
    currency: string | null;
    primaryColor: string | null;
    customerJourney: string[] | null;
    /** How this business collects — decides whether a client is asked to pay
     *  at booking, or invoiced afterwards. Null on accounts that predate the
     *  question. */
    collectionMethod: string | null;
  }>> {
    try {
      // Note: Only selecting columns that exist in the schema
      // currency, primary_color, customer_journey are not in the DB yet - using defaults
      const { data, error } = await this.supabase
        .from('business_profiles')
        .select(`
          user_id,
          user_code,
          company_name,
          logo_url,
          show_logo_on_smart_links,
          vertical,
          language,
          collection_method
        `)
        .eq('user_code', userCode)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return { data: null, error: new Error('Invalid user code') };
        }
        throw error;
      }

      const config = {
        userId: data.user_id,
        userCode: data.user_code,
        companyName: data.company_name,
        // Public pages honour the business's own choice about being branded.
        logoUrl: data.show_logo_on_smart_links === false ? null : data.logo_url,
        vertical: data.vertical,
        language: data.language,
        currency: null, // Not in DB yet - API will default to 'USD'
        primaryColor: null, // Not in DB yet - API will default to '#4F6EF7'
        customerJourney: null, // Not in DB yet - API will default to standard journey
        collectionMethod: data.collection_method ?? null
      };

      logger.debug({ userCode, companyName: config.companyName }, 'Retrieved conversion config');
      return { data: config, error: null };
    } catch (error) {
      logger.error({ err: error, userCode }, 'Failed to get conversion config');
      return { data: null, error: error as Error };
    }
  }
}

// Singleton export
export const businessProfileRepository = new BusinessProfileRepository();
