// lib/repositories/AiPriceProposalRepository.ts
// Data-access layer for the pending provider price area (AI model price review
// slice 3): `ai_price_proposals` (one manual entry or fetch round) and
// `ai_price_proposal_lines` (one pending price per model and unit).
//
// NOTHING HERE CHANGES A PRICE IN EFFECT. The only write is the submit RPC,
// which inserts pending lines and supersedes the older pending line of the same
// unit; it never names `ai_model_pricing` or `ai_model_image_pricing` (pinned by
// the slice 3 migration test).
//
// WHY THERE IS NO `.eq('user_id', userId)` HERE (mandatory-rule exemption,
// stated rather than silently skipped): both tables are platform-wide
// reference data with no owner column, exactly like `ai_model_pricing` (see the
// header of `AiModelPricingRepository`). `supabaseServer` (service role) is
// INTENTIONAL: the tables are REVOKEd from clients and only `service_role` may
// read them, insert them and execute the RPC. Authorisation is the caller's
// job: the only callers are the admin routes under
// `app/api/admin/model-pricing/`, behind `requireAdmin`. The RPC repeats the
// `admin_users` check on the admin id it is given (defence in depth).
//
// Slice 5 adds the fetch round: `submitFetchRound` (the same RPC, `fetch`) and
// three newest-round reads for the 60 s refusal and the per-provider status.
//
// Slice 8 adds Dismiss (`dismissLines`, the function `ai_price_dismiss_lines`,
// which sets a pending line `dismissed` with the admin's reason and still never
// names a live table) and `findLinesForDecision`, the exact read Apply and
// Dismiss check before they call a function. Apply itself, the one live-price
// writer, lives in `AiPriceApplyRepository`, so this file keeps its promise.
//
// Slice 9 adds `findAppliedLinesByIds`, the price history's read of the lines
// that produced live prices (who applied, why, from which source). Read-only;
// its only caller is the admin history route (pinned by
// `adminReadMethods.guard.test.ts`).
//
// There is deliberately NO update or delete method. Line state moves only
// inside database functions (submit, dismiss, apply), and a database trigger refuses any move that is
// not pending → superseded, applied or dismissed (SA C-2). Do not add one.
//
// No method throws: every failure comes back as `{ data: null, error }`, with
// the Postgres error code kept on the error so the route can map 23505 (a
// concurrent submit on the same unit) and 42501 (not an admin in admin_users).
//
// Server-side only: never import this from a `'use client'` component.

import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, Logger } from '@/lib/logger';
import type {
  AgentRepositoryResult as RepositoryResult,
  AiPriceAppliedLineRecord,
  AiPriceDecisionLine,
  AiPriceFetchRoundRow,
  AiPriceFetchRoundSubmitResult,
  AiPricePendingLine,
  AiPriceSubmitInput,
  AiPriceSubmitLine,
  AiPriceSubmitResultLine,
} from './types';

const LINES_TABLE = 'ai_price_proposal_lines';
const ROUNDS_TABLE = 'ai_price_proposals';
const SUBMIT_FUNCTION = 'ai_price_submit_pending';
const DISMISS_FUNCTION = 'ai_price_dismiss_lines';

const PENDING_LINE_COLUMNS =
  'id, proposal_id, kind, provider, model_name, image_size, image_quality, input_per_1m, output_per_1m, ' +
  'cached_input_per_1m, price_per_image, source_url, checked_on, flags, cross_check_verdict, cross_check_value, ' +
  'cross_check_diff_pct, cross_check_source, cross_check_fetched_at, created_by, created_at';

const ROUND_COLUMNS = 'id, created_at, created_by, provider_outcomes';

/**
 * Slice 8 (SA RC-6): every snapshot number as exact text, never a JSON number,
 * so the route compares decimals by value. Prices per 1M are text columns.
 */
const DECISION_LINE_COLUMNS =
  'id, proposal_id, kind, provider, model_name, image_size, image_quality, input_per_1m, output_per_1m, ' +
  'cached_input_per_1m, price_per_image, current_basis, current_row_id, ' +
  'current_input_cost_per_token::text, current_output_cost_per_token::text, ' +
  'current_cached_input_cost_per_token::text, current_cost_per_image::text, ' +
  'source_url, checked_on, flags, state, created_by';

/**
 * Slice 9: what the price history shows of an applied line. The round's
 * `source_kind` comes through the line's one FK to `ai_price_proposals` (an
 * embedded select, not a second literal).
 */
export const APPLIED_LINE_HISTORY_COLUMNS =
  'id, proposal_id, kind, image_size, image_quality, input_per_1m, output_per_1m, cached_input_per_1m, ' +
  'price_per_image, source_url, checked_on, state, decided_by, decided_at, decision_reason, override_reason, ' +
  'apply_batch_id, created_by, created_at, ai_price_proposals(source_kind)';

/** Ids per `.in()` read (slice 9): keeps each request URL short. */
export const LINE_ID_CHUNK = 50;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An error carrying the Postgres SQLSTATE, when there is one. */
export interface PriceRepositoryError extends Error {
  code?: string;
  /** Slice 8: the function's DETAIL (the line id a refusal names), when there is one. */
  details?: string;
}

function toError(error: unknown): PriceRepositoryError {
  if (error instanceof Error) return error as PriceRepositoryError;
  const record = (error ?? {}) as { message?: unknown; code?: unknown };
  const wrapped: PriceRepositoryError = new Error(
    typeof record.message === 'string' ? record.message : 'Pending price query failed'
  );
  if (typeof record.code === 'string') wrapped.code = record.code;
  if (typeof (record as { details?: unknown }).details === 'string') wrapped.details = (record as { details: string }).details;
  return wrapped;
}

interface SubmitRow {
  out_proposal_id: string;
  /** NULL only on the one row of a zero-line fetch round (migration `20261069`). */
  out_line_id: string | null;
  out_line_index: number | null;
  out_superseded_line_id: string | null;
}

/** The sources whose fetch outcome the status read filters on (a closed set: no caller text reaches a filter). */
export type FetchOutcomeSource = 'openai' | 'litellm';

export class AiPriceProposalRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    // Service-role client by design — see the security note at the top of the file.
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'AiPriceProposalRepository' });
  }

  /**
   * Store pending lines through `ai_price_submit_pending` in one transaction.
   * Prices travel as strings; the lines are passed through as given (the
   * caller has already validated them with the shared schema).
   */
  async submitPending(input: AiPriceSubmitInput): Promise<RepositoryResult<AiPriceSubmitResultLine[]>> {
    const methodLogger = this.logger.child({ method: 'submitPending', lineCount: input.lines.length });
    const startTime = Date.now();

    try {
      const { data, error } = await this.supabase.rpc(SUBMIT_FUNCTION, {
        p_admin_user_id: input.adminUserId,
        p_source_kind: input.sourceKind,
        p_provider_outcomes: input.providerOutcomes,
        p_lines: input.lines,
      });

      if (error) throw toError(error);

      // A manual entry always has at least one line, so every row names one.
      const rows = ((data as SubmitRow[] | null) ?? []).flatMap((row) =>
        row.out_line_id === null || row.out_line_index === null
          ? []
          : [
              {
                proposalId: row.out_proposal_id,
                lineId: row.out_line_id,
                lineIndex: row.out_line_index,
                supersededLineId: row.out_superseded_line_id,
              },
            ]
      );

      methodLogger.info({ count: rows.length, duration: Date.now() - startTime }, 'Pending price lines stored');
      return { data: rows, error: null };
    } catch (error) {
      const wrapped = toError(error);
      methodLogger.error(
        { err: wrapped, code: wrapped.code, duration: Date.now() - startTime },
        'Failed to store pending price lines'
      );
      return { data: null, error: wrapped };
    }
  }

  /**
   * Store one "Check provider prices" round (slice 5, SA SC-8) through the same
   * RPC as `fetch`. Zero lines is allowed (a blocked or changed page is still a
   * recorded round): the RPC then returns one row with the round id and no
   * line, which is dropped here, so callers never see a null line field.
   */
  async submitFetchRound(input: {
    adminUserId: string;
    providerOutcomes: Record<string, unknown>;
    lines: AiPriceSubmitLine[];
  }): Promise<RepositoryResult<AiPriceFetchRoundSubmitResult>> {
    const methodLogger = this.logger.child({ method: 'submitFetchRound', lineCount: input.lines.length });
    const startTime = Date.now();

    try {
      const { data, error } = await this.supabase.rpc(SUBMIT_FUNCTION, {
        p_admin_user_id: input.adminUserId,
        p_source_kind: 'fetch',
        p_provider_outcomes: input.providerOutcomes,
        p_lines: input.lines,
      });

      if (error) throw toError(error);

      const rows = (data as SubmitRow[] | null) ?? [];
      if (rows.length === 0) throw new Error('The submit function returned no round');
      const lines = rows.flatMap((row) =>
        row.out_line_id === null || row.out_line_index === null
          ? []
          : [
              {
                proposalId: row.out_proposal_id,
                lineId: row.out_line_id,
                lineIndex: row.out_line_index,
                supersededLineId: row.out_superseded_line_id,
              },
            ]
      );

      methodLogger.info({ count: lines.length, duration: Date.now() - startTime }, 'Fetch round stored');
      return { data: { roundId: rows[0].out_proposal_id, lines }, error: null };
    } catch (error) {
      const wrapped = toError(error);
      methodLogger.error({ err: wrapped, code: wrapped.code, duration: Date.now() - startTime }, 'Failed to store fetch round');
      return { data: null, error: wrapped };
    }
  }

  /** The newest fetch round, or null when none exists (the 60 s refusal anchor and the status line). */
  async latestFetchRound(): Promise<RepositoryResult<AiPriceFetchRoundRow | null>> {
    return this.readLatestRound('latestFetchRound', null);
  }

  /**
   * The newest fetch round where one source's outcome is (`eq`) or is not
   * (`neq`) `ok`: the last success and the last failure (SA SC-12). Two plain
   * filters, never `.or()` (the PostgREST update+or+select bug class).
   */
  async latestFetchRoundByOutcome(
    source: FetchOutcomeSource,
    match: 'ok' | 'not_ok'
  ): Promise<RepositoryResult<AiPriceFetchRoundRow | null>> {
    return this.readLatestRound('latestFetchRoundByOutcome', { source, match });
  }

  private async readLatestRound(
    method: string,
    filter: { source: FetchOutcomeSource; match: 'ok' | 'not_ok' } | null
  ): Promise<RepositoryResult<AiPriceFetchRoundRow | null>> {
    const methodLogger = this.logger.child({ method, source: filter?.source, match: filter?.match });
    const startTime = Date.now();

    try {
      let query = this.supabase.from(ROUNDS_TABLE).select(ROUND_COLUMNS).eq('source_kind', 'fetch');
      if (filter) {
        const path = filter.source === 'openai' ? 'provider_outcomes->openai->>outcome' : 'provider_outcomes->litellm->>outcome';
        query = filter.match === 'ok' ? query.eq(path, 'ok') : query.neq(path, 'ok');
      }
      const { data, error } = await query.order('created_at', { ascending: false }).limit(1);

      if (error) throw toError(error);

      const row = ((data as unknown as AiPriceFetchRoundRow[] | null) ?? [])[0] ?? null;
      methodLogger.debug({ found: row !== null, duration: Date.now() - startTime }, 'Fetch round read');
      return { data: row, error: null };
    } catch (error) {
      const wrapped = toError(error);
      methodLogger.error({ err: wrapped, duration: Date.now() - startTime }, 'Failed to read fetch rounds');
      return { data: null, error: wrapped };
    }
  }

  /** Every line still pending, newest first (at most one per model and unit, by index). */
  async listPendingLines(): Promise<RepositoryResult<AiPricePendingLine[]>> {
    const methodLogger = this.logger.child({ method: 'listPendingLines' });
    const startTime = Date.now();

    try {
      const { data, error } = await this.supabase
        .from(LINES_TABLE)
        .select(PENDING_LINE_COLUMNS)
        .eq('state', 'pending')
        .order('created_at', { ascending: false });

      if (error) throw toError(error);

      methodLogger.debug({ count: data?.length || 0, duration: Date.now() - startTime }, 'Pending price lines fetched');
      return { data: (data as unknown as AiPricePendingLine[]) || [], error: null };
    } catch (error) {
      const wrapped = toError(error);
      methodLogger.error({ err: wrapped, duration: Date.now() - startTime }, 'Failed to fetch pending price lines');
      return { data: null, error: wrapped };
    }
  }

  /**
   * Slice 8: the lines Apply or Dismiss was asked about, by id, with their state
   * and the snapshot of what was charged when each was recorded (exact text).
   * Lines not found are simply absent; the caller compares the counts.
   */
  async findLinesForDecision(ids: readonly string[]): Promise<RepositoryResult<AiPriceDecisionLine[]>> {
    const methodLogger = this.logger.child({ method: 'findLinesForDecision', count: ids.length });
    const startTime = Date.now();

    try {
      const { data, error } = await this.supabase.from(LINES_TABLE).select(DECISION_LINE_COLUMNS).in('id', [...ids]);

      if (error) throw toError(error);

      methodLogger.debug({ found: data?.length || 0, duration: Date.now() - startTime }, 'Decision lines fetched');
      return { data: (data as unknown as AiPriceDecisionLine[]) || [], error: null };
    } catch (error) {
      const wrapped = toError(error);
      methodLogger.error({ err: wrapped, duration: Date.now() - startTime }, 'Failed to fetch decision lines');
      return { data: null, error: wrapped };
    }
  }

  /**
   * Slice 9: the lines behind live price rows, by id, for the price history
   * (ADMIN ONLY: the history route). De-duplicated and read in chunks of
   * `LINE_ID_CHUNK`; an empty list answers `[]` with no query; a non-UUID id is
   * refused before any query. Lines not found are simply absent: the caller
   * reports a missing record, never a guessed one.
   */
  async findAppliedLinesByIds(ids: readonly string[]): Promise<RepositoryResult<AiPriceAppliedLineRecord[]>> {
    const unique = [...new Set(ids)];
    const methodLogger = this.logger.child({ method: 'findAppliedLinesByIds', count: unique.length });
    const startTime = Date.now();

    try {
      if (!unique.every((id) => typeof id === 'string' && UUID_PATTERN.test(id))) {
        throw new Error('Every line id must be a UUID');
      }
      const found: AiPriceAppliedLineRecord[] = [];
      for (let start = 0; start < unique.length; start += LINE_ID_CHUNK) {
        const { data, error } = await this.supabase
          .from(LINES_TABLE)
          .select(APPLIED_LINE_HISTORY_COLUMNS)
          .in('id', unique.slice(start, start + LINE_ID_CHUNK));
        if (error) throw toError(error);
        found.push(...((data as unknown as AiPriceAppliedLineRecord[]) || []));
      }

      methodLogger.debug({ found: found.length, duration: Date.now() - startTime }, 'Applied lines fetched for the price history');
      return { data: found, error: null };
    } catch (error) {
      const wrapped = toError(error);
      methodLogger.error({ err: wrapped, duration: Date.now() - startTime }, 'Failed to fetch applied lines for the price history');
      return { data: null, error: wrapped };
    }
  }

  /**
   * Slice 8: dismiss pending lines with the admin's reason, through
   * `ai_price_dismiss_lines` (one transaction; the same lock order as submit and
   * apply, SA RC-5). Changes no price.
   */
  async dismissLines(input: {
    adminUserId: string;
    lineIds: readonly string[];
    reason: string;
  }): Promise<RepositoryResult<Array<{ lineId: string; decidedAt: string }>>> {
    const methodLogger = this.logger.child({ method: 'dismissLines', lineCount: input.lineIds.length });
    const startTime = Date.now();

    try {
      const { data, error } = await this.supabase.rpc(DISMISS_FUNCTION, {
        p_admin_user_id: input.adminUserId,
        p_line_ids: [...input.lineIds],
        p_reason: input.reason,
      });

      if (error) throw toError(error);

      const rows = ((data as Array<{ out_line_id: string; out_decided_at: string }> | null) ?? []).map((row) => ({
        lineId: row.out_line_id,
        decidedAt: row.out_decided_at,
      }));

      methodLogger.info({ count: rows.length, duration: Date.now() - startTime }, 'Pending price lines dismissed');
      return { data: rows, error: null };
    } catch (error) {
      const wrapped = toError(error);
      methodLogger.error({ err: wrapped, code: wrapped.code, duration: Date.now() - startTime }, 'Failed to dismiss pending price lines');
      return { data: null, error: wrapped };
    }
  }
}

export const aiPriceProposalRepository = new AiPriceProposalRepository();
