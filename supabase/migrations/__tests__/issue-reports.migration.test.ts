/**
 * Guard over migration 20261137, the `issue_reports` table (Business OS issue
 * reporting slice 1.1a; workplan BUSINESS_OS_ISSUE_REPORTING_SLICE_1_1_WORKPLAN.md
 * §2, §4, §8; requirement CR-5, CR-19, SR-2, SR-3; SA Review Notes 2026-11-27).
 *
 * WHY A TEST OVER SQL TEXT: there is no branch database. The user pastes the
 * migration in the Supabase SQL editor; the pre-check and the checkers are run
 * read-only. This file pins the text so a later edit cannot quietly widen a
 * grant, drop the owner-only policy, add a write policy or let the CHECK values
 * drift from the constants the app uses.
 *
 * Each rule is a detector returning its problems ([] means it holds). The
 * negative controls feed planted, broken copies to the same detectors, so a
 * detector that cannot fail is caught here, not on PROD.
 *
 * The 20261138 cleanup function and its checker's md5 row are pinned in
 * scripts/__tests__/testAccountCleanupSql.test.ts; this file checks the shape
 * of that checker as a read-only script only (SA RC-1).
 *
 * Pure: reads files and imports constants. No database, no network.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  ISSUE_REPORT_CATEGORY_HINTS,
  ISSUE_REPORT_CLOSED_REASONS,
  ISSUE_REPORT_CONTEXT_MAX_BYTES,
  ISSUE_REPORT_INITIAL_STATUS,
  ISSUE_REPORT_MESSAGE_MAX_LENGTH,
  ISSUE_REPORT_PAGE_MAX_LENGTH,
  ISSUE_REPORT_REFERENCE_PATTERN,
  ISSUE_REPORT_STATUSES,
} from '@/lib/business-os/issue-reports/issueReportModel';

const ROOT = process.cwd();
const readRaw = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8');

const FILE = {
  migration: ['supabase', 'migrations', '20261137_issue_reports.sql'],
  rollback: ['supabase', 'SQL Scripts', '20261137_issue_reports_rollback.sql'],
  precheck: ['scripts', 'precheck-issue-reports.sql'],
  checker: ['scripts', 'check-issue-reports-migration.sql'],
  checker138: ['scripts', 'check-test-account-cleanup-issue-reports-migration.sql'],
} as const;

const raw = Object.fromEntries(Object.entries(FILE).map(([name, parts]) => [name, readRaw(...parts)])) as Record<
  keyof typeof FILE,
  string
>;

const TABLE = 'public.issue_reports';
const CLEANUP_8 = 'public.operator_test_account_cleanup(text, text, text, text, uuid, text, uuid, jsonb)';

/** The workplan §2.1 columns, in table order: name, type, NOT NULL. */
const COLUMNS: ReadonlyArray<readonly [string, string, boolean]> = [
  ['id', 'uuid', true],
  ['user_id', 'uuid', true],
  ['reference', 'text', true],
  ['message', 'text', true],
  ['category_hint', 'text', false],
  ['page', 'text', true],
  ['area', 'text', false],
  ['environment', 'text', true],
  ['status', 'text', true],
  ['closed_reason', 'text', false],
  ['context', 'jsonb', false],
  ['screenshot_path', 'text', false],
  ['problem_id', 'uuid', false],
  ['created_at', 'timestamptz', true],
  ['updated_at', 'timestamptz', true],
];

const CHECK_NAMES = [
  'issue_reports_reference_format',
  'issue_reports_message_length',
  'issue_reports_category_hint_check',
  'issue_reports_page_shape',
  'issue_reports_area_shape',
  'issue_reports_environment_shape',
  'issue_reports_status_check',
  'issue_reports_closed_reason_check',
  'issue_reports_closed_shape',
  'issue_reports_context_shape',
  'issue_reports_screenshot_path_shape',
];

/** The SQL without its `--` comment lines. */
const codeOf = (sql: string) => sql.split('\n').filter((line) => !line.startsWith('--')).join('\n');
/** The SQL with every single-quoted literal emptied, so keywords inside messages and row names do not count. */
const withoutLiterals = (sql: string) => sql.replace(/'(?:[^']|'')*'/g, "''");
const squash = (sql: string) => sql.replace(/\s+/g, ' ');
const quotedList = (values: readonly string[]) => values.map((v) => `'${v}'`).join(', ');

function between(sql: string, start: string, end: string): string {
  const from = sql.indexOf(start);
  if (from < 0) return '';
  const to = sql.indexOf(end, from + start.length);
  return to < 0 ? '' : sql.slice(from, to + end.length);
}

/** The CREATE TABLE body, from its opening line to the closing `);`. */
const tableOf = (sql: string) => between(sql, `CREATE TABLE ${TABLE} (\n`, '\n);');

/** The body of one named CHECK constraint, whitespace squashed. */
function checkOf(sql: string, name: string): string {
  // Without the closing `\n);`, so the last constraint ends at its own parenthesis.
  const table = tableOf(sql).replace(/\n\);$/, '');
  const at = table.indexOf(`CONSTRAINT ${name}\n`);
  if (at < 0) return '';
  const next = table.indexOf('\n  CONSTRAINT ', at + 1);
  return squash(table.slice(at, next < 0 ? table.length : next)).trim().replace(/,$/, '');
}

// ── Detectors ──────────────────────────────────────────────────────────────

/** One transaction; lock_timeout; pre-guard before the table; post-condition after the policy; NOTIFY last. */
function structureProblems(sql: string): string[] {
  const problems: string[] = [];
  const code = codeOf(sql).trim();
  if (!code.startsWith("BEGIN;\n\nSET LOCAL lock_timeout = '5s';\n")) problems.push('does not open with BEGIN then lock_timeout');
  if ((code.match(/^BEGIN;$/gm) ?? []).length !== 1 || (code.match(/^COMMIT;$/gm) ?? []).length !== 1) {
    problems.push('not exactly one BEGIN and one COMMIT');
  }
  if (!code.endsWith("NOTIFY pgrst, 'reload schema';\n\nCOMMIT;")) problems.push('NOTIFY pgrst is not last before COMMIT');
  const guardEnd = code.indexOf('$pre_guard$;');
  const create = code.indexOf(`CREATE TABLE ${TABLE} (`);
  const policy = code.indexOf('CREATE POLICY ');
  const post = code.indexOf('DO $post_condition$');
  if (guardEnd < 0 || create < 0 || guardEnd > create) problems.push('the pre-guard does not come before the table');
  if (post < 0 || post < policy || post < code.lastIndexOf('GRANT ')) problems.push('the post-condition does not come after the grants and the policy');
  return problems;
}

/** The 15 columns, in order, with type and nullability; the defaults; nothing else. */
function columnProblems(sql: string): string[] {
  const problems: string[] = [];
  const table = tableOf(sql);
  if (table === '') return ['no CREATE TABLE'];
  const lines = table.split('\n').slice(1);
  const columnLines = lines.filter((line) => /^  [a-z_]+ +(uuid|text|jsonb|timestamptz) /.test(line));
  const found = columnLines.map((line) => {
    const m = /^  ([a-z_]+) +(uuid|text|jsonb|timestamptz) +(NOT NULL|NULL|PRIMARY KEY)/.exec(line);
    return m ? [m[1], m[2], m[3] !== 'NULL'] : [line];
  });
  if (JSON.stringify(found) !== JSON.stringify(COLUMNS)) problems.push(`columns differ: ${JSON.stringify(found)}`);
  const defaults = columnLines.filter((line) => line.includes(' DEFAULT ')).map((line) => squash(line).trim());
  const expected = [
    'id uuid PRIMARY KEY DEFAULT gen_random_uuid(),',
    `status text NOT NULL DEFAULT '${ISSUE_REPORT_INITIAL_STATUS}',`,
    'created_at timestamptz NOT NULL DEFAULT now(),',
    'updated_at timestamptz NOT NULL DEFAULT now(),',
  ];
  if (JSON.stringify(defaults) !== JSON.stringify(expected)) problems.push(`defaults differ: ${JSON.stringify(defaults)}`);
  return problems;
}

/** The CHECK values equal the app's constants; exactly the eleven named CHECKs. */
function checkConstraintProblems(sql: string): string[] {
  const problems: string[] = [];
  const named = [...tableOf(sql).matchAll(/CONSTRAINT (issue_reports_\w+)\n\s+CHECK \(/g)].map((m) => m[1]);
  if (JSON.stringify(named) !== JSON.stringify(CHECK_NAMES)) problems.push(`named CHECKs differ: ${named.join(',')}`);
  const expect = (name: string, body: string) => {
    if (checkOf(sql, name) !== `CONSTRAINT ${name} CHECK ${body}`) problems.push(`${name} differs: ${checkOf(sql, name)}`);
  };
  expect('issue_reports_reference_format', `(reference ~ '${ISSUE_REPORT_REFERENCE_PATTERN.source}')`);
  expect('issue_reports_message_length', `(char_length(message) BETWEEN 1 AND ${ISSUE_REPORT_MESSAGE_MAX_LENGTH})`);
  expect('issue_reports_category_hint_check', `(category_hint IS NULL OR category_hint IN (${quotedList(ISSUE_REPORT_CATEGORY_HINTS)}))`);
  expect(
    'issue_reports_page_shape',
    `(left(page, 1) = '/' AND strpos(page, '?') = 0 AND strpos(page, '#') = 0 AND char_length(page) <= ${ISSUE_REPORT_PAGE_MAX_LENGTH})`
  );
  expect('issue_reports_area_shape', "(area IS NULL OR area ~ '^[a-z][a-z0-9_-]{0,39}$')");
  expect('issue_reports_environment_shape', "(environment ~ '^[a-z][a-z-]{1,31}$')");
  expect('issue_reports_status_check', `(status IN (${quotedList(ISSUE_REPORT_STATUSES)}))`);
  expect('issue_reports_closed_reason_check', `(closed_reason IS NULL OR closed_reason IN (${quotedList(ISSUE_REPORT_CLOSED_REASONS)}))`);
  expect('issue_reports_closed_shape', "((status = 'closed') = (closed_reason IS NOT NULL))");
  expect(
    'issue_reports_context_shape',
    `(context IS NULL OR (jsonb_typeof(context) = 'object' AND octet_length(context::text) <= ${ISSUE_REPORT_CONTEXT_MAX_BYTES}))`
  );
  // The OQ-S2 layout {user_id}/{report_id}/: 36 + 1 + 36 + 1 = 74 characters of prefix.
  expect(
    'issue_reports_screenshot_path_shape',
    "(screenshot_path IS NULL OR (char_length(screenshot_path) <= 512 AND left(screenshot_path, 74) = (user_id::text || '/' || id::text || '/')))"
  );
  return problems;
}

/** One FK, user_id to auth.users ON DELETE CASCADE; the unique reference; no FK on problem_id. */
function keyProblems(sql: string): string[] {
  const problems: string[] = [];
  // Literals emptied: the post-condition names the REFERENCES privilege in its messages and arrays.
  const code = withoutLiterals(codeOf(sql));
  const table = squash(tableOf(sql));
  if ((code.match(/REFERENCES/g) ?? []).length !== 1) problems.push('not exactly one REFERENCES');
  if (!table.includes('CONSTRAINT issue_reports_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE,')) {
    problems.push('the user_id foreign key is not auth.users on delete cascade');
  }
  if (!table.includes('CONSTRAINT issue_reports_reference_key UNIQUE (reference),')) problems.push('the reference is not unique by name');
  if (/problem_id[^,\n]*REFERENCES/.test(code) || /FOREIGN KEY \(problem_id\)/.test(code)) problems.push('problem_id has a foreign key');
  if (!code.includes(`CREATE INDEX issue_reports_user_created\n  ON ${TABLE} (user_id, created_at DESC);`)) problems.push('the per-user index is missing');
  if ((code.match(/CREATE (UNIQUE )?INDEX/g) ?? []).length !== 1) problems.push('not exactly one CREATE INDEX');
  return problems;
}

/** RLS on; revoke from all four roles; exactly the two §2.4 grants; one owner-only SELECT policy; no write path. */
function accessProblems(sql: string): string[] {
  const problems: string[] = [];
  const code = withoutLiterals(codeOf(sql));
  if (!code.includes(`ALTER TABLE ${TABLE} ENABLE ROW LEVEL SECURITY;`)) problems.push('row level security is not enabled');
  if (!code.includes(`REVOKE ALL ON TABLE ${TABLE} FROM PUBLIC, anon, authenticated, service_role;`)) problems.push('the revoke is not from all four roles');
  const grants = code.match(/^GRANT .*;$/gm) ?? [];
  const expected = [`GRANT SELECT ON TABLE ${TABLE} TO authenticated;`, `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${TABLE} TO service_role;`];
  if (JSON.stringify(grants) !== JSON.stringify(expected)) problems.push(`grants differ: ${grants.join(' | ')}`);
  if (code.indexOf('REVOKE ALL') > code.indexOf('GRANT ')) problems.push('a grant comes before the revoke');
  const policies = codeOf(sql).match(/CREATE POLICY [\s\S]*?;/g) ?? [];
  const policy = `CREATE POLICY issue_reports_owner_select ON ${TABLE} AS PERMISSIVE FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));`;
  if (policies.length !== 1 || squash(policies[0]) !== policy) problems.push(`policies differ: ${policies.map(squash).join(' | ')}`);
  if (/FOR (INSERT|UPDATE|DELETE|ALL)/i.test(code)) problems.push('a write policy');
  if (/WITH CHECK/i.test(code)) problems.push('a WITH CHECK clause');
  if (/CREATE (OR REPLACE )?FUNCTION/i.test(code)) problems.push('creates a function');
  if (/CREATE TRIGGER/i.test(code)) problems.push('creates a trigger');
  if (/SECURITY\s+DEFINER/i.test(code)) problems.push('says SECURITY DEFINER');
  if (/TO (PUBLIC|anon)\b/.test(code.replace(/FROM PUBLIC, anon/, ''))) problems.push('grants or a policy to PUBLIC or anon');
  return problems;
}

/** Every pasted or run file: ASCII, LF, header-only comments without ; or ', no "into", no meta-commands. */
function pasteProblems(sql: string): string[] {
  const problems: string[] = [];
  if (sql.includes('\r')) problems.push('CR found (must be LF)');
  if (/[^\x00-\x7f]/.test(sql)) problems.push('non-ASCII character');
  if (sql.includes('/*')) problems.push('a block comment');
  const lines = sql.split('\n');
  const firstCode = lines.findIndex((line) => line !== '' && !line.startsWith('--'));
  lines.forEach((line, index) => {
    if (line.includes('--') && !(line.startsWith('-- ') && index < firstCode && !/[;']/.test(line))) {
      problems.push(`comment at line ${index + 1} is not a clean header line`);
    }
  });
  if (/into/i.test(sql)) problems.push('the word "into"');
  if (/^\s*\\/m.test(sql)) problems.push('a psql meta-command');
  if ((sql.match(/'/g) ?? []).length % 2 !== 0) problems.push('odd number of single quotes');
  if ((sql.match(/\$[A-Za-z_]*\$/g) ?? []).length % 2 !== 0) problems.push('unclosed dollar quote');
  return problems;
}

/** The pre-check and the checkers: one read-only SELECT, numbered rows, stated count. */
function scriptProblems(sql: string): string[] {
  const problems: string[] = [...pasteProblems(sql)];
  if (/(?<![A-Za-z0-9_])SET(?![A-Za-z0-9_])/i.test(sql)) problems.push('a SET');
  const bare = withoutLiterals(codeOf(sql));
  const write = bare.match(
    /(?<![A-Za-z0-9_])(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|CREATE|GRANT|REVOKE|TRUNCATE|COPY|COMMENT|DO|BEGIN|COMMIT|CALL|LOCK|VACUUM|REFRESH|NOTIFY)(?![A-Za-z0-9_])/i
  );
  if (write) problems.push(`write or control keyword ${write[1]}`);
  if ((sql.match(/;/g) ?? []).length !== 1) problems.push('not exactly one statement');
  if (!codeOf(sql).trimStart().startsWith('WITH\n')) problems.push('does not start with WITH');
  if (!sql.trimEnd().endsWith('ORDER BY checks.ord;')) problems.push('does not end ORDER BY checks.ord');
  if (!sql.includes("CASE WHEN checks.passed THEN 'ok' ELSE 'FAIL' END AS status")) problems.push('no ok / FAIL status column');
  if (/::regclass|::regprocedure/.test(bare)) problems.push('a raising cast (use to_regclass / to_regprocedure)');
  const ords = [...bare.matchAll(/SELECT ([0-9]+)(?: AS ord)?, ''/g)].map((m) => Number(m[1]));
  const stated = /It returns ([0-9]+) rows\./.exec(sql);
  if (!stated) problems.push('no stated row count');
  if (ords.length === 0 || ords.some((n, i) => n !== i + 1)) problems.push(`rows not numbered 1..n: ${ords.join(',')}`);
  if (stated && Number(stated[1]) !== ords.length) problems.push(`states ${stated[1]} rows, has ${ords.length}`);
  return problems;
}

/** The rollback refuses on a missing table, on the cleanup function still naming it, and on rows; then a plain DROP. */
function rollbackProblems(sql: string): string[] {
  const problems: string[] = [];
  const code = codeOf(sql);
  const guard = squash(between(code, 'DO $rollback_guard$', '$rollback_guard$;'));
  if (!guard.includes(`IF pg_catalog.to_regclass('${TABLE}') IS NULL THEN RAISE`)) problems.push('does not refuse a missing table');
  if (!guard.includes(`p.oid = pg_catalog.to_regprocedure('${CLEANUP_8}') AND position('issue_reports' in p.prosrc) > 0) THEN RAISE`)) {
    problems.push('does not refuse while the cleanup function names the table');
  }
  const lock = guard.indexOf(`LOCK TABLE ${TABLE} IN ACCESS EXCLUSIVE MODE;`);
  const count = guard.indexOf(`v_rows := (SELECT count(*) FROM ${TABLE});`);
  if (lock < 0 || count < 0 || lock > count) problems.push('the table is not locked before the count');
  if (!guard.includes('IF v_rows > 0 THEN RAISE')) problems.push('does not refuse a table with rows');
  if (!code.includes(`DROP TABLE ${TABLE};`)) problems.push('no plain DROP TABLE');
  if ((code.match(/^DROP /gm) ?? []).length !== 1) problems.push('not exactly one DROP');
  if (/(?<![A-Za-z0-9_])CASCADE(?![A-Za-z0-9_])/i.test(code)) problems.push('CASCADE');
  if (code.indexOf('$rollback_guard$;') > code.indexOf('DROP TABLE')) problems.push('the DROP comes before the guard');
  if (!code.trim().startsWith("BEGIN;\n\nSET LOCAL lock_timeout = '5s';")) problems.push('does not open with BEGIN then lock_timeout');
  if (!code.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';\n\nCOMMIT;")) problems.push('NOTIFY pgrst is not last before COMMIT');
  return problems;
}

/** Checker A: C-2 holds the 15 columns, C-13 every named CHECK, and the grants and policy rows read catalogs, not names. */
function checkerProblems(sql: string): string[] {
  const problems: string[] = [];
  for (const [name] of COLUMNS) if (!sql.includes(`('${name}', `)) problems.push(`C-2 does not list ${name}`);
  if ((sql.match(/^    \('[a-z_]+', '[a-z ]+', (true|false)\),?$/gm) ?? []).length !== 15) problems.push('C-2 does not hold 15 expected columns');
  for (const name of CHECK_NAMES) if (!sql.includes(`'${name}'`)) problems.push(`C-13 does not name ${name}`);
  if (!sql.includes("pol.polroles = ARRAY[(SELECT r.oid FROM pg_catalog.pg_roles AS r WHERE r.rolname = 'authenticated')]::oid[]")) {
    problems.push('C-6 does not read polroles');
  }
  if (!sql.includes('AND pol.polwithcheck IS NULL')) problems.push('C-6 does not check WITH CHECK is absent');
  if (!sql.includes('acl.grantee = 0')) problems.push('C-7 does not read the PUBLIC acl entry');
  // SA code review finding 1: rows 8 to 10 prove on their own what the migration post-condition asserts.
  const rel = '(SELECT rel.oid FROM rel)';
  const proves: ReadonlyArray<[string, string]> = [
    ...(['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] as const).map(
      (p): [string, string] => [`C-8 anon column ${p}`, `AND NOT pg_catalog.has_any_column_privilege('anon', ${rel}, '${p}')`]
    ),
    ...(['INSERT', 'UPDATE', 'REFERENCES'] as const).map(
      (p): [string, string] => [`C-9 authenticated column ${p}`, `AND NOT pg_catalog.has_any_column_privilege('authenticated', ${rel}, '${p}')`]
    ),
    ...(['TRUNCATE', 'REFERENCES', 'TRIGGER'] as const).map(
      (p): [string, string] => [`C-10 service_role ${p}`, `AND NOT pg_catalog.has_table_privilege('service_role', ${rel}, '${p}')`]
    ),
  ];
  for (const [name, clause] of proves) if (!sql.includes(clause)) problems.push(`${name} is not checked`);
  if (!sql.includes("SELECT 16, 'information only, never a gate.")) problems.push('row 16 is not marked information only');
  if (!sql.includes('-- Run it once BEFORE the paste too. Every row must read FAIL then')) problems.push('the header does not say it must FAIL first');
  return problems;
}

// ── The rules over the real files ──────────────────────────────────────────

describe('20261137: the issue_reports table (issue reporting 1.1a)', () => {
  it('one transaction: lock_timeout, pre-guard before the table, post-condition after the grants and policy, NOTIFY last', () => {
    expect(structureProblems(raw.migration)).toEqual([]);
  });

  it('the 15 columns of workplan §2.1, in order, with their types, nullability and defaults', () => {
    expect(columnProblems(raw.migration)).toEqual([]);
  });

  it('the eleven named CHECKs, with the values of issueReportModel.ts (statuses, hints, closed reasons, reference pattern, bounds)', () => {
    expect(checkConstraintProblems(raw.migration)).toEqual([]);
  });

  it('one foreign key (user_id to auth.users ON DELETE CASCADE), a unique reference, no FK on problem_id, one index', () => {
    expect(keyProblems(raw.migration)).toEqual([]);
  });

  it('RLS on; revoke from PUBLIC, anon, authenticated, service_role; SELECT to authenticated, S/I/U/D to service_role; one owner-only SELECT policy', () => {
    expect(accessProblems(raw.migration)).toEqual([]);
  });

  it('the pre-guard refuses an existing table, a writable public schema and missing auth facts', () => {
    const guard = squash(between(codeOf(raw.migration), 'DO $pre_guard$', '$pre_guard$;'));
    expect(guard).toContain(`IF pg_catalog.to_regclass('${TABLE}') IS NOT NULL THEN RAISE`);
    expect(guard).toContain("pg_catalog.has_schema_privilege('anon', 'public', 'CREATE') OR pg_catalog.has_schema_privilege('authenticated', 'public', 'CREATE') THEN RAISE");
    expect(guard).toContain("att.attrelid = pg_catalog.to_regclass('auth.users') AND att.attname = 'id'");
    expect(guard).toContain("IF pg_catalog.to_regprocedure('auth.uid()') IS NULL THEN RAISE");
  });

  it('the post-condition checks the policy by polroles, the grants by privilege, the FK, the eleven CHECKs and no trigger', () => {
    const post = between(raw.migration, 'DO $post_condition$', '$post_condition$;');
    expect(post).toContain("pol.polroles = ARRAY[(SELECT r.oid FROM pg_catalog.pg_roles AS r WHERE r.rolname = 'authenticated')]::oid[]");
    expect(post).toContain("FOREACH v_role IN ARRAY ARRAY['public', 'anon']");
    expect(post).toContain("IF NOT pg_catalog.has_table_privilege('authenticated', v_table, 'SELECT') THEN");
    expect(post).toContain("AND con.confdeltype = 'c'");
    expect(post).toContain('IF v_count <> 11 THEN');
    for (const name of CHECK_NAMES) expect([name, post.includes(`'${name}'`)]).toEqual([name, true]);
    expect(post).toContain('NOT trg.tgisinternal');
  });

  it('the header names the apply order with 20261138, the pre-check, the checker and the rollback', () => {
    const header = raw.migration.slice(0, raw.migration.indexOf('\nBEGIN;\n'));
    expect(header).toContain('-- Apply BEFORE 20261138_operator_test_account_cleanup_issue_reports, in the same sitting.');
    expect(header).toContain('-- Pre-check scripts/precheck-issue-reports.sql. Checker scripts/check-issue-reports-migration.sql\n');
    expect(header).toContain('-- Rollback supabase/SQL Scripts/20261137_issue_reports_rollback.sql, run only after the 20261138 rollback\n');
  });
});

describe('20261137 rollback', () => {
  it('refuses on a missing table, on the cleanup function still naming it, and on rows (locked first); then a plain DROP', () => {
    expect(rollbackProblems(raw.rollback)).toEqual([]);
  });
});

describe('paste safety and the read-only scripts', () => {
  it.each(Object.keys(FILE) as Array<keyof typeof FILE>)('%s is ASCII, LF, header-only comments, no "into", no meta-commands', (name) => {
    expect(pasteProblems(raw[name])).toEqual([]);
  });

  it.each([
    ['precheck', 7],
    ['checker', 16],
    ['checker138', 9],
  ] as const)('%s is one read-only SELECT with %i numbered rows and a stated count', (name, rows) => {
    expect(scriptProblems(raw[name])).toEqual([]);
    expect(raw[name]).toContain(`It returns ${rows} rows.`);
  });

  it('the checker lists the 15 columns and the eleven CHECKs, reads polroles and the acl, and says it must FAIL first', () => {
    expect(checkerProblems(raw.checker)).toEqual([]);
  });

  it('the pre-check proves the table and policy are absent and the auth facts hold (rows 1 to 6)', () => {
    expect(raw.precheck).toContain(`pg_catalog.to_regclass('${TABLE}') IS NULL AS passed`);
    expect(raw.precheck).toContain("NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy AS pol WHERE pol.polname = 'issue_reports_owner_select')");
    expect(raw.precheck).toContain("pg_catalog.to_regprocedure('auth.uid()') IS NOT NULL");
  });

  it('the B checker (SA RC-1) has the shape of its 20261134 precedent', () => {
    expect(raw.checker138).toContain(`pg_catalog.to_regprocedure('${CLEANUP_8}') AS oid`);
    expect(raw.checker138).toContain("SELECT 9, 'operator gate. md5 of the body is ");
    expect(raw.checker138).toContain("SELECT 7, 'its body names issue_reports in its plan',");
  });

  it('.gitattributes keeps each of the five files LF (paste-safety rule 3)', () => {
    const attributes = readRaw('.gitattributes').replace(/\r\n/g, '\n');
    for (const line of [
      'supabase/migrations/20261137_issue_reports.sql text eol=lf',
      'supabase/SQL[[:space:]]Scripts/20261137_issue_reports_rollback.sql text eol=lf',
      'scripts/precheck-issue-reports.sql text eol=lf',
      'scripts/check-issue-reports-migration.sql text eol=lf',
      'scripts/check-test-account-cleanup-issue-reports-migration.sql text eol=lf',
    ]) {
      expect([line, attributes.split('\n').includes(line)]).toEqual([line, true]);
    }
  });
});

// ── Negative controls: planted, broken copies fail their detector ─────────

describe('20261137 negative controls', () => {
  const plant = (sql: string, from: string, to: string) => {
    expect([from, sql.includes(from)]).toEqual([from, true]);
    return sql.replace(from, to);
  };

  it('a status the constants do not know, or a changed reference pattern, fails the CHECK rule', () => {
    expect(checkConstraintProblems(plant(raw.migration, "'resolved', 'closed'", "'resolved', 'closed', 'archived'"))).toEqual([
      expect.stringContaining('issue_reports_status_check differs'),
    ]);
    expect(checkConstraintProblems(plant(raw.migration, '[0-9A-HJKMNP-TV-Z]{8}', '[0-9A-Z]{8}'))).toEqual([
      expect.stringContaining('issue_reports_reference_format differs'),
    ]);
  });

  it('a dropped CHECK fails the CHECK rule', () => {
    const dropped = plant(raw.migration, "  CONSTRAINT issue_reports_closed_shape\n    CHECK ((status = 'closed') = (closed_reason IS NOT NULL)),\n", '');
    expect(checkConstraintProblems(dropped)).toEqual(expect.arrayContaining([expect.stringContaining('named CHECKs differ')]));
  });

  it('a nullable user_id or an extra column fails the column rule', () => {
    expect(columnProblems(plant(raw.migration, '  user_id          uuid        NOT NULL,', '  user_id          uuid        NULL,'))).toEqual([
      expect.stringContaining('columns differ'),
    ]);
    expect(columnProblems(plant(raw.migration, '  problem_id       uuid        NULL,\n', '  problem_id       uuid        NULL,\n  resolved_at      timestamptz NULL,\n'))).toEqual([
      expect.stringContaining('columns differ'),
    ]);
  });

  it('an FK on problem_id, or SET NULL on user_id, fails the key rule', () => {
    expect(keyProblems(plant(raw.migration, '  problem_id       uuid        NULL,', '  problem_id       uuid        NULL REFERENCES public.issue_problems (id),'))).toEqual(
      expect.arrayContaining(['not exactly one REFERENCES', 'problem_id has a foreign key'])
    );
    expect(keyProblems(plant(raw.migration, 'REFERENCES auth.users (id) ON DELETE CASCADE', 'REFERENCES auth.users (id) ON DELETE SET NULL'))).toContain(
      'the user_id foreign key is not auth.users on delete cascade'
    );
  });

  it('a wider grant, a write policy, a policy to PUBLIC or a SECURITY DEFINER fails the access rule', () => {
    expect(accessProblems(plant(raw.migration, `GRANT SELECT ON TABLE ${TABLE} TO authenticated;`, `GRANT SELECT, INSERT ON TABLE ${TABLE} TO authenticated;`))).toEqual([
      expect.stringContaining('grants differ'),
    ]);
    expect(accessProblems(plant(raw.migration, 'AS PERMISSIVE FOR SELECT TO authenticated', 'AS PERMISSIVE FOR ALL TO authenticated'))).toEqual(
      expect.arrayContaining(['a write policy'])
    );
    expect(accessProblems(plant(raw.migration, 'AS PERMISSIVE FOR SELECT TO authenticated', 'AS PERMISSIVE FOR SELECT TO PUBLIC'))).toEqual(
      expect.arrayContaining(['grants or a policy to PUBLIC or anon'])
    );
    expect(accessProblems(`${raw.migration}\nCREATE FUNCTION f() RETURNS int LANGUAGE sql SECURITY DEFINER AS $f$ SELECT 1 $f$;\n`)).toEqual(
      expect.arrayContaining(['creates a function', 'says SECURITY DEFINER'])
    );
    expect(accessProblems(plant(raw.migration, `ALTER TABLE ${TABLE} ENABLE ROW LEVEL SECURITY;`, ''))).toContain('row level security is not enabled');
  });

  it('"into" in a comment, a CR, a semicolon in a comment fail the paste rule', () => {
    expect(pasteProblems(`-- paste this into the editor\n${raw.migration}`)).toContain('the word "into"');
    expect(pasteProblems(raw.migration.replace('\n', '\r\n'))).toContain('CR found (must be LF)');
    expect(pasteProblems(`-- one; two\n${raw.migration}`)).toContain('comment at line 1 is not a clean header line');
  });

  it('a CASCADE, a lost row refusal or the lock after the count fail the rollback rule', () => {
    expect(rollbackProblems(plant(raw.rollback, `DROP TABLE ${TABLE};`, `DROP TABLE ${TABLE} CASCADE;`))).toContain('CASCADE');
    expect(rollbackProblems(plant(raw.rollback, 'IF v_rows > 0 THEN', 'IF false THEN'))).toContain('does not refuse a table with rows');
    const lock = `  LOCK TABLE ${TABLE} IN ACCESS EXCLUSIVE MODE;\n`;
    const late = plant(plant(raw.rollback, lock, ''), '  IF v_rows > 0 THEN', `${lock}  IF v_rows > 0 THEN`);
    expect(rollbackProblems(late)).toContain('the table is not locked before the count');
  });

  it('a SET, a second statement, a skipped row number, a raising cast or a wrong count fail the script rule', () => {
    expect(scriptProblems(`SET statement_timeout = 0\n${raw.checker}`)).toContain('a SET');
    expect(scriptProblems(`${raw.checker}SELECT 1;\n`)).toContain('not exactly one statement');
    expect(scriptProblems(raw.checker.replace('  SELECT 3, ', '  SELECT 5, '))).toContain('rows not numbered 1..n: 1,2,5,4,5,6,7,8,9,10,11,12,13,14,15,16');
    expect(scriptProblems(raw.checker.replace('It returns 16 rows.', 'It returns 15 rows.'))).toContain('states 15 rows, has 16');
    expect(scriptProblems(raw.precheck.replace("pg_catalog.to_regclass('public.issue_reports') IS NULL", "'public.issue_reports'::regclass IS NULL"))).toContain(
      'a raising cast (use to_regclass / to_regprocedure)'
    );
    expect(scriptProblems(raw.checker.replace('WITH\n', 'WITH\ngone AS (DELETE FROM x RETURNING 1),\n'))).toEqual(
      expect.arrayContaining(['write or control keyword DELETE'])
    );
  });

  it('a checker that drops a CHECK name or reads the policy by name fails the checker rule', () => {
    expect(checkerProblems(plant(raw.checker, "'issue_reports_context_shape',", ''))).toContain('C-13 does not name issue_reports_context_shape');
    expect(checkerProblems(plant(raw.checker, 'AND pol.polroles = ARRAY[', 'AND pol.polname = ARRAY['))).toContain('C-6 does not read polroles');
    expect(
      checkerProblems(plant(raw.checker, "    AND NOT pg_catalog.has_table_privilege('service_role', (SELECT rel.oid FROM rel), 'TRIGGER')\n", ''))
    ).toContain('C-10 service_role TRIGGER is not checked');
    expect(
      checkerProblems(plant(raw.checker, "    AND NOT pg_catalog.has_any_column_privilege('anon', (SELECT rel.oid FROM rel), 'REFERENCES')\n", ''))
    ).toContain('C-8 anon column REFERENCES is not checked');
  });
});
