// lib/repositories/CreditTransactionRepository.ts
// Repository for `credit_transactions`. Read-only, with ONE write: the Stripe
// webhook's legacy boost-pack ledger row (`insertReturningId`, CF-5 PR 5).
//
// `credit_transactions` is a Pilot-Credit (agent platform) table. The GDPR data
// export no longer reads it (DE-1, BUSINESS_OS_DATA_EXPORT_DE1_WORKPLAN.md:
// billing and credits are out of the export, DX-1a). Its other
// writes stay where they are: CreditService, rewardService and the other Stripe
// routes. This repository exists so the Settings billing summary
// (GET /api/billing/summary) reads it through the repository layer (CLAUDE.md
// rule 1; DATA_EXPORT_REPOSITORY_REFACTOR_WORKPLAN.md OP-1),
// and so the webhook's one inline insert moved here with no behaviour change
// (BUSINESS_OS_WEBHOOK_CONNECT_REPOSITORIES_WORKPLAN.md §3, SA-approved).
//
// Business OS must not read or write this table through this repository: its
// credits live in the business_os_credit_* tables (B-8 / RD-2). Adding any other
// write method here needs SA review.
//
// Service role, on purpose: it defaults to `supabaseServer`, as its siblings do.
// The tenant boundary is `.eq('user_id', userId)` on every read, where the caller
// passes the AUTHENTICATED user id, never a request value. The billing-summary
// route injects the caller's RLS client instead, so RLS applies there as well.
//
// Server-only: never import from a 'use client' file.

import { SupabaseClient, type PostgrestError } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, Logger } from '@/lib/logger';
import type { AgentRepositoryResult as RepositoryResult } from './types';

export class CreditTransactionRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'CreditTransactionRepository' });
  }

  /**
   * Settings billing screen (GET /api/billing/summary): the caller's total
   * `credits_delta` per activity type, for the types asked for. A type with no
   * rows is present as 0, so the caller never has to default it. Summed here,
   * on the server, so the browser gets two numbers instead of every row.
   *
   * Same read the browser used to make (`credits_delta` filtered by
   * `activity_type`), merged into one `.in()` round trip.
   */
  async sumCreditsDeltaByActivityType(
    userId: string,
    activityTypes: readonly string[]
  ): Promise<RepositoryResult<Record<string, number>>> {
    const totals: Record<string, number> = {};
    for (const type of activityTypes) totals[type] = 0;
    if (activityTypes.length === 0) return { data: totals, error: null };

    try {
      const { data, error } = await this.supabase
        .from('credit_transactions')
        .select('activity_type, credits_delta')
        .eq('user_id', userId)
        .in('activity_type', [...activityTypes]);

      if (error) throw error;

      for (const row of (data ?? []) as Array<{ activity_type: string | null; credits_delta: number | null }>) {
        if (row.activity_type !== null && row.activity_type in totals) {
          totals[row.activity_type] += Number(row.credits_delta) || 0;
        }
      }
      return { data: totals, error: null };
    } catch (error) {
      this.logger.error(
        { err: error, userId, method: 'sumCreditsDeltaByActivityType' },
        'Failed to sum credit transactions by activity type'
      );
      return { data: null, error: error as Error };
    }
  }

  // Stripe webhook: keyed by Stripe ids or rows the route has already proved owned (⟨unscoped-by-design⟩)
  //
  // Moved out of `app/api/stripe/webhook/route.ts` (the agent-platform boost-pack
  // checkout, FU-2) with no behaviour change (CF-5 PR 5, CLAUDE.md rule 1). It
  // issues exactly the query the route issued inline: insert, `select('id')`,
  // `.single()`. The webhook's characterisation harness records the full chain.
  //
  // Errors: supabase-js's own `{ data, error }`, with no try/catch and no
  // logging, unlike the methods above. The route logs a returned error itself;
  // a catch would turn a thrown query into a quiet result where the route used
  // to fail with 500 and let Stripe retry.

  /**
   * ⟨unscoped-by-design⟩ Records a legacy boost-pack purchase in the Pilot-Credit
   * ledger and returns the new row's id.
   *
   * Owner check relied on: no `accountOwns` applies (not a Connect row). The
   * row's `user_id` is `metadata.user_id` on a PLATFORM checkout session that
   * our own agent-platform checkout created (workplan §5.1); the route builds
   * the row as an object literal of `NewLegacyBoostCreditRow`, so an extra key
   * fails `tsc`.
   */
  async insertReturningId(row: NewLegacyBoostCreditRow): Promise<LegacyCreditInsertResult> {
    const { data, error } = await this.supabase
      .from('credit_transactions')
      .insert(row)
      .select('id')
      .single<{ id: string }>();
    return { data, error };
  }
}

/** The ledger row the webhook writes for a legacy boost pack (CF-5 PR 5). */
export interface NewLegacyBoostCreditRow {
  user_id: string;
  credits_delta: number;
  balance_before: number;
  balance_after: number;
  transaction_type: 'allocation';
  activity_type: 'boost_pack_purchase';
  description: string;
  metadata: {
    stripe_session_id: string;
    /** Stripe's `session.payment_intent`, stored as it arrives (id, object or null). */
    stripe_payment_intent_id: unknown;
    boost_pack_id: string | undefined;
    amount_paid_cents: number | null;
  };
}

/** supabase-js's own result for `insertReturningId`, error object kept. */
export interface LegacyCreditInsertResult {
  data: { id: string } | null;
  error: PostgrestError | null;
}

// Singleton instance for convenience (mirrors the rest of lib/repositories).
export const creditTransactionRepository = new CreditTransactionRepository();
