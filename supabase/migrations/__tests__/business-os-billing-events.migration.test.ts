/**
 * Guard over the Business OS money history migration and the plan payment
 * apply function (plan payments P-3b.1; workplan
 * BUSINESS_OS_PLAN_PAYMENTS_P3B_WORKPLAN.md §3.2, §4, §8 and the SA review's
 * rulings Q-7, Q-10, Q-11, Q-12 and conditions C-1 to C-5).
 *
 * WHY A TEST OVER SQL TEXT. Jest cannot run PL/pgSQL and there is no branch
 * database. The user pastes the pre-check, the migration (in a NEW tab: the
 * pre-check leaves the session read-only), the checker and the probe into the
 * Supabase SQL editor by hand. What the files alone can prove is pinned here:
 * the paste rules over all five files (C-5), the table and its append-only
 * grants, the function's contract, its step order, the conditions SA set on it
 * (C-1 detect a held subscription before any write, C-2 a known event id
 * returns early, C-3 bought tier only with the plan row, C-4 every relation
 * qualified with public), and that the checker, the pre-check, the probe and
 * the rollback have not drifted from the migration.
 *
 * The function itself was also executed, with the probe, against a local
 * PGlite (PostgreSQL 16) during development; that run is recorded in the
 * workplan. This suite is what keeps the text from drifting afterwards.
 *
 * Helpers are copied from the billing accounts and boost crediting tests on
 * purpose, rather than imported across test files.
 */

import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const MIGRATION = join(ROOT, 'supabase', 'migrations', '20261027_business_os_billing_events.sql');
const ROLLBACK = join(ROOT, 'supabase', 'SQL Scripts', '20261027_business_os_billing_events_rollback.sql');
const CHECKER = join(ROOT, 'scripts', 'check-bos-billing-events-migration.sql');
const PRECHECK = join(ROOT, 'scripts', 'precheck-bos-billing-events-migration.sql');
const PROBE = join(ROOT, 'scripts', 'probe-bos-apply-plan-payment.sql');
const REPOSITORY = join(ROOT, 'lib', 'repositories', 'BusinessOsBillingEventRepository.ts');

const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const migration = read(MIGRATION);
const flat = migration.replace(/\s+/g, ' ');
const checker = read(CHECKER);
const checkerFlat = checker.replace(/\s+/g, ' ');
const precheck = read(PRECHECK);
const probe = read(PROBE);
const rollbackFlat = read(ROLLBACK).replace(/\s+/g, ' ').trim();

const TABLE = 'public.business_os_billing_events';
const PREFIX = 'business_os_billing_events_';
const FUNCTION = 'business_os_apply_plan_payment';
const TAG = 'apply_plan_payment';
const SIGNATURE =
  'uuid, boolean, text, text, text, text, text, text, integer, boolean, integer, integer, text, timestamptz, timestamptz, timestamptz, timestamptz, text';

/** §4.1 plus the four columns SA approved in Q-10 (stripe_customer_id, plan_written, refusal_reason, paid_at). */
const EXPECTED_COLUMNS: Array<[name: string, type: string, notNull: boolean, defaultExpr: string | null]> = [
  ['id', 'uuid', true, 'gen_random_uuid()'],
  ['user_id', 'uuid', false, null],
  ['livemode', 'boolean', true, null],
  ['kind', 'text', true, null],
  ['stripe_event_id', 'text', false, null],
  ['stripe_invoice_id', 'text', false, null],
  ['stripe_subscription_id', 'text', false, null],
  ['stripe_customer_id', 'text', false, null],
  ['tier', 'text', false, null],
  ['plan_written', 'boolean', true, 'false'],
  ['refusal_reason', 'text', false, null],
  ['amount_minor', 'integer', false, null],
  ['amount_tax_minor', 'integer', false, null],
  ['currency', 'text', false, null],
  ['period_start', 'timestamptz', false, null],
  ['period_end', 'timestamptz', false, null],
  ['paid_at', 'timestamptz', false, null],
  ['created_at', 'timestamptz', true, 'now()'],
];

/** SA-P5: the full v1 set of kinds, from day one. */
const KINDS = [
  'invoice_paid',
  'invoice_payment_failed',
  'payment_action_required',
  'subscription_updated',
  'subscription_ended',
  'refunded',
  'dispute_opened',
  'dispute_closed',
  'mismatch_refused',
];

const EXPECTED_CHECKS: Record<string, string> = {
  [`${PREFIX}kind_known`]: `CHECK (kind IN (${KINDS.map((kind) => `'${kind}'`).join(', ')}));`,
  [`${PREFIX}event_id_shape`]:
    "CHECK (stripe_event_id IS NULL OR (left(stripe_event_id, 4) = ('evt' || chr(95)) AND char_length(stripe_event_id) <= 255));",
  [`${PREFIX}invoice_id_shape`]:
    "CHECK (stripe_invoice_id IS NULL OR (left(stripe_invoice_id, 3) = ('in' || chr(95)) AND char_length(stripe_invoice_id) <= 255));",
  [`${PREFIX}subscription_id_shape`]:
    "CHECK (stripe_subscription_id IS NULL OR (left(stripe_subscription_id, 4) = ('sub' || chr(95)) AND char_length(stripe_subscription_id) <= 255));",
  [`${PREFIX}customer_id_shape`]:
    "CHECK (stripe_customer_id IS NULL OR (left(stripe_customer_id, 4) = ('cus' || chr(95)) AND char_length(stripe_customer_id) <= 255));",
  [`${PREFIX}tier_length`]: 'CHECK (tier IS NULL OR char_length(tier) BETWEEN 1 AND 64);',
  [`${PREFIX}refusal_reason_pair`]: "CHECK ((kind = 'mismatch_refused') = (refusal_reason IS NOT NULL));",
  [`${PREFIX}refusal_reason_length`]: 'CHECK (refusal_reason IS NULL OR char_length(refusal_reason) BETWEEN 1 AND 64);',
  [`${PREFIX}plan_written_needs_payment`]: "CHECK (NOT plan_written OR kind = 'invoice_paid');",
  [`${PREFIX}amounts_not_negative`]: 'CHECK ((amount_minor IS NULL OR amount_minor >= 0) AND (amount_tax_minor IS NULL OR amount_tax_minor >= 0));',
  [`${PREFIX}currency_usd`]: "CHECK (currency IS NULL OR currency = 'usd');",
  [`${PREFIX}period_order`]: 'CHECK (period_start IS NULL OR period_end IS NULL OR period_end > period_start);',
};

const PARAMETERS = [
  'p_user_id',
  'p_livemode',
  'p_stripe_customer_id',
  'p_stripe_subscription_id',
  'p_replaces_subscription_id',
  'p_stripe_event_id',
  'p_stripe_invoice_id',
  'p_tier',
  'p_plan_version',
  'p_assigns_plan',
  'p_amount_minor',
  'p_amount_tax_minor',
  'p_currency',
  'p_period_start',
  'p_period_end',
  'p_paid_at',
  'p_billing_cycle_anchor',
  'p_subscription_status',
];
const OUTPUTS = ['out_status', 'out_event_row_id', 'out_tier_before', 'out_tier_after', 'out_plan_written', 'out_anchor_set'];

/** The SQL with every string literal blanked, so words inside messages and labels do not count as code. */
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

function functionBody(sql: string): string {
  const open = `AS $${TAG}$`;
  const start = sql.indexOf(open);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf(`$${TAG}$;`, start + open.length);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start + open.length, end);
}

function functionHead(): string {
  const start = migration.indexOf(`CREATE FUNCTION public.${FUNCTION}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  return migration.slice(start, migration.indexOf(`AS $${TAG}$`, start));
}

/** Index of `needle` in `text`, asserting it is present. */
function at(text: string, needle: string, from = 0): number {
  const index = text.indexOf(needle, from);
  expect({ needle, found: index >= 0 }).toEqual({ needle, found: true });
  return index;
}

const body = functionBody(migration);
const bodyCode = codeOnly(body);

/** Every object name the migration creates: the table, its constraints and its indexes. */
function migrationObjectNames(): string[] {
  return [
    'business_os_billing_events',
    ...[...flat.matchAll(/CONSTRAINT (\w+) /g)].map((match) => match[1]),
    ...[...flat.matchAll(/CREATE (?:UNIQUE )?INDEX (\w+) /g)].map((match) => match[1]),
  ];
}

describe('C-5: SQL-editor safety over all five pasted files', () => {
  const files: Array<[string, string]> = [
    ['migration', MIGRATION],
    ['rollback', ROLLBACK],
    ['checker', CHECKER],
    ['pre-check', PRECHECK],
    ['probe', PROBE],
  ];

  it.each(files)('%s exists', (_name, file) => {
    expect(existsSync(file)).toBe(true);
  });

  it.each(files)('%s has no line comment and no block comment', (_name, file) => {
    const text = read(file);
    expect(text).not.toContain('--');
    expect(text).not.toContain('/*');
  });

  it.each(files)('%s holds only letters, digits, underscores and spaces inside string literals (RAISE and COMMENT ON included)', (_name, file) => {
    for (const literal of literalsOf(read(file))) {
      expect({ literal, ok: /^[A-Za-z0-9_ ]*$/.test(literal) }).toEqual({ literal, ok: true });
    }
  });

  // The Supabase SQL editor misreads the word "into" (2026-10-04: "paste the
  // migration into a NEW tab" failed with relation "a" does not exist). Q-12
  // allows it as a keyword only; this suite allows exactly INSERT INTO, so no
  // SELECT ... INTO and no RETURNING ... INTO either (variables use :=).
  it.each(files)('%s uses the word "into" only as the INSERT INTO keyword (Q-12)', (_name, file) => {
    const text = read(file);
    for (const literal of literalsOf(text)) expect(literal).not.toMatch(/\binto\b/i);
    const uses = [...text.matchAll(/\binto\b/gi)].map((match) => text.slice(Math.max(0, match.index! - 7), match.index! + 4));
    for (const use of uses) expect(use).toBe('INSERT INTO');
  });

  it.each(files)('%s uses no single-letter alias', (_name, file) => {
    expect(read(file)).not.toMatch(/\b(?:FROM|JOIN)\s+[\w.]+\s+(?:AS\s+)?[a-z]\b(?!\w)/i);
  });

  it.each(files)('%s names no agent-platform billing table (the bare billing_events included)', (_name, file) => {
    const text = read(file);
    for (const table of ['user_subscriptions', 'credit_transactions', 'subscription_invoices', 'token_usage', 'boost_pack_purchases']) {
      expect(text).not.toContain(table);
    }
    expect(text).not.toMatch(/(?<!business_os_)\bbilling_events\b/);
  });

  it.each(files)('%s never writes auth.users', (_name, file) => {
    expect(read(file)).not.toMatch(/\b(?:INSERT\s+INTO|DELETE\s+FROM|UPDATE|TRUNCATE)\s+auth\.users\b/i);
  });

  it('prefixes are spelled with chr(95), never as an underscore inside a literal', () => {
    for (const text of [migration, probe, checker, precheck]) {
      expect(text).not.toMatch(/'(?:cus|sub|in|evt|cs)_/);
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

  it('the pre-check tells the user to run the migration in a NEW tab only on PASS, and not to run it on FAIL (QA note)', () => {
    expect(precheck.replace(/\s+/g, ' ')).toContain(
      "CASE WHEN EXISTS (SELECT 1 FROM checks WHERE checks.status = 'FAIL') THEN 'do not run the migration' ELSE 'run the migration in a NEW tab' END AS detail"
    );
    expect(precheck.match(/run the migration in a NEW tab/g)).toHaveLength(1);
  });
});

describe('one migration, one transaction, one table, one function, no DO block', () => {
  it('is wrapped in exactly one BEGIN … COMMIT with a lock timeout; plain CREATE (a second paste fails and changes nothing)', () => {
    expect(flat.trim().startsWith("BEGIN; SET LOCAL lock_timeout = '5s';")).toBe(true);
    expect(flat.trim().endsWith('COMMIT;')).toBe(true);
    expect(codeOnly(flat).match(/\bBEGIN;/g)).toHaveLength(1);
    expect(flat.match(/\bCOMMIT;/g)).toHaveLength(1);
    expect(flat.match(/CREATE TABLE/g)).toHaveLength(1);
    expect(flat.match(/CREATE FUNCTION/g)).toHaveLength(1);
    expect(flat).not.toMatch(/IF NOT EXISTS|OR REPLACE|SECURITY DEFINER|CREATE POLICY|\bDO\s+\$/i);
    expect(codeOnly(flat).replace(/ON DELETE SET NULL/g, '')).not.toMatch(/\bTRIGGER\b|\bDROP\b|\bTRUNCATE\b|\bDELETE\b/);
  });

  it('alters only its own table, and the only DML is inside the function', () => {
    for (const alter of flat.match(/ALTER TABLE [\w.]+/g) ?? []) expect(alter).toBe(`ALTER TABLE ${TABLE}`);
    const outsideFunction = codeOnly(migration.replace(body, ''));
    expect(outsideFunction).not.toMatch(/INSERT INTO|\bUPDATE\s+public/);
  });

  it('never names the lineage table, so P-5 (20261028) can replace the function (workplan §4.2)', () => {
    expect(migration).not.toContain('business_os_account_lineage');
    expect(migration).not.toContain('first_paid_at');
  });
});

describe('the money history table (SA-P5 as amended by Q-10, §4.1)', () => {
  it('has exactly the 18 columns, in order', () => {
    expect(columnsOf()).toEqual(EXPECTED_COLUMNS.map(([name]) => name));
  });

  it.each(EXPECTED_COLUMNS)('%s is %s, not null %s, default %s', (name, type, notNull, defaultExpr) => {
    const line = `  ${name} ${type}${notNull ? ' NOT NULL' : ''}${defaultExpr ? ` DEFAULT ${defaultExpr}` : ''},\n`;
    expect(tableBody()).toContain(line);
  });

  it('surrogate id primary key; the event id UNIQUE (Q-11); user_id to auth.users ON DELETE SET NULL, the only foreign key', () => {
    expect(tableBody()).toContain(`CONSTRAINT ${PREFIX}pkey PRIMARY KEY (id)`);
    expect(flat).toContain(`ALTER TABLE ${TABLE} ADD CONSTRAINT ${PREFIX}stripe_event_id_key UNIQUE (stripe_event_id);`);
    expect(flat.match(/ UNIQUE \(/g)).toHaveLength(1);
    expect(flat).toContain(
      `ALTER TABLE ${TABLE} ADD CONSTRAINT ${PREFIX}user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE SET NULL;`
    );
    expect(flat.match(/FOREIGN KEY/g)).toHaveLength(1);
  });

  it('exactly the twelve named CHECKs, each with its specified text', () => {
    expect([...flat.matchAll(/ADD CONSTRAINT (\w+) CHECK/g)].map((match) => match[1])).toEqual(Object.keys(EXPECTED_CHECKS));
    for (const [name, text] of Object.entries(EXPECTED_CHECKS)) {
      const match = flat.match(new RegExp(`ADD CONSTRAINT ${name} CHECK [^;]*;`));
      expect(match?.[0]).toBe(`ADD CONSTRAINT ${name} ${text}`);
    }
  });

  it('no CHECK names user_id, so ON DELETE SET NULL can never violate one', () => {
    for (const text of Object.values(EXPECTED_CHECKS)) expect(text).not.toContain('user_id');
  });

  it('Q-11: the partial UNIQUE index on the paid invoice id, and the two other indexes', () => {
    expect(flat).toContain(`CREATE UNIQUE INDEX ${PREFIX}invoice_paid_key ON ${TABLE} (stripe_invoice_id) WHERE kind = 'invoice_paid';`);
    expect(flat).toContain(`CREATE INDEX ${PREFIX}user_created_idx ON ${TABLE} (user_id, created_at DESC);`);
    expect(flat).toContain(`CREATE INDEX ${PREFIX}plan_written_idx ON ${TABLE} (stripe_subscription_id) WHERE kind = 'invoice_paid' AND plan_written;`);
    expect(flat.match(/CREATE (?:UNIQUE )?INDEX/g)).toHaveLength(3);
  });

  it('the repository selects exactly the migration columns, in order, and knows exactly the nine kinds', () => {
    const repository = read(REPOSITORY).replace(/\s+/g, ' ');
    const match = repository.match(/export const BILLING_EVENT_COLUMNS = '([^']*)';/);
    expect(match?.[1].split(', ')).toEqual(columnsOf());
    const kinds = repository.match(/export const BILLING_EVENT_KINDS = \[([^\]]*)\]/)?.[1];
    expect([...(kinds ?? '').matchAll(/'(\w+)'/g)].map((kind) => kind[1])).toEqual(KINDS);
  });
});

describe('RLS and grants: server-write-only and append-only (SA-P5)', () => {
  it('RLS on, and no policy', () => {
    expect(flat).toContain(`ALTER TABLE ${TABLE} ENABLE ROW LEVEL SECURITY;`);
    expect(flat).not.toMatch(/POLICY/);
  });

  it('REVOKE ALL on the table from PUBLIC, anon, authenticated and service_role, as four statements, before every table GRANT', () => {
    for (const role of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
      expect(flat).toContain(`REVOKE ALL ON TABLE ${TABLE} FROM ${role};`);
    }
    expect(flat.match(/REVOKE ALL ON TABLE/g)).toHaveLength(4);
    expect(flat.lastIndexOf('REVOKE ALL ON TABLE')).toBeLessThan(flat.indexOf('GRANT SELECT'));
  });

  it('service_role: SELECT and INSERT only; no UPDATE and no DELETE grant at all, table or column', () => {
    expect(flat).toContain(`GRANT SELECT, INSERT ON TABLE ${TABLE} TO service_role;`);
    expect(flat.match(/GRANT [^;]* ON TABLE/g)).toHaveLength(1);
    expect(flat).not.toMatch(/GRANT [^;]*(?:UPDATE|DELETE)/);
    expect(flat).not.toMatch(/GRANT [^;]* TO (PUBLIC|anon|authenticated)/);
  });

  it('the function: REVOKE ALL from the four roles, then EXECUTE for service_role only', () => {
    for (const role of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
      expect(flat).toContain(`REVOKE ALL ON FUNCTION public.${FUNCTION}(${SIGNATURE}) FROM ${role};`);
    }
    expect(flat).toContain(`GRANT EXECUTE ON FUNCTION public.${FUNCTION}(${SIGNATURE}) TO service_role;`);
    expect(flat.match(/\bGRANT\b/g)).toHaveLength(2);
    expect(flat.lastIndexOf('REVOKE ALL ON FUNCTION')).toBeLessThan(flat.indexOf('GRANT EXECUTE'));
  });
});

describe('the apply function contract (§3.2)', () => {
  it('takes the eighteen parameters in order and returns the six outputs', () => {
    const head = functionHead().replace(/\s+/g, ' ');
    const params = [...head.matchAll(/(p_\w+) (\w+)/g)].map((match) => match[1]);
    expect(params).toEqual(PARAMETERS);
    const types = [...head.matchAll(/p_\w+ (\w+)/g)].map((match) => match[1]).join(', ');
    expect(types).toBe(SIGNATURE);
    expect(head).toContain(
      `RETURNS TABLE (${OUTPUTS.map((name, index) => `${name} ${['text', 'uuid', 'text', 'text', 'boolean', 'boolean'][index]}`).join(', ')})`
    );
  });

  it("is plpgsql, VOLATILE, SECURITY INVOKER with an empty search_path", () => {
    expect(functionHead().replace(/\s+/g, ' ')).toContain("LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = ''");
  });

  it('C-4: every relation in the body is public-qualified', () => {
    const references = [...bodyCode.matchAll(/\b(?<!DISTINCT )(?:FROM|JOIN|UPDATE|INSERT INTO)\s+([A-Za-z_][\w.]*)/g)].map((match) => match[1]);
    expect(references.length).toBeGreaterThanOrEqual(15);
    for (const reference of references) expect(reference).toMatch(/^public\.business_os_(billing_accounts|account_plans|billing_events)$/);
  });

  it('names only the three tables of the contract', () => {
    const tables = new Set([...body.matchAll(/public\.(\w+)/g)].map((match) => match[1]));
    expect([...tables].sort()).toEqual(['business_os_account_plans', 'business_os_billing_accounts', 'business_os_billing_events']);
  });

  it('runs its steps in order: arguments, billing lock, customer, idempotency, identity, held elsewhere, plan lock, newest, anchor, history row, plan, billing', () => {
    const order = [
      at(body, "USING ERRCODE = '22004'"),
      at(body, "USING ERRCODE = '22023'"),
      at(body, 'FROM public.business_os_billing_accounts AS billing_row'),
      at(body, 'FOR UPDATE;'),
      at(body, "out_status := 'billing_row_missing'"),
      at(body, "out_status := 'customer_mismatch'"),
      at(body, "out_status := 'already_applied'"),
      at(body, "out_status := 'already_recorded'"),
      at(body, "v_refusal := 'second_subscription'"),
      at(body, "v_refusal := 'subscription_held_elsewhere'"),
      at(body, "out_status := 'subscription_conflict'"),
      at(body, 'FROM public.business_os_account_plans AS plan_row'),
      at(body, "out_status := 'plan_row_missing'"),
      at(body, 'v_newest := '),
      at(body, 'v_plan_written := p_assigns_plan AND v_newest;'),
      at(body, 'v_anchor_set := '),
      at(body, "VALUES (v_row_id, p_user_id, p_livemode, 'invoice_paid'"),
      at(body, 'UPDATE public.business_os_account_plans AS plan_row'),
      at(body, 'UPDATE public.business_os_billing_accounts AS billing_row'),
      at(body, "out_status := (CASE WHEN v_plan_written THEN 'applied' ELSE 'recorded' END);"),
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('answers exactly the nine statuses', () => {
    const statuses = new Set([...body.matchAll(/out_status := '(\w+)'/g)].map((match) => match[1]));
    statuses.add('applied');
    statuses.add('recorded');
    expect([...statuses].sort()).toEqual(
      ['already_applied', 'already_recorded', 'applied', 'billing_row_missing', 'customer_mismatch', 'plan_row_missing', 'recorded', 'subscription_conflict'].sort()
    );
  });

  it('the only RAISEs are the two argument errors; every refusal returns normally', () => {
    const raises = [...body.matchAll(/RAISE EXCEPTION '[^']*' USING ERRCODE = '(\w+)'/g)].map((match) => match[1]);
    expect(raises).toEqual(['22004', '22023']);
    expect(body.match(/RAISE/g)).toHaveLength(2);
    expect(body).not.toMatch(/EXCEPTION WHEN/);
  });

  it('checks every argument shape: prefixes, lengths, amounts, period order, usd only, known status', () => {
    for (const fragment of [
      "left(p_stripe_customer_id, 4) <> ('cus' || chr(95))",
      "left(p_stripe_subscription_id, 4) <> ('sub' || chr(95))",
      "left(p_replaces_subscription_id, 4) <> ('sub' || chr(95))",
      'p_replaces_subscription_id = p_stripe_subscription_id',
      "left(p_stripe_event_id, 4) <> ('evt' || chr(95))",
      "left(p_stripe_invoice_id, 3) <> ('in' || chr(95))",
      'char_length(p_tier) NOT BETWEEN 1 AND 64',
      'p_plan_version < 1',
      'p_amount_minor < 0 OR p_amount_tax_minor < 0',
      "p_currency <> 'usd'",
      'p_period_end <= p_period_start',
      "p_subscription_status NOT IN ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused')",
    ]) {
      expect(body).toContain(fragment);
    }
    // The event id may be NULL (P-8b's reconciler has none); nothing else but the replaced subscription may.
    const nullCheck = body.slice(0, body.indexOf("USING ERRCODE = '22004'"));
    for (const parameter of PARAMETERS.filter((name) => !['p_replaces_subscription_id', 'p_stripe_event_id'].includes(name))) {
      expect(nullCheck).toContain(`${parameter} IS NULL`);
    }
    expect(nullCheck).not.toContain('p_stripe_event_id IS NULL');
  });

  it('locks the billing row by user_id and livemode, and the plan row by user_id (tenant isolation)', () => {
    expect(body).toContain('WHERE billing_row.user_id = p_user_id\n    AND billing_row.livemode = p_livemode\n  FOR UPDATE;');
    expect(body).toContain('WHERE plan_row.user_id = p_user_id\n  FOR UPDATE;');
    expect(body).toContain('WHERE plan_row.user_id = p_user_id;');
    expect(body).toContain('WHERE billing_row.id = v_billing_id;');
  });
});

describe("SA's conditions on the function", () => {
  const firstWrite = Math.min(body.indexOf('INSERT INTO'), body.indexOf('UPDATE public'));

  it('C-2: a known invoice returns already_applied, and a known event id returns already_recorded, before any write', () => {
    expect(body).toContain(
      "v_existing_id := (SELECT event_row.id FROM public.business_os_billing_events AS event_row WHERE event_row.kind = 'invoice_paid' AND event_row.stripe_invoice_id = p_stripe_invoice_id);"
    );
    expect(body).toContain(
      'v_existing_id := (SELECT event_row.id FROM public.business_os_billing_events AS event_row WHERE event_row.stripe_event_id = p_stripe_event_id);'
    );
    expect(body.indexOf("out_status := 'already_recorded'")).toBeLessThan(firstWrite);
  });

  it('C-1: a subscription held by another billing row is found by a SELECT before any write, and refused with no plan or billing write', () => {
    const check = at(body, 'WHERE other_row.stripe_subscription_id = p_stripe_subscription_id\n      AND other_row.id <> v_billing_id');
    expect(check).toBeLessThan(firstWrite);
    const refusal = body.slice(body.indexOf('IF v_refusal IS NOT NULL THEN'), body.indexOf("out_status := 'subscription_conflict'"));
    expect(refusal).toContain("'mismatch_refused'");
    expect(refusal).toContain('ON CONFLICT (stripe_event_id) DO NOTHING;');
    expect(refusal).not.toMatch(/UPDATE public/);
    expect(body.slice(body.indexOf("out_status := 'subscription_conflict'"), body.indexOf("out_status := 'subscription_conflict'") + 200)).toContain('RETURN;');
  });

  it('C-3: bought_tier is written only together with the plan row', () => {
    expect(body).toContain('bought_tier = (CASE WHEN v_plan_written THEN p_tier ELSE billing_row.bought_tier END),');
    expect(body.match(/bought_tier = /g)).toHaveLength(1);
  });

  it('Q-7: tier_expires_at is the period end verbatim, never GREATEST, and only when the plan is written', () => {
    expect(migration).not.toMatch(/GREATEST/i);
    const planUpdate = body.slice(body.indexOf('IF v_plan_written THEN'), body.indexOf('END IF;', body.indexOf('IF v_plan_written THEN')));
    expect(planUpdate).toContain('tier_expires_at = p_period_end,');
    expect(planUpdate).toContain('updated_by_admin_id = NULL,');
    expect(planUpdate).toContain('period_anchor = (CASE WHEN v_anchor_set THEN p_billing_cycle_anchor ELSE plan_row.period_anchor END),');
    expect(planUpdate).toContain(
      'plan_version = (CASE WHEN v_tier_before IS DISTINCT FROM p_tier OR NOT v_tier_in_force THEN p_plan_version ELSE plan_row.plan_version END),'
    );
  });

  it('SA-P16d: the cohort is never written', () => {
    expect(bodyCode).not.toMatch(/\bcohort\s*=/);
  });

  it('Q-7 / step 6: "newest" is ordered by the billing row (Stripe facts), never by the plan row', () => {
    const newest = body.slice(body.indexOf('v_newest := '), body.indexOf('v_plan_written := '));
    expect(newest.replace(/\s+/g, ' ')).toBe(
      'v_newest := v_replacement OR v_current_period_end IS NULL OR p_period_end > v_current_period_end OR (p_period_end = v_current_period_end AND (v_last_paid_at IS NULL OR p_paid_at >= v_last_paid_at)); '
    );
    expect(body).toContain('v_current_period_end := (SELECT billing_row.current_period_end');
    expect(body).toContain('v_last_paid_at := (SELECT billing_row.last_paid_at');
  });

  it('SA-P2 / step 7: the anchor moves only on the first plan-writing invoice of a subscription new to the account', () => {
    const anchor = body.slice(body.indexOf('v_anchor_set := '), body.indexOf('v_row_id := gen_random_uuid();', body.indexOf('v_anchor_set := ')));
    for (const fragment of [
      'v_plan_written AND NOT EXISTS (',
      'event_row.user_id = p_user_id',
      "event_row.kind = 'invoice_paid'",
      'event_row.stripe_subscription_id = p_stripe_subscription_id',
      'event_row.plan_written',
    ]) {
      expect(anchor).toContain(fragment);
    }
  });

  it('the billing row moves its paid-through facts only when newest; ended_at and the cancel flag clear only on a replacement (SA F-1)', () => {
    for (const fragment of [
      'current_period_end = (CASE WHEN v_newest THEN p_period_end ELSE billing_row.current_period_end END),',
      'last_invoice_id = (CASE WHEN v_newest THEN p_stripe_invoice_id ELSE billing_row.last_invoice_id END),',
      'last_paid_at = (CASE WHEN v_newest THEN p_paid_at ELSE billing_row.last_paid_at END),',
      'ended_at = (CASE WHEN v_replacement THEN NULL ELSE billing_row.ended_at END),',
      'cancel_at_period_end = (CASE WHEN v_replacement THEN false ELSE billing_row.cancel_at_period_end END),',
    ]) {
      expect(body).toContain(fragment);
    }
    expect(body.match(/cancel_at_period_end = /g)).toHaveLength(1);
    expect(body).not.toMatch(/failed_attempts|pending_tier|open_checkout/);
  });

  it('every refusal code fits the 64-character refusal_reason check', () => {
    for (const code of [...body.matchAll(/v_refusal := '(\w+)'/g)].map((match) => match[1])) {
      expect(code.length).toBeLessThanOrEqual(64);
    }
  });
});

describe('the checker has not drifted from the migration (B1 to B10)', () => {
  it('reports B1 to B10 with a VERDICT row', () => {
    for (const check of ['B1 ', 'B2 ', 'B3 ', 'B4 ', 'B5 ', 'B6 ', 'B7 ', 'B8 ', 'B9 ', 'B10 ']) expect(checker).toContain(`'${check}`);
    expect(checkerFlat).toContain("CASE WHEN EXISTS (SELECT 1 FROM checks WHERE checks.status = 'FAIL') THEN 'FAIL' ELSE 'PASS' END");
  });

  it('B2 expects the migration columns, types and nullability, in order', () => {
    const typeName: Record<string, string> = { timestamptz: 'timestamp with time zone' };
    const expected = EXPECTED_COLUMNS.map(([name, type, notNull]) => `${name} ${typeName[type] ?? type} ${notNull ? 'notnull' : 'null'}`).join(' ');
    expect(checker).toContain(`column_shape.signature = '${expected}'`);
    expect(checker).toContain(`'B2 columns types and nullability are the ${EXPECTED_COLUMNS.length} of the migration in order'`);
  });

  it('B3 names every CHECK of the migration and counts 12 checks and 15 constraints', () => {
    for (const name of Object.keys(EXPECTED_CHECKS)) expect(checker).toContain(`'${name}'`);
    expect(checkerFlat).toContain('constraint_summary.named_checks = 12 AND constraint_summary.checks_total = 12 AND constraint_summary.total = 15');
    expect([...flat.matchAll(/CONSTRAINT (\w+) /g)]).toHaveLength(15);
    for (const kind of KINDS) expect(checker).toContain(`'${kind}'`);
  });

  it('B8 holds the md5 of the function body exactly as the migration writes it, and the argument names in order', () => {
    const hash = createHash('md5').update(body, 'utf8').digest('hex');
    expect(checker).toContain(`apply_function.body_md5 = '${hash}'`);
    expect(checker).toContain(`apply_function.argument_names = '${[...PARAMETERS, ...OUTPUTS].join(' ')}'`);
    expect(checker).toContain("position('business_os_account_lineage' IN pg_proc.prosrc)");
  });

  it('B6 and B7 prove append-only: exactly INSERT SELECT for service_role and no change privilege for anyone', () => {
    expect(checkerFlat).toContain("service_table.listing = 'INSERT SELECT' AND client_reach.service_updatable = 0");
    expect(checkerFlat).toContain("('UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')");
  });
});

describe('the pre-check has not drifted from the migration', () => {
  it('lists exactly the table, constraint and index names the migration creates, and the function name', () => {
    const block = precheck.slice(precheck.indexOf('unnest(ARRAY['), precheck.indexOf(']) AS planned'));
    const listed = [...block.matchAll(/'(\w+)'/g)].map((match) => match[1]);
    expect(listed.sort()).toEqual(migrationObjectNames().sort());
    expect(precheck).toContain(`pg_proc.proname = '${FUNCTION}'`);
  });

  it('T0: checks the live billing and plan columns the function names, and the service_role grants it needs', () => {
    for (const column of ['stripe_subscription_id', 'subscription_status', 'bought_tier', 'current_period_end', 'last_invoice_id', 'last_paid_at', 'ended_at']) {
      expect(precheck).toContain(`'${column}'`);
    }
    for (const column of ['tier', 'plan_version', 'tier_expires_at', 'cohort', 'period_anchor', 'updated_by_admin_id']) {
      expect(precheck).toContain(`'${column}'`);
    }
    // Every billing column the function UPDATEs must be in the pre-check's grant list.
    const update = body.slice(body.indexOf('UPDATE public.business_os_billing_accounts AS billing_row'));
    const written = [...update.slice(0, update.indexOf('WHERE')).matchAll(/\n\s+(?:SET )?(\w+) = /g)].map((match) => match[1]);
    const granted = precheck.match(/CROSS JOIN unnest\(ARRAY\[([^\]]*)\]\) AS needed/)?.[1];
    expect([...(granted ?? '').matchAll(/'(\w+)'/g)].map((match) => match[1]).sort()).toEqual([...written].sort());
  });
});

describe('the probe (§4.4, C-6 cases, Q-3, C-1, C-2)', () => {
  it('is one DO block that always rolls back, with its guards before any role switch', () => {
    expect(probe.trim().startsWith('DO $probe$')).toBe(true);
    expect(probe.trim().endsWith('$probe$;')).toBe(true);
    expect(probe).toContain("RAISE EXCEPTION USING MESSAGE = 'PROBE ' || CASE WHEN v_fail THEN 'FAIL' ELSE 'PASS' END");
    const firstSwitch = probe.indexOf('SET LOCAL ROLE');
    for (const guard of [
      'replace PASTE_YOUR_OWN_USER_ID_HERE',
      'not a valid user id',
      'this session is read only',
      'not an account on this database',
      'has no Business OS plan row',
      'has a live mode billing record',
    ]) {
      const index = probe.indexOf(guard);
      expect(index).toBeGreaterThan(0);
      expect(index).toBeLessThan(firstSwitch);
    }
  });

  it('has every id P00 to P15', () => {
    for (let id = 0; id <= 15; id += 1) expect(probe).toContain(`'P${String(id).padStart(2, '0')} `);
  });

  it('runs the function as service_role, and the owner checks as authenticated', () => {
    expect(probe.indexOf('SET LOCAL ROLE service_role;')).toBeLessThan(probe.indexOf("'P02 PASS"));
    expect(probe.indexOf('SET LOCAL ROLE authenticated;')).toBeLessThan(probe.indexOf("'P15 PASS"));
  });

  it('Q-3: the missing plan row case runs inside its own block that is always undone', () => {
    const p01 = probe.slice(probe.indexOf('DELETE FROM public.business_os_account_plans'), probe.indexOf("'P01 PASS"));
    expect(p01).toContain("RAISE EXCEPTION 'probe savepoint' USING ERRCODE = 'P0001';");
    expect(p01).toContain('EXCEPTION WHEN raise_exception THEN');
    expect(p01).toContain("v_text = 'plan_row_missing' AND v_written");
  });

  it.each([
    ['P02', 'mode mismatch', 'billing_row_missing'],
    ['P05', 'replay', 'already_applied'],
    ['P06', 'out-of-order renewal', "'recorded'"],
    ['P07', 'upgrade', 'probe_pro'],
    ['P08', 'admin change on a subscribed account', 'probe_admin'],
    ['P09', 'second subscription', 'mismatch_refused second_subscription'],
    ['P10', 'C-2 resent refused event', 'already_recorded'],
    ['P11', 'C-1 held elsewhere', 'mismatch_refused subscription_held_elsewhere'],
    ['P12', 're-buy after pause', 'v_anchor_d'],
    ['P12', 'SA F-1: a replacement clears the cancel flag', 'cancel_at_period_end = true'],
    ['P13', '$0 trial invoice then first paid', 'recorded false false'],
  ])('%s covers %s', (id, _case, fragment) => {
    const previous = `P${String(Number(id.slice(1)) - 1).padStart(2, '0')}`;
    const start = probe.indexOf(`'${previous} `);
    const end = probe.indexOf(`'${id} PASS`);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const section = probe.slice(start, end);
    expect(section).toContain(fragment);
  });

  it('C-1 and C-2 calls are caught, so a constraint error reports FAIL instead of ending the probe', () => {
    const caught = [...probe.matchAll(/EXCEPTION WHEN OTHERS THEN\n\s+v_r := \(SELECT apply_result FROM \(SELECT \('raised ' \|\| SQLSTATE\)/g)];
    expect(caught).toHaveLength(2);
  });

  it('the history is append-only even for service_role (P14) and closed to the owner (P15)', () => {
    expect(probe).toContain('UPDATE public.business_os_billing_events AS event_row SET tier = event_row.tier');
    expect(probe).toContain('DELETE FROM public.business_os_billing_events AS event_row');
    expect(probe).toContain('PERFORM public.business_os_apply_plan_payment(');
  });
});

describe('the rollback (§4.4, §12)', () => {
  it('locks, refuses on any live mode row, then drops the function and the table, in one transaction', () => {
    expect(rollbackFlat.startsWith("BEGIN; SET LOCAL lock_timeout = '5s'; LOCK TABLE public.business_os_billing_events IN ACCESS EXCLUSIVE MODE;")).toBe(true);
    expect(rollbackFlat.endsWith('COMMIT;')).toBe(true);
    const refusal = rollbackFlat.indexOf('ROLLBACK REFUSED');
    expect(rollbackFlat).toContain('WHERE event_row.livemode');
    const dropFunction = rollbackFlat.indexOf(`DROP FUNCTION public.${FUNCTION}(${SIGNATURE});`);
    const dropTable = rollbackFlat.indexOf('DROP TABLE public.business_os_billing_events;');
    expect(refusal).toBeGreaterThan(0);
    expect(dropFunction).toBeGreaterThan(refusal);
    expect(dropTable).toBeGreaterThan(dropFunction);
    expect(rollbackFlat.match(/DROP /g)).toHaveLength(2);
    expect(rollbackFlat).not.toMatch(/DELETE|UPDATE public|TRUNCATE|business_os_billing_accounts|business_os_account_plans/);
  });
});
