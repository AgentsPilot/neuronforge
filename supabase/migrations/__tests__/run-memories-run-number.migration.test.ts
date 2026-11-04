/**
 * Guard over migration 20261106, collision-free run_memories.run_number.
 *
 * Production threw, repeatedly, on agent 2216fc3c:
 *
 *   duplicate key value violates unique constraint "run_memories_agent_id_run_number_key"
 *
 * `get_next_run_number` was supposed to prevent that and cannot: it releases
 * its advisory lock before returning, and the caller inserts in a separate
 * round trip. 20261106 moves the numbering into a BEFORE INSERT trigger that
 * holds a per-agent `pg_advisory_xact_lock` — released at COMMIT, so the next
 * writer waits until the row is visible.
 *
 * WHY A TEST OVER SQL TEXT: there is no branch database. The user pastes the
 * migration, its rollback, the pre-check and the checker into the Supabase SQL
 * editor by hand (supabase-ops §4), so the only thing CI can hold still is the
 * text of the four files and the facts the checker proves. Same shape as the
 * secdef-lockdown guards, minus their inventory.
 *
 * Every "this must NOT appear" assertion runs over `code()`, not the raw file:
 * these files explain the bug in their headers, and the header of the
 * migration quotes the very `pg_advisory_unlock` call it exists to replace.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const MIGRATION = join(ROOT, 'supabase', 'migrations', '20261107_run_memories_run_number_collision_free.sql');
const ROLLBACK = join(ROOT, 'supabase', 'SQL Scripts', '20261107_run_memories_run_number_collision_free_rollback.sql');
const PRECHECK = join(ROOT, 'scripts', 'precheck-run-memories-run-number.sql');
const CHECKER = join(ROOT, 'scripts', 'check-run-memories-run-number-migration.sql');
const SUMMARIZER = join(ROOT, 'lib', 'memory', 'MemorySummarizer.ts');

const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

/** The SQL with `--` comments and single-quoted literals taken out. */
const code = (sql: string) =>
  sql
    .replace(/--[^\n]*/g, '')
    .replace(/'(?:[^']|'')*'/g, "''");

/** The stamp the checker greps for inside the live function body. */
const STAMP = 'a7f20c53d1b84e69';

const TRIGGER = 'run_memories_assign_run_number';

const WRITE_WORDS = /\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TRUNCATE|GRANT|REVOKE)\b/;

describe('20261106 run_memories run_number: every pasted file exists', () => {
  it.each([
    ['migration', MIGRATION],
    ['rollback', ROLLBACK],
    ['pre-check', PRECHECK],
    ['checker', CHECKER],
  ])('%s is on disk', (_label, file) => {
    expect(existsSync(file)).toBe(true);
  });
});

describe('20261106 migration text', () => {
  const migration = read(MIGRATION);
  const body = code(migration);

  it('is one transaction, so a failure applies nothing', () => {
    expect(migration).toContain('BEGIN;');
    expect(migration.trimEnd().endsWith('COMMIT;')).toBe(true);
  });

  it('holds the lock until COMMIT: xact lock, and never an explicit unlock', () => {
    expect(body).toContain('pg_catalog.pg_advisory_xact_lock');
    // The bug being fixed is an unlock that lands before the insert. If either
    // of these appears in the executed SQL, the fix has been undone.
    expect(body).not.toContain('pg_advisory_unlock');
    expect(body).not.toContain('pg_try_advisory_lock');
  });

  it('locks per agent, not globally', () => {
    expect(migration).toContain("'run_memories_run_number' || chr(58) || NEW.agent_id::text");
  });

  it('numbers the row in a BEFORE INSERT FOR EACH ROW trigger', () => {
    expect(body).toContain(`CREATE TRIGGER ${TRIGGER}`);
    expect(body).toContain('BEFORE INSERT ON public.run_memories');
    expect(body).toContain('FOR EACH ROW');
    expect(body).toContain(`EXECUTE FUNCTION public.${TRIGGER}()`);
  });

  it('renumbers only an absent or already-taken number, so a free caller-supplied one survives', () => {
    expect(body).toContain('IF NEW.run_number IS NOT NULL THEN');
    expect(body).toContain('IF NOT v_taken THEN');
    expect(body).toContain('coalesce(max(m.run_number), 0) + 1');
  });

  it('stays off the SECURITY DEFINER surface and pins its search_path', () => {
    expect(body).toContain('SECURITY INVOKER');
    expect(body).not.toContain('SECURITY DEFINER');
    expect(body).toContain('SET search_path = pg_catalog, public, pg_temp');
  });

  it('carries the stamp the checker greps for', () => {
    expect(migration).toContain(STAMP);
  });

  it('leaves get_next_run_number in place and re-comments it as advisory', () => {
    expect(body).not.toMatch(/DROP FUNCTION[^;]*get_next_run_number/);
    expect(body).toContain('COMMENT ON FUNCTION public.get_next_run_number(uuid)');
    expect(migration).toContain('ADVISORY ONLY');
  });
});

describe('20261106 rollback text', () => {
  const rollback = read(ROLLBACK);
  const body = code(rollback);

  it('undoes exactly what the migration created', () => {
    expect(body).toContain(`DROP TRIGGER IF EXISTS ${TRIGGER} ON public.run_memories;`);
    expect(body).toContain(`DROP FUNCTION IF EXISTS public.${TRIGGER}();`);
  });

  it('keeps get_next_run_number and touches no data', () => {
    expect(body).toContain('COMMENT ON FUNCTION public.get_next_run_number(uuid)');
    expect(body).not.toContain('DROP FUNCTION IF EXISTS public.get_next_run_number');
    expect(body).not.toMatch(/\b(DELETE|TRUNCATE|UPDATE|INSERT)\b/);
    expect(body).not.toContain('run_memories_agent_id_run_number_key');
  });
});

describe('20261106 pre-check text', () => {
  const precheck = read(PRECHECK);

  it('is read-only', () => {
    expect(code(precheck)).not.toMatch(WRITE_WORDS);
  });

  it('proves the pre-apply shape: the constraint is there, the new objects are not', () => {
    expect(precheck).toContain('run_memories_agent_id_run_number_key');
    expect(precheck).toContain(`no trigger named ${TRIGGER} exists yet`);
    expect(precheck).toContain(`public.${TRIGGER}() does not exist yet`);
    expect(precheck).toContain('public.get_next_run_number(uuid) exists');
  });

  it('reports ok, FAIL and info per row', () => {
    expect(precheck).toContain("THEN 'ok' ELSE 'FAIL' END");
    expect(precheck).toContain("'info'");
  });
});

describe('20261106 checker text', () => {
  const checker = read(CHECKER);

  it('is read-only', () => {
    expect(code(checker)).not.toMatch(WRITE_WORDS);
  });

  it('can fail before the apply: every gate names an object the migration creates', () => {
    expect(checker).toContain(`public.${TRIGGER}()`);
    expect(checker).toContain(STAMP);
    expect(checker).toContain('pg_advisory_xact_lock');
    expect(checker).toContain('ADVISORY ONLY');
  });

  it('proves the trigger is BEFORE INSERT FOR EACH ROW, enabled, and bound to that function', () => {
    // tgtype bits: row (1) | before (2) | insert (4)
    expect(checker).toContain('(tg.tgtype & 7) = 7');
    expect(checker).toContain("tg.tgenabled <> 'D'");
    expect(checker).toContain('tg.tgfoid = (SELECT fn.oid FROM fn)');
  });

  it('proves no duplicate run_number survives', () => {
    expect(checker).toContain('HAVING count(*) > 1');
  });

  it('reports ok, FAIL and info per row', () => {
    expect(checker).toContain("THEN 'ok' ELSE 'FAIL' END");
    expect(checker).toContain("'info'");
  });
});

describe('the app side still explains itself', () => {
  const summarizer = read(SUMMARIZER);

  it('MemorySummarizer names this migration where it retries on the unique violation', () => {
    expect(summarizer).toContain('20261106');
    expect(summarizer).toContain("const UNIQUE_VIOLATION = '23505'");
    expect(summarizer).toContain('MAX_RUN_NUMBER_ATTEMPTS');
  });
});
