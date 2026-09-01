/**
 * Saved plans — a piece of chat work the user can run again.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONE RULE: A SAVED PLAN IS UNRESOLVED.
 *
 * It stores "contacts who never completed intake", never "these 3 contacts".
 * Running it in March must find March's people. Storing resolved rows would turn
 * a saved plan into a saved *result*, and re-running it would email whoever
 * happened to match in January.
 *
 * The freeze still happens — just later, and per run: resolve → show → approve →
 * execute the frozen set. That is the same TOCTOU discipline as the chat's
 * confirmation flow, applied at the right moment.
 *
 * WHY RE-VALIDATION IS NOT OPTIONAL
 *
 * A stored plan is authored against a catalog that keeps moving. `CATALOG_VERSION`
 * is recorded, but it is a weak signal by construction: it hashes `risk`,
 * `requiresConfirmation` and `allowBulk` — NOT `maxFanout` and NOT
 * `requiredFields`. Lowering a fan-out cap from 100 to 10 does not change the
 * hash. So a version match proves nothing, and every run re-validates against the
 * live catalog. A plan that no longer validates is DISABLED with a reason the
 * user can read, never skipped quietly.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/business-os/bizql/saved
 */

import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { CATALOG_VERSION } from '@/lib/business-os/catalog';
import { normalizePlan, validatePlan } from '../planner/validatePlan';
import type { Plan } from '../planner/Planner';
import type { Query } from '../types';

const logger = createLogger({ module: 'BizQLSavedPlans' });

const TABLE = 'business_chat_saved_plans';

export interface SavedPlan {
  id: string;
  user_id: string;
  name: string;
  utterance: string;
  steps: Query[];
  answer_text: string | null;
  catalog_version: string | null;
  is_active: boolean;
  disabled_reason: string | null;
  run_count: number;
  last_run_at: string | null;
  last_run_summary: string | null;
  created_at: string;
}

export interface SaveArgs {
  userId: string;
  name: string;
  utterance: string;
  steps: Query[];
  answerText?: string;
}

/**
 * Thrown when a stored plan no longer typechecks against the live catalog.
 *
 * Distinct from a generic failure because the correct response is to tell the
 * user their saved plan has gone stale and why — not to log an error and do
 * nothing, which is indistinguishable from "there was nobody to contact".
 */
export class SavedPlanStaleError extends Error {
  constructor(
    public readonly planId: string,
    public readonly problems: string[]
  ) {
    super(`Saved plan is no longer valid: ${problems.join('; ')}`);
    this.name = 'SavedPlanStaleError';
  }
}

export class SavedPlanStore {
  constructor(private readonly supabase = supabaseServer) {}

  async save(args: SaveArgs): Promise<SavedPlan | null> {
    const row = {
      user_id: args.userId,
      name: args.name.trim(),
      utterance: args.utterance,
      steps: args.steps,
      answer_text: args.answerText ?? null,
      catalog_version: CATALOG_VERSION,
      updated_at: new Date().toISOString(),
    };

    // Select-then-write rather than upsert.
    //
    // The unique index is on `(user_id, lower(name))` — an EXPRESSION index, and
    // PostgREST cannot use one as an ON CONFLICT target: the upsert fails with
    // 42P10 and, because the error is swallowed by the caller, saving silently
    // does nothing. That exact bug already cost this codebase a working plan
    // cache once; the fix there was the same shape as this one.
    //
    // The index still earns its place: it is what makes a double-tap fail loudly
    // rather than create two rows, which this read-then-write cannot guarantee on
    // its own.
    const existing = await this.supabase
      .from(TABLE)
      .select('id')
      .eq('user_id', args.userId)
      .ilike('name', row.name)
      .maybeSingle();

    const written = existing.data?.id
      ? await this.supabase
          .from(TABLE)
          .update(row)
          .eq('id', existing.data.id)
          .eq('user_id', args.userId)
          .select()
          .single()
      : await this.supabase.from(TABLE).insert(row).select().single();

    const { data, error } = written;

    if (error) {
      logger.error(
        { err: error, code: (error as { code?: string }).code, userId: args.userId },
        'Failed to save plan'
      );
      return null;
    }

    logger.info({ userId: args.userId, planId: data.id, name: row.name }, 'Saved plan');
    return data as SavedPlan;
  }

  async list(userId: string): Promise<SavedPlan[]> {
    const { data, error } = await this.supabase
      .from(TABLE)
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error({ err: error, userId }, 'Failed to list saved plans');
      return [];
    }
    return (data ?? []) as SavedPlan[];
  }

  async get(userId: string, planId: string): Promise<SavedPlan | null> {
    const { data, error } = await this.supabase
      .from(TABLE)
      .select('*')
      .eq('id', planId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      logger.error({ err: error, planId }, 'Failed to load saved plan');
      return null;
    }
    return (data as SavedPlan) ?? null;
  }

  async delete(userId: string, planId: string): Promise<boolean> {
    const { error } = await this.supabase
      .from(TABLE)
      .delete()
      .eq('id', planId)
      .eq('user_id', userId);

    if (error) {
      logger.error({ err: error, planId }, 'Failed to delete saved plan');
      return false;
    }
    return true;
  }

  /**
   * Re-check a stored plan against the live catalog before it is allowed to run.
   *
   * Throws `SavedPlanStaleError` and disables the plan when it no longer
   * validates, so the user is told rather than left with something that silently
   * stopped working.
   */
  async validateForRun(plan: SavedPlan): Promise<Query[]> {
    // normalizePlan mutates, so work on a copy — a stored plan must not be
    // rewritten by the act of checking it.
    const candidate = { steps: JSON.parse(JSON.stringify(plan.steps)) } as Plan;

    normalizePlan(candidate);
    const problems = validatePlan(candidate);

    if (problems.length > 0) {
      await this.disable(plan.user_id, plan.id, problems.join('; '));
      logger.warn(
        { planId: plan.id, problems, storedVersion: plan.catalog_version, liveVersion: CATALOG_VERSION },
        'Saved plan failed re-validation'
      );
      throw new SavedPlanStaleError(plan.id, problems);
    }

    return candidate.steps as Query[];
  }

  async disable(userId: string, planId: string, reason: string): Promise<void> {
    await this.supabase
      .from(TABLE)
      .update({ is_active: false, disabled_reason: reason, updated_at: new Date().toISOString() })
      .eq('id', planId)
      .eq('user_id', userId);
  }

  /**
   * Record a completed run.
   *
   * `run_count` is incremented from the value just read, which is a
   * read-modify-write. Acceptable here and nowhere near a scheduler: a saved plan
   * is run by a person tapping a button, so two concurrent runs mean a double-tap
   * — and a double-tap is already blocked by ActionLog at the item level, which
   * is the count that matters. A cron would need an atomic increment instead.
   */
  async recordRun(userId: string, plan: SavedPlan, summary: string): Promise<void> {
    await this.supabase
      .from(TABLE)
      .update({
        run_count: plan.run_count + 1,
        last_run_at: new Date().toISOString(),
        last_run_summary: summary,
        updated_at: new Date().toISOString(),
      })
      .eq('id', plan.id)
      .eq('user_id', userId);
  }
}

let instance: SavedPlanStore | null = null;

export function getSavedPlanStore(): SavedPlanStore {
  if (!instance) instance = new SavedPlanStore();
  return instance;
}
