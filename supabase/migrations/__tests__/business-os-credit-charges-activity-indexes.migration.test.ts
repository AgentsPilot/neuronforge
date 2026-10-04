/**
 * Guard over the Admin AI Activity index migration (slice B0'; FR-B11,
 * SA-RC-1, SA-B1-1 to SA-B1-3). Workplan:
 * docs/workplans/BUSINESS_OS_ADMIN_AI_ACTIVITY_SLICE_B1_WORKPLAN.md section A.
 *
 * WHY A TEST OVER SQL TEXT. There is no branch database: the user pastes the
 * migration into the Supabase SQL editor on production, then runs the
 * read-only checker. What can be proven from the files alone is pinned here:
 * the migration adds exactly the two ruled indexes and nothing else, both the
 * apply and the rollback wait at most 1s for their lock (the charge writer's
 * budget is 1.5 s), and the checker verifies the exact definitions and proves
 * the indexes usable under a generic plan.
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { basename, join } from 'path';

const ROOT = process.cwd();
const MIGRATION = join(ROOT, 'supabase', 'migrations', '20261025_business_os_credit_charges_activity_indexes.sql');
const ROLLBACK = join(ROOT, 'supabase', 'SQL Scripts', '20261025_business_os_credit_charges_activity_indexes_rollback.sql');
const CHECKER = join(ROOT, 'scripts', 'check-bos-credit-charges-activity-indexes.sql');

/** Line comments removed, CRLF normalised: prose about a verb is not the verb. */
const codeOf = (file: string) =>
  readFileSync(file, 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/--.*$/gm, '');
const flat = (sql: string) => sql.replace(/\s+/g, ' ').trim();
/** String literals blanked, so an indexdef quoted in the checker is not a statement. */
const withoutLiterals = (sql: string) => sql.replace(/'[^']*'/g, "''");

const INDEX_A = 'business_os_credit_charges_kind_created_idx';
const INDEX_B = 'business_os_credit_charges_adjusts_action_idx';

/** The charge writer's lock budget (aiChargeRecorder.ts BOS_AI_CHARGE_WRITE_BUDGET_MS). */
const WRITER_BUDGET_MS = 1_500;

function lockTimeoutsMs(sql: string): number[] {
  return [...sql.matchAll(/SET LOCAL lock_timeout = '(\d+)(ms|s)'/g)].map(([, n, unit]) =>
    unit === 's' ? Number(n) * 1000 : Number(n)
  );
}

describe('the files exist where the apply procedure points', () => {
  it.each([MIGRATION, ROLLBACK, CHECKER])('%s exists', (file) => {
    expect(existsSync(file)).toBe(true);
  });

  it('does not take 20261016, which slice 4c has reserved', () => {
    expect(basename(MIGRATION).startsWith('20261016')).toBe(false);
    const migrations = readdirSync(join(ROOT, 'supabase', 'migrations'));
    expect(migrations.filter((name) => name.startsWith('20261025_'))).toEqual([basename(MIGRATION)]);
  });
});

describe('the migration: two indexes and nothing else', () => {
  const sql = codeOf(MIGRATION);
  const text = flat(sql);

  it('runs in one transaction with a lock wait below the charge writer budget', () => {
    expect(text.startsWith('BEGIN;')).toBe(true);
    expect(text.endsWith('COMMIT;')).toBe(true);
    const timeouts = lockTimeoutsMs(sql);
    expect(timeouts).toEqual([1000]);
    expect(timeouts[0]).toBeLessThan(WRITER_BUDGET_MS);
    // SET LOCAL comes before the first CREATE, or it would not apply to it.
    expect(text.indexOf('SET LOCAL lock_timeout')).toBeLessThan(text.indexOf('CREATE INDEX'));
  });

  it('creates exactly two indexes, with IF NOT EXISTS', () => {
    expect(text.match(/CREATE INDEX/g)).toHaveLength(2);
    expect(text.match(/CREATE INDEX IF NOT EXISTS/g)).toHaveLength(2);
  });

  it('index (a) is (kind, created_at DESC, id DESC) and NOT partial (SA-B1-1)', () => {
    expect(text).toContain(
      `CREATE INDEX IF NOT EXISTS ${INDEX_A} ON public.business_os_credit_charges (kind, created_at DESC, id DESC);`
    );
    const statementA = text.slice(text.indexOf(INDEX_A), text.indexOf(';', text.indexOf(INDEX_A)));
    expect(statementA).not.toMatch(/\bWHERE\b/);
  });

  it('index (b) is partial on adjusts_action_id IS NOT NULL', () => {
    expect(text).toContain(
      `CREATE INDEX IF NOT EXISTS ${INDEX_B} ON public.business_os_credit_charges (adjusts_action_id) WHERE adjusts_action_id IS NOT NULL;`
    );
  });

  it('adds no function, grant, revoke, table change, drop, CONCURRENTLY or write', () => {
    for (const forbidden of [
      /\bFUNCTION\b/i,
      /\bGRANT\b/i,
      /\bREVOKE\b/i,
      /\bALTER\b/i,
      /\bDROP\b/i,
      /\bCONCURRENTLY\b/i,
      /\bINSERT\b/i,
      /\bUPDATE\b/i,
      /\bDELETE\b/i,
      /\bTRIGGER\b/i,
      /\bPOLICY\b/i,
    ]) {
      expect({ forbidden: String(forbidden), matched: forbidden.test(sql) }).toEqual({
        forbidden: String(forbidden),
        matched: false,
      });
    }
  });
});

describe('the rollback (SA-B1-3)', () => {
  const sql = codeOf(ROLLBACK);
  const text = flat(sql);

  it('drops both indexes, IF EXISTS, in one transaction', () => {
    expect(text.startsWith('BEGIN;')).toBe(true);
    expect(text.endsWith('COMMIT;')).toBe(true);
    expect(text).toContain(`DROP INDEX IF EXISTS public.${INDEX_A};`);
    expect(text).toContain(`DROP INDEX IF EXISTS public.${INDEX_B};`);
    expect(text.match(/DROP /g)).toHaveLength(2);
  });

  it('waits at most 1s for its ACCESS EXCLUSIVE lock, set before the first DROP', () => {
    const timeouts = lockTimeoutsMs(sql);
    expect(timeouts).toEqual([1000]);
    expect(timeouts[0]).toBeLessThan(WRITER_BUDGET_MS);
    expect(text.indexOf('SET LOCAL lock_timeout')).toBeLessThan(text.indexOf('DROP INDEX'));
  });

  it('touches nothing but the two indexes', () => {
    expect(sql).not.toMatch(/DROP TABLE|DROP FUNCTION|\bALTER\b|\bDELETE\b|\bTRUNCATE\b/i);
  });
});

describe('the checker (SA-B1-2)', () => {
  const sql = codeOf(CHECKER);
  const statements = withoutLiterals(sql);

  it('is read-only: it opens read-only and writes nothing', () => {
    expect(sql).toContain('SET default_transaction_read_only = on;');
    expect(statements).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|CREATE|DROP|ALTER|GRANT|REVOKE|COMMIT)\b/i);
  });

  it('compares the EXACT indexdef of both new indexes, as written by pg_get_indexdef', () => {
    expect(sql).toContain(
      `'CREATE INDEX ${INDEX_A} ON public.business_os_credit_charges USING btree (kind, created_at DESC, id DESC)'`
    );
    expect(sql).toContain(
      `'CREATE INDEX ${INDEX_B} ON public.business_os_credit_charges USING btree (adjusts_action_id) WHERE (adjusts_action_id IS NOT NULL)'`
    );
    expect(sql).toMatch(/live\.live_def = expected\.expected_def/);
  });

  it('section 1 is one result set with a VERDICT row', () => {
    const section1 = sql.slice(0, sql.indexOf('BEGIN READ ONLY;'));
    // One statement after the SET: the WITH ... SELECT ending at the first semicolon.
    expect(section1.split(';').map((s) => s.trim()).filter(Boolean)).toHaveLength(2);
    expect(section1).toContain("'VERDICT'");
  });

  it('every EXPLAIN block is self-contained: read-only, seqscan off where it proves usage, and rolled back', () => {
    const blocks = sql.split('BEGIN READ ONLY;').slice(1);
    // E1 to E6, G1, G2, G4, L1, L2.
    expect(blocks).toHaveLength(11);
    for (const block of blocks) {
      expect(block).toContain('EXPLAIN (ANALYZE, BUFFERS)');
      expect(block.trim().endsWith('ROLLBACK;')).toBe(true);
      // Literals only in the E blocks; parameters only behind PREPARE.
      if (!block.includes('PREPARE')) expect(block).not.toMatch(/\$\d/);
    }
    expect(blocks.filter((b) => b.includes('SET LOCAL enable_seqscan = off;'))).toHaveLength(9);
  });

  it('proves E1, E2 and E4 under a GENERIC plan, the way PostgREST may run them', () => {
    expect(sql.match(/SET LOCAL plan_cache_mode = force_generic_plan;/g)).toHaveLength(3);
    for (const name of ['activity_g1', 'activity_g2', 'activity_g4']) {
      expect(sql).toContain(`PREPARE ${name} (`);
      expect(sql).toContain(`EXECUTE ${name}(`);
      expect(sql).toContain(`DEALLOCATE ${name};`);
    }
  });

  it('starts every window at the cut-over floor the builder uses', () => {
    expect(sql).toContain("created_at >= '2026-09-29T16:50:53.914Z'");
  });
});
