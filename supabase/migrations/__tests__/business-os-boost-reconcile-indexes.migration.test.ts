/**
 * Guard over migration 20261032 (credits boost slice 4b.2, workplan §3.6, SA
 * Q-7): two partial indexes that keep the nightly reconcile reads cheap as
 * `business_os_boost_purchases` grows. Index-only: no function, no grant, no
 * policy, no data.
 *
 * SA Q-7: plain `CREATE INDEX` (not `IF NOT EXISTS`), so a second paste fails
 * safely instead of passing silently; the rollback uses `DROP INDEX IF EXISTS`.
 *
 * Each index matches one read of `listForReconcile` exactly, so the planner can
 * use it: the stuck read (`status IN (pending, awaiting_payment)` ordered by
 * the checkout expiry) and the receipt read (`paid` with no receipt link,
 * ordered by `paid_at`). This test pins that pairing on both sides.
 *
 * WHY A TEST OVER SQL TEXT: there is no branch database. The user pastes the
 * pre-check, the migration (in a NEW tab), the checker and, if ever needed,
 * the rollback into the Supabase SQL editor by hand.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const MIGRATION = join(ROOT, 'supabase', 'migrations', '20261032_business_os_boost_reconcile_indexes.sql');
const ROLLBACK = join(ROOT, 'supabase', 'SQL Scripts', '20261032_business_os_boost_reconcile_indexes_rollback.sql');
const CHECKER = join(ROOT, 'scripts', 'check-bos-boost-reconcile-indexes-migration.sql');
const PRECHECK = join(ROOT, 'scripts', 'precheck-bos-boost-reconcile-indexes.sql');
const REPOSITORY = join(ROOT, 'lib', 'repositories', 'BusinessOsBoostPurchaseRepository.ts');

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

const EXPECTED_CREATES = [
  "CREATE INDEX business_os_boost_purchases_reconcile_idx ON public.business_os_boost_purchases (checkout_expires_at) WHERE status IN ('pending', 'awaiting_payment')",
  "CREATE INDEX business_os_boost_purchases_receipt_backfill_idx ON public.business_os_boost_purchases (paid_at) WHERE status = 'paid' AND receipt_url IS NULL",
];
const EXPECTED_DROPS = [
  'DROP INDEX IF EXISTS public.business_os_boost_purchases_reconcile_idx',
  'DROP INDEX IF EXISTS public.business_os_boost_purchases_receipt_backfill_idx',
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

  // The Supabase SQL editor misreads the word "into" even inside a literal or an identifier.
  it.each(files)('%s never contains "into" anywhere', (_name, file) => {
    expect(read(file)).not.toMatch(/into/i);
  });

  it.each(files)('%s holds only letters, digits, underscores and spaces inside string literals', (_name, file) => {
    for (const literal of literalsOf(read(file))) expect(literal).toMatch(/^[A-Za-z0-9_ ]*$/);
  });

  it('the checker and the pre-check go further: letters, digits and spaces only (underscores come from chr)', () => {
    for (const text of [checker, precheck]) {
      for (const literal of literalsOf(text)) expect(literal).toMatch(/^[A-Za-z0-9 ]*$/);
      expect(text).toContain('chr(95)');
    }
  });

  it.each(files)('%s has an even number of single quotes', (_name, file) => {
    expect((read(file).match(/'/g) ?? []).length % 2).toBe(0);
  });

  it.each(files)('%s uses no single-letter alias', (_name, file) => {
    expect(read(file)).not.toMatch(/\bAS [a-z]\b/i);
  });

  it.each(files)('%s never names auth (the production runbook never writes to auth.users)', (_name, file) => {
    expect(read(file).toLowerCase()).not.toContain('auth');
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

describe('the migration: two partial indexes and nothing else (SA Q-7)', () => {
  const statements = statementsOf(migration);

  it('is one BEGIN … COMMIT holding exactly the two CREATE INDEX statements, in order', () => {
    expect(statements[0]).toBe('BEGIN');
    expect(statements[statements.length - 1]).toBe('COMMIT');
    expect(statements.slice(1, -1)).toEqual(EXPECTED_CREATES);
  });

  it('is plain CREATE INDEX: no IF NOT EXISTS, no CONCURRENTLY (a transaction), no UNIQUE', () => {
    expect(migration).not.toMatch(/IF NOT EXISTS|CONCURRENTLY|UNIQUE/);
  });

  it('touches no function, grant, policy, table or data', () => {
    expect(migration).not.toMatch(/\b(FUNCTION|GRANT|REVOKE|POLICY|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE|TABLE)\b/);
  });
});

describe('the rollback drops both indexes and nothing else', () => {
  it('is one BEGIN … COMMIT of the two DROP INDEX IF EXISTS statements', () => {
    const statements = statementsOf(rollback);
    expect(statements[0]).toBe('BEGIN');
    expect(statements[statements.length - 1]).toBe('COMMIT');
    expect(statements.slice(1, -1)).toEqual(EXPECTED_DROPS);
  });

  it('never drops the table, a constraint or the existing index', () => {
    expect(rollback).not.toMatch(/\b(TABLE|CONSTRAINT|CASCADE|FUNCTION)\b/);
    expect(rollback).not.toContain('user_id');
  });
});

describe('the checker and the pre-check cover what the migration does', () => {
  it('the checker reports a VERDICT row first, PASS only when every check passes', () => {
    expect(checker).toContain("'VERDICT' AS check_name");
    expect(checker).toMatch(/CASE WHEN EXISTS \(SELECT 1 FROM checks WHERE checks\.result <> 'PASS'\) THEN 'FAIL' ELSE 'PASS' END/);
    expect(checker).toContain('ORDER BY report.sort_order');
  });

  it('the checker expects both indexes, on the purchases table, valid and ready, one column each, partial', () => {
    expect(checker).toContain("('business os boost purchases reconcile idx', 1, 'checkout expires at', 'pending', 'awaiting')");
    expect(checker).toContain("('business os boost purchases receipt backfill idx', 2, 'paid at', 'paid', 'receipt')");
    for (const label of ["'C1 index exists '", "'C2 on business os boost purchases '", "'C3 valid and ready '", "'C4 one column '", "'C5 partial '"]) {
      expect(checker).toContain(label);
    }
    expect(checker).toContain('pg_index.indisvalid');
    expect(checker).toContain('pg_index.indpred');
  });

  it('the pre-check reports the table, each index absent, the current indexes and the row counts (counts only)', () => {
    for (const marker of [
      "'Q1 business os boost purchases'",
      "'Q2 index absent '",
      "'Q3 indexes on business os boost purchases'",
      "'Q4 rows in total'",
      "'Q4 rows pending or awaiting payment'",
      "'Q4 rows paid with no receipt link'",
      "'Q4 rows disputed'",
    ]) {
      expect(precheck).toContain(marker);
    }
    expect(precheck).toContain("('business os boost purchases reconcile idx', 1)");
    expect(precheck).toContain("('business os boost purchases receipt backfill idx', 2)");
  });

  it('neither the checker nor the pre-check writes anything, or reads a customer column beyond status and the receipt link', () => {
    for (const text of [checker, precheck]) {
      expect(text).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|ALTER|DROP|CREATE)\b(?!')/);
      expect(text).not.toMatch(/user_id|stripe_|amount_|receipt_url\s*,/);
    }
  });
});

describe('each index matches one reconcile read (the planner can use it)', () => {
  const repository = read(REPOSITORY);

  it('the stuck read filters the two statuses and orders by the checkout expiry', () => {
    expect(repository).toContain(".in('status', ['pending', 'awaiting_payment']).lt('checkout_expires_at', before).order('checkout_expires_at', { ascending: true })");
  });

  it('the receipt read filters paid with no receipt link and orders by paid_at', () => {
    expect(repository).toContain(".eq('status', 'paid').is('receipt_url', null).lt('paid_at', before).order('paid_at', { ascending: true })");
  });
});
