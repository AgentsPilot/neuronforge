/**
 * Guard over migration 20261050, SECURITY DEFINER lockdown slice 4a
 * (docs/requirements/SECURITY_DEFINER_FUNCTIONS_LOCKDOWN_REQUIREMENT.md FR-4a,
 * workplan docs/workplans/SECDEF_LOCKDOWN_SLICE4A_WORKPLAN.md).
 *
 * Closes PUBLIC and anon on the six class 2 functions and keeps authenticated
 * and service_role, because signed-in agent runs, calibrations and the V6
 * top-insights read call them on the user's cookie client. Slice 4b later moves
 * five of the call sites to the service-role client and revokes authenticated
 * (SA SQ-1); this slice removes only the signed-out path.
 *
 * WHY A TEST OVER SQL TEXT: there is no branch database. The user pastes the
 * pre-check, the migration (in a NEW tab), the checker, the acceptance blocks
 * and, if ever needed, the rollback into the Supabase SQL editor by hand
 * (FR-0.6). Same shape as the slice 3 test, with every function on the
 * kept-authenticated branch slice 3 built for is_platform_admin: one prod grant
 * shape, one rollback form (TO PUBLIC, anon), one post-condition loop that
 * requires authenticated to keep EXECUTE, the SA Q-3 "4b review" caller tag,
 * and the acceptance blocks in the workplan QA section (SA S4a-1, S4a-2).
 *
 * The slice 6 guard (supabase/__tests__/security-definer-surface.guard.test.ts)
 * scans this migration on every run. Its analyser is not imported: importing a
 * .test.ts file would register and re-run every guard suite inside this file.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const MIGRATION = join(ROOT, 'supabase', 'migrations', '20261050_secdef_lockdown_slice4a_signed_in.sql');
const ROLLBACK = join(ROOT, 'supabase', 'SQL Scripts', '20261050_secdef_lockdown_slice4a_signed_in_rollback.sql');
const CHECKER = join(ROOT, 'scripts', 'check-secdef-lockdown-slice4a-migration.sql');
const PRECHECK = join(ROOT, 'scripts', 'precheck-secdef-lockdown-slice4a.sql');
const TSV = join(ROOT, 'docs', 'investigations', 'secdef_prod_inventory_2026-10-07.tsv');
const WORKPLAN = join(ROOT, 'docs', 'workplans', 'SECDEF_LOCKDOWN_SLICE4A_WORKPLAN.md');

const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const migration = read(MIGRATION);
const rollback = read(ROLLBACK);
const checker = read(CHECKER);
const precheck = read(PRECHECK);

interface SliceFunction {
  name: string;
  signature: string;
}

/** The one prod grant shape (TSV), and what the rollback grants back. */
const TSV_GRANTEES = 'PUBLIC postgres anon authenticated service_role';
const ROLLBACK_GRANTEES = 'PUBLIC, anon';

/** FR-4a, in the order of the workplan §1.1. Every one keeps authenticated. */
const SLICE_4A: SliceFunction[] = [
  { name: 'increment_executions_used', signature: 'public.increment_executions_used(uuid)' },
  {
    name: 'update_execution_baseline',
    signature: 'public.update_execution_baseline(uuid, uuid, numeric, numeric, integer, integer, boolean)',
  },
  {
    name: 'record_execution_anomaly',
    signature:
      'public.record_execution_anomaly(uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric, text, text, integer)',
  },
  {
    name: 'upsert_error_pattern',
    signature: 'public.upsert_error_pattern(uuid, uuid, text, text, text, text, text, jsonb)',
  },
  { name: 'record_auto_fix_result', signature: 'public.record_auto_fix_result(uuid, boolean)' },
  { name: 'get_top_insights', signature: 'public.get_top_insights(integer)' },
];

/** The requirement's FR-4a list, kept separate so a reorder or rename above is caught. */
const FR_4A = [
  'increment_executions_used',
  'update_execution_baseline',
  'record_execution_anomaly',
  'upsert_error_pattern',
  'record_auto_fix_result',
  'get_top_insights',
];

const SIGNATURES = SLICE_4A.map((fn) => fn.signature);
const sorted = (values: string[]) => [...values].sort();

/** Punctuated literals each file may hold (C-7). Everything else must be plain. */
const PUNCTUATED_ALLOWED: Record<string, string[]> = {
  migration: SIGNATURES,
  rollback: SIGNATURES,
  checker: SIGNATURES,
  precheck: [...SIGNATURES, 'cron.job', 'TABLE cron.job'],
};

/** Single-quoted string literals. */
function literalsOf(sql: string): string[] {
  return [...sql.matchAll(/'([^']*)'/g)].map((match) => match[1]);
}

/** The one DO $$ ... $$ block, and the SQL with it cut out. */
function splitDoBlock(sql: string): { block: string; rest: string } {
  const blocks = [...sql.matchAll(/DO \$\$[\s\S]*?\n\$\$;/g)];
  expect(blocks).toHaveLength(1);
  return { block: blocks[0][0], rest: sql.replace(blocks[0][0], '') };
}

/** Non-empty statements, whitespace collapsed, without the trailing semicolon. */
function statementsOf(sql: string): string[] {
  return sql
    .split(';')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function arrayLiteralsOf(block: string): string[] {
  const array = block.match(/ARRAY\[([\s\S]*?)\]\s+LOOP/);
  expect(array).not.toBeNull();
  return literalsOf(array![1]);
}

function tsvFunctionRows(): string[][] {
  return read(TSV)
    .split('\n')
    .slice(1)
    .filter(Boolean)
    .map((line) => line.split('\t'))
    .filter((cols) => cols[0] === 'fn');
}

const roleCheck = (role: string, negate: boolean) =>
  new RegExp(
    `IF ${negate ? 'NOT ' : ''}pg_catalog\\.has_function_privilege\\('${role}', slice_function, 'EXECUTE'\\) THEN\\s+RAISE EXCEPTION`
  );

describe('the slice list agrees with the prod TSV (kind = fn rows only)', () => {
  const rows = tsvFunctionRows();

  it.each(SLICE_4A)('$name: exactly one TSV row, same identity types, the one grant shape', (fn) => {
    const matches = rows.filter((cols) => cols[1] === fn.name);
    expect(matches).toHaveLength(1);
    const [, , identityArgs, , , , , , , , , executeGrantees, triggers] = matches[0];

    const types = identityArgs
      .split(',')
      .map((arg) => arg.trim().split(' ').slice(1).join(' '))
      .join(', ');
    expect(fn.signature).toBe(`public.${fn.name}(${types})`);

    expect(executeGrantees).toBe(TSV_GRANTEES);
    // authenticated is kept (the migration grants it back), so the rollback restores only the rest.
    const restored = executeGrantees
      .split(' ')
      .filter((grantee) => !['postgres', 'service_role', 'authenticated'].includes(grantee));
    expect(restored.join(', ')).toBe(ROLLBACK_GRANTEES);
    expect(triggers.trim()).toBe('0');
  });

  it('holds the 6 distinct FR-4a functions, in the workplan order', () => {
    expect(SLICE_4A.map((fn) => fn.name)).toEqual(FR_4A);
    expect(new Set(SIGNATURES).size).toBe(6);
  });
});

describe('SQL-editor safety (the user pastes all four files by hand)', () => {
  const files: Array<[string, string]> = [
    ['migration', MIGRATION],
    ['rollback', ROLLBACK],
    ['checker', CHECKER],
    ['precheck', PRECHECK],
  ];

  it.each(files)('%s exists', (_name, file) => {
    expect(existsSync(file)).toBe(true);
  });

  it.each(files)('%s has no line comment and no block comment', (_name, file) => {
    const text = read(file);
    expect(text).not.toContain('--');
    expect(text).not.toContain('/*');
  });

  // The Supabase SQL editor misreads the word "into" even inside a literal or
  // an identifier (2026-10-04). Banned as a substring, in any case.
  it.each(files)('%s never contains "into" anywhere', (_name, file) => {
    expect(read(file)).not.toMatch(/into/i);
  });

  it.each(files)('%s holds only plain literals, apart from its pinned punctuated allow-list', (name, file) => {
    const allowed = PUNCTUATED_ALLOWED[name];
    for (const literal of literalsOf(read(file))) {
      if (/^[A-Za-z0-9_ ]*$/.test(literal)) continue;
      expect(allowed).toContain(literal);
    }
  });

  it.each(files)('%s has an even number of single quotes', (_name, file) => {
    expect((read(file).match(/'/g) ?? []).length % 2).toBe(0);
  });

  it.each(files)('%s uses no single-letter alias', (_name, file) => {
    expect(read(file)).not.toMatch(/\bAS [a-z]\b/i);
  });

  it.each(files)('%s names every function schema-qualified with public (R-7)', (_name, file) => {
    const text = read(file);
    for (const match of text.matchAll(/ON FUNCTION (\S+)/g)) expect(match[1].startsWith('public.')).toBe(true);
  });

  it.each(files)('%s uses no LIKE pattern', (_name, file) => {
    expect(read(file)).not.toMatch(/\bI?LIKE\b/i);
  });

  // The slice 6 guard scans scripts/*.sql too (its O-1 tripwire) and flags the
  // phrase even inside a string. None of these files has a reason to say it.
  it.each(files)('%s never says SECURITY DEFINER, not even in a string', (_name, file) => {
    expect(read(file)).not.toMatch(/SECURITY\s+DEFINER/i);
  });
});

describe('the migration: 6 revoke and re-grant pairs plus in-transaction post-conditions', () => {
  const { block, rest } = splitDoBlock(migration);
  const statements = statementsOf(rest);

  it('is one BEGIN ... COMMIT', () => {
    expect(statements[0]).toBe('BEGIN');
    expect(statements[statements.length - 1]).toBe('COMMIT');
    expect(statements.filter((s) => s === 'BEGIN' || s === 'COMMIT')).toHaveLength(2);
  });

  // SA Q-1: the FR-0.1 form, revoke all three client grantees, then re-grant
  // authenticated and service_role in the same transaction (slice 3 Q-4).
  it('holds one REVOKE from all three client grantees and one GRANT to authenticated and service_role per function, in order (Q-1)', () => {
    const expected = SLICE_4A.flatMap((fn) => [
      `REVOKE EXECUTE ON FUNCTION ${fn.signature} FROM PUBLIC, anon, authenticated`,
      `GRANT EXECUTE ON FUNCTION ${fn.signature} TO authenticated, service_role`,
    ]);
    expect(statements.slice(1, -1)).toEqual(expected);
  });

  it('every REVOKE lists PUBLIC, anon and authenticated (C-8)', () => {
    const revokes = statements.filter((s) => s.startsWith('REVOKE'));
    expect(revokes).toHaveLength(6);
    for (const revoke of revokes) expect(revoke).toMatch(/ FROM PUBLIC, anon, authenticated$/);
  });

  it('every GRANT is to exactly authenticated and service_role, never to PUBLIC or anon', () => {
    const grants = statements.filter((s) => s.startsWith('GRANT'));
    expect(grants).toHaveLength(6);
    for (const grant of grants) expect(grant).toMatch(/ TO authenticated, service_role$/);
  });

  it('the ON FUNCTION signature set equals the slice list', () => {
    const named = [...rest.matchAll(/ON FUNCTION (public\.\w+\([^)]*\))/g)].map((match) => match[1]);
    expect(sorted([...new Set(named)])).toEqual(sorted(SIGNATURES));
  });

  it('the post-condition loop holds exactly the 6 signatures', () => {
    expect(sorted(arrayLiteralsOf(block))).toEqual(sorted(SIGNATURES));
  });

  it('the loop fails, never skips, on a missing function (C-2); public and anon must be closed, authenticated and service_role kept', () => {
    expect(block).toContain('slice_function := pg_catalog.to_regprocedure(slice_signature);');
    expect(block).toMatch(/IF slice_function IS NULL THEN\s+RAISE EXCEPTION/);
    expect(block).toMatch(roleCheck('public', false));
    expect(block).toMatch(roleCheck('anon', false));
    expect(block).toMatch(roleCheck('authenticated', true));
    expect(block).toMatch(roleCheck('service_role', true));
    // A held-raise on authenticated would make the kept grant fail the apply.
    expect(block).not.toMatch(roleCheck('authenticated', false));
  });

  it('the DO block uses direct booleans only (C-7)', () => {
    expect(block).not.toMatch(/\bSELECT\b/i);
  });

  it('changes no body, search_path, owner or other object', () => {
    expect(migration).not.toMatch(/\b(ALTER|CREATE|DROP|CASCADE|TABLE|OWNER)\b/);
    expect(migration).not.toMatch(/SECURITY|search_path|REVOKE ALL/i);
  });
});

describe('the rollback restores the measured prod pre-state', () => {
  const { block, rest } = splitDoBlock(rollback);
  const statements = statementsOf(rest);

  it('is one BEGIN ... COMMIT of one GRANT per function to PUBLIC and anon, in order', () => {
    expect(statements[0]).toBe('BEGIN');
    expect(statements[statements.length - 1]).toBe('COMMIT');
    expect(statements.slice(1, -1)).toEqual(
      SLICE_4A.map((fn) => `GRANT EXECUTE ON FUNCTION ${fn.signature} TO ${ROLLBACK_GRANTEES}`)
    );
  });

  it('revokes nothing and touches no other object', () => {
    expect(rollback).not.toMatch(/\b(REVOKE|ALTER|CREATE|DROP|CASCADE|TABLE)\b/);
  });

  it('checks in the same transaction that all four roles execute the 6 again', () => {
    expect(sorted(arrayLiteralsOf(block))).toEqual(sorted(SIGNATURES));
    expect(block).toMatch(/IF slice_function IS NULL THEN\s+RAISE EXCEPTION/);
    for (const role of ['public', 'anon', 'authenticated', 'service_role']) expect(block).toMatch(roleCheck(role, true));
    expect(block).not.toMatch(/\bSELECT\b/i);
  });
});

describe('the checker and the pre-check', () => {
  const writeKeywords = /\b(INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|ALTER|DROP|CREATE)\b/;

  it('both are read-only from their first statement and write nothing (word-boundary match)', () => {
    for (const text of [checker, precheck]) {
      expect(statementsOf(text)[0]).toBe('SET default_transaction_read_only = on');
      expect(text).not.toMatch(writeKeywords);
    }
  });

  it('both list exactly the slice signatures', () => {
    for (const text of [checker, precheck]) {
      const listed = literalsOf(text).filter((literal) => literal.startsWith('public.'));
      expect(sorted(listed)).toEqual(sorted(SIGNATURES));
    }
  });

  // SA Q-2: the column stays, all true; slice 4b flips five rows to false.
  it('the checker lists every function with keeps_authenticated true', () => {
    SLICE_4A.forEach((fn, index) => {
      expect(checker).toContain(`('${fn.name}', '${fn.signature}', ${index + 1}, true)`);
    });
    expect(checker).not.toMatch(/'public\.[^']*', \d+, false\)/);
  });

  it('the checker reports a VERDICT row first, PASS only when every check passes', () => {
    expect(checker).toContain("'VERDICT' AS check_name");
    expect(checker).toMatch(/CASE WHEN EXISTS \(SELECT 1 FROM checks WHERE checks\.result <> 'PASS'\) THEN 'FAIL' ELSE 'PASS' END/);
    expect(checker).toContain('ORDER BY report.sort_order');
  });

  it('the checker expects public and anon false, authenticated true (kept), service_role true, and a NULL fails (C-2)', () => {
    for (const expectation of ["('public', false, 3)", "('anon', false, 4)", "('authenticated', false, 5)", "('service_role', true, 6)"]) {
      expect(checker).toContain(expectation);
    }
    expect(checker).toMatch(
      /role_expectation\.expected_held\s+OR \(role_expectation\.role_name = 'authenticated' AND slice_owner\.keeps_authenticated\) AS expected_held/
    );
    expect(checker).toContain("WHEN role_privilege.expected_held AND role_privilege.is_held IS TRUE THEN 'PASS'");
    expect(checker).toContain("WHEN NOT role_privilege.expected_held AND role_privilege.is_held IS FALSE THEN 'PASS'");
  });

  it('the checker checks existence and owner postgres (C-3), 6 checks per function', () => {
    expect(checker).toContain("'C1 exists '");
    expect(checker).toContain("'C2 owner postgres '");
    expect(checker).toContain("CASE WHEN slice_owner.owner_name = 'postgres' THEN 'PASS' ELSE 'FAIL' END");
  });

  it('the pre-check tells the user to run the migration in a NEW tab', () => {
    expect(precheck).toContain('run the migration in a NEW tab');
  });

  it('the pre-check carries every marker, the grantor row, Q11 and the status row, and no Q0 or Q10', () => {
    for (const marker of [
      "'PRECHECK STATUS'",
      "'Q1 exists '",
      "'Q2 owner '",
      "'Q3 secdef '",
      "'Q4 privileges '",
      "'Q5 grantees '",
      "'Q5 grantors '",
      "'Q6 callers count '",
      "'Q6 caller '",
      "'Q7 policies count '",
      "'Q7 policy '",
      "'Q8 views count '",
      "'Q8 view '",
      "'Q9 cron '",
      "'Q11 dependents count '",
      "'Q11 dependent '",
    ]) {
      expect(precheck).toContain(marker);
    }
    expect(precheck).toContain("' OTHER GRANTOR stop here'");
    expect(precheck).toContain('ORDER BY final_report.sort_order, final_report.item');
    expect(precheck).not.toMatch(/Q0|vector|Q10|is_lock_wrapper|bare_signature/);
  });

  it('the pre-check expected grantees equal the TSV execute_grantees, read directly from the TSV', () => {
    const rows = tsvFunctionRows();
    SLICE_4A.forEach((fn, index) => {
      const matches = rows.filter((cols) => cols[1] === fn.name);
      expect(matches).toHaveLength(1);
      expect(precheck).toContain(`('${fn.name}', '${fn.signature}', ${index + 1}, '${matches[0][11]}', true)`);
    });
  });

  it('the pre-check Q4 compares public against the shape (PUBLIC in the expected grantees), the other three must be true', () => {
    expect(precheck).toContain("strpos(watched.expected_grantees, 'PUBLIC') > 0 AS expects_public");
    expect(precheck).toContain(
      "WHEN pg_catalog.has_function_privilege('public', fn_state.fn_oid, 'EXECUTE') = fn_state.expects_public"
    );
  });

  // SA S3-2, applied to all six (they all keep authenticated): a SECDEF caller
  // stops unless owned by postgres; an INVOKER trigger always stops; another
  // INVOKER caller stops only if anon can run it.
  it('the pre-check Q6 applies the S3-2 caller rule', () => {
    expect(precheck).toContain("pg_proc.prorettype = 'trigger'::regtype AS caller_is_trigger");
    expect(precheck).toContain("pg_catalog.has_function_privilege('anon', pg_proc.oid, 'EXECUTE') AS caller_anon_executes");
    expect(precheck).toMatch(
      /CASE\s+WHEN caller_proc\.caller_secdef THEN caller_proc\.caller_owner <> 'postgres'\s+WHEN NOT caller_proc\.keeps_authenticated THEN true\s+WHEN caller_proc\.caller_is_trigger THEN true\s+ELSE caller_proc\.caller_anon_executes\s+END AS needs_stop/
    );
  });

  // SA Q-3: an INVOKER caller that passes in 4a is tagged for slice 4b. The tag
  // is informational: it never says stop here, so PRECHECK STATUS never counts it.
  it('the pre-check Q6 tags an ok INVOKER caller "4b review", and the tag never reaches PRECHECK STATUS', () => {
    expect(precheck).toMatch(
      /CASE\s+WHEN caller_verdict\.needs_stop THEN ' stop here'\s+WHEN NOT caller_verdict\.caller_secdef THEN ' ok 4b review'\s+ELSE ' ok'\s+END\s+FROM caller_verdict/
    );
    expect(' ok 4b review').not.toContain('stop here');
    expect(precheck).toMatch(/WHEN \(SELECT count\(\*\) FROM report WHERE strpos\(report\.detail, 'stop here'\) > 0\) = 0 THEN 'CLEAN'/);
    expect(precheck).not.toMatch(/strpos\(report\.detail, '[^']*4b/);
  });

  // SA S3-1, applied to all six: a policy is ok only when every role is
  // authenticated or service_role.
  it('the pre-check Q7 applies the S3-1 role rule for kept-authenticated functions', () => {
    expect(precheck).toMatch(
      /WHEN fn_state\.keeps_authenticated\s+THEN NOT \(pg_policies\.roles <@ ARRAY\['authenticated', 'service_role'\]::name\[\]\)\s+ELSE pg_policies\.roles && ARRAY\['public', 'anon', 'authenticated'\]::name\[\]/
    );
  });

  it('the pre-check Q11 reads pg_depend, and only a pg_policy dependent with authenticated or service_role roles is ok', () => {
    expect(precheck).toContain('JOIN pg_catalog.pg_depend');
    expect(precheck).toContain("ON pg_depend.refclassid = 'pg_proc'::regclass");
    expect(precheck).toContain('AND pg_depend.refobjid = fn_state.fn_oid');
    expect(precheck).toContain('pg_catalog.pg_describe_object(pg_depend.classid, pg_depend.objid, pg_depend.objsubid)');
    expect(precheck).toContain('pg_depend.classid::regclass::text AS dependent_catalog');
    expect(precheck).toContain('pg_depend.deptype::text AS dependent_type');
    expect(precheck).toContain('LEFT JOIN pg_catalog.pg_policy AS dependent_policy');
    expect(precheck).toMatch(
      /WHEN fn_state\.keeps_authenticated\s+AND pg_depend\.classid = 'pg_policy'::regclass\s+AND dependent_policy\.polroles <@ ARRAY\[\s+pg_catalog\.to_regrole\('authenticated'\)::oid,\s+pg_catalog\.to_regrole\('service_role'\)::oid\s+\]\s+THEN false\s+ELSE true/
    );
    expect(precheck).toMatch(/'Q11 dependent '[\s\S]*?CASE WHEN dependent_hit\.needs_stop THEN ' stop here' ELSE ' ok' END\s+FROM dependent_hit/);
  });

  it('the pre-check reads cron.job only behind to_regclass', () => {
    expect(precheck).toMatch(/WHEN pg_catalog\.to_regclass\('cron\.job'\) IS NULL THEN 'cron not installed'\s+WHEN strpos\(lower\(query_to_xml\('TABLE cron\.job'/);
  });

  // Slice 1 prod pre-check 2026-10-08: equal sets read DIFFERS under mixed
  // collations. Every string_agg ordering is pinned to COLLATE "C".
  it('the pre-check orders every string_agg with COLLATE "C"', () => {
    const total = (precheck.match(/string_agg\(/g) ?? []).length;
    const aggregates = [...precheck.matchAll(/string_agg\(([\s\S]*?)\)\s+FROM /g)].map((match) => match[1]);
    expect(total).toBeGreaterThanOrEqual(4);
    expect(aggregates).toHaveLength(total);
    for (const aggregate of aggregates) {
      const orderBy = aggregate.match(/ORDER BY ([\s\S]*)$/);
      expect(orderBy).not.toBeNull();
      expect(orderBy![1].trim()).toMatch(/ COLLATE "C"$/);
    }
  });
});

// SA S3-4, S4a-1 and S4a-2: the acceptance blocks the user pastes after apply
// live in the workplan QA section (not extra files), so the paste rules are checked there.
describe('the acceptance blocks in the workplan QA section', () => {
  const workplan = read(WORKPLAN);
  const start = workplan.indexOf('### Acceptance blocks');
  const section = workplan.slice(start);
  const body = section.slice(0, section.indexOf('\n---'));
  const blocks = [...body.matchAll(/```sql\n([\s\S]*?)```/g)].map((match) => match[1]);
  const window = (minutes: number) => `pg_catalog.now() - pg_catalog.make_interval(mins => ${minutes})`;
  const roleBlock = (role: string, statement: string) => ['BEGIN', `SET LOCAL ROLE ${role}`, statement, 'ROLLBACK'];

  const EXPECTED: Array<[string, string[]]> = [
    ['N1', roleBlock('anon', 'SELECT public.increment_executions_used(NULL::uuid)')],
    ['N2', roleBlock('anon', 'SELECT count(*) AS insight_rows FROM public.get_top_insights()')],
    ['P1', roleBlock('authenticated', 'SELECT public.increment_executions_used(NULL::uuid)')],
    ['P2', roleBlock('authenticated', 'SELECT public.record_auto_fix_result(NULL::uuid, NULL::boolean)')],
    ['P3', roleBlock('authenticated', 'SELECT count(*) AS insight_rows FROM public.get_top_insights()')],
    [
      'P4',
      roleBlock(
        'authenticated',
        'SELECT public.update_execution_baseline(NULL::uuid, NULL::uuid, NULL::numeric, NULL::numeric, NULL::integer, NULL::integer, NULL::boolean)'
      ),
    ],
    [
      'P5',
      roleBlock(
        'authenticated',
        'SELECT public.record_execution_anomaly(NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric, NULL::text, NULL::text, NULL::integer)'
      ),
    ],
    [
      'P6',
      roleBlock(
        'authenticated',
        'SELECT public.upsert_error_pattern(NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::jsonb)'
      ),
    ],
    [
      'F1',
      [
        `SELECT (SELECT sum(user_subscriptions.executions_used) FROM public.user_subscriptions) AS executions_used_total, (SELECT count(*) FROM public.workflow_executions WHERE workflow_executions.started_at >= ${window(30)}) AS runs_recent, (SELECT count(*) FROM public.execution_baselines WHERE execution_baselines.updated_at >= ${window(30)}) AS baselines_recent`,
      ],
    ],
    [
      'F5',
      [`SELECT count(*) AS patterns_recent FROM public.error_patterns WHERE error_patterns.last_seen >= ${window(30)}`],
    ],
  ];

  it('the section exists and holds exactly the blocks, in order', () => {
    expect(start).toBeGreaterThan(0);
    expect(blocks).toHaveLength(EXPECTED.length);
  });

  it.each(EXPECTED.map(([name], index) => [name, index] as [string, number]))('block %s is pinned statement for statement', (_name, index) => {
    expect(statementsOf(blocks[index])).toEqual(EXPECTED[index][1]);
  });

  it('every block is paste-safe: no comment, no "into", no single-letter alias, no literal, no timestamp literal', () => {
    for (const block of blocks) {
      expect(block).not.toContain('--');
      expect(block).not.toContain('/*');
      expect(block).not.toMatch(/into/i);
      expect(block).not.toMatch(/\bAS [a-z]\b/i);
      expect(block).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(block).not.toMatch(/\b(timestamp|interval)\s+'/i);
      expect(literalsOf(block)).toEqual([]);
    }
  });

  it('every role block ends in ROLLBACK, so nothing persists and the role reverts', () => {
    blocks.forEach((block) => {
      const statements = statementsOf(block);
      if (statements[0] === 'BEGIN') expect(statements[statements.length - 1]).toBe('ROLLBACK');
    });
  });

  // SA S4a-1: a P block fails only on permission denied for its own function;
  // P4 to P6 expect 23502 without pinning the column. SA S4a-2: F1 is corroboration.
  it('the lead-ins carry the S4a-1 pass rule and the S4a-2 corroboration rule', () => {
    for (const [name, fn] of [
      ['P1', 'increment_executions_used'],
      ['P2', 'record_auto_fix_result'],
      ['P3', 'get_top_insights'],
      ['P4', 'update_execution_baseline'],
      ['P5', 'record_execution_anomaly'],
      ['P6', 'upsert_error_pattern'],
    ]) {
      expect(body).toContain(`Block ${name}, as \`authenticated\`.`);
      expect(body).toContain(`Pass unless \`ERROR 42501 permission denied for function ${fn}\` (S4a-1)`);
    }
    expect((body.match(/Expected: `ERROR 23502 null value in column \.\.\.` \(column not pinned\)/g) ?? []).length).toBe(3);
    expect(body).toContain('Corroboration only (S4a-2): F1 alone never triggers or clears a rollback.');
  });
});
