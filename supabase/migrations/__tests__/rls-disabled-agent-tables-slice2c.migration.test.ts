/**
 * Guard over slice 2c-2: migration 20261062 (row security plus owner policies
 * on the six agent-platform tables), its rollback, pre-check and checker, and
 * the D-0b data fix pair that re-owns the one agent_stats row.
 *
 * Spec: "Re-scope after the user's decisions (2026-10-14)" in
 * docs/workplans/RLS_DISABLED_TABLES_SLICE2C_WORKPLAN.md. In short:
 *   - the four agent tables get RLS on (never forced), 12 owner policies
 *     TO authenticated (select / insert / update, with the C-4 agent ownership
 *     check in WITH CHECK), and authenticated keeps SELECT, INSERT, UPDATE only;
 *   - the two sharing tables get RLS on, no policy and no client grant at all
 *     (service role only, R-5);
 *   - no SECURITY DEFINER anywhere (T-1 is dropped, R-6);
 *   - the pre-guard pins the post-stopgap state and the S-4 owner-mismatch pin
 *     (agent_configurations 3, agent_executions 11, agent_stats 0 after D-0b).
 *
 * WHY A TEST OVER SQL TEXT: there is no branch database. Every file is pasted
 * into the Supabase SQL editor by hand, so the paste rules are pinned here,
 * and the PGlite dry run recorded in the workplan proves the behaviour.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const MIGRATION = join(ROOT, 'supabase', 'migrations', '20261062_rls_disabled_agent_tables_slice2c_owner_policies.sql');
const ROLLBACK = join(ROOT, 'supabase', 'SQL Scripts', '20261062_rls_disabled_agent_tables_slice2c_owner_policies_rollback.sql');
const PRECHECK = join(ROOT, 'scripts', 'precheck-rls-disabled-agent-tables-slice2c.sql');
const CHECKER = join(ROOT, 'scripts', 'check-rls-disabled-agent-tables-slice2c-migration.sql');
const D0B = join(ROOT, 'scripts', 'data-fix-rls-2c-agent-stats-reown.sql');
const D0B_REVERSE = join(ROOT, 'scripts', 'data-fix-rls-2c-agent-stats-reown_reverse.sql');
const WORKPLAN = join(ROOT, 'docs', 'workplans', 'RLS_DISABLED_TABLES_SLICE2C_WORKPLAN.md');

const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const migration = read(MIGRATION);
const rollback = read(ROLLBACK);
const precheck = read(PRECHECK);
const checker = read(CHECKER);
const d0b = read(D0B);
const d0bReverse = read(D0B_REVERSE);

const OWNER_TABLES = ['agent_configurations', 'agent_executions', 'agent_logs', 'agent_stats'];
const SHARING_TABLES = ['shared_agents', 'shared_agent_imports'];
const SIX = [...OWNER_TABLES, ...SHARING_TABLES];
const EIGHT = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'];

/** Prod facts from RLS_DISABLED_TABLES_SLICE2C_PROD_CAPTURE_2026-10-14.md. */
const PIN = {
  configurations: 'b31a2dae58f839b033bbc32195c7ccb8',
  executions: '23439f4752cdf8364e0eeb43a04fc2ba',
  statsAgent: '2a4cf06b64f83d1f077506323dad7d7d',
  agentsPolicy: '19300d155780585259ede73ac370586c',
  routingPolicy: '97a65517eb8b8a5ca555fdd3dd99efcc',
};

const ALL_FILES: Array<[string, string]> = [
  ['migration', MIGRATION],
  ['rollback', ROLLBACK],
  ['precheck', PRECHECK],
  ['checker', CHECKER],
  ['d0b', D0B],
  ['d0b reverse', D0B_REVERSE],
];

// ---------------------------------------------------------------- helpers

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
    .map((s) => s.replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').trim())
    .filter(Boolean);
}

/** Every string_agg(...) call with balanced parentheses. */
function stringAggCalls(sql: string): string[] {
  const calls: string[] = [];
  let from = 0;
  for (;;) {
    const start = sql.indexOf('string_agg(', from);
    if (start < 0) return calls;
    let depth = 0;
    let end = start + 'string_agg'.length;
    for (; end < sql.length; end++) {
      if (sql[end] === '(') depth++;
      if (sql[end] === ')') depth--;
      if (depth === 0) break;
    }
    calls.push(sql.slice(start, end + 1));
    from = end + 1;
  }
}

/**
 * The SQL-editor paste rules (C-10). Returns the broken rules, so the
 * mutation self-tests can prove each rule bites.
 */
function pasteViolations(sql: string): string[] {
  const broken: string[] = [];
  if (sql.includes('--')) broken.push('line comment');
  if (sql.includes('/*')) broken.push('block comment');
  // The Supabase SQL editor misreads the word "into" even inside a literal or
  // an identifier (2026-10-04). Banned as a substring, in any case.
  if (/into/i.test(sql)) broken.push('into');
  if ((sql.match(/'/g) ?? []).length % 2 !== 0) broken.push('odd quotes');
  if (literalsOf(sql).some((literal) => !/^[A-Za-z0-9_ ]*$/.test(literal))) broken.push('literal');
  if (/\bAS [a-z]\b/i.test(sql)) broken.push('single letter alias');
  if (/\bI?LIKE\b/i.test(sql)) broken.push('like');
  if (stringAggCalls(sql).some((call) => !/ORDER BY [\w.:]+ COLLATE "C"\)$/.test(call))) broken.push('string_agg collate');
  // Uuids are written as 32 hex digits without hyphens (SA, S-2).
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i.test(sql)) broken.push('hyphenated uuid');
  if (/FORCE\s+ROW\s+LEVEL\s+SECURITY/i.test(sql)) broken.push('force');
  // The slice 6 SECDEF guard flags the phrase even inside a string.
  if (/SECURITY\s+DEFINER/i.test(sql)) broken.push('security definer');
  return broken;
}

const ownerCheck = (table: string) =>
  `((SELECT auth.uid()) = user_id AND EXISTS (SELECT 1 FROM public.agents AS owned_agent ` +
  `WHERE owned_agent.id = ${table}.agent_id AND owned_agent.user_id = (SELECT auth.uid())))`;

/** The exact top-level statements of the migration for one table, in order. */
function migrationStatementsFor(table: string): string[] {
  if (SHARING_TABLES.includes(table)) {
    return [
      `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`,
      `REVOKE ALL ON TABLE public.${table} FROM PUBLIC, anon, authenticated`,
    ];
  }
  return [
    `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`,
    `REVOKE ALL ON TABLE public.${table} FROM PUBLIC, anon, authenticated`,
    `GRANT SELECT, INSERT, UPDATE ON TABLE public.${table} TO authenticated`,
    `CREATE POLICY ${table}_owner_select ON public.${table} AS PERMISSIVE FOR SELECT TO authenticated ` +
      `USING ((SELECT auth.uid()) = user_id)`,
    `CREATE POLICY ${table}_owner_insert ON public.${table} AS PERMISSIVE FOR INSERT TO authenticated ` +
      `WITH CHECK ${ownerCheck(table)}`,
    `CREATE POLICY ${table}_owner_update ON public.${table} AS PERMISSIVE FOR UPDATE TO authenticated ` +
      `USING ((SELECT auth.uid()) = user_id) WITH CHECK ${ownerCheck(table)}`,
  ];
}

/** Derive the rollback for one table from the migration's own statements. */
function inverseOf(table: string, forward: string[]): string[] {
  const drops = forward
    .map((statement) => statement.match(/^CREATE POLICY (\w+) ON (public\.\w+)/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => `DROP POLICY ${match[1]} ON ${match[2]}`)
    .reverse();
  expect(forward[0]).toBe(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
  return [
    ...drops,
    `REVOKE ALL ON TABLE public.${table} FROM PUBLIC, anon, authenticated`,
    // The post-stopgap grant for authenticated (20261060 post-assert).
    `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.${table} TO authenticated`,
    `ALTER TABLE public.${table} DISABLE ROW LEVEL SECURITY`,
  ];
}

function arrayLiterals(block: string, variable: string): string[][] {
  return [...block.matchAll(new RegExp(`FOREACH ${variable} IN ARRAY ARRAY\\[([\\s\\S]*?)\\]\\s+LOOP`, 'g'))].map(
    (match) => literalsOf(match[1])
  );
}

// ---------------------------------------------------------------- paste rules

describe('SQL-editor safety (all six files are pasted by hand)', () => {
  it.each(ALL_FILES)('%s exists', (_name, file) => {
    expect(existsSync(file)).toBe(true);
  });

  it.each(ALL_FILES)('%s breaks no paste rule and never says SECURITY DEFINER or FORCE', (_name, file) => {
    expect(pasteViolations(read(file))).toEqual([]);
  });

  it.each(ALL_FILES)('%s names no public object outside the six tables and agents', (_name, file) => {
    const named = new Set([...read(file).matchAll(/\bpublic\.(\w+)/g)].map((match) => match[1]));
    for (const name of named) expect([...SIX, 'agents']).toContain(name);
  });

  it.each(ALL_FILES)('%s creates, drops or alters no function, view, trigger or sequence', (_name, file) => {
    expect(read(file)).not.toMatch(/\b(CREATE|DROP|ALTER)\s+(OR\s+REPLACE\s+)?(FUNCTION|VIEW|TRIGGER|SEQUENCE)\b/i);
  });

  it('the only objects outside the six that the files read are the pinned boundary objects', () => {
    const allowed = ['agents', 'execution_routing_decisions', 'agent_executions_with_details'];
    for (const [, file] of ALL_FILES) {
      for (const literal of literalsOf(read(file))) {
        if (/^(agents|execution_routing_decisions|agent_executions_with_details)$/.test(literal)) {
          expect(allowed).toContain(literal);
        }
      }
    }
  });
});

describe('mutation self-tests: each paste rule bites', () => {
  const clean = migration;
  it.each([
    ['line comment', `${clean}\n-- note`],
    ['block comment', `${clean}\n/* note */`],
    ['into', clean.replace('SELECT 1 FROM public.agents', 'SELECT 1 FROM public.agents_into')],
    ['odd quotes', `${clean}\n'`],
    ['literal', clean.replace("'5s'", "'5 s.'")],
    ['single letter alias', clean.replace('AS owned_agent', 'AS a')],
    ['like', `${clean}\nSELECT 1 WHERE 'x' LIKE 'y';`],
    ['string_agg collate', clean.replace('ORDER BY pin_row.id::text COLLATE "C")', 'ORDER BY pin_row.id::text)')],
    ['hyphenated uuid', `${clean}\nSELECT '11111111-1111-1111-1111-111111111111';`],
    ['force', clean.replace('ENABLE ROW LEVEL SECURITY', 'FORCE ROW LEVEL SECURITY')],
    ['security definer', `${clean}\nSELECT 'SECURITY DEFINER';`],
  ])('%s', (rule, mutated) => {
    expect(pasteViolations(mutated)).toContain(rule);
  });

  it('the inverse derivation notices a missing or extra policy', () => {
    const forward = migrationStatementsFor('agent_logs');
    expect(inverseOf('agent_logs', forward.slice(0, -1))).not.toEqual(inverseOf('agent_logs', forward));
    expect(
      inverseOf('agent_logs', [...forward, 'CREATE POLICY stray ON public.agent_logs AS PERMISSIVE FOR SELECT TO authenticated USING (true)'])
    ).not.toEqual(inverseOf('agent_logs', forward));
  });
});

// ---------------------------------------------------------------- migration

describe('the migration', () => {
  const blocks = doBlocksOf(migration);
  const statements = statementsOf(withoutDoBlocks(migration));

  it('is one BEGIN ... COMMIT with a 5 s lock timeout, a pre-guard and a post-assert', () => {
    expect(statements[0]).toBe('BEGIN');
    expect(statements[1]).toBe("SET LOCAL lock_timeout = '5s'");
    expect(statements[statements.length - 1]).toBe('COMMIT');
    expect(statements.filter((s) => s === 'BEGIN' || s === 'COMMIT')).toHaveLength(2);
    expect(blocks).toHaveLength(2);
    expect(migration.indexOf(blocks[0])).toBeLessThan(migration.indexOf('ALTER TABLE'));
    expect(migration.indexOf(blocks[1])).toBeGreaterThan(migration.lastIndexOf('REVOKE ALL ON TABLE'));
    expect(migration.indexOf(blocks[1])).toBeGreaterThan(migration.lastIndexOf('CREATE POLICY'));
  });

  it('runs exactly the planned DDL, table by table, in order', () => {
    expect(statements.slice(2, -1)).toEqual(SIX.flatMap(migrationStatementsFor));
  });

  it('has exactly 12 policies, all PERMISSIVE TO authenticated, none for DELETE or ALL, none on a sharing table', () => {
    const policies = statements.filter((s) => s.startsWith('CREATE POLICY'));
    expect(policies).toHaveLength(12);
    for (const policy of policies) {
      expect(policy).toMatch(/ AS PERMISSIVE FOR (SELECT|INSERT|UPDATE) TO authenticated /);
    }
    expect(migration).not.toMatch(/FOR (DELETE|ALL)\b/);
    for (const table of SHARING_TABLES) {
      expect(policies.some((p) => p.includes(` ON public.${table} `))).toBe(false);
    }
  });

  it('qualifies the agent column inside every EXISTS with its own table name (D-1)', () => {
    for (const table of OWNER_TABLES) {
      const exists = [...migration.matchAll(new RegExp(`WHERE owned_agent\\.id = (\\w+)\\.agent_id`, 'g'))].map((m) => m[1]);
      expect(exists.filter((name) => name === table)).toHaveLength(2);
    }
  });

  it('grants only SELECT, INSERT, UPDATE to authenticated on the four agent tables, and nothing to anon or PUBLIC', () => {
    const grants = statements.filter((s) => s.startsWith('GRANT'));
    expect(grants).toEqual(OWNER_TABLES.map((t) => `GRANT SELECT, INSERT, UPDATE ON TABLE public.${t} TO authenticated`));
    expect(migration).not.toMatch(/\bTO (anon|PUBLIC)\b/);
    expect(withoutDoBlocks(migration)).not.toMatch(/service_role/);
  });

  it('the pre-guard refuses on anything but the post-stopgap state', () => {
    const guard = blocks[0];
    expect(arrayLiterals(guard, 'guard_table_name')[0]).toEqual(SIX);
    expect(guard).toMatch(/IF guard_table_oid IS NULL THEN\s+RAISE EXCEPTION/);
    expect(guard).toMatch(/IS DISTINCT FROM 'postgres' THEN\s+RAISE EXCEPTION/);
    expect(guard).toMatch(/pg_class\.relrowsecurity FROM [\s\S]*?\) THEN\s+RAISE EXCEPTION/);
    expect(guard).toMatch(/pg_class\.relforcerowsecurity FROM [\s\S]*?\) THEN\s+RAISE EXCEPTION/);
    expect(guard).toMatch(/WHERE pg_policy\.polrelid = guard_table_oid\s+\) THEN\s+RAISE EXCEPTION/);
    expect(guard).toMatch(/pg_attribute\.attacl IS NOT NULL\s+\) THEN\s+RAISE EXCEPTION/);
    expect(guard).toMatch(/sequence_class\.relkind = 'S'[\s\S]*?\) THEN\s+RAISE EXCEPTION/);
    const roles = arrayLiterals(guard, 'guard_role');
    expect(roles[0]).toEqual(['public', 'anon']);
    const privileges = arrayLiterals(guard, 'guard_privilege');
    expect(privileges).toEqual([EIGHT, ['SELECT', 'INSERT', 'UPDATE', 'DELETE'], ['TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']]);
    expect(guard).toMatch(/IF pg_catalog\.has_table_privilege\(guard_role, guard_table_oid, guard_privilege\) THEN\s+RAISE EXCEPTION/);
    expect(guard).toMatch(/IF NOT pg_catalog\.has_table_privilege\('authenticated', guard_table_oid, guard_privilege\) THEN\s+RAISE EXCEPTION/);
    expect(guard).toMatch(/IF NOT pg_catalog\.has_table_privilege\('service_role', guard_table_oid, guard_privilege\) THEN\s+RAISE EXCEPTION/);
    expect(guard).toMatch(/IF pg_catalog\.has_table_privilege\('authenticated', guard_table_oid, guard_privilege\) THEN\s+RAISE EXCEPTION/);
  });

  it('the pre-guard pins the agents policies, the routing decisions policy and the 1b view', () => {
    const guard = blocks[0];
    expect(guard).toMatch(/pg_policies\.tablename = 'agents'\) <> 3 THEN\s+RAISE EXCEPTION/);
    for (const name of ['Allow read access to own agents', 'Allow user access to own agents', 'Users can view their own agents']) {
      expect(guard).toContain(`pg_policies.policyname = '${name}'`);
    }
    expect(guard.split(`'${PIN.agentsPolicy}'`).length - 1).toBe(4);
    expect(guard).toContain("pg_policies.policyname = 'Users can view their execution routing decisions'");
    expect(guard).toContain(`md5(pg_policies.qual) = '${PIN.routingPolicy}'`);
    expect(guard).toContain("view_option.option_name = 'security_invoker'");
    expect(arrayLiterals(guard, 'guard_role')[1]).toEqual(['public', 'anon', 'authenticated']);
  });

  // S-4 and S-1: the documented exception rows are pinned by count and id-set
  // md5, with the capture's formula (comma separator, sorted ids).
  it('the pre-guard carries the S-4 owner-mismatch pin for all six tables', () => {
    const guard = blocks[0];
    expect(guard).toContain(`WHEN 'agent_configurations' THEN 3`);
    expect(guard).toContain(`WHEN 'agent_executions' THEN 11`);
    expect(guard).toContain(`WHEN 'agent_configurations' THEN '${PIN.configurations}'`);
    expect(guard).toContain(`WHEN 'agent_executions' THEN '${PIN.executions}'`);
    expect(guard).toMatch(/ELSE 0\s+END;/);
    expect(guard).toMatch(/IF guard_pin\.mismatch_total <> guard_expected_total THEN\s+RAISE EXCEPTION/);
    expect(guard).toMatch(/IF guard_pin\.mismatch_md5 IS DISTINCT FROM guard_expected_md5 THEN\s+RAISE EXCEPTION/);
    expect(guard).toMatch(/guard_pin\.null_agent_total <> 0 OR guard_pin\.agent_missing_total <> 0 OR guard_pin\.null_user_total <> 0 THEN\s+RAISE EXCEPTION/);
    expect(guard).toMatch(/IF guard_pin_total <> 6 THEN\s+RAISE EXCEPTION/);
    for (const table of SIX) expect(guard).toContain(`FROM public.${table} AS pin_row`);
    expect(guard).toContain('string_agg(pin_row.agent_id::text, chr(44) ORDER BY pin_row.agent_id::text COLLATE "C")');
    expect(guard).toContain('pin_agent.user_id IS DISTINCT FROM pin_row.imported_by_user_id');
    expect(guard).toContain('pin_agent.id = pin_row.original_agent_id');
    expect(guard).toContain('pin_agent.id = pin_row.created_agent_id');
  });

  it('the post-assert checks RLS on and not forced, the exact grants, the policy set and the pin again', () => {
    const post = blocks[1];
    expect(arrayLiterals(post, 'check_table_name')[0]).toEqual(SIX);
    expect(post).toMatch(/IF NOT \(SELECT pg_class\.relrowsecurity [\s\S]*?\) THEN\s+RAISE EXCEPTION/);
    expect(post).toMatch(/pg_class\.relforcerowsecurity FROM [\s\S]*?\) THEN\s+RAISE EXCEPTION/);
    expect(arrayLiterals(post, 'check_privilege')).toEqual([
      EIGHT,
      ['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'],
      ['SELECT', 'INSERT', 'UPDATE'],
      ['DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'],
      ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
    ]);
    expect(post).toContain("check_is_owner_table := check_table_name IN ('agent_configurations', 'agent_executions', 'agent_logs', 'agent_stats')");
    expect(post).toMatch(/has_table_privilege\('authenticated', check_table_oid, check_privilege\) IS DISTINCT FROM check_is_owner_table THEN\s+RAISE EXCEPTION/);
    expect(post).toMatch(/IF NOT pg_catalog\.has_table_privilege\('service_role', check_table_oid, check_privilege\) THEN\s+RAISE EXCEPTION/);
    expect(post).toContain('check_expected_total := CASE WHEN check_is_owner_table THEN 3 ELSE 0 END;');
    expect(post).toContain("pg_policies.roles = ARRAY['authenticated']::name[]");
    for (const suffix of ['_owner_select', '_owner_insert', '_owner_update']) {
      expect(post).toContain(`pg_policies.policyname = check_table_name || '${suffix}'`);
    }
    expect(post).toContain(`WHEN 'agent_configurations' THEN '${PIN.configurations}'`);
    expect(post).toContain(`WHEN 'agent_executions' THEN '${PIN.executions}'`);
    expect(post).toMatch(/IF check_pin_total <> 3 THEN\s+RAISE EXCEPTION/);
  });

  // plpgsql reads an IF condition up to the first THEN, so a CASE inside one
  // is a syntax error at apply time. Found by the PGlite dry run.
  it.each([
    ['migration', migration],
    ['rollback', rollback],
    ['d0b', d0b],
    ['d0b reverse', d0bReverse],
  ])('%s never puts a CASE inside an IF condition', (_name, sql) => {
    const conditions = [...sql.matchAll(/^\s*(?:ELS)?IF\b([\s\S]*?)\bTHEN\b/gm)].map((match) => match[1]);
    expect(conditions.length).toBeGreaterThan(0);
    for (const condition of conditions) expect(condition).not.toMatch(/\bCASE\b/);
    // Self-test: the rule sees a CASE inside an IF.
    const mutated = 'BEGIN\n  IF x <> CASE y WHEN 1 THEN 2 END THEN\n    RAISE;\n  END IF;';
    expect([...mutated.matchAll(/^\s*(?:ELS)?IF\b([\s\S]*?)\bTHEN\b/gm)][0][1]).toMatch(/\bCASE\b/);
  });

  it('every exception says nothing was applied', () => {
    for (const sql of [migration, rollback, d0b, d0bReverse]) {
      const raises = [...sql.matchAll(/RAISE EXCEPTION USING MESSAGE = ([^;]*);/g)].map((match) => match[1]);
      expect(raises.length).toBeGreaterThan(0);
      for (const raise of raises) expect(raise).toMatch(/so nothing was applied/);
    }
  });
});

// ---------------------------------------------------------------- rollback

describe('the rollback is the exact inverse, back to the post-stopgap state', () => {
  const blocks = doBlocksOf(rollback);
  const statements = statementsOf(withoutDoBlocks(rollback));
  const forward = statementsOf(withoutDoBlocks(migration));

  it('starts with the warning, then one BEGIN ... COMMIT with a lock timeout and two DO blocks', () => {
    expect(statements[0]).toMatch(/^SELECT 'WARNING this rollback reopens .* explicit authorization of the user' AS read_me_first$/);
    expect(statements[1]).toBe('BEGIN');
    expect(statements[2]).toBe("SET LOCAL lock_timeout = '5s'");
    expect(statements[statements.length - 1]).toBe('COMMIT');
    expect(blocks).toHaveLength(2);
    expect(rollback.indexOf(blocks[0])).toBeLessThan(rollback.indexOf('DROP POLICY'));
    expect(rollback.indexOf(blocks[1])).toBeGreaterThan(rollback.lastIndexOf('DISABLE ROW LEVEL SECURITY'));
  });

  it('per table, undoes exactly what the migration did', () => {
    const expected = SIX.flatMap((table) =>
      inverseOf(table, forward.filter((s) => s.includes(` public.${table} `) || s.endsWith(` public.${table}`)))
    );
    expect(statements.slice(3, -1)).toEqual(expected);
  });

  it('drops exactly the 12 policies the migration creates, by name', () => {
    const created = [...migration.matchAll(/CREATE POLICY (\w+) ON (public\.\w+)/g)].map((m) => `${m[1]} ${m[2]}`).sort();
    const dropped = [...rollback.matchAll(/DROP POLICY (\w+) ON (public\.\w+)/g)].map((m) => `${m[1]} ${m[2]}`).sort();
    expect(dropped).toHaveLength(12);
    expect(dropped).toEqual(created);
    // No IF EXISTS: a missing policy must fail the rollback, not be skipped.
    expect(rollback).not.toMatch(/DROP POLICY IF EXISTS/);
  });

  it('never grants anon or PUBLIC, never names service_role outside the asserts, and does not undo D-0b', () => {
    expect(rollback).not.toMatch(/\bTO (anon|PUBLIC)\b/);
    expect(withoutDoBlocks(rollback)).not.toMatch(/service_role/);
    expect(rollback).not.toMatch(/\bUPDATE public\./);
  });

  it('the pre-guard refuses unless the migration is in place', () => {
    const guard = blocks[0];
    expect(arrayLiterals(guard, 'guard_table_name')[0]).toEqual(SIX);
    expect(guard).toMatch(/IF NOT \(SELECT pg_class\.relrowsecurity [\s\S]*?\) THEN\s+RAISE EXCEPTION/);
    expect(guard).toContain("guard_expected_total := CASE WHEN guard_table_name IN ('agent_configurations', 'agent_executions', 'agent_logs', 'agent_stats') THEN 3 ELSE 0 END;");
  });

  it('the final DO asserts the 20261060 stopgap state', () => {
    const post = blocks[1];
    expect(arrayLiterals(post, 'check_table_name')[0]).toEqual(SIX);
    expect(post).toMatch(/pg_class\.relrowsecurity FROM [\s\S]*?\) THEN\s+RAISE EXCEPTION/);
    expect(post).toMatch(/pg_class\.relforcerowsecurity FROM [\s\S]*?\) THEN\s+RAISE EXCEPTION/);
    expect(post).toMatch(/IF EXISTS \(SELECT 1 FROM pg_catalog\.pg_policy WHERE pg_policy\.polrelid = check_table_oid\) THEN\s+RAISE EXCEPTION/);
    expect(arrayLiterals(post, 'check_role')).toEqual([['public', 'anon']]);
    expect(arrayLiterals(post, 'check_privilege')).toEqual([
      EIGHT,
      ['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'],
      ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
      ['TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'],
    ]);
    expect(post).toMatch(/IF NOT pg_catalog\.has_table_privilege\('authenticated', check_table_oid, check_privilege\) THEN\s+RAISE EXCEPTION/);
    expect(post).toMatch(/IF NOT pg_catalog\.has_table_privilege\('service_role', check_table_oid, check_privilege\) THEN\s+RAISE EXCEPTION/);
    expect(post).toMatch(/IF pg_catalog\.has_table_privilege\('authenticated', check_table_oid, check_privilege\) THEN\s+RAISE EXCEPTION/);
    expect(post).toMatch(/pg_attribute\.attacl IS NOT NULL\s+\) THEN\s+RAISE EXCEPTION/);
  });
});

// ---------------------------------------------------------------- D-0b pair

describe('the D-0b data fix and its reverse', () => {
  const pinValues = (sql: string) => ({
    agent: sql.match(/pin_agent_hex text := '(\w+)';/)?.[1],
    oldUser: sql.match(/pin_old_user_hex text := '(\w+)';/)?.[1],
    newOwner: sql.match(/pin_new_owner_hex text := '(\w+)';/)?.[1],
  });

  it.each([
    ['d0b', d0b],
    ['d0b reverse', d0bReverse],
  ])('%s is one transaction with a lock timeout, one DO block, and a read-only SELECT after COMMIT', (_name, sql) => {
    const statements = statementsOf(withoutDoBlocks(sql));
    expect(statements[0]).toBe('BEGIN');
    expect(statements[1]).toBe("SET LOCAL lock_timeout = '5s'");
    expect(statements[2]).toBe('COMMIT');
    expect(statements[3]).toMatch(/^SELECT 'D0b (reverse )?done' AS step,/);
    expect(statements).toHaveLength(4);
    expect(doBlocksOf(sql)).toHaveLength(1);
  });

  /**
   * SA ruling 2 / CR2-1: the repo is public, so the committed D-0b pair holds
   * only the FILL_* placeholders. They are filled in the SQL editor at paste
   * time and never saved back. Returns the broken rules, so the self-test can
   * prove a filled copy fails.
   */
  type PlaceholderCounts = { FILL_AGENT_ID: number; FILL_OLD_USER_ID: number; FILL_NEW_OWNER_ID: number };
  function placeholderViolations(sql: string, expected: PlaceholderCounts): string[] {
    const broken: string[] = [];
    for (const [name, count] of Object.entries(expected)) {
      const found = (sql.match(new RegExp(`'${name}'`, 'g')) ?? []).length;
      if (found !== count) broken.push(`${name} ${found} of ${count}`);
    }
    if ((sql.match(/FILL_/g) ?? []).length !== 5) broken.push('placeholder total');
    const md5Pins = new Set(Object.values(PIN));
    for (const literal of literalsOf(sql)) {
      if (/^[0-9a-f]{32}$/i.test(literal) && !md5Pins.has(literal)) broken.push(`hex literal ${literal.slice(0, 4)}`);
    }
    return broken;
  }
  // DECLARE (3) + final SELECT: the agent in the WHERE, and the "before" user,
  // which is the old user going forward and the new owner in reverse.
  const FORWARD_COUNTS: PlaceholderCounts = { FILL_AGENT_ID: 2, FILL_OLD_USER_ID: 2, FILL_NEW_OWNER_ID: 1 };
  const REVERSE_COUNTS: PlaceholderCounts = { FILL_AGENT_ID: 2, FILL_OLD_USER_ID: 1, FILL_NEW_OWNER_ID: 2 };

  it.each([
    ['d0b', d0b, FORWARD_COUNTS],
    ['d0b reverse', d0bReverse, REVERSE_COUNTS],
  ])('%s holds exactly the five FILL placeholders and no real id (CR2-1)', (_name, sql, counts) => {
    expect(placeholderViolations(sql, counts)).toEqual([]);
    expect(pinValues(sql)).toEqual({ agent: 'FILL_AGENT_ID', oldUser: 'FILL_OLD_USER_ID', newOwner: 'FILL_NEW_OWNER_ID' });
  });

  it.each([
    ['agent filled', (sql: string) => sql.replace("'FILL_AGENT_ID'", "'ffffffff00000000000000000000000f'")],
    ['old user filled', (sql: string) => sql.replace("'FILL_OLD_USER_ID'", "'33333333333333333333333333333333'")],
    ['new owner filled', (sql: string) => sql.replace("'FILL_NEW_OWNER_ID'", "'44444444444444444444444444444444'")],
    ['all filled', (sql: string) =>
      sql
        .replaceAll("'FILL_AGENT_ID'", "'ffffffff00000000000000000000000f'")
        .replaceAll("'FILL_OLD_USER_ID'", "'33333333333333333333333333333333'")
        .replaceAll("'FILL_NEW_OWNER_ID'", "'44444444444444444444444444444444'")],
  ])('self-test: a filled copy fails the placeholder rule (%s)', (_label, fill) => {
    expect(placeholderViolations(fill(d0b), FORWARD_COUNTS)).not.toEqual([]);
    expect(placeholderViolations(fill(d0bReverse), REVERSE_COUNTS)).not.toEqual([]);
  });

  it.each([
    ['d0b', d0b],
    ['d0b reverse', d0bReverse],
  ])('%s validates the agent, the old user and the new owner at run time', (_name, sql) => {
    const pins = pinValues(sql);
    expect(sql).toMatch(/length\(pin_agent_hex\) <> 32 OR ltrim\(pin_agent_hex, '0123456789abcdef'\) <> ''/);
    expect(sql).toMatch(/length\(pin_old_user_hex\) <> 32 OR ltrim\(pin_old_user_hex, '0123456789abcdef'\) <> ''/);
    expect(sql).toMatch(/length\(pin_new_owner_hex\) <> 32 OR ltrim\(pin_new_owner_hex, '0123456789abcdef'\) <> ''/);
    expect(sql).toContain(`IF md5(pin_agent::text) IS DISTINCT FROM '${PIN.statsAgent}' THEN`);
    expect(sql).toMatch(/IF pin_old_user = pin_new_owner THEN\s+RAISE EXCEPTION/);
    expect(sql).toContain(`WHERE agent_stats.agent_id = '${pins.agent}'::uuid;`);
  });

  it('both files carry the same three pins', () => {
    expect(pinValues(d0bReverse)).toEqual(pinValues(d0b));
    expect(d0b).toContain(`'${pinValues(d0b).oldUser}' AS before_user_hex`);
    expect(d0bReverse).toContain(`'${pinValues(d0b).newOwner}' AS before_user_hex`);
  });

  it('the forward script moves exactly one agent_stats row from the old user to the agent owner', () => {
    const block = doBlocksOf(d0b)[0];
    const updates = [...block.matchAll(/UPDATE public\.(\w+)/g)].map((m) => m[1]);
    expect(updates).toEqual(['agent_stats']);
    expect(statementsOf(block).find((s) => s.startsWith('UPDATE'))).toBe(
      'UPDATE public.agent_stats SET user_id = pin_new_owner WHERE agent_stats.agent_id = pin_agent ' +
        'AND agent_stats.user_id = pin_old_user AND EXISTS (SELECT 1 FROM public.agents AS owned_agent ' +
        'WHERE owned_agent.id = agent_stats.agent_id AND owned_agent.user_id = pin_new_owner)'
    );
    expect(block).toMatch(/GET DIAGNOSTICS changed_rows = ROW_COUNT;\s+IF changed_rows <> 1 THEN\s+RAISE EXCEPTION/);
    expect(block).toContain('agent_stats mismatch count is not 1 before the change so nothing was applied');
    expect(block).toContain('agent_stats mismatch count is not 0 after the change so nothing was applied');
    expect(block).toContain(`IS DISTINCT FROM '${PIN.statsAgent}' THEN`);
  });

  it('the reverse script is the mirror image: owner back to the old user, same guards, D-0a pin restored', () => {
    const block = doBlocksOf(d0bReverse)[0];
    const updates = [...block.matchAll(/UPDATE public\.(\w+)/g)].map((m) => m[1]);
    expect(updates).toEqual(['agent_stats']);
    expect(statementsOf(block).find((s) => s.startsWith('UPDATE'))).toBe(
      'UPDATE public.agent_stats SET user_id = pin_old_user WHERE agent_stats.agent_id = pin_agent ' +
        'AND agent_stats.user_id = pin_new_owner AND EXISTS (SELECT 1 FROM public.agents AS owned_agent ' +
        'WHERE owned_agent.id = agent_stats.agent_id AND owned_agent.user_id = pin_new_owner)'
    );
    expect(block).toMatch(/GET DIAGNOSTICS changed_rows = ROW_COUNT;\s+IF changed_rows <> 1 THEN\s+RAISE EXCEPTION/);
    expect(block).toContain('agent_stats mismatch count is not 0 before the change so nothing was applied');
    expect(block).toContain('agent_stats mismatch count is not 1 after the change so nothing was applied');
    expect(block).toContain(`IS DISTINCT FROM '${PIN.statsAgent}' THEN`);
  });

  it('the pair is otherwise identical text', () => {
    const normalise = (sql: string) =>
      sql
        .replace(/D0b reverse/g, 'D0b')
        .replace(/pin_new_owner|pin_old_user/g, 'pin_user')
        .replace(/'FILL_(OLD_USER|NEW_OWNER)_ID'|'[0-9a-f]{32}' AS before_user_hex/g, "'USER'")
        .replace(/is not [01] (before|after)/g, 'is not N $1')
        .replace(/\) <> [01] THEN/g, ') <> N THEN')
        .replace(/\n  IF \(SELECT md5[\s\S]*?END IF;\n/g, '\n')
        .split('\n')
        .filter((line) => line.trim() !== '')
        .join('\n');
    expect(normalise(d0bReverse)).toBe(normalise(d0b));
  });
});

// ---------------------------------------------------------------- pre-check and checker

describe('the pre-check and the checker', () => {
  const writeKeywords = /\b(INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|ALTER|DROP|CREATE|LOCK)\b(?!')/;

  it('both are read-only from their first statement and write nothing', () => {
    for (const text of [checker, precheck]) {
      expect(statementsOf(text)[0]).toBe('SET default_transaction_read_only = on');
      expect(statementsOf(text)).toHaveLength(2);
      const unquoted = text.replace(/'[^']*'/g, "''");
      expect(unquoted).not.toMatch(writeKeywords);
      expect(text).not.toMatch(/\b(EXECUTE|DO \$\$)/);
    }
  });

  it('both list the six tables in order and carry the S-4 pin with the capture values', () => {
    for (const text of [checker, precheck]) {
      for (const [index, name] of SIX.entries()) expect(text).toMatch(new RegExp(`\\('${name}', ${index + 1}`));
      expect(text).toContain(`WHEN 'agent_configurations' THEN '${PIN.configurations}'`);
      expect(text).toContain(`WHEN 'agent_executions' THEN '${PIN.executions}'`);
      expect(text).toContain(`WHEN 'agent_configurations' THEN 3`);
      expect(text).toContain(`WHEN 'agent_executions' THEN 11`);
      expect(text).toContain(`'${PIN.routingPolicy}'`);
      expect(text).toContain(`'${PIN.agentsPolicy}'`);
      for (const table of SIX) expect(text).toContain(`FROM public.${table} AS pin_row`);
    }
  });

  it('the pre-check puts PRECHECK STATUS first and STOPs on every blocker, including a D-0a row not yet re-owned', () => {
    expect(precheck).toMatch(/SELECT 0 AS sort_order,\s+'PRECHECK STATUS' AS item/);
    expect(precheck).toContain("ELSE 'CLEAN run the migration in a NEW tab'");
    expect(precheck).toContain('ORDER BY final_report.sort_order, final_report.item');
    for (const marker of [
      "'Q0 server version'",
      "'Q0 running role'",
      "'Q1 exists '",
      "'Q2 owner '",
      "'Q3 row security '",
      "'Q4 privileges '",
      "'Q5 grant '",
      "'Q6 column privileges '",
      "'Q7 owned sequences '",
      "'Q8 policies '",
      "'Q9 trigger '",
      "'Q11 routing decisions policy'",
      "'Q12 agents policies'",
      "'Q13 owner mismatch pin '",
      "'Q13 D0b fill values'",
      "'Q14 function mention '",
      "'Q14 policy mention '",
      "'Q15 view agent_executions_with_details'",
      "'Q16 row count '",
    ]) {
      expect(precheck).toContain(marker);
    }
    expect(precheck).toContain("' the D0a row is still there so run D0b first stop here'");
    expect(precheck).toContain("' differs from the four so the migration would refuse stop here'");
    expect(precheck).toContain("' OTHER GRANTOR stop here'");
    expect(precheck).toContain(`md5(mismatch_row.agent_id::text) = '${PIN.statsAgent}' AS is_pinned_agent`);
    expect(precheck).toContain('replace(mismatch_row.user_id::text, chr(45), ');
  });

  it('the checker puts VERDICT first and runs ten checks per table plus six boundary checks', () => {
    expect(checker).toContain("'VERDICT' AS check_name");
    expect(checker).toMatch(/CASE WHEN EXISTS \(SELECT 1 FROM checks WHERE checks\.result <> 'PASS'\) THEN 'FAIL' ELSE 'PASS' END/);
    const perTable = [
      "'C1 exists '",
      "'C2 owner postgres '",
      "'C3 row security on '",
      "'C4 row security not forced '",
      "'C5 anon and public hold no table privilege '",
      "'C6 anon and public hold no column privilege '",
      "'C7 authenticated holds exactly the planned set '",
      "'C8 service_role keeps SELECT INSERT UPDATE DELETE '",
      "'C9 no column acl '",
      "'C10 exact policy set '",
    ];
    for (const marker of perTable) expect(checker).toContain(marker);
    expect((checker.match(/held_summary\.table_order \* 100 \+ \d+/g) ?? []).length).toBe(10);
    for (const marker of [
      "'B1 owner mismatch set equals the pin'",
      "'B2 routing decisions policy unchanged'",
      "'B3 agents policies unchanged'",
      "'B4 view agent_executions_with_details caller rights and no client grant'",
      "'B5 import counter trigger untouched'",
      "'B6 no owned sequence on the six tables'",
    ]) {
      expect(checker).toContain(marker);
    }
    expect((checker.match(/^ {2}SELECT 100\d,$/gm) ?? []).length).toBe(6);
  });

  it('the checker plans SELECT INSERT UPDATE for the four agent tables, nothing for the sharing tables, and 3 or 0 policies', () => {
    for (const table of OWNER_TABLES) expect(checker).toContain(`('${table}', ${SIX.indexOf(table) + 1}, true, 'INSERT SELECT UPDATE')`);
    for (const table of SHARING_TABLES) expect(checker).toContain(`('${table}', ${SIX.indexOf(table) + 1}, false, 'none')`);
    expect(checker).toContain('held_summary.policy_total = CASE WHEN held_summary.is_owner_table THEN 3 ELSE 0 END');
    expect(checker).toContain("('_owner_select', 'SELECT', true, false)");
    expect(checker).toContain("('_owner_insert', 'INSERT', false, true)");
    expect(checker).toContain("('_owner_update', 'UPDATE', true, true)");
  });
});

describe('the workplan', () => {
  it('records 2c-2 as written, with the migration number and the dry run', () => {
    const workplan = read(WORKPLAN);
    expect(workplan).toContain('2c-2 as written');
    expect(workplan).toContain('20261062');
    expect(workplan).toContain('rls-disabled-agent-tables-slice2c');
  });
});
