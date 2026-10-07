/**
 * Guard over migration 20261039 (plan payments P-10 follow-up, workplan
 * BUSINESS_OS_PLAN_PAYMENTS_P10_WORKPLAN.md §16b.2 / B-4, SA ruling Q-7): the
 * browser roles lose SELECT on `boost_packs`. 20261038 already removed their
 * writes and kept SELECT only because the agent-platform billing UI read the
 * table; P-10b (#238) removed both browser readers, so the last browser grant
 * on the table goes. The service-role admin route is unaffected.
 *
 * WHY A TEST OVER SQL TEXT. There is no branch database: the user pastes the
 * pre-check, the migration (in a NEW tab, because the pre-check leaves the
 * session read-only), the checker and, if ever needed, the rollback into the
 * Supabase SQL editor by hand. Same pattern as
 * purchase-path-tables-client-grants.migration.test.ts (20261038).
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const MIGRATION = join(ROOT, 'supabase', 'migrations', '20261039_boost_packs_revoke_client_select.sql');
const ROLLBACK = join(ROOT, 'supabase', 'SQL Scripts', '20261039_boost_packs_revoke_client_select_rollback.sql');
const CHECKER = join(ROOT, 'scripts', 'check-boost-packs-client-select-migration.sql');
const PRECHECK = join(ROOT, 'scripts', 'precheck-boost-packs-client-select.sql');

const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const migration = read(MIGRATION);
const rollback = read(ROLLBACK);
const checker = read(CHECKER);
const precheck = read(PRECHECK);

function literalsOf(sql: string): string[] {
  return [...sql.matchAll(/'([^']*)'/g)].map((match) => match[1]);
}

/** Non-empty statements, whitespace collapsed, without the trailing semicolon. */
function statementsOf(sql: string): string[] {
  return sql
    .split(';')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

const EXPECTED_REVOKES = [
  'REVOKE SELECT ON TABLE public.boost_packs FROM anon',
  'REVOKE SELECT ON TABLE public.boost_packs FROM authenticated',
];
const EXPECTED_GRANTS = [
  'GRANT SELECT ON TABLE public.boost_packs TO anon',
  'GRANT SELECT ON TABLE public.boost_packs TO authenticated',
];

describe('SQL-editor safety (the user pastes all four files by hand)', () => {
  const files: Array<[string, string]> = [
    ['migration', MIGRATION],
    ['rollback', ROLLBACK],
    ['checker', CHECKER],
    ['pre-check', PRECHECK],
  ];

  it.each(files)('%s exists', (_name, file) => {
    expect(existsSync(file)).toBe(true);
  });

  it.each(files)('%s has no line comment and no block comment', (_name, file) => {
    const text = read(file);
    expect(text).not.toContain('--');
    expect(text).not.toContain('/*');
  });

  // The Supabase SQL editor misreads the word "into" even inside a string
  // literal or an identifier (2026-10-04). No pasted file may contain it, in any case.
  it.each(files)('%s never contains "into" anywhere (the SQL editor misreads it)', (_name, file) => {
    expect(read(file)).not.toMatch(/into/i);
  });

  // Underscore is allowed only because table and role names need it (same rule as 20261038).
  it.each(files)('%s holds only letters, digits, underscores and spaces inside string literals', (_name, file) => {
    for (const literal of literalsOf(read(file))) expect(literal).toMatch(/^[A-Za-z0-9_ ]*$/);
  });

  it.each(files)('%s uses no single-letter alias', (_name, file) => {
    expect(read(file)).not.toMatch(/\bAS [a-z]\b/i);
  });

  it('the checker and the pre-check are read-only from their first statement', () => {
    for (const text of [checker, precheck]) {
      expect(statementsOf(text)[0]).toBe('SET default_transaction_read_only = on');
    }
  });

  it('the pre-check tells the user to run the migration in a NEW tab (it leaves the session read-only)', () => {
    expect(precheck).toContain('run the migration in a NEW tab');
  });
});

describe('the migration: two one-role REVOKE SELECTs on boost_packs and nothing else', () => {
  const statements = statementsOf(migration);

  it('is one BEGIN … COMMIT', () => {
    expect(statements[0]).toBe('BEGIN');
    expect(statements[statements.length - 1]).toBe('COMMIT');
    expect(statements.filter((s) => s === 'BEGIN' || s === 'COMMIT')).toHaveLength(2);
  });

  it('holds exactly the two expected REVOKE statements, in order', () => {
    expect(statements.slice(1, -1)).toEqual(EXPECTED_REVOKES);
  });

  it('never names service_role, PUBLIC or postgres, and never grants, drops a policy, alters or creates', () => {
    expect(migration).not.toMatch(/service_role|\bPUBLIC\b|\bpostgres\b/);
    expect(migration).not.toMatch(/\b(GRANT|DROP|ALTER|CREATE|POLICY|FUNCTION|CASCADE|ALL)\b/);
  });
});

describe('the rollback gives back exactly what the migration took', () => {
  const statements = statementsOf(rollback);

  it('is one BEGIN … COMMIT of the two expected GRANT statements', () => {
    expect(statements[0]).toBe('BEGIN');
    expect(statements[statements.length - 1]).toBe('COMMIT');
    expect(statements.slice(1, -1)).toEqual(EXPECTED_GRANTS);
  });

  it('never touches service_role, PUBLIC or postgres and grants no option', () => {
    expect(rollback).not.toMatch(/service_role|\bPUBLIC\b|\bpostgres\b|\bREVOKE\b|WITH GRANT OPTION/);
  });
});

describe('the checker and the pre-check cover what the migration does', () => {
  it('the checker reports a VERDICT row first, PASS only when every check passes', () => {
    expect(checker).toContain("'VERDICT' AS check_name");
    expect(checker).toMatch(/CASE WHEN EXISTS \(SELECT 1 FROM checks WHERE checks\.result <> 'PASS'\) THEN 'FAIL' ELSE 'PASS' END/);
    expect(checker).toContain('ORDER BY report.sort_order');
  });

  it('the checker expects no privilege at all for both browser roles, all eight table privileges incl. PG17 MAINTAIN', () => {
    expect(checker).toContain("('boost_packs')");
    for (const role of ['anon', 'authenticated']) expect(checker).toContain(`('${role}'`);
    for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) {
      expect(checker).toContain(`('${privilege}'`);
    }
    // Any held privilege is a FAIL; no client privilege is kept any more.
    expect(checker).toContain("WHEN client_privileges.is_held THEN 'FAIL'");
    expect(checker).not.toContain('client_reads_kept');
  });

  it('the checker fails closed on service_role SELECT, RLS and the policy count (policies are not dropped)', () => {
    expect(checker).toMatch(
      /CASE WHEN COALESCE\(has_table_privilege\('service_role', table_state\.table_oid, 'SELECT'\), false\)\s+THEN 'PASS' ELSE 'FAIL' END/
    );
    expect(checker).toContain("'C2 rls unchanged '");
    expect(checker).toContain("'C4 no column grant to anon or authenticated or PUBLIC '");
    // Production pre-check Q-4 for 20261038 (2026-10-06): boost_packs has 2 policies.
    expect(checker).toContain("('boost_packs', 2)");
    expect(checker).toContain("WHEN expected_policy_counts.policy_count < 0 THEN 'FAIL'");
  });

  it('the pre-check reports grants per role, RLS, column grants, policies and row count', () => {
    for (const marker of ["'Q1 boost_packs'", "'Q2 boost_packs '", "'Q3 column grants", "'Q4 policy count boost_packs'", "'Q4 policies boost_packs'", "'Q5 rows boost_packs'"]) {
      expect(precheck).toContain(marker);
    }
    for (const role of ['anon', 'authenticated', 'service_role', 'PUBLIC']) expect(precheck).toContain(`('${role}'`);
    expect(precheck).toContain('ORDER BY report.sort_order, report.item');
  });

  it('the pre-check lists views and functions that depend on boost_packs (SA nit 1)', () => {
    for (const marker of ["'Q7 dependent views count boost_packs'", "'Q7 dependent view '", "'Q7 functions naming boost_packs count'", "'Q7 function '"]) {
      expect(precheck).toContain(marker);
    }
    expect(precheck).toContain("pg_depend.classid = 'pg_rewrite'::regclass");
    expect(precheck).toContain("strpos(lower(pg_proc.prosrc), 'boost_packs') > 0");
    expect(precheck).toContain('pg_proc.prosecdef');
  });

  it('neither the checker nor the pre-check writes anything', () => {
    for (const text of [checker, precheck]) {
      expect(text).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|ALTER|DROP|CREATE)\b(?!')/);
    }
  });
});
