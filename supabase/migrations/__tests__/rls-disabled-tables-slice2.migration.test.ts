/**
 * Guard over migrations 20261056 (slice 2a, server-only tables) and 20261057
 * (slice 2b, token_usage), with their pre-checks, checkers and rollbacks
 * (workplan docs/workplans/RLS_DISABLED_TABLES_SLICE2_WORKPLAN.md, SA C-1..C-11).
 *
 * Fifteen public tables had row level security off while anon and authenticated
 * held every privilege, TRUNCATE included. 2a closes the seven tables no client
 * role uses, and leaves `ais_normalization_ranges` readable by signed-in users
 * only (get_active_ais_ranges runs with the caller's rights on agent runs). 2b
 * replaces the six never-active owner policies on `token_usage` with two
 * wrapped owner policies for authenticated, and enables RLS.
 *
 * WHY A TEST OVER SQL TEXT: there is no branch database. TL pastes the files
 * into the Supabase SQL editor (or runs them through the connector) by hand.
 * What the files alone can prove is pinned here: the paste rules on all eight
 * files (C-10), the exact DDL, the pins of the pre-guards (C-3), the privilege
 * asserts incl. MAINTAIN and column ACLs (C-2), lock_timeout (C-8), no FORCE
 * (C-9), the rollbacks as exact inverses (Q-SA-6), and a source guard that no
 * client-role code reaches a server-only table.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOT = process.cwd();
const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

const FILES = {
  migration2a: join(ROOT, 'supabase', 'migrations', '20261056_rls_disabled_tables_slice2a_server_only.sql'),
  rollback2a: join(ROOT, 'supabase', 'SQL Scripts', '20261056_rls_disabled_tables_slice2a_server_only_rollback.sql'),
  checker2a: join(ROOT, 'scripts', 'check-rls-disabled-tables-slice2a-migration.sql'),
  precheck2a: join(ROOT, 'scripts', 'precheck-rls-disabled-tables-slice2a.sql'),
  migration2b: join(ROOT, 'supabase', 'migrations', '20261057_rls_disabled_tables_slice2b_token_usage.sql'),
  rollback2b: join(ROOT, 'supabase', 'SQL Scripts', '20261057_rls_disabled_tables_slice2b_token_usage_rollback.sql'),
  checker2b: join(ROOT, 'scripts', 'check-rls-disabled-tables-slice2b-migration.sql'),
  precheck2b: join(ROOT, 'scripts', 'precheck-rls-disabled-tables-slice2b.sql'),
};

const SERVER_ONLY = [
  'agent_job_fallback',
  'agent_scheduler_state',
  'contact_messages',
  'memory_config',
  'message_replies',
  'pricing_config',
  'storage_plans',
];
const READ_TABLE = 'ais_normalization_ranges';
const SLICE_2A = [...SERVER_ONLY, READ_TABLE].sort();
const READ_POLICY = `CREATE POLICY ais_normalization_ranges_authenticated_select ON public.${READ_TABLE} AS PERMISSIVE FOR SELECT TO authenticated USING (true)`;

const OWNER_PREDICATE_MD5 = '19300d155780585259ede73ac370586c'; // md5('(auth.uid() = user_id)'), verified on PG 17
const MD5_TRUE = 'b326b5062b2f0e69046810717534cb09'; // md5('true')
/** md5('(( SELECT auth.uid() AS uid) = user_id)'): PG 17's pg_policies rendering of the wrapped owner predicate (SA nit 2, PGlite 17.5). */
const WRAPPED_OWNER_MD5 = 'ff452c766f1dd1d84c376129b36406c1';
/** Q1 capture, 2026-10-11: name, cmd, qual pinned?, with_check pinned? */
const LEGACY_POLICIES: Array<[string, string, boolean, boolean]> = [
  ['Users can insert their own token usage', 'INSERT', false, true],
  ['Users can view their own token usage', 'SELECT', true, false],
  ['token_usage_delete_policy', 'DELETE', true, false],
  ['token_usage_insert_policy', 'INSERT', false, true],
  ['token_usage_select_policy', 'SELECT', true, false],
  ['token_usage_update_policy', 'UPDATE', true, false],
];
const ident = (name: string) => (/^[a-z_]+$/.test(name) ? name : `"${name}"`);
const ALL_PRIVILEGES = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'];

/** Objects other sessions own, plus the slice 2c tables (C-6: not before their route code ships). */
const NOT_OURS = [
  'pilot_step_routing_history',
  'pilot_routing_performance',
  'pilot_step_type_analysis',
  'pilot_tier_distribution',
  'pilot_cost_savings_summary',
  'ai_model_pricing',
  'workflow_step_executions',
  'agent_memories',
  'execution_insights',
  'processed_webhook_events',
];
const SLICE_2C = ['agent_configurations', 'agent_executions', 'agent_logs', 'agent_stats', 'shared_agents', 'shared_agent_imports'];

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Top-level statements, whitespace collapsed, without the semicolon. Dollar-, single- and double-quote aware. */
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
const ddlOf = (sql: string) =>
  topLevelStatements(sql).filter(
    (s) => !isDo(s) && !['BEGIN', 'COMMIT'].includes(s) && !s.startsWith('SET LOCAL') && !s.startsWith('SELECT ')
  );
const literalsOf = (sql: string) => [...sql.matchAll(/'([^']*)'/g)].map((match) => match[1]);

/** Every string_agg(...) call body, parentheses balanced. */
function stringAggCalls(sql: string): string[] {
  const calls: string[] = [];
  let index = sql.indexOf('string_agg(');
  while (index !== -1) {
    let depth = 0;
    let end = index + 'string_agg'.length;
    for (; end < sql.length; end += 1) {
      if (sql[end] === '(') depth += 1;
      if (sql[end] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    calls.push(sql.slice(index, end + 1));
    index = sql.indexOf('string_agg(', end);
  }
  return calls;
}

const expected2aMigrationDdl = () =>
  SLICE_2A.flatMap((table) => [
    `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`,
    ...['PUBLIC', 'anon', 'authenticated'].map((role) => `REVOKE ALL ON TABLE public.${table} FROM ${role}`),
    ...(table === READ_TABLE ? [`GRANT SELECT ON TABLE public.${table} TO authenticated`] : []),
    `GRANT ALL ON TABLE public.${table} TO service_role`,
    ...(table === READ_TABLE ? [READ_POLICY] : []),
  ]);

const expected2aRollbackDdl = () => [
  `DROP POLICY ais_normalization_ranges_authenticated_select ON public.${READ_TABLE}`,
  ...SLICE_2A.flatMap((table) => [
    `ALTER TABLE public.${table} DISABLE ROW LEVEL SECURITY`,
    `GRANT ALL ON TABLE public.${table} TO anon`,
    `GRANT ALL ON TABLE public.${table} TO authenticated`,
  ]),
];

const OWNER_SELECT = 'CREATE POLICY token_usage_owner_select ON public.token_usage AS PERMISSIVE FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id)';
const OWNER_INSERT = 'CREATE POLICY token_usage_owner_insert ON public.token_usage AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id)';

const expected2bMigrationDdl = [
  ...LEGACY_POLICIES.map(([name]) => `DROP POLICY ${ident(name)} ON public.token_usage`),
  'ALTER TABLE public.token_usage ENABLE ROW LEVEL SECURITY',
  ...['PUBLIC', 'anon', 'authenticated'].map((role) => `REVOKE ALL ON TABLE public.token_usage FROM ${role}`),
  'GRANT SELECT, INSERT ON TABLE public.token_usage TO authenticated',
  'GRANT ALL ON TABLE public.token_usage TO service_role',
  OWNER_SELECT,
  OWNER_INSERT,
];

const expected2bRollbackDdl = [
  'DROP POLICY token_usage_owner_select ON public.token_usage',
  'DROP POLICY token_usage_owner_insert ON public.token_usage',
  ...LEGACY_POLICIES.map(
    ([name, cmd, qualPinned]) =>
      `CREATE POLICY ${ident(name)} ON public.token_usage AS PERMISSIVE FOR ${cmd} TO public ${
        qualPinned ? 'USING' : 'WITH CHECK'
      } (auth.uid() = user_id)`
  ),
  'ALTER TABLE public.token_usage DISABLE ROW LEVEL SECURITY',
  'GRANT ALL ON TABLE public.token_usage TO anon',
  'GRANT ALL ON TABLE public.token_usage TO authenticated',
];

describe('SQL editor safety on all eight pasted files (C-10)', () => {
  const files = Object.entries(FILES);

  it.each(files)('%s exists', (_name, file) => {
    expect(existsSync(file)).toBe(true);
  });

  it.each(files)('%s has no line comment and no block comment', (_name, file) => {
    const text = read(file);
    expect(text).not.toContain('--');
    expect(text).not.toContain('/*');
  });

  it.each(files)('%s never contains "into" anywhere, in any case', (_name, file) => {
    expect(read(file)).not.toMatch(/into/i);
  });

  it.each(files)('%s has an even number of single quotes', (_name, file) => {
    expect((read(file).match(/'/g) ?? []).length % 2).toBe(0);
  });

  it.each(files)('%s holds only letters, digits, underscores and spaces inside string literals', (_name, file) => {
    for (const literal of literalsOf(read(file))) expect(literal).toMatch(/^[A-Za-z0-9_ ]*$/);
  });

  it.each(files)('%s never says SECURITY DEFINER and uses no single-letter alias', (_name, file) => {
    const text = read(file);
    expect(text).not.toMatch(/SECURITY\s+DEFINER/i);
    expect(text).not.toMatch(/\bAS [a-z]\b/i);
  });

  it.each(files)('%s sorts every string_agg with COLLATE "C"', (_name, file) => {
    for (const call of stringAggCalls(read(file))) expect(call).toContain('COLLATE "C"');
  });

  it.each(files)('%s never forces row security (C-9)', (_name, file) => {
    expect(read(file)).not.toMatch(/FORCE\s+ROW\s+LEVEL\s+SECURITY/i);
  });

  it.each(files)('%s names no object another session owns', (_name, file) => {
    const text = read(file);
    for (const name of NOT_OURS) expect(text).not.toContain(name);
  });

  it('migrations and rollbacks name no slice 2c table (C-6)', () => {
    for (const file of [FILES.migration2a, FILES.migration2b, FILES.rollback2a, FILES.rollback2b]) {
      const text = read(file);
      for (const table of SLICE_2C) expect(text).not.toMatch(new RegExp(`\\b${table}\\b`));
    }
  });

  it('the checkers and the pre-checks are read-only from their first statement and write nothing', () => {
    for (const file of [FILES.checker2a, FILES.checker2b, FILES.precheck2a, FILES.precheck2b]) {
      const statements = topLevelStatements(read(file));
      expect(statements[0]).toBe('SET default_transaction_read_only = on');
      expect(statements).toHaveLength(2);
      expect(read(file)).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|ALTER|DROP|CREATE)\b(?!')/);
    }
  });

  it('the pre-checks say CLEAN or STOP and tell TL to use a NEW tab', () => {
    for (const file of [FILES.precheck2a, FILES.precheck2b]) {
      const text = read(file);
      expect(text).toContain('CLEAN run the migration in a NEW tab');
      expect(text).toContain('STOP bring this output back to TL');
      expect(text).toContain('ALL matches the rollback');
      expect(text).toContain('differs from ALL so adjust the rollback');
    }
  });

  it('the checkers put a VERDICT row first that fails on any FAIL', () => {
    for (const file of [FILES.checker2a, FILES.checker2b]) {
      const text = read(file);
      expect(text).toContain("'VERDICT' AS check_name");
      expect(text).toContain("CASE WHEN EXISTS (SELECT 1 FROM checks WHERE checks.result = 'FAIL') THEN 'FAIL' ELSE 'PASS' END");
      expect(text).toContain('SELECT 0 AS sort_order');
      for (const privilege of ALL_PRIVILEGES) expect(text).toContain(`('${privilege}'`);
    }
  });
});

describe('migration 20261056, slice 2a', () => {
  const sql = read(FILES.migration2a);
  const statements = topLevelStatements(sql);

  it('is BEGIN, lock_timeout (C-8), pre-guard DO, the DDL, post-assert DO, COMMIT', () => {
    expect(statements[0]).toBe('BEGIN');
    expect(statements[1]).toBe("SET LOCAL lock_timeout = '5s'");
    expect(isDo(statements[2])).toBe(true);
    expect(isDo(statements[statements.length - 2])).toBe(true);
    expect(statements[statements.length - 1]).toBe('COMMIT');
    expect(statements.filter(isDo)).toHaveLength(2);
  });

  it('holds exactly the planned DDL, in order', () => {
    expect(statements.slice(3, -2)).toEqual(expected2aMigrationDdl());
  });

  it('never grants anything to anon or PUBLIC, and authenticated only SELECT on the read table', () => {
    expect(sql).not.toMatch(/\bTO\s+anon\b/i);
    expect(sql).not.toMatch(/\bTO\s+PUBLIC\b/i);
    const authGrants = statements.filter((s) => s.startsWith('GRANT') && s.endsWith('TO authenticated'));
    expect(authGrants).toEqual([`GRANT SELECT ON TABLE public.${READ_TABLE} TO authenticated`]);
  });

  it('the guard and the assert loop over exactly the eight tables', () => {
    const list = `ARRAY[${SLICE_2A.map((t) => `'${t}'`).join(', ')}]`;
    expect(statements[2]).toContain(list);
    expect(statements[statements.length - 2]).toContain(list);
  });

  it('the pre-guard refuses on a wrong owner, RLS already on, FORCE, any policy, or column privileges', () => {
    const guard = statements[2];
    expect(guard).toContain("IS DISTINCT FROM 'postgres'");
    expect(guard).toContain('pg_class.relrowsecurity');
    expect(guard).toContain('pg_class.relforcerowsecurity');
    expect(guard).toMatch(/AND pg_policies\.tablename = guard_table_name\) <> 0 THEN/);
    expect(guard).toContain('pg_attribute.attacl IS NOT NULL');
    for (const message of [...guard.matchAll(/MESSAGE = '([^']*)'/g)].map((m) => m[1])) {
      expect(message.trimEnd().endsWith('so nothing was applied')).toBe(true);
    }
  });

  it('the post-assert checks all eight privileges incl. MAINTAIN, PUBLIC, column ACLs, postgres DELETE, and the read policy (C-2)', () => {
    const post = statements[statements.length - 2];
    expect(post).toContain(`ARRAY[${ALL_PRIVILEGES.map((p) => `'${p}'`).join(', ')}]`);
    expect(post).toContain("has_table_privilege('anon', check_table_oid, check_privilege)");
    expect(post).toContain(
      "has_table_privilege('authenticated', check_table_oid, check_privilege) <> (check_is_read_table AND check_privilege = 'SELECT')"
    );
    expect(post).toContain("NOT has_table_privilege('service_role', check_table_oid, check_privilege)");
    expect(post).toContain('acl_item.grantee = 0');
    expect(post).toContain('pg_attribute.attacl IS NOT NULL');
    expect(post).toContain("has_table_privilege('postgres', check_table_oid, 'DELETE')");
    expect(post).toContain('pg_class.relrowsecurity AND NOT pg_class.relforcerowsecurity');
    expect(post).toContain(`md5(pg_policies.qual) = '${MD5_TRUE}'`);
    expect(post).toContain("pg_policies.roles = ARRAY['authenticated']::name[]");
  });
});

describe('migration 20261057, slice 2b (token_usage)', () => {
  const sql = read(FILES.migration2b);
  const statements = topLevelStatements(sql);

  it('is BEGIN, lock_timeout, pre-guard DO, the DDL, post-assert DO, COMMIT', () => {
    expect(statements[0]).toBe('BEGIN');
    expect(statements[1]).toBe("SET LOCAL lock_timeout = '5s'");
    expect(isDo(statements[2])).toBe(true);
    expect(isDo(statements[statements.length - 2])).toBe(true);
    expect(statements[statements.length - 1]).toBe('COMMIT');
  });

  it('holds exactly the planned DDL, in order: drop six, enable, revoke, grant, two wrapped owner policies', () => {
    expect(statements.slice(3, -2)).toEqual(expected2bMigrationDdl);
  });

  it('gives authenticated no UPDATE, DELETE or TRUNCATE and anon nothing', () => {
    expect(sql).not.toMatch(/\bTO\s+anon\b/i);
    expect(sql).not.toMatch(/\bTO\s+PUBLIC\b/i);
    expect(sql).not.toMatch(/FOR\s+(UPDATE|DELETE|ALL)\s+TO/i);
  });

  it('the pre-guard pins the six Q1 policies by name, cmd, roles, permissive and md5 (C-3)', () => {
    const guard = statements[2];
    expect(guard).toMatch(/AND pg_policies\.tablename = 'token_usage'\) <> 6 THEN/);
    for (const [name, cmd] of LEGACY_POLICIES) {
      expect(guard).toContain(`pg_policies.policyname = '${name}'`);
      expect(guard).toContain(`pg_policies.cmd = '${cmd}'`);
    }
    expect((guard.match(/pg_policies\.roles = ARRAY\['public'\]::name\[\]/g) ?? []).length).toBe(6);
    expect((guard.match(/pg_policies\.permissive = 'PERMISSIVE'/g) ?? []).length).toBe(6);
    expect((guard.match(new RegExp(OWNER_PREDICATE_MD5, 'g')) ?? []).length).toBe(6);
    expect((guard.match(/pg_policies\.qual IS NULL/g) ?? []).length).toBe(2);
    expect((guard.match(/pg_policies\.with_check IS NULL/g) ?? []).length).toBe(4);
    expect(guard).toContain('pg_class.relforcerowsecurity');
    expect(guard).toContain('pg_attribute.attacl IS NOT NULL');
    for (const message of [...guard.matchAll(/MESSAGE = '([^']*)'/g)].map((m) => m[1])) {
      expect(message.trimEnd().endsWith('so nothing was applied')).toBe(true);
    }
  });

  it('the post-assert checks the two policies, SELECT and INSERT only for authenticated, MAINTAIN, PUBLIC and column ACLs', () => {
    const post = statements[statements.length - 2];
    expect(post).toMatch(/AND pg_policies\.tablename = 'token_usage'\) <> 2 THEN/);
    expect(post).toContain("pg_policies.policyname = 'token_usage_owner_select'");
    expect(post).toContain("pg_policies.policyname = 'token_usage_owner_insert'");
    expect(post).toContain(`md5(pg_policies.qual) = '${WRAPPED_OWNER_MD5}' AND pg_policies.with_check IS NULL`);
    expect(post).toContain(`pg_policies.qual IS NULL AND md5(pg_policies.with_check) = '${WRAPPED_OWNER_MD5}'`);
    expect(post).not.toContain('strpos');
    const checker = read(FILES.checker2b);
    expect(checker).toContain(`md5(live_policies.qual) = '${WRAPPED_OWNER_MD5}'`);
    expect(checker).toContain(`md5(live_policies.with_check) = '${WRAPPED_OWNER_MD5}'`);
    expect(checker).not.toContain('strpos');
    expect(post).toContain(`ARRAY[${ALL_PRIVILEGES.map((p) => `'${p}'`).join(', ')}]`);
    expect(post).toContain("has_table_privilege('authenticated', check_table_oid, check_privilege) <> (check_privilege IN ('SELECT', 'INSERT'))");
    expect(post).toContain('acl_item.grantee = 0');
    expect(post).toContain('pg_attribute.attacl IS NOT NULL');
    expect(post).toContain("has_table_privilege('postgres', check_table_oid, 'DELETE')");
  });
});

describe('the rollbacks are exact inverses with a warning (Q-SA-6)', () => {
  it('2a: warning first, then BEGIN, lock_timeout, guard, the inverse DDL, post, COMMIT', () => {
    const statements = topLevelStatements(read(FILES.rollback2a));
    expect(statements[0]).toMatch(/^SELECT 'WARNING this rollback reopens anon and authenticated .* explicit authorization of the user' AS read_me_first$/);
    expect(statements[1]).toBe('BEGIN');
    expect(statements[2]).toBe("SET LOCAL lock_timeout = '5s'");
    expect(isDo(statements[3])).toBe(true);
    expect(ddlOf(read(FILES.rollback2a))).toEqual(expected2aRollbackDdl());
    expect(statements[statements.length - 1]).toBe('COMMIT');
    for (const message of [...read(FILES.rollback2a).matchAll(/MESSAGE = '([^']*)'/g)].map((m) => m[1])) {
      expect(message).toContain('so nothing was restored');
    }
  });

  it('2b: recreates the six Q1 policies verbatim (TO public, unwrapped auth.uid()) and restores ALL', () => {
    const text = read(FILES.rollback2b);
    const statements = topLevelStatements(text);
    expect(statements[0]).toMatch(/^SELECT 'WARNING this rollback reopens anon and authenticated .* explicit authorization of the user' AS read_me_first$/);
    expect(statements[1]).toBe('BEGIN');
    expect(statements[2]).toBe("SET LOCAL lock_timeout = '5s'");
    expect(ddlOf(text)).toEqual(expected2bRollbackDdl);
    const post = statements[statements.length - 2];
    expect((post.match(new RegExp(OWNER_PREDICATE_MD5, 'g')) ?? []).length).toBe(6);
    expect(post).toMatch(/AND pg_policies\.tablename = 'token_usage'\) <> 6 THEN/);
  });

  it('every table the 2a migration closes is reopened by the 2a rollback, and nothing else', () => {
    const migrated = ddlOf(read(FILES.migration2a)).filter((s) => s.startsWith('ALTER TABLE')).map((s) => s.split(' ')[2]);
    const restored = ddlOf(read(FILES.rollback2a)).filter((s) => s.startsWith('ALTER TABLE')).map((s) => s.split(' ')[2]);
    expect(restored).toEqual(migrated);
  });
});

describe('source guard: no client-role code reaches a slice 2a table', () => {
  /** The only files allowed to name a server-only table in .from(); each runs with the service role or an injected one. */
  const ALLOWED: Record<string, string[]> = {
    ais_normalization_ranges: [
      'app/api/admin/ais-config/route.ts',
      'app/api/admin/dashboard/route.ts',
      'app/api/pricing/ais-ranges/route.ts',
      'lib/audit/ais-helpers.ts',
    ],
    contact_messages: [
      'app/api/admin/messages/[id]/replay/route.ts',
      'app/api/admin/messages/[id]/route.ts',
      'app/api/admin/messages/route.ts',
      'app/api/contact/route.ts',
    ],
    memory_config: ['lib/memory/MemoryConfigService.ts'],
    message_replies: ['app/api/admin/messages/[id]/replay/route.ts', 'app/api/admin/messages/route.ts'],
    pricing_config: ['app/api/admin/reward-config/route.ts'],
    storage_plans: ['lib/services/StorageService.ts'],
    agent_job_fallback: [],
    agent_scheduler_state: [],
  };

  function sourceFiles(dir: string): string[] {
    if (!existsSync(dir)) return [];
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === '__tests__' || entry.startsWith('.')) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
      else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
  }

  const files = ['app', 'lib', 'components', 'hooks'].flatMap((dir) => sourceFiles(join(ROOT, dir)));
  const rel = (file: string) => relative(ROOT, file).replace(/\\/g, '/');
  const contents = new Map(files.map((file) => [file, readFileSync(file, 'utf8')]));
  const textOf = (file: string) => contents.get(file) ?? '';

  it.each(Object.keys(ALLOWED))('%s is read or written only by the allowlisted server files', (table) => {
    const pattern = new RegExp(`\\.from\\(\\s*['"\`]${table}['"\`]`);
    const found = files.filter((file) => pattern.test(textOf(file))).map(rel).sort();
    expect(found).toEqual([...ALLOWED[table]].sort());
  });

  it('no allowlisted route uses a browser or cookie client', () => {
    const routes = [...new Set(Object.values(ALLOWED).flat())].filter((file) => file.startsWith('app/'));
    for (const file of routes) {
      const text = readFileSync(join(ROOT, file), 'utf8');
      expect(text).not.toContain("'use client'");
      expect(text).not.toContain('@/lib/supabaseClient');
      expect(text).not.toMatch(/createAuthenticatedServerClient|createRouteHandlerClient/);
      expect(text).toMatch(/SUPABASE_SERVICE_ROLE_KEY|supabaseServer/);
    }
  });

  it('the invoker RPCs that read a server-only table have no code caller (get_pricing_config, set_memory_expiration)', () => {
    for (const fn of ['get_pricing_config', 'set_memory_expiration']) {
      const pattern = new RegExp(`rpc\\(\\s*['"\`]${fn}['"\`]`);
      expect(files.filter((file) => pattern.test(textOf(file))).map(rel)).toEqual([]);
    }
  });
});

describe('mutation self-tests: the DDL pins catch a reopened grant or policy', () => {
  const injectBeforeCommit = (sql: string, statement: string) => sql.replace(/COMMIT;\s*$/, `${statement}\n\nCOMMIT;\n`);
  const ddlBody = (sql: string) => topLevelStatements(sql).slice(3, -2);

  it('an anon grant added to 2a breaks the pin', () => {
    const mutated = injectBeforeCommit(read(FILES.migration2a), 'GRANT SELECT ON TABLE public.contact_messages TO anon;');
    expect(ddlBody(mutated)).not.toEqual(expected2aMigrationDdl());
  });

  it('a FORCE added to 2a is caught by the C-9 rule', () => {
    const mutated = injectBeforeCommit(read(FILES.migration2a), 'ALTER TABLE public.contact_messages FORCE ROW LEVEL SECURITY;');
    expect(mutated).toMatch(/FORCE\s+ROW\s+LEVEL\s+SECURITY/i);
  });

  it('an UPDATE policy added to 2b breaks the pin and the no-UPDATE rule', () => {
    const statement = 'CREATE POLICY reopened ON public.token_usage FOR UPDATE TO authenticated USING (true);';
    const mutated = read(FILES.migration2b).replace(/(\$\$;\s*COMMIT;\s*)$/, `$$$$;\n\n${statement}\n\nCOMMIT;\n`);
    expect(mutated).not.toBe(read(FILES.migration2b));
    expect(mutated).toMatch(/FOR\s+(UPDATE|DELETE|ALL)\s+TO/i);
  });
});
