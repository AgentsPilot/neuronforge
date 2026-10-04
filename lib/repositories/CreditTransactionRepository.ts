// lib/repositories/CreditTransactionRepository.ts
// Repository for `credit_transactions`. READ-ONLY, by design.
//
// `credit_transactions` is a Pilot-Credit (agent platform) table. Its writes stay
// where they are: CreditService, rewardService and the Stripe routes. This
// repository exists so the GDPR data export reads it through the repository
// layer (CLAUDE.md rule 1; DATA_EXPORT_REPOSITORY_REFACTOR_WORKPLAN.md OP-1).
//
// Business OS must not read or write this table through this repository: its
// credits live in the business_os_credit_* tables (B-8 / RD-2). Adding any write
// method here needs SA review.
//
// Service role, on purpose: it defaults to `supabaseServer`, as its siblings do.
// The tenant boundary is `.eq('user_id', userId)` on every read, where the caller
// passes the AUTHENTICATED user id, never a request value.
//
// Server-only: never import from a 'use client' file.

import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, Logger } from '@/lib/logger';
import type { AgentRepositoryResult as RepositoryResult } from './types';

/**
 * The columns the GDPR export reads from `credit_transactions`
 * (listForUserDataExport; DATA_EXPORT_FOLLOWUPS_WORKPLAN.md §4.7). Today that
 * is every column, listed by name so a column added later is NOT exported until
 * someone decides it should be. Changing this changes what the export holds: a
 * privacy decision.
 *
 * `metadata` is exported WHOLE. Today it holds token counts, the multiplier,
 * the intensity score, the amount paid and Stripe reference ids (kept by user
 * decision BQ-2, 2026-10-04), and no provider cost. A writer that adds our
 * provider cost (e.g. an `actual_cost_usd` key) to `metadata` would leak it into
 * every customer's download, against user decision BQ-1 (2026-10-04): nothing
 * here scrubs it (SA OP-6). Add a scrub before writing such a key.
 */
const CREDIT_TRANSACTION_DATA_EXPORT_COLUMNS =
  'id, user_id, credits_delta, transaction_type, description, related_agent_id, created_at, ' +
  'token_usage_id, activity_type, balance_before, balance_after, boost_pack_id, reward_config_id, ' +
  'stripe_payment_intent_id, metadata, activity_name, agent_id, session_id';

export class CreditTransactionRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'CreditTransactionRepository' });
  }

  /**
   * GDPR export only (GET /api/user/data-export, Art. 15 / 20). The caller's
   * credit transactions since `since` (an ISO timestamp the route computes),
   * CREDIT_TRANSACTION_DATA_EXPORT_COLUMNS only, newest first, at most 5000. The
   * column set and the cap are fixed; changing them changes what the export
   * holds, which is a privacy decision.
   */
  async listForUserDataExport(userId: string, since: string): Promise<RepositoryResult<Record<string, unknown>[]>> {
    try {
      const { data, error } = await this.supabase
        .from('credit_transactions')
        .select(CREDIT_TRANSACTION_DATA_EXPORT_COLUMNS)
        .eq('user_id', userId)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(5000);

      if (error) throw error;
      return { data: (data ?? []) as unknown as Record<string, unknown>[], error: null };
    } catch (error) {
      this.logger.error({ err: error, userId }, 'Failed to list credit transactions for the data export');
      return { data: null, error: error as Error };
    }
  }
}

// Singleton instance for convenience (mirrors the rest of lib/repositories).
export const creditTransactionRepository = new CreditTransactionRepository();
