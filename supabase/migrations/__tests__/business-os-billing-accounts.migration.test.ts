/**
 * Guard over the Business OS billing record migration (plan payments P-2a;
 * workplan BUSINESS_OS_PLAN_PAYMENTS_P2_WORKPLAN.md §4, SA rulings Q-1, Q-2,
 * Q-7 and conditions P2-C1, P2-C2, P2-C6).
 *
 * WHY A TEST OVER SQL TEXT. There is no branch database and no local Postgres
 * here: the user pastes the pre-check, the migration (in a NEW tab, because
 * the pre-check turns the session read-only) and the checker into the Supabase
 * SQL editor by hand. What the files alone can prove is pinned here: the
 * paste-safety rules, the security shape (REVOKE ALL, no policy, no client
 * grant, no DELETE, column-level UPDATE on exactly 17 columns), the column set,
 * and that the pre-check, the checker and the rollback have not drifted from
 * the migration they belong to.
 *
 * The helpers are copied from the credit-lots test on purpose, rather than
 * imported across test files.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const MIGRATION = join(ROOT, 'supabase', 'migrations', '20261025_business_os_billing_accounts.sql');
const ROLLBACK = join(ROOT, 'supabase', 'SQL Scripts', '20261025_business_os_billing_accounts_rollback.sql');
const CHECKER = join(ROOT, 'scripts', 'check-bos-billing-accounts-migration.sql');
const PRECHECK = join(ROOT, 'scripts', 'precheck-bos-billing-accounts-migration.sql');
const REPOSITORY = join(ROOT, 'lib', 'repositories', 'BusinessOsBillingAccountRepository.ts');

const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const migration = read(MIGRATION);
const flat = migration.replace(/\s+/g, ' ');
const checker = read(CHECKER);
const checkerFlat = checker.replace(/\s+/g, ' ');
const precheck = read(PRECHECK);
const rollback = read(ROLLBACK);
const rollbackFlat = rollback.replace(/\s+/g, ' ').trim();

const TABLE = 'public.business_os_billing_accounts';
const PREFIX = 'business_os_billing_accounts_';

/** §4.1, as amended by SA Q-1: surrogate id PK, nullable user_id. */
const EXPECTED_COLUMNS: Array<[name: string, type: string, notNull: boolean, defaultExpr: string | null]> = [
  ['id', 'uuid', true, 'gen_random_uuid()'],
  ['user_id', 'uuid', false, null],
  ['livemode', 'boolean', true, null],
  ['stripe_customer_id', 'text', true, null],
  ['stripe_subscription_id', 'text', false, null],
  ['subscription_status', 'text', false, null],
  ['bought_tier', 'text', false, null],
  ['current_period_end', 'timestamptz', false, null],
  ['cancel_at_period_end', 'boolean', true, 'false'],
  ['pending_tier', 'text', false, null],
  ['open_checkout_session_id', 'text', false, null],
  ['open_checkout_expires_at', 'timestamptz', false, null],
  ['last_invoice_id', 'text', false, null],
  ['last_paid_at', 'timestamptz', false, null],
  ['last_payment_failed_at', 'timestamptz', false, null],
  ['failed_attempts', 'integer', true, '0'],
  ['action_required_invoice_url', 'text', false, null],
  ['founder_discount_applied_at', 'timestamptz', false, null],
  ['ended_at', 'timestamptz', false, null],
  ['created_at', 'timestamptz', true, 'now()'],
  ['updated_at', 'timestamptz', true, 'now()'],
];

/** SA Q-2 / P2-C1: never rewritable, so a row cannot move between accounts or modes. */
const IMMUTABLE = ['id', 'user_id', 'livemode', 'created_at'];

/** The ten CHECKs of §4.2, minus `_updated_after_created` (P2-C2), with their exact text. */
const EXPECTED_CHECKS: Record<string, string> = {
  [`${PREFIX}customer_id_shape`]: "CHECK (left(stripe_customer_id, 4) = ('cus' || chr(95)) AND char_length(stripe_customer_id) <= 255);",
  [`${PREFIX}subscription_id_shape`]:
    "CHECK (stripe_subscription_id IS NULL OR (left(stripe_subscription_id, 4) = ('sub' || chr(95)) AND char_length(stripe_subscription_id) <= 255));",
  [`${PREFIX}checkout_id_shape`]:
    "CHECK (open_checkout_session_id IS NULL OR (left(open_checkout_session_id, 3) = ('cs' || chr(95)) AND char_length(open_checkout_session_id) <= 255));",
  [`${PREFIX}invoice_id_shape`]: "CHECK (last_invoice_id IS NULL OR (left(last_invoice_id, 3) = ('in' || chr(95)) AND char_length(last_invoice_id) <= 255));",
  [`${PREFIX}status_known`]:
    "CHECK (subscription_status IS NULL OR subscription_status IN ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused'));",
  [`${PREFIX}status_needs_subscription`]: 'CHECK (subscription_status IS NULL OR stripe_subscription_id IS NOT NULL);',
  [`${PREFIX}tiers_length`]:
    'CHECK ((bought_tier IS NULL OR char_length(bought_tier) BETWEEN 1 AND 64) AND (pending_tier IS NULL OR char_length(pending_tier) BETWEEN 1 AND 64));',
  [`${PREFIX}checkout_lock_pair`]: 'CHECK ((open_checkout_session_id IS NULL) = (open_checkout_expires_at IS NULL));',
  [`${PREFIX}failed_attempts_not_negative`]: 'CHECK (failed_attempts >= 0);',
  [`${PREFIX}action_url_shape`]:
    "CHECK (action_required_invoice_url IS NULL OR (left(action_required_invoice_url, 8) = ('https' || chr(58) || chr(47) || chr(47)) AND char_length(action_required_invoice_url) <= 2048));",
};

/** The SQL with every string literal blanked, so keywords inside COMMENT text or checker labels do not count. */
function codeOnly(sql: string): string {
  return sql.replace(/'[^']*'/g, "''");
}

function literalsOf(sql: string): string[] {
  return [...sql.matchAll(/'([^']*)'/g)].map((match) => match[1]);
}

function tableBody(): string {
  const start = migration.indexOf(`CREATE TABLE ${TABLE} (`);
  expect(start).toBeGreaterThanOrEqual(0);
  return migration.slice(start, migration.indexOf('\n);\n', start) + 3);
}

function columnsOf(): string[] {
  return tableBody()
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => /^[a-z_]+ /.test(line) && !line.startsWith('CONSTRAINT'))
    .map((line) => line.split(' ')[0]);
}

function updateGrantColumns(): string[] {
  const match = flat.match(new RegExp(`GRANT UPDATE \\(([^)]*)\\) ON TABLE ${TABLE.replace('.', '\\.')} TO service_role;`));
  expect(match).not.toBeNull();
  return match ? match[1].split(',').map((column) => column.trim()) : [];
}

function migrationCheckNames(): string[] {
  return [...flat.matchAll(/ADD CONSTRAINT (\w+) CHECK/g)].map((match) => match[1]);
}

/** Every constraint and index name the migration creates, plus the table itself. */
function migrationObjectNames(): string[] {
  return [
    'business_os_billing_accounts',
    ...[...flat.matchAll(/CONSTRAINT (\w+) /g)].map((match) => match[1]),
    ...[...flat.matchAll(/CREATE INDEX (\w+) /g)].map((match) => match[1]),
  ];
}

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

  it.each(files)('%s holds only letters, digits, underscores and spaces inside string literals', (_name, file) => {
    for (const literal of literalsOf(read(file))) {
      expect({ literal, ok: /^[A-Za-z0-9_ ]*$/.test(literal) }).toEqual({ literal, ok: true });
    }
  });

  it.each(files)('%s uses no single-letter alias', (_name, file) => {
    expect(read(file)).not.toMatch(/\b(?:FROM|JOIN)\s+[\w.]+\s+(?:AS\s+)?[a-z]\b(?!\w)/i);
  });

  it.each(files)('%s names no agent-platform billing table', (_name, file) => {
    for (const table of ['user_subscriptions', 'billing_events', 'credit_transactions', 'subscription_invoices']) {
      expect(read(file)).not.toContain(table);
    }
  });

  it('the checker and the pre-check are read-only from their first statement', () => {
    expect(checker.startsWith('SET default_transaction_read_only = on;\n')).toBe(true);
    expect(precheck.startsWith('SET default_transaction_read_only = on;\n')).toBe(true);
    for (const text of [codeOnly(checker), codeOnly(precheck)]) {
      expect(text).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|GRANT|REVOKE|TRUNCATE)\s/);
      expect(text).not.toMatch(/\bDO\s+\$/);
    }
  });

  // The Supabase SQL editor misreads the word "into" even inside a string
  // literal: "paste the migration into a NEW tab" failed with
  // relation "a" does not exist (2026-10-04). No pasted file may contain it.
  it.each(files)('%s never contains the word "into" (the SQL editor misreads it)', (_name, file) => {
    expect(read(file)).not.toMatch(/\binto\b/i);
  });

  it('the pre-check tells the user to run the migration in a NEW tab (it leaves the session read-only)', () => {
    expect(precheck).toContain('run the migration in a NEW tab');
  });
});

describe('one migration, one table, one transaction, no DO block (SA Q-7)', () => {
  it('is wrapped in exactly one BEGIN … COMMIT with a lock timeout, plain CREATE (a second paste fails and changes nothing)', () => {
    expect(flat.trim().startsWith("BEGIN; SET LOCAL lock_timeout = '5s';")).toBe(true);
    expect(flat.trim().endsWith('COMMIT;')).toBe(true);
    expect(flat.match(/\bBEGIN;/g)).toHaveLength(1);
    expect(flat.match(/\bCOMMIT;/g)).toHaveLength(1);
    expect(flat.match(/CREATE TABLE/g)).toHaveLength(1);
    expect(flat).not.toMatch(/IF NOT EXISTS/i);
    expect(flat).not.toMatch(/OR REPLACE/i);
    expect(flat).not.toMatch(/\bDO\s+\$/);
    expect(flat).not.toMatch(/\$\w*\$/);
  });

  it('creates no function, no trigger, no policy and nothing SECURITY DEFINER', () => {
    expect(flat).not.toMatch(/CREATE FUNCTION/i);
    expect(codeOnly(flat)).not.toMatch(/\bTRIGGER\b/i);
    expect(flat).not.toMatch(/CREATE POLICY/i);
    expect(flat).not.toMatch(/SECURITY DEFINER/i);
  });

  it('touches nothing but its own table and holds no data', () => {
    expect(flat.replace(/ON DELETE SET NULL/g, '')).not.toMatch(/\b(DROP|TRUNCATE|DELETE)\b/);
    expect(flat).not.toMatch(/INSERT INTO/);
    expect(flat).not.toMatch(/\bUPDATE\b(?! \()/);
    for (const alter of flat.match(/ALTER TABLE [\w.]+/g) ?? []) {
      expect(alter).toBe(`ALTER TABLE ${TABLE}`);
    }
  });
});

describe('the table (SA-P1 as amended by Q-1, §4.1)', () => {
  it('has exactly the 21 columns, in order', () => {
    expect(columnsOf()).toEqual(EXPECTED_COLUMNS.map(([name]) => name));
  });

  it.each(EXPECTED_COLUMNS)('%s is %s, not null %s, default %s', (name, type, notNull, defaultExpr) => {
    const line = `  ${name} ${type}${notNull ? ' NOT NULL' : ''}${defaultExpr ? ` DEFAULT ${defaultExpr}` : ''},\n`;
    expect(tableBody()).toContain(line);
  });

  it('Q-1: surrogate id primary key; user_id nullable; no NULLS NOT DISTINCT (detached rows must not collide)', () => {
    expect(tableBody()).toContain(`CONSTRAINT ${PREFIX}pkey PRIMARY KEY (id)`);
    expect(flat).toContain(`ALTER TABLE ${TABLE} ADD CONSTRAINT ${PREFIX}user_mode_key UNIQUE (user_id, livemode);`);
    expect(flat).not.toMatch(/NULLS NOT DISTINCT/i);
    expect(flat).not.toMatch(/PRIMARY KEY \(user_id/);
  });

  it('stripe_customer_id and stripe_subscription_id are each UNIQUE; exactly three UNIQUE constraints', () => {
    expect(flat).toContain(`ALTER TABLE ${TABLE} ADD CONSTRAINT ${PREFIX}stripe_customer_id_key UNIQUE (stripe_customer_id);`);
    expect(flat).toContain(`ALTER TABLE ${TABLE} ADD CONSTRAINT ${PREFIX}stripe_subscription_id_key UNIQUE (stripe_subscription_id);`);
    expect(flat.match(/ UNIQUE \(/g)).toHaveLength(3);
    expect(flat).not.toMatch(/CREATE UNIQUE INDEX/i);
  });

  it('user_id → auth.users ON DELETE SET NULL; the only foreign key', () => {
    expect(flat).toContain(
      `ALTER TABLE ${TABLE} ADD CONSTRAINT ${PREFIX}user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE SET NULL;`
    );
    expect(flat.match(/FOREIGN KEY/g)).toHaveLength(1);
  });

  it('exactly the ten named CHECKs, each with its specified text; no updated_after_created (P2-C2)', () => {
    expect(migrationCheckNames()).toEqual(Object.keys(EXPECTED_CHECKS));
    for (const [name, text] of Object.entries(EXPECTED_CHECKS)) {
      const match = flat.match(new RegExp(`ADD CONSTRAINT ${name} CHECK [^;]*;`));
      expect(match?.[0]).toBe(`ADD CONSTRAINT ${name} ${text}`);
    }
    expect(migration).not.toContain('updated_after_created');
  });

  it('no CHECK names user_id, so ON DELETE SET NULL can never violate one', () => {
    for (const text of Object.values(EXPECTED_CHECKS)) expect(text).not.toContain('user_id');
  });

  it('the shape prefix lengths match the prefixes', () => {
    expect('cus_'.length).toBe(4);
    expect('sub_'.length).toBe(4);
    expect('cs_'.length).toBe(3);
    expect('in_'.length).toBe(3);
    expect('https://'.length).toBe(8);
  });

  it('the statuses equal the repository statuses', () => {
    const repository = read(REPOSITORY);
    const statuses = EXPECTED_CHECKS[`${PREFIX}status_known`].match(/IN \(([^)]*)\)/)?.[1].split(', ').map((value) => value.replace(/'/g, ''));
    const block = repository.slice(repository.indexOf('const SUBSCRIPTION_STATUSES'), repository.indexOf('];', repository.indexOf('const SUBSCRIPTION_STATUSES')));
    expect([...block.matchAll(/'(\w+)'/g)].map((match) => match[1])).toEqual(statuses);
  });

  it('the one index (livemode, subscription_status)', () => {
    expect(flat).toContain(`CREATE INDEX ${PREFIX}mode_status_idx ON ${TABLE} (livemode, subscription_status);`);
    expect(flat.match(/CREATE INDEX/g)).toHaveLength(1);
  });

  it('the repository selects exactly the migration columns, in order', () => {
    const repository = read(REPOSITORY);
    const match = repository.replace(/\s+/g, ' ').match(/export const BILLING_ACCOUNT_COLUMNS = '([^']*)';/);
    expect(match?.[1].split(', ')).toEqual(columnsOf());
  });
});

describe('RLS and grants (server-write-only, SA-P1, Q-2, P2-C1)', () => {
  it('RLS on, and no policy (no client role may read)', () => {
    expect(flat).toContain(`ALTER TABLE ${TABLE} ENABLE ROW LEVEL SECURITY;`);
    expect(flat).not.toMatch(/POLICY/);
  });

  it('REVOKE ALL from PUBLIC, anon, authenticated and service_role, as four statements; never an enumerated REVOKE', () => {
    for (const role of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
      expect(flat).toContain(`REVOKE ALL ON TABLE ${TABLE} FROM ${role};`);
    }
    expect(flat.match(/REVOKE /g)).toHaveLength(4);
    expect(flat).not.toMatch(/REVOKE (?!ALL ON)/);
  });

  it('every REVOKE comes before every GRANT', () => {
    expect(flat.lastIndexOf('REVOKE ')).toBeLessThan(flat.indexOf('GRANT '));
  });

  it('service_role: table-level SELECT and INSERT only; no DELETE, no table-level UPDATE', () => {
    expect(flat).toContain(`GRANT SELECT, INSERT ON TABLE ${TABLE} TO service_role;`);
    expect(flat.match(/GRANT /g)).toHaveLength(2);
    expect(flat).not.toMatch(/GRANT [^;]*DELETE/);
    expect(flat).not.toMatch(/GRANT [^;(]*UPDATE ON/);
  });

  it('no grant of any kind to PUBLIC, anon or authenticated', () => {
    expect(flat).not.toMatch(/GRANT [^;]* TO (PUBLIC|anon|authenticated)/);
  });

  it('column-level UPDATE on exactly the 17 mutable columns, stripe_customer_id included (P2-C1)', () => {
    const granted = updateGrantColumns();
    expect(granted).toHaveLength(17);
    expect(new Set(granted).size).toBe(17);
    expect(granted).toContain('stripe_customer_id');
    expect(granted.sort()).toEqual(columnsOf().filter((column) => !IMMUTABLE.includes(column)).sort());
    for (const column of IMMUTABLE) expect(granted).not.toContain(column);
  });
});

describe('the checker has not drifted from the migration (B1 to B10)', () => {
  it('reports B1 to B10 with a VERDICT row', () => {
    for (const check of ['B1 ', 'B2 ', 'B3 ', 'B4 ', 'B5 ', 'B6 ', 'B7 ', 'B8 ', 'B9 ', 'B10 ']) {
      expect(checker).toContain(`'${check}`);
    }
    expect(checker).toContain("'VERDICT'");
    expect(checkerFlat).toContain("CASE WHEN EXISTS (SELECT 1 FROM checks WHERE checks.status = 'FAIL') THEN 'FAIL' ELSE 'PASS' END");
  });

  it('B2 expects the migration columns, types and nullability, in order', () => {
    const typeName: Record<string, string> = { timestamptz: 'timestamp with time zone' };
    const expected = EXPECTED_COLUMNS.map(([name, type, notNull]) => `${name} ${typeName[type] ?? type} ${notNull ? 'notnull' : 'null'}`).join(' ');
    expect(checker).toContain(`column_shape.signature = '${expected}'`);
    expect(checker).toContain(`'B2 columns types and nullability are the ${EXPECTED_COLUMNS.length} of the migration in order'`);
    expect(checkerFlat).toContain(`(SELECT count(*) FROM billing_columns) = ${EXPECTED_COLUMNS.length}`);
  });

  it('B2 checks the five defaults', () => {
    expect(EXPECTED_COLUMNS.filter(([, , , defaultExpr]) => defaultExpr !== null)).toHaveLength(5);
    expect(checkerFlat).toContain('column_shape.defaults_total = 5');
  });

  it('B3 names exactly the migration CHECKs and counts 10 checks and 15 constraints', () => {
    const names = Object.keys(EXPECTED_CHECKS);
    for (const name of names) expect(checker.match(new RegExp(`'${name}'`, 'g'))).toHaveLength(2);
    expect(checker).not.toContain('updated_after_created');
    expect(checkerFlat).toContain('constraint_summary.named_checks = 10 AND constraint_summary.checks_total = 10 AND constraint_summary.total = 15');
    const allConstraints = [...flat.matchAll(/CONSTRAINT (\w+) /g)].map((match) => match[1]);
    expect(allConstraints).toHaveLength(15);
  });

  it('B3 checks the FK action is SET NULL (confdeltype n) and targets auth users', () => {
    expect(checkerFlat).toContain("constraint_columns.delete_action = 'n'");
    expect(checkerFlat).toContain("pg_namespace.nspname = 'auth' AND pg_class.relname = 'users'");
    expect(checkerFlat).toContain("constraint_columns.column_list = 'user_id livemode'");
  });

  it('B7 expects exactly the migration UPDATE grant, sorted, and B7 also proves the four immutable columns', () => {
    expect(checker).toContain(`service_columns.update_listing = '${[...updateGrantColumns()].sort().join(' ')}'`);
    expect(checkerFlat).toContain("billing_columns.column_name IN ('id', 'user_id', 'livemode', 'created_at')");
  });

  it('B8 covers MAINTAIN (PG17) with DELETE, TRUNCATE, REFERENCES and TRIGGER', () => {
    expect(checkerFlat).toContain("('UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')");
  });

  it('B6 expects exactly INSERT SELECT for service_role', () => {
    expect(checkerFlat).toContain("service_table.listing = 'INSERT SELECT'");
  });
});

describe('the pre-check has not drifted from the migration', () => {
  it('lists exactly the table, constraint and index names the migration creates', () => {
    const block = precheck.slice(precheck.indexOf('unnest(ARRAY['), precheck.indexOf(']) AS planned'));
    const listed = [...block.matchAll(/'(\w+)'/g)].map((match) => match[1]);
    expect(listed.sort()).toEqual(migrationObjectNames().sort());
  });

  it('checks auth users, gen_random_uuid, the three roles and business_os_account_plans; reports MAINTAIN and default privileges', () => {
    for (const fragment of [
      "to_regclass('auth' || chr(46) || 'users')",
      "pg_proc.proname = 'gen_random_uuid'",
      "('anon', 'authenticated', 'service_role')",
      "'business_os_account_plans'",
      'MAINTAIN',
      'pg_default_acl',
    ]) {
      expect(precheck).toContain(fragment);
    }
  });
});

describe('the rollback (SA Q-7: the one DO block lives here)', () => {
  it('locks, refuses on any row, then drops the table, in one transaction', () => {
    expect(rollbackFlat).toBe(
      "BEGIN; SET LOCAL lock_timeout = '5s'; LOCK TABLE public.business_os_billing_accounts IN ACCESS EXCLUSIVE MODE; DO $refuse$ BEGIN IF EXISTS (SELECT 1 FROM public.business_os_billing_accounts AS billing_row) THEN RAISE EXCEPTION USING MESSAGE = 'ROLLBACK REFUSED the billing accounts table holds rows so nothing was dropped'; END IF; END $refuse$; DROP TABLE public.business_os_billing_accounts; COMMIT;"
    );
    expect(rollback).toContain("'ROLLBACK REFUSED  the billing accounts table holds rows so nothing was dropped'");
    expect(rollback.split('DO $refuse$')).toHaveLength(2);
    expect(rollback.match(/\bDO\b/g)).toHaveLength(1);
  });
});
