/**
 * The two intake switches, and the answers stored on a booking.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * This was the repository for `intake_form_templates` — a shared catalogue of
 * eleven forms that every business picked one of. That table is gone. A business
 * now owns its form, and `IntakeFormRepository` is where it lives.
 *
 * Eleven methods went with the table, and they were not merely unused: each one
 * still queried `intake_form_templates` or `user_intake_settings.template_id`,
 * both dropped by the migration, so a surviving caller got a Postgres error
 * rather than an empty result. That is what happened to the owner's "send
 * intake" endpoint — `getCollectableTemplateForUser` threw, the endpoint read
 * the absent result as "not configured", and every send was refused for a
 * business whose form was published and working.
 *
 * What is left is what still exists: the settings row, and the responses stored
 * on a booking.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/repositories/IntakeRepository
 */

import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ service: 'IntakeRepository' });

/**
 * Whether the business collects intake, and whether we email it for them.
 *
 * Neither is "is there a form" — that belongs to
 * `IntakeFormRepository.getPublished`, and `lib/business-os/intakeReach` is
 * where the two are put together. `template_id` and `collect_during_booking`
 * are dropped columns, deliberately absent here so nothing can read them back.
 */
export interface UserIntakeSettings {
  id: string;
  user_id: string;
  is_enabled: boolean;
  send_after_booking: boolean;
  created_at: string;
  updated_at: string;
}

export interface IntakeRepositoryResult<T> {
  data: T | null;
  error: Error | null;
}

/**
 * A completed intake as stored on the booking.
 *
 * `questions` is the snapshot taken when the client answered — what makes a
 * submission readable on its own after the form is edited and republished.
 * `template_id` / `template_key` are the pre-migration shape, kept optional so
 * an older row still parses; the migration backfilled those rows' labels into
 * `questions` before dropping the catalogue.
 */
export interface StoredIntakeResponses {
  form_id?: string;
  version?: number;
  questions?: unknown[];
  responses: Record<string, unknown>;
  template_id?: string;
  template_key?: string;
}

export class IntakeRepository {
  private supabase = supabaseServer;

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
  // Booking Submissions
  // ============================================

  /**
   * Get intake responses for a booking
   */
  async getIntakeResponses(
    bookingId: string,
    userId: string
  ): Promise<IntakeRepositoryResult<StoredIntakeResponses | null>> {
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
        data: data.intake_responses as StoredIntakeResponses | null,
        error: null
      };
    } catch (error) {
      logger.error({ err: error, bookingId }, 'Failed to get intake responses');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Update intake responses for a booking
   *
   * Only the answers change. Everything else the submission carries — the form
   * id, the version, the question snapshot — is what makes it readable, so it is
   * preserved rather than rewritten by an edit.
   */
  async updateIntakeResponses(
    bookingId: string,
    userId: string,
    responses: Record<string, unknown>
  ): Promise<IntakeRepositoryResult<boolean>> {
    try {
      logger.info({ bookingId }, 'Updating intake responses for booking');

      // First get the existing intake data to preserve the question snapshot
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
