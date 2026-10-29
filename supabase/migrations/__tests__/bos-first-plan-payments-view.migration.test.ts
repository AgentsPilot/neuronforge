/**
 * Guard over migration 20261099, the first-payment view (MK5B-FU-1; workplan
 * docs/workplans/FINANCE_PAYING_FIRST_PAYMENT_SCALE_WORKPLAN.md §6 and §9.6;
 * SA-WP-M5F conditions M5F-C1 to M5F-C4).
 *
 * WHY A TEST OVER SQL TEXT: there is no branch database. The migration (in a
 * new tab), the checker, the EXPLAIN probe and the rollback are pasted into the
 * Supabase SQL editor by hand, so their text is what ships. The view's rule is
 * also mirrored in TypeScript (`tests/helpers/fakeFirstPaymentDb.ts`), and the
 * checker's C-6 compares the real view with a GROUP BY min on the live data.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n');
const migration = read('supabase', 'migrations', '20261099_business_os_first_plan_payments_view.sql');
const rollback = read('supabase', 'SQL Scripts', '20261099_business_os_first_plan_payments_view_rollback.sql');
const checker = read('scripts', 'check-bos-first-plan-payments-migration.sql');
const probe = read('scripts', 'explain-bos-first-plan-payments-month.sql');

/** SQL with `--` comments removed, whitespace collapsed. */
const code = (sql: string) =>
  sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim();

/** Code with every string literal blanked, so a privilege NAME inside a string is not mistaken for a statement. */
const noStrings = (sql: string) => code(sql).replace(/'[^']*'/g, "''");

const viewBody = (() => {
  const c = code(migration);
  const start = c.indexOf('CREATE VIEW public.business_os_first_plan_payments');
  const end = c.indexOf(';', start);
  return c.slice(start, end);
})();

/** The paste-safe rules every hand-pasted file follows (MK-9 C-2 precedent). */
function pasteSafe(sql: string) {
  expect(/[^\x00-\x7f]/.test(sql)).toBe(false);
  expect(/\binto\b/i.test(sql)).toBe(false);
  for (const line of sql.split('\n')) {
    const comment = line.indexOf('--');
    if (comment >= 0) expect(line.slice(comment)).not.toContain("'");
  }
}

describe('20261099: the migration', () => {
  it('runs in one transaction with a lock timeout and a build-time bound (M5F-C2)', () => {
    const c = code(migration);
    expect(c.startsWith('BEGIN;')).toBe(true);
    expect(c.endsWith('COMMIT;')).toBe(true);
    expect(c).toContain("SET LOCAL lock_timeout = '5s';");
    expect(c).toContain("SET LOCAL statement_timeout = '120s';");
    expect(c.indexOf('statement_timeout')).toBeLessThan(c.indexOf('CREATE INDEX'));
    // The row-count note that tells a future operator when plain index builds stop being right.
    expect(migration).toMatch(/one million rows/);
  });

  it('guards before any DDL (M5F-C3): Postgres 15, the base table, schema CREATE, free names, service role SELECT', () => {
    const c = code(migration);
    const guard = c.slice(c.indexOf('DO $first_payment_guard$'), c.indexOf('$first_payment_guard$;') + 1);
    expect(c.indexOf('DO $first_payment_guard$')).toBeLessThan(c.indexOf('CREATE INDEX'));
    expect(guard).toContain("pg_catalog.current_setting('server_version_num')::integer < 150000");
    expect(guard).toContain("to_regclass('public.business_os_billing_events') IS NULL");
    expect(guard).toContain("has_schema_privilege('anon', 'public', 'CREATE')");
    expect(guard).toContain("has_schema_privilege('authenticated', 'public', 'CREATE')");
    expect(guard).toContain("to_regclass('public.business_os_first_plan_payments') IS NOT NULL");
    expect(guard).toContain("has_table_privilege('service_role', 'public.business_os_billing_events', 'SELECT')");
  });

  it('every failure message says "Nothing was applied" (M5F-C3)', () => {
    const raises = [...migration.matchAll(/RAISE EXCEPTION[^;]*;/g)].map((m) => m[0]);
    expect(raises.length).toBeGreaterThanOrEqual(10);
    for (const raise of raises) expect(raise).toMatch(/Nothing was applied/);
  });

  it('builds exactly the two partial indexes, with predicates the view implies', () => {
    const c = code(migration);
    expect(c).toContain(
      "CREATE INDEX business_os_billing_events_first_payment_idx ON public.business_os_billing_events (user_id, livemode, paid_at, id) WHERE kind = 'invoice_paid' AND amount_minor > 0 AND paid_at IS NOT NULL;"
    );
    expect(c).toContain(
      "CREATE INDEX business_os_billing_events_paid_month_idx ON public.business_os_billing_events (livemode, paid_at) WHERE kind = 'invoice_paid' AND amount_minor > 0 AND paid_at IS NOT NULL AND user_id IS NOT NULL;"
    );
    expect((c.match(/CREATE INDEX/g) ?? []).length).toBe(2);
    expect(c).not.toMatch(/CONCURRENTLY/);
  });

  it('the view: security invoker, no security barrier, the rule, the anti-join with the id tie-break', () => {
    expect(viewBody).toContain('WITH (security_invoker = true)');
    expect(viewBody).not.toMatch(/security_barrier/);
    expect(viewBody).toContain(
      "WHERE e.kind = 'invoice_paid' AND e.amount_minor > 0 AND e.paid_at IS NOT NULL AND e.user_id IS NOT NULL AND NOT EXISTS ("
    );
    expect(viewBody).toContain(
      "WHERE earlier.user_id = e.user_id AND earlier.livemode = e.livemode AND earlier.kind = 'invoice_paid' AND earlier.amount_minor > 0 AND earlier.paid_at IS NOT NULL AND (earlier.paid_at < e.paid_at OR (earlier.paid_at = e.paid_at AND earlier.id < e.id))"
    );
    // No aggregate, DISTINCT or window: the view must stay inlinable so the filters push down (SA push-down note).
    expect(viewBody).not.toMatch(/\b(GROUP BY|DISTINCT|OVER|min\(|max\()/i);
  });

  it('M5F-C1: the view selects ONLY user_id, livemode and first_payment_at, and never the stamp word', () => {
    const select = viewBody.slice(viewBody.indexOf(' AS SELECT ') + ' AS SELECT '.length, viewBody.indexOf(' FROM '));
    expect(select).toBe('e.user_id, e.livemode, e.paid_at AS first_payment_at');
    const columns = select.split(',').map((part) => part.trim().split(/\s+AS\s+/i).pop()?.replace(/^e\./, ''));
    expect(columns).toEqual(['user_id', 'livemode', 'first_payment_at']);
    expect(code(migration)).not.toMatch(/first_paid_at/);
    // Nothing that could expose money or Stripe ids.
    expect(select).not.toMatch(/amount|stripe|invoice|tier|currency/);
  });

  it('M5F-C1 planted control: a view body naming the stamp word, or one more column, fails the same checks', () => {
    const planted = viewBody.replace('e.paid_at AS first_payment_at', 'e.paid_at AS first_paid_at, e.amount_minor');
    const select = planted.slice(planted.indexOf(' AS SELECT ') + ' AS SELECT '.length, planted.indexOf(' FROM '));
    expect(select).not.toBe('e.user_id, e.livemode, e.paid_at AS first_payment_at');
    expect(planted).toMatch(/first_paid_at/);
  });

  it('least privilege: four revokes, then SELECT to service_role only; no SECURITY DEFINER, no write', () => {
    const c = code(migration);
    for (const role of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
      expect(c).toContain(`REVOKE ALL ON TABLE public.business_os_first_plan_payments FROM ${role};`);
    }
    expect((c.match(/GRANT /g) ?? []).length).toBe(1);
    expect(c).toContain('GRANT SELECT ON TABLE public.business_os_first_plan_payments TO service_role;');
    expect(c.indexOf('GRANT SELECT')).toBeGreaterThan(c.lastIndexOf('REVOKE ALL'));
    expect(noStrings(migration)).not.toMatch(/SECURITY DEFINER|\bINSERT\b|\bUPDATE\b|\bDELETE\b|TRUNCATE|ALTER TABLE|DROP /i);
  });

  it('a post-apply probe checks invoker, the grants and a read AS service_role, inside the transaction', () => {
    const c = code(migration);
    const probeBlock = c.slice(c.indexOf('DO $first_payment_probe$'), c.indexOf('$first_payment_probe$;'));
    expect(c.indexOf('DO $first_payment_probe$')).toBeLessThan(c.indexOf('COMMIT;'));
    expect(probeBlock).toContain("view_option.option_name = 'security_invoker'");
    expect(probeBlock).toContain("FOREACH probe_role IN ARRAY ARRAY['public', 'anon', 'authenticated']");
    expect(probeBlock).toContain('SET LOCAL ROLE service_role;');
    expect(probeBlock).toContain('PERFORM 1 FROM public.business_os_first_plan_payments LIMIT 1;');
    expect(probeBlock).toContain('RESET ROLE;');
  });

  it('is paste-safe', () => pasteSafe(migration));
});

describe('20261099: the rollback', () => {
  it('drops exactly the view and the two indexes, in one transaction', () => {
    const c = code(rollback);
    expect(c).toBe(
      "BEGIN; SET LOCAL lock_timeout = '5s'; DROP VIEW IF EXISTS public.business_os_first_plan_payments; DROP INDEX IF EXISTS public.business_os_billing_events_paid_month_idx; DROP INDEX IF EXISTS public.business_os_billing_events_first_payment_idx; COMMIT;"
    );
  });

  it('is paste-safe', () => pasteSafe(rollback));
});

describe('20261099: the checker (M5F-C4)', () => {
  const c = code(checker);

  it('is read-only and one statement after the SET', () => {
    expect(c.startsWith('SET default_transaction_read_only = on;')).toBe(true);
    const rest = c.slice('SET default_transaction_read_only = on;'.length).trim();
    expect(rest.startsWith('WITH ')).toBe(true);
    expect((rest.match(/;/g) ?? []).length).toBe(1);
    expect(rest.endsWith(';')).toBe(true);
    expect(noStrings(checker)).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE|GRANT|REVOKE|EXPLAIN)\b/i);
  });

  it('reports C-1 to C-8, the base row count (M5F-C2) and all_ok', () => {
    for (const column of [
      'c1_view_exists',
      'c2_security_invoker',
      'c3_columns',
      'c4_privileges',
      'c5_indexes',
      'c6_equals_min',
      'c7_no_duplicates',
      'c8_base_unchanged',
      'base_rows',
      'differing_keys',
      'duplicate_keys',
      'all_ok',
    ]) {
      expect(c).toContain(column);
    }
    expect(c).toContain("= 'user_id uuid, livemode boolean, first_payment_at timestamp with time zone' AS c3_columns");
  });

  it('C-6 and C-7 run over the whole base table and return counts only (no id, no amount column in the output)', () => {
    expect(c).toContain('min(events.paid_at) AS first_at');
    expect(c).toContain('FULL OUTER JOIN view_first');
    expect(c).toContain('HAVING count(*) > 1');
    const output = c.slice(c.lastIndexOf('SELECT checks.'));
    expect(output).not.toMatch(/user_id|amount_minor|stripe_/);
  });

  it('is paste-safe', () => pasteSafe(checker));
});

describe('20261099: the EXPLAIN probe (M5F-C4, C-9)', () => {
  const c = code(probe);

  it('plans, never runs: EXPLAIN without ANALYZE, read-only, Q1 exact shape', () => {
    expect(c.startsWith('SET default_transaction_read_only = on;')).toBe(true);
    expect(c).toContain('EXPLAIN SELECT first_rows.user_id, first_rows.first_payment_at FROM public.business_os_first_plan_payments AS first_rows');
    expect(c).not.toMatch(/ANALYZE|BUFFERS/i);
    expect(c).toContain('ORDER BY first_rows.user_id ASC LIMIT 1000;');
    expect(probe).toContain('business_os_billing_events_paid_month_idx');
    expect(probe).toMatch(/not part of all_ok/);
  });

  it('is paste-safe', () => pasteSafe(probe));
});
