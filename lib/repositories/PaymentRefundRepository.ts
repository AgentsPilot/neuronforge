// lib/repositories/PaymentRefundRepository.ts
//
// Data access for `payment_refunds`, the refund ledger: one row per refund. The
// transaction, invoice and booking totals follow from it by trigger
// (`recompute_transaction_refund_state`, `propagate_refund_to_*`), and
// `refund_guard_before` refuses a row that would refund more than was paid.
//
// Requirement: docs/requirements/STRIPE_CONNECT_REFUND_WEBHOOK_REQUIREMENT.md
//              (FR 13, SA-6, A-2)
// Workplan:    docs/workplans/STRIPE_CONNECT_REFUND_WEBHOOK_WORKPLAN.md §3.2
//
// ── WHY THREE NARROW METHODS AND NO UPSERT (SA-6) ───────────────────────────
// The webhook used to upsert on `processor_refund_id`. That overwrote an app
// row's `source` / `idempotency_key` / `metadata`, could move a status
// backwards under concurrent delivery, and targeted a PARTIAL unique index that
// `ON CONFLICT` cannot infer. It never ran in prod. In its place:
//   - `findForStripeRefund`: two plain reads, by Stripe's refund id, then by
//     the app's own row id from the refund's metadata;
//   - `insertFromStripe`: a plain insert of a closed row type, no ON CONFLICT
//     (a duplicate surfaces as 23505 and the caller re-reads);
//   - `applyStripeRefundState`: a compare-and-set UPDATE whose patch type cannot
//     carry the app's own columns, so status moves are atomic, never
//     read-then-write.
//
// ── SCOPING (CLAUDE.md rule 4, met literally) ───────────────────────────────
// Every query filters by `user_id` AND `transaction_id`. The caller passes the
// owner it has proved (the webhook: `accountOwns(event.account, …)` on the
// payment row; `RefundService`: the authenticated user) and the payment that
// owner was proved on, so a row id taken from untrusted Stripe metadata can only
// ever be found inside that payment (`tenant-isolation-guard` Step 2).
//
// ── SERVICE ROLE (intentional RLS bypass, documented per CLAUDE.md) ─────────
// `payment_refunds` is SELECT-only under RLS (20260828b); every write is the
// server's. The Stripe webhook has no user session at all.
//
// ── POSTGREST ───────────────────────────────────────────────────────────────
// No `.or()` and no `.select()` on the update (UPDATE + .or + .select fails
// with 42703 in prod); the update asks for `{ count: 'exact' }` instead. The
// insert reads nothing back.
//
// ── ERRORS AND LOGGING ──────────────────────────────────────────────────────
// supabase-js's own `{ data, error }`, the same error object. No try/catch: a
// thrown query must still reach the caller (the webhook answers 500 so Stripe
// retries). No logging: each caller logs the error it acts on, with its ids.
//
// CALLERS: `app/api/stripe/webhook/route.ts` (`handleConnectRefund`) and
// `lib/payments/RefundService.ts` (`refund()`, its two post-reply writes).

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import type { LedgerRefundStatus } from '@/lib/payments/stripeRefundLedger';

/** supabase-js's result, passed through unchanged (same error object). */
export interface PaymentRefundResult<T> {
  data: T | null;
  error: PostgrestError | null;
}

/**
 * The columns `findForStripeRefund` returns: what the A-1 checks and the
 * transition table read, plus `stripe_connect_account_id` so the webhook fills
 * it only when it is NULL and never overwrites it (SA Q-SA-4).
 */
export const STRIPE_REFUND_MATCH_COLUMNS =
  'id, status, processor_refund_id, source, processor_type, amount_minor, currency, stripe_connect_account_id';

/** A ledger row as `findForStripeRefund` returns it. */
export interface StripeRefundLedgerRow {
  id: string;
  status: LedgerRefundStatus;
  processor_refund_id: string | null;
  source: string;
  processor_type: string;
  amount_minor: number;
  currency: string;
  stripe_connect_account_id: string | null;
}

/** Which key found the row: Stripe's refund id (a) or the app's metadata row id (b). */
export interface StripeRefundMatch {
  row: StripeRefundLedgerRow;
  matchedBy: 'processor_refund_id' | 'ledger_row_id';
}

/**
 * A refund Stripe reported that the ledger has no row for yet (FR 3 c). The
 * webhook builds it as an object literal, so an extra key fails `tsc`. Its
 * `metadata` is ours, never Stripe's.
 */
export interface NewWebhookRefundRow {
  user_id: string;
  transaction_id: string;
  invoice_id: string | null;
  amount: number;
  amount_minor: number;
  currency: string;
  status: LedgerRefundStatus;
  processor_type: 'stripe';
  processor_refund_id: string;
  stripe_connect_account_id: string;
  /** Deterministic, so a redelivery cannot open a second row. */
  idempotency_key: `stripe:${string}`;
  source: 'webhook';
  /** The Stripe refund's own `created` time, not the insert time (SA-11). */
  created_at: string;
  succeeded_at: string | null;
  failure_code: string | null;
  failure_message: string | null;
  metadata: {
    origin: 'refund.created' | 'refund.updated' | 'refund.failed';
    charge_id: string | null;
    payment_intent_id: string | null;
  };
}

/**
 * What a compare-and-set update may change (A-2, F2-f). CLOSED: it cannot carry
 * `source`, `idempotency_key`, `reason`, `reason_note`, `initiated_by`,
 * `metadata`, the amounts, `user_id` or `created_at`, so updating an app row
 * keeps everything the app wrote. `updated_at` is required: on an id-only fill
 * the guard trigger does not fire, so the patch is its only source (SA C-7).
 */
export interface StripeRefundStatePatch {
  status?: LedgerRefundStatus;
  processor_refund_id?: string;
  stripe_connect_account_id?: string;
  succeeded_at?: string;
  failure_code?: string | null;
  failure_message?: string | null;
  updated_at: string;
}

/** The state a compare-and-set update requires the row to still be in. */
export interface ExpectedRefundState {
  status: LedgerRefundStatus;
  processorRefundId: string | null;
}

export class PaymentRefundRepository {
  private supabase: SupabaseClient;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || defaultSupabase;
  }

  /**
   * The ledger row a Stripe refund belongs to, inside one proven payment
   * (FR 3 a/b). (a) by Stripe's refund id; only if (a) finds nothing and a
   * metadata row id was given, (b) by that row id. Two plain reads, no `.or()`.
   *
   * `data: null` with no error means no row in this payment answers to either
   * key. A read error returns at once, so the caller never mistakes an outage
   * for "no row" and inserts a duplicate.
   */
  async findForStripeRefund(
    userId: string,
    transactionId: string,
    keys: { processorRefundId: string; ledgerRowId?: string | null }
  ): Promise<PaymentRefundResult<StripeRefundMatch>> {
    const byStripeId = await this.supabase
      .from('payment_refunds')
      .select(STRIPE_REFUND_MATCH_COLUMNS)
      .eq('user_id', userId)
      .eq('transaction_id', transactionId)
      .eq('processor_refund_id', keys.processorRefundId)
      .maybeSingle();

    if (byStripeId.error) return { data: null, error: byStripeId.error };
    if (byStripeId.data) {
      return { data: { row: byStripeId.data as StripeRefundLedgerRow, matchedBy: 'processor_refund_id' }, error: null };
    }

    if (!keys.ledgerRowId) return { data: null, error: null };

    const byRowId = await this.supabase
      .from('payment_refunds')
      .select(STRIPE_REFUND_MATCH_COLUMNS)
      .eq('id', keys.ledgerRowId)
      .eq('transaction_id', transactionId)
      .eq('user_id', userId)
      .maybeSingle();

    if (byRowId.error) return { data: null, error: byRowId.error };
    if (!byRowId.data) return { data: null, error: null };
    return { data: { row: byRowId.data as StripeRefundLedgerRow, matchedBy: 'ledger_row_id' }, error: null };
  }

  /**
   * Records a refund the ledger has no row for (FR 3 c). A plain insert: no
   * ON CONFLICT, nothing read back. A unique violation (23505, on either the
   * idempotency key or the processor id) comes back as the error, and the
   * caller re-reads. `user_id` and `transaction_id` are the proven owner and
   * payment, set by the caller from the payment row.
   */
  async insertFromStripe(row: NewWebhookRefundRow): Promise<PaymentRefundResult<null>> {
    const { error } = await this.supabase.from('payment_refunds').insert(row);
    return { data: null, error };
  }

  /**
   * Compare-and-set (A-2, FR 13). Applies `patch` only if the row is still in
   * `expected` state: the same status, and the same `processor_refund_id`
   * (`.is(null)` when it had none). `count` is how many rows changed: 0 means
   * someone else moved the row first (a concurrent event, or the app's own
   * write), and the caller decides what that means.
   */
  async applyStripeRefundState(
    userId: string,
    transactionId: string,
    id: string,
    expected: ExpectedRefundState,
    patch: StripeRefundStatePatch
  ): Promise<PaymentRefundResult<{ count: number | null }>> {
    const scoped = this.supabase
      .from('payment_refunds')
      .update(patch, { count: 'exact' })
      .eq('id', id)
      .eq('transaction_id', transactionId)
      .eq('user_id', userId)
      .eq('status', expected.status);

    const { error, count } =
      expected.processorRefundId === null
        ? await scoped.is('processor_refund_id', null)
        : await scoped.eq('processor_refund_id', expected.processorRefundId);

    return { data: error ? null : { count: count ?? null }, error };
  }
}

// Singleton instance for convenience
export const paymentRefundRepository = new PaymentRefundRepository();
