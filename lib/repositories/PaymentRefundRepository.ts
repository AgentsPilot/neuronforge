// lib/repositories/PaymentRefundRepository.ts
//
// Data access for `payment_refunds`, the refund ledger: one row per refund,
// keyed on the processor's own refund id (unique `processor_refund_id`), so the
// app, the reconciler and the Stripe webhook converge on a single row per
// refund. The transaction and invoice totals follow from it by trigger.
//
// Workplan: docs/workplans/BUSINESS_OS_WEBHOOK_CONNECT_REPOSITORIES_WORKPLAN.md
//           (CF-5 PR 3, §7.3.4; SA rulings Q-3 and C-3)
//
// Only the Stripe webhook's write lives here so far. `RefundService` and
// `ledgerService` still write the table directly; moving them is out of scope
// for CF-5 (workplan §3).
//
// ── WHY THE METHOD LOOKS THE WAY IT DOES ────────────────────────────────────
// It was moved out of `app/api/stripe/webhook/route.ts` with no behaviour
// change (CLAUDE.md rule 1). It issues exactly the query the route issued: the
// same upsert, with the row the route built and the same conflict target. The
// webhook's characterisation harness records the full query chain, so a method
// that drifted would fail its snapshot.
//
// ── SERVICE ROLE (intentional RLS bypass, documented per CLAUDE.md) ─────────
// A Stripe webhook has no user session. The row's `user_id`, `transaction_id`
// and `invoice_id` come from a payment row the route found by a Stripe
// reference from a signature-verified event; the conflict target is Stripe's
// refund id, which no business can choose (see the method's doc).
//
// ── ERRORS AND LOGGING ──────────────────────────────────────────────────────
// supabase-js's own `{ data, error }`, the same error object. No try/catch: a
// thrown query must still reach the route, which answers 500 so Stripe retries.
// No logging: the route logs the error it acts on, with the event and refund ids.
//
// CALLERS: `app/api/stripe/webhook/route.ts` (`handleChargeRefunded`) only.

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';

/**
 * A refund Stripe reported (`charge.refunded`), as the webhook records it. The
 * route builds it as an object literal, so an extra key fails `tsc` (SA C-3).
 */
export interface NewStripeRefundRow {
  user_id: string;
  transaction_id: string;
  invoice_id: string | null;
  amount: number;
  amount_minor: number;
  currency: string;
  status: 'succeeded' | 'pending';
  processor_type: 'stripe';
  processor_refund_id: string;
  stripe_connect_account_id: string | null;
  idempotency_key: string;
  source: 'webhook';
  succeeded_at: string | null;
  metadata: { origin: 'charge.refunded'; charge_id: string };
}

/** supabase-js's result, passed through unchanged (same error object). */
export interface PaymentRefundResult<T> {
  data: T | null;
  error: PostgrestError | null;
}

export class PaymentRefundRepository {
  private supabase: SupabaseClient;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || defaultSupabase;
  }

  // Stripe webhook: keyed by Stripe ids or rows the route has already proved owned (⟨unscoped-by-design⟩)
  //
  // No `user_id` filter, as an exception to rule 4, bounded per
  // docs/REPOSITORY_STRATEGY.md ("unscoped by design"). The doc below names
  // what the write relies on instead. A unit test asserts it adds none.

  /**
   * ⟨unscoped-by-design⟩ Records or refreshes one Stripe refund, upserted on
   * `processor_refund_id`, so a redelivered `charge.refunded` converges on the
   * same row.
   *
   * Owner check relied on: the route has no `accountOwns` here (FU-3). The
   * payment was found by a Stripe reference from a signature-verified event, and
   * `user_id`, `transaction_id` and `invoice_id` are copied from that payment
   * row, never from the event. The conflict target is Stripe's refund id, which
   * the sending account cannot choose, so the upsert cannot land on another
   * business's refund (`tenant-isolation-guard` Step 4).
   */
  async upsertFromStripe(row: NewStripeRefundRow): Promise<PaymentRefundResult<null>> {
    const { error } = await this.supabase
      .from('payment_refunds')
      .upsert(row, { onConflict: 'processor_refund_id' });
    return { data: null, error };
  }
}

// Singleton instance for convenience
export const paymentRefundRepository = new PaymentRefundRepository();
