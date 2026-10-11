/**
 * Guard over migration 20261053, the pilot_step_routing_history lockdown
 * (requirement docs/requirements/PILOT_STEP_ROUTING_HISTORY_ANON_EXPOSURE_REQUIREMENT.md,
 * workplan docs/workplans/PILOT_STEP_ROUTING_HISTORY_RLS_WORKPLAN.md, SA C-1..C-10,
 * W-1..W-6, S-1..S-5).
 *
 * The anon key could read every row of the table, and (catalog-proven, S-3)
 * update and delete them. The migration drops the three captured `public`
 * policies, revokes every client grant, keeps SELECT for authenticated behind a
 * single admin-only policy and SELECT for service_role, and closes the three
 * dependent views that served the same rows to anon (C-3). The slice-2 view
 * `pilot_cost_savings_summary` is excluded by a catalog predicate and never
 * named (C-6, W-3).
 *
 * WHY A TEST OVER SQL TEXT: there is no branch database. The user pastes the
 * pre-check, the migration (in a NEW tab), the checker and, if ever needed, the
 * rollback into the Supabase SQL editor by hand. What the files alone can prove
 * is pinned here, including mutation self-tests (AC-9): the violation finders
 * are pure functions, and injecting an anon grant or a `true` policy must make
 * them report.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const MIGRATION = join(ROOT, 'supabase', 'migrations', '20261053_pilot_step_routing_history_rls_lockdown.sql');
const ROLLBACK = join(ROOT, 'supabase', 'SQL Scripts', '20261053_pilot_step_routing_history_rls_lockdown_rollback.sql');
const CHECKER = join(ROOT, 'scripts', 'check-pilot-step-routing-history-rls-migration.sql');
const PRECHECK = join(ROOT, 'scripts', 'precheck-pilot-step-routing-history-rls.sql');

const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const migration = read(MIGRATION);
const rollback = read(ROLLBACK);
const checker = read(CHECKER);
const precheck = read(PRECHECK);

const TABLE = 'public.pilot_step_routing_history';
const SLICE_TWO_VIEW = 'pilot_cost_savings_summary';
/** Step 1 capture, 2026-10-11 (workplan Appendix A, SA S-1). */
const CAPTURED_POLICIES = [
  'Service role can access all routing history',
  'System can insert routing history',
  'Users can read their own routing history',
];
/** C-3 views from the capture, minus the slice-2 view (D-1 / W-3). */
const CAPTURED_VIEWS = ['pilot_routing_performance', 'pilot_step_type_analysis', 'pilot_tier_distribution'];
const MD5_TRUE = 'b326b5062b2f0e69046810717534cb09';
const MD5_OWNER_READ = 'cb36b1a0770728f01fd9e4744dd633c9';
const ALL_PRIVILEGES = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'];
const ADMIN_POLICY =
  'CREATE POLICY pilot_step_routing_history_admin_select ON public.pilot_step_routing_history AS PERMISSIVE FOR SELECT TO authenticated USING ((SELECT public.is_platform_admin()))';
/** The W-3 exclusion predicate. Migration and checker must carry the same text. */
const PRICING_PREDICATE =
  "EXISTS ( SELECT 1 FROM pg_rewrite AS own_rule JOIN pg_depend AS own_dependency ON own_dependency.classid = 'pg_rewrite'::regclass AND own_dependency.objid = own_rule.oid AND own_dependency.refclassid = 'pg_class'::regclass JOIN pg_class AS pricing_class ON pricing_class.oid = own_dependency.refobjid JOIN pg_namespace AS pricing_namespace ON pricing_namespace.oid = pricing_class.relnamespace WHERE pricing_namespace.nspname = 'public' AND pricing_class.relname = 'ai_model_pricing' AND own_rule.ev_class = dependent_views.view_oid )";

const EXPECTED_MIGRATION_DDL = [
  ...CAPTURED_POLICIES.map((name) => `DROP POLICY "${name}" ON ${TABLE}`),
  `ALTER TABLE ${TABLE} ENABLE ROW LEVEL SECURITY`,
  ...['PUBLIC', 'anon', 'authenticated', 'service_role'].map((role) => `REVOKE ALL ON TABLE ${TABLE} FROM ${role}`),
  `GRANT SELECT ON TABLE ${TABLE} TO authenticated`,
  `GRANT SELECT ON TABLE ${TABLE} TO service_role`,
  ADMIN_POLICY,
  ...CAPTURED_VIEWS.flatMap((view) => [
    ...['PUBLIC', 'anon', 'authenticated'].map((role) => `REVOKE ALL ON TABLE public.${view} FROM ${role}`),
    `GRANT SELECT ON TABLE public.${view} TO service_role`,
  ]),
];

const EXPECTED_ROLLBACK_DDL = [
  `DROP POLICY pilot_step_routing_history_admin_select ON ${TABLE}`,
  `GRANT ${ALL_PRIVILEGES.join(', ')} ON TABLE ${TABLE} TO service_role`,
];

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * Top-level statements, whitespace collapsed, without the semicolon. Aware of
 * dollar quotes, single quotes and double-quoted identifiers, because the DO
 * bodies hold semicolons of their own.
 */
function topLevelStatements(sql: string): string[] {
  const out: string[] = [];
  let current = '';
  let inDollar = false;
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (!inSingle && !inDouble && sql.startsWith('$$', i)) {
      inDollar = !inDollar;
      current += '$$';
      i += 1;
      continue;
    }
    if (!inDollar && !inDouble && ch === "'") inSingle = !inSingle;
    if (!inDollar && !inSingle && ch === '"') inDouble = !inDouble;
    if (ch === ';' && !inDollar && !inSingle && !inDouble) {
      if (current.trim()) out.push(collapse(current));
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(collapse(current));
  return out;
}

const isDo = (statement: string) => statement.startsWith('DO $$');
const ddlOf = (sql: string) => topLevelStatements(sql).filter((s) => !isDo(s) && !['BEGIN', 'COMMIT'].includes(s) && !s.startsWith('SET LOCAL'));

function literalsOf(sql: string): string[] {
  return [...sql.matchAll(/'([^']*)'/g)].map((match) => match[1]);
}

/** Everything the migration must never contain or do. Empty means clean. */
function migrationViolations(sql: string): string[] {
  const found: string[] = [];
  const forbidden: Array<[string, RegExp]> = [
    ['grant to anon', /\bTO\s+anon\b/i],
    ['grant to PUBLIC', /\bTO\s+PUBLIC\b/i],
    ['USING true policy', /USING\s*\(\s*true\s*\)/i],
    ['WITH CHECK true policy', /WITH\s+CHECK\s*\(\s*true\s*\)/i],
    ['FORCE row security', /\bFORCE\b/i],
    ['revoke from postgres', /FROM\s+postgres\b/i],
    ['DROP POLICY IF EXISTS', /DROP\s+POLICY\s+IF\s+EXISTS/i],
    ['CASCADE', /\bCASCADE\b/i],
    ['profiles', /profiles/i],
    ['SECURITY DEFINER words', /SECURITY\s+DEFINER/i],
    ['slice-2 view named', new RegExp(SLICE_TWO_VIEW)],
    ['revoke from service_role on a view', /REVOKE[^;]*ON\s+TABLE\s+public\.(?!pilot_step_routing_history\b)\w+\s+FROM\s+service_role/i],
  ];
  for (const [name, pattern] of forbidden) if (pattern.test(sql)) found.push(name);
  const ddl = ddlOf(sql);
  const allowed = new Set(EXPECTED_MIGRATION_DDL);
  for (const statement of ddl) {
    if (/^(GRANT|CREATE POLICY|REVOKE|DROP|ALTER)\b/i.test(statement) && !allowed.has(statement)) {
      found.push(`unexpected statement: ${statement}`);
    }
  }
  if (!sql.includes('(SELECT public.is_platform_admin())')) found.push('admin policy predicate missing');
  return found;
}

/** Everything the rollback must never contain or do (C-7, W-2, W-6). */
function rollbackViolations(sql: string): string[] {
  const found: string[] = [];
  const forbidden: Array<[string, RegExp]> = [
    ['grant to anon', /\bTO\s+anon\b/i],
    ['grant to authenticated', /\bTO\s+authenticated\b/i],
    ['grant to PUBLIC', /\bTO\s+PUBLIC\b/i],
    ['CREATE POLICY', /CREATE\s+POLICY/i],
    ['DISABLE ROW LEVEL SECURITY', /DISABLE\s+ROW\s+LEVEL\s+SECURITY/i],
    ['USING true policy', /USING\s*\(\s*true\s*\)/i],
    ['WITH CHECK true policy', /WITH\s+CHECK\s*\(\s*true\s*\)/i],
    ['REVOKE', /\bREVOKE\b/i],
    ['FORCE', /\bFORCE\b/i],
    ['WITH GRANT OPTION', /WITH\s+GRANT\s+OPTION/i],
    ['SECURITY DEFINER words', /SECURITY\s+DEFINER/i],
    ['slice-2 view named', new RegExp(SLICE_TWO_VIEW)],
    ...CAPTURED_VIEWS.map((view): [string, RegExp] => [`view ${view} named`, new RegExp(view)]),
  ];
  for (const [name, pattern] of forbidden) if (pattern.test(sql)) found.push(name);
  const allowed = new Set(EXPECTED_ROLLBACK_DDL);
  for (const statement of ddlOf(sql)) {
    if (!allowed.has(statement)) found.push(`unexpected statement: ${statement}`);
  }
  return found;
}

const injectBeforeCommit = (sql: string, statement: string) => sql.replace(/COMMIT;\s*$/, `${statement}\n\nCOMMIT;\n`);

describe('SQL-editor safety (the user pastes all four files by hand, W-1)', () => {
  const files: Array<[string, string]> = [
    ['migration', MIGRATION],
    ['rollback', ROLLBACK],
    ['checker', CHECKER],
    ['pre-check', PRECHECK],
  ];

  it.each(files)('%s exists', (_name, file) => {
    expect(existsSync(file)).toBe(true);
  });

  it.each(files)('%s has no line comment and no block comment', (_name, file) => {
    const text = read(file);
    expect(text).not.toContain('--');
    expect(text).not.toContain('/*');
  });

  // The Supabase SQL editor misreads "into" even inside a string literal. W-1:
  // banned as a substring in any case, as in the slice 4a test.
  it.each(files)('%s never contains "into" anywhere', (_name, file) => {
    expect(read(file)).not.toMatch(/into/i);
  });

  it.each(files)('%s has an even number of single quotes', (_name, file) => {
    expect((read(file).match(/'/g) ?? []).length % 2).toBe(0);
  });

  it.each(files)('%s holds only letters, digits, underscores and spaces inside string literals (no dotted literal)', (_name, file) => {
    for (const literal of literalsOf(read(file))) expect(literal).toMatch(/^[A-Za-z0-9_ ]*$/);
  });

  it.each(files)('%s never says SECURITY DEFINER (slice 6 guard F-2) and uses no single-letter alias', (_name, file) => {
    const text = read(file);
    expect(text).not.toMatch(/SECURITY\s+DEFINER/i);
    expect(text).not.toMatch(/\bAS [a-z]\b/i);
  });

  it.each(files)('%s has no unfilled placeholder', (_name, file) => {
    expect(read(file)).not.toContain('PENDING_STEP_1');
  });

  it('the checker and the pre-check are read-only from their first statement and write nothing', () => {
    for (const text of [checker, precheck]) {
      expect(topLevelStatements(text)[0]).toBe('SET default_transaction_read_only = on');
      expect(topLevelStatements(text)).toHaveLength(2);
      expect(text).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|ALTER|DROP|CREATE)\b(?!')/);
    }
  });

  it('the pre-check tells the user to run the migration in a NEW tab', () => {
    expect(precheck).toContain('run the migration in a NEW tab');
  });
});

describe('the migration (C-1, C-2 as amended by S-1, C-3, C-6, R-2)', () => {
  const statements = topLevelStatements(migration);

  it('is one BEGIN, SET LOCAL lock_timeout, pre-guard DO, the DDL, post-assert DO, COMMIT', () => {
    expect(statements[0]).toBe('BEGIN');
    expect(statements[1]).toBe("SET LOCAL lock_timeout = '5s'");
    expect(isDo(statements[2])).toBe(true);
    expect(isDo(statements[statements.length - 2])).toBe(true);
    expect(statements[statements.length - 1]).toBe('COMMIT');
    expect(statements.filter((s) => s === 'BEGIN')).toHaveLength(1);
    expect(statements.filter((s) => s === 'COMMIT')).toHaveLength(1);
    expect(statements.filter(isDo)).toHaveLength(2);
  });

  it('holds exactly the expected DDL, in order', () => {
    expect(statements.slice(3, -2)).toEqual(EXPECTED_MIGRATION_DDL);
  });

  it('has no violation', () => {
    expect(migrationViolations(migration)).toEqual([]);
  });

  it('grants service_role SELECT only on the table (R-2) and never revokes service_role on a view (W-2)', () => {
    const serviceGrants = statements.filter((s) => s.startsWith('GRANT') && s.endsWith('TO service_role'));
    for (const grant of serviceGrants) expect(grant).toMatch(/^GRANT SELECT ON TABLE public\.\w+ TO service_role$/);
    for (const view of CAPTURED_VIEWS) {
      expect(statements).not.toContain(`REVOKE ALL ON TABLE public.${view} FROM service_role`);
    }
  });

  it('each REVOKE and GRANT names exactly one object and one role', () => {
    for (const statement of statements.filter((s) => /^(REVOKE|GRANT) /.test(s))) {
      expect(statement.match(/\bpublic\.\w+/g)).toHaveLength(1);
      expect(statement).toMatch(/ (FROM|TO) (PUBLIC|anon|authenticated|service_role)$/);
    }
  });

  describe('the pre-guard pins the Step 1 capture', () => {
    const guard = statements[2];

    it('requires the postgres owner and no forced row security (C-1)', () => {
      expect(guard).toContain("IS DISTINCT FROM 'postgres'");
      expect(guard).toContain('pg_class.relforcerowsecurity');
    });

    it('requires exactly the three captured policies, each pinned by roles, cmd and md5 (S-1)', () => {
      expect(guard).toMatch(/AND pg_policies\.tablename = 'pilot_step_routing_history'\) <> 3 THEN/);
      for (const name of CAPTURED_POLICIES) expect(guard).toContain(`pg_policies.policyname = '${name}'`);
      expect((guard.match(/pg_policies\.roles = ARRAY\['public'\]::name\[\]/g) ?? []).length).toBe(3);
      expect((guard.match(/pg_policies\.permissive = 'PERMISSIVE'/g) ?? []).length).toBe(3);
      for (const cmd of ['ALL', 'INSERT', 'SELECT']) expect(guard).toContain(`pg_policies.cmd = '${cmd}'`);
      expect((guard.match(new RegExp(MD5_TRUE, 'g')) ?? []).length).toBe(3);
      expect(guard).toContain(`md5(pg_policies.qual) = '${MD5_OWNER_READ}'`);
      expect(guard).toContain('pg_policies.qual IS NULL');
      expect(guard).toContain('pg_policies.with_check IS NULL');
    });

    it('requires is_platform_admin to exist and be executable by authenticated (V-4)', () => {
      expect(guard).toContain("pg_proc.proname = 'is_platform_admin'");
      expect(guard).toContain("has_function_privilege('authenticated', pg_proc.oid, 'EXECUTE')");
    });

    it('applies the W-3 predicate: exactly one depth 1 pricing view, and the other names equal the capture', () => {
      expect(guard).toContain(PRICING_PREDICATE);
      expect(guard).toContain('dependent_views.view_depth = 1');
      expect(guard).toContain('guard_pricing_view_count <> 1');
      expect(guard).toContain(
        `IS DISTINCT FROM ARRAY[${CAPTURED_VIEWS.map((view) => `'public ${view}'`).join(', ')}]::text[]`
      );
    });

    it('every message says nothing was applied', () => {
      const messages = [...guard.matchAll(/MESSAGE = '([^']*)'/g)].map((m) => m[1]);
      expect(messages.length).toBeGreaterThanOrEqual(9);
      for (const message of messages) expect(message.trimEnd().endsWith('so nothing was applied')).toBe(true);
    });
  });

  describe('the post-assert re-reads the end state', () => {
    const post = statements[statements.length - 2];

    it('checks RLS on and not forced, one admin policy for authenticated calling is_platform_admin', () => {
      expect(post).toContain('pg_class.relrowsecurity AND NOT pg_class.relforcerowsecurity');
      expect(post).toMatch(/AND pg_policies\.tablename = 'pilot_step_routing_history'\) <> 1 THEN/);
      expect(post).toContain("pg_policies.roles = ARRAY['authenticated']::name[]");
      expect(post).toContain("strpos(pg_policies.qual, 'is_platform_admin') > 0");
    });

    it('checks all eight privileges for anon, authenticated and service_role, PUBLIC, column privileges and postgres DELETE', () => {
      expect(post).toContain(`ARRAY[${ALL_PRIVILEGES.map((p) => `'${p}'`).join(', ')}]`);
      expect(post).toContain("has_table_privilege('anon', check_table_oid, check_privilege)");
      expect(post).toContain("has_table_privilege('authenticated', check_table_oid, check_privilege) <> (check_privilege = 'SELECT')");
      expect(post).toContain("has_table_privilege('service_role', check_table_oid, check_privilege) <> (check_privilege = 'SELECT')");
      expect(post).toContain('acl_item.grantee = 0');
      expect(post).toContain('pg_attribute.attacl IS NOT NULL');
      expect(post).toContain("has_table_privilege('postgres', check_table_oid, 'DELETE')");
    });

    it('checks the captured views are closed to the client roles and service_role keeps SELECT (W-2: not SELECT only)', () => {
      expect(post).toContain(`ARRAY[${CAPTURED_VIEWS.map((view) => `'${view}'`).join(', ')}]`);
      expect(post).toContain("has_table_privilege('service_role', check_view_oid, 'SELECT')");
      expect(post).not.toMatch(/service_role', check_view_oid, check_privilege/);
    });

    it('re-applies the W-3 predicate', () => {
      expect(post).toContain(PRICING_PREDICATE);
      expect(post).toContain('check_pricing_view_count <> 1');
    });

    it('every message says nothing was applied', () => {
      for (const message of [...post.matchAll(/MESSAGE = '([^']*)'/g)].map((m) => m[1])) {
        expect(message.trimEnd().endsWith('so nothing was applied')).toBe(true);
      }
    });
  });
});

describe('the rollback (C-7 scoped down, W-2, W-6, S-4)', () => {
  const statements = topLevelStatements(rollback);

  it('is BEGIN, SET LOCAL lock_timeout, guard DO, two DDL statements, post DO, COMMIT', () => {
    expect(statements[0]).toBe('BEGIN');
    expect(statements[1]).toBe("SET LOCAL lock_timeout = '5s'");
    expect(isDo(statements[2])).toBe(true);
    expect(statements.slice(3, -2)).toEqual(EXPECTED_ROLLBACK_DDL);
    expect(isDo(statements[statements.length - 2])).toBe(true);
    expect(statements[statements.length - 1]).toBe('COMMIT');
  });

  it('has no violation: no client grant, no policy, no view statement, no true policy', () => {
    expect(rollbackViolations(rollback)).toEqual([]);
  });

  it('refuses unless the admin policy is the only policy (W-6) and the owner is postgres', () => {
    const guard = statements[2];
    expect(guard).toMatch(/AND pg_policies\.tablename = 'pilot_step_routing_history'\) <> 1 THEN/);
    expect(guard).toContain("pg_policies.policyname = 'pilot_step_routing_history_admin_select'");
    expect(guard).toContain("IS DISTINCT FROM 'postgres'");
  });

  it('post-asserts no policy left, RLS on, anon and PUBLIC hold nothing, service_role restored (W-6, S-4)', () => {
    const post = statements[statements.length - 2];
    expect(post).toMatch(/AND pg_policies\.tablename = 'pilot_step_routing_history'\) <> 0 THEN/);
    expect(post).toContain('pg_class.relrowsecurity');
    expect(post).toContain("has_table_privilege('anon', check_table_oid, check_privilege)");
    expect(post).toContain("NOT has_table_privilege('service_role', check_table_oid, check_privilege)");
    expect(post).toContain('acl_item.grantee = 0');
    for (const message of [...rollback.matchAll(/MESSAGE = '([^']*)'/g)].map((m) => m[1])) {
      expect(message.trimEnd().endsWith('so nothing was restored')).toBe(true);
    }
  });
});

describe('the checker (C-5, W-2, W-3)', () => {
  it('reports a VERDICT row first that fails on any FAIL and ignores INFO', () => {
    expect(checker).toContain("'VERDICT' AS check_name");
    expect(checker).toContain("CASE WHEN EXISTS (SELECT 1 FROM checks WHERE checks.result = 'FAIL') THEN 'FAIL' ELSE 'PASS' END");
    expect(checker).toContain('ORDER BY report.sort_order');
  });

  it('checks every privilege for anon, authenticated and service_role, with SELECT kept only for the last two', () => {
    for (const privilege of ALL_PRIVILEGES) expect(checker).toContain(`('${privilege}'`);
    expect(checker).toContain("('anon', 1, 'C7', false)");
    expect(checker).toContain("('authenticated', 2, 'C8', true)");
    expect(checker).toContain("('service_role', 3, 'C9', true)");
  });

  it('carries C1 to C16 and the slice-2 view as INFO only', () => {
    for (const code of ['C1 ', 'C2 ', 'C3 ', 'C4 ', 'C5 ', 'C6 ', 'C10 ', 'C11 ', 'C12 ', 'C13 ', 'C14 ', 'C15 ', 'C16 ']) {
      expect(checker).toContain(`'${code}`);
    }
    expect(checker).toContain("'INFO slice 2 view pilot_cost_savings_summary',\n         'INFO'");
    expect(checker).toContain("has_table_privilege('postgres', (SELECT target_table.table_oid FROM target_table), 'DELETE')");
    expect(checker).toContain('pg_proc.prosecdef');
  });

  it('uses the same W-3 predicate as the migration, the captured view set, and names the excluded view in C16', () => {
    expect(collapse(checker)).toContain(PRICING_PREDICATE);
    expect(checker).toContain(`ARRAY[${CAPTURED_VIEWS.map((view) => `'public ${view}'`).join(', ')}]::text[]`);
    expect(checker).toContain(`ARRAY['${SLICE_TWO_VIEW}']::text[]`);
  });

  it('asserts service_role SELECT on the views, not SELECT only (W-2)', () => {
    expect(checker).toContain("has_table_privilege('service_role', captured_view_state.view_oid, 'SELECT')");
  });
});

describe('the pre-check captures what C-4 asks for', () => {
  it('has every row group', () => {
    for (const marker of ["'Q1 table", "'Q2 table acl raw'", "'Q3 table grants '", "'Q4 column privileges count'", "'Q5 policy count'", "'Q6 foreign key count'", "'Q7 dependent view count'", "'Q8 cleanup function count'", "'Q9 rows total'", "'Q10 server version num'"]) {
      expect(precheck).toContain(marker);
    }
    expect(precheck).toContain('relispopulated');
    expect(precheck).toContain('make_date(2025, 11, 12)');
  });
});

describe('mutation self-tests (AC-9): the finders catch what they must', () => {
  it('an anon grant in the migration is caught', () => {
    const mutated = injectBeforeCommit(migration, `GRANT SELECT ON TABLE ${TABLE} TO anon;`);
    expect(migrationViolations(mutated)).not.toEqual([]);
  });

  it('a true policy in the migration is caught', () => {
    const mutated = injectBeforeCommit(migration, `CREATE POLICY reopened ON ${TABLE} FOR SELECT USING (true);`);
    expect(migrationViolations(mutated)).not.toEqual([]);
  });

  it('a wider service_role grant in the migration is caught', () => {
    const mutated = migration.replace(
      `GRANT SELECT ON TABLE ${TABLE} TO service_role;`,
      `GRANT SELECT, DELETE ON TABLE ${TABLE} TO service_role;`
    );
    expect(mutated).not.toBe(migration);
    expect(migrationViolations(mutated)).not.toEqual([]);
  });

  it('naming the slice-2 view in the migration is caught (C-6)', () => {
    const mutated = injectBeforeCommit(migration, `REVOKE ALL ON TABLE public.${SLICE_TWO_VIEW} FROM anon;`);
    expect(migrationViolations(mutated)).not.toEqual([]);
  });

  it('an authenticated grant in the rollback is caught', () => {
    const mutated = injectBeforeCommit(rollback, `GRANT SELECT ON TABLE ${TABLE} TO authenticated;`);
    expect(rollbackViolations(mutated)).not.toEqual([]);
  });

  it('a recreated true policy in the rollback is caught', () => {
    const mutated = injectBeforeCommit(
      rollback,
      `CREATE POLICY "Service role can access all routing history" ON ${TABLE} USING (true) WITH CHECK (true);`
    );
    expect(rollbackViolations(mutated)).not.toEqual([]);
  });

  it('a view statement in the rollback is caught (W-2)', () => {
    const mutated = injectBeforeCommit(rollback, `GRANT ALL ON TABLE public.${CAPTURED_VIEWS[0]} TO service_role;`);
    expect(rollbackViolations(mutated)).not.toEqual([]);
  });
});
