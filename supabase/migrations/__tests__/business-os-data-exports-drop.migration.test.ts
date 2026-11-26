/**
 * Guard over migration 20261135, the DROP of the old ZIP export table
 * `business_os_data_exports` and its start function (module export MX-7, E10;
 * workplan BUSINESS_OS_EXPORT_MX7_WORKPLAN.md §4.3, §4.4, §4.9, §7.3 T-7a to
 * T-7f, SA S-2, S-6, SA-Q15).
 *
 * WHY A TEST OVER SQL TEXT: there is no branch database. The user pastes the
 * migration in the Supabase SQL editor; the pre-check and the checkers are run
 * read-only. This file pins the text so a later edit cannot quietly drop the
 * SR-6 order guard, add a CASCADE, or let the rollback drift from 20261074.
 *
 * Each rule is a detector returning its problems ([] means it holds). The
 * negative controls feed planted, broken copies to the same detectors, so a
 * detector that cannot fail is caught here, not on PROD.
 *
 * Pure: reads files only. No database, no network.
 */

import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const readRaw = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8');

const FILE = {
  migration: ['supabase', 'migrations', '20261135_drop_business_os_data_exports.sql'],
  rollback: ['supabase', 'SQL Scripts', '20261135_drop_business_os_data_exports_rollback.sql'],
  precheck: ['scripts', 'precheck-drop-data-exports.sql'],
  checker134: ['scripts', 'check-test-account-cleanup-drop-data-exports-migration.sql'],
  checker135: ['scripts', 'check-drop-data-exports-migration.sql'],
} as const;

const raw = Object.fromEntries(Object.entries(FILE).map(([name, parts]) => [name, readRaw(...parts)])) as Record<
  keyof typeof FILE,
  string
>;
/** The DE-8a migration, LF-normalised: a Windows checkout of it may hold CRLF (it has no eol line). */
const de8a = readRaw('supabase', 'migrations', '20261074_business_os_data_exports.sql').replace(/\r\n/g, '\n');
/** The 20261134 cleanup function migration (LF on every checkout, .gitattributes). */
const cleanup134 = readRaw('supabase', 'migrations', '20261134_operator_test_account_cleanup_drop_data_exports.sql').replace(
  /\r\n/g,
  '\n'
);

const TABLE = 'public.business_os_data_exports';
const START = 'public.business_os_data_export_start(uuid, uuid, text)';
const CLEANUP_8 = 'public.operator_test_account_cleanup(text, text, text, text, uuid, text, uuid, jsonb)';
const STAMP_130 = '5c369aaf2fa78abf';
const STAMP_134 = '9a097ff36229f6b5';

/** The SQL without its `--` comment lines. */
const codeOf = (sql: string) => sql.split('\n').filter((line) => !line.startsWith('--')).join('\n');
/** The SQL with every single-quoted literal emptied, so keywords inside messages and row names do not count. */
const withoutLiterals = (sql: string) => sql.replace(/'(?:[^']|'')*'/g, "''");

function between(sql: string, start: string, end: string): string {
  const from = sql.indexOf(start);
  expect([start, from >= 0]).toEqual([start, true]);
  const to = sql.indexOf(end, from + start.length);
  expect([end, to > from]).toEqual([end, true]);
  return sql.slice(from, to + end.length);
}

// ── Detectors ──────────────────────────────────────────────────────────────

/** T-7a: one transaction; lock_timeout; guard before any DROP; post-condition after; NOTIFY last. */
function structureProblems(sql: string): string[] {
  const problems: string[] = [];
  const code = codeOf(sql).trim();
  if (!code.startsWith("BEGIN;\n\nSET LOCAL lock_timeout = '5s';\n")) problems.push('does not open with BEGIN then lock_timeout');
  if ((code.match(/^BEGIN;$/gm) ?? []).length !== 1 || (code.match(/^COMMIT;$/gm) ?? []).length !== 1) {
    problems.push('not exactly one BEGIN and one COMMIT');
  }
  if (!code.endsWith("NOTIFY pgrst, 'reload schema';\n\nCOMMIT;")) problems.push('NOTIFY pgrst is not last before COMMIT');
  const guardEnd = code.indexOf('$drop_guard$;');
  const firstDrop = code.search(/^DROP /m);
  const check = code.indexOf('DO $drop_check$');
  if (guardEnd < 0 || firstDrop < 0 || guardEnd > firstDrop) problems.push('the guard does not come before every DROP');
  if (code.indexOf('LOCK TABLE public.business_os_data_exports IN ACCESS EXCLUSIVE MODE;') < guardEnd) {
    problems.push('the table is not locked after the guard');
  }
  if (check < 0 || check < code.lastIndexOf('DROP ')) problems.push('the post-condition does not come after the drops');
  return problems;
}

/** T-7b: the five guard rows (SA-Q3, SA-Q15). */
function guardProblems(sql: string): string[] {
  const problems: string[] = [];
  const guard = sql.includes('DO $drop_guard$') ? between(sql, 'DO $drop_guard$', '$drop_guard$;') : '';
  const squashed = guard.replace(/\s+/g, ' ');
  // (1) the exact 8 argument signature, and its body must no longer name the table
  if (!squashed.includes(`fn.oid = pg_catalog.to_regprocedure('${CLEANUP_8}') AND position('business_os_data_exports' IN fn.prosrc) > 0) THEN RAISE`)) {
    problems.push('(1) the live 8 argument cleanup body is not checked for the table name');
  }
  if (!squashed.includes(`IF pg_catalog.to_regprocedure('${CLEANUP_8}') IS NULL THEN RAISE`)) {
    problems.push('(1) a missing 8 argument cleanup function is not refused');
  }
  // (2) every schema: no nspname filter on this scan, only the start function exempt
  if (
    !squashed.includes(
      `WHERE position('business_os_data_exports' IN fn.prosrc) > 0 AND fn.oid IS DISTINCT FROM pg_catalog.to_regprocedure('${START}')) THEN RAISE`
    )
  ) {
    problems.push('(2) other function bodies in every schema are not checked');
  }
  // (3) nothing in flight
  if (!squashed.includes(`FROM ${TABLE} AS job WHERE job.status IN ('queued', 'running')) THEN RAISE`)) {
    problems.push('(3) queued or running rows are not refused');
  }
  // (4) no inbound FK from another table
  if (!squashed.includes(`con.contype = 'f' AND con.confrelid = pg_catalog.to_regclass('${TABLE}') AND con.conrelid <> con.confrelid) THEN RAISE`)) {
    problems.push('(4) inbound foreign keys are not refused');
  }
  // (5) exact start function signature, one overload
  if (!squashed.includes(`IF pg_catalog.to_regprocedure('${START}') IS NULL OR (SELECT count(*) FROM pg_catalog.pg_proc AS fn`)) {
    problems.push('(5) the exact start function signature is not required');
  }
  if (!/WHERE ns\.nspname = 'public' AND fn\.proname = 'business_os_data_export_start'\) <> 1 THEN/.test(squashed)) {
    problems.push('(5) a second overload is not refused');
  }
  if (!squashed.includes(`IF pg_catalog.to_regclass('${TABLE}') IS NULL THEN RAISE`)) problems.push('a missing table is not refused');
  if ((guard.match(/RAISE EXCEPTION/g) ?? []).length !== 7) problems.push('the guard does not hold exactly 7 refusals');
  return problems;
}

/** T-7c: function before table, no CASCADE, no IF EXISTS, nothing about storage. */
function dropProblems(sql: string): string[] {
  const problems: string[] = [];
  const code = codeOf(sql);
  const dropFn = code.indexOf(`DROP FUNCTION ${START};`);
  const dropTable = code.indexOf(`DROP TABLE ${TABLE};`);
  if (dropFn < 0) problems.push('DROP FUNCTION missing or not exact');
  if (dropTable < 0) problems.push('DROP TABLE missing or not exact');
  if (dropFn > dropTable) problems.push('the table is dropped before the function');
  if ((code.match(/^DROP /gm) ?? []).length !== 2) problems.push('not exactly two DROP statements');
  if (/(?<![A-Za-z0-9_])CASCADE(?![A-Za-z0-9_])/i.test(code)) problems.push('CASCADE');
  // The guard's plpgsql `IF EXISTS (SELECT ...)` is a test, not a DROP option.
  if (/(?<![A-Za-z0-9_])DROP\s+\w+\s+IF\s+EXISTS(?![A-Za-z0-9_])/i.test(code)) problems.push('IF EXISTS');
  if (/storage\./i.test(code) || /bucket/i.test(code)) problems.push('touches storage');
  const check = code.includes('DO $drop_check$') ? between(code, 'DO $drop_check$', '$drop_check$;') : '';
  if (!check.includes(`pg_catalog.to_regclass('${TABLE}') IS NOT NULL`) || !check.includes(`pg_catalog.to_regprocedure('${START}') IS NOT NULL`)) {
    problems.push('the post-condition does not check both objects are gone');
  }
  return problems;
}

/** Removes the plpgsql keywords the editor accepts (the start function body holds two). */
const withoutIntoKeywords = (sql: string) => sql.replace(/(?<![A-Za-z0-9_])INSERT INTO /g, '').replace(/(?<![A-Za-z0-9_])RETURNING \w+\.\w+ INTO /g, '');

/** T-7d, every file: ASCII, LF, header-only comments without ; or ', no "into" but the two keywords. */
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
  if (/into/i.test(withoutIntoKeywords(sql))) problems.push('"into" outside the INSERT INTO / RETURNING INTO keywords');
  if (/SECURITY\s+DEFINER/i.test(sql)) problems.push('says SECURITY DEFINER');
  if ((sql.match(/'/g) ?? []).length % 2 !== 0) problems.push('odd number of single quotes');
  if ((sql.match(/\$[A-Za-z_]*\$/g) ?? []).length % 2 !== 0) problems.push('unclosed dollar quote');
  return problems;
}

/** T-7d (S-6) + T-7f, the pre-check and the checkers: one read-only SELECT, numbered rows, stated count. */
function scriptProblems(sql: string): string[] {
  const problems: string[] = [...pasteProblems(sql)];
  if (/into/i.test(sql)) problems.push('the word "into" (identifiers and aliases included)');
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
  const ords = [...bare.matchAll(/SELECT ([0-9]+)(?: AS ord)?, ''/g)].map((m) => Number(m[1]));
  const stated = /It returns ([0-9]+) rows\./.exec(sql);
  if (!stated) problems.push('no stated row count');
  if (ords.length === 0 || ords.some((n, i) => n !== i + 1)) problems.push(`rows not numbered 1..n: ${ords.join(',')}`);
  if (stated && Number(stated[1]) !== ords.length) problems.push(`states ${stated[1]} rows, has ${ords.length}`);
  return problems;
}

/** The 20261074 statements the 20261135 rollback must hold byte for byte, in this order (S-2). */
function de8aStatements(): Array<[string, string]> {
  const post = between(de8a, 'DO $post_condition$', '$post_condition$;');
  // Items 6 and 7 are the bucket's: the rollback does not re-create the bucket (§4.4).
  const bucketItems = post.slice(
    post.indexOf('  v_count := (SELECT count(*) FROM storage.buckets AS bucket'),
    post.indexOf('  v_count := (SELECT count(*) FROM pg_catalog.pg_trigger AS trg')
  );
  return [
    ['the table, its defaults, the FK and the eleven CHECKs', between(de8a, 'CREATE TABLE public.business_os_data_exports (', '\n);')],
    ['the unique partial index', between(de8a, 'CREATE UNIQUE INDEX business_os_data_exports_one_in_progress', ';')],
    ['the user / created index', between(de8a, 'CREATE INDEX business_os_data_exports_user_created', ';')],
    ['the ready expiry index', between(de8a, 'CREATE INDEX business_os_data_exports_ready_expiry', ';')],
    ['row level security', 'ALTER TABLE public.business_os_data_exports ENABLE ROW LEVEL SECURITY;'],
    ['the table revoke', 'REVOKE ALL ON TABLE public.business_os_data_exports FROM PUBLIC, anon, authenticated, service_role;'],
    ['the table grant', 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.business_os_data_exports TO service_role;'],
    ['the start function, body byte-equal', between(de8a, 'CREATE FUNCTION public.business_os_data_export_start(', '$start$;')],
    ['the function revoke', `REVOKE ALL ON FUNCTION ${START} FROM PUBLIC, anon, authenticated, service_role;`],
    ['the function grant', `GRANT EXECUTE ON FUNCTION ${START} TO service_role;`],
    ['the 20261074 post-condition without the bucket items', post.replace(bucketItems, '')],
  ];
}

/** T-7e: the rollback refuses while either object exists, then re-creates the 20261074 shape. */
function rollbackProblems(sql: string): string[] {
  const problems: string[] = [];
  const code = codeOf(sql);
  const guard = code.includes('DO $rollback_guard$') ? between(code, 'DO $rollback_guard$', '$rollback_guard$;') : '';
  if (!guard.includes(`IF pg_catalog.to_regclass('${TABLE}') IS NOT NULL THEN`)) problems.push('does not refuse an existing table');
  if (!guard.includes(`IF pg_catalog.to_regprocedure('${START}') IS NOT NULL THEN`)) problems.push('does not refuse an existing function');
  let at = code.indexOf('$rollback_guard$;');
  for (const [name, statement] of de8aStatements()) {
    const found = code.indexOf(statement, Math.max(at, 0));
    if (found < 0) problems.push(`missing or reordered: ${name}`);
    else at = found + statement.length;
  }
  const table = code.includes('CREATE TABLE public.business_os_data_exports (')
    ? between(code, 'CREATE TABLE public.business_os_data_exports (', '\n);')
    : '';
  if ((table.match(/CONSTRAINT business_os_data_exports_\w+\n\s+CHECK \(/g) ?? []).length !== 11) problems.push('not eleven named CHECKs');
  if (!table.includes('user_id             uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,')) {
    problems.push('the user_id FK to auth.users ON DELETE CASCADE is missing');
  }
  if (/storage\./i.test(code)) problems.push('touches storage (the bucket is not re-created here)');
  if (/(?<![A-Za-z0-9_])CASCADE(?![A-Za-z0-9_])/.test(code.replace('ON DELETE CASCADE', ''))) problems.push('a CASCADE other than the FK rule');
  if (!code.trim().startsWith("BEGIN;\n\nSET LOCAL lock_timeout = '5s';")) problems.push('does not open with BEGIN then lock_timeout');
  if (!code.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';\n\nCOMMIT;")) problems.push('NOTIFY pgrst is not last before COMMIT');
  return problems;
}

// ── The rules over the real files ──────────────────────────────────────────

describe('20261135: the DROP (MX-7 T-7a to T-7c)', () => {
  it('T-7a one transaction: lock_timeout, guard before any DROP, post-condition after, NOTIFY last', () => {
    expect(structureProblems(raw.migration)).toEqual([]);
  });

  it('T-7b the guard: exact 8 argument signature, its body, every schema, in-flight rows, inbound FKs, exact start signature', () => {
    expect(guardProblems(raw.migration)).toEqual([]);
  });

  it('T-7c DROP FUNCTION before DROP TABLE, no CASCADE, no IF EXISTS, nothing about storage', () => {
    expect(dropProblems(raw.migration)).toEqual([]);
  });

  it('the ownership scanner can read the DROP (businessOwnedTables.test.ts direction 3)', () => {
    expect(raw.migration).toMatch(/^DROP TABLE public\.business_os_data_exports;$/m);
  });

  it('the guard is name-based, not stamp-based, so a rebase that regenerates 20261134 needs no edit here (SA-Q15)', () => {
    expect(raw.migration).not.toContain(STAMP_130);
    expect(raw.migration).not.toContain(STAMP_134);
    // and 20261134 really does pass it: its body no longer names the table
    const tag = '$operator_cleanup$';
    const start = cleanup134.indexOf(tag) + tag.length;
    expect(cleanup134.slice(start, cleanup134.indexOf(tag, start))).not.toContain('business_os_data_exports');
  });
});

describe('20261135 rollback: the 20261074 shape, statement by statement (MX-7 T-7e, SA S-2)', () => {
  it('refuses while the table or the function exists, then holds every 20261074 statement in order', () => {
    expect(rollbackProblems(raw.rollback)).toEqual([]);
  });

  it('the start function body is byte-equal to 20261074 (md5 of the $start$ body)', () => {
    const body = (sql: string) => between(sql, 'AS $start$', '$start$;');
    const md5 = (text: string) => createHash('md5').update(text).digest('hex');
    expect(md5(body(raw.rollback))).toBe(md5(body(de8a)));
  });

  it('says the rows do not come back', () => {
    expect(raw.rollback).toContain('-- Re-creates the SHAPE of 20261074 only. The table comes back EMPTY. No known undo for the rows\n');
  });
});

describe('paste safety and the read-only scripts (MX-7 T-7d, T-7f, SA S-6)', () => {
  it.each(Object.keys(FILE) as Array<keyof typeof FILE>)('%s is ASCII, LF, header-only comments, no stray "into"', (name) => {
    expect(pasteProblems(raw[name])).toEqual([]);
  });

  it('the migration has no "into" at all, the rollback exactly the two start function keywords', () => {
    expect(raw.migration.match(/into/gi)).toBeNull();
    expect(raw.rollback.match(/into/gi)).toHaveLength(2);
  });

  it.each(['precheck', 'checker134', 'checker135'] as const)('%s is one read-only SELECT with numbered rows and a stated count', (name) => {
    expect(scriptProblems(raw[name])).toEqual([]);
  });

  it('the 20261134 checker has the md5 row and the "names neither" row; rows 5 to 8 are shown to FAIL before the paste', () => {
    expect(raw.checker134).toContain("SELECT 8, 'operator gate. md5 of the body is ");
    expect(raw.checker134).toContain("SELECT 7, 'its body names neither the table business_os_data_exports nor the bucket business-data-exports',");
    expect(raw.checker134).toContain('-- Run it once BEFORE the paste too (step 6). Rows 5, 6, 7 and 8 must read FAIL then');
  });

  it('the 20261135 checker has the table-absent rows that must read FAIL before its paste, twice, row 3 only at step 6', () => {
    expect(raw.checker135).toContain(`SELECT 1 AS ord, 'the table ${TABLE} is absent' AS check_name,\n    pg_catalog.to_regclass('${TABLE}') IS NULL AS passed`);
    expect(raw.checker135).toContain(`pg_catalog.to_regprocedure('${START}') IS NULL`);
    expect(raw.checker135).toContain('-- At step 6, before 20261134 is pasted, rows 1, 2, 3 and 4 must read FAIL');
    expect(raw.checker135).toContain('-- At step 11, after 20261134 and the deploy, rows 1, 2 and 4 must read FAIL and row 3 must read ok');
    expect(raw.checker135).toContain(`position('${STAMP_134}' in p.prosrc) > 0`);
  });

  it('the pre-check requires the 20261130 stamp live and the 20261134 one absent, and the bucket empty', () => {
    expect(raw.precheck).toContain(`position('${STAMP_130}' in p.prosrc) > 0) AS passed`);
    expect(raw.precheck).toContain(`NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = (SELECT fn.oid FROM fn) AND position('${STAMP_134}' in p.prosrc) > 0)`);
    expect(raw.precheck).toContain("NOT EXISTS (SELECT 1 FROM storage.objects AS obj WHERE obj.bucket_id = 'business-data-exports')");
    expect(raw.precheck).toContain(`pg_catalog.to_regprocedure('${CLEANUP_8}')`);
  });
});

// ── Negative controls: planted, broken copies fail their detector ─────────

describe('MX-7 negative controls', () => {
  const plant = (sql: string, from: string, to: string) => {
    expect([from, sql.includes(from)]).toEqual([from, true]);
    return sql.replace(from, to);
  };

  it('a DROP moved above the guard fails T-7a', () => {
    const moved = plant(raw.migration, `DROP FUNCTION ${START};\n\n`, '');
    const planted = plant(moved, 'DO $drop_guard$', `DROP FUNCTION ${START};\n\nDO $drop_guard$`);
    expect(structureProblems(planted)).toContain('the guard does not come before every DROP');
  });

  it('a guard scoped to schema public fails T-7b (2), a lost body check fails T-7b (1)', () => {
    expect(guardProblems(plant(raw.migration, "WHERE position('business_os_data_exports' IN fn.prosrc) > 0\n", "WHERE fn.pronamespace = 'public'::regnamespace AND position('business_os_data_exports' IN fn.prosrc) > 0\n"))).toContain(
      '(2) other function bodies in every schema are not checked'
    );
    expect(guardProblems(plant(raw.migration, `fn.oid = pg_catalog.to_regprocedure('${CLEANUP_8}')\n`, `fn.oid = pg_catalog.to_regprocedure('public.operator_test_account_cleanup(text, text, text, text, uuid, text)')\n`))).toContain(
      '(1) the live 8 argument cleanup body is not checked for the table name'
    );
  });

  it('CASCADE, IF EXISTS or the wrong order fail T-7c', () => {
    expect(dropProblems(plant(raw.migration, `DROP TABLE ${TABLE};`, `DROP TABLE ${TABLE} CASCADE;`))).toContain('CASCADE');
    expect(dropProblems(plant(raw.migration, `DROP FUNCTION ${START};`, `DROP FUNCTION IF EXISTS ${START};`))).toContain('IF EXISTS');
    const swapped = plant(plant(raw.migration, `DROP FUNCTION ${START};`, '@@F'), `DROP TABLE ${TABLE};`, `DROP FUNCTION ${START};`).replace('@@F', `DROP TABLE ${TABLE};`);
    expect(dropProblems(swapped)).toContain('the table is dropped before the function');
  });

  it('"into" in a comment, a CR, a semicolon in a comment fail T-7d', () => {
    expect(pasteProblems(`-- put this into the editor\n${raw.migration}`)).toContain('"into" outside the INSERT INTO / RETURNING INTO keywords');
    expect(pasteProblems(raw.migration.replace('\n', '\r\n'))).toContain('CR found (must be LF)');
    expect(pasteProblems(`-- one; two\n${raw.migration}`)).toContain('comment at line 1 is not a clean header line');
  });

  it('an alias spelled "into", a SET, a second statement or a skipped row number fail S-6', () => {
    expect(scriptProblems(raw.checker135.replace('AS check_name', 'AS check_into'))).toContain('the word "into" (identifiers and aliases included)');
    expect(scriptProblems(`SET statement_timeout = 0\n${raw.checker135}`)).toContain('a SET');
    expect(scriptProblems(`${raw.checker135}SELECT 1;\n`)).toContain('not exactly one statement');
    expect(scriptProblems(raw.checker135.replace('  SELECT 3, ', '  SELECT 5, '))).toContain('rows not numbered 1..n: 1,2,5,4');
    expect(scriptProblems(raw.checker135.replace('It returns 4 rows.', 'It returns 5 rows.'))).toContain('states 5 rows, has 4');
    expect(scriptProblems(raw.checker135.replace('WITH\n', 'WITH\ngone AS (DELETE FROM x RETURNING 1),\n'))).toEqual(
      expect.arrayContaining(['write or control keyword DELETE'])
    );
  });

  it('a lost CHECK, a changed function body or a missing refusal fail T-7e', () => {
    expect(rollbackProblems(raw.rollback.replace(/  CONSTRAINT business_os_data_exports_download_shape\n    CHECK \(owner_downloaded_at IS NULL OR ready_at IS NOT NULL\),\n/, ''))).toEqual(
      expect.arrayContaining(['missing or reordered: the table, its defaults, the FK and the eleven CHECKs', 'not eleven named CHECKs'])
    );
    expect(rollbackProblems(plant(raw.rollback, "interval '90 seconds'", "interval '60 seconds'"))).toContain('missing or reordered: the start function, body byte-equal');
    expect(rollbackProblems(plant(raw.rollback, `IF pg_catalog.to_regclass('${TABLE}') IS NOT NULL THEN`, 'IF false THEN'))).toContain('does not refuse an existing table');
    expect(rollbackProblems(plant(raw.rollback, 'WHERE status IN (\'queued\', \'running\');', 'WHERE status = \'queued\';'))).toContain('missing or reordered: the unique partial index');
  });
});
