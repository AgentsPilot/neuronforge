// lib/repositories/BusinessOsEntitlementShadowRepository.ts
//
// Data access for `business_os_entitlement_shadow_events`: the aggregated
// record of what the entitlement resolver WOULD have answered, while nothing is
// being blocked.
//
// Schema: supabase/migrations/20261005_business_os_entitlements.sql
// Workplan: docs/workplans/business-os-subscription-entitlements.md §4.10
//
// ── WHY AGGREGATED, AND WHY `allowed` IS RECORDED TOO ───────────────────────
// One row per (account, capability, surface, outcome, rule, day), incremented
// through a single RPC, so a busy account costs a bounded number of rows rather
// than one per request. `allowed` outcomes are recorded as well: production
// ships with NO commercial tiers, so a denials-only log would be empty and the
// tier design would have no usage data to be based on.
//
// ── SERVICE ROLE (intentional RLS bypass, documented per CLAUDE.md) ─────────
// The table has RLS on, no policies, and no privileges for `anon` or
// `authenticated`. It is written by the server-side shadow recorder and read by
// an admin report; neither runs with a user session. The account id always
// comes from server context, never from request input.
//
// `findWindow` is account-wide on purpose: it is the admin report's read over
// every account in a date window, not a per-account query, so it carries no
// `user_id` filter (CLAUDE.md rule 4 is about per-tenant access paths).

import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, Logger } from '@/lib/logger';
import type { AgentRepositoryResult as RepositoryResult } from './types';

/** A row of `business_os_entitlement_shadow_events`. */
export interface BusinessOsShadowEvent {
  user_id: string;
  capability: string;
  surface: string;
  outcome: string;
  rule: string;
  day: string;
  hits: number;
  items_total: number;
  items_max: number;
  last_seen_at: string;
  sample_correlation_id: string | null;
}

/**
 * One observation to fold into the counters.
 *
 * `hits` defaults to 1 in the database, and `day` to today in UTC, so the
 * recorder can stay as small as possible at the call site.
 */
export interface BusinessOsShadowEventInput {
  user_id: string;
  capability: string;
  surface: string;
  outcome: string;
  rule: string;
  day?: string;
  hits?: number;
  items_total?: number;
  items_max?: number;
  sample_correlation_id?: string | null;
}

/**
 * A ceiling on one call's payload.
 *
 * Note what this is NOT: there is no client-side de-duplication here, and none
 * is required. Duplicate keys within one payload are folded by the RPC's
 * `GROUP BY` (see the migration — without it PostgreSQL raises 21000 and the
 * whole batch is lost). A caller may therefore send the same
 * (capability, surface, outcome, rule) twice, which is the normal case when one
 * request hits the same capability on the same surface more than once.
 *
 * The ceiling exists for a different reason: an unbounded body would mean
 * something upstream is looping, and failing loudly beats posting megabytes of
 * observability data.
 */
export const BOS_SHADOW_EVENT_BATCH_LIMIT = 500;

export class BusinessOsEntitlementShadowRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    // Service role by design — see the header.
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'BusinessOsEntitlementShadowRepository' });
  }

  /**
   * Fold a batch of observations into the counters, in one atomic statement.
   *
   * The RPC does all the arithmetic: it groups duplicate keys **within** the
   * payload, then sums onto whatever is already stored. So two instances
   * recording the same key concurrently cannot lose a count the way a
   * read-modify-write would, and a caller that emits the same key twice in one
   * request is a normal case rather than a lost batch.
   */
  async recordEvents(events: BusinessOsShadowEventInput[]): Promise<RepositoryResult<number>> {
    if (events.length === 0) return { data: 0, error: null };

    if (events.length > BOS_SHADOW_EVENT_BATCH_LIMIT) {
      const error = new Error(
        `recordEvents accepts at most ${BOS_SHADOW_EVENT_BATCH_LIMIT} rows, received ${events.length}`
      );
      this.logger.error({ err: error, count: events.length }, 'Shadow batch too large');
      return { data: null, error };
    }

    try {
      const { error } = await this.supabase.rpc('business_os_record_shadow_events', {
        p_rows: events,
      });

      if (error) throw error;
      return { data: events.length, error: null };
    } catch (error) {
      // Shadow recording is observability: the caller logs and carries on. It
      // must never affect the request it was observing.
      this.logger.error({ err: error, count: events.length }, 'Failed to record shadow events');
      return { data: null, error: error as Error };
    }
  }

  /**
   * The observations in a date window, for the admin report.
   *
   * Read-only, bounded, and account-id-only: the report never shows business
   * names or admin reason text.
   */
  async findWindow(options: {
    from: string;
    to: string;
    limit?: number;
  }): Promise<RepositoryResult<BusinessOsShadowEvent[]>> {
    const limit = Math.min(Math.max(options.limit ?? 5000, 1), 20000);

    try {
      const { data, error } = await this.supabase
        .from('business_os_entitlement_shadow_events')
        .select(
          'user_id, capability, surface, outcome, rule, day, hits, items_total, items_max, last_seen_at, sample_correlation_id'
        )
        .gte('day', options.from)
        .lte('day', options.to)
        .order('day', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return { data: (data ?? []) as unknown as BusinessOsShadowEvent[], error: null };
    } catch (error) {
      this.logger.error({ err: error, from: options.from, to: options.to }, 'Failed to read shadow events');
      return { data: null, error: error as Error };
    }
  }
}

/** Singleton for convenience, matching the rest of the repository layer. */
export const businessOsEntitlementShadowRepository = new BusinessOsEntitlementShadowRepository();
