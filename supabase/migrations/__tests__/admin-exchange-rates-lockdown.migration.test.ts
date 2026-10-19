/**
 * Guard over migration 20261082, admin exchange rates slice 1b (database record
 * and lockdown). Requirement docs/requirements/ADMIN_EXCHANGE_RATES_REQUIREMENT.md
 * §5.2, §8 slice 1b, SA rulings SQ-2, SA-R14 and SA-R15; workplan
 * docs/workplans/ADMIN_EXCHANGE_RATES_SLICE_1B_WORKPLAN.md.
 *
 * The migration records public.exchange_rates and public.exchange_rate_history
 * as they are live, drops both profiles.role policies (no is_platform_admin()
 * policy replaces them, SQ-2), keeps the enabled-rows read for the currency
 * picker, closes the browser roles, and pins the history trigger function's
 * search_path WITHOUT re-creating it (SA-R14: its body holds the word that
 * breaks the Supabase SQL editor).
 *
 * WHY A TEST OVER SQL TEXT: there is no branch database. The user pastes the
 * migration, check 35 and, if ever needed, the rollback into the Supabase SQL
 * editor by hand. Same pattern as the SECDEF slice 5 and RLS slice 2c tests.
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const NUMBER = '20261082';
const MIGRATION_FILE = join(ROOT, 'supabase', 'migrations', `${NUMBER}_admin_exchange_rates_lockdown.sql`);
const ROLLBACK_FILE = join(ROOT, 'supabase', 'SQL Scripts', `${NUMBER}_admin_exchange_rates_lockdown_rollback.sql`);
const CHECK_35_FILE = join(ROOT, 'scripts', 'check-bos-exchange-rates-write-access.sql');
const DEFINITIONS_FILE = join(ROOT, 'docs', 'investigations', 'SECDEF_PROD_ONLY_FUNCTION_DEFINITIONS.md');

const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const migration = read(MIGRATION_FILE);
const rollback = read(ROLLBACK_FILE);
const check35 = read(CHECK_35_FILE);

const FUNCTION = 'public.log_exchange_rate_change()';
const PINNED = 'search_path=public, pg_temp';
const KEPT_POLICY = 'Users can read enabled exchange rates';
const RATES_ADMIN_POLICY = 'Admins can manage exchange rates';
const HISTORY_ADMIN_POLICY = 'Admins can read exchange rate history';

/**
 * The live secondary indexes (pg_indexes.indexdef, read-only query on prod,
 * 2026-10-19), in migration order. With the primary and unique keys,
 * exchange_rates has 4 indexes and exchange_rate_history 3.
 */
const LIVE_INDEXES = [
  'CREATE INDEX idx_exchange_rates_currency_code ON public.exchange_rates USING btree (currency_code)',
  'CREATE INDEX idx_exchange_rates_enabled ON public.exchange_rates USING btree (is_enabled)',
  'CREATE INDEX idx_exchange_rate_history_changed_at ON public.exchange_rate_history USING btree (changed_at)',
  'CREATE INDEX idx_exchange_rate_history_currency ON public.exchange_rate_history USING btree (currency_code)',
];

/** Single-quoted string literals. */
function literalsOf(sql: string): string[] {
  return [...sql.matchAll(/'([^']*)'/g)].map((match) => match[1]);
}

/** The DO $$ ... $$ blocks, and the SQL with them cut out. */
function splitDoBlocks(sql: string): { blocks: string[]; rest: string } {
  const blocks = [...sql.matchAll(/DO \$\$[\s\S]*?\n\$\$;/g)].map((match) => match[0]);
  let rest = sql;
  for (const block of blocks) rest = rest.replace(block, 'DO_BLOCK;');
  return { blocks, rest };
}

/** Non-empty statements, whitespace collapsed, without the trailing semicolon. */
function statementsOf(sql: string): string[] {
  return sql
    .split(';')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** Column lines of `CREATE TABLE IF NOT EXISTS public.<table> (...)`, constraints excluded. */
function recordedColumns(sql: string, table: string): Array<{ name: string; type: string; notNull: boolean; def: string }> {
  const start = sql.indexOf(`CREATE TABLE IF NOT EXISTS public.${table} (`);
  expect(start).toBeGreaterThanOrEqual(0);
  const body = sql.slice(sql.indexOf('(', start) + 1, sql.indexOf('\n);', start));
  return body
    .split(',\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('CONSTRAINT'))
    .map((line) => {
      const match = /^(\w+) (.+?)( NOT NULL)?( DEFAULT (.+))?$/.exec(line);
      expect(match).not.toBeNull();
      return { name: match![1], type: match![2], notNull: Boolean(match![3]), def: match![5] ?? 'none' };
    });
}

function recordedConstraints(sql: string, table: string): string[] {
  const start = sql.indexOf(`CREATE TABLE IF NOT EXISTS public.${table} (`);
  const body = sql.slice(start, sql.indexOf('\n);', start));
  return [...body.matchAll(/CONSTRAINT (\w+) (PRIMARY KEY|UNIQUE|CHECK|FOREIGN KEY)/g)].map((m) => `${m[1]} ${m[2]}`);
}

/** check 35 expected_column VALUES rows. */
function checkExpectedColumns(): Array<{ table: string; name: string; type: string; notNull: boolean; def: string }> {
  return [...check35.matchAll(/\('(exchange_rates|exchange_rate_history)', '(\w+)', '([^']+)', (true|false), '([^']+)'\)/g)].map((m) => ({
    table: m[1],
    name: m[2],
    type: m[3],
    notNull: m[4] === 'true',
    def: m[5],
  }));
}

/** Punctuated literals each file may hold. Everything else must be letters, digits, underscores and spaces. */
const PUNCTUATED_ALLOWED: Record<string, string[]> = {
  migration: ['5s', FUNCTION, PINNED, 'pg_catalog.pg_proc', 'pg_catalog.pg_trigger', 'public.exchange_rates', 'public.', '^[A-Z]{3}$', '(is_enabled = true)', '%profiles%'],
  rollback: ['5s', FUNCTION, 'public.'],
};
const PLAIN = /^[A-Za-z0-9_ ]*$/;

describe('number and files (SA-R15)', () => {
  it.each([MIGRATION_FILE, ROLLBACK_FILE, CHECK_35_FILE])('%s exists', (file) => {
    expect(existsSync(file)).toBe(true);
  });

  it(`${NUMBER} is used by exactly this migration and its rollback`, () => {
    const holders = [
      ...readdirSync(join(ROOT, 'supabase', 'migrations')).map((f) => `migrations/${f}`),
      ...readdirSync(join(ROOT, 'supabase', 'SQL Scripts')).map((f) => `SQL Scripts/${f}`),
      ...readdirSync(join(ROOT, 'supabase', 'held')).map((f) => `held/${f}`),
    ].filter((f) => f.includes(NUMBER));
    expect(holders.sort()).toEqual([
      `SQL Scripts/${NUMBER}_admin_exchange_rates_lockdown_rollback.sql`,
      `migrations/${NUMBER}_admin_exchange_rates_lockdown.sql`,
    ]);
  });
});

describe('SQL editor paste safety (migration and rollback)', () => {
  const files: Array<[string, string]> = [
    ['migration', migration],
    ['rollback', rollback],
  ];

  it.each(files)('%s: ASCII only, no comment, never the editor word', (_name, text) => {
    expect(/[^\x00-\x7F]/.test(text)).toBe(false);
    expect(text).not.toContain('--');
    expect(text).not.toContain('/*');
    expect(text).not.toMatch(/into/i);
  });

  it.each(files)('%s: no apostrophe inside a literal', (_name, text) => {
    expect(text).not.toContain("''");
  });

  it.each(files)('%s: every punctuated literal is on the allow-list', (name, text) => {
    const punctuated = literalsOf(text).filter((literal) => !PLAIN.test(literal));
    expect([...new Set(punctuated)].filter((literal) => !PUNCTUATED_ALLOWED[name].includes(literal))).toEqual([]);
  });

  it('check 35 never contains the editor word either', () => {
    expect(check35).not.toMatch(/into/i);
  });

  it('planted: the editor word and the literal rules bite', () => {
    expect('INSERT INTO x').toMatch(/into/i);
    expect(PLAIN.test('a;b')).toBe(false);
    expect(literalsOf("select 'x.y', 'plain'")).toEqual(['x.y', 'plain']);
  });
});

describe('the migration', () => {
  const { blocks, rest } = splitDoBlocks(migration);
  const statements = statementsOf(rest);
  const [precheck, postAssert] = blocks;

  it('is one BEGIN ... COMMIT: lock timeout, pre-check, record, lockdown, post-assert', () => {
    expect(blocks).toHaveLength(2);
    expect(statements[0]).toBe('BEGIN');
    expect(statements[1]).toBe("SET LOCAL lock_timeout = '5s'");
    expect(statements[2]).toBe('DO_BLOCK');
    expect(statements[3]).toMatch(/^CREATE TABLE IF NOT EXISTS public\.exchange_rates \(/);
    expect(statements[4]).toMatch(/^CREATE TABLE IF NOT EXISTS public\.exchange_rate_history \(/);
    expect(statements.slice(5)).toEqual([
      ...LIVE_INDEXES.map((def) => def.replace('CREATE INDEX ', 'CREATE INDEX IF NOT EXISTS ')),
      'ALTER TABLE public.exchange_rates ENABLE ROW LEVEL SECURITY',
      'ALTER TABLE public.exchange_rate_history ENABLE ROW LEVEL SECURITY',
      `DROP POLICY IF EXISTS "${RATES_ADMIN_POLICY}" ON public.exchange_rates`,
      `DROP POLICY IF EXISTS "${HISTORY_ADMIN_POLICY}" ON public.exchange_rate_history`,
      `DROP POLICY IF EXISTS "${KEPT_POLICY}" ON public.exchange_rates`,
      `CREATE POLICY "${KEPT_POLICY}" ON public.exchange_rates AS PERMISSIVE FOR SELECT TO authenticated USING (is_enabled = true)`,
      'REVOKE ALL ON TABLE public.exchange_rates FROM PUBLIC, anon',
      'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.exchange_rates FROM authenticated',
      'REVOKE ALL ON TABLE public.exchange_rate_history FROM PUBLIC, anon',
      'REVOKE ALL ON TABLE public.exchange_rate_history FROM authenticated',
      `ALTER FUNCTION ${FUNCTION} SET search_path = public, pg_temp`,
      `REVOKE EXECUTE ON FUNCTION ${FUNCTION} FROM PUBLIC, anon, authenticated`,
      `GRANT EXECUTE ON FUNCTION ${FUNCTION} TO service_role`,
      'DROP TRIGGER IF EXISTS exchange_rate_change_trigger ON public.exchange_rates',
      `CREATE TRIGGER exchange_rate_change_trigger AFTER UPDATE ON public.exchange_rates FOR EACH ROW EXECUTE FUNCTION ${FUNCTION}`,
      'DO_BLOCK',
      'COMMIT',
    ]);
  });

  it('never re-creates, drops or replaces the function, and never names owner rights (S6 guard stays out of scope)', () => {
    expect(migration).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i);
    expect(migration).not.toMatch(/DROP\s+FUNCTION/i);
    expect(migration).not.toMatch(/SECURITY\s+DEFINER/i);
    expect(migration).not.toMatch(/\bRESET\b/);
  });

  it('SQ-2: no is_platform_admin() policy, no profiles reference, exactly one CREATE POLICY', () => {
    expect(migration).not.toMatch(/is_platform_admin/);
    expect(rest).not.toMatch(/profiles/);
    expect(statements.filter((s) => s.startsWith('CREATE POLICY'))).toHaveLength(1);
  });

  it('never revokes from or touches service_role grants on the tables, and grants nothing to a browser role', () => {
    expect(statements.filter((s) => /^REVOKE .* FROM .*service_role/.test(s))).toEqual([]);
    expect(statements.filter((s) => s.startsWith('GRANT'))).toEqual([`GRANT EXECUTE ON FUNCTION ${FUNCTION} TO service_role`]);
    expect(migration).not.toMatch(/CASCADE/);
  });

  it('authenticated keeps SELECT on exchange_rates (no REVOKE names SELECT or ALL for it there)', () => {
    const ratesFromAuthenticated = statements.filter((s) => /ON TABLE public\.exchange_rates FROM .*authenticated/.test(s));
    expect(ratesFromAuthenticated).toHaveLength(1);
    expect(ratesFromAuthenticated[0]).not.toMatch(/\b(SELECT|ALL)\b/);
  });

  it('the pre-check refuses before any change: function, owner, owner rights, config, tables, trigger, dependents', () => {
    for (const message of [
      'history function missing so nothing was applied',
      'history function owner is not postgres so nothing was applied',
      'history function no longer runs with owner rights so nothing was applied',
      'history function has an unexpected config so nothing was applied',
      'table missing so nothing was applied ',
      'table owner is not postgres so nothing was applied ',
      'history trigger missing so nothing was applied',
      'history trigger is not the recorded one so nothing was applied',
      'history function has dependents other than its trigger so nothing was applied',
      'history function dependent is not its trigger so nothing was applied',
    ]) {
      expect(precheck).toContain(message);
    }
    expect(precheck).toContain("pg_proc.prosecdef");
    expect(precheck).toContain(`IS DISTINCT FROM ARRAY['${PINNED}']::text[]`);
    expect(precheck).toContain('pg_trigger.tgtype = 17');
    expect(precheck).toMatch(/pg_depend\.refobjid = guard_function\) <> 1 THEN/);
    expect(migration.indexOf(precheck)).toBeLessThan(migration.indexOf('CREATE TABLE'));
  });

  it('the post-assert checks every lockdown fact before COMMIT', () => {
    for (const message of [
      'row security is off so nothing was applied ',
      'row security is forced so nothing was applied ',
      'a profiles policy is left so nothing was applied ',
      'column privileges exist so nothing was applied ',
      ' holds ',
      'service_role lacks ',
      'authenticated lost SELECT on exchange_rates so nothing was applied',
      'a policy is left on exchange_rate_history so nothing was applied',
      'exchange_rates policy count is not 1 so nothing was applied',
      'enabled rows read policy is not the recorded one so nothing was applied',
      'history function search_path is not pinned so nothing was applied',
      ' still executes the history function so nothing was applied',
      'service_role lost EXECUTE on the history function so nothing was applied',
      'history trigger missing after the record so nothing was applied',
    ]) {
      expect(postAssert).toContain(message);
    }
    for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) {
      expect(postAssert).toContain(`'${privilege}'`);
    }
    expect(postAssert).toContain("ARRAY['public', 'anon', 'authenticated']");
    expect(postAssert).toContain(
      "CONTINUE WHEN guard_table_name = 'exchange_rates' AND guard_role = 'authenticated' AND guard_privilege = 'SELECT'"
    );
    expect(migration.indexOf(postAssert)).toBeGreaterThan(migration.indexOf('CREATE TRIGGER'));
  });

  it('records the trigger exactly as live (SECDEF_PROD_ONLY_FUNCTION_DEFINITIONS.md), with the function schema-qualified', () => {
    const live = read(DEFINITIONS_FILE).match(/CREATE TRIGGER exchange_rate_change_trigger [^\n]+/);
    expect(live).not.toBeNull();
    const recorded = statements.find((s) => s.startsWith('CREATE TRIGGER'));
    expect(recorded).toBe(live![0].replace('EXECUTE FUNCTION log_exchange_rate_change()', `EXECUTE FUNCTION ${FUNCTION}`));
  });

  it('the search_path pin is safe: the captured body writes only to a schema-qualified table', () => {
    const doc = read(DEFINITIONS_FILE);
    const section = doc.slice(doc.indexOf('### log_exchange_rate_change()'), doc.indexOf('### exchange_rate_change_trigger'));
    expect(section).toMatch(/INSERT INTO public\.exchange_rate_history \(/);
    expect(section).toMatch(/OLD\.rate_to_usd IS DISTINCT FROM NEW\.rate_to_usd/);
    expect(section).not.toMatch(/SET search_path/);
  });

  it('records both tables with the live FK names to auth.users', () => {
    expect(recordedConstraints(migration, 'exchange_rates')).toEqual([
      'exchange_rates_pkey PRIMARY KEY',
      'exchange_rates_currency_code_key UNIQUE',
      'exchange_rates_currency_code_check CHECK',
      'exchange_rates_rate_to_usd_check CHECK',
      'exchange_rates_decimal_places_check CHECK',
      'exchange_rates_updated_by_fkey FOREIGN KEY',
    ]);
    expect(recordedConstraints(migration, 'exchange_rate_history')).toEqual([
      'exchange_rate_history_pkey PRIMARY KEY',
      'exchange_rate_history_changed_by_fkey FOREIGN KEY',
    ]);
    expect(migration).toContain('CONSTRAINT exchange_rates_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users (id)');
    expect(migration).toContain('CONSTRAINT exchange_rate_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES auth.users (id)');
    expect(migration).toContain("CHECK (currency_code ~ '^[A-Z]{3}$')");
    expect(migration).toContain('CHECK (rate_to_usd > 0)');
    expect(migration).toContain('CHECK (decimal_places >= 0 AND decimal_places <= 4)');
  });

  it('planted: the statement list catches a dropped revoke', () => {
    const planted = statementsOf(splitDoBlocks(migration.replace('REVOKE ALL ON TABLE public.exchange_rate_history FROM authenticated;\n', '')).rest);
    expect(planted).not.toContain('REVOKE ALL ON TABLE public.exchange_rate_history FROM authenticated');
  });
});

/**
 * The rollback restores the live grants (anon and authenticated = arwdDxtm on
 * both tables) and the function's unpinned search_path exactly. It does NOT
 * put back the two profiles.role policies: the required admin authz guard
 * (lib/admin/__tests__/admin-authz-surface.guard.test.ts, R5, allow-list
 * pinned at zero) fails any .sql file that creates one, rollbacks included,
 * and profiles.role is user-writable. Since slice 1a no browser path needs
 * them. Their exact text is in the workplan §6 as a manual, SA- and
 * user-gated step (deviation DV-6).
 */
describe('the rollback restores the live grants and search_path, not the profiles.role policies', () => {
  const { blocks, rest } = splitDoBlocks(rollback);
  const statements = statementsOf(rest);

  it('is a warning row, then one BEGIN ... COMMIT with a pre-check and a post-assert', () => {
    expect(blocks).toHaveLength(2);
    expect(statements[0]).toMatch(/^SELECT 'WARNING this rollback gives anon and every signed in user full write access/);
    expect(statements[0]).toContain('does not put back the two profiles role policies');
    expect(statements.slice(1)).toEqual([
      'BEGIN',
      "SET LOCAL lock_timeout = '5s'",
      'DO_BLOCK',
      'GRANT ALL ON TABLE public.exchange_rates TO anon, authenticated',
      'GRANT ALL ON TABLE public.exchange_rate_history TO anon, authenticated',
      `ALTER FUNCTION ${FUNCTION} RESET search_path`,
      'DO_BLOCK',
      'COMMIT',
    ]);
  });

  it('never creates a policy (R5 admin authz guard) and leaves alone what the migration did not change', () => {
    expect(rollback).not.toMatch(/CREATE\s+POLICY|DROP\s+POLICY/i);
    expect(rollback).not.toMatch(/\brole\s*=/);
    expect(rollback).not.toMatch(/service_role\b(?!')/);
    expect(rollback).not.toMatch(/\bREVOKE\b|WITH GRANT OPTION|EXECUTE ON FUNCTION|TRIGGER exchange|ROW LEVEL SECURITY|DROP TABLE|CREATE TABLE/);
  });

  it('the workplan holds the two policies exactly as live, as a gated manual step', () => {
    const workplan = read(join(ROOT, 'docs', 'workplans', 'ADMIN_EXCHANGE_RATES_SLICE_1B_WORKPLAN.md'));
    const PROFILES_ADMIN = "USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'))";
    expect(workplan).toContain(`CREATE POLICY "${RATES_ADMIN_POLICY}" ON public.exchange_rates AS PERMISSIVE FOR ALL TO authenticated ${PROFILES_ADMIN};`);
    expect(workplan).toContain(`CREATE POLICY "${HISTORY_ADMIN_POLICY}" ON public.exchange_rate_history AS PERMISSIVE FOR SELECT TO authenticated ${PROFILES_ADMIN};`);
    expect(workplan).toContain('DV-6');
  });

  it('the post-assert proves the live ACL (all eight privileges for anon, authenticated, service_role), the kept policy and the reset', () => {
    const postAssert = blocks[1];
    for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) {
      expect(postAssert).toContain(`'${privilege}'`);
    }
    expect(postAssert).toContain("ARRAY['anon', 'authenticated', 'service_role']");
    expect(postAssert).toContain(`pg_policies.policyname = '${KEPT_POLICY}'`);
    expect(postAssert).toContain('history function config is not reset so nothing was applied');
  });
});

describe('check 35 (extended by 1b): PASS / FAIL rows', () => {
  it('has a VERDICT row first, PASS only when every check passes', () => {
    expect(check35).toContain("'VERDICT' as check_name");
    expect(check35).toContain("case when exists (select 1 from checks where checks.result <> 'PASS') then 'FAIL' else 'PASS' end as result");
    expect(check35).toContain('order by report.sort_order;');
  });

  it.each([
    'C1 no profiles role policy on ',
    'C2 anon holds no privilege on ',
    'C3 authenticated holds SELECT only on exchange_rates',
    'C4 authenticated holds no privilege on exchange_rate_history',
    'C5 enabled rows read policy present and exact',
    'C6 exactly one policy on exchange_rates and none on exchange_rate_history',
    'C7 row level security on ',
    'C8 service_role keeps SELECT INSERT UPDATE DELETE on ',
    'C9 history function search_path pinned to public, pg_temp',
    'C10 history function EXECUTE held by postgres and service_role only',
    'C11 history trigger fires after update on each row and calls the function',
    'C12 row security not forced on either table',
    'D ',
    'R1 recorded columns match live on ',
    'R2 recorded constraints and indexes match live on ',
  ])('holds the %s row', (name) => {
    expect(check35).toContain(`'${name}`);
  });

  it('checks all eight table privileges, PG17 MAINTAIN included, for anon and for authenticated on history', () => {
    expect(check35).toContain("has_table_privilege('anon', t.tbl, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN')");
    expect(check35).toContain("has_table_privilege('authenticated', t.tbl, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN')");
    expect(check35).toContain("has_table_privilege('authenticated', t.tbl, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN')");
  });

  it('agrees with the migration: pinned value, kept policy, EXECUTE holders, trigger type', () => {
    expect(check35).toContain(`array['${PINNED}']::text[]`);
    expect(check35).toContain(`pp.policyname = '${KEPT_POLICY}'`);
    expect(check35).toContain("pp.qual = '(is_enabled = true)'");
    expect(check35).toContain("(select eg.grantees from exec_grantee eg) = 'postgres service_role'");
    expect(check35).toContain('tg.tgtype = 17');
    expect(migration).toContain('pg_trigger.tgtype = 17');
  });

  it('R1: its expected columns are exactly the columns the migration records', () => {
    const expected = checkExpectedColumns();
    for (const table of ['exchange_rates', 'exchange_rate_history']) {
      const fromCheck = expected.filter((c) => c.table === table).map((c) => ({ name: c.name, type: c.type, notNull: c.notNull, def: c.def }));
      expect(fromCheck).toEqual(recordedColumns(migration, table));
    }
    expect(expected).toHaveLength(17);
  });

  it('R2: its constraint shape and index count agree with the migration record', () => {
    const count = (table: string, kind: string) => recordedConstraints(migration, table).filter((c) => c.endsWith(kind)).length;
    const shape = (table: string) =>
      [['c', 'CHECK'], ['f', 'FOREIGN KEY'], ['p', 'PRIMARY KEY'], ['u', 'UNIQUE']]
        .map(([letter, kind]) => [letter, count(table, kind)] as const)
        .filter(([, n]) => n > 0)
        .map(([letter, n]) => `${letter}=${n}`)
        .join(' ');
    expect(check35).toContain(`when 'exchange_rates' then '${shape('exchange_rates')}' else '${shape('exchange_rate_history')}' end`);
    // Total indexes = the key-backed ones (primary key, unique) plus the recorded CREATE INDEX statements.
    const recordedIndexes = (table: string) => LIVE_INDEXES.filter((def) => def.includes(` ON public.${table} `));
    const indexes = (table: string) => count(table, 'PRIMARY KEY') + count(table, 'UNIQUE') + recordedIndexes(table).length;
    expect([indexes('exchange_rates'), indexes('exchange_rate_history')]).toEqual([4, 3]);
    expect(check35).toContain(`when 'exchange_rates' then ${indexes('exchange_rates')} else ${indexes('exchange_rate_history')} end`);
  });

  it('R2: it expects exactly the live secondary index definitions, in name order, and the migration records each one', () => {
    const quoted = (defs: string[]) => defs.map((def) => `'${def}'`).join("\n                           || ' | ' || ");
    const sortedFor = (table: string) =>
      LIVE_INDEXES.filter((def) => def.includes(` ON public.${table} `)).sort((a, b) => a.split(' ')[2].localeCompare(b.split(' ')[2]));
    expect(check35).toContain(`when 'exchange_rates' then\n                           ${quoted(sortedFor('exchange_rates'))}`);
    expect(check35).toContain(`else\n                           ${quoted(sortedFor('exchange_rate_history'))}`);
    expect(check35).toContain('not i.indisprimary and not i.indisunique');
    for (const def of LIVE_INDEXES) {
      expect(migration).toContain(`${def.replace('CREATE INDEX ', 'CREATE INDEX IF NOT EXISTS ')};`);
    }
  });

  it('C12: row security must not be forced on either table (history has no policy after 1b)', () => {
    expect(check35).toContain('where not c.relforcerowsecurity) = 2');
    expect(migration).toMatch(
      /IF \(SELECT pg_class\.relforcerowsecurity FROM pg_catalog\.pg_class WHERE pg_class\.oid = guard_table_oid\) THEN\s+RAISE EXCEPTION USING MESSAGE = 'Exchange rates 1b row security is forced so nothing was applied '/
    );
  });

  /**
   * Row count, derived from the source: one row per C name, except the per-table
   * C1, C2, C7, C8 (2 each), D (table x browser role = 4), R1 and R2 (2 each).
   * 24 checks plus VERDICT. The expected VERDICT lines are pinned in the
   * workplan §6 so the runbook cannot drift from the checker.
   */
  it('has 24 checks, and the workplan runbook states the before, after and rollback counts', () => {
    const names = [...check35.matchAll(/'(C\d+|D|R\d) /g)].map((m) => m[1]);
    const PER_TABLE = new Set(['C1', 'C2', 'C7', 'C8', 'R1', 'R2']);
    const total = [...new Set(names)].reduce((n, name) => n + (name === 'D' ? 4 : PER_TABLE.has(name) ? 2 : 1), 0);
    expect(total).toBe(24);
    const workplan = read(join(ROOT, 'docs', 'workplans', 'ADMIN_EXCHANGE_RATES_SLICE_1B_WORKPLAN.md'));
    for (const verdict of ['VERDICT FAIL, 12 pass 12 fail', 'VERDICT PASS, 24 pass 0 fail', 'VERDICT FAIL, 15 pass 9 fail']) {
      expect(workplan).toContain(verdict);
    }
  });

  it('planted: a column added to the record without a check 35 row is caught', () => {
    const planted = migration.replace('  change_reason text,\n', '  change_reason text,\n  note text,\n');
    expect(recordedColumns(planted, 'exchange_rate_history')).toHaveLength(8);
    expect(checkExpectedColumns().filter((c) => c.table === 'exchange_rate_history')).toHaveLength(7);
  });
});
