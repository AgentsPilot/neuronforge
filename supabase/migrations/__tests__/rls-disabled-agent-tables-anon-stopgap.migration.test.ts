/**
 * Guard over migration 20261060, the slice 2c anon stopgap
 * (assessment and SA rulings Q-SA-5 and Q-SA-6 in
 * docs/workplans/EXPOSED_VIEWS_SLICE1B_WORKPLAN.md).
 *
 * Six agent-platform tables still have row security off, and anon (the key in
 * the browser bundle) holds every privilege on them. Full slice 2c (owner
 * policies plus a three-route code fix) is not ready, so this stopgap ships
 * first:
 *   - anon and PUBLIC lose every privilege on the six tables and on any
 *     sequence those tables own;
 *   - authenticated loses TRUNCATE, REFERENCES, TRIGGER and MAINTAIN (TRUNCATE
 *     ignores RLS, so any signed-in user could wipe every user's run history)
 *     but KEEPS SELECT, INSERT, UPDATE and DELETE, which signed-in pages use;
 *   - service_role is not touched, and row security stays off (full 2c's job).
 * The user accepted that "Share agent to template gallery" breaks until full
 * 2c ships, because its three routes run as anon on the server.
 *
 * WHY A TEST OVER SQL TEXT: there is no branch database. The pre-check, the
 * migration (in a NEW tab), the checker and the rollback are pasted into the
 * Supabase SQL editor by hand. Same shape as the slice 1b test.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const MIGRATION = join(ROOT, 'supabase', 'migrations', '20261060_rls_disabled_agent_tables_anon_stopgap.sql');
const ROLLBACK = join(ROOT, 'supabase', 'SQL Scripts', '20261060_rls_disabled_agent_tables_anon_stopgap_rollback.sql');
const CHECKER = join(ROOT, 'scripts', 'check-rls-disabled-agent-tables-anon-stopgap-migration.sql');
const PRECHECK = join(ROOT, 'scripts', 'precheck-rls-disabled-agent-tables-anon-stopgap.sql');
const SLICE1B_WORKPLAN = join(ROOT, 'docs', 'workplans', 'EXPOSED_VIEWS_SLICE1B_WORKPLAN.md');
const SLICE2_WORKPLAN = join(ROOT, 'docs', 'workplans', 'RLS_DISABLED_TABLES_SLICE2_WORKPLAN.md');

const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const migration = read(MIGRATION);
const rollback = read(ROLLBACK);
const checker = read(CHECKER);
const precheck = read(PRECHECK);

const TABLES = [
  'agent_configurations',
  'agent_executions',
  'agent_logs',
  'agent_stats',
  'shared_agents',
  'shared_agent_imports',
];
const EIGHT = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'];
const SIGNED_IN = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
const REMOVED_FROM_AUTHENTICATED = ['TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'];

/** Objects other slices own. The stopgap must not name them. */
const NOT_OURS = [
  'agent_executions_with_details',
  'monthly_token_usage',
  'daily_token_usage',
  'token_usage',
  'execution_routing_decisions',
  'agents',
];

function literalsOf(sql: string): string[] {
  return [...sql.matchAll(/'([^']*)'/g)].map((match) => match[1]);
}

function doBlocksOf(sql: string): string[] {
  return [...sql.matchAll(/DO \$\$[\s\S]*?\n\$\$;/g)].map((match) => match[0]);
}

function withoutDoBlocks(sql: string): string {
  return doBlocksOf(sql).reduce((text, block) => text.replace(block, ''), sql);
}

function statementsOf(sql: string): string[] {
  return sql
    .split(';')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function arrayLiterals(block: string, variable: string): string[] {
  const array = block.match(new RegExp(`FOREACH ${variable} IN ARRAY ARRAY\\[([\\s\\S]*?)\\]\\s+LOOP`));
  expect(array).not.toBeNull();
  return literalsOf(array![1]);
}

function allArrayLiterals(block: string, variable: string): string[][] {
  return [...block.matchAll(new RegExp(`FOREACH ${variable} IN ARRAY ARRAY\\[([\\s\\S]*?)\\]\\s+LOOP`, 'g'))].map(
    (match) => literalsOf(match[1])
  );
}

function relnameInList(block: string): string[] {
  const list = block.match(/owner_table\.relname IN \(([\s\S]*?)\)/);
  expect(list).not.toBeNull();
  return literalsOf(list![1]);
}

const files: Array<[string, string]> = [
  ['migration', MIGRATION],
  ['rollback', ROLLBACK],
  ['checker', CHECKER],
  ['precheck', PRECHECK],
];

describe('SQL-editor safety (all four files are pasted by hand)', () => {
  it.each(files)('%s exists', (_name, file) => {
    expect(existsSync(file)).toBe(true);
  });

  it.each(files)('%s has no line comment and no block comment', (_name, file) => {
    const text = read(file);
    expect(text).not.toContain('--');
    expect(text).not.toContain('/*');
  });

  // The Supabase SQL editor misreads the word "into" even inside a literal or
  // an identifier (2026-10-04). Banned as a substring, in any case.
  it.each(files)('%s never contains "into" anywhere', (_name, file) => {
    expect(read(file)).not.toMatch(/into/i);
  });

  it.each(files)('%s holds only plain literals', (_name, file) => {
    for (const literal of literalsOf(read(file))) {
      expect(literal).toMatch(/^[A-Za-z0-9_ ]*$/);
    }
  });

  it.each(files)('%s has an even number of single quotes', (_name, file) => {
    expect((read(file).match(/'/g) ?? []).length % 2).toBe(0);
  });

  it.each(files)('%s uses no single-letter alias', (_name, file) => {
    expect(read(file)).not.toMatch(/\bAS [a-z]\b/i);
  });

  it.each(files)('%s uses no LIKE pattern', (_name, file) => {
    expect(read(file)).not.toMatch(/\bI?LIKE\b/i);
  });

  it.each(files)('%s puts COLLATE "C" on every string_agg ORDER BY', (_name, file) => {
    for (const match of read(file).matchAll(/string_agg\(([^)]*)\)/g)) {
      expect(match[1]).toMatch(/ORDER BY [\w.]+ COLLATE "C"$/);
    }
  });

  // The slice 6 guard flags the phrase even inside a string.
  it.each(files)('%s never says SECURITY DEFINER, not even in a string', (_name, file) => {
    expect(read(file)).not.toMatch(/SECURITY\s+DEFINER/i);
  });

  it.each(files)('%s names no object another slice owns', (_name, file) => {
    const text = read(file);
    for (const name of NOT_OURS) {
      expect(text).not.toMatch(new RegExp(`\\b${name}\\b`));
    }
  });
});

describe('the migration', () => {
  const blocks = doBlocksOf(migration);
  const statements = statementsOf(withoutDoBlocks(migration));

  it('is one BEGIN ... COMMIT with a 5 s lock timeout and three DO blocks', () => {
    expect(statements[0]).toBe('BEGIN');
    expect(statements[1]).toBe("SET LOCAL lock_timeout = '5s'");
    expect(statements[statements.length - 1]).toBe('COMMIT');
    expect(statements.filter((s) => s === 'BEGIN' || s === 'COMMIT')).toHaveLength(2);
    expect(blocks).toHaveLength(3);
  });

  it('runs the pre-guard before any change, then the sequence revoke, then the post-assert', () => {
    const firstRevoke = migration.indexOf('REVOKE ALL ON TABLE');
    const lastRevoke = migration.lastIndexOf('FROM authenticated;');
    expect(migration.indexOf(blocks[0])).toBeLessThan(firstRevoke);
    expect(migration.indexOf(blocks[1])).toBeGreaterThan(lastRevoke);
    expect(migration.indexOf(blocks[2])).toBeGreaterThan(migration.indexOf(blocks[1]));
  });

  it('per table, in order: revoke all from PUBLIC and anon, and only the four extras from authenticated', () => {
    const expected = TABLES.flatMap((name) => [
      `REVOKE ALL ON TABLE public.${name} FROM PUBLIC`,
      `REVOKE ALL ON TABLE public.${name} FROM anon`,
      `REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.${name} FROM authenticated`,
    ]);
    expect(statements.slice(2, -1)).toEqual(expected);
  });

  it('never takes SELECT, INSERT, UPDATE or DELETE from authenticated, and never touches service_role', () => {
    for (const statement of statements.filter((s) => /\bFROM authenticated\b/.test(s))) {
      for (const verb of SIGNED_IN) expect(statement).not.toMatch(new RegExp(`\\b${verb}\\b`));
      expect(statement).not.toMatch(/REVOKE ALL/);
    }
    expect(withoutDoBlocks(migration)).not.toMatch(/service_role/);
    expect(blocks[1]).not.toMatch(/service_role/);
  });

  it('grants nothing, enables or forces no row security, and drops or re-owns nothing', () => {
    expect(migration).not.toMatch(/\bGRANT\b/);
    expect(migration).not.toMatch(/ROW LEVEL SECURITY|ENABLE|FORCE ROW/);
    expect(migration).not.toMatch(/\b(DROP|CREATE|CASCADE|OWNER|POLICY)\b/);
  });

  it('the pre-guard and the post-assert loop over exactly the six tables and fail, never skip, on a missing one', () => {
    expect(arrayLiterals(blocks[0], 'guard_table_name')).toEqual(TABLES);
    expect(arrayLiterals(blocks[2], 'check_table_name')).toEqual(TABLES);
    expect(blocks[0]).toMatch(/IF guard_table_oid IS NULL THEN\s+RAISE EXCEPTION/);
    expect(blocks[2]).toMatch(/IF check_table_oid IS NULL THEN\s+RAISE EXCEPTION/);
    expect(blocks[0]).toContain("pg_class.relkind = 'r'");
    expect(blocks[0]).toContain("pg_namespace.nspname = 'public'");
  });

  it('the pre-guard refuses unless owner postgres, row security off and not forced, no column ACL, and authenticated holds the four', () => {
    const guard = blocks[0];
    expect(guard).toMatch(/IS DISTINCT FROM 'postgres' THEN\s+RAISE EXCEPTION/);
    expect(guard).toMatch(/pg_class\.relrowsecurity FROM [\s\S]*?\) THEN\s+RAISE EXCEPTION/);
    expect(guard).toMatch(/pg_class\.relforcerowsecurity FROM [\s\S]*?\) THEN\s+RAISE EXCEPTION/);
    expect(guard).toMatch(/pg_attribute\.attacl IS NOT NULL\s+\) THEN\s+RAISE EXCEPTION/);
    expect(arrayLiterals(guard, 'guard_privilege')).toEqual(SIGNED_IN);
    expect(guard).toMatch(
      /IF NOT pg_catalog\.has_table_privilege\('authenticated', guard_table_oid, guard_privilege\) THEN\s+RAISE EXCEPTION/
    );
    expect(guard).toContain('so nothing was applied');
  });

  it('the sequence block revokes anon and PUBLIC on every sequence the six tables own, and nothing else', () => {
    const sequences = blocks[1];
    expect(relnameInList(sequences)).toEqual(TABLES);
    expect(sequences).toContain("sequence_class.relkind = 'S'");
    expect(sequences).toContain("pg_depend.deptype IN ('a', 'i')");
    expect(sequences).toContain("owner_schema.nspname = 'public'");
    const executes = [...sequences.matchAll(/EXECUTE ([^;]*);/g)].map((match) => match[1]);
    expect(executes).toEqual([
      "'REVOKE ALL ON SEQUENCE ' || sequence_label || ' FROM PUBLIC'",
      "'REVOKE ALL ON SEQUENCE ' || sequence_label || ' FROM anon'",
    ]);
    // regclass::text quotes the identifier, so the dynamic statement is safe.
    expect(sequences).toContain('sequence_class.oid::regclass::text');
  });

  it('the post-assert checks owner, row security unchanged, PUBLIC and anon hold nothing, authenticated and service_role keep the four', () => {
    const post = blocks[2];
    expect(post).toMatch(/IS DISTINCT FROM 'postgres' THEN\s+RAISE EXCEPTION/);
    expect(post).toMatch(/pg_class\.relrowsecurity FROM [\s\S]*?\) THEN\s+RAISE EXCEPTION/);
    const roleLists = allArrayLiterals(post, 'check_role');
    expect(roleLists).toEqual([
      ['public', 'anon'],
      ['public', 'anon'],
    ]);
    const privilegeLists = allArrayLiterals(post, 'check_privilege');
    expect(privilegeLists).toEqual([
      EIGHT,
      ['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'],
      SIGNED_IN,
      REMOVED_FROM_AUTHENTICATED,
      ['USAGE', 'SELECT', 'UPDATE'],
    ]);
    expect(post).toMatch(/IF pg_catalog\.has_table_privilege\(check_role, check_table_oid, check_privilege\) THEN\s+RAISE EXCEPTION/);
    expect(post).toMatch(/IF pg_catalog\.has_any_column_privilege\(check_role, check_table_oid, check_privilege\) THEN\s+RAISE EXCEPTION/);
    expect(post).toMatch(/IF NOT pg_catalog\.has_table_privilege\('authenticated', check_table_oid, check_privilege\) THEN\s+RAISE EXCEPTION/);
    expect(post).toMatch(/IF NOT pg_catalog\.has_table_privilege\('service_role', check_table_oid, check_privilege\) THEN\s+RAISE EXCEPTION/);
    expect(post).toMatch(/IF pg_catalog\.has_table_privilege\('authenticated', check_table_oid, check_privilege\) THEN\s+RAISE EXCEPTION/);
    expect(post).toMatch(/pg_attribute\.attacl IS NOT NULL\s+\) THEN\s+RAISE EXCEPTION/);
    expect(post).toMatch(/IF pg_catalog\.has_sequence_privilege\(check_role, check_sequence_oid, check_privilege\) THEN\s+RAISE EXCEPTION/);
    expect(post).toContain('pg_depend.refobjid = check_table_oid');
  });
});

describe('the rollback is the exact inverse', () => {
  const blocks = doBlocksOf(rollback);
  const statements = statementsOf(withoutDoBlocks(rollback));

  it('starts with the warning, then one BEGIN ... COMMIT with a lock timeout', () => {
    expect(statements[0]).toMatch(/^SELECT 'WARNING this rollback reopens .*' AS read_me_first$/);
    expect(statements[1]).toBe('BEGIN');
    expect(statements[2]).toBe("SET LOCAL lock_timeout = '5s'");
    expect(statements[statements.length - 1]).toBe('COMMIT');
    expect(blocks).toHaveLength(2);
  });

  it('per table, in order: GRANT ALL to anon and the four extras back to authenticated', () => {
    const expected = TABLES.flatMap((name) => [
      `GRANT ALL ON TABLE public.${name} TO anon`,
      `GRANT TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.${name} TO authenticated`,
    ]);
    expect(statements.slice(3, -1)).toEqual(expected);
  });

  it('revokes nothing, grants nothing to PUBLIC, and touches no other object', () => {
    expect(rollback).not.toMatch(/\b(REVOKE|DROP|CREATE|CASCADE|OWNER|POLICY)\b/);
    expect(rollback).not.toMatch(/TO PUBLIC/);
    expect(rollback).not.toMatch(/service_role/);
  });

  it('gives anon back ALL on the same owned sequences', () => {
    const sequences = blocks[0];
    expect(relnameInList(sequences)).toEqual(TABLES);
    expect(sequences).toContain("pg_depend.deptype IN ('a', 'i')");
    const executes = [...sequences.matchAll(/EXECUTE ([^;]*);/g)].map((match) => match[1]);
    expect(executes).toEqual(["'GRANT ALL ON SEQUENCE ' || sequence_label || ' TO anon'"]);
  });

  it('checks in the same transaction that anon and authenticated hold all eight again', () => {
    const block = blocks[1];
    expect(arrayLiterals(block, 'check_table_name')).toEqual(TABLES);
    expect(block).toMatch(/IF check_table_oid IS NULL THEN\s+RAISE EXCEPTION/);
    expect(arrayLiterals(block, 'check_role')).toEqual(['anon', 'authenticated']);
    expect(arrayLiterals(block, 'check_privilege')).toEqual(EIGHT);
    expect(block).toMatch(/IF NOT pg_catalog\.has_table_privilege\(check_role, check_table_oid, check_privilege\) THEN\s+RAISE EXCEPTION/);
  });
});

describe('the checker and the pre-check', () => {
  const writeKeywords = /\b(INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|ALTER|DROP|CREATE|LOCK)\b(?!')/;

  it('both are read-only from their first statement and write nothing', () => {
    for (const text of [checker, precheck]) {
      expect(statementsOf(text)[0]).toBe('SET default_transaction_read_only = on');
      const unquoted = text.replace(/'[^']*'/g, "''");
      expect(unquoted).not.toMatch(writeKeywords);
      expect(text).not.toMatch(/\b(EXECUTE|DO \$\$)/);
    }
  });

  it('both list exactly the six tables, in order', () => {
    for (const text of [checker, precheck]) {
      for (const [index, name] of TABLES.entries()) {
        expect(text).toContain(`('${name}', ${index + 1})`);
      }
      expect(text.match(/\('[a-z_]+', [0-9]+\)/g)?.filter((row) => TABLES.some((name) => row.startsWith(`('${name}'`)))).toHaveLength(6);
    }
  });

  it('both test the seven privileges, plus MAINTAIN only on PostgreSQL 17 or later', () => {
    for (const text of [checker, precheck]) {
      for (const privilege of SIGNED_IN) expect(text).toContain(`('${privilege}', 0, true)`);
      for (const privilege of ['TRUNCATE', 'REFERENCES', 'TRIGGER']) expect(text).toContain(`('${privilege}', 0, false)`);
      expect(text).toContain("('MAINTAIN', 170000, false)");
      expect(text).toContain("pg_catalog.current_setting('server_version_num')::int >= privilege_row.min_version");
    }
  });

  it('the checker reports VERDICT first and runs ten checks per table', () => {
    expect(checker).toContain("'VERDICT' AS check_name");
    expect(checker).toMatch(/CASE WHEN EXISTS \(SELECT 1 FROM checks WHERE checks\.result <> 'PASS'\) THEN 'FAIL' ELSE 'PASS' END/);
    for (const marker of [
      "'C1 exists '",
      "'C2 owner postgres '",
      "'C3 row security still off '",
      "'C4 anon and public hold no table privilege '",
      "'C5 authenticated keeps SELECT INSERT UPDATE DELETE '",
      "'C6 authenticated holds no TRUNCATE REFERENCES TRIGGER MAINTAIN '",
      "'C7 service_role keeps SELECT INSERT UPDATE DELETE '",
      "'C8 anon and public hold no column privilege '",
      "'C9 no column acl '",
      "'C10 anon and public hold no owned sequence privilege '",
    ]) {
      expect(checker).toContain(marker);
    }
    expect((checker.match(/held_summary\.table_order \* 100 \+ \d+/g) ?? []).length).toBe(10);
    expect(checker).toContain("pg_depend.deptype IN ('a', 'i')");
  });

  it('the pre-check records state, sequences, functions, triggers and policies, and stops on any blocker', () => {
    expect(statementsOf(precheck).length).toBe(2);
    expect(precheck).toMatch(/SELECT 0 AS sort_order,\s+'PRECHECK STATUS' AS item/);
    for (const marker of [
      "'Q0 server version'",
      "'Q1 exists '",
      "'Q2 owner '",
      "'Q3 row security '",
      "'Q4 privileges '",
      "'Q5 grant '",
      "'Q6 column privileges '",
      "'Q7 owned sequences count '",
      "'Q7 owned sequence '",
      "'Q8 function mentions count '",
      "'Q8 function mention '",
      "'Q9 trigger '",
      "'Q10 policy mention '",
    ]) {
      expect(precheck).toContain(marker);
    }
    expect(precheck).toContain("' OTHER GRANTOR stop here'");
    expect(precheck).toContain("' lacks a signed in privilege so the migration would refuse stop here'");
    expect(precheck).toContain('run the migration in a NEW tab');
    expect(precheck).toContain('adjust the rollback');
    expect(precheck).toContain('ORDER BY final_report.sort_order, final_report.item');
  });

  // SA ruling Q-SA-6: list every function whose body names one of the six,
  // and STOP when a caller-rights function body holds TRUNCATE or LOCK.
  it('the pre-check lists every function naming a table and stops on TRUNCATE or LOCK in a caller-rights body', () => {
    expect(precheck).toContain('JOIN function_body ON strpos(function_body.body_text, watched.table_name) > 0');
    expect(precheck).toContain('pg_catalog.pg_get_function_sqlbody(pg_proc.oid)');
    expect(precheck).toContain("strpos(upper(function_body.body_text), 'TRUNCATE') > 0 AS has_truncate");
    expect(precheck).toMatch(/strpos\(replace\(replace\(upper\(function_body\.body_text\), 'LOCK_TIMEOUT', ''\), 'LOCKED', ''\), 'LOCK'\) > 0 AS has_lock/);
    expect(precheck).toMatch(
      /WHEN NOT function_mention\.runs_as_owner AND function_mention\.has_truncate\s+THEN ' TRUNCATE in a caller rights body stop here'/
    );
    expect(precheck).toMatch(
      /WHEN NOT function_mention\.runs_as_owner AND function_mention\.has_lock\s+THEN ' LOCK in a caller rights body stop here'/
    );
    expect(precheck).toContain('pg_proc.prosecdef AS runs_as_owner');
  });
});

describe('the workplans', () => {
  it('the slice 1b workplan records the stopgap files and its number', () => {
    const workplan = read(SLICE1B_WORKPLAN);
    expect(workplan).toContain('20261060');
    expect(workplan).toContain('rls-disabled-agent-tables-anon-stopgap');
    expect(workplan).toContain('SET LOCAL ROLE anon');
    expect(workplan).toContain('42501');
  });

  it('the slice 2 workplan tells full 2c that 1b and this stopgap are already applied (SA ruling Q-SA-1)', () => {
    const workplan = read(SLICE2_WORKPLAN);
    expect(workplan).toContain('20261060');
    expect(workplan).toMatch(/pre-guard must assume/i);
  });
});
