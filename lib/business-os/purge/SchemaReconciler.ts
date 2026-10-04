// lib/business-os/purge/SchemaReconciler.ts
//
// AD-1a (purge T7, read-only half) — compare the LIVE schema with the
// descriptor set, so a preview can say "this classification is out of date"
// instead of silently under-counting (admin delete B-4, SC-7).
//
// ── What it decides ─────────────────────────────────────────────────────────
// A TENANT table is any base table in `public` that has a `user_id` column,
// OR an `owner_user_id` column, OR any foreign key whose target relname is
// `users` (FR-1(iv)'s union predicate). The predicate is applied HERE, in
// TypeScript, over the RPC's raw `columns` + `foreign_keys`: the RPC's own
// `user_scoped_tables` filters on `user_id` only and is deliberately not read.
//
//   unclassified      tenant table with no descriptor           -> blocks (R-8)
//   missingDeletable  reset/purge/optional:* descriptor not live -> blocks (R-8)
//   missingNever      `never` descriptor not live               -> listed only
//
// A missing `never` table cannot lose data — nothing was ever going to be
// deleted from it — so it is a limitation, not drift (SA narrowing of AC-37).
//
// `references` is a relname without its schema, so `users` means `auth.users`
// only while no `public.users` table exists. If one ever appears, the
// predicate is ambiguous and the verdict is `ambiguous` (blocks), never a
// guess (SC-7: "assert that").
//
// ── What it deliberately does NOT do (AD-1a scope, SA split ruling) ─────────
// The fingerprint is computed and exposed for AD-2's token, and compared to
// NOTHING here. Purge T7's C-2 fail-closed FK comparison against T3 belongs
// to slice 3 / AD-2. No storage, no token field.
//
// No Supabase client import and no `.from(` (B-1 / B-2): all I/O is the one
// repository call in `runSchemaReconciler`.

import { createHash } from 'crypto';

import { createLogger } from '@/lib/logger';
import {
  businessPurgeRepository,
  type PurgeSchemaSnapshot,
} from '@/lib/repositories/BusinessPurgeRepository';
import { PURGE_DESCRIPTORS } from './descriptors';
import type { PurgeDescriptor, PurgeDescriptorLevel } from './types';

const logger = createLogger({ module: 'PurgeSchemaReconciler' });

/** The FK target relname that means `auth.users` (see the header). */
const AUTH_USERS_RELNAME = 'users';

/** Columns that make a table a tenant table on their own. */
const TENANT_COLUMNS: ReadonlySet<string> = new Set(['user_id', 'owner_user_id']);

/**
 * - `ok`         — zero unclassified, zero missing deletable.
 * - `drift`      — at least one of those lists is non-empty.
 * - `ambiguous`  — a `public.users` table exists, so `references = 'users'`
 *                  no longer identifies `auth.users`.
 * - `unreadable` — the schema could not be read. The caller reports
 *                  "could not verify" and refuses (R-8), never passes.
 */
export type SchemaReconcileStatus = 'ok' | 'drift' | 'ambiguous' | 'unreadable';

export interface SchemaReconcileResult {
  status: SchemaReconcileStatus;
  /** Tenant tables with no descriptor, sorted. */
  unclassified: string[];
  /** Deletable descriptors whose table is not live, sorted. */
  missingDeletable: string[];
  /** `never` descriptors whose table is not live, sorted. Non-blocking. */
  missingNever: string[];
  /** Every tenant table found, sorted. Exposed for the measurement script. */
  tenantTables: string[];
  /** sha256 hex over the canonical schema/descriptor shape. `null` when unreadable. */
  fingerprint: string | null;
  /** Present when `status === 'unreadable'`. Never contains row data. */
  error?: string;
}

/**
 * Code-unit ordering of tuples. Not `localeCompare`: ICU may treat the
 * separator as ignorable and call two different tuples equal, which would make
 * the sort — and so the fingerprint — depend on input order.
 */
function compareTuples(a: readonly string[], b: readonly string[]): number {
  const x = JSON.stringify(a);
  const y = JSON.stringify(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** True when a descriptor level means rows can be deleted by some run. */
function isDeletableLevel(level: PurgeDescriptorLevel): boolean {
  return level !== 'never';
}

/**
 * sha256 over canonical JSON of the sorted tenant tables, the sorted FK
 * triples and the sorted descriptor (table, level) pairs.
 *
 * Kept one small pure function on purpose (SA split ruling): AD-2 binds it
 * into a token, nothing in AD-1 compares it. Inputs are sorted so the value
 * does not depend on the order the database or the descriptor file lists them.
 */
export function computeSchemaFingerprint(input: {
  tenantTables: readonly string[];
  foreignKeys: ReadonlyArray<{ table_name: string; references: string; on_delete: string }>;
  descriptors: ReadonlyArray<Pick<PurgeDescriptor, 'table' | 'level'>>;
}): string {
  const tenant = [...input.tenantTables].sort(); // default sort is code-unit order
  const fks = input.foreignKeys
    .map((fk) => [fk.table_name, fk.references, fk.on_delete] as const)
    .sort(compareTuples);
  const descriptors = input.descriptors
    .map((d) => [d.table, d.level] as const)
    .sort(compareTuples);

  const canonical = JSON.stringify({ v: 1, tenant, fks, descriptors });
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Reconcile a schema snapshot against a descriptor set. Pure: no I/O, no
 * logging, deterministic for a given input.
 */
export function reconcileSchema(
  snapshot: Pick<PurgeSchemaSnapshot, 'columns' | 'foreign_keys'>,
  descriptors: readonly PurgeDescriptor[] = PURGE_DESCRIPTORS
): SchemaReconcileResult {
  const liveTables = new Set(snapshot.columns.map((c) => c.table_name));

  const tenant = new Set<string>();
  for (const c of snapshot.columns) {
    if (TENANT_COLUMNS.has(c.column_name)) tenant.add(c.table_name);
  }
  for (const fk of snapshot.foreign_keys) {
    if (fk.references === AUTH_USERS_RELNAME) tenant.add(fk.table_name);
  }
  // A `public.users` base table makes the FK half of the predicate unable to
  // tell auth.users from it. It is not itself a tenant table we can classify.
  tenant.delete(AUTH_USERS_RELNAME);

  const classified = new Set(descriptors.map((d) => d.table));
  const unclassified = [...tenant].filter((t) => !classified.has(t)).sort();

  const missingDeletable: string[] = [];
  const missingNever: string[] = [];
  for (const d of descriptors) {
    if (liveTables.has(d.table)) continue;
    (isDeletableLevel(d.level) ? missingDeletable : missingNever).push(d.table);
  }
  missingDeletable.sort();
  missingNever.sort();

  const tenantTables = [...tenant].sort();
  const fingerprint = computeSchemaFingerprint({
    tenantTables,
    foreignKeys: snapshot.foreign_keys,
    descriptors,
  });

  const status: SchemaReconcileStatus = liveTables.has(AUTH_USERS_RELNAME)
    ? 'ambiguous'
    : unclassified.length > 0 || missingDeletable.length > 0
      ? 'drift'
      : 'ok';

  return { status, unclassified, missingDeletable, missingNever, tenantTables, fingerprint };
}

/**
 * Read the live schema and reconcile it. NEVER throws: any failure becomes
 * `status: 'unreadable'`, which R-8 renders as "could not verify — refusing",
 * so a reconciler problem cannot crash the preview it sits inside (SA
 * further condition 3).
 *
 * Called only when a preview is requested, never on page load.
 */
export async function runSchemaReconciler(
  options: { correlationId?: string; descriptors?: readonly PurgeDescriptor[] } = {}
): Promise<SchemaReconcileResult> {
  const log = logger.child({ correlationId: options.correlationId });
  const unreadable = (error: string): SchemaReconcileResult => ({
    status: 'unreadable',
    unclassified: [],
    missingDeletable: [],
    missingNever: [],
    tenantTables: [],
    fingerprint: null,
    error,
  });

  try {
    const { data, error } = await businessPurgeRepository.introspectSchema();
    if (error || !data) {
      log.warn({ err: error }, 'Schema reconciler could not read the live schema');
      return unreadable(error?.message ?? 'schema introspection returned no data');
    }

    const result = reconcileSchema(data, options.descriptors ?? PURGE_DESCRIPTORS);
    // Table names are schema, not tenant data — safe to log. Counts first.
    log.info(
      {
        status: result.status,
        unclassifiedCount: result.unclassified.length,
        missingDeletableCount: result.missingDeletable.length,
        missingNeverCount: result.missingNever.length,
        unclassified: result.unclassified,
        missingDeletable: result.missingDeletable,
      },
      'Schema reconciled against purge descriptors'
    );
    return result;
  } catch (err) {
    log.error({ err }, 'Schema reconciler failed unexpectedly');
    return unreadable(err instanceof Error ? err.message : String(err));
  }
}
