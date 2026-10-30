import 'server-only';

// lib/repositories/AdminWebhookEventReadRepository.ts
//
// READ-ONLY access to `processed_webhook_events`, the Stripe webhook's claim
// table, for the "Stripe webhook events" block on the admin Jobs page (plan
// payments P-8b.3b, AM-4; workplan
// docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P8B_WORKPLAN.md "Plan: P-8b.3"
// D3-1, SA rulings P3-SA-2 items 2 and 7, P3-SA-5).
//
// CALLERS: `app/api/admin/jobs-queues/webhook-events/route.ts` only, after
// `requireAdmin`. Deliberately NOT exported from `lib/repositories/index.ts`
// (P3-SA-5: the index is imported widely), and never imported by the webhook
// or the plan reconcile pass. The writer, `ProcessedWebhookEventRepository`,
// is not touched: this file only takes its stale-claim figure.
//
// ── SERVICE ROLE (intentional RLS bypass, documented per CLAUDE.md) ─────────
// The claim table is a platform table: the claim never writes `user_id`, and
// a row holds no business data. No owner RLS client can read it, so the read
// goes through the service role, reached only behind `requireAdmin`. Every
// method carries the ⟨unscoped-by-design⟩ marker, reads across all events by
// a differently NAMED method (`…AllEvents`), and never names `user_id`.
//
// ── WHAT IS READ ─────────────────────────────────────────────────────────────
// Unfinished events only: `failed`, and `processing` older than the stale
// cutoff (`STALE_CLAIM_AGE_MS`, the one figure the webhook and the plan pass
// use). Each state is its own plain read: never `.or()` (PostgREST filter
// strings are not used here at all). Every read filters the row's own mode,
// `metadata->>livemode`, except the no-mode count (Q-P3-7), which counts rows
// that carry no mode, so they are never silently dropped.
//
// `failure_message` IS selected, because the view builder classifies it. It
// may hold customer text (an email in a Stripe error), so it never leaves the
// builder: not in the payload, not in a log line (P3-SA-6). This file does
// not log at all.
//
// Methods never throw: they return `{ data, error }`.

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { STALE_CLAIM_AGE_MS } from './ProcessedWebhookEventRepository';
import type { AgentRepositoryResult as RepositoryResult } from './types';

const TABLE = 'processed_webhook_events';

/** The one column list the list read selects (P3-SA-5). */
export const ADMIN_WEBHOOK_EVENT_COLUMNS = 'event_id, event_type, status, processed_at, failure_message, metadata';

/**
 * The most rows read per state (P3-SA-2 item 2): the list is read ordered by
 * the last attempt, which a reclaim rewrites, so it is read deeper than it is
 * shown and re-sorted by Stripe's creation time in memory.
 */
export const ADMIN_WEBHOOK_READ_PER_STATE = 200;

/** How long a `processing` claim must have been running to count as stuck: the webhook's own figure. */
export const ADMIN_WEBHOOK_STALE_AFTER_MS = STALE_CLAIM_AGE_MS;

/** The `processed_at` before which a `processing` claim is stuck. */
export function webhookStaleCutoffIso(now: Date): string {
  return new Date(now.getTime() - STALE_CLAIM_AGE_MS).toISOString();
}

/** One unfinished claim row, as read. `metadata` is `{ created, livemode }` when the webhook wrote it. */
export interface AdminWebhookEventRow {
  event_id: string;
  event_type: string | null;
  status: string;
  processed_at: string | null;
  failure_message: string | null;
  metadata: unknown;
}

export interface AdminWebhookEventCounts {
  failed: number;
  stuck: number;
}

export interface AdminWebhookEventLists {
  failed: AdminWebhookEventRow[];
  stuck: AdminWebhookEventRow[];
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : Object.assign(new Error('webhook_event_read_failed'), { cause: error });
}

export class AdminWebhookEventReadRepository {
  private supabase: SupabaseClient;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || defaultSupabase;
  }

  // Admin read across all webhook events, behind requireAdmin (⟨unscoped-by-design⟩)
  //
  // No method filters by owner: the claim table has no owner the claim writes.
  // A unit test asserts that no read names `user_id`.

  /**
   * ⟨unscoped-by-design⟩ How many events in one mode are failed, and how many
   * are stuck (`processing` since before the stale cutoff). Two head counts.
   */
  async countUnfinishedAllEvents(input: { livemode: boolean; now: Date }): Promise<RepositoryResult<AdminWebhookEventCounts>> {
    try {
      const mode = String(input.livemode);
      const cutoff = webhookStaleCutoffIso(input.now);
      const [failed, stuck] = await Promise.all([
        this.supabase
          .from(TABLE)
          .select('event_id', { count: 'exact', head: true })
          .eq('status', 'failed')
          .filter('metadata->>livemode', 'eq', mode),
        this.supabase
          .from(TABLE)
          .select('event_id', { count: 'exact', head: true })
          .eq('status', 'processing')
          .lt('processed_at', cutoff)
          .filter('metadata->>livemode', 'eq', mode),
      ]);
      if (failed.error) return { data: null, error: asError(failed.error) };
      if (stuck.error) return { data: null, error: asError(stuck.error) };
      return { data: { failed: failed.count ?? 0, stuck: stuck.count ?? 0 }, error: null };
    } catch (error) {
      return { data: null, error: asError(error) };
    }
  }

  /**
   * ⟨unscoped-by-design⟩ The unfinished events with NO recorded mode (Q-P3-7):
   * failed, and stuck, counted apart with two plain reads (never `.or()`).
   * They are shown as a count line only, in either mode.
   */
  async countUnfinishedNoModeAllEvents(input: { now: Date }): Promise<RepositoryResult<AdminWebhookEventCounts>> {
    try {
      const cutoff = webhookStaleCutoffIso(input.now);
      const [failed, stuck] = await Promise.all([
        this.supabase
          .from(TABLE)
          .select('event_id', { count: 'exact', head: true })
          .eq('status', 'failed')
          .is('metadata->>livemode', null),
        this.supabase
          .from(TABLE)
          .select('event_id', { count: 'exact', head: true })
          .eq('status', 'processing')
          .lt('processed_at', cutoff)
          .is('metadata->>livemode', null),
      ]);
      if (failed.error) return { data: null, error: asError(failed.error) };
      if (stuck.error) return { data: null, error: asError(stuck.error) };
      return { data: { failed: failed.count ?? 0, stuck: stuck.count ?? 0 }, error: null };
    } catch (error) {
      return { data: null, error: asError(error) };
    }
  }

  /**
   * ⟨unscoped-by-design⟩ Up to `ADMIN_WEBHOOK_READ_PER_STATE` failed and up to
   * as many stuck events in one mode, each oldest last attempt first (served by
   * `idx_processed_webhook_events_unfinished`). The caller re-sorts by Stripe's
   * creation time and cuts what it shows.
   */
  async listUnfinishedAllEvents(input: { livemode: boolean; now: Date }): Promise<RepositoryResult<AdminWebhookEventLists>> {
    try {
      const mode = String(input.livemode);
      const cutoff = webhookStaleCutoffIso(input.now);
      const [failed, stuck] = await Promise.all([
        this.supabase
          .from(TABLE)
          .select(ADMIN_WEBHOOK_EVENT_COLUMNS)
          .eq('status', 'failed')
          .filter('metadata->>livemode', 'eq', mode)
          .order('processed_at', { ascending: true })
          .limit(ADMIN_WEBHOOK_READ_PER_STATE),
        this.supabase
          .from(TABLE)
          .select(ADMIN_WEBHOOK_EVENT_COLUMNS)
          .eq('status', 'processing')
          .lt('processed_at', cutoff)
          .filter('metadata->>livemode', 'eq', mode)
          .order('processed_at', { ascending: true })
          .limit(ADMIN_WEBHOOK_READ_PER_STATE),
      ]);
      if (failed.error) return { data: null, error: asError(failed.error) };
      if (stuck.error) return { data: null, error: asError(stuck.error) };
      return {
        data: {
          failed: (failed.data ?? []) as AdminWebhookEventRow[],
          stuck: (stuck.data ?? []) as AdminWebhookEventRow[],
        },
        error: null,
      };
    } catch (error) {
      return { data: null, error: asError(error) };
    }
  }
}

export const adminWebhookEventReadRepository = new AdminWebhookEventReadRepository();
