/**
 * Guard over the friend-invite migration (invite-only signup, Slice 5a;
 * requirement §17 T-17, T-21, F5a-2; workplan §4, SA R-4).
 *
 * Jest cannot run SQL and there is no branch database: the user pastes this
 * into the Supabase SQL editor on PROD by hand, then runs
 * `scripts/check-bos-friend-invites-migration.sql`. What the files alone can
 * prove is pinned here: editor safety, C-2 privileges, SECURITY INVOKER with an
 * empty search_path, the namespaced advisory-lock key (R-4), the T-17 counted
 * predicate, no plan name and no policy number in the SQL, and a checker and a
 * rollback that match the migration.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { COHORT_IDS } from '@/lib/business-os/entitlements/config/cohorts';
import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';

const ROOT = process.cwd();
const MIGRATION = join(ROOT, 'supabase', 'migrations', '20261023_business_os_friend_invites.sql');
const ROLLBACK = join(ROOT, 'supabase', 'SQL Scripts', '20261023_business_os_friend_invites_rollback.sql');
const CHECKER = join(ROOT, 'scripts', 'check-bos-friend-invites-migration.sql');

const FUNCTION_NAME = 'business_os_create_friend_invite';
const SIGNATURE = `public.${FUNCTION_NAME}(uuid, text, text, text, integer, integer, integer, text, text, text, text, text, text, text, integer)`;
const INDEX_NAME = 'business_os_invites_issuer_account_idx';
const LOCK_PREFIX = 'business_os_friend_invite:';

/** T-17's counted predicate, as the migration must write it (the TypeScript mirror is pinned against it too). */
export const COUNTED_PREDICATE_SQL =
  "invite_row.issuer_kind = 'account' AND invite_row.issuer_account_id = p_issuer_account_id AND invite_row.revoked_at IS NULL AND (invite_row.redeemed_at IS NOT NULL OR invite_row.claimed_account_id IS NOT NULL OR invite_row.link_expires_at > now())";

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

describe('SQL-editor safety (the user pastes this by hand)', () => {
  it.each([
    ['migration', MIGRATION],
    ['rollback', ROLLBACK],
    ['checker', CHECKER],
  ])('%s has no comment and only plain characters in literals', (_name, file) => {
    const text = read(file);
    expect(text).not.toContain('--');
    expect(text).not.toContain('/*');
    for (const literal of literalsOf(text)) {
      // The one colon is the lock-key namespace separator (R-4).
      const ok = literal === LOCK_PREFIX || /^[A-Za-z0-9_ ]*$/.test(literal);
      expect({ literal, ok }).toEqual({ literal, ok: true });
    }
  });

  it.each([
    ['migration', MIGRATION],
    ['checker', CHECKER],
  ])('%s uses no single-letter alias', (_name, file) => {
    expect(read(file)).not.toMatch(/\b(?:FROM|JOIN|UPDATE|INTO)\s+[\w.]+\s+(?:AS\s+)?[a-z]\b(?!\w)/i);
  });

  it('is one transaction with no IF NOT EXISTS / OR REPLACE (a second paste fails and changes nothing)', () => {
    expect(flat.match(/\bBEGIN;/g)).toHaveLength(1);
    expect(flat.match(/\bCOMMIT;/g)).toHaveLength(1);
    expect(flat.trim().startsWith('BEGIN;')).toBe(true);
    expect(flat.trim().endsWith('COMMIT;')).toBe(true);
    expect(flat).not.toMatch(/CREATE \w+ IF NOT EXISTS|OR REPLACE/i);
  });

  it('creates exactly one index and one function, and alters, drops or deletes nothing', () => {
    expect(flat.match(/CREATE INDEX/g)).toHaveLength(1);
    expect(flat.match(/CREATE FUNCTION/g)).toHaveLength(1);
    expect(flat).not.toMatch(/\b(ALTER TABLE|DROP|TRUNCATE|DELETE|CREATE TABLE|REFERENCES)\b/);
  });
});

describe('no plan names and no policy numbers in the SQL (F5a-2, L-5)', () => {
  it('names no cohort and no tier', () => {
    for (const id of [...COHORT_IDS, ...TIER_ORDER]) {
      expect(migration.toLowerCase()).not.toContain(`'${id.toLowerCase()}'`);
    }
  });

  it('holds no numeric literal except the hash seed', () => {
    const numbers = [...functionBody().matchAll(/(?<![\w.])\d+(?![\w.])/g)].map((match) => match[0]);
    expect(numbers).toEqual(['0']);
    expect(functionBody()).toContain(`hashtextextended('${LOCK_PREFIX}' || p_issuer_account_id::text, 0)`);
  });

  it('takes the allowance, the daily limit and its window, the cohort, the type and the grant as parameters', () => {
    for (const parameter of ['p_allowance integer', 'p_daily_limit integer', 'p_daily_window_hours integer', 'p_issuer_cohort text', 'p_invite_type text', 'p_grant_id text', 'p_link_expiry_days integer']) {
      expect(flat).toContain(parameter);
    }
  });
});

describe('the send function (T-17, T-21)', () => {
  const body = () => functionBody();

  it('is SECURITY INVOKER with an empty search_path', () => {
    expect(flat).toMatch(/LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS \$\$/);
    expect(flat).not.toMatch(/SECURITY DEFINER/);
  });

  it('takes the namespaced per-issuer advisory lock FIRST (R-4)', () => {
    const statements = body().split(';').map((part) => part.trim()).filter(Boolean);
    const firstAfterDeclare = statements.findIndex((part) => part.includes('BEGIN'));
    expect(statements[firstAfterDeclare]).toContain(
      `PERFORM pg_advisory_xact_lock(hashtextextended('${LOCK_PREFIX}' || p_issuer_account_id::text, 0))`
    );
  });

  it('checks in the T-17 order: champion, allowance, daily limit, recipient, insert', () => {
    const text = body();
    const order = ['business_os_account_plans', "'not_eligible'", "'allowance_reached'", "'daily_limit'", "'already_invited'", 'INSERT INTO', "'created'"].map((marker) =>
      text.indexOf(marker)
    );
    for (const at of order) expect(at).toBeGreaterThan(-1);
    expect([...order].sort((left, right) => left - right)).toEqual(order);
  });

  it('re-checks the in-force cohort from the plan row, never through the resolver (T-17 mode)', () => {
    expect(body()).toContain(
      'plan_row.user_id = p_issuer_account_id AND plan_row.cohort = p_issuer_cohort AND (plan_row.cohort_expires_at IS NULL OR plan_row.cohort_expires_at > now())'
    );
  });

  it('counts with exactly the T-17 predicate', () => {
    expect(body()).toContain(COUNTED_PREDICATE_SQL);
    expect(body()).toContain('IF v_counted >= p_allowance THEN');
  });

  it('counts every send in the rolling window whatever its state (T-21)', () => {
    // QA5a-1: the WHOLE statement, through its semicolon, so an added filter
    // (for example `AND recent_row.revoked_at IS NULL`) fails this test.
    expect(body()).toContain(
      "SELECT count(*) INTO v_recent FROM public.business_os_invites AS recent_row WHERE recent_row.issuer_kind = 'account' AND recent_row.issuer_account_id = p_issuer_account_id AND recent_row.created_at > now() - make_interval(hours => p_daily_window_hours); IF v_recent >= p_daily_limit THEN"
    );
  });

  it('refuses a second live, not-accepted invite to the same address (T-21 per-recipient guard)', () => {
    expect(body()).toContain(
      "same_row.email = p_email AND same_row.redeemed_at IS NULL AND same_row.revoked_at IS NULL AND (same_row.claimed_account_id IS NOT NULL OR same_row.link_expires_at > now())"
    );
  });

  it('inserts an account-issued tier invite with the expiry and attempt stamped on the database clock', () => {
    expect(body()).toContain("VALUES (p_token_hash, p_email, p_invite_type, 'tier', p_grant_id, NULL, NULL, 'account', p_issuer_account_id,");
    expect(body()).toContain('now() + make_interval(days => p_link_expiry_days), now())');
    expect(body()).not.toMatch(/issuer_admin_id/);
  });

  it('applies C-2: REVOKE ALL from PUBLIC, anon, authenticated and service_role, then EXECUTE to service_role only', () => {
    for (const role of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
      expect(flat).toContain(`REVOKE ALL ON FUNCTION ${SIGNATURE} FROM ${role};`);
    }
    expect(flat.match(/GRANT /g)).toHaveLength(1);
    expect(flat).toContain(`GRANT EXECUTE ON FUNCTION ${SIGNATURE} TO service_role;`);
  });

  it('adds a partial issuer index', () => {
    expect(flat).toContain(`CREATE INDEX ${INDEX_NAME} ON public.business_os_invites (issuer_account_id, created_at) WHERE issuer_kind = 'account';`);
  });
});

describe('rollback and checker match the migration', () => {
  it('the rollback drops exactly the function and the index', () => {
    expect(rollback.trim()).toBe(`BEGIN; DROP FUNCTION ${SIGNATURE}; DROP INDEX public.${INDEX_NAME}; COMMIT;`);
  });

  it('the checker is read-only and names the same function and index', () => {
    expect(checker.startsWith('SET default_transaction_read_only = on;')).toBe(true);
    expect(checker).toContain(`pg_proc.proname = '${FUNCTION_NAME}'`);
    expect(checker).toContain(`index_class.relname = '${INDEX_NAME}'`);
    expect(checker).toContain("'issuer_account_id created_at'");
    expect(checker).toContain('argument_count = 15');
    // F09 (SA code review): the function source carries the R-4 lock-key prefix.
    expect(checker).toContain(`position('${LOCK_PREFIX}' IN pg_proc.prosrc) > 0`);
    expect(checker.replace(/'[^']*'/g, "''")).not.toMatch(/\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|GRANT|REVOKE)\b/);
  });

  it('the checker has rows F01 to F09 and a VERDICT', () => {
    for (const row of ['F01', 'F02', 'F03', 'F04a', 'F04b', 'F05', 'F06a', 'F06b', 'F07', 'F08', 'F09']) {
      expect(checker).toContain(`'${row} `);
    }
    expect(checker).toContain("'VERDICT'");
  });
});
