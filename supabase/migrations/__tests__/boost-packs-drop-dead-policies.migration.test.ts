/**
 * Guard over migration 20261040 (follow-up to 20261039, P-10 workplan): drop
 * the two RLS policies on `boost_packs` that 20261039 left dead, and keep RLS
 * ENABLED. RLS on with no policy denies every role that does not bypass RLS,
 * which is the intent; the service-role admin route bypasses RLS and is
 * unaffected.
 *
 * Prod pre-check (2026-10-07) showed exactly these two policies:
 *   - "Boost packs are publicly readable": SELECT, roles {public},
 *     using (is_active = true). Dead: 20261039 revoked every browser grant.
 *   - "Service role can manage boost packs": ALL, roles {public},
 *     using ((auth.jwt() ->> 'role') = 'service_role'). Redundant: the service
 *     role bypasses RLS.
 *
 * After 20261040 the 20261039 checker's C5 ("policy count unchanged", pinned
 * at 2) reads FAIL BY DESIGN; use the 20261040 checker from then on.
 *
 * WHY A TEST OVER SQL TEXT: there is no branch database. The user pastes the
 * pre-check, the migration (in a NEW tab), the checker and, if ever needed,
 * the rollback into the Supabase SQL editor by hand. Same pattern as
 * boost-packs-revoke-client-select.migration.test.ts (20261039).
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const MIGRATION = join(ROOT, 'supabase', 'migrations', '20261040_boost_packs_drop_dead_policies.sql');
const ROLLBACK = join(ROOT, 'supabase', 'SQL Scripts', '20261040_boost_packs_drop_dead_policies_rollback.sql');
const CHECKER = join(ROOT, 'scripts', 'check-boost-packs-dead-policies-migration.sql');
const PRECHECK = join(ROOT, 'scripts', 'precheck-boost-packs-dead-policies.sql');

const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const migration = read(MIGRATION);
const rollback = read(ROLLBACK);
const checker = read(CHECKER);
const precheck = read(PRECHECK);

/**
 * Single-quoted string literals only. Double-quoted policy names are
 * identifiers, not literals, so they are deliberately not matched here.
 */
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

const READABLE = 'Boost packs are publicly readable';
const MANAGE = 'Service role can manage boost packs';

const EXPECTED_DROPS = [
  `DROP POLICY "${READABLE}" ON public.boost_packs`,
  `DROP POLICY "${MANAGE}" ON public.boost_packs`,
];
const EXPECTED_CREATES = [
  `CREATE POLICY "${READABLE}" ON public.boost_packs AS PERMISSIVE FOR SELECT TO public USING (is_active = true)`,
  `CREATE POLICY "${MANAGE}" ON public.boost_packs AS PERMISSIVE FOR ALL TO public USING ((auth.jwt() ->> 'role') = 'service_role')`,
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

  it.each(files)('%s holds only letters, digits, underscores and spaces inside string literals', (_name, file) => {
    for (const literal of literalsOf(read(file))) expect(literal).toMatch(/^[A-Za-z0-9_ ]*$/);
  });

  it.each(files)('%s has an even number of single quotes (no literal swallows the operators)', (_name, file) => {
    expect((read(file).match(/'/g) ?? []).length % 2).toBe(0);
  });

  it.each(files)('%s uses no single-letter alias', (_name, file) => {
    expect(read(file)).not.toMatch(/\bAS [a-z]\b/i);
  });

  it('the rollback keeps ->> outside every string literal', () => {
    for (const literal of literalsOf(rollback)) expect(literal).not.toContain('->>');
    expect(rollback).toContain("(auth.jwt() ->> 'role')");
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

describe('the migration: two DROP POLICY statements on boost_packs and nothing else', () => {
  const statements = statementsOf(migration);

  it('is one BEGIN … COMMIT', () => {
    expect(statements[0]).toBe('BEGIN');
    expect(statements[statements.length - 1]).toBe('COMMIT');
    expect(statements.filter((s) => s === 'BEGIN' || s === 'COMMIT')).toHaveLength(2);
  });

  it('holds exactly the two expected DROP POLICY statements, in order', () => {
    expect(statements.slice(1, -1)).toEqual(EXPECTED_DROPS);
  });

  it('keeps RLS on and touches no grant, no other object and no other table', () => {
    expect(migration).not.toMatch(/ROW LEVEL SECURITY|\bDISABLE\b|\bNO FORCE\b/i);
    expect(migration).not.toMatch(/\b(GRANT|REVOKE|ALTER|CREATE|TABLE|FUNCTION|CASCADE|IF EXISTS)\b/);
    expect(migration.match(/ON public\.\w+/g)).toEqual(['ON public.boost_packs', 'ON public.boost_packs']);
  });
});

describe('the rollback re-creates both policies exactly as they were in prod', () => {
  const statements = statementsOf(rollback);

  it('is one BEGIN … COMMIT of the two expected CREATE POLICY statements', () => {
    expect(statements[0]).toBe('BEGIN');
    expect(statements[statements.length - 1]).toBe('COMMIT');
    expect(statements.slice(1, -1)).toEqual(EXPECTED_CREATES);
  });

  it('adds no WITH CHECK, no grant and does not touch RLS', () => {
    expect(rollback).not.toMatch(/WITH CHECK|\bGRANT\b|\bREVOKE\b|ROW LEVEL SECURITY|\bDROP\b/);
  });
});

describe('the checker and the pre-check cover what the migration does', () => {
  it('the checker reports a VERDICT row first, PASS only when every check passes', () => {
    expect(checker).toContain("'VERDICT' AS check_name");
    expect(checker).toMatch(/CASE WHEN EXISTS \(SELECT 1 FROM checks WHERE checks\.result <> 'PASS'\) THEN 'FAIL' ELSE 'PASS' END/);
    expect(checker).toContain('ORDER BY report.sort_order');
  });

  it('the checker expects 0 policies, both named policies gone, and RLS still on', () => {
    expect(checker).toContain("('boost_packs', 0)");
    expect(checker).toContain(`('${READABLE}', 1)`);
    expect(checker).toContain(`('${MANAGE}', 2)`);
    expect(checker).toContain("'C2 rls still on '");
    expect(checker).toContain("CASE WHEN table_state.rls_on THEN 'PASS' ELSE 'FAIL' END");
  });

  it('the checker still expects no privilege at all for both browser roles, all eight incl. PG17 MAINTAIN', () => {
    for (const role of ['anon', 'authenticated']) expect(checker).toContain(`('${role}'`);
    for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) {
      expect(checker).toContain(`('${privilege}'`);
    }
    expect(checker).toContain("WHEN client_privileges.is_held THEN 'FAIL'");
  });

  it('the checker fails closed on service_role SELECT', () => {
    expect(checker).toMatch(
      /CASE WHEN COALESCE\(has_table_privilege\('service_role', table_state\.table_oid, 'SELECT'\), false\)\s+THEN 'PASS' ELSE 'FAIL' END/
    );
  });

  it('the pre-check reports RLS, grants per role, the policy list, count (expected 2), each named policy and dependents', () => {
    for (const marker of [
      "'Q1 boost_packs'",
      "'Q2 boost_packs '",
      "'Q4 policy count boost_packs expected 2'",
      "'Q4 policy present '",
      "'Q4 policies boost_packs'",
      "'Q5 rows boost_packs'",
      "'Q6 boost packs active now'",
      "'Q7 dependent views count boost_packs'",
      "'Q7 functions naming boost_packs count'",
    ]) {
      expect(precheck).toContain(marker);
    }
    expect(precheck).toContain(`('${READABLE}', 1)`);
    expect(precheck).toContain(`('${MANAGE}', 2)`);
    for (const role of ['anon', 'authenticated', 'service_role', 'PUBLIC']) expect(precheck).toContain(`('${role}'`);
    expect(precheck).toContain('ORDER BY report.sort_order, report.item');
  });

  it('neither the checker nor the pre-check writes anything', () => {
    for (const text of [checker, precheck]) {
      expect(text).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|ALTER|DROP|CREATE)\b(?!')/);
    }
  });
});
