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
  AiPricePendingLine,
  AiPriceSubmitInput,
  AiPriceSubmitResultLine,
} from './types';

const LINES_TABLE = 'ai_price_proposal_lines';
const SUBMIT_FUNCTION = 'ai_price_submit_pending';

const PENDING_LINE_COLUMNS =
  'id, proposal_id, kind, provider, model_name, image_size, image_quality, input_per_1m, output_per_1m, ' +
  'cached_input_per_1m, price_per_image, source_url, checked_on, flags, cross_check_verdict, created_by, created_at';

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
  out_line_id: string;
  out_line_index: number;
  out_superseded_line_id: string | null;
}

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

      const rows = ((data as SubmitRow[] | null) ?? []).map((row) => ({
        proposalId: row.out_proposal_id,
        lineId: row.out_line_id,
        lineIndex: row.out_line_index,
        supersededLineId: row.out_superseded_line_id,
      }));

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
