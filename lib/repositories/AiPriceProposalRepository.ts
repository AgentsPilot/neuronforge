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
// There is deliberately NO update or delete method. Line state moves only
// inside database functions, and a database trigger refuses any move that is
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

const PENDING_LINE_COLUMNS =
  'id, proposal_id, kind, provider, model_name, image_size, image_quality, input_per_1m, output_per_1m, ' +
  'cached_input_per_1m, price_per_image, source_url, checked_on, flags, cross_check_verdict, cross_check_value, ' +
  'cross_check_diff_pct, cross_check_source, cross_check_fetched_at, created_by, created_at';

const ROUND_COLUMNS = 'id, created_at, created_by, provider_outcomes';

/** An error carrying the Postgres SQLSTATE, when there is one. */
export interface PriceRepositoryError extends Error {
  code?: string;
}

function toError(error: unknown): PriceRepositoryError {
  if (error instanceof Error) return error as PriceRepositoryError;
  const record = (error ?? {}) as { message?: unknown; code?: unknown };
  const wrapped: PriceRepositoryError = new Error(
    typeof record.message === 'string' ? record.message : 'Pending price query failed'
  );
  if (typeof record.code === 'string') wrapped.code = record.code;
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
}

export const aiPriceProposalRepository = new AiPriceProposalRepository();
