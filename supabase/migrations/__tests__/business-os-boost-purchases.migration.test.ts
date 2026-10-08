/**
 * Guard over the Business OS boost purchases migration (credits boost slice 2a;
 * workplan BUSINESS_OS_CREDITS_BOOST_SLICE_2_WORKPLAN.md §3.1 to §3.4a, §6, §7.1,
 * and SA conditions C-1 to C-5).
 *
 * WHY A TEST OVER SQL TEXT. Jest cannot run PL/pgSQL and there is no branch
 * database: the user pastes the migration into the Supabase SQL editor on PROD,
 * then runs the read-only checker `scripts/check-bos-boost-purchases-migration.sql`
 * and the mandatory write probe `scripts/probe-bos-boost-purchases-migration.sql`.
 * What the files alone can prove is pinned here: the paste-safety rules, the
 * security shape (REVOKE ALL, column-level grants, INVOKER functions, no
 * trigger), the reserve function's lock and step order, that 11a's lots objects
 * are referenced but never created, altered or dropped (G-1), and that the
 * checker, the probe and the rollback have not drifted from the migration.
 *
 * The helpers are copied from the 11a lots test on purpose, rather than imported
 * across test files.
 */

import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');
const SQL_SCRIPTS_DIR = join(ROOT, 'supabase', 'SQL Scripts');
const MIGRATION = join(MIGRATIONS_DIR, '20261030_business_os_boost_purchases.sql');
const ROLLBACK = join(SQL_SCRIPTS_DIR, '20261030_business_os_boost_purchases_rollback.sql');
const CHECKER = join(ROOT, 'scripts', 'check-bos-boost-purchases-migration.sql');
const PROBE = join(ROOT, 'scripts', 'probe-bos-boost-purchases-migration.sql');
const LOTS_MIGRATION = join(MIGRATIONS_DIR, '20261017_business_os_credit_lots.sql');
const CHARGES_MIGRATION = join(MIGRATIONS_DIR, '20261015_business_os_credit_charges.sql');
const WORKPLAN = join(ROOT, 'docs', 'workplans', 'BUSINESS_OS_CREDITS_BOOST_SLICE_2_WORKPLAN.md');
const WORKPLAN_2B = join(ROOT, 'docs', 'workplans', 'BUSINESS_OS_CREDITS_BOOST_SLICE_2B_WORKPLAN.md');
/**
 * Slice 2b (20261031) adds one more column UPDATE grant. The shared checker describes the post-2b
 * state, so its update list is 2a's five columns followed by 2b's eleven, read from the 2b file.
 */
const SERVICE_PURCHASE_UPDATE_2B = (() => {
  const text = readFileSync(join(MIGRATIONS_DIR, '20261031_business_os_boost_crediting.sql'), 'utf8').replace(/\s+/g, ' ');
  const match = text.match(/GRANT UPDATE \(([^)]*)\) ON TABLE public\.business_os_boost_purchases TO service_role;/);
  return match ? match[1].split(',').map((column) => column.trim()) : [];
})();

const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const migration = read(MIGRATION);
const flat = migration.replace(/\s+/g, ' ');
const checker = read(CHECKER);
const probe = read(PROBE);
const rollbackFlat = read(ROLLBACK).replace(/\s+/g, ' ').trim();

const PURCHASES = 'public.business_os_boost_purchases';
const OVERRIDES = 'public.business_os_boost_cap_overrides';

const FUNCTIONS = {
  reserve: {
    name: 'business_os_reserve_boost_purchase',
    tag: 'reserve_purchase',
    signature: 'uuid, boolean, text, integer, integer, integer, integer, text, numeric, numeric, integer, integer, integer',
  },
  attach: { name: 'business_os_attach_boost_checkout', tag: 'attach_checkout', signature: 'uuid, uuid, text, timestamptz' },
  abandon: { name: 'business_os_abandon_boost_purchase', tag: 'abandon_purchase', signature: 'uuid, uuid' },
  setOverride: { name: 'business_os_set_boost_cap_override', tag: 'set_cap_override', signature: 'uuid, integer, text, text, uuid' },
  endOverride: { name: 'business_os_end_boost_cap_override', tag: 'end_cap_override', signature: 'uuid, uuid, text' },
} as const;

/** What an owner may read (SA Q-3). Slice 5's owner read repository is subset-tested against this line. */
const OWNER_PURCHASE_COLUMNS = [
  'id', 'user_id', 'livemode', 'status', 'package_id', 'package_version', 'credits_base', 'credits_bonus', 'credits_total',
  'price_minor', 'currency', 'tax_exclusive', 'amount_tax_minor', 'amount_total_minor', 'amount_refunded_minor', 'receipt_url',
  'paid_at', 'created_at',
];
/** SA C-1: what reserve writes, and nothing else. */
const SERVICE_PURCHASE_INSERT = [
  'user_id', 'livemode', 'package_id', 'package_version', 'retail_version', 'credit_value_version', 'price_minor', 'currency',
  'tax_exclusive', 'credits_base', 'credits_bonus', 'credits_total', 'checkout_expires_at',
];
const SERVICE_PURCHASE_UPDATE = ['status', 'stripe_checkout_session_id', 'checkout_expires_at', 'status_changed_at', 'updated_at'];
const SERVICE_OVERRIDE_INSERT = ['user_id', 'cap_minor', 'currency', 'reason', 'actor_admin_id'];
const SERVICE_OVERRIDE_UPDATE = ['ended_at', 'ended_by_admin_id', 'ended_reason'];
/** Columns no grant may ever let service_role update (the snapshot, the account, the mode). */
const NEVER_UPDATED = [
  'id', 'user_id', 'livemode', 'package_id', 'package_version', 'retail_version', 'credit_value_version', 'price_minor', 'currency',
  'tax_exclusive', 'credits_base', 'credits_bonus', 'credits_total', 'created_at',
];

const STATUSES = [
  'pending', 'abandoned', 'awaiting_payment', 'paid', 'failed', 'expired', 'flagged_mismatch', 'partially_refunded', 'refunded',
  'disputed', 'dispute_lost',
];
/** T-10: what counts toward the cap, besides a pending row inside its expiry plus grace. */
const COUNTED = ['awaiting_payment', 'paid', 'flagged_mismatch', 'partially_refunded', 'refunded', 'disputed', 'dispute_lost'];

/** Every single-quoted literal in a SQL text. */
function literalsOf(sql: string): string[] {
  return [...sql.matchAll(/'([^']*)'/g)].map((match) => match[1]);
}

function tableBody(table: string): string {
  const start = migration.indexOf(`CREATE TABLE ${table} (`);
  expect(start).toBeGreaterThanOrEqual(0);
  return migration.slice(start, migration.indexOf('\n);\n', start) + 3);
}

function columnsOf(table: string): string[] {
  return tableBody(table)
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => /^[a-z_]+ /.test(line) && !line.startsWith('CONSTRAINT'))
    .map((line) => line.split(' ')[0]);
}

function functionText(name: string, tag: string): string {
  const start = migration.indexOf(`CREATE FUNCTION public.${name}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  const close = migration.indexOf(`$${tag}$;`, start);
  expect(close).toBeGreaterThan(start);
  return migration.slice(start, close + tag.length + 3);
}

function functionBody(sql: string, tag: string): string {
  const open = `AS $${tag}$`;
  const start = sql.indexOf(open);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf(`$${tag}$;`, start + open.length);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start + open.length, end);
}

function checkStatement(name: string): string {
  const match = flat.match(new RegExp(`ADD CONSTRAINT ${name} CHECK [^;]*;`));
  expect(match).not.toBeNull();
  return match ? match[0] : '';
}

function checkNames(table: string): string[] {
  return [...flat.matchAll(new RegExp(`ALTER TABLE ${table.replace('.', '\\.')} ADD CONSTRAINT (\\w+) CHECK`, 'g'))].map((match) => match[1]);
}

/** The column list of one GRANT <privilege> (…) ON TABLE <table> TO <role>; */
function grantColumns(privilege: string, table: string, role: string): string[] {
  const match = flat.match(new RegExp(`GRANT ${privilege} \\(([^)]*)\\) ON TABLE ${table.replace('.', '\\.')} TO ${role};`));
  expect(match).not.toBeNull();
  return match ? match[1].split(',').map((column) => column.trim()) : [];
}

/** B-1 guard (copied): a bare CASE inside an IF condition is cut at its own THEN (42601). */
function bareCaseInIfConditions(sql: string): string[] {
  const code = sql.replace(/'[^']*'/g, (literal) => `'${' '.repeat(literal.length - 2)}'`);
  const wordAt = (word: string, i: number) =>
    code.startsWith(word, i) && !/\w/.test(code[i - 1] ?? '') && !/\w/.test(code[i + word.length] ?? '');
  const found: string[] = [];
  for (const match of code.matchAll(/\b(?:ELSIF|IF)\b/g)) {
    const at = match.index ?? 0;
    if (/\bEND\s+$/.test(code.slice(Math.max(0, at - 8), at))) continue;
    let depth = 0;
    for (let i = at + match[0].length; i < code.length; i += 1) {
      const ch = code[i];
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
      else if (ch === ';' && depth === 0) break;
      else if (depth === 0 && wordAt('THEN', i)) break;
      else if (depth === 0 && wordAt('CASE', i)) {
        found.push(sql.slice(at, sql.indexOf('\n', at)).trim());
        break;
      }
    }
  }
  return found;
}

const md5 = (text: string) => createHash('md5').update(text, 'utf8').digest('hex');

describe('SQL-editor safety (the user pastes all four files by hand)', () => {
  const files: Array<[string, string]> = [
    ['migration', MIGRATION],
    ['rollback', ROLLBACK],
    ['checker', CHECKER],
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

  it.each(files)('%s holds only letters, digits, underscores and spaces inside string literals', (_name, file) => {
    for (const literal of literalsOf(read(file))) {
      expect({ literal, ok: /^[A-Za-z0-9_ ]*$/.test(literal) }).toEqual({ literal, ok: true });
    }
  });

  it.each(files)('%s never has the word into inside a string literal (the SQL editor misparses it)', (_name, file) => {
    for (const literal of literalsOf(read(file))) expect(literal).not.toMatch(/\binto\b/i);
  });

  it('the into guard catches the word (negative control)', () => {
    expect(literalsOf("RAISE EXCEPTION 'nothing went into the table'").some((literal) => /\binto\b/i.test(literal))).toBe(true);
  });

  it.each(files)('%s uses no single-letter alias', (_name, file) => {
    expect(read(file)).not.toMatch(/\b(?:FROM|JOIN)\s+[\w.]+\s+(?:AS\s+)?[a-z]\b(?!\w)/i);
    expect(read(file)).not.toMatch(/\bINTO\s+[\w.]+\s+AS\s+[a-z]\b(?!\w)/i);
  });

  it.each(files)('%s never puts a bare CASE inside an IF or ELSIF condition', (_name, file) => {
    expect(bareCaseInIfConditions(read(file))).toEqual([]);
  });

  it.each(files)('%s names no Pilot-Credit or token table', (_name, file) => {
    for (const table of ['token_usage', 'user_subscriptions', 'credit_transactions', 'billing_events']) {
      expect(read(file)).not.toContain(table);
    }
  });

  it('every colon and every underscore inside a prefix is spelled chr(58) or chr(95), in brackets next to a comparison', () => {
    for (const text of [migration, checker, probe]) {
      expect(text).not.toMatch(/'(?:business_os_boost_cap|boost):/);
      expect(text).not.toMatch(/'(?:cs|pi|ch|py|dp|du)_'/);
    }
    expect(migration).toContain("hashtextextended('business_os_boost_cap' || chr(58) || p_user_id::text, 0)");
    expect(flat).toContain("left(stripe_checkout_session_id, 3) = ('cs' || chr(95))");
  });
});

describe('one migration, two tables, five functions, one transaction', () => {
  it('is wrapped in exactly one BEGIN … COMMIT with a lock timeout, plain CREATE (a second paste fails and changes nothing)', () => {
    expect(flat.trim().startsWith("BEGIN; SET LOCAL lock_timeout = '5s';")).toBe(true);
    expect(flat.trim().endsWith('COMMIT;')).toBe(true);
    expect(flat.match(/\bBEGIN;/g)).toHaveLength(1);
    expect(flat.match(/\bCOMMIT;/g)).toHaveLength(1);
    expect(flat.match(/CREATE TABLE/g)).toHaveLength(2);
    expect(flat.match(/CREATE FUNCTION/g)).toHaveLength(5);
    expect(flat).not.toMatch(/CREATE [A-Z ]*IF NOT EXISTS/i);
    expect(flat).not.toMatch(/OR REPLACE/i);
  });

  it('creates no trigger and nothing SECURITY DEFINER (SA Q-2)', () => {
    expect(flat).not.toMatch(/\bTRIGGER\b/i);
    expect(flat).not.toMatch(/SECURITY DEFINER/i);
    expect(flat.match(/SECURITY INVOKER/g)).toHaveLength(5);
  });

  it('G-1: references the lots table only as the lot_id foreign key, and never creates, alters or drops a lots object', () => {
    const mentions = migration.split('\n').filter((line) => /business_os_credit_lot|business_os_record_credit_lot|business_os_reverse_credit_lot/.test(line));
    expect(mentions).toEqual([
      'ALTER TABLE public.business_os_boost_purchases ADD CONSTRAINT business_os_boost_purchases_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES public.business_os_credit_lots (id);',
    ]);
    expect(read(ROLLBACK)).not.toMatch(/business_os_credit_lot|business_os_record_credit_lot|business_os_reverse_credit_lot/);
  });

  it('G-1: names none of the charge-path objects', () => {
    for (const name of ['business_os_credit_charges', 'business_os_credit_totals', 'business_os_record_credit_charge', 'business_os_credit_period_start']) {
      expect(migration).not.toContain(name);
      expect(read(ROLLBACK)).not.toContain(name);
    }
  });

  it('alters only its own tables and holds no data', () => {
    expect(flat.replace(/ON DELETE SET NULL/g, '')).not.toMatch(/\b(DROP|TRUNCATE|DELETE)\b/);
    for (const alter of flat.match(/ALTER TABLE [\w.]+/g) ?? []) {
      expect([`ALTER TABLE ${PURCHASES}`, `ALTER TABLE ${OVERRIDES}`]).toContain(alter);
    }
    for (const update of flat.match(/UPDATE [\w.]+ AS/g) ?? []) {
      expect([`UPDATE ${PURCHASES} AS`, `UPDATE ${OVERRIDES} AS`]).toContain(update);
    }
    expect(flat.match(/INSERT INTO [\w.]+/g)).toEqual([`INSERT INTO ${PURCHASES}`, `INSERT INTO ${OVERRIDES}`]);
  });
});

describe('the purchases table (§3.1)', () => {
  it('has exactly the specified columns, in order', () => {
    expect(columnsOf(PURCHASES)).toEqual([
      'id', 'user_id', 'livemode', 'status', 'package_id', 'package_version', 'retail_version', 'credit_value_version', 'price_minor',
      'currency', 'tax_exclusive', 'credits_base', 'credits_bonus', 'credits_total', 'checkout_expires_at', 'stripe_checkout_session_id',
      'stripe_payment_intent_id', 'stripe_charge_id', 'receipt_url', 'amount_subtotal_minor', 'amount_tax_minor', 'amount_total_minor',
      'amount_refunded_minor', 'stripe_dispute_id', 'flag_reason', 'lot_id', 'paid_at', 'status_changed_at', 'created_at', 'updated_at',
    ]);
  });

  it('types: numeric(18,6) on credits, integer on money, status defaults to pending, user_id nullable', () => {
    const body = tableBody(PURCHASES);
    expect(body).toContain('  user_id uuid,\n');
    expect(body).toContain("  status text NOT NULL DEFAULT 'pending',\n");
    for (const column of ['credits_base', 'credits_bonus', 'credits_total']) expect(body).toContain(`  ${column} numeric(18,6) NOT NULL,\n`);
    expect(body).toContain('  price_minor integer NOT NULL,\n');
    for (const column of ['amount_subtotal_minor', 'amount_tax_minor', 'amount_total_minor']) expect(body).toContain(`  ${column} integer,\n`);
    expect(body).toContain('  amount_refunded_minor integer NOT NULL DEFAULT 0,\n');
    expect(body).toContain('  checkout_expires_at timestamptz NOT NULL,\n');
    expect(body).toContain('  lot_id uuid,\n');
  });

  it('the status CHECK admits exactly the eleven statuses', () => {
    expect(checkStatement('business_os_boost_purchases_status_known')).toBe(
      `ADD CONSTRAINT business_os_boost_purchases_status_known CHECK (status IN (${STATUSES.map((status) => `'${status}'`).join(', ')}));`
    );
  });

  it('SA C-2: the session id is limited to 194 characters so the lot key fits the 200-character lot limit', () => {
    expect(checkStatement('business_os_boost_purchases_session_id_shape')).toBe(
      "ADD CONSTRAINT business_os_boost_purchases_session_id_shape CHECK (stripe_checkout_session_id IS NULL OR (left(stripe_checkout_session_id, 3) = ('cs' || chr(95)) AND char_length(stripe_checkout_session_id) <= 194));"
    );
    // The arithmetic behind 194, against 11a's own limit.
    expect(read(LOTS_MIGRATION)).toContain('CHECK (char_length(idempotency_key) BETWEEN 1 AND 200)');
    expect('boost:'.length + 194).toBe(200);
  });

  it('SA Q-9: charge ids accept ch_ and py_, dispute ids dp_ and du_', () => {
    expect(checkStatement('business_os_boost_purchases_charge_id_shape')).toContain("left(stripe_charge_id, 3) = ('ch' || chr(95)) OR left(stripe_charge_id, 3) = ('py' || chr(95))");
    expect(checkStatement('business_os_boost_purchases_dispute_id_shape')).toContain("left(stripe_dispute_id, 3) = ('dp' || chr(95)) OR left(stripe_dispute_id, 3) = ('du' || chr(95))");
  });

  it('consistency CHECKs: paid family complete, lot only when paid, flag reason with flagged_mismatch only, abandoned has no session', () => {
    const paidFamily = "('paid', 'partially_refunded', 'refunded', 'disputed', 'dispute_lost')";
    expect(checkStatement('business_os_boost_purchases_paid_family_complete')).toContain(`status NOT IN ${paidFamily} OR (lot_id IS NOT NULL AND paid_at IS NOT NULL AND stripe_payment_intent_id IS NOT NULL`);
    expect(checkStatement('business_os_boost_purchases_lot_only_when_paid')).toContain(`lot_id IS NULL OR status IN ${paidFamily}`);
    expect(checkStatement('business_os_boost_purchases_flag_reason_shape')).toContain("(status = 'flagged_mismatch') = (flag_reason IS NOT NULL)");
    expect(checkStatement('business_os_boost_purchases_abandoned_has_no_session')).toContain("status <> 'abandoned' OR stripe_checkout_session_id IS NULL");
    expect(checkStatement('business_os_boost_purchases_credits_valid')).toContain('credits_total = credits_base + credits_bonus');
  });

  it('no CHECK names user_id, so the ON DELETE SET NULL detach is never refused', () => {
    for (const name of [...checkNames(PURCHASES), ...checkNames(OVERRIDES)]) expect(checkStatement(name)).not.toContain('user_id');
  });

  it('nineteen CHECKs on purchases and four on overrides, every one named in the checker', () => {
    expect(checkNames(PURCHASES)).toHaveLength(19);
    expect(checkNames(OVERRIDES)).toHaveLength(4);
    for (const name of [...checkNames(PURCHASES), ...checkNames(OVERRIDES)]) expect(checker).toContain(`'${name}'`);
    expect(checker).toContain('purchase_named_checks = 19 AND constraint_summary.override_named_checks = 4 AND constraint_summary.all_checks = 23');
  });

  it('unique Stripe ids and lot_id; FKs to auth.users (SET NULL) and to the lots table', () => {
    for (const key of ['session_id_key UNIQUE (stripe_checkout_session_id)', 'payment_intent_id_key UNIQUE (stripe_payment_intent_id)', 'charge_id_key UNIQUE (stripe_charge_id)', 'lot_id_key UNIQUE (lot_id)']) {
      expect(flat).toContain(`ADD CONSTRAINT business_os_boost_purchases_${key};`);
    }
    expect(flat).toContain(`ADD CONSTRAINT business_os_boost_purchases_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE SET NULL;`);
    expect(flat).toContain(`ADD CONSTRAINT business_os_boost_cap_overrides_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE SET NULL;`);
    expect(flat.match(/FOREIGN KEY/g)).toHaveLength(3);
  });
});

describe('the cap overrides table (§3.2)', () => {
  it('has exactly the specified columns and at most one active row per account', () => {
    expect(columnsOf(OVERRIDES)).toEqual([
      'id', 'user_id', 'cap_minor', 'currency', 'reason', 'actor_admin_id', 'created_at', 'ended_at', 'ended_by_admin_id', 'ended_reason',
    ]);
    expect(flat).toContain(`CREATE UNIQUE INDEX business_os_boost_cap_overrides_one_active_idx ON ${OVERRIDES} (user_id) WHERE ended_at IS NULL;`);
    expect(checkStatement('business_os_boost_cap_overrides_ended_complete')).toContain('ended_at IS NULL AND ended_by_admin_id IS NULL AND ended_reason IS NULL');
  });
});

describe('RLS and grants (§3.3, SA C-1, Q-3)', () => {
  it('RLS on both; one owner SELECT policy on purchases and none on overrides', () => {
    expect(flat).toContain(`ALTER TABLE ${PURCHASES} ENABLE ROW LEVEL SECURITY;`);
    expect(flat).toContain(`ALTER TABLE ${OVERRIDES} ENABLE ROW LEVEL SECURITY;`);
    expect(flat.match(/CREATE POLICY/g)).toHaveLength(1);
    expect(flat).toContain(`CREATE POLICY business_os_boost_purchases_owner_select ON ${PURCHASES} FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);`);
  });

  it('REVOKE ALL from the four roles on both tables and all five functions, before any grant of that object', () => {
    const objects = [
      `TABLE ${PURCHASES}`,
      `TABLE ${OVERRIDES}`,
      ...Object.values(FUNCTIONS).map((fn) => `FUNCTION public.${fn.name}(${fn.signature})`),
    ];
    for (const object of objects) {
      for (const role of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
        const revoke = `REVOKE ALL ON ${object} FROM ${role};`;
        expect(flat).toContain(revoke);
        const lastRevoke = flat.lastIndexOf(revoke);
        const firstGrant = flat.indexOf(`ON ${object} TO`);
        expect(firstGrant).toBeGreaterThan(lastRevoke);
      }
    }
    expect(flat).not.toMatch(/REVOKE (?!ALL)\w/);
  });

  it('the exact grants, and nothing else', () => {
    expect(grantColumns('SELECT', PURCHASES, 'authenticated')).toEqual(OWNER_PURCHASE_COLUMNS);
    expect(grantColumns('INSERT', PURCHASES, 'service_role')).toEqual(SERVICE_PURCHASE_INSERT);
    expect(grantColumns('UPDATE', PURCHASES, 'service_role')).toEqual(SERVICE_PURCHASE_UPDATE);
    expect(grantColumns('INSERT', OVERRIDES, 'service_role')).toEqual(SERVICE_OVERRIDE_INSERT);
    expect(grantColumns('UPDATE', OVERRIDES, 'service_role')).toEqual(SERVICE_OVERRIDE_UPDATE);
    const tableGrants = flat.match(/GRANT [A-Z, ]+ ON TABLE [\w.]+ TO \w+;/g);
    expect(tableGrants).toEqual([`GRANT SELECT ON TABLE ${PURCHASES} TO service_role;`, `GRANT SELECT ON TABLE ${OVERRIDES} TO service_role;`]);
    expect(flat.match(/\bGRANT\b/g)).toHaveLength(7 + 5);
    expect(flat).not.toMatch(/GRANT[^;]*(DELETE|TRUNCATE|REFERENCES|TRIGGER|MAINTAIN|ALL PRIVILEGES)/);
  });

  it('SA C-1: service_role cannot insert a status, a lot, a payment or an ended override', () => {
    for (const column of ['status', 'lot_id', 'paid_at', 'stripe_payment_intent_id', 'amount_total_minor', 'flag_reason']) {
      expect(SERVICE_PURCHASE_INSERT).not.toContain(column);
    }
    for (const column of ['ended_at', 'ended_by_admin_id', 'ended_reason']) expect(SERVICE_OVERRIDE_INSERT).not.toContain(column);
    expect(checker).toContain(`boost_tables.table_name = 'business_os_boost_purchases' AND pg_attribute.attname::text IN (${SERVICE_PURCHASE_INSERT.map((c) => `'${c}'`).join(', ')})`);
  });

  it('no UPDATE grant names the snapshot, the account or the mode', () => {
    for (const column of NEVER_UPDATED) expect(SERVICE_PURCHASE_UPDATE).not.toContain(column);
  });

  it('every function: EXECUTE to service_role only', () => {
    for (const fn of Object.values(FUNCTIONS)) {
      expect(flat).toContain(`GRANT EXECUTE ON FUNCTION public.${fn.name}(${fn.signature}) TO service_role;`);
    }
    expect(flat.match(/GRANT EXECUTE/g)).toHaveLength(5);
  });

  it('the checker lists the same owner, insert and update columns as the GRANT lines', () => {
    expect(checker).toContain(`pg_attribute.attname::text IN (${OWNER_PURCHASE_COLUMNS.map((c) => `'${c}'`).join(', ')})`);
    expect(SERVICE_PURCHASE_UPDATE_2B).toHaveLength(11);
    expect(checker).toContain(`pg_attribute.attname::text IN (${[...SERVICE_PURCHASE_UPDATE, ...SERVICE_PURCHASE_UPDATE_2B].map((c) => `'${c}'`).join(', ')})`);
    expect(checker).toContain(`pg_attribute.attname::text IN (${SERVICE_OVERRIDE_INSERT.map((c) => `'${c}'`).join(', ')})`);
    expect(checker).toContain(`pg_attribute.attname::text IN (${SERVICE_OVERRIDE_UPDATE.map((c) => `'${c}'`).join(', ')})`);
    expect(checker).toContain(`column_summary.owner_readable = ${OWNER_PURCHASE_COLUMNS.length}`);
    expect(checker).toContain(`column_summary.service_insertable = ${SERVICE_PURCHASE_INSERT.length + SERVICE_OVERRIDE_INSERT.length}`);
    expect(checker).toContain(`column_summary.service_updatable = ${SERVICE_PURCHASE_UPDATE.length + SERVICE_PURCHASE_UPDATE_2B.length + SERVICE_OVERRIDE_UPDATE.length}`);
    expect(checker).toContain(`column_summary.total = ${columnsOf(PURCHASES).length + columnsOf(OVERRIDES).length}`);
  });
});

describe('the functions (§3.4, SA C-4)', () => {
  it.each(Object.values(FUNCTIONS))('$name is VOLATILE SECURITY INVOKER with an empty search path and schema-qualified tables', (fn) => {
    const text = functionText(fn.name, fn.tag).replace(/\s+/g, ' ');
    expect(text).toContain('LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = \'\'');
    expect(text).not.toMatch(/(?:FROM|INTO|UPDATE|JOIN) (?!public\.|v_|out_|p_)[a-z_]+ /);
    expect(text).toContain("USING ERRCODE = '22004'");
  });

  it('reserve: lock first, then plan row, override, sum, compare, insert (SA C-4 bounds before the lock)', () => {
    const body = functionBody(migration, FUNCTIONS.reserve.tag);
    const at = (needle: string) => {
      const index = body.indexOf(needle);
      expect({ needle, found: index >= 0 }).toEqual({ needle, found: true });
      return index;
    };
    const order = [
      at("USING ERRCODE = '22004'"),
      at('p_checkout_ttl_seconds < 1800 OR p_checkout_ttl_seconds > 86400'),
      at("USING ERRCODE = '22023'"),
      at("PERFORM pg_advisory_xact_lock(hashtextextended('business_os_boost_cap' || chr(58) || p_user_id::text, 0));"),
      at('FROM public.business_os_account_plans AS plan_row'),
      at('FROM public.business_os_boost_cap_overrides AS override_row'),
      at('FROM public.business_os_boost_purchases AS purchase_row'),
      at('IF v_counted + p_price_minor > v_cap THEN'),
      at('INSERT INTO public.business_os_boost_purchases'),
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(body).toContain('p_window_days < 1 OR p_window_days > 366');
    expect(body).toContain('p_default_cap_minor <= 0');
    expect(body).toContain("p_currency <> 'USD'");
    expect(body).toContain('purchase_row.livemode = p_livemode');
    expect(body).toContain('purchase_row.created_at > now() - make_interval(days => p_window_days)');
    expect(body).toContain(`purchase_row.status IN (${COUNTED.map((s) => `'${s}'`).join(', ')})`);
    expect(body).toContain("purchase_row.status = 'pending' AND now() < purchase_row.checkout_expires_at + make_interval(mins => 5)");
    expect(body).toContain('now() + make_interval(secs => p_checkout_ttl_seconds)');
    expect(literalsOf(body).filter((l) => /^[a-z_]+$/.test(l) && ['no_plan_row', 'cap_reached', 'reserved'].includes(l))).toEqual(['no_plan_row', 'cap_reached', 'reserved']);
  });

  it('reserve counts exactly the statuses T-10 lists, and none that cannot have moved money', () => {
    for (const status of ['abandoned', 'failed', 'expired']) expect(COUNTED).not.toContain(status);
    expect([...COUNTED, 'pending', 'abandoned', 'failed', 'expired'].sort()).toEqual([...STATUSES].sort());
  });

  it('attach: refuses a session id over 194 characters or without the cs prefix (SA C-2), locks the row, six outcomes', () => {
    const body = functionBody(migration, FUNCTIONS.attach.tag);
    expect(body).toContain("IF char_length(p_session_id) > 194 OR left(p_session_id, 3) <> ('cs' || chr(95)) THEN");
    // SA CR-3: the expiry must be in the future and within 24 h plus 5 min, refused with 22023 before the row lock.
    expect(body).toContain('IF p_checkout_expires_at <= now() OR p_checkout_expires_at > now() + make_interval(hours => 24, mins => 5) THEN');
    expect(body.indexOf('make_interval(hours => 24, mins => 5)')).toBeLessThan(body.indexOf('FOR UPDATE'));
    expect(body).toContain('FOR UPDATE');
    expect(body).toContain('NOT v_found OR v_user IS DISTINCT FROM p_user_id');
    for (const status of ['not_found', 'already_attached', 'session_conflict', 'not_pending', 'reservation_expired', 'attached']) {
      expect(body).toContain(`out_status := '${status}'`);
    }
    expect(body).not.toMatch(/SET status/);
    // QA-D2: a reservation past its expiry plus the 5-minute grace no longer counts toward the cap,
    // so attaching it would revive it over the cap. Refused after the not_pending check, before the update.
    expect(body).toContain('IF now() >= v_expires_at + make_interval(mins => 5) THEN');
    expect(body.indexOf("out_status := 'not_pending'")).toBeLessThan(body.indexOf("out_status := 'reservation_expired'"));
    expect(body.indexOf("out_status := 'reservation_expired'")).toBeLessThan(body.indexOf('UPDATE public.business_os_boost_purchases'));
  });

  it('abandon: locks the row, never abandons a row with a session, five outcomes', () => {
    const body = functionBody(migration, FUNCTIONS.abandon.tag);
    expect(body).toContain('FOR UPDATE');
    expect(body.indexOf("out_status := 'has_session'")).toBeLessThan(body.indexOf("SET status = 'abandoned'"));
    for (const status of ['not_found', 'already_abandoned', 'has_session', 'not_pending', 'abandoned']) expect(body).toContain(`out_status := '${status}'`);
  });

  it('set and end override: refuse a NULL admin or a short reason with 22023 (SA C-4), take the boost cap lock, set requires a plan row', () => {
    const setBody = functionBody(migration, FUNCTIONS.setOverride.tag);
    const endBody = functionBody(migration, FUNCTIONS.endOverride.tag);
    for (const body of [setBody, endBody]) {
      expect(body).toContain('p_actor_admin_id IS NULL OR p_reason IS NULL OR char_length(btrim(p_reason)) < 3');
      expect(body).toContain("hashtextextended('business_os_boost_cap' || chr(58) || p_user_id::text, 0)");
    }
    expect(setBody).toContain("out_status := 'no_plan_row'");
    expect(setBody).toContain("ended_reason = 'replaced'");
    expect(setBody.indexOf('UPDATE public.business_os_boost_cap_overrides')).toBeLessThan(setBody.indexOf('INSERT INTO public.business_os_boost_cap_overrides'));
    expect(endBody).toContain("out_status := 'none_active'");
    expect(endBody).toContain("out_status := 'ended'");
  });

  it('no function writes lineage, plan rows or a lot (R-2, G-1)', () => {
    for (const fn of Object.values(FUNCTIONS)) {
      const text = functionText(fn.name, fn.tag);
      expect(text).not.toMatch(/business_os_account_lineage|business_os_record_credit_lot|business_os_credit_lots/);
      expect(text).not.toMatch(/(?:INSERT INTO|UPDATE) public\.business_os_account_plans/);
    }
  });
});

describe('the checker (§6.2, SA C-3)', () => {
  it('is read-only and one SELECT, with B1 to B10 and a verdict', () => {
    expect(checker.startsWith('SET default_transaction_read_only = on;')).toBe(true);
    // Literals stripped first: the checker names privileges such as 'INSERT' as data.
    expect(checker.replace(/'[^']*'/g, "''").replace(/\s+/g, ' ')).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE)\b/);
    for (const row of ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10']) expect(checker).toContain(`'${row} `);
    expect(checker).toContain("'VERDICT'");
  });

  it('names every constraint, index, policy and function the migration creates (drift guard)', () => {
    const names = [
      ...flat.matchAll(/ADD CONSTRAINT (\w+)/g),
      ...flat.matchAll(/CREATE (?:UNIQUE )?INDEX (\w+)/g),
      ...flat.matchAll(/CREATE POLICY (\w+)/g),
    ].map((match) => match[1]);
    for (const name of names.filter((n) => !n.endsWith('_owner_select'))) expect(checker).toContain(name);
    for (const fn of Object.values(FUNCTIONS)) expect(checker).toContain(`'${fn.name}'`);
  });

  it('B8 is INFO, never FAIL, and holds the md5 of the four existing function bodies (SA C-3)', () => {
    const lots = read(LOTS_MIGRATION).replace(/\r/g, '');
    const charges = read(CHARGES_MIGRATION).replace(/\r/g, '');
    const expected = {
      business_os_record_credit_lot: md5(functionBody(lots, 'record_lot')),
      business_os_reverse_credit_lot: md5(functionBody(lots, 'reverse_lot')),
      business_os_record_credit_charge: md5(functionBody(charges, 'record')),
      business_os_credit_period_start: md5(functionBody(charges, 'period')),
    };
    for (const [name, hash] of Object.entries(expected)) {
      expect(checker).toContain(`pg_proc.proname = '${name}' AND md5(replace(pg_proc.prosrc, chr(13), '')) = '${hash}'`);
    }
    const b8 = checker.slice(checker.indexOf("'B8 "), checker.indexOf("'B9 "));
    expect(b8).toContain("'INFO'");
    expect(b8).not.toContain("'FAIL'");
    expect(b8).not.toContain("'PASS'");
  });

  it('the workplan §6.7 lists the same four md5 values (the PROD pre-check stop condition)', () => {
    // The 2a function md5s were added to the checker by slice 2b and are listed in the 2b workplan.
    const workplan = read(WORKPLAN) + read(WORKPLAN_2B);
    for (const hash of [...checker.matchAll(/md5\(replace\(pg_proc\.prosrc, chr\(13\), ''\)\) = '([0-9a-f]{32})'/g)].map((m) => m[1])) {
      expect(workplan).toContain(hash);
    }
  });

  it('QA-D1 (R-1): B7 counts doubled active overrides per live account only; detached ones are an INFO count', () => {
    const b7 = checker.slice(checker.indexOf('integrity_summary AS ('), checker.indexOf('baseline_bodies AS ('));
    expect(b7).toContain('WHERE override_row.ended_at IS NULL AND override_row.user_id IS NOT NULL\n                GROUP BY override_row.user_id');
    expect(b7).toContain('WHERE override_row.ended_at IS NULL AND override_row.user_id IS NULL) AS detached_active_overrides');
    const start73 = checker.indexOf("'B7 active overrides detached by account deletion'");
    const row73 = checker.slice(start73, checker.indexOf('UNION ALL', start73));
    expect(row73).toContain("'INFO'");
    expect(row73).not.toContain("'FAIL'");
  });

  it('B3 checks that service_role bypasses RLS, which the INVOKER functions rely on', () => {
    expect(checker).toContain('pg_roles.rolname = \'service_role\' AND pg_roles.rolbypassrls');
  });
});

describe('the probe (§6.3)', () => {
  const probeFlat = probe.replace(/\s+/g, ' ');

  it('is one DO block that always ends in RAISE EXCEPTION … PROBE', () => {
    expect(probe.trim().startsWith('DO $probe$')).toBe(true);
    expect(probe.trim().endsWith('$probe$;')).toBe(true);
    expect(probeFlat).toContain("RAISE EXCEPTION USING MESSAGE = 'PROBE ' || CASE WHEN v_fail THEN 'FAIL' ELSE 'PASS' END || ' this error is expected and rolls everything back' || v_report;");
  });

  it('runs its five guards before any role switch or write', () => {
    const firstSwitch = probe.indexOf('SET LOCAL ROLE');
    const guards = [
      "PROBE SKIPPED  replace PASTE_YOUR_OWN_USER_ID_HERE",
      'PROBE SKIPPED  the pasted value is not a valid user id',
      'PROBE SKIPPED  this session is read only',
      'PROBE SKIPPED  that user id is not an account on this database',
      'PROBE SKIPPED  that account has no Business OS plan row',
      'PROBE SKIPPED  that account already has boost purchases or cap overrides',
    ].map((text) => probe.indexOf(text));
    expect(guards.every((index) => index > 0 && index < firstSwitch)).toBe(true);
    expect([...guards].sort((a, b) => a - b)).toEqual(guards);
    expect(probe.indexOf('INSERT INTO')).toBeGreaterThan(guards[guards.length - 1]);
  });

  it('has every id P00 to P16, and no P17 (removed from PROD by the user, 2026-10-06)', () => {
    for (let id = 0; id <= 16; id += 1) expect(probe).toContain(`'P${String(id).padStart(2, '0')} `);
    expect(probe).not.toContain('P17');
  });

  it('never writes to auth.users: the PROD runbook only reads it (user decision 2026-10-06)', () => {
    expect(probe).not.toMatch(/\b(?:INSERT\s+INTO|DELETE\s+FROM|UPDATE|TRUNCATE)\s+auth\.users\b/i);
    expect(probe).toContain('FROM auth.users AS auth_user WHERE auth_user.id = v_owner');
    // Negative control: the pattern catches both writes.
    for (const planted of ['INSERT INTO auth.users (id) VALUES (v_x);', 'DELETE FROM auth.users WHERE id = v_x;']) {
      expect(planted).toMatch(/\b(?:INSERT\s+INTO|DELETE\s+FROM|UPDATE|TRUNCATE)\s+auth\.users\b/i);
    }
  });

  it('QA R-2, R-4, R-5, R-7: the stale reservation, the exact cap edge, a filter on a hidden column and a reused session', () => {
    const p02 = probe.slice(probe.indexOf("'P01 PASS"), probe.indexOf("'P02 PASS"));
    expect(p02).toContain('v_third.out_counted_minor = 2000');
    expect(p02).toContain("business_os_reserve_boost_purchase(v_owner, false, 'starter', 1, 1, 1, 1, 'USD', 5, 0, 3000, 30, 1800)");
    const p06 = probe.slice(probe.indexOf("'P05 "), probe.indexOf("'P06 PASS"));
    expect(p06).toContain("business_os_attach_boost_checkout(v_owner, v_stale_id, v_session_two, v_now + interval '30 minutes')");
    expect(p06).toContain("IF v_status.out_status <> 'reservation_expired' THEN");
    expect(p06).toContain("business_os_attach_boost_checkout(v_owner, v_third.out_purchase_id, v_session_one, v_now + interval '30 minutes')");
    expect(p06).toContain('EXCEPTION WHEN unique_violation THEN');
    const p13 = probe.slice(probe.indexOf('SET LOCAL ROLE authenticated;'), probe.indexOf("'P13 PASS"));
    expect(p13).toContain('WHERE purchase_row.flag_reason IS NULL');
  });

  it('SA C-1: P11 inserts status, lot_id, paid_at and ended_at directly and expects 42501', () => {
    const p11 = probe.slice(probe.indexOf("v_text := '';", probe.indexOf("'P10 ")), probe.indexOf("'P11 PASS"));
    for (const column of ['status)', 'lot_id)', 'paid_at)', 'ended_at)']) expect(p11).toContain(column);
    expect(p11).toContain('EXCEPTION WHEN insufficient_privilege THEN NULL;');
  });

  it('SA CR-3: P06 attaches with an expiry at now and 25 hours out and expects 22023 for both', () => {
    const p06 = probe.slice(probe.indexOf("'P05 "), probe.indexOf("'P06 PASS"));
    expect(p06).toContain('v_session_two, v_now);');
    expect(p06).toContain("v_session_two, v_now + interval '25 hours');");
    expect(p06.match(/EXCEPTION WHEN invalid_parameter_value THEN/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it('switches to service_role before its first function call and uses the request jwt claims form for RLS steps', () => {
    expect(probe.indexOf('SET LOCAL ROLE service_role;')).toBeLessThan(probe.indexOf('business_os_reserve_boost_purchase('));
    expect(probe).toContain("set_config(concat_ws(chr(46), 'request', 'jwt', 'claims'),");
  });
});

describe('the rollback (§6.4)', () => {
  it('lives outside supabase/migrations, locks both tables, refuses with rows, then drops the five functions and both tables', () => {
    expect(ROLLBACK.startsWith(MIGRATIONS_DIR)).toBe(false);
    const order = [
      `LOCK TABLE ${PURCHASES} IN ACCESS EXCLUSIVE MODE;`,
      `LOCK TABLE ${OVERRIDES} IN ACCESS EXCLUSIVE MODE;`,
      'ROLLBACK REFUSED the boost purchase tables hold rows so nothing was dropped',
      ...Object.values(FUNCTIONS).reverse().map((fn) => `DROP FUNCTION public.${fn.name}(${fn.signature});`),
      `DROP TABLE ${OVERRIDES};`,
      `DROP TABLE ${PURCHASES};`,
    ].map((needle) => {
      const index = rollbackFlat.indexOf(needle);
      expect({ needle, found: index >= 0 }).toEqual({ needle, found: true });
      return index;
    });
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(rollbackFlat.match(/DROP /g)).toHaveLength(7);
  });
});
