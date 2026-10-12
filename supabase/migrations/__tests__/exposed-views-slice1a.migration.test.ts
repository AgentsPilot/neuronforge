/**
 * Guard over migration 20261054, exposed views slice 1a
 * (workplan docs/workplans/EXPOSED_VIEWS_SLICE1A_WORKPLAN.md).
 *
 * Emergency fix measured on prod 2026-10-11: public.active_plugin_connections
 * returns every user's OAuth access and refresh tokens, and
 * public.user_settings_complete returns every user's auth email and settings.
 * Both are owner-rights views (owner postgres, security_invoker unset) and anon
 * plus authenticated held SELECT, so the public anon key read them for anyone.
 * The migration removes every client privilege and keeps service_role SELECT.
 * It does NOT drop the views and does NOT set security_invoker (slice 1b).
 *
 * WHY A TEST OVER SQL TEXT: there is no branch database. The user pastes the
 * pre-check, the migration (in a NEW tab), the checker and, if ever needed,
 * the rollback into the Supabase SQL editor by hand. Same shape as the
 * secdef-lockdown slice tests.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const MIGRATION = join(ROOT, 'supabase', 'migrations', '20261054_exposed_views_slice1a_tokens_and_auth_users.sql');
const ROLLBACK = join(ROOT, 'supabase', 'SQL Scripts', '20261054_exposed_views_slice1a_tokens_and_auth_users_rollback.sql');
const CHECKER = join(ROOT, 'scripts', 'check-exposed-views-slice1a-migration.sql');
const PRECHECK = join(ROOT, 'scripts', 'precheck-exposed-views-slice1a.sql');
const WORKPLAN = join(ROOT, 'docs', 'workplans', 'EXPOSED_VIEWS_SLICE1A_WORKPLAN.md');

const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const migration = read(MIGRATION);
const rollback = read(ROLLBACK);
const checker = read(CHECKER);
const precheck = read(PRECHECK);

const VIEWS = ['active_plugin_connections', 'user_settings_complete'];
const REGCLASSES = VIEWS.map((name) => `public.${name}`);
const SEVEN = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
const sorted = (values: string[]) => [...values].sort();

/** Punctuated literals each file may hold. Everything else must be plain. */
const PUNCTUATED_ALLOWED: Record<string, string[]> = {
  migration: REGCLASSES,
  rollback: REGCLASSES,
  checker: REGCLASSES,
  precheck: REGCLASSES,
};

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

function viewLoopLiterals(block: string): string[] {
  const array = block.match(/FOREACH slice_view_name IN ARRAY ARRAY\[([\s\S]*?)\]\s+LOOP/);
  expect(array).not.toBeNull();
  return literalsOf(array![1]);
}

describe('SQL-editor safety (the user pastes all four files by hand)', () => {
  const files: Array<[string, string]> = [
    ['migration', MIGRATION],
    ['rollback', ROLLBACK],
    ['checker', CHECKER],
    ['precheck', PRECHECK],
  ];

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

  it.each(files)('%s holds only plain literals, apart from the two view names', (name, file) => {
    const allowed = PUNCTUATED_ALLOWED[name];
    for (const literal of literalsOf(read(file))) {
      if (/^[A-Za-z0-9_ ]*$/.test(literal)) continue;
      expect(allowed).toContain(literal);
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

  // The slice 6 guard scans supabase/migrations, supabase/SQL Scripts and the
  // scripts/ tripwire, and flags the phrase even inside a string.
  it.each(files)('%s never says SECURITY DEFINER, not even in a string', (_name, file) => {
    expect(read(file)).not.toMatch(/SECURITY\s+DEFINER/i);
  });
});

describe('the migration: revoke every client privilege, keep service_role SELECT', () => {
  const { block, rest } = splitDoBlock(migration);
  const statements = statementsOf(rest);

  it('is one BEGIN ... COMMIT', () => {
    expect(statements[0]).toBe('BEGIN');
    expect(statements[statements.length - 1]).toBe('COMMIT');
    expect(statements.filter((s) => s === 'BEGIN' || s === 'COMMIT')).toHaveLength(2);
  });

  it('holds exactly one REVOKE ALL and one service_role GRANT SELECT per view, in order', () => {
    expect(statements.slice(1, -1)).toEqual([
      'REVOKE ALL ON public.active_plugin_connections FROM PUBLIC, anon, authenticated',
      'GRANT SELECT ON public.active_plugin_connections TO service_role',
      'REVOKE ALL ON public.user_settings_complete FROM PUBLIC, anon, authenticated',
      'GRANT SELECT ON public.user_settings_complete TO service_role',
    ]);
  });

  it('drops nothing and changes no view option, owner or other object', () => {
    expect(migration).not.toMatch(/\b(DROP|ALTER|CREATE|CASCADE|OWNER|TABLE)\b/);
    expect(migration).not.toMatch(/security_invoker|SECURITY|search_path/i);
  });

  it('the post-condition loop holds exactly the two views and fails, never skips, on a missing one', () => {
    expect(sorted(viewLoopLiterals(block))).toEqual(sorted(REGCLASSES));
    expect(block).toContain('slice_view := pg_catalog.to_regclass(slice_view_name);');
    expect(block).toMatch(/IF slice_view IS NULL THEN\s+RAISE EXCEPTION/);
  });

  it('checks all seven privileges for public, anon and authenticated, and service_role SELECT', () => {
    const privileges = block.match(/FOREACH slice_privilege IN ARRAY ARRAY\[([^\]]*)\]/);
    expect(privileges).not.toBeNull();
    expect(literalsOf(privileges![1])).toEqual(SEVEN);
    for (const role of ['public', 'anon', 'authenticated']) {
      expect(block).toMatch(
        new RegExp(`IF pg_catalog\\.has_table_privilege\\('${role}', slice_view, slice_privilege\\) THEN\\s+RAISE EXCEPTION`)
      );
    }
    expect(block).toMatch(
      /IF NOT pg_catalog\.has_table_privilege\('service_role', slice_view, 'SELECT'\) THEN\s+RAISE EXCEPTION/
    );
  });

  it('the DO block uses direct booleans only, no SELECT', () => {
    // Literals ('SELECT', messages) are stripped: only executable SQL counts.
    expect(block.replace(/'[^']*'/g, "''")).not.toMatch(/\bSELECT\b/i);
  });
});

describe('the rollback restores the Supabase default client grants', () => {
  const { block, rest } = splitDoBlock(rollback);
  const statements = statementsOf(rest);

  it('is one BEGIN ... COMMIT of GRANT ALL to anon and authenticated per view', () => {
    expect(statements).toEqual([
      'BEGIN',
      'GRANT ALL ON public.active_plugin_connections TO anon, authenticated',
      'GRANT ALL ON public.user_settings_complete TO anon, authenticated',
      'COMMIT',
    ]);
  });

  it('revokes nothing, grants nothing to PUBLIC, and touches no other object', () => {
    expect(rollback).not.toMatch(/\b(REVOKE|DROP|ALTER|CREATE|CASCADE|TABLE)\b/);
    expect(rollback).not.toMatch(/TO PUBLIC/);
  });

  it('checks in the same transaction that anon, authenticated and service_role select again', () => {
    expect(sorted(viewLoopLiterals(block))).toEqual(sorted(REGCLASSES));
    expect(block).toMatch(/IF slice_view IS NULL THEN\s+RAISE EXCEPTION/);
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
      // Privilege names appear only as quoted literals ('INSERT' and so on).
      const unquoted = text.replace(/'[^']*'/g, "''");
      expect(unquoted).not.toMatch(writeKeywords);
    }
  });

  it('both list exactly the two views', () => {
    for (const text of [checker, precheck]) {
      const listed = literalsOf(text).filter((literal) => literal.startsWith('public.'));
      expect(sorted(listed)).toEqual(sorted(REGCLASSES));
      for (const [index, name] of VIEWS.entries()) {
        expect(text).toContain(`('${name}', 'public.${name}', ${index + 1})`);
      }
    }
  });

  it('both test the seven privileges, plus MAINTAIN only on PostgreSQL 17 or later', () => {
    for (const text of [checker, precheck]) {
      for (const privilege of SEVEN) expect(text).toContain(`('${privilege}', 0)`);
      expect(text).toContain("('MAINTAIN', 170000)");
      expect(text).toContain("pg_catalog.current_setting('server_version_num')::int >= privilege_row.min_version");
    }
  });

  it('the checker reports a VERDICT row first, PASS only when every check passes', () => {
    expect(checker).toContain("'VERDICT' AS check_name");
    expect(checker).toMatch(/CASE WHEN EXISTS \(SELECT 1 FROM checks WHERE checks\.result <> 'PASS'\) THEN 'FAIL' ELSE 'PASS' END/);
    expect(checker).toContain('ORDER BY report.sort_order');
  });

  it('the checker checks exists, owner postgres, anon, authenticated and public hold nothing, service_role SELECT', () => {
    expect(checker).toContain("'C1 exists '");
    expect(checker).toContain("CASE WHEN view_owner.owner_name = 'postgres' THEN 'PASS' ELSE 'FAIL' END");
    for (const expectation of ["('anon', 3)", "('authenticated', 4)", "('public', 5)"]) {
      expect(checker).toContain(expectation);
    }
    expect(checker).toContain("CASE WHEN closed_state.held_total = 0 THEN 'PASS' ELSE 'FAIL' END");
    expect(checker).toContain("pg_catalog.has_table_privilege('service_role', view_owner.view_oid, 'SELECT') IS TRUE");
  });

  it('the pre-check records per-role privileges, grantors and every dependency kind, and stops on any', () => {
    for (const marker of [
      "'PRECHECK STATUS'",
      "'Q1 exists '",
      "'Q2 owner '",
      "'Q3 security invoker '",
      "'Q4 privileges '",
      "'Q5 grant '",
      "'Q6 dependents count '",
      "'Q6 dependent '",
      "'Q7 function mentions count '",
      "'Q8 policy mentions count '",
      "'Q9 other view mentions count '",
    ]) {
      expect(precheck).toContain(marker);
    }
    expect(precheck).toContain('pg_catalog.pg_depend');
    expect(precheck).toContain('pg_catalog.pg_rewrite');
    expect(precheck).toContain("' OTHER GRANTOR stop here'");
    expect(precheck).toContain('run the migration in a NEW tab');
    expect(precheck).toContain('adjust the rollback');
    expect(precheck).toContain('ORDER BY final_report.sort_order, final_report.item');
  });
});

describe('the workplan', () => {
  it('exists and names the apply order, the anon negative test and the follow-ups', () => {
    const workplan = read(WORKPLAN);
    expect(workplan).toContain('SET LOCAL ROLE anon');
    expect(workplan).toContain('42501');
    expect(workplan).toMatch(/slice 1b/i);
    expect(workplan).toMatch(/slice 2/i);
  });
});
