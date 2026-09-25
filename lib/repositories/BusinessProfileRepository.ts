/**
 * BusinessProfileRepository
 * Repository for business_profiles table
 * Handles CRUD operations for user business profiles
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import type { DocumentType } from '@/lib/payments/documentType';

const logger = createLogger({ service: 'BusinessProfileRepository' });

export interface BusinessProfileRepositoryResult<T> {
  data: T | null;
  error: Error | null;
}

/**
 * What an admin screen may know about a business: its name and vertical
 * (admin reorganisation slice 2b). Everything else in the row can be owner text.
 */
export interface BusinessAdminIdentity {
  user_id: string;
  company_name: string | null;
  vertical: string;
  sub_vertical: string | null;
}

/** The only columns the admin identity reads select. Exported for tests. */
export const BUSINESS_ADMIN_IDENTITY_COLUMNS = 'user_id, company_name, vertical, sub_vertical';

/** Ids per `.in()` request in `findAdminIdentitiesByUserIds`. */
export const ADMIN_IDENTITY_CHUNK = 200;

/** Most businesses `searchForAdmin` returns. */
export const BUSINESS_SEARCH_MAX_LIMIT = 50;

/**
 * Escape text for use inside an ILIKE pattern: `\` first, then `%` and `_`, so
 * they match literally. (`*` cannot be escaped through PostgREST; for
 * user-typed search text use `ilikeContainsPattern` + `matchesLiterally`.)
 */
export function escapeIlikePattern(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * A "contains" ILIKE pattern for user-typed search text, with every character
 * taken literally (admin reorganisation slice 2, QA E-1).
 *
 * PostgREST rewrites EVERY `*` in a like/ilike operand to `%` before Postgres
 * sees it, and there is no escape for that, so a search for `*` used to match
 * every row. A `*` is therefore sent as `_` (exactly one character, which
 * includes a literal `*`), and the caller drops the extra rows with
 * `matchesLiterally`. `\`, `%` and `_` are escaped as before.
 */
export function ilikeContainsPattern(text: string): string {
  return `%${escapeIlikePattern(text).replace(/\*/g, '_')}%`;
}

/**
 * The literal, case-insensitive "contains" test that `ilikeContainsPattern`
 * approximates on the server. Only needed when the text contains `*`.
 */
export function matchesLiterally(value: string | null | undefined, text: string): boolean {
  return typeof value === 'string' && value.toLowerCase().includes(text.toLowerCase());
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
  /**
   * The tax the business says is already inside its prices.
   *
   * Display only — the platform never adds tax to a price, decides whether tax
   * applies, or looks up a rate. These carry what the business typed so the
   * invoice, its PDF and the pay page can repeat it.
   */
  invoice_prices_include_tax: boolean;
  invoice_tax_rate: number | null;
  invoice_tax_label: string | null;
  /**
   * What the client-facing document is titled: receipt, invoice or tax_invoice.
   *
   * NULL follows the derived default in `lib/payments/documentType`. Kept
   * nullable deliberately — storing the derived value would freeze it, so a
   * business that registers for VAT later would go on issuing receipts.
   */
  invoice_document_type: DocumentType | null;
  /**
   * How long the client has to pay, in days, as printed on the document.
   *
   * Not nullable here even though the column is: both readers below apply
   * `?? 30`, so what leaves this repository is always a number and a caller
   * never has to decide what an absent payment window means.
   *
   * It was missing from this interface while the column, the SELECT, the read
   * mapping and the write all carried it — so every one of the four sites that
   * touch it was a type error, and the build ignores type errors
   * (`next.config.js`), which is why it shipped anyway.
   */
  invoice_payment_terms_days: number;
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
 * dismissed_setup_steps (20260802), template_id (20260903), subdomain (20260904).
 * Nullability follows the DB: only id/user_id/
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
  /** Days to pay for invoices raised automatically. 0 = due on receipt. */
  invoice_payment_terms_days: number | null;
  invoice_logo_url: string | null;

  // Conversion layer -- short public link code (20260824_add_conversion_layer)
  user_code: string | null;

  // Branding. `show_logo_on_smart_links` is NOT NULL DEFAULT true, so it is not
  // nullable. `theme` is nullable JSONB -- NULL means the platform default.
  // No BusinessTheme type exists in the repo yet; typed structurally for now.
  // (20260827_business_logo_single_source / 20260902_business_theme)
  show_logo_on_smart_links: boolean;
  theme: Record<string, unknown> | null;

  // Notification preferences. NOT NULL DEFAULT false, so not nullable.
  // (20260911_daily_briefing)
  daily_briefing_email_enabled: boolean;

  // Payment collection method (20260831_collection_method)
  collection_method: string | null;

  // Which website template the business is wearing, and the one subdomain every
  // surface it publishes lives under. Both nullable text with no default -- a
  // business that has chosen neither has NULL.
  // (20260903_business_template / 20260904_business_subdomain)
  template_id: string | null;
  subdomain: string | null;

  // Timestamps
  created_at: string | null;
  updated_at: string | null;

  /**
   * The business's DEFAULT currency. Real since
   * 20261004_business_default_currency.sql.
   *
   * Nullable with no database default, and that is load-bearing: NULL means
   * NOT CHOSEN, which the readiness card needs in order to ask. A DEFAULT would
   * make "never answered" indistinguishable from "answered UTC" — the exact
   * ambiguity `user_preferences.timezone` suffers from below.
   *
   * Never a constraint on a service: `scheduling_services.currency` stays the
   * authority for what a client is charged, so a business in Israel can price a
   * US client in USD.
   */
  currency?: string | null;

  // --- Not backed by a physical column ---
  // No migration defines `timezone` or `contact_email` on business_profiles.
  // The authoritative timezone is `user_preferences.timezone`; reading it here
  // returns undefined and silently means UTC, and — worse — PostgREST rejects
  // the WHOLE select for one unknown column, which is how a business with a
  // full diary once showed no times at all.
  //
  // Existing consumers read them defensively with a fallback (ContextBuilder,
  // SafeExecutionLayer, BookingEmailService). Typed here as optional, read-only
  // extras to preserve that behavior; deliberately absent from Insert/Update so
  // nobody writes a non-existent column (cf. the documented `tools` PGRST204
  // bug in the onboarding build route).
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
  invoice_payment_terms_days?: number | null;
  invoice_logo_url?: string | null;
  user_code?: string | null;
  show_logo_on_smart_links?: boolean;
  theme?: Record<string, unknown> | null;
  daily_briefing_email_enabled?: boolean;
  collection_method?: string | null;
  template_id?: string | null;
  subdomain?: string | null;
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
   * Delete the business, and with it everything the business owned.
   *
   * This is not an ordinary delete. Every table a business owns carries a
   * foreign key to this row with ON DELETE CASCADE
   * (supabase/migrations/20260916_business_data_ownership.sql), so removing it
   * removes the CRM, the bookings, the invoices, the website, the insights and
   * the rest — 50-odd tables — in one statement. There is no undo.
   *
   * It exists because replacing a business used to mean upserting over the
   * profile and leaving everything else in place, so the next business silently
   * inherited the previous one's pipeline, capabilities and links. The fix is
   * to make replacement an actual replacement.
   *
   * Only call this where erasing a business is the INTENT. The count of what
   * went is returned so a caller can log it rather than guess.
   */
  async deleteByUserId(userId: string): Promise<BusinessProfileRepositoryResult<{ deleted: boolean }>> {
    try {
      logger.warn({ userId }, 'Deleting business profile — cascade will remove all business data');

      const { error, count } = await this.supabase
        .from('business_profiles')
        .delete({ count: 'exact' })
        .eq('user_id', userId);

      if (error) throw error;

      const deleted = (count ?? 0) > 0;
      logger.warn({ userId, deleted }, 'Business profile deleted');
      return { data: { deleted }, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to delete business profile');
      return { data: null, error: error as Error };
    }
  }

  /**
   * How many days this business gives clients to pay, as stored.
   *
   * Returns the raw column — `null` when the business has never set one, and
   * NOT defaulted to 30 here. The caller pairs it with a per-proposal override
   * (`resolveTermsDays`), and that function distinguishes "no answer" from an
   * answer of 30; defaulting on the way out would collapse the two and make a
   * business-level default indistinguishable from a deliberate choice.
   *
   * Separate from `getInvoiceSettings` on purpose: that reads seventeen columns
   * to render a settings form, and a caller that needs one number should not
   * pay for the rest.
   */
  async getPaymentTermsDays(userId: string): Promise<BusinessProfileRepositoryResult<number | null>> {
    try {
      const { data, error } = await this.supabase
        .from('business_profiles')
        .select('invoice_payment_terms_days')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) throw error;

      return { data: data?.invoice_payment_terms_days ?? null, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to read payment terms');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Business picker for the admin LLM usage report (Layer 1.1 FR-2).
   *
   * INTENTIONAL CROSS-ACCOUNT READ (CLAUDE.md Rule 4): there is no user_id
   * filter by design. The only caller is
   * `GET /api/admin/business-os/llm-usage/businesses`, which checks admin rights
   * through AdminAccessService before this runs.
   *
   * Selects ONLY `user_id, company_name`. The search goes through `.ilike()` (a
   * single operator argument, so commas and parentheses are harmless) with
   * `\`, `%` and `_` escaped; it is never built into an `.or()` string.
   * PostgREST reads `*` as a wildcard and it cannot be escaped, so a `*` is
   * sent as a one-character wildcard and the rows are then filtered literally
   * (QA E-1; before that a `*` widened the search to every business).
   */
  async searchForAdmin(
    search: string | undefined,
    limit: number
  ): Promise<BusinessProfileRepositoryResult<Array<{ user_id: string; company_name: string | null }>>> {
    try {
      const cappedLimit = Math.min(Math.max(Math.trunc(limit) || 1, 1), BUSINESS_SEARCH_MAX_LIMIT);

      let query = this.supabase.from('business_profiles').select('user_id, company_name');

      if (search) {
        query = query.ilike('company_name', ilikeContainsPattern(search));
      }

      const { data, error } = await query
        .order('company_name', { ascending: true, nullsFirst: false })
        .limit(cappedLimit);

      if (error) throw error;

      let rows = (data ?? []) as Array<{ user_id: string; company_name: string | null }>;
      if (search && search.includes('*')) rows = rows.filter((row) => matchesLiterally(row.company_name, search));

      // Search text and names are not logged: a search is usually a business name.
      logger.debug({ hasSearch: !!search, results: rows.length }, 'Admin business search');
      return { data: rows, error: null };
    } catch (error) {
      logger.error({ err: error }, 'Admin business search failed');
      return { data: null, error: error as Error };
    }
  }

  /**
   * ADMIN ONLY (admin reorganisation slice 2b). The business's identity, and
   * nothing else: name and vertical. Never `select('*')`, because the full row
   * carries owner-written text an admin screen must not show.
   *
   * Callers: `app/api/admin/**` only, after `requireAdmin` (source guard in
   * lib/repositories/__tests__/adminReadMethods.guard.test.ts). Still scoped by
   * `.eq('user_id', …)`: the account is admin-selected, not the caller.
   * `data: null, error: null` when the account has no business profile.
   */
  async findAdminIdentity(userId: string): Promise<BusinessProfileRepositoryResult<BusinessAdminIdentity>> {
    try {
      const { data, error } = await this.supabase
        .from('business_profiles')
        .select(BUSINESS_ADMIN_IDENTITY_COLUMNS)
        .eq('user_id', userId)
        .maybeSingle();

      if (error) throw error;
      return { data: (data as BusinessAdminIdentity | null) ?? null, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Admin business identity read failed');
      return { data: null, error: error as Error };
    }
  }

  /**
   * ADMIN ONLY. The same identity for many accounts at once (the Businesses
   * list shows each row's business name). One `.in()` per chunk of
   * ADMIN_IDENTITY_CHUNK ids, never one read per row, and chunked so the
   * request URL stays short. Accounts without a profile are simply absent.
   * Same callers and guard as `findAdminIdentity`.
   */
  async findAdminIdentitiesByUserIds(
    userIds: readonly string[]
  ): Promise<BusinessProfileRepositoryResult<BusinessAdminIdentity[]>> {
    try {
      const unique = [...new Set(userIds)];
      const found: BusinessAdminIdentity[] = [];
      for (let i = 0; i < unique.length; i += ADMIN_IDENTITY_CHUNK) {
        const chunk = unique.slice(i, i + ADMIN_IDENTITY_CHUNK);
        const { data, error } = await this.supabase
          .from('business_profiles')
          .select(BUSINESS_ADMIN_IDENTITY_COLUMNS)
          .in('user_id', chunk);
        if (error) throw error;
        found.push(...((data ?? []) as BusinessAdminIdentity[]));
      }
      // Counts only: business names are not logged.
      logger.debug({ requested: unique.length, found: found.length }, 'Admin business identities read');
      return { data: found, error: null };
    } catch (error) {
      logger.error({ err: error, requested: userIds.length }, 'Admin business identities read failed');
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
          invoice_prices_include_tax,
          invoice_tax_rate,
          invoice_tax_label,
          invoice_document_type,
          invoice_number_prefix,
          invoice_payment_terms_days
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
              invoice_prices_include_tax: false,
              invoice_tax_rate: null,
              invoice_tax_label: null,
              invoice_document_type: null,
              invoice_number_prefix: 'INV',
              invoice_payment_terms_days: 30
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
        invoice_prices_include_tax: data.invoice_prices_include_tax ?? false,
        invoice_tax_rate: data.invoice_tax_rate ?? null,
        invoice_tax_label: data.invoice_tax_label ?? null,
        invoice_document_type: (data.invoice_document_type as DocumentType) ?? null,
        invoice_number_prefix: data.invoice_number_prefix || 'INV',
        /*
         * `??`, not `||`: zero is "due on receipt", a real setting, and `||`
         * would swap it for the default every time the page loaded.
         *
         * This mapping is why the field appeared not to save — the column was
         * added to the SELECT above but never copied out here, so the value
         * reached the repository and was dropped on the way to the form. The
         * write worked; the read never returned it.
         */
        invoice_payment_terms_days: data.invoice_payment_terms_days ?? 30
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
   * What the platform is allowed to send the owner, unprompted.
   *
   * Its own method for the same reason as the two beside it — one save must not
   * be able to blank another — and because these are the owner's preferences
   * about being contacted, not facts about the business.
   *
   * Only fields explicitly supplied are written, so a caller that knows about
   * one preference cannot clear another it has never heard of.
   */
  async updateNotificationPreferences(
    userId: string,
    preferences: {
      daily_briefing_email_enabled?: boolean;
      lead_alert_email_enabled?: boolean;
      lead_autosend_enabled?: boolean;
    }
  ): Promise<BusinessProfileRepositoryResult<true>> {
    try {
      const updateData: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };

      if (preferences.daily_briefing_email_enabled !== undefined) {
        updateData.daily_briefing_email_enabled = preferences.daily_briefing_email_enabled;
      }

      if (preferences.lead_alert_email_enabled !== undefined) {
        updateData.lead_alert_email_enabled = preferences.lead_alert_email_enabled;
      }

      if (preferences.lead_autosend_enabled !== undefined) {
        updateData.lead_autosend_enabled = preferences.lead_autosend_enabled;
      }

      const { error } = await this.supabase
        .from('business_profiles')
        .update(updateData)
        .eq('user_id', userId);

      if (error) throw error;

      logger.info(
        { userId, fields: Object.keys(preferences) },
        'Notification preferences updated'
      );
      return { data: true, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to update notification preferences');
      return { data: null, error: error as Error };
    }
  }

  /**
   * The contact details a business publishes to its own clients.
   *
   * Deliberately not folded into `updateBranding`. A phone number is not a
   * brand asset — it is how a client reaches the business — and keeping the two
   * paths apart is what stops one save blanking the other, which is the exact
   * failure that made the invoice-settings screen wipe the logo on every write.
   *
   * `null` clears the number, which is why the field is nullable rather than
   * merely optional; `undefined` leaves it untouched.
   */
  async updateContactDetails(
    userId: string,
    contact: { phone?: string | null; email?: string | null; address?: string | null }
  ): Promise<BusinessProfileRepositoryResult<true>> {
    try {
      const updateData: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };

      // An empty string is the form's way of saying "cleared"; store null so the
      // public pages see one absent value rather than two. A field left
      // undefined is not written at all.
      for (const field of ['phone', 'email', 'address'] as const) {
        const value = contact[field];
        if (value !== undefined) {
          updateData[field] = value?.trim() ? value.trim() : null;
        }
      }

      const { error } = await this.supabase
        .from('business_profiles')
        .update(updateData)
        .eq('user_id', userId);

      if (error) throw error;

      logger.info({ userId, fields: Object.keys(contact) }, 'Business contact details updated');
      return { data: true, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to update business contact details');
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
      if (settings.invoice_prices_include_tax !== undefined) {
        updateData.invoice_prices_include_tax = settings.invoice_prices_include_tax;
      }
      if (settings.invoice_tax_rate !== undefined) {
        updateData.invoice_tax_rate = settings.invoice_tax_rate;
      }
      if (settings.invoice_tax_label !== undefined) {
        updateData.invoice_tax_label = settings.invoice_tax_label;
      }
      if (settings.invoice_document_type !== undefined) {
        updateData.invoice_document_type = settings.invoice_document_type;
      }
      if (settings.invoice_number_prefix !== undefined) {
        updateData.invoice_number_prefix = settings.invoice_number_prefix;
      }
      if (settings.invoice_payment_terms_days !== undefined) {
        updateData.invoice_payment_terms_days = settings.invoice_payment_terms_days;
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
          invoice_prices_include_tax,
          invoice_tax_rate,
          invoice_tax_label,
          invoice_document_type,
          invoice_number_prefix,
          invoice_payment_terms_days,
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
        invoice_prices_include_tax: data.invoice_prices_include_tax ?? false,
        invoice_tax_rate: data.invoice_tax_rate ?? null,
        invoice_tax_label: data.invoice_tax_label ?? null,
        invoice_document_type: (data.invoice_document_type as DocumentType) ?? null,
        invoice_number_prefix: data.invoice_number_prefix || 'INV',
        /*
         * Carried here as well as in `getInvoiceSettings`.
         *
         * No caller reads it from this method today — the due date is resolved
         * when the invoice is created and stored on the invoice row, which is
         * what the PDF and the emailed copy read. It is mapped anyway because
         * the return type promises a whole `InvoiceSettings`, and a field that
         * is selected but not copied out is exactly the shape of the bug
         * described above: the value arrives and is dropped on the way out,
         * with nothing to show for it.
         */
        invoice_payment_terms_days: data.invoice_payment_terms_days ?? 30,
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
      /*
       * Only columns that exist. PostgREST rejects the WHOLE select for one
       * unknown name, so a stale column here does not degrade the result — it
       * returns nothing at all.
       *
       * `currency` is real as of 20261004_business_default_currency.sql;
       * `customer_journey` still is not.
       */
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
          currency,
          collection_method,
          theme
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
        // The column exists now. Null still flows through where a business has
        // not chosen one, and the caller's own fallback handles that — but a
        // business that HAS chosen no longer has its answer thrown away here.
        currency: data.currency ?? null,
        /*
         * The business's own colour, from the template it chose.
         *
         * This was hardcoded `null` — "not in DB yet" — so every smart link's
         * contact and booking page rendered in the platform's default blue no
         * matter what template the business was on. The column it was waiting
         * for does exist: `theme`, the same one the invoice PDF and every
         * transactional email already read. A business that has chosen nothing
         * still falls through to the default, as before.
         */
        primaryColor:
          ((data as { theme?: { colors?: { primary?: string } } | null }).theme?.colors?.primary) ?? null,
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
