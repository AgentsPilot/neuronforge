// lib/repositories/ProcessedWebhookEventRepository.ts
//
// Data access for `processed_webhook_events`, the Stripe webhook's idempotency
// claim table: one row per Stripe event id, `processing` → `completed`, or
// `failed` so that Stripe's next delivery may reclaim it.
//
// Schema:   the table predates the migrations folder; `status`, `failure_message`
//           and `completed_at` come from supabase/migrations/20260828_webhook_event_status.sql
//           (CHECK status IN ('processing', 'completed', 'failed')).
// Workplan: docs/workplans/BUSINESS_OS_WEBHOOK_CONNECT_REPOSITORIES_WORKPLAN.md
//           (CF-5 PR 1, §7.3.2; SA rulings Q-3 and C-3)
//
// ── WHY THESE METHODS LOOK THE WAY THEY DO ──────────────────────────────────
// They were moved out of `app/api/stripe/webhook/route.ts` with no behaviour
// change (CLAUDE.md rule 1). Each one issues exactly the query the route issued:
// same table, operation, column list, payload keys, filter and terminal. The
// webhook's characterisation harness records the full query chain, so a method
// that drifted would fail its snapshot.
//
// ── SERVICE ROLE (intentional RLS bypass, documented per CLAUDE.md) ─────────
// A Stripe webhook has no user session. The claim row is keyed by Stripe's
// globally unique event id, taken from an event whose signature the route has
// verified before the first claim query. The table has a `user_id` column, but
// the claim never writes or reads it; adding a filter would change the query.
//
// ── ERRORS AND LOGGING ──────────────────────────────────────────────────────
// Methods return supabase-js's own `{ data, error }`: the SAME error object, so
// the route's `insertError.code === '23505'` duplicate check still works.
// supabase-js does not throw on a failed query. There is deliberately no
// try/catch here: if anything below ever did throw, the route's release
// try/catch must still see it so that "Could not release failed event" is
// logged. Nor do these methods log: the route logs every error it acts on, and
// adding a line for the errors it discards (reclaim, complete, release) is the
// tracked follow-up FU-9 (SA Q-4), not part of a behaviour-preserving move.
//
// CALLERS: `app/api/stripe/webhook/route.ts` only.
//
// NEW, NOT MOVED: `reclaimStale` (plan payments P-8b.1, PF-5; workplan
// docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P8B_WORKPLAN.md §4.1, SA ruling 1).
// It is the one method here that did not exist inline before CF-5.

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';

/** The only column list read: what the claim decision needs. */
export const CLAIM_COLUMNS = 'event_id, status';
/** Closed set of column lists this repository may select. */
export type ProcessedWebhookEventColumns = typeof CLAIM_COLUMNS;

/**
 * How old a `processing` claim must be before a delivery may take it back
 * (plan payments P-8b, PF-5; SA-P4: 15 minutes, well over the webhook's 60 s
 * `maxDuration`). One figure for the webhook and the nightly plan pass.
 */
export const STALE_CLAIM_AGE_MS = 15 * 60 * 1000;

/** The claim states the table's CHECK constraint admits. */
export type WebhookClaimStatus = 'processing' | 'completed' | 'failed';

/** What `findClaim` returns for an event already seen. */
export interface WebhookClaim {
  event_id: string;
  status: WebhookClaimStatus;
}

/**
 * The new claim row, built by the route from the verified event. Fixed shape:
 * the route passes an object literal, so an extra key fails `tsc`.
 */
export interface NewWebhookClaimRow {
  event_id: string;
  event_type: string;
  status: 'processing';
  processed_at: string;
  metadata: {
    created: number;
    livemode: boolean;
  };
}

/** supabase-js's result, passed through unchanged (same error object). */
export interface WebhookClaimResult<T> {
  data: T | null;
  error: PostgrestError | null;
}

export class ProcessedWebhookEventRepository {
  private supabase: SupabaseClient;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || defaultSupabase;
  }

  // Stripe webhook: keyed by Stripe ids or rows the route has already proved owned (⟨unscoped-by-design⟩)
  //
  // Every method below filters by `event_id` only and never by `user_id`.
  // Owner check relied on instead: none is needed, because the key is Stripe's
  // event id from a signature-verified event, and a claim row holds no business
  // data. A unit test asserts that no method adds a `user_id` filter.

  /**
   * ⟨unscoped-by-design⟩ Reads the claim for a Stripe event id, or `null` when
   * the event has not been seen. `maybeSingle`, as the route always did.
   */
  async findClaim(eventId: string): Promise<WebhookClaimResult<WebhookClaim>> {
    const { data, error } = await this.supabase
      .from('processed_webhook_events')
      .select(CLAIM_COLUMNS)
      .eq('event_id', eventId)
      .maybeSingle<WebhookClaim>();
    return { data, error };
  }

  /**
   * ⟨unscoped-by-design⟩ Records a new claim (`status: 'processing'`). A unique
   * violation (`23505`) means another delivery claimed the event first; the
   * caller reads that from the returned error's `code`.
   */
  async insertClaim(row: NewWebhookClaimRow): Promise<WebhookClaimResult<null>> {
    const { error } = await this.supabase.from('processed_webhook_events').insert(row);
    return { data: null, error };
  }

  /**
   * ⟨unscoped-by-design⟩ Takes a previously `failed` claim back for this
   * attempt: `processing`, the old failure message cleared, a fresh
   * `processed_at`. Filters by `event_id` only, exactly as before; the caller
   * calls it only after reading the claim and finding it neither `completed`
   * nor `processing`.
   */
  async reclaimFailed(eventId: string): Promise<WebhookClaimResult<null>> {
    const { error } = await this.supabase
      .from('processed_webhook_events')
      .update({ status: 'processing', failure_message: null, processed_at: new Date().toISOString() })
      .eq('event_id', eventId);
    return { data: null, error };
  }

  /**
   * ⟨unscoped-by-design⟩ Takes back a claim stuck at `processing` since before
   * `cutoffIso` (plan payments P-8b.1, PF-5, SA-P4 part 1): `processing` again,
   * the failure message cleared, a fresh `processed_at`. A row that old is
   * provably dead, because the platform kills the function at `maxDuration`
   * (60 s), far inside `STALE_CLAIM_AGE_MS`.
   *
   * ONE conditional UPDATE, so of two deliveries racing for the same stuck row
   * exactly one wins. `won` is true only when it changed exactly one row. Read
   * from `{ count: 'exact' }`, never from `.select()` (the PostgREST
   * update-plus-select defect). A fresh `processing` row, or any other
   * status, changes nothing and reads `won: false`.
   */
  async reclaimStale(eventId: string, cutoffIso: string): Promise<WebhookClaimResult<{ won: boolean }>> {
    const { error, count } = await this.supabase
      .from('processed_webhook_events')
      .update(
        { status: 'processing', failure_message: null, processed_at: new Date().toISOString() },
        { count: 'exact' }
      )
      .eq('event_id', eventId)
      .eq('status', 'processing')
      .lt('processed_at', cutoffIso);
    if (error) return { data: null, error };
    return { data: { won: count === 1 }, error: null };
  }

  /**
   * ⟨unscoped-by-design⟩ Marks a claim done, so later deliveries of the event
   * are skipped. The ONLY completing write: the route reaches it through its
   * `completeClaim()` helper alone (pinned by `routerPlacement.guard`).
   */
  async complete(eventId: string): Promise<WebhookClaimResult<null>> {
    const { error } = await this.supabase
      .from('processed_webhook_events')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('event_id', eventId);
    return { data: null, error };
  }

  /**
   * ⟨unscoped-by-design⟩ Releases a claim after the handler threw, so Stripe's
   * retry can reprocess the event. The caller truncates the message.
   *
   * Known, pre-existing (FU-5 SA review; not changed by CF-5 PR 1): when the
   * database is fully down this write fails too. supabase-js returns that
   * failure as `error` rather than throwing, and the route does not act on it,
   * so the row stays `processing`. Since P-8b.1 a later delivery takes such a
   * row back once it is older than `STALE_CLAIM_AGE_MS` (`reclaimStale`).
   */
  async markFailed(eventId: string, failureMessage: string): Promise<WebhookClaimResult<null>> {
    const { error } = await this.supabase
      .from('processed_webhook_events')
      .update({
        status: 'failed',
        failure_message: failureMessage,
      })
      .eq('event_id', eventId);
    return { data: null, error };
  }
}

// Singleton instance for convenience
export const processedWebhookEventRepository = new ProcessedWebhookEventRepository();
