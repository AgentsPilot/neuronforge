/**
 * Guard over migration 20261049, SECURITY DEFINER lockdown slice 3
 * (docs/requirements/SECURITY_DEFINER_FUNCTIONS_LOCKDOWN_REQUIREMENT.md FR-3,
 * workplan docs/workplans/SECDEF_LOCKDOWN_SLICE3_WORKPLAN.md).
 *
 * Revokes EXECUTE from PUBLIC, anon and authenticated on 17 functions whose
 * every caller is the server (service_role) or the owner (a trigger or another
 * owner-run function), and keeps service_role. is_platform_admin() also loses
 * PUBLIC and anon but keeps authenticated, because its RLS policies run as the
 * signed-in user.
 *
 * WHY A TEST OVER SQL TEXT: there is no branch database. The user pastes the
 * pre-check, the migration (in a NEW tab), the checker, the acceptance blocks
 * and, if ever needed, the rollback into the Supabase SQL editor by hand
 * (FR-0.6). Same shape as the slice 2 test, plus the slice 3 differences:
 * three prod grant shapes, so three rollback forms (B, C, D); the kept
 * authenticated grant on is_platform_admin; the SA S3-1 and S3-2 pre-check
 * rules; and the acceptance blocks in the workplan QA section (SA S3-3, S3-4).
 *
 * The slice 6 guard (supabase/__tests__/security-definer-surface.guard.test.ts)
 * scans this migration on every run. Its analyser is not imported: importing a
 * .test.ts file would register and re-run every guard suite inside this file.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const MIGRATION = join(ROOT, 'supabase', 'migrations', '20261049_secdef_lockdown_slice3_server_internal.sql');
const ROLLBACK = join(ROOT, 'supabase', 'SQL Scripts', '20261049_secdef_lockdown_slice3_server_internal_rollback.sql');
const CHECKER = join(ROOT, 'scripts', 'check-secdef-lockdown-slice3-migration.sql');
const PRECHECK = join(ROOT, 'scripts', 'precheck-secdef-lockdown-slice3.sql');
const TSV = join(ROOT, 'docs', 'investigations', 'secdef_prod_inventory_2026-10-07.tsv');
const WORKPLAN = join(ROOT, 'docs', 'workplans', 'SECDEF_LOCKDOWN_SLICE3_WORKPLAN.md');

const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const migration = read(MIGRATION);
const rollback = read(ROLLBACK);
const checker = read(CHECKER);
const precheck = read(PRECHECK);

type Shape = 'B' | 'C' | 'D';

interface SliceFunction {
  name: string;
  signature: string;
  shape: Shape;
}

/** Prod execute_grantees per shape (TSV) and what the rollback grants back. */
const SHAPES: Record<Shape, { tsvGrantees: string; rollbackGrantees: string }> = {
  B: { tsvGrantees: 'PUBLIC postgres anon authenticated service_role', rollbackGrantees: 'PUBLIC, anon, authenticated' },
  C: { tsvGrantees: 'PUBLIC postgres service_role', rollbackGrantees: 'PUBLIC' },
  // authenticated is never lost (the migration grants it back), PUBLIC never held.
  D: { tsvGrantees: 'postgres anon authenticated service_role', rollbackGrantees: 'anon' },
};

const ADMIN = 'is_platform_admin';
const ADMIN_SIGNATURE = 'public.is_platform_admin()';

/** FR-3, in the order of the workplan §1.1. */
const SLICE_3: SliceFunction[] = [
  {
    name: 'search_business_chat_plans_semantic',
    signature: 'public.search_business_chat_plans_semantic(vector, text, text, uuid, double precision, integer)',
    shape: 'B',
  },
  { name: 'record_business_chat_plan_outcome', signature: 'public.record_business_chat_plan_outcome(uuid, boolean)', shape: 'B' },
  {
    name: 'match_verified_questions',
    signature: 'public.match_verified_questions(vector, uuid, text, double precision, integer)',
    shape: 'C',
  },
  { name: 'increment_verified_question_uses', signature: 'public.increment_verified_question_uses(uuid[])', shape: 'C' },
  { name: 'get_or_create_user_organization', signature: 'public.get_or_create_user_organization(uuid)', shape: 'B' },
  { name: 'check_subdomain_available', signature: 'public.check_subdomain_available(text)', shape: 'B' },
  { name: 'generate_subdomain', signature: 'public.generate_subdomain(text)', shape: 'B' },
  {
    name: 'upsert_intent_example',
    signature: 'public.upsert_intent_example(text, jsonb, text[], integer, integer, text)',
    shape: 'B',
  },
  {
    name: 'find_similar_intent_examples',
    signature: 'public.find_similar_intent_examples(text[], text, text, integer)',
    shape: 'B',
  },
  { name: 'record_intent_example_usage', signature: 'public.record_intent_example_usage(uuid, boolean)', shape: 'B' },
  {
    name: 'upsert_workflow_pattern',
    signature: 'public.upsert_workflow_pattern(text[], text, integer, text, boolean, numeric, numeric)',
    shape: 'B',
  },
  { name: 'get_similar_patterns', signature: 'public.get_similar_patterns(text[], integer)', shape: 'B' },
  {
    name: 'record_global_failure',
    signature: 'public.record_global_failure(text, text, text, text, boolean)',
    shape: 'B',
  },
  { name: 'get_active_failures', signature: 'public.get_active_failures(text, text)', shape: 'B' },
  { name: 'advance_contact_stage', signature: 'public.advance_contact_stage(uuid, uuid, text, text[])', shape: 'B' },
  { name: 'increment_calibration_count', signature: 'public.increment_calibration_count(uuid)', shape: 'B' },
  {
    name: 'record_business_event',
    signature:
      'public.record_business_event(uuid, text, text, text, uuid, uuid, numeric, jsonb, text, timestamp with time zone)',
    shape: 'C',
  },
  { name: ADMIN, signature: ADMIN_SIGNATURE, shape: 'D' },
];

const keepsAuthenticated = (fn: SliceFunction) => fn.name === ADMIN;
const SIGNATURES = SLICE_3.map((fn) => fn.signature);
const SERVICE_ONLY = SLICE_3.filter((fn) => !keepsAuthenticated(fn));
const SERVICE_ONLY_SIGNATURES = SERVICE_ONLY.map((fn) => fn.signature);
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

/** The DO block split at END LOOP: the 17-function loop, then the is_platform_admin part. */
function splitAdminPart(block: string): { loop: string; admin: string } {
  const at = block.indexOf('END LOOP;');
  expect(at).toBeGreaterThan(0);
  return { loop: block.slice(0, at), admin: block.slice(at) };
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

  it.each(SLICE_3)('$name: exactly one TSV row, same identity types, the stated grant shape', (fn) => {
    const matches = rows.filter((cols) => cols[1] === fn.name);
    expect(matches).toHaveLength(1);
    const [, , identityArgs, , , , , , , , , executeGrantees, triggers] = matches[0];

    const types = identityArgs
      .split(',')
      .map((arg) => arg.trim().split(' ').slice(1).join(' '))
      .join(', ');
    expect(fn.signature).toBe(`public.${fn.name}(${types})`);

    expect(executeGrantees).toBe(SHAPES[fn.shape].tsvGrantees);
    const restored = executeGrantees
      .split(' ')
      .filter((grantee) => grantee !== 'postgres' && grantee !== 'service_role')
      .filter((grantee) => !(keepsAuthenticated(fn) && grantee === 'authenticated'));
    expect(restored.join(', ')).toBe(SHAPES[fn.shape].rollbackGrantees);
    expect(triggers.trim()).toBe('0');
  });

  it('holds 18 distinct functions: 14 shape B, 3 shape C, and is_platform_admin alone in shape D', () => {
    expect(new Set(SLICE_3.map((fn) => fn.name)).size).toBe(18);
    expect(SLICE_3.filter((fn) => fn.shape === 'B')).toHaveLength(14);
    expect(SLICE_3.filter((fn) => fn.shape === 'C').map((fn) => fn.name)).toEqual([
      'match_verified_questions',
      'increment_verified_question_uses',
      'record_business_event',
    ]);
    expect(SLICE_3.filter((fn) => fn.shape === 'D').map((fn) => fn.name)).toEqual([ADMIN]);
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

describe('the migration: 18 revoke and grant pairs plus in-transaction post-conditions', () => {
  const { block, rest } = splitDoBlock(migration);
  const statements = statementsOf(rest);
  const { loop, admin } = splitAdminPart(block);

  it('is one BEGIN ... COMMIT', () => {
    expect(statements[0]).toBe('BEGIN');
    expect(statements[statements.length - 1]).toBe('COMMIT');
    expect(statements.filter((s) => s === 'BEGIN' || s === 'COMMIT')).toHaveLength(2);
  });

  it('holds one REVOKE from all three client grantees and one GRANT per function, in order; only is_platform_admin keeps authenticated (Q-4)', () => {
    const expected = SLICE_3.flatMap((fn) => [
      `REVOKE EXECUTE ON FUNCTION ${fn.signature} FROM PUBLIC, anon, authenticated`,
      `GRANT EXECUTE ON FUNCTION ${fn.signature} TO ${keepsAuthenticated(fn) ? 'authenticated, service_role' : 'service_role'}`,
    ]);
    expect(statements.slice(1, -1)).toEqual(expected);
    expect(statements.filter((s) => s.startsWith('GRANT') && s.includes('authenticated'))).toEqual([
      `GRANT EXECUTE ON FUNCTION ${ADMIN_SIGNATURE} TO authenticated, service_role`,
    ]);
  });

  it('every REVOKE lists PUBLIC, anon and authenticated (C-8)', () => {
    const revokes = statements.filter((s) => s.startsWith('REVOKE'));
    expect(revokes).toHaveLength(18);
    for (const revoke of revokes) expect(revoke).toMatch(/ FROM PUBLIC, anon, authenticated$/);
  });

  it('the ON FUNCTION signature set equals the slice list', () => {
    const named = [...rest.matchAll(/ON FUNCTION (public\.\w+\([^)]*\))/g)].map((match) => match[1]);
    expect(sorted([...new Set(named)])).toEqual(sorted(SIGNATURES));
  });

  it('the post-condition loop holds exactly the 17 service_role-only signatures', () => {
    expect(sorted(arrayLiteralsOf(block))).toEqual(sorted(SERVICE_ONLY_SIGNATURES));
  });

  it('the loop fails, never skips, on a missing function (C-2), and raises when a client role still executes or service_role lost it', () => {
    expect(loop).toContain('slice_function := pg_catalog.to_regprocedure(slice_signature);');
    expect(loop).toMatch(/IF slice_function IS NULL THEN\s+RAISE EXCEPTION/);
    for (const role of ['public', 'anon', 'authenticated']) expect(loop).toMatch(roleCheck(role, false));
    expect(loop).toMatch(roleCheck('service_role', true));
  });

  it('the is_platform_admin part: NULL raises, public and anon must be closed, authenticated and service_role must be kept', () => {
    expect(admin).toContain(`slice_function := pg_catalog.to_regprocedure('${ADMIN_SIGNATURE}');`);
    expect(admin).toMatch(/IF slice_function IS NULL THEN\s+RAISE EXCEPTION/);
    expect(admin).toMatch(roleCheck('public', false));
    expect(admin).toMatch(roleCheck('anon', false));
    expect(admin).toMatch(roleCheck('authenticated', true));
    expect(admin).toMatch(roleCheck('service_role', true));
    expect(admin).not.toMatch(roleCheck('authenticated', false));
  });

  it('the DO block uses direct booleans only (C-7)', () => {
    expect(block).not.toMatch(/\bSELECT\b/i);
  });

  it('changes no body, search_path, owner or other object', () => {
    expect(migration).not.toMatch(/\b(ALTER|CREATE|DROP|CASCADE|TABLE|OWNER)\b/);
    expect(migration).not.toMatch(/SECURITY|search_path|REVOKE ALL/i);
  });
});

describe('the rollback restores the measured prod pre-state, per shape', () => {
  const { block, rest } = splitDoBlock(rollback);
  const statements = statementsOf(rest);
  const { loop, admin } = splitAdminPart(block);

  it('is one BEGIN ... COMMIT of one GRANT per function to its shape grantees, in order', () => {
    expect(statements[0]).toBe('BEGIN');
    expect(statements[statements.length - 1]).toBe('COMMIT');
    expect(statements.slice(1, -1)).toEqual(
      SLICE_3.map((fn) => `GRANT EXECUTE ON FUNCTION ${fn.signature} TO ${SHAPES[fn.shape].rollbackGrantees}`)
    );
  });

  it('revokes nothing and touches no other object', () => {
    expect(rollback).not.toMatch(/\b(REVOKE|ALTER|CREATE|DROP|CASCADE|TABLE)\b/);
  });

  it('checks in the same transaction that all four roles execute the 17 again', () => {
    expect(sorted(arrayLiteralsOf(block))).toEqual(sorted(SERVICE_ONLY_SIGNATURES));
    expect(loop).toMatch(/IF slice_function IS NULL THEN\s+RAISE EXCEPTION/);
    for (const role of ['public', 'anon', 'authenticated', 'service_role']) expect(loop).toMatch(roleCheck(role, true));
  });

  it('checks is_platform_admin back at its own pre-state: public false, the other three true', () => {
    expect(admin).toContain(`slice_function := pg_catalog.to_regprocedure('${ADMIN_SIGNATURE}');`);
    expect(admin).toMatch(/IF slice_function IS NULL THEN\s+RAISE EXCEPTION/);
    expect(admin).toMatch(roleCheck('public', false));
    for (const role of ['anon', 'authenticated', 'service_role']) expect(admin).toMatch(roleCheck(role, true));
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

  it('the checker lists every function with keeps_authenticated true only for is_platform_admin', () => {
    SLICE_3.forEach((fn, index) => {
      expect(checker).toContain(`('${fn.name}', '${fn.signature}', ${index + 1}, ${keepsAuthenticated(fn)})`);
    });
  });

  it('the checker reports a VERDICT row first, PASS only when every check passes', () => {
    expect(checker).toContain("'VERDICT' AS check_name");
    expect(checker).toMatch(/CASE WHEN EXISTS \(SELECT 1 FROM checks WHERE checks\.result <> 'PASS'\) THEN 'FAIL' ELSE 'PASS' END/);
    expect(checker).toContain('ORDER BY report.sort_order');
  });

  it('the checker expects public and anon false, authenticated false unless kept, service_role true, and a NULL fails (C-2)', () => {
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

  it('the pre-check carries every marker, Q0, the grantor row, Q11 and the status row, and no Q10', () => {
    for (const marker of [
      "'PRECHECK STATUS'",
      "'Q0 type vector'",
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
    expect(precheck).not.toMatch(/Q10|is_lock_wrapper|bare_signature/);
  });

  // SA Q-3: a vector type that does not resolve would make rows 1 and 3 read MISSING.
  it('the pre-check Q0 resolves the vector type and stops when it does not', () => {
    expect(precheck).toMatch(/WHEN pg_catalog\.to_regtype\('vector'\) IS NULL THEN 'unresolved on this search path stop here'/);
  });

  it('the pre-check expected grantees equal the TSV execute_grantees, read directly from the TSV', () => {
    const rows = tsvFunctionRows();
    SLICE_3.forEach((fn, index) => {
      const matches = rows.filter((cols) => cols[1] === fn.name);
      expect(matches).toHaveLength(1);
      expect(precheck).toContain(
        `('${fn.name}', '${fn.signature}', ${index + 1}, '${matches[0][11]}', ${keepsAuthenticated(fn)})`
      );
    });
  });

  it('the pre-check Q4 compares public against the shape (PUBLIC in the expected grantees), the other three must be true', () => {
    expect(precheck).toContain("strpos(watched.expected_grantees, 'PUBLIC') > 0 AS expects_public");
    expect(precheck).toContain(
      "WHEN pg_catalog.has_function_privilege('public', fn_state.fn_oid, 'EXECUTE') = fn_state.expects_public"
    );
  });

  // SA S3-2: for the 17 any INVOKER caller stops; for is_platform_admin an
  // INVOKER trigger always stops and another INVOKER caller stops if anon can
  // run it. A SECDEF caller stops unless it is owned by postgres.
  it('the pre-check Q6 applies the S3-2 caller rule', () => {
    expect(precheck).toContain("pg_proc.prorettype = 'trigger'::regtype AS caller_is_trigger");
    expect(precheck).toContain("pg_catalog.has_function_privilege('anon', pg_proc.oid, 'EXECUTE') AS caller_anon_executes");
    expect(precheck).toMatch(
      /CASE\s+WHEN caller_proc\.caller_secdef THEN caller_proc\.caller_owner <> 'postgres'\s+WHEN NOT caller_proc\.keeps_authenticated THEN true\s+WHEN caller_proc\.caller_is_trigger THEN true\s+ELSE caller_proc\.caller_anon_executes\s+END AS needs_stop/
    );
  });

  // SA S3-1: an is_platform_admin policy is ok only when every role is
  // authenticated or service_role; the 17 keep the slice 2 rule.
  it('the pre-check Q7 applies the S3-1 role rule for is_platform_admin and the slice 2 rule for the 17', () => {
    expect(precheck).toMatch(
      /WHEN fn_state\.keeps_authenticated\s+THEN NOT \(pg_policies\.roles <@ ARRAY\['authenticated', 'service_role'\]::name\[\]\)\s+ELSE pg_policies\.roles && ARRAY\['public', 'anon', 'authenticated'\]::name\[\]/
    );
  });

  it('the pre-check Q11 reads pg_depend, and only an is_platform_admin pg_policy dependent with authenticated or service_role roles is ok', () => {
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

// SA S3-3 and S3-4: the acceptance blocks the user pastes after apply live in
// the workplan QA section (not extra files), so the paste rules are checked there.
describe('the acceptance blocks in the workplan QA section', () => {
  const workplan = read(WORKPLAN);
  const start = workplan.indexOf('### Acceptance blocks');
  const section = workplan.slice(start);
  const blocks = [...section.slice(0, section.indexOf('\n---')).matchAll(/```sql\n([\s\S]*?)```/g)].map((match) => match[1]);
  const window = (minutes: number) => `pg_catalog.now() - pg_catalog.make_interval(mins => ${minutes})`;

  const EXPECTED: Array<[string, string[]]> = [
    [
      'N1',
      [
        'BEGIN',
        'SET LOCAL ROLE anon',
        'SELECT public.record_business_event(NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::uuid, NULL::uuid, NULL::numeric, NULL::jsonb, NULL::text, NULL::timestamptz)',
        'ROLLBACK',
      ],
    ],
    ['N2', ['BEGIN', 'SET LOCAL ROLE authenticated', 'SELECT public.get_similar_patterns(NULL::text[])', 'ROLLBACK']],
    ['N3', ['BEGIN', 'SET LOCAL ROLE anon', 'SELECT public.is_platform_admin()', 'ROLLBACK']],
    ['P1', ['BEGIN', 'SET LOCAL ROLE authenticated', 'SELECT public.is_platform_admin() AS is_admin', 'ROLLBACK']],
    [
      'P2a',
      [
        'BEGIN',
        'SET LOCAL ROLE anon',
        'SELECT (SELECT count(*) FROM public.system_settings_config) AS settings_rows, (SELECT count(*) FROM public.ai_model_pricing) AS pricing_rows',
        'ROLLBACK',
      ],
    ],
    ['P2b', ['BEGIN', 'SET LOCAL ROLE authenticated', 'SELECT count(*) AS pricing_rows FROM public.ai_model_pricing', 'ROLLBACK']],
    [
      'P3',
      [
        'BEGIN',
        "SELECT pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', admin_users.user_id)::text, true) AS claims_set FROM public.admin_users WHERE admin_users.is_active AND admin_users.user_id IS NOT NULL LIMIT 1",
        'SET LOCAL ROLE authenticated',
        'SELECT public.is_platform_admin() AS is_admin, (SELECT count(*) FROM public.ai_model_pricing) AS pricing_rows',
        'ROLLBACK',
      ],
    ],
    [
      'F1',
      [
        'SELECT (SELECT sum(business_chat_plan_cache.hit_count) FROM public.business_chat_plan_cache) AS plan_hits, (SELECT sum(business_chat_verified_questions.uses) FROM public.business_chat_verified_questions) AS vq_uses',
      ],
    ],
    [
      'F4-events',
      [
        `SELECT business_events.event_type, count(*) AS events FROM public.business_events WHERE business_events.created_at >= ${window(30)} GROUP BY business_events.event_type ORDER BY business_events.event_type`,
      ],
    ],
    [
      'F4-contacts',
      [`SELECT count(*) AS contacts_updated FROM public.crm_contacts WHERE crm_contacts.updated_at >= ${window(30)}`],
    ],
    [
      'F8',
      [
        `SELECT count(*) AS new_agents, count(*) FILTER (WHERE agents.org_id IS NULL) AS without_org FROM public.agents WHERE agents.created_at >= ${window(90)}`,
      ],
    ],
    [
      'CRON',
      [
        `SELECT bos_cron_runs.job, bos_cron_runs.outcome, count(*) AS runs FROM public.bos_cron_runs WHERE bos_cron_runs.started_at >= ${window(90)} GROUP BY bos_cron_runs.job, bos_cron_runs.outcome ORDER BY bos_cron_runs.job, bos_cron_runs.outcome`,
      ],
    ],
  ];

  it('the section exists and holds exactly the mandatory blocks, in order', () => {
    expect(start).toBeGreaterThan(0);
    expect(blocks).toHaveLength(EXPECTED.length);
  });

  it.each(EXPECTED.map(([name], index) => [name, index] as [string, number]))('block %s is pinned statement for statement', (_name, index) => {
    expect(statementsOf(blocks[index])).toEqual(EXPECTED[index][1]);
  });

  it('every block is paste-safe: no comment, no "into", no single-letter alias, no timestamp literal', () => {
    for (const block of blocks) {
      expect(block).not.toContain('--');
      expect(block).not.toContain('/*');
      expect(block).not.toMatch(/into/i);
      expect(block).not.toMatch(/\bAS [a-z]\b/i);
      expect(block).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(block).not.toMatch(/\b(timestamp|interval)\s+'/i);
    }
  });

  it('only P3 holds literals, exactly request.jwt.claims and sub (S3-4)', () => {
    blocks.forEach((block, index) => {
      const literals = literalsOf(block);
      if (EXPECTED[index][0] === 'P3') expect(literals).toEqual(['request.jwt.claims', 'sub']);
      else expect(literals).toEqual([]);
    });
  });

  it('every role block ends in ROLLBACK, so nothing persists and the role reverts', () => {
    blocks.forEach((block) => {
      const statements = statementsOf(block);
      if (statements[0] === 'BEGIN') expect(statements[statements.length - 1]).toBe('ROLLBACK');
    });
  });
});
