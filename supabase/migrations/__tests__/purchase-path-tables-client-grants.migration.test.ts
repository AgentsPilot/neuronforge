/**
 * Guard over migration 20261038 (plan payments P-10, workplan
 * BUSINESS_OS_PLAN_PAYMENTS_P10_WORKPLAN.md §5, SA rulings Q-7 and P10-C1,
 * P10-C7): the browser roles lose their table grants on four purchase-path
 * tables no browser code uses, and their WRITE grants on `boost_packs` (whose
 * SELECT the parked billing UI still needs until P-10b).
 *
 * WHY A TEST OVER SQL TEXT. There is no branch database: the user pastes the
 * pre-check, the migration (in a NEW tab, because the pre-check leaves the
 * session read-only), the checker and, if ever needed, the rollback into the
 * Supabase SQL editor by hand. What the files alone can prove is pinned here:
 * the paste-safety rules, that the migration is exactly twelve one-table
 * one-role REVOKEs and nothing else, that it never touches `service_role`,
 * PUBLIC or the owner, and that the pre-check, checker and rollback match it.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const MIGRATION = join(ROOT, 'supabase', 'migrations', '20261038_purchase_path_tables_client_grants.sql');
const ROLLBACK = join(ROOT, 'supabase', 'SQL Scripts', '20261038_purchase_path_tables_client_grants_rollback.sql');
const CHECKER = join(ROOT, 'scripts', 'check-purchase-path-tables-grants-migration.sql');
const PRECHECK = join(ROOT, 'scripts', 'precheck-purchase-path-tables-grants.sql');
const DB_WRITERS = join(ROOT, 'scripts', 'check-billing-events-db-writers.sql');

const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const migration = read(MIGRATION);
const rollback = read(ROLLBACK);
const checker = read(CHECKER);
const precheck = read(PRECHECK);
// QA ask at the P-10a review: a read-only look for database-side writers of billing_events.
const dbWriters = read(DB_WRITERS);

const REVOKE_ALL_TABLES = ['billing_events', 'boost_pack_purchases', 'subscription_invoices', 'processed_webhook_events'];
const WRITES_ONLY_TABLE = 'boost_packs';
const CLIENT_ROLES = ['anon', 'authenticated'];
const WRITE_PRIVILEGES = 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER';

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
  ...REVOKE_ALL_TABLES.flatMap((table) => CLIENT_ROLES.map((role) => `REVOKE ALL ON TABLE public.${table} FROM ${role}`)),
  ...CLIENT_ROLES.map((role) => `REVOKE ${WRITE_PRIVILEGES} ON TABLE public.${WRITES_ONLY_TABLE} FROM ${role}`),
];

describe('SQL-editor safety (the user pastes all four files by hand)', () => {
  const files: Array<[string, string]> = [
    ['migration', MIGRATION],
    ['rollback', ROLLBACK],
    ['checker', CHECKER],
    ['pre-check', PRECHECK],
    ['billing_events db-writers check', DB_WRITERS],
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
  // literal ("paste the migration into a NEW tab" failed with relation "a" does
  // not exist, 2026-10-04). No pasted file may contain it, in any case.
  it.each(files)('%s never contains the word "into" (the SQL editor misreads it)', (_name, file) => {
    expect(read(file)).not.toMatch(/\binto\b/i);
  });

  it.each(files)('%s holds only letters, digits, underscores and spaces inside string literals', (_name, file) => {
    const literals = literalsOf(read(file));
    for (const literal of literals) expect(literal).toMatch(/^[A-Za-z0-9_ ]*$/);
  });

  it.each(files)('%s uses no single-letter alias', (_name, file) => {
    expect(read(file)).not.toMatch(/\bAS [a-z]\b/i);
  });

  it('the checker and the pre-check are read-only from their first statement', () => {
    for (const text of [checker, precheck, dbWriters]) {
      expect(statementsOf(text)[0]).toBe('SET default_transaction_read_only = on');
    }
  });

  it('the pre-check tells the user to run the migration in a NEW tab (it leaves the session read-only)', () => {
    expect(precheck).toContain('run the migration in a NEW tab');
  });
});

describe('the migration: twelve one-table one-role REVOKEs and nothing else (SA P10-C7)', () => {
  const statements = statementsOf(migration);

  it('is one BEGIN … COMMIT', () => {
    expect(statements[0]).toBe('BEGIN');
    expect(statements[statements.length - 1]).toBe('COMMIT');
    expect(statements.filter((s) => s === 'BEGIN' || s === 'COMMIT')).toHaveLength(2);
  });

  it('holds exactly the twelve expected REVOKE statements between them, in order', () => {
    expect(statements.slice(1, -1)).toEqual(EXPECTED_REVOKES);
  });

  it('each REVOKE names exactly one table and exactly one role', () => {
    for (const statement of statements.slice(1, -1)) {
      expect(statement.match(/\bpublic\.\w+/g)).toHaveLength(1);
      const role = statement.split(' FROM ')[1];
      expect(CLIENT_ROLES).toContain(role);
      expect(statement).not.toMatch(/,\s*(anon|authenticated)\b/);
    }
  });

  it('never names service_role, PUBLIC or postgres, and never grants, drops, alters or creates', () => {
    expect(migration).not.toMatch(/service_role|\bPUBLIC\b|\bpostgres\b/);
    expect(migration).not.toMatch(/\b(GRANT|DROP|ALTER|CREATE|POLICY|FUNCTION|CASCADE)\b/);
  });

  it('keeps SELECT on boost_packs (the parked billing UI reads it until P-10b, SA Q-7)', () => {
    const boost = statements.filter((s) => s.includes(`public.${WRITES_ONLY_TABLE} `));
    expect(boost).toHaveLength(2);
    for (const statement of boost) {
      expect(statement).not.toMatch(/\b(ALL|SELECT)\b/);
    }
  });
});

describe('the rollback mirrors the migration, to the browser roles only', () => {
  const statements = statementsOf(rollback);
  const grants = statements.slice(1, -1);

  it('is one BEGIN … COMMIT of GRANT statements only', () => {
    expect(statements[0]).toBe('BEGIN');
    expect(statements[statements.length - 1]).toBe('COMMIT');
    for (const statement of grants) expect(statement.startsWith('GRANT ')).toBe(true);
  });

  it('grants only to anon and authenticated, one table and one role per statement', () => {
    for (const statement of grants) {
      expect(statement.match(/\bpublic\.\w+/g)).toHaveLength(1);
      expect(CLIENT_ROLES).toContain(statement.split(' TO ')[1]);
    }
    expect(rollback).not.toMatch(/service_role|\bPUBLIC\b|\bpostgres\b|\bREVOKE\b|WITH GRANT OPTION/);
  });

  it('covers exactly the table and role pairs the migration revokes, and gives boost_packs back only its writes', () => {
    const pairs = (list: string[], joiner: string) =>
      list.map((s) => `${s.match(/\bpublic\.(\w+)/)?.[1]} ${s.split(joiner)[1]}`).sort();
    expect(pairs(grants, ' TO ')).toEqual(pairs(statementsOf(migration).slice(1, -1), ' FROM '));
    for (const statement of grants.filter((s) => s.includes(`public.${WRITES_ONLY_TABLE} `))) {
      expect(statement).toBe(`GRANT ${WRITE_PRIVILEGES} ON TABLE public.${WRITES_ONLY_TABLE} TO ${statement.split(' TO ')[1]}`);
    }
  });
});

describe('the checker and the pre-check cover what the migration does', () => {
  it('the checker reports a VERDICT row first, PASS only when every check passes', () => {
    expect(checker).toContain("'VERDICT' AS check_name");
    expect(checker).toMatch(/CASE WHEN EXISTS \(SELECT 1 FROM checks WHERE checks\.result <> 'PASS'\) THEN 'FAIL' ELSE 'PASS' END/);
    expect(checker).toContain('ORDER BY report.sort_order');
  });

  it('the checker watches all five tables and all seven table privileges for both browser roles', () => {
    for (const table of [...REVOKE_ALL_TABLES, WRITES_ONLY_TABLE]) expect(checker).toContain(`'${table}'`);
    for (const role of CLIENT_ROLES) expect(checker).toContain(`('${role}'`);
    for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
      expect(checker).toContain(`('${privilege}'`);
    }
    // Only boost_packs keeps client reads.
    expect(checker).toContain("('boost_packs', 5, true)");
    for (const table of REVOKE_ALL_TABLES) expect(checker).toMatch(new RegExp(`\\('${table}', \\d, false\\)`));
  });

  it('the checker fails closed on service_role: a missing privilege or table is FAIL, not skipped (P10-C7)', () => {
    for (const need of [
      "('processed_webhook_events', 'SELECT'",
      "('processed_webhook_events', 'INSERT'",
      "('processed_webhook_events', 'UPDATE'",
      "('billing_events', 'INSERT'",
      "('boost_pack_purchases', 'INSERT'",
      "('boost_packs', 'SELECT'",
    ]) {
      expect(checker).toContain(need);
    }
    expect(checker).toMatch(
      /CASE WHEN COALESCE\(has_table_privilege\('service_role', table_state\.table_oid, service_role_needs\.privilege_name\), false\)\s+THEN 'PASS' ELSE 'FAIL' END/
    );
    // An unfilled policy count is a FAIL, never a silent pass.
    expect(checker).toContain("WHEN expected_policy_counts.policy_count < 0 THEN 'FAIL'");
  });

  it('the checker checks RLS is still on and that no column-level grant reaches the browser roles', () => {
    expect(checker).toContain("'C2 rls still on '");
    expect(checker).toContain("'C4 no column grant to anon or authenticated or PUBLIC '");
  });

  it('the pre-check captures grants, column grants, policies, rows, boost pack values and the frozen-account merge gate (P10-C1)', () => {
    for (const marker of ["'Q1 '", "'Q2 '", "'Q3 column grants", "'Q4 policy count '", "'Q4 policies '", "'Q5 rows ", "'Q6 boost pack '", "'Q7 frozen accounts expected 0'", "'Q7 frozen Business OS accounts expected 0 and a merge gate'"]) {
      expect(precheck).toContain(marker);
    }
    expect(precheck).toContain('JOIN public.business_os_account_plans ON business_os_account_plans.user_id = user_subscriptions.user_id');
    expect(precheck).toContain('WHERE user_subscriptions.account_frozen');
  });

  it('neither the checker nor the pre-check writes anything', () => {
    for (const text of [checker, precheck, dbWriters]) {
      expect(text).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|ALTER|DROP|CREATE)\b(?!')/);
    }
  });
});

describe('the billing_events db-writers check (QA ask, P-10a review)', () => {
  it('lists triggers on billing_events and functions whose source names it, read-only', () => {
    expect(dbWriters).toContain("pg_class.relname = 'billing_events'");
    expect(dbWriters).toContain('FROM pg_trigger');
    expect(dbWriters).toContain("strpos(lower(pg_proc.prosrc), 'billing_events') > 0");
    expect(dbWriters).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|ALTER|DROP|CREATE)\b(?!')/);
  });
});
