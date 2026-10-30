/**
 * Account deletion lifecycle D4b / SX-3 part 2 (workplan §3.4 to §3.6, §6; SA S-2, S-3,
 * DR-2, DR-3, DR-4, DR-13, D4b addendum R-A to R-D): migration 20261100, its rollback,
 * the pre-check and the checker.
 *
 * Source pins only: no database, no network.
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const raw = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8');
const read = (...parts: string[]) => raw(...parts).replace(/\r\n/g, '\n');

const NAME = '20261100_business_os_plan_cancel_reminders';
const FILES = {
  migration: ['supabase', 'migrations', `${NAME}.sql`],
  rollback: ['supabase', 'SQL Scripts', `${NAME}_rollback.sql`],
  precheck: ['scripts', 'precheck-plan-cancel-reminders.sql'],
  checker: ['scripts', 'check-plan-cancel-reminders-migration.sql'],
} as const;
const MIGRATION = read(...FILES.migration);
const ROLLBACK = read(...FILES.rollback);
const PRECHECK = read(...FILES.precheck);
const CHECKER = read(...FILES.checker);
const COLUMNS = ['cancel_reminder_sent_for', 'cancel_reminder_claimed_by', 'cancel_reminder_claimed_at'];
const FUNCTION_SIGNATURE = 'public.claim_bos_plan_cancel_reminders(uuid, boolean, integer, integer, integer)';
/** The statements, comments removed. */
const sql = (text: string) => text.replace(/^\s*--.*$/gm, '');
/** The claim function's body. */
const claimBody = () => {
  const start = MIGRATION.indexOf('AS $claim$');
  const end = MIGRATION.indexOf('$claim$;', start + 10);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return MIGRATION.slice(start, end);
};

describe('20261100: the three columns, the index and the claim function', () => {
  it('is the only migration numbered 20261100', () => {
    const files = readdirSync(join(ROOT, 'supabase', 'migrations')).filter((f) => f.startsWith('20261100'));
    expect(files).toEqual([`${NAME}.sql`]);
  });

  it('one transaction, with a lock timeout, a pre-guard and a post-condition', () => {
    expect(sql(MIGRATION).match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(sql(MIGRATION).match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(MIGRATION).toContain("SET LOCAL lock_timeout = '5s';");
    expect(MIGRATION).toContain('DO $pre_guard$');
    expect(MIGRATION).toContain('DO $post_condition$');
    expect(MIGRATION).toMatch(/has_schema_privilege\('anon', 'public', 'CREATE'\)/);
  });

  it('adds exactly the three nullable columns, no default', () => {
    expect(MIGRATION).toContain('ADD COLUMN cancel_reminder_sent_for timestamptz NULL');
    expect(MIGRATION).toContain('ADD COLUMN cancel_reminder_claimed_by uuid NULL');
    expect(MIGRATION).toContain('ADD COLUMN cancel_reminder_claimed_at timestamptz NULL');
    expect(sql(MIGRATION).match(/ADD COLUMN/g)).toHaveLength(3);
    expect(sql(MIGRATION)).not.toMatch(/DEFAULT/i);
  });

  it('the pair CHECK ties the runner to its lease time', () => {
    expect(MIGRATION).toContain(
      'ADD CONSTRAINT business_os_billing_accounts_cancel_reminder_claim_pair CHECK ((cancel_reminder_claimed_by IS NULL) = (cancel_reminder_claimed_at IS NULL))'
    );
  });

  it('the partial index covers the claim predicate', () => {
    expect(MIGRATION).toContain(
      'CREATE INDEX business_os_billing_accounts_cancel_reminder_idx ON public.business_os_billing_accounts (current_period_end) WHERE cancel_at_period_end AND ended_at IS NULL;'
    );
  });

  it('DR-3: the only grant on the table is UPDATE on the three new columns, to service_role', () => {
    const grants = sql(MIGRATION).match(/^GRANT .*$/gm) ?? [];
    expect(grants).toEqual([
      `GRANT UPDATE (${COLUMNS.join(', ')}) ON TABLE public.business_os_billing_accounts TO service_role;`,
      `GRANT EXECUTE ON FUNCTION ${FUNCTION_SIGNATURE} TO service_role;`,
    ]);
    expect(sql(MIGRATION)).not.toMatch(/CREATE\s+POLICY|ROW LEVEL SECURITY|REFERENCES/i);
  });

  it('the claim function: definer, pinned search_path, revoked from PUBLIC, anon and authenticated after the CREATE, granted to service_role', () => {
    const create = MIGRATION.indexOf('CREATE FUNCTION public.claim_bos_plan_cancel_reminders(');
    const revoke = MIGRATION.indexOf(`REVOKE ALL ON FUNCTION ${FUNCTION_SIGNATURE} FROM PUBLIC, anon, authenticated;`);
    const grant = MIGRATION.indexOf(`GRANT EXECUTE ON FUNCTION ${FUNCTION_SIGNATURE} TO service_role;`);
    expect(create).toBeGreaterThan(0);
    expect(revoke).toBeGreaterThan(create);
    expect(grant).toBeGreaterThan(revoke);
    const header = MIGRATION.slice(create, MIGRATION.indexOf('AS $claim$'));
    expect(header).toContain('SECURITY DEFINER');
    expect(header).toContain('SET search_path = public');
    expect(header).toContain('p_runner uuid, p_livemode boolean, p_window_seconds integer, p_lease_seconds integer, p_batch integer');
  });

  it('the claim: FOR UPDATE SKIP LOCKED, batched, one mode, set to end within the window, not reminded for this period end, lease folded in (S-3 a)', () => {
    const body = claimBody();
    expect(body).toContain('FOR UPDATE SKIP LOCKED');
    expect(body).toContain('LIMIT p_batch');
    expect(body).toContain('c.livemode = p_livemode');
    expect(body).toContain('AND c.cancel_at_period_end');
    expect(body).toContain('AND c.ended_at IS NULL');
    expect(body).toContain("AND c.subscription_status IN ('active', 'trialing')");
    expect(body).toContain('AND c.user_id IS NOT NULL');
    expect(body).toContain('AND c.stripe_subscription_id IS NOT NULL');
    expect(body).toContain('AND c.current_period_end > now()');
    expect(body).toContain('AND c.current_period_end <= now() + make_interval(secs => p_window_seconds)');
    expect(body).toContain('AND c.cancel_reminder_sent_for IS DISTINCT FROM c.current_period_end');
    expect(body).toContain(
      'AND (c.cancel_reminder_claimed_at IS NULL OR c.cancel_reminder_claimed_at < now() - make_interval(secs => p_lease_seconds))'
    );
    expect(body).toContain(
      'RETURNING b.id, b.user_id, b.livemode, b.stripe_subscription_id, b.stripe_customer_id, b.current_period_end, b.cancel_reminder_sent_for;'
    );
    // Bounded inputs: a caller cannot ask for an unbounded batch or window.
    expect(body).toContain('p_batch < 1 OR p_batch > 100');
  });

  it('DR-2: the claim leaves out an account with an open closure (requesting, pending, grace, locked), in SQL only', () => {
    expect(claimBody()).toContain(
      "AND NOT EXISTS (SELECT 1 FROM public.business_os_account_closures AS cl\n                         WHERE cl.user_id = c.user_id AND cl.status IN ('requesting', 'pending', 'grace', 'locked'))"
    );
  });

  it('DR-4: the one UPDATE of the billing table sets only the two claim columns', () => {
    const updates = MIGRATION.match(/UPDATE\s+public\.business_os_billing_accounts/gi) ?? [];
    expect(updates).toHaveLength(1);
    const body = claimBody();
    const set = body.slice(body.indexOf(' SET '), body.indexOf(' WHERE b.id IN ('));
    expect(set.replace(/\s+/g, ' ').trim()).toBe('SET cancel_reminder_claimed_by = p_runner, cancel_reminder_claimed_at = now()');
  });

  it('DR-13: no updated_at anywhere; the post-condition counts 24 columns', () => {
    expect(sql(MIGRATION)).not.toContain('updated_at');
    expect(MIGRATION).toContain('IF v_count <> 24 THEN');
  });

  it('never contains the word that breaks the Supabase SQL editor, in a string or a comment, in any of the four files', () => {
    for (const parts of Object.values(FILES)) {
      expect({ file: parts.join('/'), hit: /\binto\b/i.test(raw(...parts)) }).toEqual({ file: parts.join('/'), hit: false });
    }
  });

  it('every file is LF only (a CRLF paste changes the body the checker sees)', () => {
    for (const parts of Object.values(FILES)) {
      expect({ file: parts.join('/'), crlf: raw(...parts).includes('\r') }).toEqual({ file: parts.join('/'), crlf: false });
    }
  });
});

describe('20261100: rollback, pre-check, checker', () => {
  it('the rollback refuses while a run holds a lease, then drops the function, index, constraint and columns in one transaction', () => {
    expect(sql(ROLLBACK).match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(sql(ROLLBACK).match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(ROLLBACK).toContain('LOCK TABLE public.business_os_billing_accounts IN ACCESS EXCLUSIVE MODE');
    expect(ROLLBACK).toContain(`DROP FUNCTION IF EXISTS ${FUNCTION_SIGNATURE};`);
    expect(ROLLBACK).toContain('DROP INDEX IF EXISTS public.business_os_billing_accounts_cancel_reminder_idx;');
    expect(ROLLBACK).toContain('DROP CONSTRAINT IF EXISTS business_os_billing_accounts_cancel_reminder_claim_pair');
    for (const column of COLUMNS) expect(ROLLBACK).toContain(`DROP COLUMN ${column}`);
  });

  it('the pre-check and the checker are read-only', () => {
    for (const text of [PRECHECK, CHECKER]) {
      // Statement keywords only: 'UPDATE' and 'CREATE' also appear as privilege names inside the checks.
      expect(sql(text)).not.toMatch(/^\s*(ALTER|INSERT|UPDATE|DELETE|DROP|CREATE|GRANT|REVOKE|BEGIN|COMMIT)\b/m);
    }
  });

  it('the pre-check expects 21 columns; the checker expects 24 and names the constraint, the index, the function and the DR-2 statuses', () => {
    expect(PRECHECK).toContain('AND NOT att.attisdropped) = 21');
    expect(CHECKER).toContain('AND NOT att.attisdropped) = 24');
    expect(CHECKER).toContain('business_os_billing_accounts_cancel_reminder_claim_pair');
    expect(CHECKER).toContain('business_os_billing_accounts_cancel_reminder_idx');
    expect(CHECKER).toContain(FUNCTION_SIGNATURE);
    expect(CHECKER).toContain("'requesting'', ''pending'', ''grace'', ''locked''");
    for (const column of COLUMNS) expect(CHECKER).toContain(column);
  });
});
