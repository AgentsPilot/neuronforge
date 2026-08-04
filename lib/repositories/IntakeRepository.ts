/**
 * IntakeRepository
 * Repository for intake_form_templates and user_intake_settings tables
 * Handles CRUD operations for intake forms configuration
 */

import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ service: 'IntakeRepository' });

// ============================================
// Types
// ============================================

export interface IntakeFieldOption {
  value: string;
  label_en: string;
  label_es: string;
  label_he: string;
}

export interface IntakeField {
  key: string;
  type: 'text' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'tel' | 'email';
  label_en: string;
  label_es: string;
  label_he: string;
  required: boolean;
  options?: IntakeFieldOption[];
  placeholder_en?: string;
  placeholder_es?: string;
  placeholder_he?: string;
}

export interface IntakeFormTemplate {
  id: string;
  template_key: string;
  vertical: string;
  name_en: string;
  name_es: string;
  name_he: string;
  description_en: string | null;
  description_es: string | null;
  description_he: string | null;
  fields: IntakeField[];
  is_default: boolean;
  display_order: number;
  created_at: string;
}

export interface UserIntakeSettings {
  id: string;
  user_id: string;
  template_id: string | null;
  is_enabled: boolean;
  collect_during_booking: boolean;
  send_after_booking: boolean;
  created_at: string;
  updated_at: string;
}

export interface IntakeRepositoryResult<T> {
  data: T | null;
  error: Error | null;
}

// ============================================
// Repository Class
// ============================================

export class IntakeRepository {
  private supabase = supabaseServer;

  // ============================================
  // Template Methods
  // ============================================

  /**
   * List all templates for a given vertical
   */
  async listTemplatesByVertical(vertical: string): Promise<IntakeRepositoryResult<IntakeFormTemplate[]>> {
    try {
      logger.info({ vertical }, 'Listing intake templates by vertical');

      const { data, error } = await this.supabase
        .from('intake_form_templates')
        .select('*')
        .eq('vertical', vertical)
        .order('display_order', { ascending: true });

      if (error) throw error;

      logger.info({ vertical, count: data?.length || 0 }, 'Templates found');
      return { data: data as IntakeFormTemplate[], error: null };
    } catch (error) {
      logger.error({ err: error, vertical }, 'Failed to list templates');
      return { data: null, error: error as Error };
    }
  }

  /**
   * List all available templates (for admin or when vertical is unknown)
   */
  async listAllTemplates(): Promise<IntakeRepositoryResult<IntakeFormTemplate[]>> {
    try {
      logger.info('Listing all intake templates');

      const { data, error } = await this.supabase
        .from('intake_form_templates')
        .select('*')
        .order('vertical', { ascending: true })
        .order('display_order', { ascending: true });

      if (error) throw error;

      return { data: data as IntakeFormTemplate[], error: null };
    } catch (error) {
      logger.error({ err: error }, 'Failed to list all templates');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get a template by ID
   */
  async getTemplateById(templateId: string): Promise<IntakeRepositoryResult<IntakeFormTemplate>> {
    try {
      logger.info({ templateId }, 'Getting template by ID');

      const { data, error } = await this.supabase
        .from('intake_form_templates')
        .select('*')
        .eq('id', templateId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          logger.debug({ templateId }, 'Template not found');
          return { data: null, error: null };
        }
        throw error;
      }

      return { data: data as IntakeFormTemplate, error: null };
    } catch (error) {
      logger.error({ err: error, templateId }, 'Failed to get template');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get a template by key
   */
  async getTemplateByKey(templateKey: string): Promise<IntakeRepositoryResult<IntakeFormTemplate>> {
    try {
      logger.info({ templateKey }, 'Getting template by key');

      const { data, error } = await this.supabase
        .from('intake_form_templates')
        .select('*')
        .eq('template_key', templateKey)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          logger.debug({ templateKey }, 'Template not found');
          return { data: null, error: null };
        }
        throw error;
      }

      return { data: data as IntakeFormTemplate, error: null };
    } catch (error) {
      logger.error({ err: error, templateKey }, 'Failed to get template');
      return { data: null, error: error as Error };
    }
  }

  // ============================================
  // User Settings Methods
  // ============================================

  /**
   * Get user's intake settings
   */
  async getSettings(userId: string): Promise<IntakeRepositoryResult<UserIntakeSettings>> {
    try {
      logger.info({ userId }, 'Getting user intake settings');

      const { data, error } = await this.supabase
        .from('user_intake_settings')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // No settings found - this is expected for new users
          logger.debug({ userId }, 'No intake settings found for user');
          return { data: null, error: null };
        }
        throw error;
      }

      logger.info({ userId, settingsId: data.id }, 'Intake settings found');
      return { data: data as UserIntakeSettings, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to get intake settings');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get user's intake settings with template details
   */
  async getSettingsWithTemplate(userId: string): Promise<IntakeRepositoryResult<UserIntakeSettings & { template: IntakeFormTemplate | null }>> {
    try {
      logger.info({ userId }, 'Getting user intake settings with template');

      const { data, error } = await this.supabase
        .from('user_intake_settings')
        .select(`
          *,
          template:intake_form_templates(*)
        `)
        .eq('user_id', userId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          logger.debug({ userId }, 'No intake settings found for user');
          return { data: null, error: null };
        }
        throw error;
      }

      return {
        data: {
          ...data,
          template: data.template as IntakeFormTemplate | null
        } as UserIntakeSettings & { template: IntakeFormTemplate | null },
        error: null
      };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to get intake settings with template');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Create user intake settings
   */
  async createSettings(
    userId: string,
    settings: Partial<Omit<UserIntakeSettings, 'id' | 'user_id' | 'created_at' | 'updated_at'>>
  ): Promise<IntakeRepositoryResult<UserIntakeSettings>> {
    try {
      logger.info({ userId }, 'Creating user intake settings');

      const { data, error } = await this.supabase
        .from('user_intake_settings')
        .insert({
          user_id: userId,
          ...settings
        })
        .select()
        .single();

      if (error) throw error;

      logger.info({ userId, settingsId: data.id }, 'Intake settings created');
      return { data: data as UserIntakeSettings, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to create intake settings');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Update user intake settings
   */
  async updateSettings(
    userId: string,
    settings: Partial<Omit<UserIntakeSettings, 'id' | 'user_id' | 'created_at' | 'updated_at'>>
  ): Promise<IntakeRepositoryResult<UserIntakeSettings>> {
    try {
      logger.info({ userId }, 'Updating user intake settings');

      const { data, error } = await this.supabase
        .from('user_intake_settings')
        .update({
          ...settings,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;

      logger.info({ userId, settingsId: data.id }, 'Intake settings updated');
      return { data: data as UserIntakeSettings, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to update intake settings');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Upsert user intake settings (create if doesn't exist, update if it does)
   */
  async upsertSettings(
    userId: string,
    settings: Partial<Omit<UserIntakeSettings, 'id' | 'user_id' | 'created_at' | 'updated_at'>>
  ): Promise<IntakeRepositoryResult<UserIntakeSettings>> {
    try {
      logger.info({ userId }, 'Upserting user intake settings');

      const { data, error } = await this.supabase
        .from('user_intake_settings')
        .upsert(
          {
            user_id: userId,
            ...settings,
            updated_at: new Date().toISOString()
          },
          { onConflict: 'user_id' }
        )
        .select()
        .single();

      if (error) throw error;

      logger.info({ userId, settingsId: data.id }, 'Intake settings upserted');
      return { data: data as UserIntakeSettings, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to upsert intake settings');
      return { data: null, error: error as Error };
    }
  }

  // ============================================
  // Booking Flow Methods
  // ============================================

  /**
   * Get the enabled template for a user (for booking flow)
   * Returns null if intake is disabled or no template is selected
   */
  async getEnabledTemplateForUser(userId: string): Promise<IntakeRepositoryResult<IntakeFormTemplate | null>> {
    try {
      logger.info({ userId }, 'Getting enabled intake template for user');

      // First get user settings
      const { data: settings, error: settingsError } = await this.supabase
        .from('user_intake_settings')
        .select('template_id, is_enabled, collect_during_booking')
        .eq('user_id', userId)
        .single();

      if (settingsError) {
        if (settingsError.code === 'PGRST116') {
          // No settings = intake not configured
          logger.debug({ userId }, 'No intake settings found');
          return { data: null, error: null };
        }
        throw settingsError;
      }

      // Check if intake is enabled and should be collected during booking
      if (!settings.is_enabled || !settings.collect_during_booking || !settings.template_id) {
        logger.debug({ userId }, 'Intake not enabled for booking flow');
        return { data: null, error: null };
      }

      // Get the template
      const { data: template, error: templateError } = await this.supabase
        .from('intake_form_templates')
        .select('*')
        .eq('id', settings.template_id)
        .single();

      if (templateError) {
        if (templateError.code === 'PGRST116') {
          logger.warn({ userId, templateId: settings.template_id }, 'Selected template not found');
          return { data: null, error: null };
        }
        throw templateError;
      }

      logger.info({ userId, templateKey: template.template_key }, 'Found enabled template for booking');
      return { data: template as IntakeFormTemplate, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to get enabled template');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Save intake responses to a booking
   */
  async saveIntakeResponses(
    bookingId: string,
    userId: string,
    templateId: string,
    templateKey: string,
    responses: Record<string, any>
  ): Promise<IntakeRepositoryResult<boolean>> {
    try {
      logger.info({ bookingId, templateKey }, 'Saving intake responses to booking');

      const intakeData = {
        template_id: templateId,
        template_key: templateKey,
        responses
      };

      const { error } = await this.supabase
        .from('scheduling_bookings')
        .update({
          intake_responses: intakeData,
          intake_completed_at: new Date().toISOString()
        })
        .eq('id', bookingId)
        .eq('user_id', userId);

      if (error) throw error;

      logger.info({ bookingId, templateKey }, 'Intake responses saved');
      return { data: true, error: null };
    } catch (error) {
      logger.error({ err: error, bookingId }, 'Failed to save intake responses');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get intake responses for a booking
   */
  async getIntakeResponses(
    bookingId: string,
    userId: string
  ): Promise<IntakeRepositoryResult<{ template_id: string; template_key: string; responses: Record<string, any> } | null>> {
    try {
      const { data, error } = await this.supabase
        .from('scheduling_bookings')
        .select('intake_responses, intake_completed_at')
        .eq('id', bookingId)
        .eq('user_id', userId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return { data: null, error: null };
        }
        throw error;
      }

      return {
        data: data.intake_responses as { template_id: string; template_key: string; responses: Record<string, any> } | null,
        error: null
      };
    } catch (error) {
      logger.error({ err: error, bookingId }, 'Failed to get intake responses');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Update intake responses for a booking
   * Preserves the template_id and template_key, only updates the responses
   */
  async updateIntakeResponses(
    bookingId: string,
    userId: string,
    responses: Record<string, unknown>
  ): Promise<IntakeRepositoryResult<boolean>> {
    try {
      logger.info({ bookingId }, 'Updating intake responses for booking');

      // First get the existing intake data to preserve template info
      const { data: existing, error: fetchError } = await this.supabase
        .from('scheduling_bookings')
        .select('intake_responses')
        .eq('id', bookingId)
        .eq('user_id', userId)
        .single();

      if (fetchError) {
        if (fetchError.code === 'PGRST116') {
          logger.warn({ bookingId }, 'Booking not found for intake update');
          return { data: false, error: new Error('Booking not found') };
        }
        throw fetchError;
      }

      if (!existing.intake_responses) {
        logger.warn({ bookingId }, 'No existing intake responses to update');
        return { data: false, error: new Error('No existing intake responses found') };
      }

      // Update the responses while preserving template info
      const updatedIntakeData = {
        ...existing.intake_responses,
        responses
      };

      const { error: updateError } = await this.supabase
        .from('scheduling_bookings')
        .update({
          intake_responses: updatedIntakeData,
          // Note: We don't update intake_completed_at to preserve original submission time
        })
        .eq('id', bookingId)
        .eq('user_id', userId);

      if (updateError) throw updateError;

      logger.info({ bookingId }, 'Intake responses updated successfully');
      return { data: true, error: null };
    } catch (error) {
      logger.error({ err: error, bookingId }, 'Failed to update intake responses');
      return { data: null, error: error as Error };
    }
  }
}

// Singleton export
export const intakeRepository = new IntakeRepository();
