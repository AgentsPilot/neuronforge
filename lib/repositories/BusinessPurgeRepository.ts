// lib/repositories/BusinessPurgeRepository.ts
//
// T8 — the purge engine's ONLY database surface.
//
// ⚠️ SLICE 2. This file now contains the destructive commit — `executePurge`
// — and storage removal. Both are reachable only through `ResetService`, which
// runs authorisation, the RPC-existence probe, both pre-delete controls and a
// VERIFIED snapshot first, in that order.
//
// `executePurge` calls `purge_business_data`, which is written
// (`supabase/held/20260916b_purge_business_data.sql` — held OUTSIDE the migrations
// directory so a bulk `supabase db push` cannot apply it) but deliberately
// NOT applied: applying it while the project's `service_role` key is public
// would expose a one-call mass-delete through PostgREST, beneath every guard
// the TypeScript layer provides. Until it is applied, `purgeFunctionExists()`
// returns false and the orchestrator refuses before writing a snapshot.
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
import { resolveUserConnectAccounts } from '@/lib/payments/stripeAccountContext';
import type { PurgeDescriptor, PurgeOptions } from '@/lib/business-os/purge/types';
import {
  LOCAL_BLOCKING_CONDITIONS,
  type LocalBlockingCondition,
} from '@/lib/business-os/purge/localPrecondition';

/** How many parent ids a `via`-scoped count will resolve before giving up. */
const VIA_PARENT_CAP = 5000;

/** What `purge_business_data` returns. Mirrors the migration's RETURN shape. */
export type PurgeRpcResult =
  | {
      ok: true;
      user_id: string;
      level: 'reset' | 'purge';
      options: PurgeOptions;
      counts: Record<string, number>;
      total_rows: number;
      table_count: number;
      committed_at: string;
      duration_ms: number;
    }
  | { ok: false; reason: 'already_running'; user_id: string };

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


  // ══════════════════════════════════════════════════════════════════════════
  // Slice 2 — the two pre-delete controls
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Control 1 (SA-S5): every Stripe Connect account on record for this user.
   *
   * Delegates to the existing `resolveUserConnectAccounts`, which is
   * deliberately NOT reimplemented — it already handles the two sources
   * (`stripe_connect_accounts` and the `stripe` plugin connection) and
   * deduplicates them, and a second implementation would eventually disagree
   * with the payments code about which account a charge lives on.
   *
   * It lives here rather than in the gate module because it takes a
   * `SupabaseClient`, and the gate importing one would break B-1.
   *
   * Throws rather than returning `[]` on failure. An empty list is the signal
   * that lets a Reset PROCEED, so a failed read must never be able to produce
   * one — that is the difference between "no Stripe" and "we could not tell".
   */
  async resolveConnectAccounts(userId: string) {
    return resolveUserConnectAccounts(this.supabase, userId);
  }

  /**
   * Control 2: count locally-visible blocking rows.
   *
   * Driven by `LOCAL_BLOCKING_CONDITIONS` rather than four hand-written
   * queries, so slice 4 can diff its condition set against this one
   * mechanically instead of by reading code.
   *
   * `count: null` means the read failed and is never conflated with zero — the
   * caller refuses on it.
   */
  async countLocalBlockingState(
    userId: string
  ): Promise<Array<LocalBlockingCondition & { count: number | null; error?: string }>> {
    const results: Array<LocalBlockingCondition & { count: number | null; error?: string }> = [];

    for (const condition of LOCAL_BLOCKING_CONDITIONS) {
      try {
        const { count, error } = await this.supabase
          .from(condition.table)
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .in('status', [...condition.statuses]);

        if (error) throw error;
        results.push({ ...condition, count: count ?? 0 });
      } catch (error) {
        this.logger.warn(
          { err: error, table: condition.table, condition: condition.condition },
          'Local blocking-state read failed'
        );
        results.push({
          ...condition,
          count: null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  }

  /**
   * Read every row a descriptor would delete — UNFILTERED, paginated to
   * exhaustion. This is the snapshot's source.
   *
   * Deliberately does not reuse `countForDescriptor`'s shape: a count can be a
   * head-select, but the snapshot needs the rows themselves, and PostgREST caps
   * an unbounded select at 1000. Pagination here is not an optimisation, it is
   * the difference between a complete forensic record and a quietly truncated
   * one.
   */
  async readAllRows(
    descriptor: PurgeDescriptor,
    userId: string,
    pageSize = 1000
  ): Promise<{ rows: unknown[] | null; error?: string }> {
    try {
      if (descriptor.scope.kind === 'global') {
        return { rows: null, error: 'global scope is never read' };
      }

      let parentIds: string[] | null = null;
      if (descriptor.scope.kind === 'via') {
        const { parent } = descriptor.scope;
        const { data: parents, error: parentError } = await this.supabase
          .from(parent)
          .select('id')
          .eq('user_id', userId)
          .limit(VIA_PARENT_CAP);
        if (parentError) throw parentError;
        parentIds = (parents ?? []).map((p: { id: string }) => p.id);
        if (parentIds.length === 0) return { rows: [] };
      }

      const rows: unknown[] = [];
      for (let from = 0; ; from += pageSize) {
        let query = this.supabase
          .from(descriptor.table)
          .select(descriptor.snapshot === 'ids' ? 'id' : '*')
          .range(from, from + pageSize - 1);

        query =
          descriptor.scope.kind === 'user_id'
            ? query.eq('user_id', userId)
            : query.in(descriptor.scope.fk, parentIds as string[]);

        const { data, error } = await query;
        if (error) throw error;

        rows.push(...(data ?? []));
        if (!data || data.length < pageSize) break;
      }

      return { rows };
    } catch (error) {
      this.logger.warn(
        { err: error, table: descriptor.table },
        'Snapshot row read failed'
      );
      return { rows: null, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Write a snapshot object. Returns the storage path. */
  async writeSnapshot(bucket: string, path: string, body: string): Promise<void> {
    const { error } = await this.supabase.storage
      .from(bucket)
      .upload(path, new Blob([body], { type: 'application/json' }), {
        contentType: 'application/json',
        upsert: false,
      });
    if (error) throw error;
  }

  /** Read a snapshot object back. Used to VERIFY the write, not to serve it. */
  async readSnapshot(bucket: string, path: string): Promise<string> {
    const { data, error } = await this.supabase.storage.from(bucket).download(path);
    if (error) throw error;
    return await data.text();
  }


  // ══════════════════════════════════════════════════════════════════════════
  // Slice 2 — phase 2 (commit) and phase 3 (storage)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Is `purge_business_data` applied?
   *
   * Asked BEFORE the snapshot. A run that snapshots and then discovers the
   * function is missing has produced the most sensitive object this system
   * writes, for a run that was never going to proceed — which is exactly what
   * running the guard before the snapshot exists to prevent.
   *
   * The probe is side-effect-free by construction: it passes `p_user_id: null`,
   * which the function rejects on its very first statement — before the
   * advisory lock, before any delete. So:
   *   * function absent  -> PostgREST answers PGRST202            -> false
   *   * function present -> the function raises "p_user_id required" -> true
   *
   * Anything else is treated as UNKNOWN and returned as null, which the caller
   * refuses on. Deciding existence from an error message would be fragile; the
   * PGRST202 code is PostgREST's own contract.
   *
   * ⚠️ BOTH ARGUMENTS BELOW MUST STAY EXACTLY AS THEY ARE.
   *
   * This call reaches a function whose job is deleting a business. It is safe
   * only because the function rejects it TWICE before it can do anything:
   *
   *   1. `p_user_id: null`  -> `IF p_user_id IS NULL THEN RAISE` — the first
   *                            statement in the function body.
   *   2. `p_tables: []`     -> the empty-array check raises next.
   *
   * The advisory lock is not taken until after both, and the first DELETE comes
   * later still. `RAISE` rolls the call back.
   *
   * The failure mode to watch for is a well-meaning tidy-up: passing a real user
   * id "so the probe is more realistic", or a real table list "so it exercises
   * more". Either removes a defence while the probe continues to APPEAR to
   * work — it still returns true — so nothing would reveal the change. With a
   * real id AND a real table list, this probe is a Reset.
   */
  async purgeFunctionExists(): Promise<boolean | null> {
    const { error } = await this.supabase.rpc('purge_business_data', {
      p_user_id: null, // defence 1 — must stay null
      p_level: 'reset',
      p_options: {},
      p_tables: [], // defence 2 — must stay empty
    });

    if (!error) {
      // Should be impossible: a null user id must raise. If it returned cleanly
      // the function is not the one this code was written against.
      this.logger.error({}, 'purge_business_data accepted a null user id — refusing to trust it');
      return null;
    }

    if (error.code === 'PGRST202') return false;

    if (/p_user_id is required/i.test(error.message ?? '')) return true;

    this.logger.warn({ err: error }, 'purge_business_data existence probe returned an unexpected error');
    return null;
  }

  /**
   * Phase 2 — the destructive commit. ONE transaction, one user.
   *
   * `tables` is the ordered descriptor list, reduced to the fields the RPC
   * needs. The RPC re-derives the scoping guarantee server-side and refuses any
   * delete it cannot scope to `userId`, so a malformed list fails closed rather
   * than widening.
   */
  async executePurge(params: {
    userId: string;
    level: 'reset' | 'purge';
    options: PurgeOptions;
    tables: Array<{ table: string; scope: 'user_id' | 'via'; parent?: string; fk?: string }>;
  }): Promise<{ result: PurgeRpcResult | null; error?: string }> {
    const { data, error } = await this.supabase.rpc('purge_business_data', {
      p_user_id: params.userId,
      p_level: params.level,
      p_options: params.options,
      p_tables: params.tables,
    });

    if (error) {
      this.logger.error(
        { err: error, userId: params.userId, level: params.level },
        'purge_business_data failed — the transaction rolled back, nothing was deleted'
      );
      return { result: null, error: error.message };
    }

    return { result: data as PurgeRpcResult };
  }

  /**
   * Phase 3 — remove storage objects under the user's folder in one bucket.
   *
   * NON-TRANSACTIONAL and runs AFTER the commit, so it cannot be rolled back
   * with it. Per-object failures are collected and returned, never thrown: the
   * rows are already gone, so failing the run here would report a failed purge
   * that in fact succeeded (FR-22, AC-47).
   */
  async removeStorageUnderUser(
    bucket: string,
    userId: string
  ): Promise<{ bucket: string; deleted: number; failed: Array<{ path: string; reason: string }>; truncated: boolean }> {
    const failed: Array<{ path: string; reason: string }> = [];
    let deleted = 0;
    let truncated = false;

    try {
      const listing = await this.listObjectPathsRecursive(bucket, userId);
      truncated = listing.truncated;

      if (listing.paths.length === 0) return { bucket, deleted: 0, failed, truncated };

      // Remove in batches — the storage API accepts a list, but one enormous
      // request that fails loses attribution for every path in it.
      const BATCH = 100;
      for (let i = 0; i < listing.paths.length; i += BATCH) {
        const batch = listing.paths.slice(i, i + BATCH);
        const { data: removed, error } = await this.supabase.storage.from(bucket).remove(batch);

        if (error) {
          for (const path of batch) failed.push({ path, reason: error.message });
          continue;
        }

        deleted += removed?.length ?? 0;
        const removedNames = new Set((removed ?? []).map((r: { name: string }) => r.name));
        for (const path of batch) {
          if (!removedNames.has(path)) failed.push({ path, reason: 'not reported as removed' });
        }
      }

      if (truncated) {
        failed.push({
          path: `${userId}/*`,
          reason: 'object listing hit its cap — further objects may remain',
        });
      }
    } catch (error) {
      failed.push({
        path: `${userId}/*`,
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    return { bucket, deleted, failed, truncated };
  }


  /**
   * Every object path under `{userId}/` in a bucket, RECURSIVELY.
   *
   * ⚠️ Supabase Storage `list(prefix)` returns only the IMMEDIATE children of a
   * prefix, and a sub-folder comes back as an entry with no `id`. Real writers
   * in this codebase nest two and three levels deep:
   *
   *     contact-documents/{userId}/{contactId}/{ts}_{name}
   *     contact-documents/{userId}/{contactId}/intake/{uuid}
   *     website-images/{userId}/generated/{ref}.png
   *     website-images/{userId}/stock/{id}.jpg
   *
   * So a single `list(userId)` sees only folders. Filtering those out (because
   * they are not objects) and deleting the rest removes NOTHING, and reports
   * zero failures while doing it — a silent no-op indistinguishable from a
   * business that simply had no files. That is why this walks.
   *
   * Returns `truncated: true` if it stops at the object cap, so a caller can
   * refuse to treat a partial listing as complete.
   */
  private async listObjectPathsRecursive(
    bucket: string,
    userId: string,
    cap = 10_000,
    /**
     * C-37: a WALL-CLOCK and CALL budget, not just an object cap.
     *
     * The object cap alone bounds how many paths are collected, but a deep tree
     * of mostly-empty folders can make thousands of `list()` calls while finding
     * very few objects. Without a time budget that walk would be killed by the
     * 60s platform limit, surfacing as an opaque timeout instead of an honest
     * `truncated: true` the caller can report as residue.
     *
     * 20s leaves room inside `maxDuration = 60` for the snapshot and the commit,
     * which run in the same request.
     */
    budget: { maxMs: number; maxCalls: number } = { maxMs: 20_000, maxCalls: 2_000 }
  ): Promise<{ paths: string[]; truncated: boolean }> {
    const paths: string[] = [];
    const queue: string[] = [userId];
    const PAGE = 1000;
    const deadline = Date.now() + budget.maxMs;
    let calls = 0;

    while (queue.length > 0) {
      const prefix = queue.shift() as string;

      for (let offset = 0; ; offset += PAGE) {
        if (Date.now() > deadline || calls >= budget.maxCalls) {
          this.logger.warn(
            { bucket, userId, calls, collected: paths.length, remainingFolders: queue.length },
            'Storage walk stopped at its budget — reporting as truncated'
          );
          return { paths, truncated: true };
        }
        calls += 1;

        const { data, error } = await this.supabase.storage
          .from(bucket)
          .list(prefix, { limit: PAGE, offset });

        if (error) throw error;
        const entries = data ?? [];

        for (const entry of entries as Array<{ name: string; id?: string | null }>) {
          const full = `${prefix}/${entry.name}`;
          if (entry.id) {
            paths.push(full);
            if (paths.length >= cap) return { paths, truncated: true };
          } else {
            queue.push(full); // a folder — descend
          }
        }

        if (entries.length < PAGE) break;
      }
    }

    return { paths, truncated: false };
  }

  /**
   * Storage objects under the user's folder in one bucket — RECURSIVE.
   *
   * Slice 1 shipped a single-level `list(userId)` here, which counted the
   * top-level FOLDERS rather than the objects inside them. Found during slice 2
   * while building storage removal, which had the same bug in its destructive
   * form. See `listObjectPathsRecursive`.
   */
  async countStorageObjects(bucket: string, userId: string): Promise<TableCount> {
    try {
      const { paths, truncated } = await this.listObjectPathsRecursive(bucket, userId);
      return { table: bucket, count: paths.length, truncated };
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
