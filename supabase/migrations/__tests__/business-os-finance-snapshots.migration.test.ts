/**
 * Finance slice 8.1 (§11M.6, AC-273 to AC-277): the history snapshots table,
 * migration 20261078, its rollback, checks 31 and 32 and the local self-test.
 * Workplan docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_8_1_SNAPSHOTS_MIGRATION_WORKPLAN.md.
 *
 * Source pins only: the behaviour (each CHECK, the grants, the idempotent key,
 * the refusing rollback, the mutations the checker catches) is proven on the
 * PGlite harness and recorded in the workplan. Every rule here has a planted
 * negative control.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { SNAPSHOT_DIMENSION_SHAPE, SNAPSHOT_METRIC_SHAPE } from '@/lib/business-os/finance/financeSnapshotShape';
import { FINANCE_GROUP_SHAPE } from '@/app/admin/finance/financeUrl';

const ROOT = process.cwd();
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n');

const MIGRATION = read('supabase', 'migrations', '20261078_business_os_finance_snapshots.sql');
const ROLLBACK = read('supabase', 'SQL Scripts', '20261078_business_os_finance_snapshots_rollback.sql');
const CHECK_31 = read('scripts', 'precheck-bos-finance-snapshots.sql');
const CHECK_32 = read('scripts', 'check-bos-finance-snapshots-migration.sql');
const SELFTEST = read('scripts', 'test-bos-finance-snapshots.sql');
const TABLE = 'public.business_os_finance_snapshots';

/** The statements of a migration, in order, one line each. */
const statements = (sql: string) =>
  sql
    .split(/;\n/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

function createTable(sql: string): string {
  const start = sql.indexOf(`CREATE TABLE ${TABLE} (`);
  expect(start).toBeGreaterThanOrEqual(0);
  return sql.slice(start, sql.indexOf(');\n', start) + 2);
}

/** The pattern text inside `CHECK (<column> ~ '<pattern>')`. */
function checkPattern(sql: string, constraint: string, column: string): string | null {
  const line = sql.split('\n').find((l) => l.includes(`ADD CONSTRAINT ${constraint} CHECK`));
  const match = line ? new RegExp(`CHECK \\(${column} ~ '([^']*)'\\);`).exec(line) : null;
  return match ? match[1] : null;
}

const EXPECTED_ORDER = [
  /^BEGIN$/,
  /^SET LOCAL lock_timeout = '5s'$/,
  /^CREATE TABLE public\.business_os_finance_snapshots \(/,
  /ADD CONSTRAINT business_os_finance_snapshots_metric_shape CHECK/,
  /ADD CONSTRAINT business_os_finance_snapshots_dimension_shape CHECK/,
  /ADD CONSTRAINT business_os_finance_snapshots_unit_known CHECK/,
  /ADD CONSTRAINT business_os_finance_snapshots_value_not_negative CHECK/,
  /ADD CONSTRAINT business_os_finance_snapshots_accounts_whole CHECK/,
  /ADD CONSTRAINT business_os_finance_snapshots_day_ended CHECK/,
  /^CREATE UNIQUE INDEX business_os_finance_snapshots_day_metric_key ON public\.business_os_finance_snapshots \(as_of_date, metric, dimension\)$/,
  /^COMMENT ON TABLE public\.business_os_finance_snapshots IS '/,
  /^ALTER TABLE public\.business_os_finance_snapshots ENABLE ROW LEVEL SECURITY$/,
  /^REVOKE ALL ON TABLE public\.business_os_finance_snapshots FROM PUBLIC$/,
  /^REVOKE ALL ON TABLE public\.business_os_finance_snapshots FROM anon$/,
  /^REVOKE ALL ON TABLE public\.business_os_finance_snapshots FROM authenticated$/,
  /^REVOKE ALL ON TABLE public\.business_os_finance_snapshots FROM service_role$/,
  /^GRANT SELECT ON TABLE public\.business_os_finance_snapshots TO service_role$/,
  /^GRANT INSERT \(as_of_date, metric, dimension, unit, value\) ON TABLE public\.business_os_finance_snapshots TO service_role$/,
  /^NOTIFY pgrst, 'reload schema'$/,
  /^COMMIT;?$/,
];

describe('AC-273: one transaction, in the house order (20261072 style, E-89)', () => {
  it('has exactly the expected statements, in order', () => {
    const got = statements(MIGRATION);
    expect(got).toHaveLength(EXPECTED_ORDER.length);
    got.forEach((statement, i) => expect({ i, statement, ok: EXPECTED_ORDER[i].test(statement) }).toEqual({ i, statement, ok: true }));
  });

  it('planted: a GRANT UPDATE added before NOTIFY breaks the order pin', () => {
    const planted = MIGRATION.replace('NOTIFY pgrst', `GRANT UPDATE ON TABLE ${TABLE} TO service_role;\n\nNOTIFY pgrst`);
    const got = statements(planted);
    expect(got.length === EXPECTED_ORDER.length && got.every((s, i) => EXPECTED_ORDER[i].test(s))).toBe(false);
  });
});

describe('AC-273: the table', () => {
  it('has the seven columns with their types, NOT NULLs, defaults and the inline primary key', () => {
    const t = createTable(MIGRATION).replace(/\s+/g, ' ');
    expect(t).toBe(
      `CREATE TABLE ${TABLE} ( id uuid NOT NULL DEFAULT gen_random_uuid(), as_of_date date NOT NULL, metric text NOT NULL, ` +
        'dimension text NOT NULL, unit text NOT NULL, value numeric(18,6) NOT NULL, taken_at timestamptz NOT NULL DEFAULT now(), ' +
        'CONSTRAINT business_os_finance_snapshots_pkey PRIMARY KEY (id) );'
    );
  });

  it('HS-W-8: no user_id (or any account) token anywhere in the CREATE TABLE statement', () => {
    expect(createTable(MIGRATION)).not.toMatch(/user_id|account_id|email/);
    expect(/user_id/.test(createTable(MIGRATION).replace('taken_at timestamptz', 'user_id uuid, taken_at timestamptz'))).toBe(true);
  });

  it('the six CHECKs, exactly', () => {
    const lines = MIGRATION.split('\n').filter((l) => l.includes('ADD CONSTRAINT'));
    expect(lines).toEqual([
      `ALTER TABLE ${TABLE} ADD CONSTRAINT business_os_finance_snapshots_metric_shape CHECK (metric ~ '^[a-z][a-z0-9_]{0,47}$');`,
      `ALTER TABLE ${TABLE} ADD CONSTRAINT business_os_finance_snapshots_dimension_shape CHECK (dimension ~ '^([a-z][a-z0-9_]{0,47}|tier:[a-z0-9_-]{1,40})$');`,
      `ALTER TABLE ${TABLE} ADD CONSTRAINT business_os_finance_snapshots_unit_known CHECK (unit IN ('accounts', 'credits'));`,
      `ALTER TABLE ${TABLE} ADD CONSTRAINT business_os_finance_snapshots_value_not_negative CHECK (value >= 0);`,
      `ALTER TABLE ${TABLE} ADD CONSTRAINT business_os_finance_snapshots_accounts_whole CHECK (unit <> 'accounts' OR value = trunc(value));`,
      `ALTER TABLE ${TABLE} ADD CONSTRAINT business_os_finance_snapshots_day_ended CHECK (taken_at >= ((as_of_date + 1)::timestamp AT TIME ZONE 'UTC'));`,
    ]);
  });

  it('E-86 / E-90: both shape CHECKs equal the exported shape constants; the tier branch equals Finance’s group shape', () => {
    expect(checkPattern(MIGRATION, 'business_os_finance_snapshots_metric_shape', 'metric')).toBe(SNAPSHOT_METRIC_SHAPE.source);
    expect(checkPattern(MIGRATION, 'business_os_finance_snapshots_dimension_shape', 'dimension')).toBe(SNAPSHOT_DIMENSION_SHAPE.source);
    const tierOfGroups = /tier:\[[^\]]+\]\{\d+,\d+\}/.exec(FINANCE_GROUP_SHAPE.source)?.[0];
    const tierOfSnapshots = /tier:\[[^\]]+\]\{\d+,\d+\}/.exec(SNAPSHOT_DIMENSION_SHAPE.source)?.[0];
    expect(tierOfGroups).toBe('tier:[a-z0-9_-]{1,40}');
    expect(tierOfSnapshots).toBe(tierOfGroups);
  });

  it('planted: the pre-E-86 dimension pattern no longer equals the constant', () => {
    const planted = MIGRATION.replace("'^([a-z][a-z0-9_]{0,47}|tier:[a-z0-9_-]{1,40})$'", "'^[a-z][a-z0-9_:]{0,47}$'");
    expect(checkPattern(planted, 'business_os_finance_snapshots_dimension_shape', 'dimension')).not.toBe(SNAPSHOT_DIMENSION_SHAPE.source);
  });

  it('the shapes refuse a uuid and free text, and admit a hyphenated tier key (the constants the builder will use)', () => {
    for (const ok of ['all', 'founding_partner', 'tier:pro-plus', 'tier:a_b-c']) expect(SNAPSHOT_DIMENSION_SHAPE.test(ok)).toBe(true);
    for (const bad of ['1a2b3c4d-1111-4111-8111-abcdefabcdef', 'has space', 'a@b', 'Upper', 'tier:', 'tier:x y', 'a'.repeat(49)]) {
      expect({ bad, ok: SNAPSHOT_DIMENSION_SHAPE.test(bad) }).toEqual({ bad, ok: false });
    }
    for (const bad of ['has space', '9lead', 'tier:pro']) expect(SNAPSHOT_METRIC_SHAPE.test(bad)).toBe(false);
  });

  it('one unique, non-partial key and no other index', () => {
    expect(MIGRATION.match(/CREATE (UNIQUE )?INDEX/g)).toEqual(['CREATE UNIQUE INDEX']);
    expect(MIGRATION).toContain(
      `CREATE UNIQUE INDEX business_os_finance_snapshots_day_metric_key ON ${TABLE} (as_of_date, metric, dimension);`
    );
  });
});

describe('AC-273: RLS on, no policy, exact grants, nothing else', () => {
  it('no policy, trigger, function, sequence, view or SECURITY DEFINER', () => {
    for (const banned of [/CREATE POLICY/i, /CREATE (OR REPLACE )?TRIGGER/i, /CREATE (OR REPLACE )?FUNCTION/i, /CREATE SEQUENCE/i, /CREATE (OR REPLACE )?VIEW/i, /SECURITY DEFINER/i]) {
      expect({ banned: String(banned), hit: banned.test(MIGRATION) }).toEqual({ banned: String(banned), hit: false });
    }
  });

  it('grants: SELECT and five INSERT columns to service_role only; no UPDATE, DELETE, TRUNCATE or ALL; no client role', () => {
    const grants = MIGRATION.split('\n').filter((l) => /^GRANT /.test(l));
    expect(grants).toEqual([
      `GRANT SELECT ON TABLE ${TABLE} TO service_role;`,
      `GRANT INSERT (as_of_date, metric, dimension, unit, value) ON TABLE ${TABLE} TO service_role;`,
    ]);
    expect(MIGRATION).not.toMatch(/GRANT[^;]*(UPDATE|DELETE|TRUNCATE|\bALL\b)/i);
    expect(MIGRATION).not.toMatch(/GRANT[^;]*TO (anon|authenticated|PUBLIC)/i);
    expect(/GRANT[^;]*UPDATE/i.test(`${MIGRATION}\nGRANT UPDATE ON TABLE ${TABLE} TO service_role;`)).toBe(true);
  });
});

describe('AC-275: the rollback refuses while the table holds a row', () => {
  it('lock, refusal, drop, NOTIFY, COMMIT, in that order, and it drops nothing else', () => {
    const order = ['BEGIN;', "SET LOCAL lock_timeout = '5s';", `LOCK TABLE ${TABLE} IN ACCESS EXCLUSIVE MODE;`, 'DO $refuse$', `IF EXISTS (SELECT 1 FROM ${TABLE}) THEN`, 'ROLLBACK REFUSED', `DROP TABLE ${TABLE};`, "NOTIFY pgrst, 'reload schema';", 'COMMIT;'];
    let at = -1;
    for (const part of order) {
      const next = ROLLBACK.indexOf(part, at + 1);
      expect({ part, found: next > at }).toEqual({ part, found: true });
      at = next;
    }
    expect(ROLLBACK.match(/\bDROP\b/g)).toHaveLength(1);
  });

  it('planted: a rollback without its refusal block is caught', () => {
    const planted = ROLLBACK.replace(/DO \$refuse\$[\s\S]*?\$refuse\$;/, '');
    expect(planted.includes('ROLLBACK REFUSED')).toBe(false);
  });
});

describe('AC-274: paste safety over the migration, the rollback and checks 31 and 32', () => {
  const PASTED = { migration: MIGRATION, rollback: ROLLBACK, check31: CHECK_31, check32: CHECK_32 };
  const nonAscii = (s: string) => /[^\x00-\x7F]/.test(s);
  const editorWord = (s: string) => /\binto\b/i.test(s);
  /** A doubled quote inside a literal, or an apostrophe inside a line comment. */
  const apostrophe = (s: string) => /''/.test(s) || s.split('\n').some((l) => l.includes('--') && l.slice(l.indexOf('--')).includes("'"));

  it.each(Object.entries(PASTED))('%s: ASCII only, never the editor word, no apostrophe in a literal or a comment', (_name, text) => {
    expect({ nonAscii: nonAscii(text), editorWord: editorWord(text), apostrophe: apostrophe(text) }).toEqual({
      nonAscii: false,
      editorWord: false,
      apostrophe: false,
    });
  });

  it('the migration and the rollback carry no comment line', () => {
    for (const text of [MIGRATION, ROLLBACK]) expect(text).not.toMatch(/^\s*--/m);
  });

  it('planted: each rule bites', () => {
    expect(nonAscii(`${MIGRATION}é`)).toBe(true);
    expect(editorWord('-- copy rows into the table')).toBe(true);
    expect(apostrophe("-- the job's run")).toBe(true);
    expect(apostrophe("SELECT 'it''s'")).toBe(true);
  });
});

describe('checks 31 and 32 (E-91, E-93)', () => {
  const items = (sql: string) => [...sql.matchAll(/select '([^']+)'(?: as item)?,/g)].map((m) => m[1]);

  it('each is one statement with a header naming 20261078', () => {
    for (const sql of [CHECK_31, CHECK_32]) {
      expect(sql.replace(/--.*$/gm, '').trim().split(';').filter((s) => s.trim())).toHaveLength(1);
      expect(sql).toContain('migration 20261078');
    }
  });

  it('check 31 has its six items', () => {
    expect(items(CHECK_31)).toEqual([
      'snapshots table absent',
      'snapshot key index name free',
      'no constraint already uses the snapshot table name',
      'service_role exists and bypasses row level security',
      'gen_random_uuid is available',
      'cron run record installed',
    ]);
  });

  it('check 32 has its sixteen items (SA-W-8.1-4: the uuid row dropped)', () => {
    expect(items(CHECK_32)).toEqual([
      'table exists',
      'row level security on',
      'no policy on the table',
      'anon has no privilege on the table or any column',
      'authenticated has no privilege on the table or any column',
      'service_role can select',
      'service_role can insert exactly five columns',
      'service_role cannot set id or taken_at',
      'service_role cannot update',
      'service_role cannot delete or truncate',
      'seven columns and no user_id column',
      'unique key on day, metric and dimension, not partial',
      'the six checks are present',
      'dimension check is exactly the E-86 pattern',
      'no trigger on the table',
      'table comment present',
    ]);
  });

  it('check 32 names the six CHECKs and the key as the migration does, and holds the exact E-86 pattern', () => {
    for (const name of (MIGRATION.match(/ADD CONSTRAINT (\w+)/g) ?? []).map((m) => m.replace('ADD CONSTRAINT ', ''))) {
      expect(CHECK_32).toContain(`'${name}'`);
    }
    expect(CHECK_32).toContain("'business_os_finance_snapshots_day_metric_key'");
    expect(CHECK_32).toContain(`position('${SNAPSHOT_DIMENSION_SHAPE.source}' in pg_catalog.pg_get_constraintdef(c.oid))`);
  });
});

describe('AC-276: the local-only self-test', () => {
  it('its four refusals come before the first role switch', () => {
    const firstRole = SELFTEST.indexOf('SET LOCAL ROLE');
    for (const guard of ["current_setting('bos.selftest_local', true)", "to_regclass('auth.refresh_tokens') IS NOT NULL", "current_setting('transaction_read_only')", 'apply migration 20261078 first']) {
      const at = SELFTEST.indexOf(guard);
      expect({ guard, before: at > -1 && at < firstRole }).toEqual({ guard, before: true });
    }
  });

  it('8.1-R2: UTC dates only, never current_date', () => {
    expect(SELFTEST.replace(/--.*$/gm, '')).not.toMatch(/current_date/i);
    expect(SELFTEST).toContain("(now() AT TIME ZONE 'UTC')::date - 3");
  });

  it('holds every in-script case, S-01 to S-19', () => {
    for (let i = 1; i <= 19; i += 1) {
      const id = `S-${String(i).padStart(2, '0')}`;
      expect({ id, present: SELFTEST.includes(`-- ${id} `) }).toEqual({ id, present: true });
    }
  });

  it('the editor word appears only as the INSERT INTO keyword', () => {
    expect(SELFTEST.replace(/INSERT INTO/g, '')).not.toMatch(/\binto\b/i);
  });
});
