// lib/business-os/data-export/classification.ts
//
// DE-2 (BUSINESS_OS_DATA_EXPORT_DE2_WORKPLAN.md §2.3; requirement
// BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md §0.3.6, FR-E17…FR-E19): reading the
// export classification off the purge descriptors.
//
// PURE. It imports ONLY the descriptors and the classification types (SA C-2).
// Never `sections.ts` and never a repository: the repositories import this file
// to get their export columns, and `sections.ts` imports the repositories, so
// either import would close a cycle. exportClassification.test.ts pins that.
//
// Every rule is a function that takes its inputs, so the tests can feed it a
// planted bad descriptor (negative controls) and the purge engine never has to
// read `.export` itself: the reconciler calls `exportColumnDrift` /
// `exportColumnsMissing` from here (SA-Q3).
//
// The secret-column deny check runs twice: in CI (the test) and at request
// time inside `exportColumnsOf`. A column that slips past review then fails
// the section closed (`failed`, FR-E12) instead of being sent.

import { PURGE_DESCRIPTORS } from '@/lib/business-os/purge/descriptors';
import type { PurgeDescriptor } from '@/lib/business-os/purge/types';
import type {
  ExportSectionId,
  TableExportClassification,
} from '@/lib/business-os/data-export/classificationTypes';

// ── Secret columns ──────────────────────────────────────────────────────────

/** Column names that are never exported, whatever table they are on (§3.2). */
export const SECRET_COLUMN_DENY_EXACT: readonly string[] = [
  'access_token', 'refresh_token', 'token', 'credentials', 'secret', 'api_key',
  'password', 'password_hash', 'account_token', 'cost_usd', 'provider_cost_usd',
];

/** Name shapes that are never exported (secrets, hashes, our provider cost). */
export const SECRET_COLUMN_DENY_PATTERNS: readonly RegExp[] = [
  /_token$/, /_secret$/, /_key$/, /_credentials$/, /_hash$/, /cost_usd$/,
];

/**
 * `table.column` -> why a deny-list hit is harmless. A review decision: every
 * entry is an SA item in the slice that adds it (SA-Q6). The test fails on a
 * stale entry (one that no longer names an included column that is denied).
 */
export const DENY_EXCEPTIONS: Readonly<Record<string, string>> = {
  'plugin_connections.plugin_key': "the plugin's name (e.g. google-mail), not a credential",
};

/** True when `column` matches the deny list (before any exception). */
export function matchesSecretDeny(column: string): boolean {
  return SECRET_COLUMN_DENY_EXACT.includes(column) || SECRET_COLUMN_DENY_PATTERNS.some((p) => p.test(column));
}

/** True when `table.column` may not be exported: a deny hit with no exception. */
export function isDeniedColumn(
  table: string,
  column: string,
  exceptions: Readonly<Record<string, string>> = DENY_EXCEPTIONS
): boolean {
  return matchesSecretDeny(column) && !(`${table}.${column}` in exceptions);
}

/** A plain column identifier: no `*`, no comma, no whitespace, no cast or alias. */
const COLUMN_NAME = /^[a-z_][a-z0-9_]*$/;

// ── Lookup ──────────────────────────────────────────────────────────────────

export type ExportClassificationErrorCode = 'unknown_table' | 'not_included' | 'invalid_column' | 'denied_column';

/** Thrown by `exportColumnsOf`. The repositories catch it and return `{ error }`. */
export class ExportClassificationError extends Error {
  readonly code: ExportClassificationErrorCode;
  readonly table: string;

  constructor(code: ExportClassificationErrorCode, table: string, detail: string) {
    super(`Export classification of ${table}: ${detail}`);
    this.name = 'ExportClassificationError';
    this.code = code;
    this.table = table;
  }
}

/** The table's export classification, or `null` when no descriptor names it. */
export function exportClassificationOf(
  table: string,
  descriptors: readonly PurgeDescriptor[] = PURGE_DESCRIPTORS
): TableExportClassification | null {
  return descriptors.find((d) => d.table === table)?.export ?? null;
}

/**
 * The columns the export may select from `table`, in descriptor order. Throws
 * `ExportClassificationError` when the table is unknown, not `include`, or a
 * column is malformed or on the deny list: the request-time half of the deny
 * check (fail closed).
 */
export function exportColumnsOf(
  table: string,
  descriptors: readonly PurgeDescriptor[] = PURGE_DESCRIPTORS,
  exceptions: Readonly<Record<string, string>> = DENY_EXCEPTIONS
): readonly string[] {
  const classification = exportClassificationOf(table, descriptors);
  if (!classification) throw new ExportClassificationError('unknown_table', table, 'no descriptor');
  if (classification.kind !== 'include') {
    throw new ExportClassificationError('not_included', table, `classified ${classification.kind}`);
  }
  if (classification.columns.length === 0) {
    throw new ExportClassificationError('invalid_column', table, 'empty column list');
  }
  for (const column of classification.columns) {
    if (!COLUMN_NAME.test(column)) throw new ExportClassificationError('invalid_column', table, `malformed column "${column}"`);
    if (isDeniedColumn(table, column, exceptions)) {
      throw new ExportClassificationError('denied_column', table, `column ${column} is on the secret deny list`);
    }
  }
  return classification.columns;
}

// ── CI rules (pure; exportClassification.test.ts runs them) ─────────────────

export const PLANNED_TABLE_SLICES: readonly string[] = ['DE-3', 'DE-4', 'DE-5', 'DE-6', 'DE-7'];
export const PLANNED_FILES_SLICES: readonly string[] = ['DE-8b'];

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const nonEmpty = (value: unknown): boolean => typeof value === 'string' && value.trim().length > 0;

/**
 * Problems with one table descriptor's `export` value (T-1…T-5, T-7).
 * Typed `unknown` on purpose: the CI check must see an object that the type
 * would have rejected (Jest does not type-check, SA DE-2 review SA-Q1).
 */
export function tableExportProblems(
  descriptor: { table: string; export?: unknown },
  options: { plannedAllowed: boolean; exceptions?: Readonly<Record<string, string>> }
): string[] {
  const { table } = descriptor;
  const value = descriptor.export;
  if (!isObject(value)) return [`${table}: no export classification`];
  const problems: string[] = [];
  switch (value.kind) {
    case 'include': {
      if (!nonEmpty(value.section)) problems.push(`${table}: include without a section`);
      if ('folder' in value) problems.push(`${table}: a table include has no folder`);
      const columns = value.columns;
      if (!Array.isArray(columns) || columns.length === 0) {
        problems.push(`${table}: include needs a non-empty column list`);
        break;
      }
      const seen = new Set<string>();
      for (const column of columns as unknown[]) {
        if (typeof column !== 'string' || !COLUMN_NAME.test(column)) {
          problems.push(`${table}: malformed column ${JSON.stringify(column)}`);
          continue;
        }
        if (seen.has(column)) problems.push(`${table}: duplicate column ${column}`);
        seen.add(column);
        if (isDeniedColumn(table, column, options.exceptions ?? DENY_EXCEPTIONS)) {
          problems.push(`${table}: column ${column} is on the secret deny list`);
        }
      }
      if (value.excludedColumns !== undefined) {
        if (!isObject(value.excludedColumns)) {
          problems.push(`${table}: excludedColumns must be a column -> reason map`);
        } else {
          for (const [column, reason] of Object.entries(value.excludedColumns)) {
            if (seen.has(column)) problems.push(`${table}: ${column} is both included and excluded`);
            if (!nonEmpty(reason)) problems.push(`${table}: excluded column ${column} has no reason`);
          }
        }
      }
      break;
    }
    case 'exclude':
      if (!nonEmpty(value.reason)) problems.push(`${table}: exclude without a reason`);
      break;
    case 'planned':
      if (typeof value.slice !== 'string' || !PLANNED_TABLE_SLICES.includes(value.slice)) {
        problems.push(`${table}: planned for an unknown slice ${JSON.stringify(value.slice)}`);
      } else if (!options.plannedAllowed) {
        problems.push(`${table}: still planned (${value.slice}); every table must be include or exclude by now`);
      }
      break;
    default:
      problems.push(`${table}: unknown export kind ${JSON.stringify(value.kind)}`);
  }
  return problems;
}

/** Problems with one bucket descriptor's `export` value (T-1, T-2, T-7). */
export function storageExportProblems(
  descriptor: { bucket: string; export?: unknown },
  options: { plannedAllowed: boolean }
): string[] {
  const { bucket } = descriptor;
  const value = descriptor.export;
  if (!isObject(value)) return [`${bucket}: no export classification`];
  switch (value.kind) {
    case 'include': {
      const problems: string[] = [];
      if (!nonEmpty(value.folder)) problems.push(`${bucket}: include without a folder`);
      if ('columns' in value || 'section' in value) problems.push(`${bucket}: a bucket has no columns or section`);
      return problems;
    }
    case 'exclude':
      return nonEmpty(value.reason) ? [] : [`${bucket}: exclude without a reason`];
    case 'planned':
      if (typeof value.slice !== 'string' || !PLANNED_FILES_SLICES.includes(value.slice)) {
        return [`${bucket}: planned for an unknown slice ${JSON.stringify(value.slice)}`];
      }
      return options.plannedAllowed ? [] : [`${bucket}: still planned (${value.slice})`];
    default:
      return [`${bucket}: unknown export kind ${JSON.stringify(value.kind)}`];
  }
}

/**
 * Every `DENY_EXCEPTIONS` entry must still excuse a real hit: an included
 * column of that table that the deny list matches. Otherwise the entry is
 * stale and could later excuse something nobody reviewed.
 */
export function staleDenyExceptions(
  descriptors: readonly PurgeDescriptor[] = PURGE_DESCRIPTORS,
  exceptions: Readonly<Record<string, string>> = DENY_EXCEPTIONS
): string[] {
  return Object.keys(exceptions).filter((key) => {
    const [table, column] = key.split('.');
    const classification = exportClassificationOf(table, descriptors);
    return !(classification?.kind === 'include' && classification.columns.includes(column) && matchesSecretDeny(column));
  });
}

/**
 * The section registry and the descriptors agree (T-6, SA-Q8): each `include`
 * names a registered section; each registered section outside `nonTable` has
 * exactly one `include`; each `nonTable` id is still registered. The ids are
 * passed in so this file never imports `sections.ts` (SA C-2).
 */
export function sectionRegistryProblems(
  descriptors: readonly PurgeDescriptor[],
  sectionIds: readonly string[],
  nonTable: Readonly<Partial<Record<ExportSectionId, string>>>
): string[] {
  const problems: string[] = [];
  const registered = new Set(sectionIds);
  const bySection = new Map<string, string[]>();
  for (const d of descriptors) {
    if (d.export?.kind !== 'include') continue;
    if (!registered.has(d.export.section)) problems.push(`${d.table}: names unknown section ${d.export.section}`);
    bySection.set(d.export.section, [...(bySection.get(d.export.section) ?? []), d.table]);
  }
  for (const id of sectionIds) {
    const tables = bySection.get(id) ?? [];
    if (id in nonTable) {
      if (tables.length > 0) problems.push(`${id}: a non-table section has include descriptors (${tables.join(', ')})`);
    } else if (tables.length !== 1) {
      problems.push(`${id}: expected exactly one include descriptor, found ${tables.length}${tables.length ? ` (${tables.join(', ')})` : ''}`);
    }
  }
  for (const id of Object.keys(nonTable)) {
    if (!registered.has(id)) problems.push(`${id}: listed as a non-table section but not registered`);
  }
  return problems;
}

// ── Column drift (FR-E19, report-only) ──────────────────────────────────────

export interface ExportColumnRef {
  table: string;
  column: string;
}

const byTableThenColumn = (a: ExportColumnRef, b: ExportColumnRef): number =>
  a.table < b.table ? -1 : a.table > b.table ? 1 : a.column < b.column ? -1 : a.column > b.column ? 1 : 0;

/**
 * A live column on an `include` table that is in neither `columns` nor
 * `excludedColumns`: nobody has decided whether it is exported. Report-only:
 * the export never selects it (the list is explicit), so it cannot leak.
 */
export function exportColumnDrift(
  liveColumns: ReadonlyArray<{ table_name: string; column_name: string }>,
  descriptors: readonly PurgeDescriptor[] = PURGE_DESCRIPTORS
): ExportColumnRef[] {
  const decided = new Map<string, Set<string>>();
  for (const d of descriptors) {
    if (d.export?.kind !== 'include') continue;
    decided.set(d.table, new Set([...d.export.columns, ...Object.keys(d.export.excludedColumns ?? {})]));
  }
  return liveColumns
    .filter((c) => decided.get(c.table_name)?.has(c.column_name) === false)
    .map((c) => ({ table: c.table_name, column: c.column_name }))
    .sort(byTableThenColumn);
}

/**
 * A column an `include` table declares that is not live. PostgREST rejects the
 * whole select for one such column, so that section would always be `failed`.
 * Replaces the literal-select coverage `npm run schema:check` cannot give a
 * descriptor-driven select (SA-Q5). Tables that are not live at all are left
 * to the reconciler's `missingNever` / `missingDeletable`.
 */
export function exportColumnsMissing(
  liveColumns: ReadonlyArray<{ table_name: string; column_name: string }>,
  descriptors: readonly PurgeDescriptor[] = PURGE_DESCRIPTORS
): ExportColumnRef[] {
  const live = new Map<string, Set<string>>();
  for (const c of liveColumns) {
    live.set(c.table_name, (live.get(c.table_name) ?? new Set<string>()).add(c.column_name));
  }
  const missing: ExportColumnRef[] = [];
  for (const d of descriptors) {
    if (d.export?.kind !== 'include') continue;
    const columns = live.get(d.table);
    if (!columns) continue;
    for (const column of d.export.columns) {
      if (!columns.has(column)) missing.push({ table: d.table, column });
    }
  }
  return missing.sort(byTableThenColumn);
}
