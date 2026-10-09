// lib/repositories/BillingEventRepository.ts
//
// Data access for `billing_events`, the AGENT-PLATFORM billing history (Pilot
// Credits). Not `business_os_billing_events`, which has its own Business OS
// repository. (That repository is deliberately not named here: its source
// guard counts every file that names it.)
//
// Workplan: docs/workplans/BUSINESS_OS_WEBHOOK_CONNECT_REPOSITORIES_WORKPLAN.md
//           (CF-5 PR 5; SA rulings Q-3 and C-3)
//
// Only the Stripe webhook's two inserts live here: the legacy dunning handler
// (`renewal_failed`, FU-1, unreachable through POST today) and the
// subscription-deleted mirror (`subscription_canceled`, FU-6). `CreditService`
// still writes the table directly; moving it is out of scope for CF-5.
//
// ── WHY THE METHOD LOOKS THE WAY IT DOES ────────────────────────────────────
// It was moved out of `app/api/stripe/webhook/route.ts` with no behaviour
// change (CLAUDE.md rule 1). It issues exactly the insert the route issued,
// with the row the route built: the same keys, kept exactly as they were even
// where they look odd (the dunning row stores the invoice id as
// `stripe_event_id`). The webhook's characterisation harness records the full
// query chain, so a method that drifted would fail its snapshot.
//
// ── SERVICE ROLE (intentional RLS bypass, documented per CLAUDE.md) ─────────
// A Stripe webhook has no user session. The row's `user_id` is `metadata.user_id`
// on a PLATFORM Stripe object our own agent-platform checkout created, never a
// connected account's metadata (workplan §5.1).
//
// ── ERRORS AND LOGGING ──────────────────────────────────────────────────────
// supabase-js's own `{ data, error }`, the same error object. No try/catch: a
// thrown query must still reach the route, which answers 500 so Stripe
// retries. No logging: the route ignores this insert's result today (FU-9).
//
// CALLERS: `app/api/stripe/webhook/route.ts` (`handleInvoicePaymentFailed`,
// `handleSubscriptionDeleted`) only. Server-only: never import from a
// 'use client' file.

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';

/**
 * A legacy billing event, as the webhook writes it. The route builds it as an
 * object literal, so an extra key fails `tsc` (SA C-3). The four Stripe keys
 * are present on the dunning row only.
 */
export interface NewLegacyBillingEventRow {
  user_id: string;
  event_type: 'renewal_failed' | 'subscription_canceled';
  credits_delta: number;
  description: string;
  stripe_event_id?: string;
  stripe_invoice_id?: string;
  amount_cents?: number;
  currency?: string;
}

/** supabase-js's result, passed through unchanged (same error object). */
export interface BillingEventResult<T> {
  data: T | null;
  error: PostgrestError | null;
}

export class BillingEventRepository {
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
   * ⟨unscoped-by-design⟩ Records one legacy billing event.
   *
   * Owner check relied on: no `accountOwns` applies (not a Connect row). The
   * row's `user_id` is `metadata.user_id` on a platform invoice or subscription
   * our own checkout created (workplan §5.1).
   */
  async insert(row: NewLegacyBillingEventRow): Promise<BillingEventResult<null>> {
    const { error } = await this.supabase.from('billing_events').insert(row);
    return { data: null, error };
  }
}

export const billingEventRepository = new BillingEventRepository();
