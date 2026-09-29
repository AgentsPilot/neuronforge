/**
 * Guard over the Business OS invites migration (invite-only signup, Slice 0;
 * requirement §16.4 C-1 and C-2, workplan §4, §5 and SA R-5).
 *
 * WHY A TEST OVER SQL TEXT. Jest cannot run SQL and there is no branch
 * database: the user pastes this migration into the Supabase SQL editor on
 * PROD by hand, then runs `scripts/check-bos-invites-migration.sql`. What can be
 * proven from the files alone is pinned here, and each of these would fail
 * silently otherwise: an enumerated REVOKE that leaves MAINTAIN or TRUNCATE
 * behind (the 20261005 defect), a comment or punctuation the editor mangles, a
 * plan name leaking into SQL (FR-12), a foreign key that would cascade the
 * record away on account deletion (T-1), or a checker that has drifted from
 * the constraints it claims to verify.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { COHORT_IDS } from '@/lib/business-os/entitlements/config/cohorts';
import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';

const ROOT = process.cwd();
const MIGRATION = join(ROOT, 'supabase', 'migrations', '20261012_business_os_invites.sql');
const ROLLBACK = join(ROOT, 'supabase', 'SQL Scripts', '20261012_business_os_invites_rollback.sql');
const CHECKER = join(ROOT, 'scripts', 'check-bos-invites-migration.sql');

const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const migration = read(MIGRATION);
const flat = migration.replace(/\s+/g, ' ');
const checker = read(CHECKER);

/** Every single-quoted literal in a SQL text. */
function literalsOf(sql: string): string[] {
  return [...sql.matchAll(/'([^']*)'/g)].map((match) => match[1]);
}

/** The body of the CREATE TABLE statement. */
function tableBody(): string {
  const start = migration.indexOf('CREATE TABLE public.business_os_invites (');
  expect(start).toBeGreaterThanOrEqual(0);
  return migration.slice(start, migration.indexOf(');\n', start) + 2);
}

/** CHECK constraint names the migration defines, in file order. */
function migrationCheckNames(): string[] {
  return [...migration.matchAll(/ADD CONSTRAINT (\w+) CHECK/g)].map((match) => match[1]);
}

/** The constraint names the checker's IN list counts (R-5). */
function checkerCheckNames(): string[] {
  const start = checker.indexOf("pg_constraint.contype = 'c' AND pg_constraint.conname IN (");
  expect(start).toBeGreaterThanOrEqual(0);
  const open = checker.indexOf('(', checker.indexOf('conname IN', start));
  const close = checker.indexOf(')', open);
  return literalsOf(checker.slice(open, close + 1));
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

  it('the negative control: the alias rule would catch one', () => {
    expect('SELECT 1 FROM public.business_os_invites i').toMatch(
      /\b(?:FROM|JOIN)\s+[\w.]+\s+(?:AS\s+)?[a-z]\b(?!\w)/i
    );
  });
});

describe('C-1: one migration, one table, one transaction', () => {
  it('is wrapped in exactly one BEGIN … COMMIT, with plain CREATE TABLE (a second paste fails and changes nothing)', () => {
    expect(flat.match(/\bBEGIN;/g)).toHaveLength(1);
    expect(flat.match(/\bCOMMIT;/g)).toHaveLength(1);
    expect(flat.match(/CREATE TABLE/g)).toHaveLength(1);
    expect(flat).not.toMatch(/IF NOT EXISTS/i);
    expect(flat.trim().startsWith('BEGIN;')).toBe(true);
    expect(flat.trim().endsWith('COMMIT;')).toBe(true);
  });

  it('touches nothing but its own table', () => {
    expect(flat).not.toMatch(/\b(DROP|TRUNCATE|DELETE)\b/);
    expect(flat).not.toMatch(/\bUPDATE public\./);
    for (const alter of flat.match(/ALTER TABLE [\w.]+/g) ?? []) {
      expect(alter).toBe('ALTER TABLE public.business_os_invites');
    }
  });

  it('has every C-1 column, and no delivery, one-time-code or state column (those arrive later, additively)', () => {
    const body = tableBody();
    for (const column of [
      'token_hash text NOT NULL',
      'email text NOT NULL',
      'email_locked boolean NOT NULL DEFAULT true',
      'invite_type text NOT NULL',
      'grant_kind text NOT NULL',
      'grant_id text NOT NULL',
      'access_open_ended boolean',
      'access_months integer',
      'issuer_kind text NOT NULL',
      'issuer_admin_id uuid',
      'issuer_account_id uuid',
      'inviter_display_name text NOT NULL',
      'language text NOT NULL',
      'personal_note text',
      'internal_reason text NOT NULL',
      'link_expiry_days integer NOT NULL',
      'link_expires_at timestamptz NOT NULL',
      'first_viewed_at timestamptz',
      'revoked_at timestamptz',
      'revoked_by_admin_id uuid',
      'revoke_reason text',
      'redeemed_at timestamptz',
      'redeemed_account_id uuid',
      'created_at timestamptz NOT NULL DEFAULT now()',
      'updated_at timestamptz NOT NULL DEFAULT now()',
    ]) {
      expect(body).toContain(column);
    }
    expect(body).not.toMatch(/\b(sent_at|send_count|send_failed|provider_message_id|otp|code_hash|state|status)\b/);
  });

  it('has no user_id column: invites are platform records, not tenant data (§8.2, C-10)', () => {
    expect(tableBody()).not.toMatch(/\buser_id\b/);
  });

  it('token_hash is UNIQUE and email is indexed', () => {
    expect(flat).toContain('ADD CONSTRAINT business_os_invites_token_hash_key UNIQUE (token_hash);');
    expect(flat).toContain('CREATE INDEX business_os_invites_email_idx ON public.business_os_invites (email);');
  });

  it('has no foreign key (T-1, RC-9: account deletion must not cascade the record away)', () => {
    expect(flat).not.toMatch(/\bREFERENCES\b/);
    expect(flat).not.toMatch(/FOREIGN KEY/i);
  });

  it('has no function and no trigger (C-2: revoke is a conditional UPDATE)', () => {
    expect(flat).not.toMatch(/CREATE (OR REPLACE )?FUNCTION/i);
    expect(flat).not.toMatch(/CREATE (OR REPLACE )?TRIGGER/i);
  });

  it('names no plan in SQL (FR-12): the access CHECK keys on grant_kind', () => {
    const planIds = [...(COHORT_IDS as readonly string[]), ...(TIER_ORDER as readonly string[]), 'basic', 'pro'];
    for (const id of planIds) {
      expect(literalsOf(migration)).not.toContain(id);
    }
    expect(flat).toContain(
      "CHECK ((grant_kind = 'cohort' AND access_open_ended IS TRUE AND access_months IS NULL) OR (grant_kind = 'cohort' AND access_open_ended IS FALSE AND access_months IS NOT NULL AND access_months > 0) OR (grant_kind = 'tier' AND access_open_ended IS NULL AND access_months IS NULL));"
    );
  });

  /** One CHECK's full statement, by constraint name. */
  function checkStatement(name: string): string {
    const match = flat.match(new RegExp(`ADD CONSTRAINT ${name} CHECK [^;]*;`));
    expect(match).not.toBeNull();
    return match ? match[0] : '';
  }

  it('M-2: a months grant cannot have NULL months (a NULL would make the CHECK pass)', () => {
    expect(checkStatement('business_os_invites_access_shape')).toContain(
      "(grant_kind = 'cohort' AND access_open_ended IS FALSE AND access_months IS NOT NULL AND access_months > 0)"
    );
  });

  it('M-2: a revoke cannot have a NULL reason (a NULL would make the CHECK pass)', () => {
    expect(checkStatement('business_os_invites_revocation_complete')).toContain(
      '(revoked_at IS NOT NULL AND revoke_reason IS NOT NULL AND char_length(btrim(revoke_reason)) >= 3)'
    );
  });

  it('N-3: revoked_by_admin_id is deliberately NOT required on a revoke (the future account-issued revoke has no admin)', () => {
    expect(checkStatement('business_os_invites_revocation_complete')).not.toMatch(/revoked_by_admin_id IS NOT NULL/);
  });

  it('has the 16 structural CHECKs of §4, each added on its own line', () => {
    expect(migrationCheckNames()).toEqual([
      'business_os_invites_token_hash_length',
      'business_os_invites_email_normalised',
      'business_os_invites_invite_type_present',
      'business_os_invites_grant_kind_known',
      'business_os_invites_grant_id_present',
      'business_os_invites_access_shape',
      'business_os_invites_one_issuer',
      'business_os_invites_inviter_name_length',
      'business_os_invites_language_present',
      'business_os_invites_note_length',
      'business_os_invites_reason_length',
      'business_os_invites_expiry_days_positive',
      'business_os_invites_expiry_after_creation',
      'business_os_invites_revocation_complete',
      'business_os_invites_redemption_complete',
      'business_os_invites_not_revoked_and_redeemed',
    ]);
    expect(flat).toContain('CHECK (char_length(token_hash) = 64)');
    expect(flat).toContain('CHECK (personal_note IS NULL OR char_length(personal_note) <= 1000)');
    expect(flat).toContain('CHECK (revoked_at IS NULL OR redeemed_at IS NULL)');
  });
});

describe('C-2: privileges', () => {
  it('enables RLS and creates no policy', () => {
    expect(flat).toContain('ALTER TABLE public.business_os_invites ENABLE ROW LEVEL SECURITY;');
    expect(flat).not.toMatch(/CREATE POLICY/i);
  });

  it('REVOKE ALL from exactly the four roles, and never an enumerated REVOKE', () => {
    const revokes = flat.match(/REVOKE [^;]*;/g) ?? [];
    expect(revokes).toEqual([
      'REVOKE ALL ON TABLE public.business_os_invites FROM PUBLIC;',
      'REVOKE ALL ON TABLE public.business_os_invites FROM anon;',
      'REVOKE ALL ON TABLE public.business_os_invites FROM authenticated;',
      'REVOKE ALL ON TABLE public.business_os_invites FROM service_role;',
    ]);
    expect(flat).not.toMatch(/REVOKE\s+(?!ALL\b)/i);
  });

  it('exactly one GRANT: SELECT, INSERT, UPDATE to service_role (no DELETE: invites are revoked, never deleted)', () => {
    expect(flat.match(/GRANT [^;]*;/g)).toEqual([
      'GRANT SELECT, INSERT, UPDATE ON TABLE public.business_os_invites TO service_role;',
    ]);
  });

  it('the GRANT comes after every REVOKE', () => {
    expect(flat.indexOf('GRANT SELECT')).toBeGreaterThan(flat.lastIndexOf('REVOKE ALL'));
  });
});

describe('the read-only checker (C-2, R-5)', () => {
  it('is read-only and ends in one SELECT', () => {
    expect(checker.trim().startsWith('SET default_transaction_read_only = on;')).toBe(true);
    // Literals removed first: the privilege names it compares against are data.
    const code = checker.replace(/'[^']*'/g, "''");
    expect(code).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|GRANT|REVOKE|CREATE)\b/);
  });

  it('holds checks I01 to I11 and a verdict', () => {
    for (const id of ['I01', 'I02', 'I03', 'I04', 'I05', 'I06', 'I07', 'I08', 'I09', 'I10', 'I11']) {
      expect(checker).toContain(`'${id} `);
    }
    expect(checker).toContain("'VERDICT'");
  });

  it('reads privileges with aclexplode, so MAINTAIN, TRUNCATE, REFERENCES and TRIGGER are all seen', () => {
    expect(checker).toContain('aclexplode(');
    expect(checker).toContain("acl_entries.grantee_name IN ('PUBLIC', 'anon', 'authenticated')");
    expect(checker).toContain("acl_entries.privilege_name NOT IN ('SELECT', 'INSERT', 'UPDATE')");
  });

  it('N-2: asserts the email index the migration creates, by exact name', () => {
    expect(flat).toContain('CREATE INDEX business_os_invites_email_idx ON');
    expect(checker).toContain("pg_indexes.indexname = 'business_os_invites_email_idx'");
    expect(checker).toContain('index_summary.email_index = 1');
  });

  it('counts CHECKs with an explicit IN list, never LIKE with a percent sign (R-5)', () => {
    expect(checker).not.toContain('%');
    expect(checker).not.toMatch(/\bLIKE\b/i);
  });

  it('its IN list is exactly the 16 CHECK constraints the migration defines, so the two files cannot drift', () => {
    const fromMigration = migrationCheckNames();
    expect(fromMigration).toHaveLength(16);
    expect([...checkerCheckNames()].sort()).toEqual([...fromMigration].sort());
    expect(checker).toContain('constraint_summary.named_checks = 16');
  });
});

describe('the rollback', () => {
  it('is a separate file outside supabase/migrations and drops exactly this table', () => {
    expect(existsSync(ROLLBACK)).toBe(true);
    const rollback = read(ROLLBACK).replace(/\s+/g, ' ').trim();
    expect(rollback).toBe('BEGIN; DROP TABLE public.business_os_invites; COMMIT;');
  });
});
