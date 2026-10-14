/**
 * Guard over migration 20261068, plugin_connections token column lockdown
 * (data export DE-0b, BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md §0.1.4 B-3…B-6).
 *
 * anon and authenticated held every table privilege on plugin_connections, so
 * any signed-in browser session could `select('*')` its own OAuth access and
 * refresh tokens (and the export file carried them). The migration removes
 * every table-level client privilege, gives `authenticated` back SELECT on the
 * 13 non-secret columns and UPDATE on (status, disconnected_at) only, and
 * gives anon nothing. service_role, postgres, RLS and policies are untouched.
 *
 * Column list from the B-1 pre-check run on PROD 2026-10-14 (19 columns):
 * granted 13, never granted 6 (access_token, refresh_token, expires_at,
 * last_refreshed_at, settings, profile_data). There is no `credentials` column,
 * so nothing names it (has_column_privilege errors on a missing column). The
 * rollback restores exactly the pre-check's table grants: anon and
 * authenticated each held SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES
 * and TRIGGER; PUBLIC held nothing.
 *
 * WHY A TEST OVER SQL TEXT: there is no branch database. The user pastes the
 * pre-check, the migration, the checker, the probe and, if needed, the
 * rollback into the Supabase SQL editor by hand.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const MIGRATION = join(ROOT, 'supabase', 'migrations', '20261068_plugin_connections_token_column_lockdown.sql');
const ROLLBACK = join(ROOT, 'scripts', 'rollback-plugin-connections-token-column-lockdown.sql');
const CHECKER = join(ROOT, 'scripts', 'check-plugin-connections-token-column-lockdown.sql');
const PRECHECK = join(ROOT, 'scripts', 'precheck-plugin-connections-token-privileges.sql');
const PROBE = join(ROOT, 'scripts', 'probe-plugin-connections-token-column-lockdown.sql');

const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

const GRANTED = [
  'id', 'user_id', 'plugin_key', 'plugin_name', 'username', 'email', 'scope', 'status',
  'connected_at', 'created_at', 'updated_at', 'last_used', 'disconnected_at',
];
const NEVER = ['access_token', 'refresh_token', 'expires_at', 'last_refreshed_at', 'settings', 'profile_data'];
const UPDATABLE = ['status', 'disconnected_at'];
const SEVEN = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
const TABLE = 'public.plugin_connections';

function literalsOf(sql: string): string[] {
  return [...sql.matchAll(/'([^']*)'/g)].map((match) => match[1]);
}

function splitDoBlock(sql: string): { block: string; rest: string } {
  const blocks = [...sql.matchAll(/DO \$\$[\s\S]*?\n\$\$;/g)];
  expect(blocks).toHaveLength(1);
  return { block: blocks[0][0], rest: sql.replace(blocks[0][0], '') };
}

function statementsOf(sql: string): string[] {
  return sql
    .split(';')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function columnList(statement: string): string[] {
  const match = statement.match(/\(([^)]*)\)/);
  expect(match).not.toBeNull();
  return match![1].split(',').map((c) => c.trim());
}

/** The literals of `FOREACH <var> IN ARRAY ARRAY[...]` loops, in order. */
function loopArrays(block: string): string[][] {
  return [...block.matchAll(/FOREACH \w+ IN ARRAY ARRAY\[([^\]]*)\]/g)].map((m) => literalsOf(m[1]));
}

const FILES: Array<[string, string]> = [
  ['migration', MIGRATION],
  ['rollback', ROLLBACK],
  ['checker', CHECKER],
  ['precheck', PRECHECK],
  ['probe', PROBE],
];

describe('SQL-editor safety (the user pastes every file by hand)', () => {
  it.each(FILES)('%s exists', (_name, file) => {
    expect(existsSync(file)).toBe(true);
  });

  it.each(FILES)('%s has no line comment and no block comment', (_name, file) => {
    const text = read(file);
    expect(text).not.toContain('--');
    expect(text).not.toContain('/*');
  });

  // The Supabase SQL editor misreads the word "into" even inside a literal.
  it.each(FILES)('%s never contains "into" anywhere', (_name, file) => {
    expect(read(file)).not.toMatch(/into/i);
  });

  it.each(FILES)('%s holds only plain literals, apart from the table name', (_name, file) => {
    for (const literal of literalsOf(read(file))) {
      if (/^[A-Za-z0-9_ ]*$/.test(literal)) continue;
      expect(literal).toBe(TABLE);
    }
  });

  it.each(FILES)('%s has an even number of single quotes', (_name, file) => {
    expect((read(file).match(/'/g) ?? []).length % 2).toBe(0);
  });

  it.each(FILES)('%s never names a credentials column (there is none)', (_name, file) => {
    expect(read(file)).not.toMatch(/credentials/i);
  });

  it.each(FILES)('%s never says SECURITY DEFINER', (_name, file) => {
    expect(read(file)).not.toMatch(/SECURITY\s+DEFINER/i);
  });
});

describe('the migration (B-3)', () => {
  const migration = read(MIGRATION);
  const { block, rest } = splitDoBlock(migration);
  const statements = statementsOf(rest);

  it('is one BEGIN ... COMMIT with a lock timeout, a table-level revoke and two column grants, in order', () => {
    expect(statements[0]).toBe('BEGIN');
    expect(statements[statements.length - 1]).toBe('COMMIT');
    expect(statements.filter((s) => s === 'BEGIN' || s === 'COMMIT')).toHaveLength(2);
    expect(statements.slice(1, -1)).toEqual([
      "SET LOCAL lock_timeout = '5s'",
      'REVOKE ALL ON public.plugin_connections FROM PUBLIC, anon, authenticated',
      `GRANT SELECT (${GRANTED.join(', ')}) ON public.plugin_connections TO authenticated`,
      'GRANT UPDATE (status, disconnected_at) ON public.plugin_connections TO authenticated',
    ]);
  });

  it('the SELECT grant is the 13 granted columns and none of the token columns', () => {
    const grant = statements.find((s) => s.startsWith('GRANT SELECT'))!;
    expect(columnList(grant)).toEqual(GRANTED);
    for (const column of NEVER) expect(columnList(grant)).not.toContain(column);
    // 13 + 6 = the 19 columns the pre-check listed, with no overlap.
    expect(new Set([...GRANTED, ...NEVER]).size).toBe(19);
  });

  it('no GRANT names a token column, goes to anon or PUBLIC, or grants a table-wide privilege', () => {
    const grants = statementsOf(migration).filter((s) => /^GRANT\b/.test(s));
    expect(grants).toHaveLength(2);
    for (const grant of grants) {
      for (const column of NEVER) expect(grant).not.toMatch(new RegExp(`\\b${column}\\b`));
      expect(grant).toMatch(/ TO authenticated$/);
      expect(grant).not.toMatch(/\banon\b|PUBLIC|service_role/);
      expect(grant).toMatch(/^GRANT (SELECT|UPDATE) \(/);
    }
  });

  it('touches nothing else: no service_role or postgres grant, no RLS, policy, owner or DDL', () => {
    expect(rest).not.toMatch(/service_role|postgres/);
    // Literals ('INSERT' in a privilege list, messages) are stripped first.
    const code = migration.replace(/'[^']*'/g, "''");
    expect(code).not.toMatch(/\b(DROP|ALTER|CREATE|CASCADE|OWNER|POLICY|INSERT|DELETE|TRUNCATE)\b/);
    expect(migration).not.toMatch(/ROW LEVEL SECURITY/i);
  });

  it('the DO block fails on a missing table and checks every post-condition', () => {
    expect(block).toMatch(/lockdown_table := pg_catalog\.to_regclass\('public\.plugin_connections'\);/);
    expect(block).toMatch(/IF lockdown_table IS NULL THEN\s+RAISE EXCEPTION/);
    expect(loopArrays(block)).toEqual([
      ['public', 'anon', 'authenticated'],
      SEVEN,
      ['public', 'anon'],
      ['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'],
      NEVER,
      ['anon', 'authenticated'],
      ['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'],
      GRANTED,
      UPDATABLE,
      GRANTED.filter((c) => !UPDATABLE.includes(c)),
      ['INSERT', 'REFERENCES'],
      ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
    ]);
    expect(block).toMatch(
      /IF pg_catalog\.has_table_privilege\(lockdown_role, lockdown_table, lockdown_privilege\) THEN\s+RAISE EXCEPTION/
    );
    expect(block).toMatch(
      /IF pg_catalog\.has_column_privilege\(lockdown_role, lockdown_table, lockdown_column, lockdown_privilege\) THEN\s+RAISE EXCEPTION/
    );
    expect(block).toMatch(
      /IF NOT pg_catalog\.has_column_privilege\('authenticated', lockdown_table, lockdown_column, 'SELECT'\) THEN\s+RAISE EXCEPTION/
    );
    expect(block).toMatch(
      /IF NOT pg_catalog\.has_table_privilege\('service_role', lockdown_table, lockdown_privilege\) THEN\s+RAISE EXCEPTION/
    );
  });

  it('the DO block uses direct booleans only, no SELECT query', () => {
    expect(block.replace(/'[^']*'/g, "''")).not.toMatch(/\bSELECT\b/i);
  });
});

describe('the rollback (B-4) restores exactly the pre-check table grants', () => {
  const rollback = read(ROLLBACK);
  const { block, rest } = splitDoBlock(rollback);

  it('revokes the two column grants, then re-grants the seven privileges to anon and authenticated', () => {
    expect(statementsOf(rest)).toEqual([
      'BEGIN',
      "SET LOCAL lock_timeout = '5s'",
      `REVOKE SELECT (${GRANTED.join(', ')}) ON public.plugin_connections FROM authenticated`,
      'REVOKE UPDATE (status, disconnected_at) ON public.plugin_connections FROM authenticated',
      `GRANT ${SEVEN.join(', ')} ON public.plugin_connections TO anon`,
      `GRANT ${SEVEN.join(', ')} ON public.plugin_connections TO authenticated`,
      'COMMIT',
    ]);
  });

  it('is not a blanket GRANT ALL and grants nothing to PUBLIC', () => {
    expect(rollback).not.toMatch(/GRANT ALL/);
    expect(rollback).not.toMatch(/TO PUBLIC/);
    expect(rollback).not.toMatch(/\b(DROP|ALTER|CREATE|CASCADE)\b/);
  });

  it('checks in the same transaction that anon, authenticated and service_role hold all seven again', () => {
    expect(block).toMatch(/IF lockdown_table IS NULL THEN\s+RAISE EXCEPTION/);
    expect(loopArrays(block)).toEqual([['anon', 'authenticated', 'service_role'], SEVEN]);
    expect(block).toMatch(
      /IF NOT pg_catalog\.has_table_privilege\(lockdown_role, lockdown_table, lockdown_privilege\) THEN\s+RAISE EXCEPTION/
    );
  });
});

describe('the checker (B-5) and pre-check / probe', () => {
  const checker = read(CHECKER);

  it('is read-only and prints a VERDICT over PASS/FAIL rows', () => {
    expect(checker.startsWith('SET default_transaction_read_only = on;')).toBe(true);
    expect(checker).not.toMatch(/\b(GRANT|REVOKE|UPDATE public|DROP|ALTER|CREATE)\b/);
    expect(checker).toMatch(/'VERDICT' AS check_name/);
    expect(checker).toMatch(/THEN 'PASS' ELSE 'FAIL' END/);
  });

  it('checks every token column, every granted column, and the update set', () => {
    for (const column of [...NEVER, ...GRANTED]) expect(checker).toContain(`('${column}', `);
    for (const column of UPDATABLE) expect(checker).toMatch(new RegExp(`\\('${column}', \\d+, true\\)`));
    expect(checker.match(/, true\)/g)).toHaveLength(UPDATABLE.length);
  });

  it('the pre-check runs the three B-8 queries read-only', () => {
    const precheck = read(PRECHECK);
    expect(precheck.startsWith('SET default_transaction_read_only = on;')).toBe(true);
    expect(precheck).toContain('FROM information_schema.columns');
    expect(precheck).toContain('FROM information_schema.role_table_grants');
    expect(precheck).toContain('FROM information_schema.column_privileges');
  });

  it('the probe reads a granted column, then a token column, as authenticated, and rolls back', () => {
    expect(statementsOf(read(PROBE))).toEqual([
      'BEGIN',
      'SET LOCAL ROLE authenticated',
      'SELECT plugin_key, status FROM public.plugin_connections LIMIT 1',
      'SELECT access_token FROM public.plugin_connections LIMIT 1',
      'ROLLBACK',
    ]);
  });
});
