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
  ExportRowFilter,
  ExportSectionId,
  TableExportClassification,
} from '@/lib/business-os/data-export/classificationTypes';

// ── Secret columns ──────────────────────────────────────────────────────────

/**
 * Column names that are never exported, whatever table they are on (§3.2):
 * secrets and visitor tracking.
 *
 * DE-5 (SA-Q11): + `card_number`, `cvc`, `cvv`. No such column exists today
 * ("no card number is ever stored in this system", 20260828e); the entries
 * stop one added later from being exported by a review mistake. A Stripe
 * `client_secret` is not listed: `/_secret$/` below already denies it.
 *
 * DE-6 (SA-Q5): + the visitor-tracking names `ip_hash_salt`, `user_agent`,
 * `session_id`, `ip_address`, `fingerprint`. Until DE-6 they were kept out
 * by review only (marketing_consent_events lists them in `excludedColumns`,
 * which this check does not read); now an include that lists one fails CI
 * and fails its section at request time. No DE-1…DE-5 include names any of
 * them. Exact names, so `checkout_session_id` is not matched.
 */
export const SECRET_COLUMN_DENY_EXACT: readonly string[] = [
  'access_token', 'refresh_token', 'token', 'credentials', 'secret', 'api_key',
  'password', 'password_hash', 'account_token', 'cost_usd', 'provider_cost_usd',
  'card_number', 'cvc', 'cvv',
  'ip_hash_salt', 'user_agent', 'session_id', 'ip_address', 'fingerprint',
];

/**
 * Name shapes that are never exported (secrets, hashes, salts, our provider
 * cost). DE-6 (SA-Q5): + `/_salt$/`: a salt stored next to a hash is what
 * lets the hash be checked against a known value.
 */
export const SECRET_COLUMN_DENY_PATTERNS: readonly RegExp[] = [
  /_token$/, /_secret$/, /_key$/, /_credentials$/, /_hash$/, /cost_usd$/, /_salt$/,
];

/**
 * `table.column` -> why a deny-list hit is harmless. A review decision: every
 * entry is an SA item in the slice that adds it (SA-Q6). The test fails on a
 * stale entry (one that no longer names an included column that is denied).
 */
export const DENY_EXCEPTIONS: Readonly<Record<string, string>> = {
  // DE-4 (user 2026-10-15): 'plugin_connections.plugin_key' removed with the
  // connected-apps section; the stale-entry check would flag it otherwise.
  // DE-4 SA-Q5 (approved 2026-10-15).
  'crm_pipeline_stages.stage_key': "the stage's short name (e.g. lead), which crm_contacts.stage refers to; not a credential",
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

export type ExportClassificationErrorCode =
  | 'unknown_table'
  | 'not_included'
  | 'invalid_column'
  | 'denied_column'
  // DE-4: resolving a section to its one descriptor, and the reader's bounds.
  | 'unknown_section'
  | 'not_user_scoped'
  | 'invalid_row_filter';

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

/**
 * The one `include` descriptor behind a section (DE-4 SA C-4): the reader is
 * handed a section id, never a table name, so no table literal lives in
 * `sections.ts`. DE-8b takes a CSV header from the same lookup
 * (`exportColumnsOf(exportDescriptorOfSection(id).table)`), so an empty
 * section still gets its header row. Throws `ExportClassificationError`
 * (`unknown_section`) for zero or several matches: fail closed.
 */
export function exportDescriptorOfSection(
  section: ExportSectionId,
  descriptors: readonly PurgeDescriptor[] = PURGE_DESCRIPTORS
): PurgeDescriptor {
  const matches = descriptors.filter((d) => d.export?.kind === 'include' && d.export.section === section);
  if (matches.length !== 1) {
    throw new ExportClassificationError('unknown_section', section, `expected one include descriptor for the section, found ${matches.length}`);
  }
  return matches[0];
}

/** A row-filter value: plain word characters only, so the quoted PostgREST list needs no escaping. */
const ROW_FILTER_VALUE = /^[A-Za-z0-9_]+$/;

/**
 * The PostgREST value list for `.not(column, 'in', list)`, each value quoted:
 * `("deleted")` (DE-4 SA C-6). Throws for a value outside `ROW_FILTER_VALUE`.
 */
export function rowFilterInList(filter: ExportRowFilter): string {
  for (const value of filter.notIn) {
    if (!ROW_FILTER_VALUE.test(value)) {
      throw new ExportClassificationError('invalid_row_filter', filter.column, `row filter value ${JSON.stringify(value)} is not a plain word`);
    }
  }
  return `(${filter.notIn.map((value) => `"${value}"`).join(',')})`;
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
 *
 * DE-6 (SA-Q1 (2)): the reader's key is checked here too, not only at request
 * time. An include WITHOUT `rowKey` must list `id` (the keyset reader pages on
 * it; until DE-6 that rule lived only in the repository). An include WITH
 * `rowKey` must have `rowKey: 'user_id'`, a `user_id` scope, no `user_id` in
 * `columns` (it is the owner id) and no `rowFilter`. `scope` is read off the
 * descriptor for that reason.
 */
export function tableExportProblems(
  descriptor: { table: string; export?: unknown; scope?: unknown },
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
      if (value.rowFilter !== undefined) problems.push(...rowFilterProblems(table, value.rowFilter, seen));
      problems.push(...rowKeyProblems(descriptor, value, seen));
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

/**
 * DE-4 U-4 (SA-Q2): a `rowFilter` names one of the table's declared columns,
 * a non-empty list of plain-word values, and a reason. NOT NULL is checked
 * against the live columns by `rowFilterNullabilityProblems` (SA C-6).
 */
function rowFilterProblems(table: string, filter: unknown, declared: ReadonlySet<string>): string[] {
  if (!isObject(filter)) return [`${table}: rowFilter must be { column, notIn, reason }`];
  const problems: string[] = [];
  if (typeof filter.column !== 'string' || !declared.has(filter.column)) {
    problems.push(`${table}: rowFilter column ${JSON.stringify(filter.column)} is not a declared column`);
  }
  const notIn = filter.notIn;
  if (!Array.isArray(notIn) || notIn.length === 0) {
    problems.push(`${table}: rowFilter needs a non-empty notIn list`);
  } else {
    for (const value of notIn as unknown[]) {
      if (typeof value !== 'string' || !ROW_FILTER_VALUE.test(value)) {
        problems.push(`${table}: rowFilter value ${JSON.stringify(value)} is not a plain word`);
      }
    }
  }
  if (!nonEmpty(filter.reason)) problems.push(`${table}: rowFilter has no reason`);
  return problems;
}

/**
 * DE-6 SA-Q1 (2): how the reader keys the table. Without `rowKey` the keyset
 * reader pages on `id`, so `id` must be declared. With it, the single-row
 * read's preconditions hold: `'user_id'` only, a `user_id` scope, the key not
 * selected, no row filter.
 */
function rowKeyProblems(
  descriptor: { table: string; scope?: unknown },
  value: Record<string, unknown>,
  declared: ReadonlySet<string>
): string[] {
  const { table } = descriptor;
  if (!('rowKey' in value) || value.rowKey === undefined) {
    return declared.has('id') ? [] : [`${table}: include without rowKey must list id (the keyset reader pages on it)`];
  }
  const problems: string[] = [];
  if (value.rowKey !== 'user_id') problems.push(`${table}: rowKey must be 'user_id', got ${JSON.stringify(value.rowKey)}`);
  const scope = descriptor.scope;
  if (!isObject(scope) || scope.kind !== 'user_id') problems.push(`${table}: rowKey needs a user_id scope`);
  if (declared.has('user_id')) problems.push(`${table}: rowKey user_id must not be in columns (it is the owner id)`);
  if (value.rowFilter !== undefined) problems.push(`${table}: rowKey and rowFilter together are not allowed`);
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

/**
 * DE-4 SA C-6: every `rowFilter` column is NOT NULL live. SQL `NOT IN` drops a
 * NULL row silently, so a nullable filter column would hide rows the owner
 * holds. A filter column missing from `liveColumns`, or without
 * `is_nullable = 'NO'`, is a problem (fail closed: unknown is not NOT NULL).
 * Tables absent from `liveColumns` entirely are skipped, as in
 * `exportColumnsMissing`.
 */
export function rowFilterNullabilityProblems(
  liveColumns: ReadonlyArray<{ table_name: string; column_name: string; is_nullable?: string }>,
  descriptors: readonly PurgeDescriptor[] = PURGE_DESCRIPTORS
): string[] {
  const problems: string[] = [];
  for (const d of descriptors) {
    if (d.export?.kind !== 'include' || !d.export.rowFilter) continue;
    const tableColumns = liveColumns.filter((c) => c.table_name === d.table);
    if (tableColumns.length === 0) continue;
    const { column } = d.export.rowFilter;
    const live = tableColumns.find((c) => c.column_name === column);
    if (live?.is_nullable !== 'NO') {
      problems.push(`${d.table}: rowFilter column ${column} is not NOT NULL live (is_nullable ${JSON.stringify(live?.is_nullable ?? null)})`);
    }
  }
  return problems;
}

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
