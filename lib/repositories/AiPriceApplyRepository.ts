// lib/repositories/AiPriceApplyRepository.ts
// Data-access layer for Apply (AI model price review slice 8): the ONE writer of
// live AI model prices since slice 6, plus the apply batches it records
// (`ai_price_apply_batches`, the MP-FR-14 margin review prompt).
//
// THE LIVE PRICE WRITE IS IN THE DATABASE, NOT HERE. `applyLines` calls the
// function `ai_price_apply_lines`, which reads every price from the locked
// pending line, retires the old live row and inserts the new one in one
// all-or-nothing transaction. This file never names `ai_model_pricing` or
// `ai_model_image_pricing` (`livePriceWrites.guard`, LW-1 and LW-3) and
// sends the function only line ids and the admin's reason text.
//
// WHY THERE IS NO `.eq('user_id', userId)` HERE (mandatory-rule exemption,
// stated rather than silently skipped): the batches and the lines are
// platform-wide reference data with no owner column, like `ai_model_pricing`
// (see `AiModelPricingRepository`). `supabaseServer` (service role) is
// INTENTIONAL: the tables are REVOKEd from clients, and only `service_role`
// may read the batches and execute the functions. Authorisation is the
// caller's job: the only permitted callers are the admin routes under
// `app/api/admin/model-pricing/`, behind `requireAdmin`, plus the comparison
// read. Each function repeats the `admin_users` check on the admin id it is
// given (defence in depth). There is no tenant to cross (tenant-isolation-guard
// step 5, a global catalog): any active admin may act on any pending line (Q2).
//
// Slice 9 adds `findBatchesByIds`, the price history's read of the batches its
// applied lines belong to ("applied together with N prices", the margin review
// status). Read-only; its only caller is the admin history route (pinned by
// `adminReadMethods.guard.test.ts`).
//
// No method throws: every failure comes back as `{ data: null, error }`, with
// the Postgres SQLSTATE and DETAIL kept on the error so the route can map
// P8001..P8007, 42501, 23505, 55P03 and 40P01 to its answers.
//
// Server-side only: never import this from a `'use client'` component.

import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, Logger } from '@/lib/logger';
import type {
  AgentRepositoryResult as RepositoryResult,
  AiPriceApplyBatchRecord,
  AiPriceApplyLineInput,
  AiPriceApplyMargin,
  AiPriceApplyResultRow,
  AiPriceOpenMarginReview,
} from './types';

const BATCHES_TABLE = 'ai_price_apply_batches';
const APPLY_FUNCTION = 'ai_price_apply_lines';
const REVIEW_FUNCTION = 'ai_price_apply_batch_review_done';

/** The image price table's name ends with this; the full name stays in the database function. */
const IMAGE_TABLE_SUFFIX = 'image_pricing';

const OPEN_REVIEW_COLUMNS = 'id, applied_by, applied_at, line_count, margin_items';

/** The page shows 20 open margin reviews; one more is read so it can say that more are open. */
const OPEN_REVIEW_LIMIT = 21;

/** Slice 9: what the price history shows of a batch. No `margin_items` (the comparison's prompt shows those). */
export const BATCH_HISTORY_COLUMNS =
  'id, applied_by, applied_at, line_count, margin_review_needed, margin_review_done, margin_review_by, ' +
  'margin_review_at, margin_review_note';

/** Ids per `.in()` read (slice 9). */
export const BATCH_ID_CHUNK = 50;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An error carrying the Postgres SQLSTATE and DETAIL, when there are any. */
export interface ApplyRepositoryError extends Error {
  code?: string;
  details?: string;
}

function toError(error: unknown, fallback: string): ApplyRepositoryError {
  if (error instanceof Error) return error as ApplyRepositoryError;
  const record = (error ?? {}) as { message?: unknown; code?: unknown; details?: unknown };
  const wrapped: ApplyRepositoryError = new Error(typeof record.message === 'string' ? record.message : fallback);
  if (typeof record.code === 'string') wrapped.code = record.code;
  if (typeof record.details === 'string') wrapped.details = record.details;
  return wrapped;
}

interface ApplyRow {
  out_batch_id: string;
  out_line_id: string;
  out_live_table: string;
  out_new_row_id: string;
  out_retired_row_ids: string[] | null;
  out_applied_at: string;
}

interface ReviewRow {
  out_batch_id: string;
  out_done_at: string;
}

export class AiPriceApplyRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    // Service-role client by design — see the security note at the top of the file.
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'AiPriceApplyRepository' });
  }

  /**
   * Apply pending lines through `ai_price_apply_lines`: one transaction, all or
   * nothing. The payload is built field by field (an explicit allow-list).
   */
  async applyLines(input: {
    adminUserId: string;
    lines: AiPriceApplyLineInput[];
    margin: AiPriceApplyMargin;
  }): Promise<RepositoryResult<AiPriceApplyResultRow[]>> {
    const methodLogger = this.logger.child({ method: 'applyLines', lineCount: input.lines.length });
    const startTime = Date.now();

    try {
      const lines = input.lines.map((line) =>
        line.override_reason === undefined
          ? { line_id: line.line_id, reason: line.reason }
          : { line_id: line.line_id, reason: line.reason, override_reason: line.override_reason }
      );
      const { data, error } = await this.supabase.rpc(APPLY_FUNCTION, {
        p_admin_user_id: input.adminUserId,
        p_lines: lines,
        p_margin: { needed: input.margin.needed, items: input.margin.items },
      });

      if (error) throw toError(error, 'Apply failed');

      const rows = ((data as ApplyRow[] | null) ?? []).map((row) => ({
        batchId: row.out_batch_id,
        lineId: row.out_line_id,
        // The function names the table; this file never does (LW-1), so it keeps only the kind.
        liveKind: row.out_live_table.endsWith(IMAGE_TABLE_SUFFIX) ? ('image' as const) : ('token' as const),
        newRowId: row.out_new_row_id,
        retiredRowIds: row.out_retired_row_ids ?? [],
        appliedAt: row.out_applied_at,
      }));
      // The function committed by the time it answers: a row count that differs is logged, never turned
      // into an error, so the route cannot tell the admin "nothing was changed" about an applied price.
      if (rows.length !== input.lines.length) {
        methodLogger.error({ expected: input.lines.length, returned: rows.length }, 'Apply returned a different number of lines than it was given');
      }

      methodLogger.info({ count: rows.length, batchId: rows[0]?.batchId, duration: Date.now() - startTime }, 'Price lines applied');
      return { data: rows, error: null };
    } catch (error) {
      const wrapped = toError(error, 'Apply failed');
      methodLogger.error({ err: wrapped, code: wrapped.code, duration: Date.now() - startTime }, 'Failed to apply price lines');
      return { data: null, error: wrapped };
    }
  }

  /** Applies whose margin review is needed and still open, newest first. */
  async listOpenMarginReviews(): Promise<RepositoryResult<AiPriceOpenMarginReview[]>> {
    const methodLogger = this.logger.child({ method: 'listOpenMarginReviews' });
    const startTime = Date.now();

    try {
      const { data, error } = await this.supabase
        .from(BATCHES_TABLE)
        .select(OPEN_REVIEW_COLUMNS)
        .eq('margin_review_needed', true)
        .eq('margin_review_done', false)
        .order('applied_at', { ascending: false })
        .limit(OPEN_REVIEW_LIMIT);

      if (error) throw toError(error, 'Margin review read failed');

      methodLogger.debug({ count: data?.length || 0, duration: Date.now() - startTime }, 'Open margin reviews fetched');
      return { data: (data as unknown as AiPriceOpenMarginReview[]) || [], error: null };
    } catch (error) {
      const wrapped = toError(error, 'Margin review read failed');
      methodLogger.error({ err: wrapped, duration: Date.now() - startTime }, 'Failed to read open margin reviews');
      return { data: null, error: wrapped };
    }
  }

  /**
   * Slice 9: apply batches by id, for the price history (ADMIN ONLY: the
   * history route). De-duplicated, read in chunks of `BATCH_ID_CHUNK`; an empty
   * list answers `[]` with no query; a non-UUID id is refused before any query.
   * Never logs a margin note.
   */
  async findBatchesByIds(ids: readonly string[]): Promise<RepositoryResult<AiPriceApplyBatchRecord[]>> {
    const unique = [...new Set(ids)];
    const methodLogger = this.logger.child({ method: 'findBatchesByIds', count: unique.length });
    const startTime = Date.now();

    try {
      if (!unique.every((id) => typeof id === 'string' && UUID_PATTERN.test(id))) {
        throw new Error('Every batch id must be a UUID');
      }
      const found: AiPriceApplyBatchRecord[] = [];
      for (let start = 0; start < unique.length; start += BATCH_ID_CHUNK) {
        const { data, error } = await this.supabase
          .from(BATCHES_TABLE)
          .select(BATCH_HISTORY_COLUMNS)
          .in('id', unique.slice(start, start + BATCH_ID_CHUNK));
        if (error) throw toError(error, 'Apply batch read failed');
        found.push(...((data as unknown as AiPriceApplyBatchRecord[]) || []));
      }

      methodLogger.debug({ found: found.length, duration: Date.now() - startTime }, 'Apply batches fetched for the price history');
      return { data: found, error: null };
    } catch (error) {
      const wrapped = toError(error, 'Apply batch read failed');
      methodLogger.error({ err: wrapped, duration: Date.now() - startTime }, 'Failed to read apply batches for the price history');
      return { data: null, error: wrapped };
    }
  }

  /** Mark one apply's margin review done, with the admin's note (`ai_price_apply_batch_review_done`). */
  async markMarginReviewDone(input: {
    adminUserId: string;
    batchId: string;
    note: string;
  }): Promise<RepositoryResult<{ batchId: string; doneAt: string }>> {
    const methodLogger = this.logger.child({ method: 'markMarginReviewDone', batchId: input.batchId });
    const startTime = Date.now();

    try {
      const { data, error } = await this.supabase.rpc(REVIEW_FUNCTION, {
        p_admin_user_id: input.adminUserId,
        p_batch_id: input.batchId,
        p_note: input.note,
      });

      if (error) throw toError(error, 'Margin review failed');

      const row = ((data as ReviewRow[] | null) ?? [])[0];
      if (!row) throw new Error('The margin review function returned no row');

      methodLogger.info({ duration: Date.now() - startTime }, 'Margin review marked done');
      return { data: { batchId: row.out_batch_id, doneAt: row.out_done_at }, error: null };
    } catch (error) {
      const wrapped = toError(error, 'Margin review failed');
      methodLogger.error({ err: wrapped, code: wrapped.code, duration: Date.now() - startTime }, 'Failed to mark the margin review done');
      return { data: null, error: wrapped };
    }
  }
}

export const aiPriceApplyRepository = new AiPriceApplyRepository();
