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

export type ForeignKeyFact = PurgeSchemaSnapshot['foreign_keys'][number];
export type TriggerFact = NonNullable<PurgeSchemaSnapshot['triggers']>[number];

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
const sortEdges = <T extends GraphEdge>(edges: T[]): T[] =>
  edges.sort((x, y) => byCode(x.child, y.child) || byCode(x.parent, y.parent) || byCode(x.constraint, y.constraint));

/**
 * Check a run against the live delete graph. Pure: no I/O, no logging,
 * deterministic for a given input.
 */
export function checkDeleteGraph(input: DeleteGraphInput): DeleteGraphResult {
  const { run, foreignKeys, triggers } = input;
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

    if (fk.on_delete === ON_DELETE.CASCADE) {
      reached.add(child);
      if (childAt === undefined) {
        unlistedCascadeChildren.push(edge);
      } else if (childAt > parentAt) {
        cascadeAfterParent.push({ ...edge, exempt: exempt.has(child) });
      }
    }
    // SET NULL / SET DEFAULT: the child row survives, so no ordering or
    // classification consequence (M-6 retains those by design).
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
