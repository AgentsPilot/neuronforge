/**
 * Guard over the friend-signup migration (invite-only signup, Slice 5b-1;
 * requirement §17 T-19, F5b-1; workplan §4, SA R-6, R-7).
 *
 * Jest cannot run SQL and there is no branch database: the user pastes this
 * into the Supabase SQL editor on PROD by hand, then runs
 * `scripts/check-bos-friend-invite-signup-migration.sql`. What the files alone
 * can prove is pinned here: editor safety, C-2 privileges, SECURITY INVOKER
 * with an empty search_path, T-19's explicit filters and plain INSERTs, the
 * level rule, the no-basis plan row (T-13 layer 1), no plan name in the SQL,
 * and a checker and a rollback that match the migration. The behaviour itself
 * was run in PGlite (workplan §6.1).
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { COHORT_IDS } from '@/lib/business-os/entitlements/config/cohorts';
import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';

const ROOT = process.cwd();
const MIGRATION = join(ROOT, 'supabase', 'migrations', '20261024_business_os_friend_invite_signup.sql');
const ROLLBACK = join(ROOT, 'supabase', 'SQL Scripts', '20261024_business_os_friend_invite_signup_rollback.sql');
const CHECKER = join(ROOT, 'scripts', 'check-bos-friend-invite-signup-migration.sql');

const FUNCTION_NAME = 'business_os_finalise_friend_invite_redemption';
const SIGNATURE = `public.${FUNCTION_NAME}(uuid, uuid, text, text, text)`;

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
      expect({ literal, ok: /^[A-Za-z0-9_ ]*$/.test(literal) }).toEqual({ literal, ok: true });
    }
  });

  it.each([
    ['migration', MIGRATION],
    ['checker', CHECKER],
  ])('%s uses no single-letter alias', (_name, file) => {
    expect(read(file)).not.toMatch(/\b(?:FROM|JOIN|UPDATE|INTO)\s+[\w.]+\s+(?:AS\s+)?[a-z]\b(?!\w)/i);
  });

  it('is one transaction with a bounded lock wait and no IF NOT EXISTS / OR REPLACE', () => {
    expect(flat.match(/\bBEGIN;/g)).toHaveLength(1);
    expect(flat.match(/\bCOMMIT;/g)).toHaveLength(1);
    expect(flat.trim().startsWith("BEGIN; SET LOCAL lock_timeout = '5s';")).toBe(true);
    expect(flat.trim().endsWith('COMMIT;')).toBe(true);
    // `IF NOT EXISTS (` inside the plpgsql body is a condition, not DDL.
    expect(flat).not.toMatch(/(CREATE|ADD) \w+ IF NOT EXISTS|OR REPLACE/i);
  });

  it('adds two lineage columns, two CHECKs and one function, and drops, deletes or grants on no table', () => {
    expect(flat.match(/ALTER TABLE public\.business_os_account_lineage ADD COLUMN/g)).toHaveLength(2);
    expect(flat).toContain('ALTER TABLE public.business_os_account_lineage ADD COLUMN first_paid_at timestamptz;');
    expect(flat).toContain('ALTER TABLE public.business_os_account_lineage ADD COLUMN first_payment_ref text;');
    expect(flat).toContain(
      'ADD CONSTRAINT business_os_account_lineage_first_payment_paired CHECK ((first_paid_at IS NULL) = (first_payment_ref IS NULL));'
    );
    expect(flat).toContain(
      'ADD CONSTRAINT business_os_account_lineage_first_payment_ref_length CHECK (first_payment_ref IS NULL OR char_length(first_payment_ref) BETWEEN 1 AND 255);'
    );
    expect(flat.match(/CREATE FUNCTION/g)).toHaveLength(1);
    expect(flat).not.toMatch(/\b(DROP|TRUNCATE|DELETE|CREATE TABLE|CREATE INDEX|REFERENCES)\b/);
    expect(flat).not.toMatch(/GRANT [A-Z, ]+ ON TABLE/);
  });
});

describe('no plan names in the SQL (L-5, T-19)', () => {
  it('names no cohort and no tier', () => {
    for (const id of [...COHORT_IDS, ...TIER_ORDER]) {
      expect(migration.toLowerCase()).not.toContain(`'${id.toLowerCase()}'`);
    }
  });

  it('holds only the level rule as numbers in the body (2 for a parent with no lineage, parent + 1)', () => {
    const numbers = [...functionBody().matchAll(/(?<![\w.])\d+(?![\w.])/g)].map((match) => match[0]);
    expect(numbers).toEqual(['2', '1']);
    expect(functionBody()).toContain('v_level := 2; v_root := v_issuer;');
    expect(functionBody()).toContain('v_level := v_parent_level + 1; v_root := v_parent_root;');
  });

  it('takes the tier and the issuer cohort as parameters', () => {
    expect(flat).toContain(`CREATE FUNCTION ${SIGNATURE.replace('(uuid, uuid, text, text, text)', '')}(p_invite_id uuid, p_account_id uuid, p_email text, p_tier text, p_issuer_cohort text)`);
    expect(functionBody()).toContain('invite_row.grant_id = p_tier');
    expect(functionBody()).toContain('plan_row.cohort = p_issuer_cohort');
  });
});

describe('the friend finalise (T-19)', () => {
  const body = () => functionBody();

  it('is SECURITY INVOKER with an empty search_path and returns the three-column table', () => {
    expect(flat).toMatch(
      /RETURNS TABLE \(result_outcome text, result_invite_id uuid, result_level integer\) LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS \$\$/
    );
    expect(flat).not.toMatch(/SECURITY DEFINER/);
  });

  it('locks the pending invite with the explicit revoked and claimant filters (T-19)', () => {
    expect(body()).toContain(
      "SELECT invite_row.issuer_account_id INTO v_issuer FROM public.business_os_invites AS invite_row WHERE invite_row.id = p_invite_id AND invite_row.claimed_account_id = p_account_id AND invite_row.email = p_email AND invite_row.issuer_kind = 'account' AND invite_row.grant_kind = 'tier' AND invite_row.grant_id = p_tier AND invite_row.redeemed_at IS NULL AND invite_row.revoked_at IS NULL FOR UPDATE;"
    );
  });

  it('reports already_finalised only for a friend row it would have written (R-6)', () => {
    expect(body()).toContain(
      "WHERE done_row.id = p_invite_id AND done_row.redeemed_account_id = p_account_id AND done_row.issuer_kind = 'account' AND lineage_row.source = 'account_invite';"
    );
    expect(body()).toContain("IF NOT FOUND THEN RETURN QUERY SELECT 'not_matched'::text, NULL::uuid, NULL::integer;");
  });

  it('re-checks the issuer is an in-force champion with the same predicate as the send (T-19, 20261023)', () => {
    expect(body()).toContain(
      'plan_row.user_id = v_issuer AND plan_row.cohort = p_issuer_cohort AND (plan_row.cohort_expires_at IS NULL OR plan_row.cohort_expires_at > now())'
    );
    expect(body()).toContain("RETURN QUERY SELECT 'issuer_not_eligible'::text, NULL::uuid, NULL::integer;");
  });

  it('checks before it writes: lock, issuer, parent, then burn, plan row, lineage', () => {
    const order = ['FOR UPDATE', "'issuer_not_eligible'", 'FROM public.business_os_account_lineage AS parent_row', 'UPDATE public.business_os_invites AS burn_row', 'INSERT INTO public.business_os_account_plans', 'INSERT INTO public.business_os_account_lineage', "'finalised'"].map((marker) => body().indexOf(marker));
    for (const at of order) expect(at).toBeGreaterThan(-1);
    expect([...order].sort((left, right) => left - right)).toEqual(order);
  });

  it('writes the plan row with NO basis and plain INSERTs (T-13 layer 1, T-4)', () => {
    expect(body()).toContain(
      "INSERT INTO public.business_os_account_plans (user_id, origin, period_anchor, updated_at) VALUES (p_account_id, 'invite', now(), now());"
    );
    expect(body()).not.toMatch(/\bcohort\s*,|\btier\s*,/);
    expect(body().toUpperCase()).not.toContain('ON CONFLICT');
  });

  it('writes lineage as account_invite under the issuer', () => {
    expect(body()).toContain(
      "INSERT INTO public.business_os_account_lineage (account_id, invite_id, source, parent_account_id, root_account_id, level) VALUES (p_account_id, p_invite_id, 'account_invite', v_issuer, v_root, v_level);"
    );
  });

  it('applies C-2: REVOKE ALL from PUBLIC, anon, authenticated and service_role, then EXECUTE to service_role only', () => {
    for (const role of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
      expect(flat).toContain(`REVOKE ALL ON FUNCTION ${SIGNATURE} FROM ${role};`);
    }
    expect(flat.match(/GRANT /g)).toHaveLength(1);
    expect(flat).toContain(`GRANT EXECUTE ON FUNCTION ${SIGNATURE} TO service_role;`);
  });
});

describe('rollback and checker match the migration', () => {
  it('the rollback drops exactly the function, the two CHECKs and the two columns', () => {
    expect(rollback.trim()).toBe(
      `BEGIN; DROP FUNCTION ${SIGNATURE}; ` +
        'ALTER TABLE public.business_os_account_lineage DROP CONSTRAINT business_os_account_lineage_first_payment_ref_length; ' +
        'ALTER TABLE public.business_os_account_lineage DROP CONSTRAINT business_os_account_lineage_first_payment_paired; ' +
        'ALTER TABLE public.business_os_account_lineage DROP COLUMN first_payment_ref; ' +
        'ALTER TABLE public.business_os_account_lineage DROP COLUMN first_paid_at; COMMIT;'
    );
  });

  it('the checker is read-only and names the same function, columns and CHECKs', () => {
    expect(checker.startsWith('SET default_transaction_read_only = on;')).toBe(true);
    expect(checker).toContain(`pg_proc.proname = '${FUNCTION_NAME}'`);
    expect(checker).toContain("pg_proc.proname = 'business_os_finalise_invite_redemption'");
    expect(checker).toContain("('first_paid_at', 'first_payment_ref')");
    expect(checker).toContain("('business_os_account_lineage_first_payment_paired', 'business_os_account_lineage_first_payment_ref_length')");
    expect(checker).toContain('argument_count = 5');
    expect(checker).toContain("position('ON CONFLICT' IN upper(pg_proc.prosrc)) = 0");
    expect(checker).toContain("'result_outcome text'");
    expect(checker.replace(/'[^']*'/g, "''")).not.toMatch(/\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|GRANT|REVOKE)\b/);
  });

  it('the checker has rows L01 to L13 and a VERDICT', () => {
    for (const row of ['L01', 'L02', 'L03', 'L04a', 'L04b', 'L05', 'L06', 'L07', 'L08a', 'L08b', 'L09', 'L10', 'L11', 'L12', 'L13']) {
      expect(checker).toContain(`'${row} `);
    }
    expect(checker).toContain("'VERDICT'");
  });
});
