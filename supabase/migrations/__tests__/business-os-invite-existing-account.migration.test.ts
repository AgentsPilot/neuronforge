/**
 * Guard over the invite existing-account migration (invite-only signup,
 * Slice 1a; requirement §16.5 L-3, workplan §4.1, §5.1 and SA R-4).
 *
 * WHY A TEST OVER SQL TEXT. Jest cannot run SQL and there is no branch
 * database: the user pastes this migration into the Supabase SQL editor on
 * PROD by hand, then runs `scripts/check-bos-invite-existing-account-migration.sql`.
 * What can be proven from the files alone is pinned here.
 *
 * The one thing this migration must never do is add a SECURITY DEFINER
 * function a client can call (the repo already has too many). So the
 * privilege block is pinned to its exact shape: REVOKE ALL from the four roles,
 * one statement each, then EXECUTE to service_role and nobody else, with an
 * empty `search_path` and every name schema-qualified.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { COHORT_IDS } from '@/lib/business-os/entitlements/config/cohorts';
import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';

const ROOT = process.cwd();
const MIGRATION = join(ROOT, 'supabase', 'migrations', '20261013_business_os_invite_existing_account.sql');
const ROLLBACK = join(ROOT, 'supabase', 'SQL Scripts', '20261013_business_os_invite_existing_account_rollback.sql');
const CHECKER = join(ROOT, 'scripts', 'check-bos-invite-existing-account-migration.sql');

const FUNCTION_NAME = 'business_os_auth_email_has_account';
const FUNCTION_SIGNATURE = `public.${FUNCTION_NAME}(text)`;
const COLUMN = 'opened_by_existing_account_at';

const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const migration = read(MIGRATION);
const flat = migration.replace(/\s+/g, ' ');
const rollback = read(ROLLBACK).replace(/\s+/g, ' ');
const checker = read(CHECKER);

/** Every single-quoted literal in a SQL text. */
function literalsOf(sql: string): string[] {
  return [...sql.matchAll(/'([^']*)'/g)].map((match) => match[1]);
}

/** The function body between the dollar quotes. */
function functionBody(): string {
  const start = migration.indexOf('AS $$');
  const end = migration.indexOf('$$;', start + 5);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return migration.slice(start + 5, end);
}

describe('SQL-editor safety (the user pastes this by hand)', () => {
  it.each([
    ['migration', MIGRATION],
    ['rollback', ROLLBACK],
    ['checker', CHECKER],
  ])('%s has no line comment and no block comment', (_name, file) => {
    const text = read(file);
    expect(text).not.toContain('--');
    expect(text).not.toContain('/*');
  });

  it.each([
    ['migration', MIGRATION],
    ['rollback', ROLLBACK],
    ['checker', CHECKER],
  ])('%s holds only letters, digits, underscores and spaces inside string literals', (_name, file) => {
    for (const literal of literalsOf(read(file))) {
      expect({ literal, ok: /^[A-Za-z0-9_ ]*$/.test(literal) }).toEqual({ literal, ok: true });
    }
  });

  it.each([
    ['migration', MIGRATION],
    ['checker', CHECKER],
  ])('%s uses no single-letter alias', (_name, file) => {
    expect(read(file)).not.toMatch(/\b(?:FROM|JOIN)\s+[\w.]+\s+(?:AS\s+)?[a-z]\b(?!\w)/i);
  });

  it('is wrapped in exactly one BEGIN … COMMIT', () => {
    expect(flat.match(/\bBEGIN;/g)).toHaveLength(1);
    expect(flat.match(/\bCOMMIT;/g)).toHaveLength(1);
    expect(flat.trim().startsWith('BEGIN;')).toBe(true);
    expect(flat.trim().endsWith('COMMIT;')).toBe(true);
  });
});

describe('scope: one column and one function, nothing else', () => {
  it('adds exactly one nullable column with no default to the invite table', () => {
    const adds = flat.match(/ALTER TABLE [\w.]+ ADD COLUMN [^;]+;/g) ?? [];
    expect(adds).toEqual([`ALTER TABLE public.business_os_invites ADD COLUMN ${COLUMN} timestamptz;`]);
    expect(flat.match(/ALTER TABLE/g)).toHaveLength(1);
  });

  it('creates no table, trigger, policy, index or constraint, and removes nothing', () => {
    expect(flat).not.toMatch(/CREATE (TABLE|TRIGGER|POLICY|INDEX)/);
    expect(flat).not.toMatch(/ADD CONSTRAINT/);
    expect(flat).not.toMatch(/\b(DROP|TRUNCATE|DELETE|UPDATE|INSERT)\b/);
    expect(flat).not.toMatch(/IF NOT EXISTS|OR REPLACE/i);
  });

  it('names no plan anywhere (FR-12)', () => {
    const lowered = migration.toLowerCase();
    for (const id of [...COHORT_IDS, ...TIER_ORDER]) {
      expect(lowered).not.toContain(`'${id.toLowerCase()}'`);
    }
  });
});

describe('the lookup function (L-3, F-4 as approved)', () => {
  it('is the only function, and is a hardened SECURITY DEFINER returning a boolean', () => {
    expect(flat.match(/CREATE FUNCTION/g)).toHaveLength(1);
    expect(flat).toContain(`CREATE FUNCTION ${FUNCTION_SIGNATURE.replace('(text)', '(p_email text)')}`);
    expect(flat).toContain('RETURNS boolean');
    expect(flat).toContain('LANGUAGE sql');
    expect(flat).toContain('STABLE');
    expect(flat).toContain('SECURITY DEFINER');
    expect(flat).toContain("SET search_path = ''");
  });

  it('reads only auth.users, schema-qualified, and returns existence only (no id, no email)', () => {
    const body = functionBody().replace(/\s+/g, ' ').trim();
    expect(body).toBe(
      'SELECT EXISTS ( SELECT 1 FROM auth.users AS auth_user WHERE lower(auth_user.email) = lower(btrim(p_email)) );'
    );
  });

  it('takes EXECUTE from PUBLIC, anon, authenticated and service_role, one REVOKE ALL each, and grants it back to service_role only', () => {
    const revokes = flat.match(/REVOKE [^;]+;/g) ?? [];
    expect(revokes).toEqual(
      ['PUBLIC', 'anon', 'authenticated', 'service_role'].map(
        (role) => `REVOKE ALL ON FUNCTION ${FUNCTION_SIGNATURE} FROM ${role};`
      )
    );
    const grants = flat.match(/GRANT [^;]+;/g) ?? [];
    expect(grants).toEqual([`GRANT EXECUTE ON FUNCTION ${FUNCTION_SIGNATURE} TO service_role;`]);
  });

  it('never uses an enumerated REVOKE', () => {
    expect(flat).not.toMatch(/REVOKE\s+(?!ALL\b)/i);
  });
});

describe('rollback and checker match the migration', () => {
  it('the rollback drops exactly what the migration adds', () => {
    expect(rollback.match(/DROP [^;]+;/g)).toEqual([
      `DROP FUNCTION ${FUNCTION_SIGNATURE};`,
      `DROP COLUMN ${COLUMN};`,
    ]);
  });

  it('the checker names the same function and column, and checks privileges with aclexplode', () => {
    expect(literalsOf(checker)).toEqual(expect.arrayContaining([FUNCTION_NAME, COLUMN]));
    expect(checker).toContain('aclexplode');
    expect(checker).toContain("acldefault('f'");
    expect(checker).toContain('chr(61)');
    expect(checker).not.toContain('%');
  });

  it('QA-1: E06 names exactly the client roles, and E07 passes only on EXECUTE and nothing else', () => {
    expect(checker).toContain("function_acl.grantee_name IN ('PUBLIC', 'anon', 'authenticated')");
    expect(checker).toContain('CASE WHEN client_entries.total = 0 THEN');
    expect(checker).toContain("function_acl.grantee_name = 'service_role'");
    expect(checker).toContain("count(*) FILTER (WHERE function_acl.privilege_name = 'EXECUTE') AS execute_total");
    expect(checker).toContain("count(*) FILTER (WHERE function_acl.privilege_name <> 'EXECUTE') AS other_total");
    expect(checker).toContain('CASE WHEN service_entries.execute_total = 1 AND service_entries.other_total = 0 THEN');
  });

  it('the checker has seven numbered checks and a verdict', () => {
    const rows = [...checker.matchAll(/'(E0\d) /g)].map((match) => match[1]);
    expect(rows).toEqual(['E01', 'E02', 'E03', 'E04', 'E05', 'E06', 'E07']);
    expect(checker).toContain("'VERDICT'");
  });

  it('E02 reports the table-wide CHECK total as information, never as a FAIL', () => {
    // Later migrations (20261014, 20261020) add invite CHECKs, so a pinned 16
    // made this checker FAIL by design on every later schema.
    expect(checker).toMatch(/'E02 total invite checks for information',\s+'INFO',/);
    expect(checker).not.toContain('check_summary.all_checks = 16');
    expect(checker).toContain("checks.status = 'INFO'");
  });
});
