// lib/repositories/AiModelPricingRepository.ts
// Data-access layer for the `ai_model_pricing` table — the per-token prices every
// credit charge in the product is computed from.
//
// WHY THERE IS NO `.eq('user_id', userId)` HERE (mandatory-rule exemption, stated
// rather than silently skipped):
//
//   `ai_model_pricing` is platform-wide reference data: one price per
//   provider/model/effective_date, shared by every tenant. The table has NO
//   `user_id` (or any other owner) column, so there is nothing to scope by, and
//   no cross-tenant read or write is reachable through this repository — every
//   row is, by definition, the same row for everyone.
//
//   `supabaseServer` (service role) is therefore INTENTIONAL, in the same way and
//   for the same reason as `AdminUserRepository` (see its header): an admin-only,
//   cross-tenant surface with no tenant dimension to filter on.
//
//   Because scoping cannot protect this table, AUTHORISATION IS THE CALLER'S JOB.
//   Every caller must already be behind the admin gate `requireAdmin`
//   (`lib/admin/requireAdminRoute.ts` → AdminAccessService → the `admin_users`
//   table; never `profiles.role`). Current callers, both gated:
//     - `app/api/admin/system-config/pricing/route.ts`      (GET/PUT/POST/DELETE)
//     - `app/api/admin/system-config/pricing/sync/route.ts` (POST)
//   Do not add a caller that is not behind that gate.
//
//   The `tenant-isolation-guard` ownership pre-check does not apply (there is no
//   owner column to pre-check). No method here accepts a caller-supplied filter,
//   table name, column list or arbitrary patch object — only ids and typed cost
//   fields — so a caller cannot widen what is written. Do NOT "add a filter
//   parameter": that would reopen exactly the question this header closes.
//
//   See CLAUDE.md § Security Rules and docs/REPOSITORY_STRATEGY.md. Server-side
//   only — never import this from a `'use client'` component.
//
// No method throws: every failure comes back as `{ data: null, error }`.

import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, Logger } from '@/lib/logger';
import type {
  AgentRepositoryResult as RepositoryResult,
  AiModelPricing,
  AiModelPricingSyncEntry,
  AiModelPricingSyncResult,
  CreateAiModelPricingInput,
} from './types';

const TABLE = 'ai_model_pricing';

export class AiModelPricingRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    // Service-role client by design — see the security note at the top of the file.
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'AiModelPricingRepository' });
  }

  /**
   * Every pricing row, ordered for display.
   *
   * Retired rows are INCLUDED on purpose: this is what the admin screen shows
   * today, and filtering them out here would make rows silently disappear from
   * it. The billing reader's "active only" query is a separate method (Step 1).
   */
  async listAll(): Promise<RepositoryResult<AiModelPricing[]>> {
    const methodLogger = this.logger.child({ method: 'listAll' });
    const startTime = Date.now();

    try {
      const { data, error } = await this.supabase
        .from(TABLE)
        .select('*')
        .order('provider', { ascending: true })
        .order('model_name', { ascending: true });

      if (error) throw error;

      const duration = Date.now() - startTime;
      methodLogger.debug({ count: data?.length || 0, duration }, 'Pricing rows fetched');
      return { data: (data as AiModelPricing[]) || [], error: null };
    } catch (error) {
      const duration = Date.now() - startTime;
      methodLogger.error({ err: error, duration }, 'Failed to fetch pricing rows');
      return { data: null, error: error as Error };
    }
  }

  /**
   * One row by id. A missing row is `{ data: null, error: null }` — not an error —
   * so the caller can tell "not found" from "the query failed" and answer 404.
   */
  async findById(id: string): Promise<RepositoryResult<AiModelPricing | null>> {
    const methodLogger = this.logger.child({ method: 'findById', pricingId: id });
    const startTime = Date.now();

    try {
      const { data, error } = await this.supabase
        .from(TABLE)
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (error) throw error;

      const duration = Date.now() - startTime;
      methodLogger.debug({ found: Boolean(data), duration }, 'Pricing row fetched');
      return { data: (data as AiModelPricing) ?? null, error: null };
    } catch (error) {
      const duration = Date.now() - startTime;
      methodLogger.error({ err: error, duration }, 'Failed to fetch pricing row');
      return { data: null, error: error as Error };
    }
  }

  /** Insert one row. The caller supplies `effective_date` — no clock policy lives here. */
  async create(input: CreateAiModelPricingInput): Promise<RepositoryResult<AiModelPricing>> {
    const methodLogger = this.logger.child({
      method: 'create',
      provider: input.provider,
      model: input.model_name,
    });
    const startTime = Date.now();

    try {
      const { data, error } = await this.supabase.from(TABLE).insert(input).select().single();

      if (error) throw error;

      const duration = Date.now() - startTime;
      methodLogger.info({ pricingId: (data as AiModelPricing)?.id, duration }, 'Pricing row created');
      return { data: data as AiModelPricing, error: null };
    } catch (error) {
      const duration = Date.now() - startTime;
      methodLogger.error({ err: error, duration }, 'Failed to create pricing row');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Update one or both cost fields of an existing row.
   *
   * `{ data: null, error: null }` means "no such row", which is how the route
   * answers 404 instead of the 500 PostgREST used to produce through `.single()`.
   */
  async updateCosts(
    id: string,
    costs: { input_cost_per_token?: number; output_cost_per_token?: number }
  ): Promise<RepositoryResult<AiModelPricing | null>> {
    const methodLogger = this.logger.child({ method: 'updateCosts', pricingId: id });
    const startTime = Date.now();

    const patch: Record<string, number> = {};
    if (costs.input_cost_per_token !== undefined) {
      patch.input_cost_per_token = costs.input_cost_per_token;
    }
    if (costs.output_cost_per_token !== undefined) {
      patch.output_cost_per_token = costs.output_cost_per_token;
    }

    // The route's Zod schema already refuses this; the guard is here so the
    // repository can never issue an empty UPDATE whatever calls it.
    if (Object.keys(patch).length === 0) {
      methodLogger.error({ duration: 0 }, 'Refused an update with no cost fields');
      return { data: null, error: new Error('No cost fields to update') };
    }

    try {
      const { data, error } = await this.supabase
        .from(TABLE)
        .update(patch)
        .eq('id', id)
        .select()
        .maybeSingle();

      if (error) throw error;

      const duration = Date.now() - startTime;
      methodLogger.info(
        { fields: Object.keys(patch), matched: Boolean(data), duration },
        'Pricing row updated'
      );
      return { data: (data as AiModelPricing) ?? null, error: null };
    } catch (error) {
      const duration = Date.now() - startTime;
      methodLogger.error({ err: error, duration }, 'Failed to update pricing row');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Delete one row. `data` is `false` when nothing matched, so the route can
   * answer 404 and skip writing an audit entry for a delete that did not happen.
   */
  async deleteById(id: string): Promise<RepositoryResult<boolean>> {
    const methodLogger = this.logger.child({ method: 'deleteById', pricingId: id });
    const startTime = Date.now();

    try {
      const { data, error } = await this.supabase.from(TABLE).delete().eq('id', id).select('id');

      if (error) throw error;

      const deleted = ((data as unknown[] | null)?.length ?? 0) > 0;
      const duration = Date.now() - startTime;
      methodLogger.info({ deleted, duration }, 'Pricing row delete attempted');
      return { data: deleted, error: null };
    } catch (error) {
      const duration = Date.now() - startTime;
      methodLogger.error({ err: error, duration }, 'Failed to delete pricing row');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Apply a whole pricing catalogue: update the row for each `(provider,
   * model_name)` that already exists, insert the ones that do not.
   *
   * NOT an upsert, on purpose. The table's unique constraint is
   * `(provider, model_name, effective_date)` and each sync run stamps a fresh
   * `effective_date`, so an upsert on that constraint would insert a new row
   * every run and the table would grow without bound. Matching on
   * `(provider, model_name)` only is today's semantics and keeps one row per model.
   *
   * The lookup takes the NEWEST row (`order effective_date desc` + `limit(1)` +
   * `maybeSingle`). The previous `.single()` errored whenever a model already had
   * more than one `effective_date` row, which made the sync treat it as missing
   * and insert yet another duplicate on every run.
   *
   * A row that fails is recorded in `failed` and never aborts the run, so one bad
   * model cannot leave the catalogue half-applied without telling the caller.
   */
  async syncMany(
    entries: AiModelPricingSyncEntry[]
  ): Promise<RepositoryResult<AiModelPricingSyncResult>> {
    const methodLogger = this.logger.child({ method: 'syncMany', total: entries.length });
    const startTime = Date.now();

    const result: AiModelPricingSyncResult = { updated: [], created: [], failed: [] };

    try {
      for (const entry of entries) {
        try {
          const { data: existing, error: lookupError } = await this.supabase
            .from(TABLE)
            .select('id')
            .eq('provider', entry.provider)
            .eq('model_name', entry.model_name)
            .order('effective_date', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (lookupError) throw lookupError;

          if (existing) {
            const { error } = await this.supabase
              .from(TABLE)
              .update({
                input_cost_per_token: entry.input_cost_per_token,
                output_cost_per_token: entry.output_cost_per_token,
                effective_date: entry.effective_date,
              })
              .eq('id', (existing as { id: string }).id);

            if (error) throw error;
            result.updated.push(entry.model_name);
          } else {
            const { error } = await this.supabase.from(TABLE).insert(entry);

            if (error) throw error;
            result.created.push(entry.model_name);
          }
        } catch (rowError) {
          methodLogger.error(
            { err: rowError, provider: entry.provider, model: entry.model_name },
            'Failed to sync one model price'
          );
          result.failed.push(entry.model_name);
        }
      }

      const duration = Date.now() - startTime;
      methodLogger.info(
        {
          updated: result.updated.length,
          created: result.created.length,
          failed: result.failed.length,
          duration,
        },
        'Pricing catalogue synced'
      );
      return { data: result, error: null };
    } catch (error) {
      const duration = Date.now() - startTime;
      methodLogger.error({ err: error, duration }, 'Pricing sync failed');
      return { data: null, error: error as Error };
    }
  }
}

export const aiModelPricingRepository = new AiModelPricingRepository();
