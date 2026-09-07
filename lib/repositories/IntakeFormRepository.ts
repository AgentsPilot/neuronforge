/**
 * The business's own intake form.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Every surface that needs to know "what do we ask, and may we ask it" comes
 * through here. That is deliberate: the thing this replaces was resolved three
 * different ways — `intakeReachesClient`, `businessCollectsIntake`, and a bare
 * `is_enabled` read in two places — which is exactly how a rule ends up applied
 * in some places and not others. A gate with three implementations is not a
 * gate.
 *
 * DRAFT AND PUBLISHED ARE DIFFERENT QUESTIONS.
 *
 * `getDraft` is what the owner edits. `getPublished` is what a client receives.
 * They are never the same row, and no caller should ever have to remember which
 * one it wanted — the method names are the reminder.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/repositories/IntakeFormRepository
 */

import { supabaseServer } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';
import type {
  IntakeForm,
  IntakeFormProvenance,
  IntakeQuestion,
} from '@/lib/business-os/intake/types';

const logger = createLogger({ service: 'IntakeFormRepository' });

export interface IntakeFormResult<T> {
  data: T | null;
  error: Error | null;
}

const COLUMNS =
  'id, user_id, version, status, questions, generated_at, generated_from, published_at, created_at, updated_at';

export class IntakeFormRepository {
  private supabase = supabaseServer;

  /** The form the owner is editing, if there is one. */
  async getDraft(userId: string): Promise<IntakeFormResult<IntakeForm>> {
    return this.oneByStatus(userId, 'draft');
  }

  /**
   * The form clients receive.
   *
   * Null is a meaningful answer and the reason the publish gate works: no
   * published form means no client may be sent anything, however many settings
   * are switched on.
   */
  async getPublished(userId: string): Promise<IntakeFormResult<IntakeForm>> {
    return this.oneByStatus(userId, 'published');
  }

  private async oneByStatus(
    userId: string,
    status: 'draft' | 'published'
  ): Promise<IntakeFormResult<IntakeForm>> {
    try {
      const { data, error } = await this.supabase
        .from('business_intake_forms')
        .select(COLUMNS)
        .eq('user_id', userId)
        .eq('status', status)
        .maybeSingle();

      if (error) throw error;
      return { data: (data as IntakeForm) ?? null, error: null };
    } catch (error) {
      logger.error({ err: error, userId, status }, 'Failed to read the intake form');
      return { data: null, error: error as Error };
    }
  }

  /**
   * A specific version, for reading a submission against the form it was
   * answered on.
   *
   * Scoped by `user_id` like everything else: a form id arriving from a stored
   * submission is still an id from outside this function.
   */
  async getById(userId: string, formId: string): Promise<IntakeFormResult<IntakeForm>> {
    try {
      const { data, error } = await this.supabase
        .from('business_intake_forms')
        .select(COLUMNS)
        .eq('id', formId)
        .eq('user_id', userId)
        .maybeSingle();

      if (error) throw error;
      return { data: (data as IntakeForm) ?? null, error: null };
    } catch (error) {
      logger.error({ err: error, userId, formId }, 'Failed to read an intake form version');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Start a draft, or replace the questions of the one already open.
   *
   * Replacing rather than adding a second is what the partial unique index on
   * `status = 'draft'` enforces at the database, and this is the method that
   * makes it true rather than an error: regenerating is an ordinary thing to
   * ask for, and it should overwrite the draft, not fail.
   *
   * Never touches the published row. Generating a new draft cannot take a live
   * form away from clients mid-flight.
   */
  async saveDraft(
    userId: string,
    questions: IntakeQuestion[],
    provenance: IntakeFormProvenance
  ): Promise<IntakeFormResult<IntakeForm>> {
    try {
      const existing = await this.getDraft(userId);
      if (existing.error) throw existing.error;

      const now = new Date().toISOString();

      if (existing.data) {
        const { data, error } = await this.supabase
          .from('business_intake_forms')
          .update({
            questions,
            generated_at: provenance.source === 'manual' ? existing.data.generated_at : now,
            generated_from: provenance,
          })
          .eq('id', existing.data.id)
          .eq('user_id', userId)
          .select(COLUMNS)
          .single();

        if (error) throw error;
        return { data: data as IntakeForm, error: null };
      }

      const { data, error } = await this.supabase
        .from('business_intake_forms')
        .insert({
          user_id: userId,
          // One past the highest that exists, published or archived, so a
          // version number is never reused after an archive.
          version: (await this.highestVersion(userId)) + 1,
          status: 'draft',
          questions,
          generated_at: provenance.source === 'manual' ? null : now,
          generated_from: provenance,
        })
        .select(COLUMNS)
        .single();

      if (error) throw error;
      return { data: data as IntakeForm, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to save the intake draft');
      return { data: null, error: error as Error };
    }
  }

  private async highestVersion(userId: string): Promise<number> {
    const { data } = await this.supabase
      .from('business_intake_forms')
      .select('version')
      .eq('user_id', userId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();

    return (data as { version?: number } | null)?.version ?? 0;
  }

  /** Overwrite the draft's questions — every editing action lands here. */
  async updateDraftQuestions(
    userId: string,
    questions: IntakeQuestion[]
  ): Promise<IntakeFormResult<IntakeForm>> {
    try {
      const draft = await this.getDraft(userId);
      if (draft.error) throw draft.error;
      if (!draft.data) {
        return { data: null, error: new Error('No draft intake form to edit') };
      }

      const { data, error } = await this.supabase
        .from('business_intake_forms')
        .update({ questions })
        .eq('id', draft.data.id)
        .eq('user_id', userId)
        .select(COLUMNS)
        .single();

      if (error) throw error;
      return { data: data as IntakeForm, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to update the intake draft');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Make the draft the live form.
   *
   * ARCHIVE FIRST, then promote. The database allows exactly one published row
   * per business, so promoting first would collide with the form still live —
   * and the failure would leave the business with no published form at all,
   * which is worse than the state it started in. Archiving first means the worst
   * interruption is a moment with nothing published, not a lost draft.
   */
  async publishDraft(userId: string): Promise<IntakeFormResult<IntakeForm>> {
    try {
      const draft = await this.getDraft(userId);
      if (draft.error) throw draft.error;
      if (!draft.data) {
        return { data: null, error: new Error('No draft intake form to publish') };
      }

      if (!draft.data.questions?.length) {
        // A published form with no questions would send a client an empty page
        // and mark the booking as awaiting an answer that cannot be given.
        return { data: null, error: new Error('An intake form needs at least one question') };
      }

      const { error: archiveError } = await this.supabase
        .from('business_intake_forms')
        .update({ status: 'archived' })
        .eq('user_id', userId)
        .eq('status', 'published');

      if (archiveError) throw archiveError;

      const { data, error } = await this.supabase
        .from('business_intake_forms')
        .update({ status: 'published', published_at: new Date().toISOString() })
        .eq('id', draft.data.id)
        .eq('user_id', userId)
        .select(COLUMNS)
        .single();

      if (error) throw error;

      logger.info(
        { userId, formId: data.id, version: data.version, questions: draft.data.questions.length },
        'Intake form published'
      );
      return { data: data as IntakeForm, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to publish the intake form');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Open a draft from the published form, so editing a live form starts from
   * what clients are actually being asked rather than from nothing.
   *
   * Returns the existing draft untouched when there already is one — the owner's
   * unpublished edits are not something to quietly discard because they opened
   * the screen again.
   */
  async editPublished(userId: string): Promise<IntakeFormResult<IntakeForm>> {
    const draft = await this.getDraft(userId);
    if (draft.error || draft.data) return draft;

    const published = await this.getPublished(userId);
    if (published.error) return published;
    if (!published.data) {
      return { data: null, error: new Error('No intake form to edit') };
    }

    return this.saveDraft(userId, published.data.questions, {
      ...(published.data.generated_from ?? { source: 'manual' }),
      source: 'manual',
    });
  }
}

export const intakeFormRepository = new IntakeFormRepository();
