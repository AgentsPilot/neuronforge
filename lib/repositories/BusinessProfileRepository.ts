/**
 * BusinessProfileRepository
 * Repository for business_profiles table
 * Handles CRUD operations for user business profiles
 */

import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import type { Database } from '@/types/database';
import type { DocumentType } from '@/lib/payments/documentType';

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
              invoice_prices_include_tax: false,
              invoice_tax_rate: null,
              invoice_tax_label: null,
              invoice_document_type: null,
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
        invoice_prices_include_tax: data.invoice_prices_include_tax ?? false,
        invoice_tax_rate: data.invoice_tax_rate ?? null,
        invoice_tax_label: data.invoice_tax_label ?? null,
        invoice_document_type: (data.invoice_document_type as DocumentType) ?? null,
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
      // currency and customer_journey are not in the DB yet - using defaults
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
        currency: null, // Not in DB yet - API will default to 'USD'
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
