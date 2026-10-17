/**
 * Guard over the boost reversal events migration (finance slice 4b.1,
 * requirement §11I, workplan BUSINESS_OS_FINANCE_HEALTH_SLICE_4B1_REVERSAL_EVENTS_WORKPLAN.md
 * §3, §5, §6 and §8.9; SA-Q65 to SA-Q74, E-65 to E-67, SA-W105 to SA-W115).
 *
 * WHY A TEST OVER SQL TEXT. CI has no database and the user applies the
 * migration by hand on production. What the files alone can prove is pinned
 * here: the lock before the two refusals (E-65, RV-9, SA-W107), the table and
 * its server-only grants (AC-204, AC-205), the unchanged function surface
 * (AC-206), that the new body is the 20261031 body plus exactly six inserts and
 * nothing else (SA-W109, by subtraction), that no lot is touched (AC-213), the
 * rollback (AC-215, SA-Q70), the paste rules, and that checks 23 and 24 carry
 * the hashes these files produce (B1-R3). The behaviour (AC-207 to AC-211) is
 * proven by scripts/test-bos-boost-reversal-events.sql on PGlite (E-66).
 */

import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n');

const migration = read('supabase', 'migrations', '20261076_business_os_boost_reversal_events.sql');
const original = read('supabase', 'migrations', '20261031_business_os_boost_crediting.sql');
const rollback = read('supabase', 'SQL Scripts', '20261076_business_os_boost_reversal_events_rollback.sql');
const check23 = read('scripts', 'precheck-bos-boost-reversal-events.sql');
const check24 = read('scripts', 'check-bos-boost-reversal-events-migration.sql');
const selftest = read('scripts', 'test-bos-boost-reversal-events.sql');

const TABLE = 'public.business_os_boost_reversal_events';
const SIG = 'public.business_os_transition_boost_purchase(uuid, text, text, integer, text, text)';
const TAG = '$transition_purchase$';
const INSERT_COLUMNS = 'purchase_id, kind, amount_minor, cumulative_refunded_minor, currency, stripe_dispute_id, status_before, status_after, livemode';
const INSERT_RE = /^ *INSERT INTO public\.business_os_boost_reversal_events [\s\S]*?DO NOTHING;\n/gm;
const OLD_MD5 = 'b9a5fe318eb25cdc65ba0402b23d7241';
const NEW_MD5 = '018c4447f2b52dd87e4ae3b229e5b42c';

const md5 = (text: string) => createHash('md5').update(text, 'utf8').digest('hex');
const flat = (sql: string) => sql.replace(/\s+/g, ' ');

/** From `CREATE [OR REPLACE] FUNCTION public.business_os_transition_boost_purchase(` to the closing tag and semicolon. */
function functionText(sql: string): string {
  const start = sql.search(/CREATE (OR REPLACE )?FUNCTION public\.business_os_transition_boost_purchase\(/);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf(`${TAG};`, start);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end + TAG.length + 1);
}

/** The text between the dollar tags: what pg_proc.prosrc holds. */
function body(fn: string): string {
  const open = `AS ${TAG}`;
  const start = fn.indexOf(open);
  return fn.slice(start + open.length, fn.indexOf(`${TAG};`, start + open.length));
}

/** Remove the six reversal-event inserts: SA-W109's proof by subtraction. */
const withoutInserts = (text: string) => text.replace(INSERT_RE, '');

const originalFn = functionText(original);
const newFn = functionText(migration);
const newBody = body(newFn);
const inserts = [...newFn.matchAll(INSERT_RE)].map((m) => m[0]);

/** Top-level single-quoted literals (no escaped quotes are used in these files). */
const literalsOf = (sql: string) => [...sql.matchAll(/'([^']*)'/g)].map((m) => m[1]);

describe('20261076: lock, then the two refusals, then the table (E-65, RV-9, SA-W107)', () => {
  it('is one transaction that times out instead of queueing', () => {
    expect(migration.startsWith('BEGIN;\n\nSET LOCAL lock_timeout = \'5s\';\n')).toBe(true);
    expect(migration.trimEnd().endsWith('COMMIT;')).toBe(true);
    expect(migration.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(migration.match(/^COMMIT;$/gm)).toHaveLength(1);
  });

  it('locks the purchases EXCLUSIVE before the assertion, which runs before any DDL', () => {
    const lock = migration.indexOf('LOCK TABLE public.business_os_boost_purchases IN EXCLUSIVE MODE;');
    const assertion = migration.indexOf('DO $no_undated_history$');
    const create = migration.indexOf(`CREATE TABLE ${TABLE}`);
    expect(lock).toBeGreaterThan(migration.indexOf('SET LOCAL lock_timeout'));
    expect(assertion).toBeGreaterThan(lock);
    expect(create).toBeGreaterThan(assertion);
  });

  it('refuses when any purchase has a refund or a dispute id (RV-9, AC-212)', () => {
    expect(migration).toContain(
      'IF EXISTS (SELECT 1 FROM public.business_os_boost_purchases AS purchase_row WHERE purchase_row.amount_refunded_minor > 0 OR purchase_row.stripe_dispute_id IS NOT NULL) THEN'
    );
    expect(migration).toContain("MESSAGE = 'MIGRATION REFUSED  a boost purchase already has a refund or a dispute with no dated event  nothing was applied  stop and tell the session'");
  });

  it('refuses unless the live body hashes to the 20261031 body, and that hash is computed from the file (SA-W107)', () => {
    expect(md5(body(originalFn))).toBe(OLD_MD5);
    expect(migration).toContain(
      `IF (SELECT md5(replace(proc_row.prosrc, chr(13), '')) FROM pg_catalog.pg_proc AS proc_row WHERE proc_row.oid = pg_catalog.to_regprocedure('${SIG}')) IS DISTINCT FROM '${OLD_MD5}' THEN`
    );
  });
});

describe('20261076: the table (AC-204)', () => {
  const create = migration.slice(migration.indexOf(`CREATE TABLE ${TABLE}`), migration.indexOf(');', migration.indexOf(`CREATE TABLE ${TABLE}`)) + 2);

  it('has the eleven columns, their types, NOT NULLs and defaults, and no user_id', () => {
    for (const column of [
      'id uuid NOT NULL DEFAULT gen_random_uuid(),',
      'purchase_id uuid NOT NULL,',
      'kind text NOT NULL,',
      'amount_minor integer NOT NULL,',
      'cumulative_refunded_minor integer NOT NULL,',
      'currency text NOT NULL,',
      'stripe_dispute_id text,',
      'status_before text NOT NULL,',
      'status_after text NOT NULL,',
      'livemode boolean NOT NULL,',
      'recorded_at timestamptz NOT NULL DEFAULT now(),',
      'CONSTRAINT business_os_boost_reversal_events_pkey PRIMARY KEY (id)',
    ]) {
      expect(create).toContain(column);
    }
    // The ownership test's regex would classify a table whose CREATE names user_id (RT §3).
    expect(create).not.toMatch(/\buser_id\b/);
  });

  it('cascades from its purchase and carries the four CHECKs', () => {
    expect(migration).toContain(
      `ALTER TABLE ${TABLE} ADD CONSTRAINT business_os_boost_reversal_events_purchase_id_fkey FOREIGN KEY (purchase_id) REFERENCES public.business_os_boost_purchases (id) ON DELETE CASCADE;`
    );
    expect(migration).toContain("CHECK (kind IN ('refund', 'dispute_opened', 'dispute_won', 'dispute_lost'))");
    expect(migration).toContain('business_os_boost_reversal_events_amount_not_negative CHECK (amount_minor >= 0)');
    expect(migration).toContain('business_os_boost_reversal_events_cumulative_not_negative CHECK (cumulative_refunded_minor >= 0)');
    expect(migration).toContain("business_os_boost_reversal_events_dispute_id_by_kind CHECK ((kind = 'refund') = (stripe_dispute_id IS NULL))");
  });

  it('has the two idempotency keys as partial unique indexes and the two plain indexes', () => {
    expect(migration).toContain(`CREATE UNIQUE INDEX business_os_boost_reversal_events_refund_step_key ON ${TABLE} (purchase_id, cumulative_refunded_minor) WHERE kind = 'refund';`);
    expect(migration).toContain(`CREATE UNIQUE INDEX business_os_boost_reversal_events_dispute_stage_key ON ${TABLE} (purchase_id, kind, stripe_dispute_id) WHERE kind <> 'refund';`);
    expect(migration).toContain(`CREATE INDEX business_os_boost_reversal_events_recorded_at_idx ON ${TABLE} (recorded_at);`);
    expect(migration).toContain(`CREATE INDEX business_os_boost_reversal_events_purchase_id_idx ON ${TABLE} (purchase_id);`);
    expect(migration.match(/CREATE (UNIQUE )?INDEX/g)).toHaveLength(4);
    expect(migration).toContain(`COMMENT ON TABLE ${TABLE} IS 'One dated row per refund step or dispute stage of a boost purchase`);
  });
});

describe('20261076: RLS and grants (AC-205, §11I.5)', () => {
  it('turns RLS on and creates no policy', () => {
    expect(migration).toContain(`ALTER TABLE ${TABLE} ENABLE ROW LEVEL SECURITY;`);
    expect(migration).not.toMatch(/CREATE POLICY/i);
  });

  it('revokes everything from the four roles, then grants SELECT and the nine-column INSERT to service_role only', () => {
    for (const role of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
      expect(migration).toContain(`REVOKE ALL ON TABLE ${TABLE} FROM ${role};`);
    }
    const tableGrants = migration.match(new RegExp(`^GRANT [^\\n]* ON TABLE ${TABLE.replace('.', '\\.')} TO [^\\n]*$`, 'gm'));
    expect(tableGrants).toEqual([
      `GRANT SELECT ON TABLE ${TABLE} TO service_role;`,
      `GRANT INSERT (${INSERT_COLUMNS}) ON TABLE ${TABLE} TO service_role;`,
    ]);
    expect(INSERT_COLUMNS.split(', ')).toHaveLength(9);
    expect(INSERT_COLUMNS).not.toMatch(/\b(id|recorded_at)\b/);
    const lastRevoke = migration.lastIndexOf(`REVOKE ALL ON TABLE ${TABLE} FROM service_role;`);
    expect(migration.indexOf(`GRANT SELECT ON TABLE ${TABLE}`)).toBeGreaterThan(lastRevoke);
  });
});

describe('20261076: the function (AC-206, RV-2, SA-Q67, SA-W109)', () => {
  it('keeps the signature, argument names, return type, INVOKER and the empty search_path', () => {
    expect(newFn.startsWith('CREATE OR REPLACE FUNCTION public.business_os_transition_boost_purchase(\n  p_purchase_id uuid,\n  p_to_status text,\n  p_payment_intent_id text,\n  p_amount_refunded_minor integer,\n  p_dispute_id text,\n  p_flag_reason text\n)\nRETURNS TABLE (out_status text, out_user_id uuid, out_from_status text)\nLANGUAGE plpgsql\nVOLATILE\nSECURITY INVOKER\nSET search_path = \'\'\n')).toBe(true);
  });

  it('is the 20261031 function plus exactly six inserts and nothing else, by subtraction', () => {
    expect(inserts).toHaveLength(6);
    expect(withoutInserts(newFn)).toBe(originalFn.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION'));
  });

  it('negative controls: a seventh insert or one changed original line fails the subtraction', () => {
    const seventh = newFn.replace("      out_status := 'mismatch';", `${inserts[3]}      out_status := 'mismatch';`);
    expect([...seventh.matchAll(INSERT_RE)]).toHaveLength(7);
    expect(withoutInserts(seventh)).toBe(withoutInserts(newFn)); // subtraction alone cannot see an extra insert...
    expect(seventh).not.toBe(newFn); // ...so the count of six above is the pin for that case.
    const changed = newFn.replace("out_status := 'stale';", "out_status := 'already';");
    expect(withoutInserts(changed)).not.toBe(originalFn.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION'));
  });

  it('places each insert right after its UPDATE and right before its outcome line, with the RV-2 kinds and arbiters', () => {
    const expected: Array<[string, 'recorded' | 'transitioned', 'refund' | 'dispute']> = [
      ['refund', 'recorded', 'refund'],
      ['refund', 'transitioned', 'refund'],
      ['dispute_opened', 'recorded', 'dispute'],
      ['dispute_opened', 'transitioned', 'dispute'],
      ['dispute_lost', 'transitioned', 'dispute'],
      ['dispute_won', 'transitioned', 'dispute'],
    ];
    let cursor = 0;
    expected.forEach(([kind, outcome, arbiter], index) => {
      const insert = inserts[index];
      const at = newFn.indexOf(insert, cursor);
      expect(at).toBeGreaterThan(cursor);
      expect(newFn.slice(0, at)).toMatch(/WHERE purchase_row\.id = p_purchase_id;\n$/);
      expect(newFn.slice(0, at).lastIndexOf('UPDATE public.business_os_boost_purchases AS purchase_row')).toBeGreaterThan(cursor);
      expect(newFn.slice(at + insert.length)).toMatch(new RegExp(`^ *out_status := '${outcome}';\\n`));
      expect(insert).toContain(`SELECT purchase_row.id, '${kind}', `);
      expect(insert).toContain(`INSERT INTO ${TABLE} (${INSERT_COLUMNS})`);
      expect(insert).toContain('FROM public.business_os_boost_purchases AS purchase_row\n');
      expect(insert).toContain('WHERE purchase_row.id = p_purchase_id\n');
      expect(insert).toContain(', v_from, purchase_row.status, purchase_row.livemode\n');
      if (arbiter === 'refund') {
        expect(insert).toContain(", purchase_row.amount_refunded_minor - v_refunded, purchase_row.amount_refunded_minor, purchase_row.currency, NULL, ");
        expect(insert).toContain("ON CONFLICT (purchase_id, cumulative_refunded_minor) WHERE kind = 'refund' DO NOTHING;");
      } else {
        expect(insert).toContain(', COALESCE(purchase_row.amount_total_minor - purchase_row.amount_refunded_minor, 0), purchase_row.amount_refunded_minor, purchase_row.currency, purchase_row.stripe_dispute_id, ');
        expect(insert).toContain("ON CONFLICT (purchase_id, kind, stripe_dispute_id) WHERE kind <> 'refund' DO NOTHING;");
      }
      cursor = at + insert.length;
    });
  });

  it('never names a credit lot, a lot draw or the charge ledger (AC-213, BQ-13), and names the events table six times', () => {
    expect(newBody).not.toMatch(/business_os_credit_(lots|lot_draws|charges)/);
    expect(newBody.split('business_os_boost_reversal_events')).toHaveLength(7);
  });

  it('has the body md5 that check 24 pins (B1-R3)', () => {
    expect(md5(newBody)).toBe(NEW_MD5);
    expect(check24).toContain(`md5(replace(p.prosrc, chr(13), '')) = '${NEW_MD5}'`);
  });

  it('re-states the five function grants after the function, then reloads PostgREST last (SA-W115)', () => {
    const fnEnd = migration.indexOf(`${TAG};`) + TAG.length + 1;
    const grants = [
      `REVOKE ALL ON FUNCTION ${SIG} FROM PUBLIC;`,
      `REVOKE ALL ON FUNCTION ${SIG} FROM anon;`,
      `REVOKE ALL ON FUNCTION ${SIG} FROM authenticated;`,
      `REVOKE ALL ON FUNCTION ${SIG} FROM service_role;`,
      `GRANT EXECUTE ON FUNCTION ${SIG} TO service_role;`,
    ];
    let last = fnEnd;
    for (const grant of grants) {
      const at = migration.indexOf(grant);
      expect(at).toBeGreaterThan(last);
      last = at;
    }
    expect(migration.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';\n\nCOMMIT;")).toBe(true);
  });
});

describe('the rollback (AC-215, SA-Q70, E-67)', () => {
  it('locks in the migration order, refuses while any event exists, then restores 20261031 byte for byte before dropping the table', () => {
    const lockPurchases = rollback.indexOf('LOCK TABLE public.business_os_boost_purchases IN EXCLUSIVE MODE;');
    const lockEvents = rollback.indexOf(`LOCK TABLE ${TABLE} IN ACCESS EXCLUSIVE MODE;`);
    const refuse = rollback.indexOf('ROLLBACK REFUSED  the reversal events table holds dated money history');
    const restore = rollback.indexOf('CREATE OR REPLACE FUNCTION public.business_os_transition_boost_purchase(');
    const drop = rollback.indexOf(`DROP TABLE ${TABLE};`);
    expect(rollback.startsWith("BEGIN;\n\nSET LOCAL lock_timeout = '5s';\n")).toBe(true);
    expect(0 < lockPurchases && lockPurchases < lockEvents && lockEvents < refuse && refuse < restore && restore < drop).toBe(true);
    expect(rollback).toContain(`IF EXISTS (SELECT 1 FROM ${TABLE}) THEN`);
    expect(functionText(rollback)).toBe(originalFn.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION'));
    expect(md5(body(functionText(rollback)))).toBe(OLD_MD5);
    // Outside the restored function (whose own UPDATEs are the 20261031 text), the rollback writes no row.
    expect(flat(rollback.replace(functionText(rollback), ''))).not.toMatch(/DELETE FROM|UPDATE public|TRUNCATE|INSERT INTO/);
    expect(rollback.match(/^DROP /gm)).toHaveLength(1);
    expect(rollback.indexOf(`GRANT EXECUTE ON FUNCTION ${SIG} TO service_role;`)).toBeLessThan(drop);
    expect(rollback.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';\n\nCOMMIT;")).toBe(true);
  });
});

describe('paste safety (§3.7; the SQL editor misreads one word, apostrophes and semicolons in strings)', () => {
  it.each([
    ['migration', migration],
    ['rollback', rollback],
  ])('the %s is ASCII only, has no line comment, and no string carries a semicolon, a double dash or that word', (_name, sql) => {
    expect(sql).toMatch(/^[\x09\x0a\x20-\x7e]*$/);
    expect(sql).not.toMatch(/^\s*--/m);
    for (const literal of literalsOf(sql)) {
      expect({ literal, bad: /;|--|\binto\b/i.test(literal) }).toEqual({ literal, bad: false });
    }
    expect(sql).not.toMatch(/SECURITY\s+DEFINER/i);
  });

  it('the migration has the word only as seven keywords: the original SELECT and the six inserts', () => {
    const all = migration.match(/\binto\b/gi) ?? [];
    expect(all).toHaveLength(7);
    expect(migration.match(/INSERT INTO public\.business_os_boost_reversal_events \(/g)).toHaveLength(6);
    expect(migration).toContain('  INTO v_user, v_from, v_intent, v_total, v_refunded, v_dispute\n');
  });
});

describe('checks 23 and 24 (§6, SA-W113 / E-70, AC-216)', () => {
  it.each([
    ['check 23', check23],
    ['check 24', check24],
  ])('%s is one ASCII statement, with no apostrophe in a comment and never that word', (_name, sql) => {
    expect(sql).toMatch(/^[\x09\x0a\x20-\x7e]*$/);
    expect(sql).not.toMatch(/\binto\b/i);
    for (const line of sql.split('\n').filter((l) => l.trim().startsWith('--'))) expect(line).not.toContain("'");
    expect(sql.trimEnd().endsWith(';')).toBe(true);
    expect(sql.trimEnd().slice(0, -1)).not.toContain(';');
    expect(sql).not.toMatch(/^\s*set\b/im);
  });

  it('check 23 pins the 20261031 body, BYPASSRLS, DE-8a live (its table and the 20261075 cleanup stamp) and no refund or dispute', () => {
    expect(check23).toContain(`md5(replace(p.prosrc, chr(13), '')) = '${OLD_MD5}'`);
    expect(check23).toContain("position('a824848e0a538477' in p.prosrc) > 0");
    expect(check23).toContain("to_regclass('public.business_os_data_exports') is not null");
    expect(check23).toContain('r.rolbypassrls');
    expect(check23).toContain("'no boost purchase with a refund'");
    expect(check23).toContain("'no boost purchase with a dispute'");
    expect(check23.match(/^select '/gm)).toHaveLength(9);
  });

  it('check 24 has its 23 rows, including the column-level and nine-column grant rows and the E-65 row', () => {
    expect(check24.match(/^select '/gm)).toHaveLength(23);
    for (const item of [
      'anon has no privilege on the table or any column',
      'authenticated has no privilege on the table or any column',
      'service_role can insert exactly nine columns',
      'service_role cannot set recorded_at',
      'service_role cannot set id',
      'service_role bypasses row level security',
      'function names the events table six times',
      'cleanup function is the 20261077 version',
      'no refund or dispute recorded without an event',
    ]) {
      expect(check24).toContain(`select '${item}'`);
    }
    expect(check24).toContain('has_any_column_privilege');
  });
});

describe('the E-66 self-check script (local only, B1-R2)', () => {
  it('says in its first line that it is local only and never for production', () => {
    expect(selftest.split('\n')[0]).toBe('-- LOCAL ONLY. NEVER RUN THIS FILE ON PRODUCTION OR ON ANY SUPABASE PROJECT.');
  });

  it('runs its local-only guards before the first role switch and before anything is written', () => {
    const firstSwitch = selftest.indexOf('SET LOCAL ROLE');
    const firstWrite = selftest.indexOf('business_os_reserve_boost_purchase(');
    for (const guard of ["current_setting('bos.selftest_local', true)", "to_regclass('auth.refresh_tokens') IS NOT NULL", "current_setting('transaction_read_only')"]) {
      const at = selftest.indexOf(guard);
      expect(at).toBeGreaterThan(0);
      expect(at).toBeLessThan(firstSwitch);
      expect(at).toBeLessThan(firstWrite);
    }
  });

  it('covers every case S-01 to S-20 and never names the definer security mode', () => {
    for (let n = 1; n <= 20; n += 1) expect(selftest).toContain(`-- S-${String(n).padStart(2, '0')} `);
    expect(selftest).not.toMatch(/SECURITY\s+DEFINER/i);
  });
});
