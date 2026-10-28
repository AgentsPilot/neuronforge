/**
 * Account deletion lifecycle D3.1 / SX-2b (workplan §3, §10; SA S-1 option A):
 * migration 20261098, its rollback, the pre-check and the checker.
 *
 * Source pins only: no database, no network.
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n');

const NAME = '20261098_business_os_account_plans_after_plan_moves';
const MIGRATION = read('supabase', 'migrations', `${NAME}.sql`);
const ROLLBACK = read('supabase', 'SQL Scripts', `${NAME}_rollback.sql`);
const PRECHECK = read('scripts', 'precheck-after-plan-moves.sql');
const CHECKER = read('scripts', 'check-after-plan-moves-migration.sql');
const CONSTRAINTS = [
  'business_os_account_plans_after_plan_moves_check',
  'business_os_account_plans_after_plan_subscription_shape',
  'business_os_account_plans_after_plan_pair',
];
/** The statements, comments removed. */
const sql = (text: string) => text.replace(/^\s*--.*$/gm, '');

describe('20261098: the two columns (S-1 option A)', () => {
  it('is the only migration numbered 20261098', () => {
    const files = readdirSync(join(ROOT, 'supabase', 'migrations')).filter((f) => f.startsWith('20261098'));
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

  it('adds the count NOT NULL DEFAULT 0 and the subscription id nullable', () => {
    expect(MIGRATION).toContain('ADD COLUMN after_plan_moves integer NOT NULL DEFAULT 0');
    expect(MIGRATION).toContain('ADD COLUMN after_plan_last_subscription_id text NULL');
  });

  it('the three CHECKs: non-negative, the subscription shape, the pair', () => {
    expect(MIGRATION).toContain('CHECK (after_plan_moves >= 0)');
    expect(MIGRATION).toContain("left(after_plan_last_subscription_id, 4) = ('sub' || chr(95)) AND char_length(after_plan_last_subscription_id) <= 255");
    expect(MIGRATION).toContain('CHECK ((after_plan_moves = 0) = (after_plan_last_subscription_id IS NULL))');
    for (const name of CONSTRAINTS) expect(MIGRATION).toContain(`ADD CONSTRAINT ${name}`);
  });

  it('no foreign key, no grant, no policy, no new table or function', () => {
    const statements = sql(MIGRATION);
    expect(statements).not.toMatch(/REFERENCES/i);
    expect(statements).not.toMatch(/\bGRANT\b/i);
    expect(statements).not.toMatch(/CREATE\s+POLICY/i);
    expect(statements).not.toMatch(/CREATE\s+(TABLE|FUNCTION|INDEX)/i);
  });

  it('never contains the word that breaks the Supabase SQL editor inside a string', () => {
    expect(MIGRATION).not.toMatch(/'[^']*\binto\b[^']*'/i);
  });
});

describe('20261098: rollback, pre-check, checker', () => {
  it('the rollback refuses while any account holds a count, then drops the constraints and the columns in one transaction', () => {
    expect(sql(ROLLBACK).match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(ROLLBACK).toContain('LOCK TABLE public.business_os_account_plans IN ACCESS EXCLUSIVE MODE');
    expect(ROLLBACK).toContain('WHERE plans.after_plan_moves > 0');
    for (const name of CONSTRAINTS) expect(ROLLBACK).toContain(`DROP CONSTRAINT IF EXISTS ${name}`);
    expect(ROLLBACK).toContain('DROP COLUMN after_plan_last_subscription_id');
    expect(ROLLBACK).toContain('DROP COLUMN after_plan_moves');
  });

  it('the pre-check and the checker are read-only', () => {
    for (const text of [PRECHECK, CHECKER]) {
      // Statement keywords only: 'UPDATE' and 'CREATE' also appear as privilege names inside the checks.
      expect(sql(text)).not.toMatch(/^\s*(ALTER|INSERT|UPDATE|DELETE|DROP|CREATE|GRANT|REVOKE|BEGIN|COMMIT)\b/m);
    }
  });

  it('the checker names all three constraints', () => {
    for (const name of CONSTRAINTS) expect(CHECKER).toContain(name);
  });
});
