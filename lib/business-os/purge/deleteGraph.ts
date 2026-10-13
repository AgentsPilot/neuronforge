// lib/business-os/purge/deleteGraph.ts
//
// Purge slice 3a (T3a-4) — the delete-graph check: T7's deferred FK half,
// generalising §0.10 F-SA-3 from "the children of business_profiles" to every
// parent in a run.
//
// ── What it decides ─────────────────────────────────────────────────────────
// Given a resolved run (descriptors in delete order) and the LIVE foreign keys
// and triggers from `purge_schema_introspect()`:
//
//   blockingOrderViolations  RESTRICT / NO ACTION edge, both ends in the run,
//                            child ordered AFTER its parent        -> blocks
//                            ALSO a SET NULL / SET DEFAULT edge whose child
//                            column is NOT NULL (or cannot be shown nullable),
//                            same ordering rule: the parent delete would try
//                            to null a NOT NULL column and fail with 23502,
//                            exactly as a NO ACTION edge fails with 23503
//                            (test-account cleanup live failure, 2026-10-08:
//                            scheduling_bookings.contact_id -> crm_contacts)
//   unlistedCascadeChildren  CASCADE child of a run table that is NOT in the
//                            run (a `never` or unclassified row would be lost
//                            by cascade, beneath the classification) -> blocks
//   unreviewedDeleteTriggers DELETE-capable trigger on a run table or on a
//                            CASCADE child, not in REVIEWED_DELETE_TRIGGERS
//                                                                   -> blocks
//   cascadeAfterParent       CASCADE child ordered after its parent: its
//                            reported count is 0 because the parent got there
//                            first. Reported; blocks nothing. The invariant
//                            test pins it to CASCADE_COUNT_EXEMPT.
//
// ── Why it never names a table ──────────────────────────────────────────────
// The rules are relation-agnostic: they read `on_delete` (pg_constraint's
// `confdeltype` code) and positions in the run. Table names arrive only as
// data — from the descriptors and from the live schema — so this file keeps
// the §10.9 contract (B-2) and the held RPC's SQL mirror (slice 3b controls
// 5 and 6) can be written the same way.
//
// ── Fail closed (SA C-5, F-SA-1) ────────────────────────────────────────────
// An unreadable schema, a payload with no `triggers` key, or an EMPTY FK list
// for a non-empty run is `unreadable`, never `ok`. Every real schema with a
// business in it has FKs; zero of them means the read failed, not that the
// graph is clean.
//
// ── Known limit ─────────────────────────────────────────────────────────────
// `references` is a relname WITHOUT its schema (migration 20260915a). A run
// table is always in `public`, so a non-public relation that shares a run
// table's name would be read as that run table. None does today; an
// ambiguity here can only ADD a finding (fail closed), never hide one,
// except for a blocking edge into a same-named non-public table, which cannot
// constrain a `public` delete anyway.
//
// Direct edges only, on purpose: a transitive unlisted grandchild is still
// caught, because its direct parent is itself an unlisted cascade child.
//
// Pure except `runDeleteGraphCheck`, which does the one repository read and
// the logging. No Supabase client (B-1).

import { createLogger } from '@/lib/logger';
import {
  businessPurgeRepository,
  type PurgeSchemaSnapshot,
} from '@/lib/repositories/BusinessPurgeRepository';
import {
  CASCADE_COUNT_EXEMPT,
  REVIEWED_DELETE_TRIGGERS,
  descriptorsForRun,
} from './descriptors';
import type { PurgeDescriptor, PurgeLevel, PurgeOptions } from './types';

const logger = createLogger({ module: 'PurgeDeleteGraph' });

/** `pg_constraint.confdeltype` codes (migration 20260915a). */
const ON_DELETE = {
  NO_ACTION: 'a',
  RESTRICT: 'r',
  CASCADE: 'c',
} as const;

/** Codes that make a DELETE of the parent FAIL while a child row references it. */
const BLOCKING_CODES: ReadonlySet<string> = new Set([ON_DELETE.NO_ACTION, ON_DELETE.RESTRICT]);

/** SET NULL / SET DEFAULT: the child row survives, but its key is overwritten. */
const OVERWRITE_CODES: ReadonlySet<string> = new Set(['n', 'd']);

export type ForeignKeyFact = PurgeSchemaSnapshot['foreign_keys'][number];
export type TriggerFact = NonNullable<PurgeSchemaSnapshot['triggers']>[number];
/** A column of the live schema; `is_nullable` is information_schema's 'YES' / 'NO'. */
export type ColumnFact = Pick<PurgeSchemaSnapshot['columns'][number], 'table_name' | 'column_name' | 'is_nullable'>;

export interface GraphEdge {
  constraint: string;
  child: string;
  parent: string;
}

export interface CascadeAfterParent extends GraphEdge {
  /** True when the child is in CASCADE_COUNT_EXEMPT (reported, accepted). */
  exempt: boolean;
}

export interface TriggerFinding {
  table: string;
  trigger: string;
}

/**
 * - `ok`         — nothing blocks.
 * - `refused`    — at least one blocking list is non-empty.
 * - `unreadable` — the graph could not be read. A refusal at commit and a
 *                  visible blocking state in the preview (C-5); never "clean".
 */
export type DeleteGraphStatus = 'ok' | 'refused' | 'unreadable';

export interface DeleteGraphResult {
  status: DeleteGraphStatus;
  blockingOrderViolations: GraphEdge[];
  unlistedCascadeChildren: GraphEdge[];
  unreviewedDeleteTriggers: TriggerFinding[];
  cascadeAfterParent: CascadeAfterParent[];
  /** Present when `status === 'unreadable'`. Schema facts only, never row data. */
  error?: string;
}

export interface DeleteGraphInput {
  /** The run, IN DELETE ORDER (as `descriptorsForRun` returns it). */
  run: ReadonlyArray<Pick<PurgeDescriptor, 'table'>>;
  foreignKeys: readonly ForeignKeyFact[] | undefined;
  /** `undefined` = the payload had no triggers key → unreadable. */
  triggers: readonly TriggerFact[] | undefined;
  /**
   * Live columns with their nullability. Read only for a SET NULL / SET
   * DEFAULT edge whose child is ordered after its parent: such an edge passes
   * only when its column is shown NULLABLE here. Absent, or a column it cannot
   * resolve, makes that edge blocking (fail closed); no other edge reads it.
   */
  columns?: readonly ColumnFact[];
  /** Defaults to the descriptor module's reviewed list. Injected by tests. */
  reviewedTriggers?: ReadonlyArray<{ table: string; trigger: string }>;
  /** Defaults to the descriptor module's exemption list. Injected by tests. */
  cascadeCountExempt?: readonly string[];
}

function emptyResult(status: DeleteGraphStatus, error?: string): DeleteGraphResult {
  return {
    status,
    blockingOrderViolations: [],
    unlistedCascadeChildren: [],
    unreviewedDeleteTriggers: [],
    cascadeAfterParent: [],
    ...(error ? { error } : {}),
  };
}

/**
 * Whether a `pg_get_triggerdef` string fires on DELETE.
 *
 * Shape: `CREATE [CONSTRAINT] TRIGGER <name> {BEFORE|AFTER|INSTEAD OF}
 * <event> [OR <event> ...] ON <table> ...`. A definition that does not parse
 * is treated as DELETE-capable: an unrecognised trigger is exactly the one a
 * reviewer has not looked at (fail closed).
 */
export function isDeleteCapableTrigger(definition: string): boolean {
  const match = /\b(?:BEFORE|AFTER|INSTEAD\s+OF)\s+([\s\S]*?)\s+ON\s/i.exec(definition);
  if (!match) return true;
  return /\bDELETE\b/i.test(match[1]);
}

const byCode = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Whether a SET NULL / SET DEFAULT edge can overwrite its child column without
 * failing: only when that column is shown NULLABLE.
 *
 * The introspection payload names a FK's constraint but not its columns
 * (migration 20260915a), so the column is read from Postgres's default
 * constraint name, `<child>_<column>_fkey`, and must exist on the child. A
 * name that does not follow it, a column absent from `columns`, or a missing
 * nullability is NOT shown nullable, so the edge blocks (fail closed): the
 * cost is a refusal an engineer clears, never a 23502 inside the delete.
 *
 * SET DEFAULT is treated like SET NULL: the payload carries no column default,
 * and a NOT NULL column with no default fails the same way.
 */
export function isNullableOverwrite(fk: ForeignKeyFact, columns: readonly ColumnFact[] | undefined): boolean {
  if (!columns) return false;
  const prefix = `${fk.table_name}_`;
  const suffix = '_fkey';
  const name = fk.constraint_name;
  if (!name.startsWith(prefix) || !name.endsWith(suffix) || name.length <= prefix.length + suffix.length) return false;
  const column = name.slice(prefix.length, -suffix.length);
  const fact = columns.find((c) => c.table_name === fk.table_name && c.column_name === column);
  return fact?.is_nullable === 'YES';
}
const sortEdges = <T extends GraphEdge>(edges: T[]): T[] =>
  edges.sort((x, y) => byCode(x.child, y.child) || byCode(x.parent, y.parent) || byCode(x.constraint, y.constraint));

/**
 * Check a run against the live delete graph. Pure: no I/O, no logging,
 * deterministic for a given input.
 */
export function checkDeleteGraph(input: DeleteGraphInput): DeleteGraphResult {
  const { run, foreignKeys, triggers, columns } = input;
  const reviewed = input.reviewedTriggers ?? REVIEWED_DELETE_TRIGGERS;
  const exempt = new Set(input.cascadeCountExempt ?? CASCADE_COUNT_EXEMPT);

  if (foreignKeys === undefined) {
    return emptyResult('unreadable', 'foreign keys were not read');
  }
  if (triggers === undefined) {
    return emptyResult('unreadable', 'triggers were not read; an unreviewed DELETE trigger cannot be ruled out');
  }
  if (run.length > 0 && foreignKeys.length === 0) {
    return emptyResult('unreadable', 'the schema returned no foreign keys for a non-empty run');
  }

  const position = new Map<string, number>();
  run.forEach((d, i) => position.set(d.table, i));

  const blockingOrderViolations: GraphEdge[] = [];
  const unlistedCascadeChildren: GraphEdge[] = [];
  const cascadeAfterParent: CascadeAfterParent[] = [];
  /** Tables whose DELETE triggers can fire in this run: run tables + cascade children. */
  const reached = new Set<string>(position.keys());

  for (const fk of foreignKeys) {
    const child = fk.table_name;
    const parent = fk.references;
    // Self-references are excluded: the parent and the child are the same
    // statement's rows, and the run lists the table once either way.
    if (child === parent) continue;

    const parentAt = position.get(parent);
    if (parentAt === undefined) continue; // parent not deleted by this run
    const childAt = position.get(child);
    const edge: GraphEdge = { constraint: fk.constraint_name, child, parent };

    if (BLOCKING_CODES.has(fk.on_delete)) {
      if (childAt !== undefined && childAt > parentAt) blockingOrderViolations.push(edge);
      continue;
    }

    // SET NULL / SET DEFAULT into a NOT NULL column fails the parent delete
    // (23502) just as NO ACTION does (23503), so it is held to the same rule.
    // A NULLABLE one is harmless and may run either way, which is what lets
    // the full graph stay cyclic.
    if (OVERWRITE_CODES.has(fk.on_delete)) {
      if (childAt !== undefined && childAt > parentAt && !isNullableOverwrite(fk, columns)) {
        blockingOrderViolations.push(edge);
      }
      continue;
    }

    if (fk.on_delete === ON_DELETE.CASCADE) {
      reached.add(child);
      if (childAt === undefined) {
        unlistedCascadeChildren.push(edge);
      } else if (childAt > parentAt) {
        cascadeAfterParent.push({ ...edge, exempt: exempt.has(child) });
      }
    }
    // A nullable SET NULL / SET DEFAULT child survives with its key nulled:
    // no classification consequence (M-6 retains those by design).
  }

  const reviewedKeys = new Set(reviewed.map((r) => `${r.table}\u0000${r.trigger}`));
  const unreviewedDeleteTriggers: TriggerFinding[] = triggers
    .filter((t) => reached.has(t.table_name))
    .filter((t) => isDeleteCapableTrigger(t.definition))
    .filter((t) => !reviewedKeys.has(`${t.table_name}\u0000${t.trigger_name}`))
    .map((t) => ({ table: t.table_name, trigger: t.trigger_name }))
    .sort((x, y) => byCode(x.table, y.table) || byCode(x.trigger, y.trigger));

  const blocks =
    blockingOrderViolations.length > 0 ||
    unlistedCascadeChildren.length > 0 ||
    unreviewedDeleteTriggers.length > 0;

  return {
    status: blocks ? 'refused' : 'ok',
    blockingOrderViolations: sortEdges(blockingOrderViolations),
    unlistedCascadeChildren: sortEdges(unlistedCascadeChildren),
    unreviewedDeleteTriggers,
    cascadeAfterParent: sortEdges(cascadeAfterParent),
  };
}

// ── Held RPC control 7, mirrored (purge slice 3b, SA C-2; widened by G-2) ───
//
// The held `purge_business_data` refuses a run in which a CASCADE edge INSIDE
// the run would remove another tenant's rows: children are deleted child-first
// by `user_id`, so when the parent goes, its cascade can only reach rows that
// are NOT this tenant's. Control 6 cannot see this — the child table IS
// listed. The SQL cannot execute before the key rotation (no in-process
// Postgres, SA OQ-6), so its decision rules are mirrored here as two pure
// functions and unit-tested on a synthetic graph. They are not called at run
// time: the live decision is the SQL's, and it reads `pg_constraint` itself
// (the introspection payload carries no key columns).

/** A foreign key with its column pairs, as control 7 reads it from pg_catalog. */
export interface KeyedForeignKey {
  constraint: string;
  child: string;
  parent: string;
  /** `pg_constraint.confdeltype`. */
  onDelete: string;
  /** Column pairs in key order: child column -> parent column. */
  columns: ReadonlyArray<{ child: string; parent: string }>;
}

export interface TenancyEdgePlan {
  /** Edges whose rows control 7 checks. */
  checked: KeyedForeignKey[];
  /** Edges refused outright: the parent has no `user_id`, so its rows cannot be bounded. */
  refused: KeyedForeignKey[];
}

const TENANCY_COLUMN = 'user_id';

/**
 * Which edges control 7 checks, and which it refuses unseen. Mirrors the
 * SQL's edge selection: the parent is in the run, the child has `user_id`, no
 * key pair maps `user_id` to `user_id` (tenant-bounded by the schema itself,
 * e.g. the composite keys to the tenancy root), and the edge is EITHER
 *   - CASCADE with the child in the run too — self-references included
 *     (SA G-2: a self-referencing cascade removes another tenant's row that
 *     points at one of mine), OR
 *   - SET NULL / SET DEFAULT, child in the run or not (SA G-2: no row is
 *     lost, but another tenant's column is overwritten — a cross-tenant write).
 * A CASCADE child outside the run is control 6's refusal, not this one's.
 */
export function planTenancyCheck(input: {
  run: ReadonlyArray<Pick<PurgeDescriptor, 'table'>>;
  foreignKeys: readonly KeyedForeignKey[];
  /** Tables that have a `user_id` column. */
  tablesWithUserId: ReadonlySet<string>;
}): TenancyEdgePlan {
  const inRun = new Set(input.run.map((d) => d.table));
  const checked: KeyedForeignKey[] = [];
  const refused: KeyedForeignKey[] = [];

  for (const fk of input.foreignKeys) {
    if (!inRun.has(fk.parent)) continue;
    const isCascade = fk.onDelete === ON_DELETE.CASCADE;
    if (!isCascade && !OVERWRITE_CODES.has(fk.onDelete)) continue;
    if (isCascade && !inRun.has(fk.child)) continue;
    if (!input.tablesWithUserId.has(fk.child)) continue;
    if (fk.columns.some((c) => c.child === TENANCY_COLUMN && c.parent === TENANCY_COLUMN)) continue;

    if (!input.tablesWithUserId.has(fk.parent)) refused.push(fk);
    else checked.push(fk);
  }

  const byConstraint = (a: KeyedForeignKey, b: KeyedForeignKey) => byCode(a.constraint, b.constraint);
  return { checked: checked.sort(byConstraint), refused: refused.sort(byConstraint) };
}

/**
 * The row half of control 7: for each checked edge, is there a child row that
 * references one of this tenant's parent rows but whose `user_id` is not
 * `userId` (another tenant's, or null)? Mirrors
 * `... JOIN parent p ON <key> WHERE p.user_id = $1 AND c.user_id IS DISTINCT FROM $1`.
 */
export function crossTenantCascadeViolations(input: {
  edges: readonly KeyedForeignKey[];
  rows: Readonly<Record<string, ReadonlyArray<Readonly<Record<string, unknown>>>>>;
  userId: string;
}): GraphEdge[] {
  const violations: GraphEdge[] = [];

  for (const fk of input.edges) {
    const parents = (input.rows[fk.parent] ?? []).filter((p) => p[TENANCY_COLUMN] === input.userId);
    const children = input.rows[fk.child] ?? [];
    const leaks = children.some(
      (c) =>
        c[TENANCY_COLUMN] !== input.userId &&
        parents.some((p) => fk.columns.every((k) => c[k.child] != null && c[k.child] === p[k.parent]))
    );
    if (leaks) violations.push({ constraint: fk.constraint, child: fk.child, parent: fk.parent });
  }

  return sortEdges(violations);
}

/**
 * Read the live schema and check the run for `level` + `options`. NEVER
 * throws: any failure is `unreadable`, which the caller renders as a
 * refusal (C-5), never as clean.
 *
 * Read-only: `purge_schema_introspect()` performs no DML and no DDL.
 */
/**
 * SA F-1 (3a code review): the fixed, client-safe text for a failed read.
 * The raw PostgREST / Zod text goes to Pino only, and to the result solely
 * under the `NODE_ENV === 'development'` guard (CLAUDE.md error format).
 */
export const SCHEMA_UNREADABLE_MESSAGE = 'The live schema could not be read';

function unreadableRead(raw: string): DeleteGraphResult {
  return emptyResult(
    'unreadable',
    process.env.NODE_ENV === 'development' ? `${SCHEMA_UNREADABLE_MESSAGE}: ${raw}` : SCHEMA_UNREADABLE_MESSAGE
  );
}

export async function runDeleteGraphCheck(params: {
  level: PurgeLevel;
  options: PurgeOptions;
  correlationId?: string;
}): Promise<DeleteGraphResult> {
  const log = logger.child({ correlationId: params.correlationId });

  try {
    const { data, error } = await businessPurgeRepository.introspectSchema();
    if (error || !data) {
      log.warn({ err: error }, 'Delete-graph check could not read the live schema');
      return unreadableRead(error?.message ?? 'schema introspection returned no data');
    }

    const result = checkDeleteGraph({
      run: descriptorsForRun(params.level, params.options),
      foreignKeys: data.foreign_keys,
      triggers: data.triggers,
      columns: data.columns,
    });

    // Table and trigger names are schema, not tenant data — safe to log.
    log.info(
      {
        level: params.level,
        options: params.options,
        status: result.status,
        blockingOrderViolations: result.blockingOrderViolations,
        unlistedCascadeChildren: result.unlistedCascadeChildren,
        unreviewedDeleteTriggers: result.unreviewedDeleteTriggers,
        cascadeAfterParentCount: result.cascadeAfterParent.length,
        error: result.error,
      },
      'Delete graph checked against the live schema'
    );
    return result;
  } catch (err) {
    log.error({ err }, 'Delete-graph check failed unexpectedly');
    return unreadableRead(err instanceof Error ? err.message : String(err));
  }
}
