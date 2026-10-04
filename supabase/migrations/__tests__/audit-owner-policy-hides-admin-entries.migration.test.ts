/**
 * Guard over migration 20261018: the owner policy on `audit_trail` hides admin
 * entries (credit deduction BD-26, KI-25; workplan
 * docs/workplans/BUSINESS_OS_BD26_OWNER_AUDIT_HIDING_WORKPLAN.md §3 and §6, SA
 * conditions W26-1 to W26-14).
 *
 * The four SQL files carry NO comments (the user pastes them into the Supabase
 * SQL editor on PROD by hand; the paste rules forbid `--` and `/*`), so the
 * explanation they would hold lives here and in the workplan §6 runbook.
 *
 * THE FILES
 *   supabase/migrations/20261018_audit_trail_owner_policy_hides_admin_entries.sql
 *     The migration. One transaction, `SET LOCAL lock_timeout = '5s'`, one
 *     `ALTER POLICY "Users can view their own audit logs"` that changes only the
 *     USING expression.
 *   supabase/SQL Scripts/20261018_audit_trail_owner_policy_hides_admin_entries_rollback.sql
 *     The rollback. Restores exactly the 20260930 USING expression, so
 *     `ai_action` stays hidden.
 *   scripts/check-audit-owner-policy-migration.sql
 *     The read-only checker, and the pre-check and post-check both: run it
 *     before the migration (C03 reads FAIL, the baseline that proves it
 *     discriminates; every other row PASS) and after it (VERDICT PASS).
 *   scripts/probe-audit-owner-policy-migration.sql
 *     The write probe. Inserts six tagged rows, reads them as the owner, as a
 *     random stranger id and as service_role, then raises PROBE PASS / FAIL,
 *     which rolls everything back. P01 to P08 must PASS; P09 is INFO when
 *     the live credit-lot row is invisible to its owner (or skipped), and FAIL
 *     when that row is visible.
 *
 * WHY. BD-26 (user, 2026-10-03): admin credit-lot and plan-operation audit
 * entries stay written against the owner's account (`user_id` = the account)
 * but the owner must not read them. They carry the admin's internal reason, the
 * admin id and the idempotency key. Slice 8b's low-line entry
 * (`business_os_credit_period`, KI-25) is hidden from day one. The rule lives
 * once in lib/audit/ownerVisibility.ts; this policy mirrors it, and
 * lib/audit/__tests__/ownerVisibility.test.ts fails if the two differ.
 *
 * WHAT IT DOES NOT TOUCH. `service_role_bypass_rls` (admin screens read through
 * the service role), every writer of audit entries, the admin read routes, and
 * the policy's name, command (SELECT) and role (PUBLIC). ALTER POLICY rather
 * than DROP / CREATE keeps those byte for byte, and fails loudly (42704) if the
 * policy was renamed or dropped instead of silently creating a second one.
 *
 * THE NULL ARM. `entity_type IS NULL OR entity_type NOT IN (…)` keeps
 * 20260930's null safety: `NOT IN` on a NULL yields NULL, which would hide the
 * row. (`entity_type` is NOT NULL today; the arm costs nothing.) Postgres
 * stores the list as `entity_type <> ALL (ARRAY[…])`, so the checker and probe
 * compare by content and behaviour, not by the stored string.
 *
 * STOP RULE (runbook §6). Before: any checker FAIL other than C03 → stop and
 * send the output to Dev. After: any checker FAIL, or PROBE FAIL → run the
 * rollback and send the output. A `55P03` lock timeout changed nothing; wait
 * and re-run. Rollback re-exposes admin entries to an owner's DIRECT PostgREST
 * read only: /monitoring and GET /api/audit/query stay hidden until the code is
 * reverted too.
 *
 * LIVE FACTS this relies on (SA, PROD read-only, 2026-10-04): no foreign key on
 * `audit_trail.user_id` (the repo's create_audit_trail.sql is intent only), so
 * the probe's stranger row uses `gen_random_uuid()`; no hash / tamper trigger,
 * only `trigger_sync_audit_user_email`; the severity CHECK is live, so the probe
 * leaves `severity` to its default. A future FK turns the probe's insert into
 * PROBE SKIPPED with its SQLSTATE, not a false FAIL.
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { OWNER_HIDDEN_ENTITY_TYPES } from '../../../lib/audit/ownerVisibility';

const ROOT = process.cwd();
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');
const SQL_SCRIPTS_DIR = join(ROOT, 'supabase', 'SQL Scripts');
const MIGRATION = join(MIGRATIONS_DIR, '20261018_audit_trail_owner_policy_hides_admin_entries.sql');
const ROLLBACK = join(SQL_SCRIPTS_DIR, '20261018_audit_trail_owner_policy_hides_admin_entries_rollback.sql');
const CHECKER = join(ROOT, 'scripts', 'check-audit-owner-policy-migration.sql');
const PROBE = join(ROOT, 'scripts', 'probe-audit-owner-policy-migration.sql');
const BASELINE = join(MIGRATIONS_DIR, '20260930_audit_trail_owner_policy_hides_ai_actions.sql');

const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const flatOf = (text: string) => text.replace(/\s+/g, ' ').trim();
const migration = read(MIGRATION);
const migrationFlat = flatOf(migration);
const rollbackFlat = flatOf(read(ROLLBACK));
const checker = read(CHECKER);
const checkerFlat = flatOf(checker);
const probe = read(PROBE);
const probeFlat = flatOf(probe);

const POLICY = '"Users can view their own audit logs"';
const HIDDEN = [...OWNER_HIDDEN_ENTITY_TYPES].sort();

/** Every single-quoted literal in a SQL text. */
function literalsOf(sql: string): string[] {
  return [...sql.matchAll(/'([^']*)'/g)].map((match) => match[1]);
}

/** The executable USING clause of the applied 20260930 file (its comments removed). */
function baselineUsing(): string {
  const body = flatOf(
    read(BASELINE)
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
  );
  const match = body.match(/ALTER POLICY "Users can view their own audit logs" ON public\.audit_trail (USING \(.*\));/);
  expect(match).not.toBeNull();
  return match ? match[1] : '';
}

/** B-1 guard (copied from the 11a test): a bare CASE in an IF condition fails with 42601. */
function bareCaseInIfConditions(sql: string): string[] {
  const code = sql.replace(/'[^']*'/g, (literal) => `'${' '.repeat(literal.length - 2)}'`);
  const wordAt = (word: string, i: number) =>
    code.startsWith(word, i) && !/\w/.test(code[i - 1] ?? '') && !/\w/.test(code[i + word.length] ?? '');
  const found: string[] = [];
  for (const match of code.matchAll(/\b(?:ELSIF|IF)\b/g)) {
    const at = match.index ?? 0;
    if (/\b(?:END)\s+$/.test(code.slice(Math.max(0, at - 8), at))) continue;
    let depth = 0;
    for (let i = at + match[0].length; i < code.length; i += 1) {
      const ch = code[i];
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
      else if (ch === ';' && depth === 0) break;
      else if (depth === 0 && wordAt('THEN', i)) break;
      else if (depth === 0 && wordAt('CASE', i)) {
        const lineEnd = sql.indexOf('\n', at);
        found.push(sql.slice(at, lineEnd > 0 ? lineEnd : sql.length).trim());
        break;
      }
    }
  }
  return found;
}

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

  it.each(files)('%s uses no single-letter alias', (_name, file) => {
    expect(read(file)).not.toMatch(/\b(?:FROM|JOIN)\s+[\w.]+\s+(?:AS\s+)?[a-z]\b(?!\w)/i);
    expect(read(file)).not.toMatch(/\bINTO\s+[\w.]+\s+AS\s+[a-z]\b(?!\w)/i);
  });

  it.each(files)('%s never puts a bare CASE inside an IF or ELSIF condition (42601)', (_name, file) => {
    expect(bareCaseInIfConditions(read(file))).toEqual([]);
  });

  it('the literal rule still flags a dotted literal (negative control)', () => {
    expect(literalsOf("WHERE oid = 'public.audit_trail'::regclass").every((literal) => /^[A-Za-z0-9_ ]*$/.test(literal))).toBe(false);
  });

  it('20261018 is used by exactly one migration file', () => {
    expect(readdirSync(MIGRATIONS_DIR).filter((name) => name.startsWith('20261018'))).toEqual([
      '20261018_audit_trail_owner_policy_hides_admin_entries.sql',
    ]);
  });
});

describe('the migration', () => {
  it('is one transaction with a local lock timeout', () => {
    expect(migrationFlat.startsWith("BEGIN; SET LOCAL lock_timeout = '5s';")).toBe(true);
    expect(migrationFlat.endsWith('COMMIT;')).toBe(true);
    expect(migrationFlat.match(/\b(?:BEGIN);/g)).toHaveLength(1);
    expect(migrationFlat.match(/\b(?:COMMIT);/g)).toHaveLength(1);
  });

  it('alters exactly the owner policy, by name, and nothing else', () => {
    expect(migrationFlat.match(/ALTER POLICY/g)).toHaveLength(1);
    expect(migrationFlat).toContain(`ALTER POLICY ${POLICY} ON public.audit_trail USING (`);
    expect(migrationFlat).not.toMatch(/\b(DROP|CREATE|RENAME)\b/);
    expect(migrationFlat).not.toMatch(/\bTO\b/);
    expect(migrationFlat).not.toMatch(/\b(?:FOR)\b/);
    expect(migrationFlat).not.toMatch(/WITH CHECK/);
    expect(migrationFlat).not.toMatch(/\b(DELETE|UPDATE|INSERT|TRUNCATE|GRANT|REVOKE)\b/);
    expect(migrationFlat).not.toMatch(/ALTER (TABLE|ROLE|FUNCTION)/);
    expect(migration).not.toContain('service_role_bypass_rls');
  });

  it('keeps the owner scope and the null arm, and hides the registry set', () => {
    expect(migrationFlat).toContain(
      "USING ( auth.uid() = user_id AND (entity_type IS NULL OR entity_type NOT IN ('ai_action', 'business_os_account_plan', 'business_os_credit_lot', 'business_os_credit_period')) );"
    );
    const listed = migrationFlat.match(/NOT IN \(([^)]*)\)/);
    expect(listed).not.toBeNull();
    expect(literalsOf(listed ? listed[1] : '').sort()).toEqual(HIDDEN);
    expect(migrationFlat).not.toMatch(/IS DISTINCT FROM/);
  });
});

describe('the rollback', () => {
  it('is one transaction with a local lock timeout and one ALTER POLICY by name', () => {
    expect(rollbackFlat.startsWith("BEGIN; SET LOCAL lock_timeout = '5s';")).toBe(true);
    expect(rollbackFlat.endsWith('COMMIT;')).toBe(true);
    expect(rollbackFlat.match(/ALTER POLICY/g)).toHaveLength(1);
    expect(rollbackFlat).not.toMatch(/\b(DROP|CREATE|RENAME|DELETE|UPDATE|INSERT|TRUNCATE|GRANT|REVOKE)\b/);
    expect(rollbackFlat).not.toMatch(/\b(?:TO|FOR)\b|WITH CHECK/);
    expect(rollbackFlat).not.toContain('service_role_bypass_rls');
  });

  it('restores exactly the 20260930 USING expression (ai_action stays hidden)', () => {
    const using = baselineUsing();
    expect(using).toBe("USING (auth.uid() = user_id AND entity_type IS DISTINCT FROM 'ai_action')");
    expect(rollbackFlat).toContain(`ALTER POLICY ${POLICY} ON public.audit_trail ${using};`);
  });
});

describe('the checker (read-only; W26-8)', () => {
  it('is read-only: sets the session read-only and writes nothing', () => {
    expect(checkerFlat.startsWith('SET default_transaction_read_only = on;')).toBe(true);
    expect(checkerFlat).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE|GRANT|REVOKE)\b/);
  });

  it('finds the table by pg_class and pg_namespace, and compares roles as oid arrays', () => {
    expect(checker).not.toMatch(/::regclass/);
    expect(checkerFlat).toContain("pg_namespace.nspname = 'public'");
    expect(checkerFlat).toContain("pg_class.relname = 'audit_trail'");
    expect(checkerFlat).toContain('ARRAY[0]::oid[]');
    expect(checkerFlat).toContain("pg_roles.rolname = 'service_role'");
    expect(checker).not.toContain("'{0}'");
  });

  it('carries the C01 to C06 rows and a VERDICT row', () => {
    for (const row of ['C01', 'C02', 'C03', 'C04', 'C05', 'C06']) expect(checker).toContain(`'${row} `);
    expect(checker).toContain("'VERDICT'");
  });

  it('C03 looks for the owner scope (chr built), the null arm, every hidden type, and the absence of the old form', () => {
    expect(checkerFlat).toContain("'auth' || chr(46) || 'uid' || chr(40) || chr(41) || ' ' || chr(61) || ' user_id'");
    expect(checkerFlat).toContain("'entity_type IS NULL'");
    for (const type of HIDDEN) expect(checkerFlat).toContain(`chr(39) || '${type}' || chr(39)`);
    expect(checkerFlat).toContain("position('IS DISTINCT FROM' IN owner_summary.using_text) = 0");
  });

  it('C02 prints the live USING text and roles (runbook step 1 is the checker)', () => {
    expect(checker).toMatch(/' {2}roles ' \|\| owner_summary\.roles_text/);
    expect(checker).toMatch(/' {2}using ' \|\| owner_summary\.using_text/);
  });
});

describe('the probe (W26-2, W26-10)', () => {
  it('is one DO block ending in the PASS / FAIL raise, with no COMMIT or ROLLBACK', () => {
    expect(probeFlat.startsWith('DO $probe$')).toBe(true);
    expect(probeFlat.endsWith('END $probe$;')).toBe(true);
    expect(probeFlat.match(/DO \$probe\$/g)).toHaveLength(1);
    // probeFlat collapses runs of spaces, the two inside the message included.
    expect(probeFlat).toContain(
      "RAISE EXCEPTION USING MESSAGE = 'PROBE ' || CASE WHEN v_fail THEN 'FAIL' ELSE 'PASS' END || ' this error is expected and rolls everything back' || v_report; END $probe$;"
    );
    expect(probeFlat).not.toMatch(/\b(COMMIT|ROLLBACK)\b/);
  });

  it('keeps the placeholder, read-only and account guards', () => {
    expect(probe).toContain("v_owner_text text := 'PASTE_YOUR_OWN_USER_ID_HERE';");
    expect(probe).toContain("current_setting('transaction_read_only') = 'on'");
    expect(probeFlat).toContain('FROM auth.users AS auth_user WHERE auth_user.id = v_owner');
  });

  it('inserts the six rows before any role switch, with realistic actions and no severity', () => {
    const insertAt = probe.indexOf('INSERT INTO public.audit_trail');
    expect(insertAt).toBeGreaterThan(0);
    expect(insertAt).toBeLessThan(probe.indexOf('SET LOCAL ROLE'));
    expect(probe.match(/INSERT INTO/g)).toHaveLength(1);
    expect(probeFlat).toContain('INSERT INTO public.audit_trail (user_id, action, entity_type, details)');
    for (const row of [
      "(v_owner, 'SETTINGS_PROFILE_UPDATED', 'settings', v_tag)",
      "(v_owner, 'BUSINESS_AI_ACTION_COMPLETED', 'ai_action', v_tag)",
      "(v_owner, 'BOS_ENTITLEMENT_TIER_ASSIGNED', 'business_os_account_plan', v_tag)",
      "(v_owner, 'BOS_CREDIT_LOT_GRANTED', 'business_os_credit_lot', v_tag)",
      "(v_owner, 'BOS_CREDIT_LOW_LINE_CROSSED', 'business_os_credit_period', v_tag)",
      "(v_stranger, 'SETTINGS_PROFILE_UPDATED', 'settings', v_tag)",
    ]) {
      expect(probeFlat).toContain(row);
    }
    expect(probe).not.toMatch(/severity/i);
    expect(probe).not.toContain("'error'");
    expect(probe).toContain('v_stranger uuid := gen_random_uuid();');
  });

  it('an insert failure is PROBE SKIPPED with its SQLSTATE; a failed read is PROBE FAIL with its SQLSTATE', () => {
    expect(probe).toContain("'PROBE SKIPPED  the probe rows could not be inserted ' || SQLSTATE");
    expect(probe.match(/'PROBE FAIL {2}the [a-z_ ]+ read raised ' \|\| SQLSTATE/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it('switches roles as SA ruled: authenticated with claims, RESET ROLE before service_role', () => {
    expect(probe).toContain('SET LOCAL ROLE authenticated;');
    expect(probeFlat).toContain('RESET ROLE; SET LOCAL ROLE service_role;');
    expect(probeFlat).toContain("set_config(concat_ws(chr(46), 'request', 'jwt', 'claims'), json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true)");
    expect(probeFlat).toContain("json_build_object('sub', v_stranger::text, 'role', 'authenticated')");
  });

  it('carries P01 to P08 as checks, P09 as INFO on the live row, and expects exactly 6 rows for service_role', () => {
    for (const row of ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08']) {
      expect(probe).toContain(`'${row} PASS `);
      expect(probe).toContain(`'${row} FAIL `);
    }
    expect(probe).toContain("'P09 INFO ");
    expect(probe).toContain('IF v_service_total = 6 THEN');
    expect(probe).toContain("'39c134b8fab349ebb05fc174ce4a8229'::uuid");
    expect(probe).toContain("'f29556b8bf4c4a55ab247165acdf4866'::uuid");
  });

  it('counts only its own tagged rows', () => {
    expect(probe.match(/WHERE audit_row\.details @> v_tag/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it('checker and probe name every hidden type', () => {
    for (const type of HIDDEN) {
      expect(checker).toContain(`'${type}'`);
      expect(probe).toContain(`'${type}'`);
    }
  });
});
