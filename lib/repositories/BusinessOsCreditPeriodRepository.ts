// lib/repositories/BusinessOsCreditPeriodRepository.ts
//
// The billing-period key of the Business OS credit ledger, from the database's
// own rule: `business_os_credit_period_start(anchor, at)`.
//
// Schema:   supabase/migrations/20261015_business_os_credit_charges.sql
// Workplan: docs/workplans/BUSINESS_OS_CREDIT_DEDUCTION_SLICE_6_WORKPLAN.md §4.2 (SA Q-1, W6-8)
//
// ── WHY ASK THE DATABASE (SA SQ-20) ──────────────────────────────────────────
// The charge recorder names each charge's period with this function. The owner
// card must look the period up by the SAME key, and a key recomputed in Node
// could disagree at a month end (clamping) or lose the anchor's microseconds.
// So the key comes from the one function that writes it, and both arguments and
// the answer travel as the strings PostgREST speaks — never through a `Date`.
//
// ── SERVICE ROLE (intentional RLS bypass, documented per CLAUDE.md) ─────────
// EXECUTE on the function is granted to `service_role` only, so the owner's RLS
// client cannot call it. The bypass exposes nothing: the function is `STABLE`,
// `SECURITY INVOKER`, runs with an empty `search_path` and READS NO TABLE — it is
// date arithmetic over its two arguments.
//
// ── ACCOUNT SCOPE: N/A BY DESIGN ─────────────────────────────────────────────
// CLAUDE.md rule 4 (`.eq('user_id', …)` on every query) does not apply: there is
// no table and no account id crosses this method. Its inputs are two timestamps.
// A source test pins exactly one `.rpc(` call, no `.from(` and no `user_id`.
//
// Methods never throw: they return `{ data, error }`.

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, type Logger } from '@/lib/logger';
import type { AgentRepositoryResult as RepositoryResult } from './types';

/**
 * A timestamptz as PostgREST writes it, or as `Date.toISOString()` does.
 *
 * Strict on purpose: a value that is not one of these is refused before any
 * call, so a stray `Date.toString()` or a bare date can never become a key.
 * Fractional seconds up to microseconds; a `Z` or a `±HH:MM` offset.
 */
const TIMESTAMPTZ_PATTERN =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/;

class CreditPeriodGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CreditPeriodGuardError';
  }
}

export function isTimestamptzString(value: unknown): value is string {
  return typeof value === 'string' && TIMESTAMPTZ_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}

export class BusinessOsCreditPeriodRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    // Service role by default: the function's EXECUTE is service_role only. See the header.
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'BusinessOsCreditPeriodRepository' });
  }

  /**
   * The start of the billing period that contains `at`, for a plan anchored at
   * `anchor` — the exact string the recorder writes as `period_start`.
   */
  async periodStartFor(anchor: string, at: string): Promise<RepositoryResult<string>> {
    const method = 'periodStartFor';
    try {
      if (!isTimestamptzString(anchor) || !isTimestamptzString(at)) {
        throw new CreditPeriodGuardError('Both the anchor and the instant must be timestamptz strings');
      }

      const { data, error } = await this.supabase.rpc('business_os_credit_period_start', {
        p_anchor: anchor,
        p_at: at,
      });
      if (error) throw error;
      if (typeof data !== 'string' || !isTimestamptzString(data)) {
        throw new Error('The period function returned no timestamp');
      }

      return { data, error: null };
    } catch (error) {
      if (error instanceof CreditPeriodGuardError) {
        this.logger.warn({ method, err: error }, 'Credit period lookup refused by its guard');
      } else {
        this.logger.error({ method, err: error }, 'Credit period lookup failed');
      }
      return { data: null, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }
}

/** Singleton for convenience, matching the rest of the repository layer. */
export const businessOsCreditPeriodRepository = new BusinessOsCreditPeriodRepository();
