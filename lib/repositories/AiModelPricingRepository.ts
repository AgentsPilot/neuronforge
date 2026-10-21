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
//   Because scoping cannot protect this table, AUTHORISATION IS THE CALLER'S JOB,
//   and there are exactly TWO classes of permitted caller (S1-6):
//
//   1. THE ADMIN SURFACE — anything that reads the whole table must already be
//      behind the admin gate `requireAdmin`
//      (`lib/admin/requireAdminRoute.ts` → AdminAccessService → the `admin_users`
//      table; never `profiles.role`):
//        - `app/api/admin/system-config/pricing/route.ts` (GET, `listAll()` only)
//        - `app/api/admin/model-pricing/comparison/route.ts` and
//          `app/api/admin/model-pricing/manual-entries/route.ts`, through
//          `lib/ai/pricing-research/comparisonModel.ts` (`listActiveExact()`
//          only, read-only; AI model price review slice 3)
//        - `app/api/admin/model-pricing/history/route.ts` (`listHistoryExact()`
//          only, read-only; AI model price review slice 9, the per-model price
//          history)
//        - `scripts/**` operator scripts, run by hand with `.env.local`.
//
//   2. THE BILLING READER — exactly one, ungated by design:
//        - `lib/ai/pricing.ts` (`listActive()` only), on the hot path of every
//          billed LLM call, so it runs inside any user's request. That is safe
//          and deliberate: the rows are platform-wide price labels with no
//          tenant dimension and nothing secret, it is READ-only, it takes no
//          caller-supplied filter, and the prices it returns are never returned
//          to the browser — only the resulting cost is stored on the caller's
//          own ledger row. It also caches, so it is not a per-request query.
//
//   Do not add a caller outside those two classes. A new bulk read for a screen
//   belongs in class 1, behind `requireAdmin`.
//
//   READ-ONLY since AI model price review slice 6 (MP-FR-11): the single-row
//   create / update / hard delete and the Sync catalogue write were removed with
//   their routes. Do NOT add a write method here: live prices are written only by
//   slice 8's apply RPC, and `livePriceWrites.guard.test.ts` (LW-2) fails on any
//   `.insert(` / `.update(` / `.upsert(` / `.delete(` in this file.
//
//   Exactly one method, `listHistoryExact`, takes a key (slice 9, SA O-1): it is
//   admin-only (class 1, the history route), the key is Zod-validated (provider
//   enum, `MODEL_ID_REGEX`), and the billing reader never calls it (pinned by
//   `adminReadMethods.guard.test.ts`: only `app/api/admin/**` may call it). No
//   other method takes a caller-supplied filter; do not add one.
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
  AiModelPricingExactRow,
  AiModelPricingHistoryRow,
  PriceHistoryRowsPage,
} from './types';

const TABLE = 'ai_model_pricing';

/** The most rows one model's history returns (slice 9, SA O-5); one more is read to know there are more. */
export const PRICE_HISTORY_ROW_LIMIT = 200;

/** Every stored column the history shows, prices as exact TEXT (slice 9). */
export const PRICE_HISTORY_COLUMNS =
  'id, provider, model_name, input_cost_per_token::text, output_cost_per_token::text, ' +
  'cached_input_cost_per_token::text, effective_date, retired_date, created_at, proposal_id, proposal_line_id';

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
   * The rows the billing reader prices with: not retired, newest first.
   *
   * ORDERING IS LOAD-BEARING. Uniqueness is a partial unique index on
   * `(provider, model_name, effective_date)` over active rows only
   * (`retired_date IS NULL`, AI model price review slice 2), so one model may
   * have several active rows on different dates; `effective_date DESC` puts the
   * current price first and the caller keeps the FIRST row it sees per
   * `provider:model`
   * (`lib/ai/pricing.ts`). Reverse this order and every such model is
   * silently priced at its oldest rate.
   *
   * "Active" means not retired AND already in effect: rows dated in the future
   * are excluded until their date arrives (S1-5). `created_at DESC` is a
   * secondary sort, so two rows sharing an `effective_date` still resolve the
   * same way on every instance.
   *
   * An EMPTY result is `{ data: [], error: null }` and means the query
   * succeeded and matched nothing. Since 2026-09-20 this table is
   * admin-SELECT-only under RLS, so a non-service-role caller would also get
   * `[]` — not an error (D-17). Every caller here is service-role and bypasses
   * RLS; anything reading this from a browser or a user session must go through
   * an admin-gated API route instead, or it will read "no prices configured"
   * when the truth is "not allowed".
   */
  async listActive(): Promise<RepositoryResult<AiModelPricing[]>> {
    const methodLogger = this.logger.child({ method: 'listActive' });
    const startTime = Date.now();

    try {
      // Today in UTC. A row dated in the future is a price that has been
      // ENTERED but has not started (S1-5); without this filter, "newest wins"
      // would begin charging it the moment it was saved.
      const today = new Date().toISOString().slice(0, 10);

      const { data, error } = await this.supabase
        .from(TABLE)
        .select('*')
        .is('retired_date', null)
        .lte('effective_date', today)
        .order('effective_date', { ascending: false })
        // Secondary sort so the result stays deterministic if the
        // active-row (provider, model_name, effective_date) uniqueness ever lapses.
        .order('created_at', { ascending: false });

      if (error) throw error;

      const duration = Date.now() - startTime;
      methodLogger.debug({ count: data?.length || 0, duration }, 'Active pricing rows fetched');
      return { data: (data as AiModelPricing[]) || [], error: null };
    } catch (error) {
      const duration = Date.now() - startTime;
      methodLogger.error({ err: error, duration }, 'Failed to fetch active pricing rows');
      return { data: null, error: error as Error };
    }
  }

  /**
   * The same active rows as `listActive()` (same filter, same order), with the
   * three price columns cast to TEXT by PostgREST, so the exact stored decimal
   * reaches the caller and never passes through a JS float.
   *
   * For the admin price comparison and manual entry only (AI model price review
   * slice 3, SA O-10): class 1 below, behind `requireAdmin`. Not cached. The
   * billing reader keeps `listActive()`, which this method does not change.
   */
  async listActiveExact(): Promise<RepositoryResult<AiModelPricingExactRow[]>> {
    const methodLogger = this.logger.child({ method: 'listActiveExact' });
    const startTime = Date.now();

    try {
      const today = new Date().toISOString().slice(0, 10);

      const { data, error } = await this.supabase
        .from(TABLE)
        .select(
          'id, provider, model_name, input_cost_per_token::text, output_cost_per_token::text, cached_input_cost_per_token::text, effective_date, created_at'
        )
        .is('retired_date', null)
        .lte('effective_date', today)
        .order('effective_date', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) throw error;

      const duration = Date.now() - startTime;
      methodLogger.debug({ count: data?.length || 0, duration }, 'Active pricing rows fetched as exact text');
      return { data: (data as unknown as AiModelPricingExactRow[]) || [], error: null };
    } catch (error) {
      const duration = Date.now() - startTime;
      methodLogger.error({ err: error, duration }, 'Failed to fetch active pricing rows as exact text');
      return { data: null, error: error as Error };
    }
  }

  /**
   * ADMIN ONLY (class 1, slice 9): every stored row of ONE model, current and
   * retired, newest first, prices as exact TEXT, at most
   * `PRICE_HISTORY_ROW_LIMIT` (the newest), with `truncated` when more exist.
   *
   * The order is `listActive()`'s (`effective_date DESC, created_at DESC`), so
   * the history can pick the charged row by the charging rule. No retired
   * filter: the history is every kept row. The key comes from the route's
   * Zod-parsed query only (provider enum, model id rule); it is refused here
   * too when empty, before any query.
   */
  async listHistoryExact(
    key: { provider: string; modelName: string },
    opts: { signal?: AbortSignal } = {}
  ): Promise<RepositoryResult<PriceHistoryRowsPage<AiModelPricingHistoryRow>>> {
    const methodLogger = this.logger.child({ method: 'listHistoryExact', provider: key?.provider });
    const startTime = Date.now();

    try {
      if (!key || typeof key.provider !== 'string' || key.provider === '' || typeof key.modelName !== 'string' || key.modelName === '') {
        throw new Error('A provider and a model name are required');
      }

      let query = this.supabase
        .from(TABLE)
        .select(PRICE_HISTORY_COLUMNS)
        .eq('provider', key.provider)
        .eq('model_name', key.modelName)
        .order('effective_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(PRICE_HISTORY_ROW_LIMIT + 1);
      if (opts.signal) query = query.abortSignal(opts.signal);

      const { data, error } = await query;
      if (error) throw error;

      const all = (data as unknown as AiModelPricingHistoryRow[]) || [];
      const truncated = all.length > PRICE_HISTORY_ROW_LIMIT;
      methodLogger.debug({ count: all.length, truncated, duration: Date.now() - startTime }, 'Price history rows fetched');
      return { data: { rows: all.slice(0, PRICE_HISTORY_ROW_LIMIT), truncated }, error: null };
    } catch (error) {
      methodLogger.error({ err: error, duration: Date.now() - startTime }, 'Failed to fetch price history rows');
      return { data: null, error: error as Error };
    }
  }
}

export const aiModelPricingRepository = new AiModelPricingRepository();
