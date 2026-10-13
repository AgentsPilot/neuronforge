// lib/repositories/LegacyBoostPackPurchaseRepository.ts
//
// Data access for `boost_pack_purchases`, the AGENT-PLATFORM record of a
// Pilot-Credit boost pack bought through Stripe. Not
// `business_os_boost_purchases`, which `BusinessOsBoostPurchaseRepository` owns,
// and not `boost_packs` (the catalog), which `BoostPackRepository` owns.
//
// Workplan: docs/workplans/BUSINESS_OS_WEBHOOK_CONNECT_REPOSITORIES_WORKPLAN.md
//           (CF-5 PR 5; SA rulings Q-3 and C-3)
//
// Only the Stripe webhook's insert lives here: the legacy boost-pack branch of
// `handleCheckoutCompleted` (FU-2). The boost checkout was switched off in
// plan payments P-10a, so only sessions opened before it can still arrive.
// Do not add callers; the branch is to be deleted with FU-2.
//
// ── WHY THE METHOD LOOKS THE WAY IT DOES ────────────────────────────────────
// It was moved out of `app/api/stripe/webhook/route.ts` with no behaviour
// change (CLAUDE.md rule 1). It issues exactly the insert the route issued,
// with the row the route built. The webhook's characterisation harness
// records the full query chain, so a method that drifted would fail its
// snapshot.
//
// ── SERVICE ROLE (intentional RLS bypass, documented per CLAUDE.md) ─────────
// A Stripe webhook has no user session. The row's `user_id` is
// `metadata.user_id` on a PLATFORM checkout session our own agent-platform
// checkout created, never a connected account's metadata (workplan §5.1).
//
// ── ERRORS AND LOGGING ──────────────────────────────────────────────────────
// supabase-js's own `{ data, error }`, the same error object. No try/catch: a
// thrown query must still reach the route, which answers 500 so Stripe
// retries. No logging: the route logs a returned error itself.
//
// CALLERS: `app/api/stripe/webhook/route.ts` (`handleCheckoutCompleted`) only.
// Server-only: never import from a 'use client' file.

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';

/**
 * A legacy boost-pack purchase, as the webhook writes it. The route builds it
 * as an object literal, so an extra key fails `tsc` (SA C-3).
 */
export interface NewLegacyBoostPackPurchaseRow {
  user_id: string;
  boost_pack_id: string;
  transaction_id: string | null;
  credits_purchased: number;
  bonus_credits: number;
  price_paid_usd: number;
  stripe_payment_intent_id: string;
  payment_status: 'succeeded';
  metadata: {
    stripe_session_id: string;
    boost_pack_id: string;
    amount_total: number | null;
  };
}

/** supabase-js's result, passed through unchanged (same error object). */
export interface LegacyBoostPackPurchaseResult<T> {
  data: T | null;
  error: PostgrestError | null;
}

export class LegacyBoostPackPurchaseRepository {
  private supabase: SupabaseClient;

  constructor(supabaseClient?: SupabaseClient) {
    // Service-role client by design: see the security note at the top of the file.
    this.supabase = supabaseClient || defaultSupabase;
  }

  // Stripe webhook: keyed by Stripe ids or rows the route has already proved owned (⟨unscoped-by-design⟩)
  //
  // No `user_id` filter (an insert has none), bounded per
  // docs/REPOSITORY_STRATEGY.md ("unscoped by design"). The doc below names
  // where the row's owner comes from. A unit test asserts the row is passed
  // through as given.

  /**
   * ⟨unscoped-by-design⟩ Records one legacy boost-pack purchase.
   *
   * Owner check relied on: no `accountOwns` applies (not a Connect row). The
   * row's `user_id` is `metadata.user_id` on a platform checkout session our
   * own checkout created (workplan §5.1).
   */
  async insert(row: NewLegacyBoostPackPurchaseRow): Promise<LegacyBoostPackPurchaseResult<null>> {
    const { error } = await this.supabase.from('boost_pack_purchases').insert(row);
    return { data: null, error };
  }
}

export const legacyBoostPackPurchaseRepository = new LegacyBoostPackPurchaseRepository();
