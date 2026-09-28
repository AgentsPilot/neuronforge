/**
 * The privilege fix (2026-09-24), and the checks that catch it coming back.
 *
 * ── WHAT HAPPENED ───────────────────────────────────────────────────────────
 * Check A4 FAILED against production the first time the rewritten checker ran.
 * The ACL on all three entitlement tables was:
 *
 *     postgres=arwdDxtm/postgres
 *     anon=m/postgres
 *     authenticated=m/postgres
 *     service_role=arwdDxtm/postgres
 *
 * Two real defects, both from the same cause — **the migration ENUMERATED what
 * it revoked**:
 *
 *   1. `anon` and `authenticated` kept `m` (MAINTAIN: VACUUM, ANALYZE, REINDEX,
 *      CLUSTER, REFRESH MATERIALIZED VIEW, LOCK TABLE), a PostgreSQL 17
 *      privilege the Supabase defaults granted at CREATE time and our list of
 *      seven did not name.
 *   2. `service_role` kept `d` (DELETE) and `D` (TRUNCATE), because a GRANT
 *      naming SELECT, INSERT and UPDATE does not take away what the defaults
 *      already gave. The comment beside that GRANT claimed DELETE was
 *      deliberately not granted, so M-2's guarantee — the reset ENDS rows, it
 *      does not remove them — rested on the function body alone.
 *
 * No data was exposed: RLS is on with zero policies and neither client role had
 * SELECT. `m` on an RLS-protected table with no policies is a nuisance
 * privilege, not a read.
 *
 * ── HOW THIS FILE VERIFIES WITHOUT A DATABASE ───────────────────────────────
 * Two halves, and the second is honest about what it is:
 *
 *   1. **Text assertions over the migrations.** The follow-up must use
 *      `REVOKE ALL`, must not re-introduce an enumeration, and must restate the
 *      positive grant.
 *   2. **The checker's predicates, READ OUT of the SQL and evaluated against
 *      two ACL strings.** This does **not** execute SQL, and it does not keep a
 *      second copy of the predicates either: the four `LIKE` patterns, the
 *      `substring` pattern and the privilege letters are all extracted from
 *      `check-bos-entitlements-migration.sql` at run time (QA-1). Editing the
 *      SQL therefore changes what this file tests, in the same direction, with
 *      nothing to keep in step by hand.
 *
 *      What is still a transcription is the DATA: the two ACL strings below are
 *      what the user reported, not something measured here. See the note on
 *      `ACL_AFTER` (QA-2).
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations');
const FIX_FILE = '20261009_business_os_entitlements_privilege_fix.sql';

const fix = readFileSync(join(MIGRATIONS, FIX_FILE), 'utf8');
const ddl = readFileSync(join(MIGRATIONS, '20261005_business_os_entitlements.sql'), 'utf8');
const checker = readFileSync(join(process.cwd(), 'scripts', 'check-bos-entitlements-migration.sql'), 'utf8');

const TABLES = [
  'business_os_account_plans',
  'business_os_entitlement_overrides',
  'business_os_entitlement_shadow_events',
];

/**
 * The ACL as `array_to_string(relacl, ' ')` returns it, **as reported by the
 * user from production on 2026-09-24** (QA-2).
 *
 * ⚠️ **This is a transcription, not a measurement.** Nothing here reads a
 * database, so if the real ACL differed from this string the suite would pass
 * exactly as it does now. What these two fixtures prove is that the predicates
 * DISCRIMINATE — that they answer differently before and after — not that the
 * database is in either state. The thing that reads the real ACL is check A4
 * itself, run by the operator.
 */
const ACL_NOW = [
  'postgres=arwdDxtm/postgres',
  'anon=m/postgres',
  'authenticated=m/postgres',
  'service_role=arwdDxtm/postgres',
].join(' ');

/**
 * The same ACL after the follow-up migration.
 *
 * `anon` and `authenticated` disappear entirely: PostgreSQL drops an ACL entry
 * once it carries no privileges, which is exactly what makes "no entry at all"
 * the right thing for A4 to assert. `service_role` keeps everything except
 * `d` and `D`.
 *
 * ⚠️ **Also a transcription** (QA-2), and one step further removed than
 * `ACL_NOW`: it is what the migration SHOULD leave behind, derived by hand from
 * what it revokes. It has not been observed. The operator observes it by
 * re-running block 1 after step 9 of the runbook — that is the measurement, and
 * this is the expectation it will be compared against.
 */
const ACL_AFTER = ['postgres=arwdDxtm/postgres', 'service_role=arwxtm/postgres'].join(' ');

describe('the follow-up migration revokes by ALL, never by list', () => {
  it.each(TABLES)('%s: REVOKE ALL from anon, authenticated and PUBLIC', (table) => {
    for (const grantee of ['anon', 'authenticated', 'PUBLIC']) {
      expect(fix).toMatch(new RegExp(`REVOKE ALL ON TABLE public\\.${table}\\s+FROM ${grantee};`));
    }
  });

  it.each(TABLES)('%s: DELETE and TRUNCATE are taken away from service_role', (table) => {
    expect(fix).toMatch(new RegExp(`REVOKE DELETE, TRUNCATE ON TABLE public\\.${table}\\s+FROM service_role;`));
  });

  it.each(TABLES)('%s: the positive grant is restated', (table) => {
    // Idempotence in the useful direction: running this twice leaves exactly
    // the three privileges the module needs, whatever it started from.
    expect(fix).toMatch(new RegExp(`GRANT SELECT, INSERT, UPDATE ON TABLE public\\.${table}\\s+TO service_role;`));
  });

  it('never enumerates a revoke for a client role', () => {
    // The trap itself. A list written today stops covering the privileges a
    // database gains tomorrow — which is precisely how `m` survived.
    expect(fix).not.toMatch(/REVOKE\s+SELECT[^;]*FROM\s+(PUBLIC|anon|authenticated)/i);
  });

  it('touches privileges only — no DDL, no data', () => {
    // A privilege migration that also created or dropped something would be a
    // different review. Every statement is REVOKE, GRANT, BEGIN, COMMIT, SET —
    // or the trailing SELECT that prints the pointer and reads nothing.
    const statements = fix
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part.length > 0);

    expect(statements.length).toBeGreaterThan(20);
    for (const statement of statements) {
      expect(statement).toMatch(/^(BEGIN|COMMIT|SET LOCAL|REVOKE|GRANT|SELECT ')/);
    }
    // Exactly one statement IS a SELECT (the rest only name the privilege), and
    // it has no FROM, so it cannot read a row.
    expect(statements.filter((statement) => statement.startsWith('SELECT'))).toHaveLength(1);
    expect(fix).not.toMatch(/\bFROM\s+public\./);
  });

  it('carries its pointer as SQL, not as a comment (SA P-2)', () => {
    // The file is pasted by hand, so it is held to the no-comment rule. The
    // pointer is a final SELECT instead: a reader sees it at the bottom of the
    // file, and the operator sees it as the confirmation grid after running.
    expect(fix).not.toMatch(/--/);
    expect(fix).toMatch(/SELECT 'business_os entitlements privilege fix' AS migration/);
    expect(fix).toContain('see docs BUSINESS_OS_ENTITLEMENTS_APPLY_RUNBOOK.md step 9');
  });

  it('is safe to re-run', () => {
    // REVOKE and GRANT are idempotent by nature, and a REVOKE from a role with
    // no entry is a no-op. Nothing here is order-dependent or destructive.
    expect(fix).not.toMatch(/\b(DROP|TRUNCATE\s+TABLE|DELETE\s+FROM|ALTER\s+TABLE)\b/i);
  });
});

describe('the original migration no longer plants the same trap', () => {
  it('revokes ALL from the client roles', () => {
    expect(ddl).toMatch(/REVOKE ALL\s+ON TABLE[\s\S]{0,400}FROM PUBLIC, anon, authenticated;/);
  });

  it('revokes DELETE and TRUNCATE from service_role', () => {
    expect(ddl).toMatch(/REVOKE DELETE, TRUNCATE\s+ON TABLE[\s\S]{0,400}FROM service_role;/);
  });

  it('records why the enumeration was the bug', () => {
    // The next person will be tempted to "tidy" REVOKE ALL into a list.
    expect(ddl).toMatch(/THE TRAP IS THE ENUMERATION ITSELF/);
    expect(ddl).toMatch(/MAINTAIN/);
  });

  it('uses REVOKE ALL on the functions too', () => {
    // No gap there — EXECUTE is the only privilege a function can carry, so the
    // two were equivalent. It is the habit, applied where it is still free.
    expect(ddl).not.toMatch(/REVOKE EXECUTE ON FUNCTION/);
    expect((ddl.match(/REVOKE ALL ON FUNCTION/g) ?? []).length).toBe(4);
  });
});

describe('A4 / A4b / A10 fail on production as it is, and pass after the fix', () => {
  /**
   * The predicates, READ OUT of the checker rather than copied from it.
   *
   * QA-1: the previous version kept its own regexes and pinned them with
   * `expect(checker).toContain(...)`. That is a one-way check — it proves the
   * SQL still says what it said, and proves nothing about whether the TypeScript
   * beside it still means the same thing. Editing the regexes alone left every
   * assertion passing.
   *
   * Extracting them removes the second copy entirely, which is the only version
   * that cannot drift. It is not fragile: the extraction is four literal
   * patterns and a `substring` argument, and if any of them stops being found
   * the guard test below fails loudly rather than silently testing nothing.
   */

  /** `LIKE 'pattern'` as a JS test. `%` is "anything", everything else literal. */
  function likeToRegExp(pattern: string): RegExp {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${escaped.split('%').join('.*')}$`, 's');
  }

  /** The four `LIKE` patterns A4 tests the ACL text against. */
  const clientEntryPatterns = [...checker.matchAll(/acl_text LIKE '([^']*)'/g)].map((match) => match[1]);

  /** The `substring(... from '<regex>')` A4b and A10 pull the privileges with. */
  const servicePrivPattern = /substring\(plan_table_acl\.acl_text from '([^']*)'\)/.exec(checker)?.[1] ?? '';

  /**
   * The letters each check looks for, taken from its own `position(...)` calls.
   *
   * De-duplicated because every predicate appears twice in the SQL by
   * construction: once in the `CASE` that sets the status, once in the `FILTER`
   * that counts the offenders for the detail column.
   */
  const lettersFor = (pattern: RegExp) => [...new Set([...checker.matchAll(pattern)].map((match) => match[1]))];
  const deleteLetters = lettersFor(/position\('([dD])' in plan_table_state\.service_role_privs\)/g);
  const grantLetters = lettersFor(/position\('([raw])' in plan_table_state\.service_role_privs\)/g);

  const hasClientEntry = (acl: string) => clientEntryPatterns.some((pattern) => likeToRegExp(pattern).test(acl));
  const serviceRolePrivs = (acl: string) => new RegExp(servicePrivPattern).exec(acl)?.[1] ?? '';
  const holdsDeleteOrTruncate = (acl: string) =>
    deleteLetters.some((letter) => serviceRolePrivs(acl).includes(letter));
  const holdsReadAndWrite = (acl: string) =>
    grantLetters.every((letter) => serviceRolePrivs(acl).includes(letter));

  it('extracted every predicate from the checker, and the right number of each', () => {
    // If an extraction silently found nothing, every predicate below would be
    // vacuously true or vacuously false. These are the counts that make the
    // rest of this describe mean something.
    expect([...new Set(clientEntryPatterns)]).toEqual(['%anon=%', '%authenticated=%', '=%', '% =%']);
    expect(servicePrivPattern).toBe('service_role=([a-zA-Z*]*)');
    expect(deleteLetters).toEqual(['d', 'D']);
    expect(grantLetters).toEqual(['r', 'a', 'w']);
    expect(checker).toContain('A4 client roles have no acl entry at all');
    expect(checker).toContain('A4b service_role has no delete or truncate');
  });

  it('the LIKE translation means what SQL means', () => {
    // The one piece of logic this file owns rather than extracts.
    expect(likeToRegExp('%anon=%').test('postgres=arwdDxtm/postgres anon=m/postgres')).toBe(true);
    expect(likeToRegExp('%anon=%').test('postgres=arwdDxtm/postgres')).toBe(false);
    expect(likeToRegExp('=%').test('=r/postgres')).toBe(true);
    expect(likeToRegExp('=%').test('postgres=r/postgres')).toBe(false);
    expect(likeToRegExp('% =%').test('postgres=r/postgres =r/postgres')).toBe(true);
  });

  it('A4 FAILS on the production ACL — this is the defect that was found', () => {
    expect(hasClientEntry(ACL_NOW)).toBe(true);
  });

  it('A4 PASSES once the entries are gone entirely', () => {
    expect(hasClientEntry(ACL_AFTER)).toBe(false);
  });

  it('A4 is about the ENTRY, not about which privileges it holds', () => {
    // The strengthening QA asked for: `anon=m` carries no read, no write and no
    // DDL, and A4 must still fail on it. A check that looked for `anon=r` would
    // have passed on the real database.
    expect(hasClientEntry('postgres=arwdDxtm/postgres anon=m/postgres')).toBe(true);
    expect(hasClientEntry('postgres=arwdDxtm/postgres anon=r/postgres')).toBe(true);
    expect(hasClientEntry('postgres=arwdDxtm/postgres =r/postgres')).toBe(true); // PUBLIC
  });

  it('A4b FAILS on the production ACL — service_role holds d and D', () => {
    expect(serviceRolePrivs(ACL_NOW)).toBe('arwdDxtm');
    expect(holdsDeleteOrTruncate(ACL_NOW)).toBe(true);
  });

  it('A4b PASSES after the fix, and DELETE is then a privilege matter, not only a code one', () => {
    // `arwxtm` is the expectation, not an observation — see the note on
    // ACL_AFTER. What this asserts is that the predicate answers differently.
    expect(serviceRolePrivs(ACL_AFTER)).toBe('arwxtm');
    expect(holdsDeleteOrTruncate(ACL_AFTER)).toBe(false);
  });

  it('A10 passes in BOTH states, so the fix cannot be mistaken for a regression', () => {
    expect(holdsReadAndWrite(ACL_NOW)).toBe(true);
    expect(holdsReadAndWrite(ACL_AFTER)).toBe(true);
  });

  it('A10 fails if the grant is genuinely missing', () => {
    // The non-vacuity leg: a check that passed on anything would satisfy the
    // assertion above without meaning it.
    expect(holdsReadAndWrite('postgres=arwdDxtm/postgres')).toBe(false);
  });
});
