/**
 * Guard over the invite signup migration (invite-only signup, Slice 1b;
 * workplan §4.2, §5.2; SA R-1, D-2, I-2, I-5).
 *
 * Jest cannot run SQL and there is no branch database: the user pastes this
 * into the Supabase SQL editor on PROD by hand, then runs
 * `scripts/check-bos-invite-signup-migration.sql`. What the files alone can
 * prove is pinned here: editor safety, REVOKE ALL then one narrow grant, the
 * finalise function's shape (SECURITY INVOKER, empty search_path, the WHERE it
 * decides on, idempotency, no expiry or revoke re-check), NULL-safe CHECKs, no
 * plan names, no foreign keys, and a checker that matches the migration.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { COHORT_IDS } from '@/lib/business-os/entitlements/config/cohorts';
import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';

const ROOT = process.cwd();
const MIGRATION = join(ROOT, 'supabase', 'migrations', '20261014_business_os_invite_signup.sql');
const ROLLBACK = join(ROOT, 'supabase', 'SQL Scripts', '20261014_business_os_invite_signup_rollback.sql');
const CHECKER = join(ROOT, 'scripts', 'check-bos-invite-signup-migration.sql');

const FINALISE = 'business_os_finalise_invite_redemption';
const FINALISE_SIGNATURE = `public.${FINALISE}(uuid, uuid, text, text)`;
const LINEAGE = 'public.business_os_account_lineage';

const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const migration = read(MIGRATION);
const flat = migration.replace(/\s+/g, ' ');
const rollback = read(ROLLBACK).replace(/\s+/g, ' ');
const checker = read(CHECKER);

function literalsOf(sql: string): string[] {
  return [...sql.matchAll(/'([^']*)'/g)].map((match) => match[1]);
}

function functionBody(): string {
  const start = migration.indexOf('AS $$');
  const end = migration.indexOf('$$;', start + 5);
  expect(start).toBeGreaterThanOrEqual(0);
  return migration.slice(start + 5, end).replace(/\s+/g, ' ');
}

/** The literal list of the checker's `<column> IN (…)` whose first entry starts with `prefix`. */
function checkerList(column: string, prefix = ''): string[] {
  const escaped = column.replace('.', '\\.');
  const lists = [...checker.matchAll(new RegExp(`${escaped} IN \\(([^)]*)\\)`, 'g'))].map((match) => literalsOf(match[1]));
  const found = lists.find((list) => list.length > 0 && list[0].startsWith(prefix));
  expect(found).toBeDefined();
  return found ?? [];
}

const NEW_INVITE_COLUMNS = [...flat.matchAll(/ALTER TABLE public\.business_os_invites ADD COLUMN (\w+)/g)].map((m) => m[1]);
const NEW_INVITE_CHECKS = [...flat.matchAll(/ALTER TABLE public\.business_os_invites ADD CONSTRAINT (\w+) CHECK/g)].map((m) => m[1]);
const LINEAGE_CHECKS = [...flat.matchAll(/ALTER TABLE public\.business_os_account_lineage ADD CONSTRAINT (\w+) CHECK/g)].map((m) => m[1]);

describe('SQL-editor safety (the user pastes this by hand)', () => {
  it.each([
    ['migration', MIGRATION],
    ['rollback', ROLLBACK],
    ['checker', CHECKER],
  ])('%s has no comment and only letters, digits, underscores and spaces in literals', (_name, file) => {
    const text = read(file);
    expect(text).not.toContain('--');
    expect(text).not.toContain('/*');
    for (const literal of literalsOf(text)) {
      expect({ literal, ok: /^[A-Za-z0-9_ ]*$/.test(literal) }).toEqual({ literal, ok: true });
    }
  });

  it.each([
    ['migration', MIGRATION],
    ['checker', CHECKER],
  ])('%s uses no single-letter alias', (_name, file) => {
    expect(read(file)).not.toMatch(/\b(?:FROM|JOIN|UPDATE)\s+[\w.]+\s+(?:AS\s+)?[a-z]\b(?!\w)/i);
  });

  it('is one transaction with no IF NOT EXISTS / OR REPLACE (a second paste fails and changes nothing)', () => {
    expect(flat.match(/\bBEGIN;/g)).toHaveLength(1);
    expect(flat.match(/\bCOMMIT;/g)).toHaveLength(1);
    expect(flat.trim().startsWith('BEGIN;')).toBe(true);
    expect(flat.trim().endsWith('COMMIT;')).toBe(true);
    expect(flat).not.toMatch(/IF NOT EXISTS|OR REPLACE/i);
  });

  it('names no plan anywhere (FR-12)', () => {
    for (const id of [...COHORT_IDS, ...TIER_ORDER]) {
      expect(migration.toLowerCase()).not.toContain(`'${id.toLowerCase()}'`);
    }
  });

  it('has no foreign key and drops nothing', () => {
    expect(flat).not.toMatch(/\bREFERENCES\b/);
    expect(flat).not.toMatch(/\b(DROP|TRUNCATE|DELETE)\b/);
  });
});

describe('invite columns and CHECKs', () => {
  it('adds the eight code/claim columns and the five FR-12a columns (SA D-2), all nullable or defaulted', () => {
    expect(NEW_INVITE_COLUMNS).toEqual([
      'signup_code_hash',
      'signup_code_expires_at',
      'signup_code_attempts',
      'signup_code_sent_count',
      'signup_code_window_started_at',
      'signup_code_last_sent_at',
      'claimed_at',
      'claimed_account_id',
      'redemption_failed_at',
      'redemption_failed_step',
      'redemption_error_code',
      'redemption_error_message',
      'redemption_failed_account_id',
    ]);
    for (const match of flat.matchAll(/ADD COLUMN (\w+) ([^;]+);/g)) {
      if (/NOT NULL/.test(match[2])) expect(match[2]).toMatch(/DEFAULT 0/);
    }
  });

  it('the pairing CHECKs are NULL-safe (a CHECK passes on NULL, SA M-2)', () => {
    expect(flat).toContain('CHECK ((claimed_at IS NULL) = (claimed_account_id IS NULL))');
    expect(flat).toContain(
      'CHECK (redeemed_account_id IS NULL OR (claimed_account_id IS NOT NULL AND redeemed_account_id = claimed_account_id))'
    );
    expect(flat).toContain(
      'CHECK ((redemption_failed_at IS NULL AND redemption_failed_step IS NULL) OR (redemption_failed_at IS NOT NULL AND redemption_failed_step IS NOT NULL))'
    );
  });

  it('bounds the FR-12a record: step and code at 64, message at 300, and lists no step values in SQL', () => {
    expect(flat).toContain('char_length(redemption_failed_step) <= 64');
    expect(flat).toContain('char_length(redemption_error_code) <= 64');
    expect(flat).toContain('char_length(redemption_error_message) <= 300');
    for (const step of ['find_user', 'create_user', 'create_user_id_mismatch', 'finalise']) {
      expect(literalsOf(migration)).not.toContain(step);
    }
  });

  it('the checker names exactly the new columns and the new invite CHECKs', () => {
    expect(checkerList('pg_attribute.attname').sort()).toEqual([...NEW_INVITE_COLUMNS].sort());
    expect(checkerList('pg_constraint.conname', 'business_os_invites_').sort()).toEqual([...NEW_INVITE_CHECKS].sort());
    expect(NEW_INVITE_CHECKS).toHaveLength(7);
    expect(checker).toContain('invite_checks.all_checks = 23');
  });
});

describe('the lineage table (L-6)', () => {
  it('RLS on, REVOKE ALL from the four roles, then SELECT, INSERT to service_role only', () => {
    expect(flat).toContain(`ALTER TABLE ${LINEAGE} ENABLE ROW LEVEL SECURITY;`);
    const revokes = flat.match(new RegExp(`REVOKE [^;]+ON TABLE ${LINEAGE.replace('.', '\\.')}[^;]+;`, 'g'));
    expect(revokes).toEqual(
      ['PUBLIC', 'anon', 'authenticated', 'service_role'].map((role) => `REVOKE ALL ON TABLE ${LINEAGE} FROM ${role};`)
    );
    expect(flat.match(/GRANT [^;]+ON TABLE[^;]+;/g)).toEqual([`GRANT SELECT, INSERT ON TABLE ${LINEAGE} TO service_role;`]);
  });

  it('keys on account_id, has no user_id column, and its checker list matches', () => {
    expect(flat).toContain('CONSTRAINT business_os_account_lineage_pkey PRIMARY KEY (account_id)');
    expect(flat).not.toMatch(/\buser_id uuid\b/);
    expect(checkerList('pg_constraint.conname', 'business_os_account_lineage_').sort()).toEqual([...LINEAGE_CHECKS].sort());
  });
});

describe('the finalise function (I-2, I-5, L-5)', () => {
  const body = functionBody();

  it('is SECURITY INVOKER with an empty search_path, and the only function', () => {
    expect(flat.match(/CREATE FUNCTION/g)).toHaveLength(1);
    expect(flat).toContain(`CREATE FUNCTION public.${FINALISE}(p_invite_id uuid, p_account_id uuid, p_email text, p_cohort text)`);
    expect(flat).toContain('SECURITY INVOKER');
    expect(flat).not.toContain('SECURITY DEFINER');
    expect(flat).toContain("SET search_path = ''");
  });

  it('EXECUTE: REVOKE ALL from the four roles, then service_role only', () => {
    expect(flat.match(/REVOKE [^;]+ON FUNCTION[^;]+;/g)).toEqual(
      ['PUBLIC', 'anon', 'authenticated', 'service_role'].map((role) => `REVOKE ALL ON FUNCTION ${FINALISE_SIGNATURE} FROM ${role};`)
    );
    expect(flat.match(/GRANT [^;]+ON FUNCTION[^;]+;/g)).toEqual([`GRANT EXECUTE ON FUNCTION ${FINALISE_SIGNATURE} TO service_role;`]);
    expect(flat).not.toMatch(/REVOKE\s+(?!ALL\b)/i);
  });

  it('decides on the claimant, the email lock and the grant, and does NOT re-check expiry or revocation (I-2)', () => {
    for (const term of [
      'invite_row.id = p_invite_id',
      'invite_row.claimed_account_id = p_account_id',
      'invite_row.email = p_email',
      "invite_row.issuer_kind = 'admin'",
      "invite_row.grant_kind = 'cohort'",
      'invite_row.grant_id = p_cohort',
      'invite_row.redeemed_at IS NULL',
    ]) {
      expect(body).toContain(term);
    }
    expect(body).not.toContain('link_expires_at');
    expect(body).not.toContain('revoked_at');
  });

  it('is idempotent: when the UPDATE matches nothing, it returns the id already redeemed by the SAME account', () => {
    expect(body).toContain('IF v_invite_id IS NULL THEN');
    expect(body).toContain('done_row.redeemed_account_id = p_account_id');
  });

  it('writes the plan row with a plain INSERT, origin invite, and the end date computed in SQL from the row (F-5)', () => {
    expect(body).toContain('INSERT INTO public.business_os_account_plans (user_id, cohort, cohort_expires_at, origin, period_anchor, updated_at)');
    expect(body).toContain('CASE WHEN v_access_open_ended THEN NULL ELSE now() + make_interval(months => v_access_months) END');
    expect(body).toContain("'invite'");
    expect(body).not.toMatch(/ON CONFLICT/);
  });

  it('writes lineage at L1 with no parent and itself as root', () => {
    expect(body).toContain("VALUES (p_account_id, v_invite_id, 'admin_invite', NULL, p_account_id, 1)");
  });
});

describe('rollback and checker', () => {
  it('the rollback drops the function, the table, every new CHECK and every new column', () => {
    expect(rollback).toContain(`DROP FUNCTION ${FINALISE_SIGNATURE};`);
    expect(rollback).toContain(`DROP TABLE ${LINEAGE};`);
    for (const name of NEW_INVITE_CHECKS) expect(rollback).toContain(`DROP CONSTRAINT ${name};`);
    for (const column of NEW_INVITE_COLUMNS) expect(rollback).toContain(`DROP COLUMN ${column};`);
  });

  it('the checker has S01 to S12 and a verdict, reads privileges with aclexplode, and pins the service_role condition', () => {
    const rows = [...checker.matchAll(/'(S\d\d) /g)].map((match) => match[1]);
    expect(rows).toEqual(['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'S08', 'S09', 'S10', 'S11', 'S12']);
    expect(checker).toContain("'VERDICT'");
    expect(checker).toContain('aclexplode(');
    expect(checker).toContain("function_acl.grantee_name IN ('PUBLIC', 'anon', 'authenticated')");
    expect(checker).toContain('CASE WHEN function_service.execute_total = 1 AND function_service.other_total = 0 THEN');
    expect(checker).toContain("lineage_acl.grantee_name IN ('PUBLIC', 'anon', 'authenticated')");
    // QA-1b-1: S06 passes only on exactly SELECT and INSERT for service_role, and nothing else.
    expect(checker).toContain("count(*) FILTER (WHERE lineage_acl.privilege_name IN ('SELECT', 'INSERT')) AS expected_total");
    expect(checker).toContain("count(*) FILTER (WHERE lineage_acl.privilege_name NOT IN ('SELECT', 'INSERT')) AS unexpected_total");
    expect(checker).toContain('CASE WHEN lineage_service.expected_total = 2 AND lineage_service.unexpected_total = 0 THEN');
    expect(checker).toContain(`pg_proc.proname = '${FINALISE}'`);
    expect(checker).not.toContain('%');
  });
});
