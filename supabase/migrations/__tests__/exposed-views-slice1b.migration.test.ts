/**
 * Guard over migration 20261059, exposed views slice 1b
 * (workplan docs/workplans/EXPOSED_VIEWS_SLICE1B_WORKPLAN.md).
 *
 * Thirteen owner-rights views in public (owner postgres, security_invoker
 * unset) still granted anon and authenticated SELECT, UPDATE and DELETE on
 * 2026-10-13. Three of them (monthly_token_usage, daily_token_usage,
 * agent_executions_with_details) re-expose token_usage and agent_executions to
 * anon around slice 2b's RLS. No client-role code reads any of the 13; the one
 * live reader (calculator_config, /api/pricing/config) uses the service role.
 *
 * The migration sets security_invoker = true on all 13, removes every client
 * privilege and keeps service_role SELECT. A pre-guard refuses unless
 * service_role can read every base relation and run every function each view
 * uses, and a final probe reads each view AS service_role, so the one live
 * reader cannot break silently.
 *
 * WHY A TEST OVER SQL TEXT: there is no branch database. The pre-check, the
 * migration (in a NEW tab), the checker and the rollback are pasted into the
 * Supabase SQL editor by hand. Same shape as the slice 1a test.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const MIGRATION = join(ROOT, 'supabase', 'migrations', '20261059_exposed_views_slice1b.sql');
const ROLLBACK = join(ROOT, 'supabase', 'SQL Scripts', '20261059_exposed_views_slice1b_rollback.sql');
const CHECKER = join(ROOT, 'scripts', 'check-exposed-views-slice1b-migration.sql');
const PRECHECK = join(ROOT, 'scripts', 'precheck-exposed-views-slice1b.sql');
const WORKPLAN = join(ROOT, 'docs', 'workplans', 'EXPOSED_VIEWS_SLICE1B_WORKPLAN.md');

const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const migration = read(MIGRATION);
const rollback = read(ROLLBACK);
const checker = read(CHECKER);
const precheck = read(PRECHECK);

const VIEWS = [
  'monthly_token_usage',
  'daily_token_usage',
  'agent_executions_with_details',
  'agent_memory_stats',
  'calculator_config',
  'agent_intensity_distribution',
  'top_complex_agents',
  'token_prediction_accuracy',
  'calibration_success_metrics',
  'production_workflow_health',
  'v6_quality_trends',
  'error_pattern_summary',
  'website_analytics_summary',
];
const REGCLASSES = VIEWS.map((name) => `public.${name}`);
const EIGHT = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'];

/** Objects other sessions or earlier slices own. This slice must not name them. */
const NOT_OURS = [
  'active_plugin_connections',
  'user_settings_complete',
  'pilot_routing_performance',
  'pilot_step_type_analysis',
  'pilot_tier_distribution',
  'pilot_cost_savings_summary',
  'pilot_step_routing_history',
];

/** The six RLS-disabled tables slice 2c owns. The SQL must not touch them. */
const SLICE_2C_TABLES = [
  'agent_configurations',
  'agent_logs',
  'agent_stats',
  'shared_agents',
  'shared_agent_imports',
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

  it.each(files)('%s holds only plain literals, apart from the thirteen view names', (_name, file) => {
    for (const literal of literalsOf(read(file))) {
      if (/^[A-Za-z0-9_ ]*$/.test(literal)) continue;
      expect(REGCLASSES).toContain(literal);
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

  it.each(files)('%s names no object another slice or session owns', (_name, file) => {
    const text = read(file);
    for (const name of [...NOT_OURS, ...SLICE_2C_TABLES]) {
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

  it('runs the pre-guard before any change and the post-assert and probe after all of them', () => {
    const firstAlter = migration.indexOf('ALTER VIEW');
    const lastGrant = migration.lastIndexOf('GRANT SELECT ON');
    expect(migration.indexOf(blocks[0])).toBeLessThan(firstAlter);
    expect(migration.indexOf(blocks[1])).toBeGreaterThan(lastGrant);
    expect(migration.indexOf(blocks[2])).toBeGreaterThan(migration.indexOf(blocks[1]));
  });

  it('per view, in order: invoker on, revoke every client privilege, grant service_role SELECT', () => {
    const expected = VIEWS.flatMap((name) => [
      `ALTER VIEW public.${name} SET (security_invoker = true)`,
      `REVOKE ALL ON public.${name} FROM PUBLIC, anon, authenticated`,
      `GRANT SELECT ON public.${name} TO service_role`,
    ]);
    expect(statements.slice(2, -1)).toEqual(expected);
  });

  it('drops, recreates and re-owns nothing, and never forces or touches row security', () => {
    expect(migration).not.toMatch(/\b(DROP|CREATE|CASCADE|OWNER)\b/);
    expect(migration).not.toMatch(/ROW LEVEL SECURITY|FORCE/);
    expect(migration).not.toMatch(/\bGRANT\b[^;]*\bTO\b[^;]*\b(anon|authenticated|PUBLIC)\b/);
  });

  it('every DO block loops over exactly the thirteen views and fails, never skips, on a missing one', () => {
    for (const [block, variable] of [
      [blocks[0], 'guard_view_name'],
      [blocks[1], 'slice_view_name'],
      [blocks[2], 'probe_view_name'],
    ] as const) {
      expect(arrayLiterals(block, variable)).toEqual(REGCLASSES);
    }
    expect(blocks[0]).toMatch(/IF guard_view IS NULL THEN\s+RAISE EXCEPTION/);
    expect(blocks[1]).toMatch(/IF slice_view IS NULL THEN\s+RAISE EXCEPTION/);
  });

  it('the pre-guard pins plain view, owner postgres, invoker unset and no column ACL', () => {
    const guard = blocks[0];
    expect(guard).toContain("IS DISTINCT FROM 'v' THEN");
    expect(guard).toContain("IS DISTINCT FROM 'postgres' THEN");
    expect(guard).toMatch(/view_option\.option_name = 'security_invoker'\s+\) THEN\s+RAISE EXCEPTION/);
    expect(guard).toMatch(/pg_attribute\.attacl IS NOT NULL\s+\) THEN\s+RAISE EXCEPTION/);
  });

  it('the pre-guard refuses unless service_role reads every base relation and runs every function', () => {
    const guard = blocks[0];
    expect(guard).toContain("pg_catalog.has_table_privilege('service_role', pg_class.oid, 'SELECT')");
    expect(guard).toContain("pg_catalog.has_schema_privilege('service_role', pg_namespace.oid, 'USAGE')");
    expect(guard).toContain("pg_catalog.has_function_privilege('service_role', pg_proc.oid, 'EXECUTE')");
    expect(guard).toContain("pg_depend.refclassid = 'pg_class'::regclass");
    expect(guard).toContain("pg_depend.refclassid = 'pg_proc'::regclass");
    expect((guard.match(/IF guard_gaps IS NOT NULL THEN\s+RAISE EXCEPTION/g) ?? []).length).toBe(2);
  });

  it('the post-assert checks invoker true, owner, all eight privileges for three roles, column ACLs and service_role SELECT', () => {
    const post = blocks[1];
    expect(post).toContain("view_option.option_value = 'true'");
    expect(post).toContain("IS DISTINCT FROM 'postgres' THEN");
    expect(arrayLiterals(post, 'slice_role')).toEqual(['public', 'anon', 'authenticated']);
    expect(arrayLiterals(post, 'slice_privilege')).toEqual(EIGHT);
    expect(post).toMatch(/IF pg_catalog\.has_table_privilege\(slice_role, slice_view, slice_privilege\) THEN\s+RAISE EXCEPTION/);
    expect(post).toMatch(/pg_attribute\.attacl IS NOT NULL\s+\) THEN\s+RAISE EXCEPTION/);
    expect(post).toMatch(/IF NOT pg_catalog\.has_table_privilege\('service_role', slice_view, 'SELECT'\) THEN\s+RAISE EXCEPTION/);
  });

  it('the probe reads each view as service_role and resets the role', () => {
    const probe = blocks[2];
    expect(probe).toMatch(/BEGIN\s+SET LOCAL ROLE service_role;/);
    expect(probe).toContain("EXECUTE 'SELECT 1 FROM ' || pg_catalog.to_regclass(probe_view_name)::text || ' LIMIT 1';");
    expect(probe).toMatch(/END LOOP;\s+RESET ROLE;\s+END/);
  });
});

describe('the rollback is the exact inverse', () => {
  const blocks = doBlocksOf(rollback);
  const statements = statementsOf(withoutDoBlocks(rollback));

  it('starts with the warning, then one BEGIN ... COMMIT with a lock timeout', () => {
    expect(statements[0]).toMatch(/^SELECT 'WARNING this rollback reopens anon and authenticated read .*' AS read_me_first$/);
    expect(statements[1]).toBe('BEGIN');
    expect(statements[2]).toBe("SET LOCAL lock_timeout = '5s'");
    expect(statements[statements.length - 1]).toBe('COMMIT');
    expect(blocks).toHaveLength(1);
  });

  it('per view, in order: reset invoker and GRANT ALL to anon and authenticated', () => {
    const expected = VIEWS.flatMap((name) => [
      `ALTER VIEW public.${name} RESET (security_invoker)`,
      `GRANT ALL ON public.${name} TO anon, authenticated`,
    ]);
    expect(statements.slice(3, -1)).toEqual(expected);
  });

  it('revokes nothing, grants nothing to PUBLIC, and touches no other object', () => {
    expect(rollback).not.toMatch(/\b(REVOKE|DROP|CREATE|CASCADE|OWNER)\b/);
    expect(rollback).not.toMatch(/TO PUBLIC/);
  });

  it('checks in the same transaction that invoker is unset and anon, authenticated and service_role select again', () => {
    const block = blocks[0];
    expect(arrayLiterals(block, 'slice_view_name')).toEqual(REGCLASSES);
    expect(block).toMatch(/IF slice_view IS NULL THEN\s+RAISE EXCEPTION/);
    expect(block).toMatch(/view_option\.option_name = 'security_invoker'\s+\) THEN\s+RAISE EXCEPTION/);
    for (const role of ['anon', 'authenticated', 'service_role']) {
      expect(block).toMatch(
        new RegExp(`IF NOT pg_catalog\\.has_table_privilege\\('${role}', slice_view, 'SELECT'\\) THEN\\s+RAISE EXCEPTION`)
      );
    }
  });
});

describe('the checker and the pre-check', () => {
  const writeKeywords = /\b(INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|ALTER|DROP|CREATE)\b(?!')/;

  it('both are read-only from their first statement and write nothing', () => {
    for (const text of [checker, precheck]) {
      expect(statementsOf(text)[0]).toBe('SET default_transaction_read_only = on');
      const unquoted = text.replace(/'[^']*'/g, "''");
      expect(unquoted).not.toMatch(writeKeywords);
    }
  });

  it('both list exactly the thirteen views, in order', () => {
    for (const text of [checker, precheck]) {
      const listed = literalsOf(text).filter((literal) => literal.startsWith('public.'));
      expect(listed).toEqual(REGCLASSES);
      for (const [index, name] of VIEWS.entries()) {
        expect(text).toContain(`('${name}', 'public.${name}', ${index + 1})`);
      }
    }
  });

  it('both test the seven privileges, plus MAINTAIN only on PostgreSQL 17 or later', () => {
    for (const text of [checker, precheck]) {
      for (const privilege of EIGHT.slice(0, 7)) expect(text).toContain(`('${privilege}', 0)`);
      expect(text).toContain("('MAINTAIN', 170000)");
      expect(text).toContain("pg_catalog.current_setting('server_version_num')::int >= privilege_row.min_version");
    }
  });

  it('the checker reports VERDICT first and runs eight checks per view', () => {
    expect(checker).toContain("'VERDICT' AS check_name");
    expect(checker).toMatch(/CASE WHEN EXISTS \(SELECT 1 FROM checks WHERE checks\.result <> 'PASS'\) THEN 'FAIL' ELSE 'PASS' END/);
    for (const marker of [
      "'C1 exists '",
      "'C2 owner postgres '",
      "'C3 security invoker true '",
      "('anon', 4)",
      "('authenticated', 5)",
      "('public', 6)",
      "'C7 service_role select '",
      "'C8 no column privileges '",
    ]) {
      expect(checker).toContain(marker);
    }
    expect(checker).toContain("CASE WHEN view_state.invoker_setting = 'true' THEN 'PASS' ELSE 'FAIL' END");
  });

  it('the pre-check records state, base relations, functions and every dependency kind, and stops on any', () => {
    for (const marker of [
      "'PRECHECK STATUS'",
      "'Q0 server version'",
      "'Q0 can switch to service_role'",
      "'Q1 exists '",
      "'Q2 owner '",
      "'Q3 security invoker '",
      "'Q4 privileges '",
      "'Q5 grant '",
      "'Q6 dependents count '",
      "'Q7 function mentions count '",
      "'Q8 policy mentions count '",
      "'Q9 other view mentions count '",
      "'Q10 reads '",
      "'Q11 calls '",
      "'Q12 column privileges '",
      "'Q13 writable through the view '",
    ]) {
      expect(precheck).toContain(marker);
    }
    expect(precheck).toContain("' OTHER GRANTOR stop here'");
    expect(precheck).toContain("' expected unset stop here'");
    expect(precheck).toContain('run the migration in a NEW tab');
    expect(precheck).toContain('adjust the rollback');
    expect(precheck).toContain('ORDER BY final_report.sort_order, final_report.item');
  });
});

describe('the workplan', () => {
  it('names the apply order, the negative tests, the number and the 2c stopgap assessment', () => {
    const workplan = read(WORKPLAN);
    expect(workplan).toContain('20261059');
    expect(workplan).toContain('SET LOCAL ROLE anon');
    expect(workplan).toContain('42501');
    expect(workplan).toMatch(/slice 2c/i);
    expect(workplan).toMatch(/stopgap/i);
  });
});
