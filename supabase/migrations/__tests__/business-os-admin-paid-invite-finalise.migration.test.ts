/**
 * Guard over migration 20261029, the admin Paid invite finalise (plan payments
 * P-9.1; workplan BUSINESS_OS_PLAN_PAYMENTS_P9_WORKPLAN.md §3.1, §11; SA
 * rulings Q-1, Q-6 and conditions C-1, C-10, C-12).
 *
 * WHY A TEST OVER SQL TEXT. Jest cannot run PL/pgSQL and there is no branch
 * database. The user pastes the pre-check, the migration (in a NEW tab: the
 * pre-check leaves the session read-only), the checker, the probe and its F11
 * count into the Supabase SQL editor by hand. What the files alone can prove
 * is pinned here:
 *   - the paste rules over all six files (no `--` comment, no punctuation in a
 *     string, never the word "into" inside a string);
 *   - the function's shape (C-1): SECURITY INVOKER, empty search_path, the
 *     eight-filter locking SELECT, `FOUND`, the `already_finalised` join, the
 *     plan row with no tier and no cohort, the L1 lineage row, the grants;
 *   - no tier or cohort id from the config is written in the SQL (L-5);
 *   - the checker, the pre-check, the rollback and the probe have not drifted.
 *
 * The SQL itself was executed against a local PGlite (PostgreSQL 16) during
 * development, with mutations; that run is recorded in the workplan
 * (Implementation Notes, P-9.1).
 *
 * Helpers are copied from the 20261028 guard on purpose, rather than imported
 * across test files (importing a test file would run its suites here too).
 */

import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import { COHORT_IDS } from '@/lib/business-os/entitlements/config/cohorts';
import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';

const ROOT = process.cwd();
const MIGRATION = join(ROOT, 'supabase', 'migrations', '20261029_business_os_admin_paid_invite_finalise.sql');
const CHAMPION_MIGRATION = join(ROOT, 'supabase', 'migrations', '20261014_business_os_invite_signup.sql');
const FRIEND_MIGRATION = join(ROOT, 'supabase', 'migrations', '20261024_business_os_friend_invite_signup.sql');
const ROLLBACK = join(ROOT, 'supabase', 'SQL Scripts', '20261029_business_os_admin_paid_invite_finalise_rollback.sql');
const CHECKER = join(ROOT, 'scripts', 'check-bos-admin-paid-invite-finalise-migration.sql');
const PRECHECK = join(ROOT, 'scripts', 'precheck-bos-admin-paid-invite-finalise-migration.sql');
const PROBE = join(ROOT, 'scripts', 'probe-bos-admin-paid-invite-finalise.sql');
const PROBE_AFTER = join(ROOT, 'scripts', 'probe-bos-admin-paid-invite-finalise-after.sql');

const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const migration = read(MIGRATION);
const flat = migration.replace(/\s+/g, ' ');
const rollback = read(ROLLBACK);
const rollbackFlat = rollback.replace(/\s+/g, ' ').trim();
const checker = read(CHECKER);
const precheck = read(PRECHECK);
const probe = read(PROBE);
const probeAfter = read(PROBE_AFTER);

const FUNCTION = 'business_os_finalise_admin_paid_invite_redemption';
const SIGNATURE = 'uuid, uuid, text, text';

/** The SQL with every string literal blanked, so words inside messages and labels do not count as code. */
function codeOnly(sql: string): string {
  return sql.replace(/'[^']*'/g, "''");
}

function literalsOf(sql: string): string[] {
  return [...sql.matchAll(/'([^']*)'/g)].map((match) => match[1]);
}

/** The text between `AS $$` and `$$;`: what PostgreSQL stores as `prosrc`. */
function dollarBody(sql: string, from = 0): string {
  const open = sql.indexOf('AS $$', from);
  expect(open).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf('$$;', open + 'AS $$'.length);
  expect(end).toBeGreaterThan(open);
  return sql.slice(open + 'AS $$'.length, end);
}

function at(text: string, needle: string, from = 0): number {
  const index = text.indexOf(needle, from);
  expect({ needle, found: index >= 0 }).toEqual({ needle, found: true });
  return index;
}

const md5 = (text: string) => createHash('md5').update(text, 'utf8').digest('hex');

const body = dollarBody(migration);
const championBody = dollarBody(read(CHAMPION_MIGRATION), read(CHAMPION_MIGRATION).indexOf('CREATE FUNCTION public.business_os_finalise_invite_redemption('));
const friendBody = dollarBody(read(FRIEND_MIGRATION), read(FRIEND_MIGRATION).indexOf('CREATE FUNCTION public.business_os_finalise_friend_invite_redemption('));

describe('SQL-editor safety over all six pasted files', () => {
  const files: Array<[string, string]> = [
    ['migration', MIGRATION],
    ['rollback', ROLLBACK],
    ['checker', CHECKER],
    ['pre-check', PRECHECK],
    ['probe', PROBE],
    ['probe F11 count', PROBE_AFTER],
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

  it.each(files)('%s never writes auth.users', (_name, file) => {
    expect(read(file)).not.toMatch(/\b(?:INSERT\s+INTO|DELETE\s+FROM|UPDATE|TRUNCATE)\s+auth\.users\b/i);
  });

  it('the checker, the pre-check and the F11 count are read-only from their first statement', () => {
    for (const text of [checker, precheck, probeAfter]) {
      expect(text.startsWith('SET default_transaction_read_only = on;\n')).toBe(true);
      expect(codeOnly(text)).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|GRANT|REVOKE|TRUNCATE)\s/);
      expect(codeOnly(text)).not.toMatch(/\bDO\s+\$/);
    }
  });
});

describe('one migration, one transaction, a NEW function (SA Q-1)', () => {
  it('BEGIN, lock timeout, CREATE, COMMENT, four REVOKEs, one GRANT, COMMIT, then NOTIFY last', () => {
    expect(flat.trim().startsWith(`BEGIN; SET LOCAL lock_timeout = '5s'; CREATE FUNCTION public.${FUNCTION}(`)).toBe(true);
    expect(flat.trim().endsWith("COMMIT; NOTIFY pgrst, 'reload schema';")).toBe(true);
    expect(codeOnly(flat).match(/\bBEGIN;/g)).toHaveLength(1);
    expect(flat.match(/\bCOMMIT;/g)).toHaveLength(1);
    expect(flat.match(/CREATE FUNCTION/g)).toHaveLength(1);
    expect(flat).not.toMatch(/CREATE TABLE|ALTER TABLE|DROP |IF NOT EXISTS|OR REPLACE|SECURITY DEFINER|POLICY|ON CONFLICT|\bDO\s+\$/i);
    const order = [
      at(flat, 'CREATE FUNCTION'),
      at(flat, 'COMMENT ON FUNCTION'),
      at(flat, `REVOKE ALL ON FUNCTION public.${FUNCTION}(${SIGNATURE}) FROM PUBLIC;`),
      at(flat, `GRANT EXECUTE ON FUNCTION public.${FUNCTION}(${SIGNATURE}) TO service_role;`),
      at(flat, 'COMMIT;'),
      at(flat, "NOTIFY pgrst, 'reload schema';"),
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('names no other function: the champion and friend finalise are not touched', () => {
    expect(migration).not.toContain('business_os_finalise_invite_redemption');
    expect(migration).not.toContain('business_os_finalise_friend_invite_redemption');
  });

  it('the header: four arguments, a two-column table, plpgsql, SECURITY INVOKER, empty search_path', () => {
    expect(flat).toContain(
      `CREATE FUNCTION public.${FUNCTION}(p_invite_id uuid, p_account_id uuid, p_email text, p_tier text) ` +
        "RETURNS TABLE (result_outcome text, result_invite_id uuid) LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$"
    );
  });

  it('EXECUTE goes to service_role only, after REVOKE ALL from the four roles', () => {
    for (const role of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
      expect(flat).toContain(`REVOKE ALL ON FUNCTION public.${FUNCTION}(${SIGNATURE}) FROM ${role};`);
    }
    expect(flat.match(/REVOKE ALL ON FUNCTION/g)).toHaveLength(4);
    expect(flat.match(/\bGRANT\b/g)).toHaveLength(1);
    expect(flat.lastIndexOf('REVOKE ALL ON FUNCTION')).toBeLessThan(flat.indexOf('GRANT EXECUTE'));
    expect(flat).not.toMatch(/TO (PUBLIC|anon|authenticated)/);
    expect(flat).not.toMatch(/ON TABLE/);
  });

  it('the comment says what it does and obeys the paste rules', () => {
    const comment = flat.slice(at(flat, `COMMENT ON FUNCTION public.${FUNCTION}(${SIGNATURE}) IS '`));
    expect(comment).toContain('held until it pays');
    expect(comment).toContain('The tier is assigned only by the payment');
  });
});

describe('C-1: the function body', () => {
  const bodyFlat = body.replace(/\s+/g, ' ');

  it('locks the invite with all eight filters, then detects not-found with FOUND', () => {
    const lock = bodyFlat.slice(at(bodyFlat, 'PERFORM invite_row.id'), at(bodyFlat, 'FOR UPDATE;') + 'FOR UPDATE;'.length);
    for (const filter of [
      'invite_row.id = p_invite_id',
      'AND invite_row.claimed_account_id = p_account_id',
      'AND invite_row.email = p_email',
      "AND invite_row.issuer_kind = 'admin'",
      "AND invite_row.grant_kind = 'tier'",
      'AND invite_row.grant_id = p_tier',
      'AND invite_row.redeemed_at IS NULL',
      'AND invite_row.revoked_at IS NULL',
    ]) {
      expect(lock).toContain(filter);
    }
    expect(bodyFlat.indexOf('FOR UPDATE; IF NOT FOUND THEN')).toBeGreaterThan(0);
  });

  it('already_finalised needs the redeemed row of THIS account, an admin tier invite, and its admin_invite lineage row', () => {
    const replay = bodyFlat.slice(at(bodyFlat, "SELECT 'already_finalised'::text"), at(bodyFlat, "'not_matched'::text"));
    for (const part of [
      'JOIN public.business_os_account_lineage AS lineage_row ON lineage_row.account_id = done_row.redeemed_account_id AND lineage_row.invite_id = done_row.id',
      'done_row.id = p_invite_id',
      'AND done_row.redeemed_account_id = p_account_id',
      "AND done_row.issuer_kind = 'admin'",
      "AND done_row.grant_kind = 'tier'",
      "AND lineage_row.source = 'admin_invite'",
    ]) {
      expect(replay).toContain(part);
    }
  });

  it('burns the invite by its id, after the lock', () => {
    expect(bodyFlat).toContain(
      'UPDATE public.business_os_invites AS burn_row SET redeemed_at = now(), redeemed_account_id = p_account_id, updated_at = now() WHERE burn_row.id = p_invite_id;'
    );
    expect(bodyFlat.indexOf('FOR UPDATE;')).toBeLessThan(bodyFlat.indexOf('UPDATE public.business_os_invites'));
  });

  it('SA-P9 / T-13: the plan row names no tier and no cohort column', () => {
    expect(bodyFlat).toContain(
      "INSERT INTO public.business_os_account_plans (user_id, origin, period_anchor, updated_at) VALUES (p_account_id, 'invite', now(), now());"
    );
    const planInsert = bodyFlat.slice(at(bodyFlat, 'INSERT INTO public.business_os_account_plans'), at(bodyFlat, 'INSERT INTO public.business_os_account_lineage'));
    expect(planInsert).not.toMatch(/\btier\b|\bcohort\b/);
  });

  it('the lineage row is L1, source admin_invite, no parent, rooted at the account', () => {
    expect(bodyFlat).toContain(
      'INSERT INTO public.business_os_account_lineage (account_id, invite_id, source, parent_account_id, root_account_id, level) ' +
        "VALUES (p_account_id, p_invite_id, 'admin_invite', NULL, p_account_id, 1);"
    );
  });

  it('answers only finalised, already_finalised or not_matched', () => {
    const outcomes = [...body.matchAll(/'(\w+)'::text/g)].map((match) => match[1]).sort();
    expect(outcomes).toEqual(['already_finalised', 'finalised', 'not_matched']);
  });

  it('L-5: no tier or cohort id from the config is written anywhere in the migration', () => {
    const literals = literalsOf(migration);
    for (const id of [...TIER_ORDER, ...COHORT_IDS]) {
      expect({ id, inLiteral: literals.includes(id) }).toEqual({ id, inLiteral: false });
    }
  });
});

describe('the checker (C1 to C8) has not drifted', () => {
  it('reports C1 to C8 with a VERDICT row', () => {
    for (const check of ['C1 ', 'C2 ', 'C3 ', 'C4 ', 'C5 ', 'C6 ', 'C7 ', 'C8 ']) expect(checker).toContain(`'${check}`);
    expect(checker).toContain("CASE WHEN EXISTS (SELECT 1 FROM checks WHERE checks.status = 'FAIL') THEN 'FAIL' ELSE 'PASS' END");
    expect(checker).toContain(`pg_proc.proname = '${FUNCTION}'`);
  });

  it('C3 holds the md5 of the 20261029 body, computed with line endings removed', () => {
    expect(checker).toContain("md5(replace(pg_proc.prosrc, chr(13), '')) AS body_md5");
    expect(checker).toContain(`admin_paid_function.body_md5 = '${md5(body)}'`);
  });

  it('C2 names the four arguments and the two outputs in order', () => {
    expect(checker).toContain("admin_paid_function.argument_names = 'p_invite_id p_account_id p_email p_tier result_outcome result_invite_id'");
  });

  it('C4 allows service_role EXECUTE and nothing else', () => {
    expect(checker).toContain("function_grants.listing = 'service_role EXECUTE'");
  });

  it('C6 and C7 (SA C-1): the champion and friend finalise bodies match their own migrations, md5 derived here from the files', () => {
    expect(checker).toContain(`= '${md5(championBody)}'`);
    expect(checker).toContain(`= '${md5(friendBody)}'`);
    expect(precheck).toContain(`= '${md5(championBody)}'`);
    expect(precheck).toContain(`= '${md5(friendBody)}'`);
  });
});

describe('the pre-check', () => {
  it('P2 refuses a second run, P6 and P7 must be 0, and it says NEW tab only on PASS', () => {
    expect(precheck).toContain(`pg_proc.proname = '${FUNCTION}'`);
    expect(precheck).toContain("'P6 admin tier invites already redeemed expected 0'");
    expect(precheck).toContain("'P7 admin invite lineage rows whose invite is a tier grant expected 0'");
    expect(precheck.replace(/\s+/g, ' ')).toContain(
      "CASE WHEN EXISTS (SELECT 1 FROM checks WHERE checks.status = 'FAIL') THEN 'do not run the migration' ELSE 'run the migration in a NEW tab' END AS detail"
    );
  });
});

describe('the rollback', () => {
  it('drops exactly this signature in one transaction and touches no row', () => {
    expect(rollbackFlat).toBe(
      `BEGIN; SET LOCAL lock_timeout = '5s'; DROP FUNCTION public.${FUNCTION}(${SIGNATURE}); COMMIT; NOTIFY pgrst, 'reload schema';`
    );
  });
});

describe('the probe (C-10)', () => {
  const firstSwitch = probe.indexOf('SET LOCAL ROLE service_role;');

  it('is one DO block that always rolls back, ending in a words-only message', () => {
    expect(probe.trim().startsWith('DO $probe$')).toBe(true);
    expect(probe.trim().endsWith('$probe$;')).toBe(true);
    expect(probe).toContain("RAISE EXCEPTION USING MESSAGE = 'PROBE ' || CASE WHEN v_fail THEN 'FAIL' ELSE 'PASS' END");
    expect(probe).toContain('this error is expected and rolls everything back');
    expect(codeOnly(probe)).not.toMatch(/\bCOMMIT\b/);
  });

  it('has every case F01 to F10 and F12; F11 is the separate read-only count', () => {
    for (const id of ['F01', 'F02', 'F03', 'F04', 'F05', 'F06', 'F07', 'F08', 'F09', 'F10', 'F12']) expect(probe).toContain(`'${id} PASS`);
    expect(probe).not.toContain("'F11");
    expect(probeAfter).toContain("'F11 rows left behind by the probe expected 0'");
    expect(probeAfter).toContain("invite_row.internal_reason = 'admin paid finalise probe'");
    expect(probe).toContain("v_marker text := 'admin paid finalise probe';");
  });

  it('the test account is a placeholder the user supplies, and every guard and the set-up run before the first switch to service_role', () => {
    expect(probe).toContain("v_account_text text := 'PASTE_THE_TEST_ACCOUNT_ID_HERE';");
    for (const guard of [
      'replace PASTE_THE_TEST_ACCOUNT_ID_HERE',
      'not a valid user id',
      'this session is read only',
      'apply 20261029 first',
      'not an account on this database',
      'has a live mode billing record',
      'invited other accounts',
      'INSERT INTO public.business_os_invites',
    ]) {
      const index = probe.indexOf(guard);
      expect({ guard, found: index > 0 }).toEqual({ guard, found: true });
      expect(index).toBeLessThan(firstSwitch);
    }
  });

  it('C-10: the issuing admin comes from an existing admin_users row, and each token hash is a fresh 64 characters', () => {
    expect(probe).toContain('FROM public.admin_users AS admin_row WHERE admin_row.user_id IS NOT NULL');
    const inserts = [...probe.matchAll(/md5\(gen_random_uuid\(\)::text\) \|\| md5\(gen_random_uuid\(\)::text\)/g)];
    expect(inserts).toHaveLength(5);
  });

  it('every finalise call runs as service_role or, for F12, as authenticated, and is caught so an error reports FAIL', () => {
    const calls = [...probe.matchAll(new RegExp(`FROM public\\.${FUNCTION}\\(`, 'g'))].map((match) => match.index!);
    expect(calls).toHaveLength(7);
    for (const call of calls) expect(call).toBeGreaterThan(firstSwitch);
    const caught = [...probe.matchAll(/EXCEPTION WHEN OTHERS THEN\n\s+v_r := \(SELECT probe_answer FROM \(SELECT \('raised ' \|\| SQLSTATE\)/g)].length;
    expect(caught).toBe(calls.length);
    expect(probe.indexOf('SET LOCAL ROLE authenticated;')).toBeLessThan(probe.indexOf("'F12 PASS"));
  });

  it('uses made-up tier and cohort ids, never the config ones', () => {
    const literals = literalsOf(probe);
    for (const id of [...TIER_ORDER, ...COHORT_IDS]) {
      expect({ id, inLiteral: literals.includes(id) }).toEqual({ id, inLiteral: false });
    }
  });
});
