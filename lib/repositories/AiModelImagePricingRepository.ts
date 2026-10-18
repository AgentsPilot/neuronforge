// lib/repositories/AiModelImagePricingRepository.ts
// Data-access layer for the `ai_model_image_pricing` table: the price of one
// generated image per provider, model, size and quality. It is the authoritative
// image price store (AI model price review R-1). The in-code
// `IMAGE_FALLBACK_PRICING` is only the outage fallback and the conservative-rate
// source.
//
// WHY THERE IS NO `.eq('user_id', userId)` HERE (mandatory-rule exemption, stated
// rather than silently skipped; ⟨unscoped-by-design⟩):
//
//   `ai_model_image_pricing` is platform-wide reference data, exactly like its
//   sibling `ai_model_pricing` (see `AiModelPricingRepository`'s header). It has
//   NO `user_id` or other owner column, so there is nothing to scope by. Every row
//   is the same row for every tenant, and no cross-tenant read or write is
//   reachable through this repository.
//
//   `supabaseServer` (service role) is therefore INTENTIONAL. The table's RLS is
//   admin-SELECT-only, so a user-session client would read `[]` (not an error)
//   and the billing reader would silently fall back to the in-code prices.
//
//   Because scoping cannot protect this table, AUTHORISATION IS THE CALLER'S JOB.
//   There are exactly TWO classes of permitted caller (slice 7 RC7-12):
//
//   1. THE BILLING READER, ungated by design: `lib/ai/imagePricing.ts`
//      (`listActive()` only). It runs inside any user's image request. That is
//      safe: the rows are platform price labels with nothing secret, the read
//      takes no caller-supplied filter, it is cached for an hour, and only the
//      resulting cost reaches the caller's own ledger row.
//
//   2. THE ADMIN SURFACE, behind `requireAdmin`: the admin price comparison,
//      `lib/ai/pricing-research/comparisonModel.ts` (`listActiveExact()` only),
//      and the per-model price history,
//      `app/api/admin/model-pricing/history/route.ts` (`listHistoryExact()`
//      only; slice 9).
//
//   Do not add a caller outside those two classes.
//
//   READ-ONLY. Live prices are written only by slice 8's apply function, never
//   from here. `livePriceWrites.guard.test.ts` (LW-2) fails on any write call in
//   this file, and on any method other than the three below.
//
//   Exactly one method, `listHistoryExact`, takes a key (slice 9, SA O-1): it is
//   admin-only (class 2, the history route), the key is Zod-validated (provider
//   enum, `MODEL_ID_REGEX`), and the billing reader never calls it (pinned by
//   `adminReadMethods.guard.test.ts`: only `app/api/admin/**` may call it). No
//   other method takes a caller-supplied filter; do not add one.
//
//   No data-export descriptor: a platform table with no owner column holds no
//   account's data. Server-side only; never import this from a `'use client'`
//   component.
//
// No method throws: every failure comes back as `{ data: null, error }`.

import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, Logger } from '@/lib/logger';
import type {
  AgentRepositoryResult as RepositoryResult,
  AiModelImagePricing,
  AiModelImagePricingExactRow,
  AiModelImagePricingHistoryRow,
  PriceHistoryRowsPage,
} from './types';

const TABLE = 'ai_model_image_pricing';

/** The most rows one model's history returns (slice 9, SA O-5); the same figure as the token repository's, pinned by test. */
export const IMAGE_PRICE_HISTORY_ROW_LIMIT = 200;

/** Every stored column the history shows, the price as exact TEXT (slice 9). */
export const IMAGE_PRICE_HISTORY_COLUMNS =
  'id, provider, model_name, size, quality, cost_per_image::text, effective_date, retired_date, created_at, proposal_id, proposal_line_id';

export class AiModelImagePricingRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    // Service-role client by design: see the security note at the top of the file.
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'AiModelImagePricingRepository' });
  }

  /**
   * The ACTIVE image prices, newest first: the billing reader's query.
   *
   * The same rule as `AiModelPricingRepository.listActive()`:
   * - not retired;
   * - already in effect: a row dated in the future is a price that was entered
   *   but has not started;
   * - newest `effective_date` first, then newest `created_at`, so every instance
   *   picks the same row for a key.
   *
   * Choosing one row per key is the caller's job (`selectActiveImagePrices` in
   * `lib/ai/imagePricing.ts`), so the cache and the admin comparison share one
   * rule.
   *
   * An EMPTY result is `{ data: [], error: null }`: the query succeeded and
   * matched nothing. That is the production state until the first approved image
   * price.
   */
  async listActive(): Promise<RepositoryResult<AiModelImagePricing[]>> {
    const methodLogger = this.logger.child({ method: 'listActive' });
    const startTime = Date.now();

    try {
      const today = new Date().toISOString().slice(0, 10);

      const { data, error } = await this.supabase
        .from(TABLE)
        .select('id, provider, model_name, size, quality, cost_per_image, effective_date, created_at')
        .is('retired_date', null)
        .lte('effective_date', today)
        .order('effective_date', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) throw error;

      const duration = Date.now() - startTime;
      methodLogger.debug({ count: data?.length || 0, duration }, 'Active image price rows fetched');
      return { data: (data as AiModelImagePricing[]) || [], error: null };
    } catch (error) {
      const duration = Date.now() - startTime;
      methodLogger.error({ err: error, duration }, 'Failed to fetch active image price rows');
      return { data: null, error: error as Error };
    }
  }

  /**
   * The same active rows as `listActive()` (same filter, same order), with
   * `cost_per_image` cast to TEXT by PostgREST, so the exact stored decimal
   * reaches the caller and never passes through a JS float.
   *
   * For the admin price comparison only (class 2 above, behind `requireAdmin`).
   * Not cached: the comparison must show what is stored now.
   */
  async listActiveExact(): Promise<RepositoryResult<AiModelImagePricingExactRow[]>> {
    const methodLogger = this.logger.child({ method: 'listActiveExact' });
    const startTime = Date.now();

    try {
      const today = new Date().toISOString().slice(0, 10);

      const { data, error } = await this.supabase
        .from(TABLE)
        .select('id, provider, model_name, size, quality, cost_per_image::text, effective_date, created_at')
        .is('retired_date', null)
        .lte('effective_date', today)
        .order('effective_date', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) throw error;

      const duration = Date.now() - startTime;
      methodLogger.debug({ count: data?.length || 0, duration }, 'Active image price rows fetched as exact text');
      return { data: (data as unknown as AiModelImagePricingExactRow[]) || [], error: null };
    } catch (error) {
      const duration = Date.now() - startTime;
      methodLogger.error({ err: error, duration }, 'Failed to fetch active image price rows as exact text');
      return { data: null, error: error as Error };
    }
  }

  /**
   * ADMIN ONLY (class 2, slice 9): every stored row of ONE image model, every
   * size and quality, current and retired, newest first, the price as exact
   * TEXT, at most `IMAGE_PRICE_HISTORY_ROW_LIMIT` (the newest), with `truncated`
   * when more exist. The `listActive()` order, no retired filter; the key comes
   * from the route's Zod-parsed query only and is refused here when empty.
   */
  async listHistoryExact(
    key: { provider: string; modelName: string },
    opts: { signal?: AbortSignal } = {}
  ): Promise<RepositoryResult<PriceHistoryRowsPage<AiModelImagePricingHistoryRow>>> {
    const methodLogger = this.logger.child({ method: 'listHistoryExact', provider: key?.provider });
    const startTime = Date.now();

    try {
      if (!key || typeof key.provider !== 'string' || key.provider === '' || typeof key.modelName !== 'string' || key.modelName === '') {
        throw new Error('A provider and a model name are required');
      }

      let query = this.supabase
        .from(TABLE)
        .select(IMAGE_PRICE_HISTORY_COLUMNS)
        .eq('provider', key.provider)
        .eq('model_name', key.modelName)
        .order('effective_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(IMAGE_PRICE_HISTORY_ROW_LIMIT + 1);
      if (opts.signal) query = query.abortSignal(opts.signal);

      const { data, error } = await query;
      if (error) throw error;

      const all = (data as unknown as AiModelImagePricingHistoryRow[]) || [];
      const truncated = all.length > IMAGE_PRICE_HISTORY_ROW_LIMIT;
      methodLogger.debug({ count: all.length, truncated, duration: Date.now() - startTime }, 'Image price history rows fetched');
      return { data: { rows: all.slice(0, IMAGE_PRICE_HISTORY_ROW_LIMIT), truncated }, error: null };
    } catch (error) {
      methodLogger.error({ err: error, duration: Date.now() - startTime }, 'Failed to fetch image price history rows');
      return { data: null, error: error as Error };
    }
  }
}

export const aiModelImagePricingRepository = new AiModelImagePricingRepository();
