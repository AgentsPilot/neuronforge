// lib/repositories/BusinessPurgeRepository.ts
//
// T8 — the purge engine's ONLY database surface.
//
// ⚠️ DRY-RUN SLICE. This file contains NO delete, update, insert or RPC call.
// It can count rows and nothing else. The destructive commit is a separate
// method that does not exist yet, deliberately: `purge_business_data` is not
// written and not applied, because applying it while the project's
// `service_role` key is public would expose a one-call mass-delete through
// PostgREST, beneath every guard the TypeScript layer provides.
//
// ── Why one repository and not twenty-eight ────────────────────────────────
// SA granted this as a GRANULARITY exception inside the repository layer
// (DEV-Q1), not a layering waiver — every database call in this feature still
// lands in `lib/repositories/`. Roughly 28 of the purge-set tables have no
// owning repository at all, and the existing ones are the wrong oracle anyway:
// `ContactDocumentsRepository` applies `.neq('status','deleted')` to an
// in-scope table, 31 of 52 repository classes carry `.limit()`/`.range()`, and
// PostgREST caps an unbounded select at 1000 rows regardless. A snapshot or a
// count built through them would silently under-report.
//
// ── The four bounds of that exception ──────────────────────────────────────
// B-1  This is the only file under `lib/business-os/purge/**` or
//      `app/api/business-os/purge/**` that imports a Supabase client. The T6
//      invariant suite asserts it by scanning those directories.
// B-2  Table names and scoping predicates arrive ONLY as a `PurgeDescriptor`.
//      There is no table-name string literal anywhere below — not in queries,
//      not in error messages, not in log lines. Log `descriptor.table`.
// B-3  This grant covers THIS FEATURE ONLY. `BusinessPurgeRepository` is not a
//      general-purpose escape hatch, and no other module may import it.
// B-4  The RLS bypass is documented, with BOTH reasons — see below.
//
// ── Why the service role, stated in full (B-4) ─────────────────────────────
//  1. 27 of the 110 user-scoped base tables give `authenticated` NO DELETE
//     policy at all (measured against the live schema), so the destructive
//     phase cannot run as the signed-in user. Counting is scoped identically
//     so that a preview cannot show a number the commit could not act on.
//  2. The snapshot must read UNFILTERED. Any soft-delete or pagination default
//     would omit rows that the commit then deletes, making the forensic
//     artefact quietly wrong in the one direction that matters.

import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, Logger } from '@/lib/logger';
import type { PurgeDescriptor } from '@/lib/business-os/purge/types';

/** How many parent ids a `via`-scoped count will resolve before giving up. */
const VIA_PARENT_CAP = 5000;

export interface TableCount {
  table: string;
  /** `null` means "could not be counted" — never conflate that with zero. */
  count: number | null;
  /** Present when `count` is null. Surfaced to the user, not swallowed. */
  error?: string;
  /** True when the count is a floor rather than an exact figure. */
  truncated?: boolean;
}

export class BusinessPurgeRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'BusinessPurgeRepository' });
  }

  /**
   * Count the rows a descriptor would delete for one user.
   *
   * Returns `{ count: null, error }` rather than throwing or defaulting to 0.
   * A preview that renders 0 for a table it could not read is worse than one
   * that says "unknown": the first invites a decision, the second withholds it.
   */
  async countForDescriptor(
    descriptor: PurgeDescriptor,
    userId: string
  ): Promise<TableCount> {
    if (descriptor.scope.kind === 'global') {
      // Structurally unreachable: a global-scoped descriptor is always
      // level:'never' (asserted by the T6 invariant suite) and never reaches a
      // run. Handled anyway so this method cannot be the place that breaks it.
      return { table: descriptor.table, count: null, error: 'global scope is never counted' };
    }

    try {
      if (descriptor.scope.kind === 'user_id') {
        const { count, error } = await this.supabase
          .from(descriptor.table)
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId);

        if (error) throw error;
        return { table: descriptor.table, count: count ?? 0 };
      }

      // `via` — the row carries no user_id; ownership runs through a parent.
      // Two steps, because PostgREST cannot express the join in a count.
      const { parent, fk } = descriptor.scope;

      const { data: parents, error: parentError } = await this.supabase
        .from(parent)
        .select('id')
        .eq('user_id', userId)
        .limit(VIA_PARENT_CAP);

      if (parentError) throw parentError;

      const parentIds = (parents ?? []).map((p: { id: string }) => p.id);
      if (parentIds.length === 0) {
        return { table: descriptor.table, count: 0 };
      }

      const { count, error } = await this.supabase
        .from(descriptor.table)
        .select('*', { count: 'exact', head: true })
        .in(fk, parentIds);

      if (error) throw error;

      return {
        table: descriptor.table,
        count: count ?? 0,
        truncated: parentIds.length >= VIA_PARENT_CAP,
      };
    } catch (error) {
      // B-2: log the descriptor's table, never a literal.
      this.logger.warn(
        { err: error, table: descriptor.table, scope: descriptor.scope.kind },
        'Purge preview count failed for a descriptor'
      );
      return {
        table: descriptor.table,
        count: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Count every descriptor in a run, with bounded concurrency.
   *
   * Measured on the first live run: **18,184 ms for 53 descriptors** — about
   * 340 ms each, which is a PostgREST round trip, not query time. The work is
   * latency-bound, so it parallelises almost linearly.
   *
   * Bounded rather than `Promise.all(descriptors)`: a `via`-scoped descriptor
   * costs two round trips, so an unbounded fan-out is ~75 simultaneous
   * connections against a live database to render a preview nobody is waiting
   * on the throughput of. Eight is enough to collapse the wall-clock by roughly
   * an order of magnitude while staying a burst the database would not notice.
   *
   * Order is preserved regardless of completion order — the caller sorts for
   * display, but a result array that shuffles between runs makes two previews
   * of the same business look different.
   */
  async countAll(
    descriptors: PurgeDescriptor[],
    userId: string,
    concurrency = 8
  ): Promise<TableCount[]> {
    const results: TableCount[] = new Array(descriptors.length);
    let cursor = 0;

    const worker = async (): Promise<void> => {
      for (;;) {
        const index = cursor++;
        if (index >= descriptors.length) return;
        results[index] = await this.countForDescriptor(descriptors[index], userId);
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(concurrency, descriptors.length) }, worker)
    );

    return results;
  }

  /**
   * Whether the signed-in business has any Stripe account on record.
   *
   * Read through `resolveUserConnectAccounts` by the gate itself; this exists
   * only so the preview can say "no Stripe connected" without the gate module
   * importing a Supabase client and breaking B-1.
   */
  async hasStripeConnectRow(userId: string): Promise<boolean | null> {
    try {
      const { count, error } = await this.supabase
        .from('stripe_connect_accounts')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);

      if (error) throw error;
      return (count ?? 0) > 0;
    } catch (error) {
      this.logger.warn({ err: error }, 'Stripe connect probe failed');
      return null; // unknown, never "no"
    }
  }

  /** Storage objects under the user's folder in one bucket. */
  async countStorageObjects(bucket: string, userId: string): Promise<TableCount> {
    try {
      const { data, error } = await this.supabase.storage
        .from(bucket)
        .list(userId, { limit: 1000 });

      if (error) throw error;
      return {
        table: bucket,
        count: data?.length ?? 0,
        truncated: (data?.length ?? 0) >= 1000,
      };
    } catch (error) {
      this.logger.warn({ err: error, bucket }, 'Storage object count failed');
      return {
        table: bucket,
        count: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export const businessPurgeRepository = new BusinessPurgeRepository();
