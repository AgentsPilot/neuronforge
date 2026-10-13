/**
 * Guard over migration 20261028, the first payment stamp (plan payments
 * P-5a.1; workplan BUSINESS_OS_PLAN_PAYMENTS_P5A_WORKPLAN.md §4, §8; SA
 * rulings S5-3, P5-C1, P5-F1, P5-F3 and conditions W-2, W-3, W-4, W-11).
 *
 * WHY A TEST OVER SQL TEXT. Jest cannot run PL/pgSQL and there is no branch
 * database. The user pastes the pre-check, the migration (in a NEW tab: the
 * pre-check leaves the session read-only), the checker and the probe into the
 * Supabase SQL editor by hand. What the files alone can prove is pinned here:
 *   - the paste rules over all five files (W-11);
 *   - the replaced function body is the 20261027 body plus EXACTLY three
 *     inserted pieces (one declaration, the flag set to false first, and the
 *     stamp block after the billing-row UPDATE), compared after normalising line
 *     endings (W-3). The rollback re-creates the 20261027 function byte for byte;
 *   - the stamp's predicate, the grants and the column grant;
 *   - the checker, the pre-check and the probe have not drifted.
 *
 * The SQL itself was executed against a local PGlite (PostgreSQL 16) during
 * development, with mutations; that run is recorded in the workplan (T2).
 *
 * Helpers are copied from the 20261027 test on purpose, rather than imported
 * across test files.
 */

import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const MIGRATION_27 = join(ROOT, 'supabase', 'migrations', '20261027_business_os_billing_events.sql');
const MIGRATION = join(ROOT, 'supabase', 'migrations', '20261028_business_os_first_payment_stamp.sql');
const ROLLBACK = join(ROOT, 'supabase', 'SQL Scripts', '20261028_business_os_first_payment_stamp_rollback.sql');
const CHECKER = join(ROOT, 'scripts', 'check-bos-first-payment-stamp-migration.sql');
const PRECHECK = join(ROOT, 'scripts', 'precheck-bos-first-payment-stamp-migration.sql');
const PROBE = join(ROOT, 'scripts', 'probe-bos-first-payment-stamp.sql');
const P3B_CHECKER = join(ROOT, 'scripts', 'check-bos-billing-events-migration.sql');

const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const migration27 = read(MIGRATION_27);
const migration = read(MIGRATION);
const flat = migration.replace(/\s+/g, ' ');
const rollback = read(ROLLBACK);
const rollbackFlat = rollback.replace(/\s+/g, ' ').trim();
const checker = read(CHECKER);
const checkerFlat = checker.replace(/\s+/g, ' ');
const precheck = read(PRECHECK);
const precheckFlat = precheck.replace(/\s+/g, ' ');
const probe = read(PROBE);

const FUNCTION = 'business_os_apply_plan_payment';
const TAG = 'apply_plan_payment';
const SIGNATURE =
  'uuid, boolean, text, text, text, text, text, text, integer, boolean, integer, integer, text, timestamptz, timestamptz, timestamptz, timestamptz, text';
const LINEAGE = 'public.business_os_account_lineage';

/** The md5 the P-3b checker (row 83) and the pre-check (P1) pin for the 20261027 body. */
const BODY_27_MD5 = '7ac579a49380b170e1ba3ac42d512820';

/** The SQL with every string literal blanked, so words inside messages and labels do not count as code. */
function codeOnly(sql: string): string {
  return sql.replace(/'[^']*'/g, "''");
}

function literalsOf(sql: string): string[] {
  return [...sql.matchAll(/'([^']*)'/g)].map((match) => match[1]);
}

function functionBody(sql: string): string {
  const open = `AS $${TAG}$`;
  const start = sql.indexOf(open);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf(`$${TAG}$;`, start + open.length);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start + open.length, end);
}

/** `CREATE FUNCTION …` through the closing `$apply_plan_payment$;`. */
function createStatement(sql: string): string {
  const start = sql.indexOf(`CREATE FUNCTION public.${FUNCTION}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf(`$${TAG}$;`, sql.indexOf(`AS $${TAG}$`, start) + 1);
  return sql.slice(start, end + `$${TAG}$;`.length);
}

function commentStatement(sql: string): string {
  const start = sql.indexOf(`COMMENT ON FUNCTION public.${FUNCTION}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  return sql.slice(start, sql.indexOf('\n', start));
}

function at(text: string, needle: string, from = 0): number {
  const index = text.indexOf(needle, from);
  expect({ needle, found: index >= 0 }).toEqual({ needle, found: true });
  return index;
}

const md5 = (text: string) => createHash('md5').update(text, 'utf8').digest('hex');

const body27 = functionBody(migration27);
const body = functionBody(migration);

const DECLARATION = '  v_stamped integer;\n';
const INITIALISE = '  out_first_payment_stamped := false;\n\n';
const STAMP_BLOCK = [
  '  IF p_amount_minor > 0 THEN',
  `    UPDATE ${LINEAGE} AS lineage_row`,
  '    SET first_paid_at = p_paid_at,',
  '        first_payment_ref = p_stripe_invoice_id',
  '    WHERE lineage_row.account_id = p_user_id',
  '      AND lineage_row.first_paid_at IS NULL;',
  '    GET DIAGNOSTICS v_stamped = ROW_COUNT;',
  '    out_first_payment_stamped := (v_stamped = 1);',
  '  END IF;',
  '',
  '',
].join('\n');

/** The 20261027 body with exactly the three P-5a.1 insertions (W-3). */
function expectedBody(): string {
  const declAnchor = '  v_inserted integer;\n';
  const outAnchor = "  out_status := (CASE WHEN v_plan_written THEN 'applied' ELSE 'recorded' END);\n";
  let text = body27;
  const decl = text.indexOf(declAnchor);
  text = text.slice(0, decl + declAnchor.length) + DECLARATION + text.slice(decl + declAnchor.length);
  const begin = text.indexOf('BEGIN\n', text.indexOf('DECLARE'));
  text = text.slice(0, begin + 'BEGIN\n'.length) + INITIALISE + text.slice(begin + 'BEGIN\n'.length);
  const out = text.indexOf(outAnchor);
  return text.slice(0, out) + STAMP_BLOCK + text.slice(out);
}

describe('W-11: SQL-editor safety over all five pasted files', () => {
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

  // The Supabase SQL editor misreads the word "into" (2026-10-04). It is
  // allowed only as the INSERT INTO keyword, never inside a string.
  it.each(files)('%s uses the word "into" only as the INSERT INTO keyword', (_name, file) => {
    const text = read(file);
    for (const literal of literalsOf(text)) expect(literal).not.toMatch(/\binto\b/i);
    const uses = [...text.matchAll(/\binto\b/gi)].map((match) => text.slice(Math.max(0, match.index! - 7), match.index! + 4));
    for (const use of uses) expect(use).toBe('INSERT INTO');
  });

  it.each(files)('%s uses no single-letter alias', (_name, file) => {
    expect(read(file)).not.toMatch(/\b(?:FROM|JOIN)\s+[\w.]+\s+(?:AS\s+)?[a-z]\b(?!\w)/i);
  });

  it.each(files)('%s never writes auth.users and names no agent-platform billing table', (_name, file) => {
    const text = read(file);
    expect(text).not.toMatch(/\b(?:INSERT\s+INTO|DELETE\s+FROM|UPDATE|TRUNCATE)\s+auth\.users\b/i);
    for (const table of ['user_subscriptions', 'credit_transactions', 'subscription_invoices', 'token_usage', 'boost_pack_purchases']) {
      expect(text).not.toContain(table);
    }
    expect(text).not.toMatch(/(?<!business_os_)\bbilling_events\b/);
  });

  it('Stripe prefixes are spelled with chr(95), never as an underscore inside a literal', () => {
    for (const text of [migration, rollback, probe, checker, precheck]) {
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
});

describe('one migration, one transaction, the function replaced in place (S5-3)', () => {
  it('BEGIN, lock timeout, DROP of the exact 18-type signature, CREATE, COMMENT, grants, column grant, COMMIT, then NOTIFY last', () => {
    expect(flat.trim().startsWith(`BEGIN; SET LOCAL lock_timeout = '5s'; DROP FUNCTION public.${FUNCTION}(${SIGNATURE}); CREATE FUNCTION public.${FUNCTION}(`)).toBe(true);
    expect(flat.trim().endsWith("COMMIT; NOTIFY pgrst, 'reload schema';")).toBe(true);
    expect(codeOnly(flat).match(/\bBEGIN;/g)).toHaveLength(1);
    expect(flat.match(/\bCOMMIT;/g)).toHaveLength(1);
    expect(flat.match(/DROP /g)).toHaveLength(1);
    expect(flat.match(/CREATE FUNCTION/g)).toHaveLength(1);
    expect(flat).not.toMatch(/CREATE TABLE|ALTER TABLE|IF NOT EXISTS|OR REPLACE|SECURITY DEFINER|POLICY|\bDO\s+\$/i);
    const order = [
      at(flat, 'DROP FUNCTION'),
      at(flat, 'CREATE FUNCTION'),
      at(flat, 'COMMENT ON FUNCTION'),
      at(flat, `REVOKE ALL ON FUNCTION public.${FUNCTION}(${SIGNATURE}) FROM PUBLIC;`),
      at(flat, `GRANT EXECUTE ON FUNCTION public.${FUNCTION}(${SIGNATURE}) TO service_role;`),
      at(flat, `GRANT UPDATE (first_paid_at, first_payment_ref) ON TABLE ${LINEAGE} TO service_role;`),
      at(flat, 'COMMIT;'),
      at(flat, "NOTIFY pgrst, 'reload schema';"),
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('keeps the 18 parameters and their types, and adds the seventh output last', () => {
    const head = (sql: string) => createStatement(sql).slice(0, createStatement(sql).indexOf(`AS $${TAG}$`));
    expect(head(migration)).toBe(
      head(migration27).replace('out_anchor_set boolean)', 'out_anchor_set boolean, out_first_payment_stamped boolean)')
    );
    expect(head(migration).replace(/\s+/g, ' ')).toContain("LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = ''");
  });

  it('W-3: the body is the 20261027 body plus exactly the declaration, the flag initialisation and the stamp block', () => {
    expect(md5(body27)).toBe(BODY_27_MD5);
    expect(body).toBe(expectedBody());
  });

  it('the flag is set to false as the first statement, before the argument checks and any RETURN', () => {
    const afterBegin = body.slice(body.indexOf('BEGIN\n', body.indexOf('DECLARE')) + 'BEGIN\n'.length);
    expect(afterBegin.startsWith(INITIALISE)).toBe(true);
    expect(body.indexOf(INITIALISE)).toBeLessThan(body.indexOf('RETURN'));
  });

  it('S5-3 / P5-F1: the stamp is keyed on the resolved account, once only, and on a paid amount above zero, never on p_assigns_plan', () => {
    const block = body.slice(body.indexOf('  IF p_amount_minor > 0 THEN'), body.indexOf('  END IF;', body.indexOf('  IF p_amount_minor > 0 THEN')));
    expect(block).toContain('WHERE lineage_row.account_id = p_user_id');
    expect(block).toContain('AND lineage_row.first_paid_at IS NULL;');
    expect(block).not.toContain('p_assigns_plan');
    expect(block).not.toMatch(/INSERT|DELETE/);
    expect(body.match(/business_os_account_lineage/g)).toHaveLength(1);
  });

  it('the stamp runs only after the billing-row UPDATE, so only applied and recorded reach it', () => {
    const billingUpdate = at(body, 'UPDATE public.business_os_billing_accounts AS billing_row');
    const stamp = at(body, 'UPDATE public.business_os_account_lineage AS lineage_row');
    const finalOut = at(body, "out_status := (CASE WHEN v_plan_written THEN 'applied' ELSE 'recorded' END);");
    expect(billingUpdate).toBeLessThan(stamp);
    expect(stamp).toBeLessThan(finalOut);
    // Every early return sits before the stamp.
    for (const status of ['billing_row_missing', 'customer_mismatch', 'already_applied', 'already_recorded', 'subscription_conflict', 'plan_row_missing']) {
      expect(at(body, `out_status := '${status}'`)).toBeLessThan(stamp);
    }
  });

  it('the comment is the 20261027 comment plus the first payment sentence', () => {
    expect(commentStatement(migration)).toBe(
      commentStatement(migration27).replace(
        /';$/,
        "  On the first paid plan invoice above zero it also stamps the first payment on the lineage row once and reports whether this call stamped it';"
      )
    );
  });

  it('EXECUTE is re-issued to service_role only, after REVOKE ALL from the four roles', () => {
    for (const role of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
      expect(flat).toContain(`REVOKE ALL ON FUNCTION public.${FUNCTION}(${SIGNATURE}) FROM ${role};`);
    }
    expect(flat.match(/REVOKE ALL ON FUNCTION/g)).toHaveLength(4);
    expect(flat.lastIndexOf('REVOKE ALL ON FUNCTION')).toBeLessThan(flat.indexOf('GRANT EXECUTE'));
  });

  it('P5-C1: the one table grant is UPDATE on exactly the two stamp columns, to service_role; no table-level UPDATE or DELETE', () => {
    expect(flat.match(/\bGRANT\b/g)).toHaveLength(2);
    expect(flat.match(/GRANT [^;]* ON TABLE/g)).toEqual([`GRANT UPDATE (first_paid_at, first_payment_ref) ON TABLE`]);
    expect(flat).not.toMatch(/GRANT (?:UPDATE|DELETE|ALL)[^(;]* ON TABLE/);
    expect(flat).not.toMatch(/TO (PUBLIC|anon|authenticated)/);
  });
});

describe('the rollback (§4.5)', () => {
  it('re-creates the 20261027 function, comment and grants byte for byte, and revokes the column grant, in one transaction', () => {
    expect(createStatement(rollback)).toBe(createStatement(migration27));
    expect(commentStatement(rollback)).toBe(commentStatement(migration27));
    expect(rollbackFlat.startsWith(`BEGIN; SET LOCAL lock_timeout = '5s'; DROP FUNCTION public.${FUNCTION}(${SIGNATURE}); CREATE FUNCTION`)).toBe(true);
    expect(rollbackFlat.endsWith("COMMIT; NOTIFY pgrst, 'reload schema';")).toBe(true);
    for (const role of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
      expect(rollbackFlat).toContain(`REVOKE ALL ON FUNCTION public.${FUNCTION}(${SIGNATURE}) FROM ${role};`);
    }
    expect(rollbackFlat).toContain(`GRANT EXECUTE ON FUNCTION public.${FUNCTION}(${SIGNATURE}) TO service_role;`);
    expect(rollbackFlat).toContain(`REVOKE UPDATE (first_paid_at, first_payment_ref) ON TABLE ${LINEAGE} FROM service_role;`);
  });

  it('never clears a stamp already written: no UPDATE, DELETE or TRUNCATE outside the re-created function', () => {
    const outside = codeOnly(rollback.replace(createStatement(rollback), ''));
    expect(outside).not.toMatch(/\bUPDATE\s+public|\bDELETE\b|\bTRUNCATE\b|first_paid_at\s*=/);
    expect(rollback).not.toContain('first_paid_at = NULL');
  });
});

describe('the checker has not drifted from the migration (C1 to C10)', () => {
  it('reports C1 to C11 with a VERDICT row', () => {
    for (const check of ['C1 ', 'C2 ', 'C3 ', 'C4 ', 'C5 ', 'C6 ', 'C7 ', 'C8 ', 'C9 ', 'C10 ', 'C11 ']) expect(checker).toContain(`'${check}`);
    expect(checkerFlat).toContain("CASE WHEN EXISTS (SELECT 1 FROM checks WHERE checks.status = 'FAIL') THEN 'FAIL' ELSE 'PASS' END");
  });

  it('C3 holds the md5 of the 20261028 body, computed as the P-3b checker computes it (line endings removed)', () => {
    expect(checker).toContain('md5(replace(pg_proc.prosrc, chr(13), \'\')) AS body_md5');
    expect(checker).toContain(`apply_function.body_md5 = '${md5(body)}'`);
    expect(checker).toContain("position('first_paid_at IS NULL' IN pg_proc.prosrc)");
    expect(body).toContain('lineage_row.first_paid_at IS NULL');
    expect(body).toContain('IF p_amount_minor > 0 THEN');
  });

  it('C2 lists the eighteen parameters and the seven outputs in order', () => {
    const params = [...createStatement(migration).matchAll(/\n {2}(p_\w+) \w+/g)].map((match) => match[1]);
    expect(params).toHaveLength(18);
    const outputs = ['out_status', 'out_event_row_id', 'out_tier_before', 'out_tier_after', 'out_plan_written', 'out_anchor_set', 'out_first_payment_stamped'];
    expect(checker).toContain(`apply_function.argument_names = '${[...params, ...outputs].join(' ')}'`);
  });

  it('C6 and C7 pin the column grant exactly; C8 closes the table to clients', () => {
    expect(checkerFlat).toContain("column_grants.listing = 'service_role first_paid_at UPDATE service_role first_payment_ref UPDATE'");
    expect(checkerFlat).toContain("service_table.listing = 'INSERT SELECT'");
    expect(checkerFlat).toContain("('UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')");
    expect(checkerFlat).toContain("table_acl_entries.grantee_name IN ('PUBLIC', 'anon', 'authenticated')");
  });

  it('C9 says the P-3b checker rows 81 and 83 read FAIL by design; the P-3b checker itself is left as it was', () => {
    expect(checker).toContain("'C9 the 20261027 checker rows 81 and 83 now read FAIL by design  every other row of it still passes'");
    const p3b = read(P3B_CHECKER);
    expect(p3b).toContain(`apply_function.body_md5 = '${BODY_27_MD5}'`);
    expect(p3b).not.toContain('out_first_payment_stamped');
  });

  it('W-4: C10 joins the money history on BOTH the invoice id and the account', () => {
    const c10 = checkerFlat.slice(checkerFlat.indexOf('stamped_rows AS ('), checkerFlat.indexOf('checks AS ('));
    const joins = c10.match(/event_row\.stripe_invoice_id = lineage_row\.first_payment_ref AND event_row\.user_id = lineage_row\.account_id/g) ?? [];
    expect(joins).toHaveLength(3);
  });
});

describe('the pre-check (§4.2, P5-F3)', () => {
  it('P1 pins the 20261027 body md5 the way the P-3b checker computes it, and P2 refuses a second run', () => {
    expect(precheck).toContain("md5(replace(pg_proc.prosrc, chr(13), '')) AS body_md5");
    expect(precheck).toContain(`= '${BODY_27_MD5}'`);
    expect(precheck).toContain("position('out_first_payment_stamped' IN apply_function.argument_names) > 0");
  });

  it('P5 and P6 count unstamped lineage accounts with a paid invoice above zero, by mode, and must be 0', () => {
    expect(precheckFlat).toContain("'P5 unstamped lineage accounts with a paid plan invoice above zero in test mode expected 0'");
    expect(precheckFlat).toContain("'P6 unstamped lineage accounts with a paid plan invoice above zero in live mode expected 0'");
    expect(precheckFlat).toContain("AND event_row.kind = 'invoice_paid' AND event_row.amount_minor > 0 WHERE lineage_row.first_paid_at IS NULL GROUP BY event_row.livemode");
  });

  it('tells the user to run the migration in a NEW tab only on PASS, and not to run it on FAIL', () => {
    expect(precheckFlat).toContain(
      "CASE WHEN EXISTS (SELECT 1 FROM checks WHERE checks.status = 'FAIL') THEN 'do not run the migration' ELSE 'run the migration in a NEW tab' END AS detail"
    );
  });
});

describe('the probe (§4.4, W-2)', () => {
  const firstSwitch = probe.indexOf('SET LOCAL ROLE service_role;');

  it('is one DO block that always rolls back, ending in a words-only message', () => {
    expect(probe.trim().startsWith('DO $probe$')).toBe(true);
    expect(probe.trim().endsWith('$probe$;')).toBe(true);
    expect(probe).toContain("RAISE EXCEPTION USING MESSAGE = 'PROBE ' || CASE WHEN v_fail THEN 'FAIL' ELSE 'PASS' END");
    expect(probe).toContain("'  this error is expected and rolls everything back'");
  });

  it('has every case F01 to F10', () => {
    for (let id = 1; id <= 10; id += 1) expect(probe).toContain(`'F${String(id).padStart(2, '0')} PASS`);
  });

  it('its guards, and the set-up done as the owner, come before the first switch to service_role', () => {
    for (const guard of [
      'replace PASTE_YOUR_OWN_USER_ID_HERE',
      'not a valid user id',
      'this session is read only',
      'apply 20261028 first',
      'not an account on this database',
      'has no Business OS plan row',
      'has a live mode billing record',
      `INSERT INTO ${LINEAGE} (account_id, invite_id, source, parent_account_id, root_account_id, level)`,
    ]) {
      const index = probe.indexOf(guard);
      expect({ guard, index: index > 0 }).toEqual({ guard, index: true });
      expect(index).toBeLessThan(firstSwitch);
    }
  });

  it('W-2: every apply call runs as service_role, so the probe proves the column grant and not the owner', () => {
    expect(firstSwitch).toBeGreaterThan(0);
    const calls = [...probe.matchAll(/business_os_apply_plan_payment\(v_owner/g)].map((match) => match.index!);
    expect(calls.length).toBeGreaterThanOrEqual(9);
    for (const call of calls) expect(call).toBeGreaterThan(firstSwitch);
    // Each owner-side reset ends by switching back before the next call.
    const resets = [...probe.matchAll(/RESET ROLE;/g)].map((match) => match.index!);
    expect(resets.length).toBeGreaterThanOrEqual(4);
    for (const reset of resets) {
      const back = probe.indexOf('SET LOCAL ROLE service_role;', reset);
      const nextCall = calls.find((call) => call > reset);
      expect(back).toBeGreaterThan(reset);
      if (nextCall !== undefined) expect(back).toBeLessThan(nextCall);
    }
  });

  it('W-2: F03 sends the first event id with a different invoice id, so the answer is already_recorded', () => {
    const section = probe.slice(probe.indexOf("'F02 FAIL"), probe.indexOf("'F03 PASS"));
    expect(section).toContain("v_inv := 'in' || chr(95)");
    expect(section).toContain('NULL, v_evt_first, v_inv,');
    expect(section).toContain("v_r.out_status = 'already_recorded'");
  });

  it('W-2: F05 is a zero amount invoice that assigns the plan; F06 clears the stamp explicitly before its late invoice', () => {
    const f05 = probe.slice(probe.indexOf("'F04 FAIL"), probe.indexOf("'F05 PASS"));
    expect(f05).toContain("'probe_basic', 3, true, 0, 0, 'usd'");
    const f06 = probe.slice(probe.indexOf("'F05 FAIL"), probe.indexOf("'F06 PASS"));
    expect(f06).toContain('SET first_paid_at = NULL, first_payment_ref = NULL');
    expect(f06).toContain("v_r.out_status = 'recorded' AND v_r.out_first_payment_stamped IS TRUE");
  });

  it('F07 deletes the lineage row inside the transaction; F08 covers customer_mismatch and subscription_conflict', () => {
    const f07 = probe.slice(probe.indexOf("'F06 FAIL"), probe.indexOf("'F07 PASS"));
    expect(f07).toContain(`DELETE FROM ${LINEAGE} AS lineage_row`);
    const f08 = probe.slice(probe.indexOf("'F07 FAIL"), probe.indexOf("'F08 PASS"));
    expect(f08).toContain("'customer_mismatch false'");
    expect(f08).toContain("'subscription_conflict'");
  });

  it('F10 runs as service_role against other lineage columns; F09 runs as authenticated', () => {
    const authenticated = probe.indexOf('SET LOCAL ROLE authenticated;');
    expect(probe.indexOf("'F10 PASS")).toBeLessThan(authenticated);
    expect(probe.indexOf('SET level = lineage_row.level')).toBeLessThan(authenticated);
    expect(probe.indexOf('SET level = lineage_row.level')).toBeGreaterThan(firstSwitch);
    expect(authenticated).toBeLessThan(probe.indexOf("'F09 PASS"));
  });

  it('every apply call is caught, so an error reports FAIL instead of ending the probe', () => {
    const calls = [...probe.matchAll(/v_r := \(SELECT apply_result FROM public\.business_os_apply_plan_payment/g)].length;
    const caught = [...probe.matchAll(/EXCEPTION WHEN OTHERS THEN\n\s+v_r := \(SELECT apply_result FROM \(SELECT \('raised ' \|\| SQLSTATE\)/g)].length;
    expect(caught).toBe(calls);
  });
});
