/**
 * Guard over migration 20261048, SECURITY DEFINER lockdown slice 2
 * (docs/requirements/SECURITY_DEFINER_FUNCTIONS_LOCKDOWN_REQUIREMENT.md FR-2,
 * workplan docs/workplans/SECDEF_LOCKDOWN_SLICE2_WORKPLAN.md).
 *
 * Revokes EXECUTE from PUBLIC, anon and authenticated on 13 dead or prod-only
 * functions that take a tenant id from the caller (credit balance, plan,
 * usage, calibration, behaviour rules ...) and keeps service_role. Eight of
 * them exist only in prod, so the TSV is the only record of their signatures.
 *
 * WHY A TEST OVER SQL TEXT: there is no branch database. The user pastes the
 * pre-check, the migration (in a NEW tab), the checker and, if ever needed,
 * the rollback into the Supabase SQL editor by hand (FR-0.6). Same shape as
 * the slice 1 test, plus the slice 2 conditions: the Q11 pg_depend dependents
 * check (SA S2-1) and the paste-safe negative-call blocks in the workplan's QA
 * section (SA S2-2).
 *
 * The slice 6 guard (supabase/__tests__/security-definer-surface.guard.test.ts)
 * already scans this migration on every run, so a SECURITY DEFINER function
 * slipped in here would fail it. Its analyser is not imported: importing a
 * .test.ts file would register and re-run every guard suite inside this file.
 * The no-SECURITY-text assert below is the stricter local form.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const MIGRATION = join(ROOT, 'supabase', 'migrations', '20261048_secdef_lockdown_slice2_dead_cross_tenant.sql');
const ROLLBACK = join(ROOT, 'supabase', 'SQL Scripts', '20261048_secdef_lockdown_slice2_dead_cross_tenant_rollback.sql');
const CHECKER = join(ROOT, 'scripts', 'check-secdef-lockdown-slice2-migration.sql');
const PRECHECK = join(ROOT, 'scripts', 'precheck-secdef-lockdown-slice2.sql');
const TSV = join(ROOT, 'docs', 'investigations', 'secdef_prod_inventory_2026-10-07.tsv');
const WORKPLAN = join(ROOT, 'docs', 'workplans', 'SECDEF_LOCKDOWN_SLICE2_WORKPLAN.md');

const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const migration = read(MIGRATION);
const rollback = read(ROLLBACK);
const checker = read(CHECKER);
const precheck = read(PRECHECK);

interface SliceFunction {
  name: string;
  signature: string;
}

/** Every slice 2 function has the same prod shape, so the rollback restores the same grantees for all 13. */
const ROLLBACK_GRANTEES = 'PUBLIC, anon, authenticated';
const TSV_GRANTEES = 'PUBLIC postgres anon authenticated service_role';

/** FR-2, in the order of the workplan §1.1. */
const SLICE_2: SliceFunction[] = [
  { name: 'get_user_credit_balance', signature: 'public.get_user_credit_balance(uuid)' },
  { name: 'get_user_subscription_info', signature: 'public.get_user_subscription_info(uuid)' },
  { name: 'get_user_usage_summary', signature: 'public.get_user_usage_summary(uuid, integer)' },
  { name: 'get_user_workflow_stats', signature: 'public.get_user_workflow_stats(uuid)' },
  { name: 'has_sufficient_credits', signature: 'public.has_sufficient_credits(uuid, integer)' },
  { name: 'is_reward_eligible', signature: 'public.is_reward_eligible(uuid, character varying)' },
  { name: 'get_last_perfect_calibration', signature: 'public.get_last_perfect_calibration(uuid, uuid)' },
  { name: 'get_unviewed_insights_count', signature: 'public.get_unviewed_insights_count(uuid)' },
  { name: 'match_behavior_rules', signature: 'public.match_behavior_rules(uuid, uuid, text, text, text, text)' },
  { name: 'record_behavior_rule_result', signature: 'public.record_behavior_rule_result(uuid, boolean)' },
  {
    name: 'check_execution_anomaly',
    signature: 'public.check_execution_anomaly(uuid, uuid, uuid, numeric, numeric, integer, integer, boolean)',
  },
  { name: 'dismiss_setup_step', signature: 'public.dismiss_setup_step(uuid, text)' },
  {
    name: 'upsert_plugin_performance',
    signature: 'public.upsert_plugin_performance(uuid, uuid, text, text, boolean, numeric, numeric, text)',
  },
];

const SIGNATURES = SLICE_2.map((fn) => fn.signature);
const sorted = (values: string[]) => [...values].sort();

/** Punctuated literals each file may hold (C-7, slice 1 SA ruling Q-1). Everything else must be plain. */
const PUNCTUATED_ALLOWED: Record<string, string[]> = {
  migration: SIGNATURES,
  rollback: SIGNATURES,
  checker: SIGNATURES,
  precheck: [...SIGNATURES, 'cron.job', 'TABLE cron.job'],
};

/** Single-quoted string literals. */
function literalsOf(sql: string): string[] {
  return [...sql.matchAll(/'([^']*)'/g)].map((match) => match[1]);
}

/** The one DO $$ ... $$ block, and the SQL with it cut out. */
function splitDoBlock(sql: string): { block: string; rest: string } {
  const blocks = [...sql.matchAll(/DO \$\$[\s\S]*?\n\$\$;/g)];
  expect(blocks).toHaveLength(1);
  return { block: blocks[0][0], rest: sql.replace(blocks[0][0], '') };
}

/** Non-empty statements, whitespace collapsed, without the trailing semicolon. */
function statementsOf(sql: string): string[] {
  return sql
    .split(';')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function arrayLiteralsOf(block: string): string[] {
  const array = block.match(/ARRAY\[([\s\S]*?)\]/);
  expect(array).not.toBeNull();
  return literalsOf(array![1]);
}

function tsvFunctionRows(): string[][] {
  return read(TSV)
    .split('\n')
    .slice(1)
    .filter(Boolean)
    .map((line) => line.split('\t'))
    .filter((cols) => cols[0] === 'fn');
}

describe('the slice list agrees with the prod TSV (kind = fn rows only)', () => {
  const rows = tsvFunctionRows();

  it.each(SLICE_2)('$name: exactly one TSV row, same identity types, the one grant shape', (fn) => {
    const matches = rows.filter((cols) => cols[1] === fn.name);
    expect(matches).toHaveLength(1);
    const [, , identityArgs, , , , , , , , , executeGrantees, triggers] = matches[0];

    const types = identityArgs
      .split(',')
      .map((arg) => arg.trim().split(' ').slice(1).join(' '))
      .join(', ');
    expect(fn.signature).toBe(`public.${fn.name}(${types})`);

    expect(executeGrantees).toBe(TSV_GRANTEES);
    const restored = executeGrantees.split(' ').filter((grantee) => grantee !== 'postgres' && grantee !== 'service_role');
    expect(restored.join(', ')).toBe(ROLLBACK_GRANTEES);
    expect(triggers.trim()).toBe('0');
  });

  it('holds 13 distinct functions', () => {
    expect(new Set(SLICE_2.map((fn) => fn.name)).size).toBe(13);
  });
});

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
  // an identifier (2026-10-04). Banned as a substring, in any case (SA W-5).
  it.each(files)('%s never contains "into" anywhere', (_name, file) => {
    expect(read(file)).not.toMatch(/into/i);
  });

  it.each(files)('%s holds only plain literals, apart from its pinned punctuated allow-list', (name, file) => {
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

  it.each(files)('%s names every function schema-qualified with public (R-7)', (_name, file) => {
    const text = read(file);
    for (const match of text.matchAll(/ON FUNCTION (\S+)/g)) expect(match[1].startsWith('public.')).toBe(true);
  });

  it.each(files)('%s uses no LIKE pattern (SA W-2)', (_name, file) => {
    expect(read(file)).not.toMatch(/\bI?LIKE\b/i);
  });

  // The slice 6 guard scans scripts/*.sql too (its O-1 tripwire) and flags the
  // phrase even inside a string. None of these files has a reason to say it.
  it.each(files)('%s never says SECURITY DEFINER, not even in a string', (_name, file) => {
    expect(read(file)).not.toMatch(/SECURITY\s+DEFINER/i);
  });
});

describe('the migration: 13 revoke and grant pairs plus in-transaction post-conditions', () => {
  const { block, rest } = splitDoBlock(migration);
  const statements = statementsOf(rest);

  it('is one BEGIN ... COMMIT', () => {
    expect(statements[0]).toBe('BEGIN');
    expect(statements[statements.length - 1]).toBe('COMMIT');
    expect(statements.filter((s) => s === 'BEGIN' || s === 'COMMIT')).toHaveLength(2);
  });

  it('holds exactly one REVOKE from all three client grantees and one GRANT to service_role per function, in order', () => {
    const expected = SIGNATURES.flatMap((sig) => [
      `REVOKE EXECUTE ON FUNCTION ${sig} FROM PUBLIC, anon, authenticated`,
      `GRANT EXECUTE ON FUNCTION ${sig} TO service_role`,
    ]);
    expect(statements.slice(1, -1)).toEqual(expected);
  });

  it('every REVOKE lists PUBLIC, anon and authenticated (C-8)', () => {
    const revokes = statements.filter((s) => s.startsWith('REVOKE'));
    expect(revokes).toHaveLength(13);
    for (const revoke of revokes) expect(revoke).toMatch(/ FROM PUBLIC, anon, authenticated$/);
  });

  it('the ON FUNCTION signature set equals the slice list', () => {
    const named = [...rest.matchAll(/ON FUNCTION (public\.\w+\([^)]*\))/g)].map((match) => match[1]);
    expect(sorted([...new Set(named)])).toEqual(sorted(SIGNATURES));
  });

  it('the post-condition array holds exactly the slice signatures', () => {
    expect(sorted(arrayLiteralsOf(block))).toEqual(sorted(SIGNATURES));
  });

  it('the post-condition fails, never skips, on a missing function (C-2)', () => {
    expect(block).toContain('slice_function := pg_catalog.to_regprocedure(slice_signature);');
    expect(block).toMatch(/IF slice_function IS NULL THEN\s+RAISE EXCEPTION/);
  });

  it('the post-condition raises when a client role still executes or service_role lost it (C-7 direct booleans)', () => {
    for (const role of ['public', 'anon', 'authenticated']) {
      expect(block).toMatch(
        new RegExp(`IF pg_catalog\\.has_function_privilege\\('${role}', slice_function, 'EXECUTE'\\) THEN\\s+RAISE EXCEPTION`)
      );
    }
    expect(block).toMatch(
      /IF NOT pg_catalog\.has_function_privilege\('service_role', slice_function, 'EXECUTE'\) THEN\s+RAISE EXCEPTION/
    );
    expect(block).not.toMatch(/\bSELECT\b/i);
  });

  it('changes no body, search_path, owner or other object', () => {
    expect(migration).not.toMatch(/\b(ALTER|CREATE|DROP|CASCADE|TABLE|OWNER)\b/);
    expect(migration).not.toMatch(/SECURITY|search_path|REVOKE ALL/i);
  });
});

describe('the rollback restores the measured prod pre-state', () => {
  const { block, rest } = splitDoBlock(rollback);
  const statements = statementsOf(rest);

  it('is one BEGIN ... COMMIT of 13 GRANT statements to PUBLIC, anon and authenticated, in order', () => {
    expect(statements[0]).toBe('BEGIN');
    expect(statements[statements.length - 1]).toBe('COMMIT');
    expect(statements.slice(1, -1)).toEqual(SIGNATURES.map((sig) => `GRANT EXECUTE ON FUNCTION ${sig} TO ${ROLLBACK_GRANTEES}`));
  });

  it('revokes nothing and touches no other object', () => {
    expect(rollback).not.toMatch(/\b(REVOKE|ALTER|CREATE|DROP|CASCADE|TABLE)\b/);
  });

  it('checks in the same transaction that all four roles execute again (slice 1 SA ruling Q-4)', () => {
    expect(sorted(arrayLiteralsOf(block))).toEqual(sorted(SIGNATURES));
    expect(block).toMatch(/IF slice_function IS NULL THEN\s+RAISE EXCEPTION/);
    for (const role of ['public', 'anon', 'authenticated', 'service_role']) {
      expect(block).toMatch(
        new RegExp(`IF NOT pg_catalog\\.has_function_privilege\\('${role}', slice_function, 'EXECUTE'\\) THEN\\s+RAISE EXCEPTION`)
      );
    }
    expect(block).not.toMatch(/\bSELECT\b/i);
  });
});

describe('the checker and the pre-check', () => {
  const writeKeywords = /\b(INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|ALTER|DROP|CREATE)\b/;

  it('both are read-only from their first statement and write nothing (word-boundary match, SA W-5)', () => {
    for (const text of [checker, precheck]) {
      expect(statementsOf(text)[0]).toBe('SET default_transaction_read_only = on');
      expect(text).not.toMatch(writeKeywords);
    }
  });

  it('both list exactly the slice signatures', () => {
    for (const text of [checker, precheck]) {
      const listed = literalsOf(text).filter((literal) => literal.startsWith('public.'));
      expect(sorted(listed)).toEqual(sorted(SIGNATURES));
    }
  });

  it('the checker reports a VERDICT row first, PASS only when every check passes', () => {
    expect(checker).toContain("'VERDICT' AS check_name");
    expect(checker).toMatch(/CASE WHEN EXISTS \(SELECT 1 FROM checks WHERE checks\.result <> 'PASS'\) THEN 'FAIL' ELSE 'PASS' END/);
    expect(checker).toContain('ORDER BY report.sort_order');
  });

  it('the checker expects public, anon and authenticated false and service_role true, and a NULL fails (C-2)', () => {
    for (const expectation of ["('public', false, 3)", "('anon', false, 4)", "('authenticated', false, 5)", "('service_role', true, 6)"]) {
      expect(checker).toContain(expectation);
    }
    expect(checker).toContain("WHEN role_privilege.expected_held AND role_privilege.is_held IS TRUE THEN 'PASS'");
    expect(checker).toContain("WHEN NOT role_privilege.expected_held AND role_privilege.is_held IS FALSE THEN 'PASS'");
  });

  it('the checker checks existence and owner postgres (C-3), 6 checks per function', () => {
    expect(checker).toContain("'C1 exists '");
    expect(checker).toContain("'C2 owner postgres '");
    expect(checker).toContain("CASE WHEN slice_owner.owner_name = 'postgres' THEN 'PASS' ELSE 'FAIL' END");
  });

  it('the pre-check tells the user to run the migration in a NEW tab', () => {
    expect(precheck).toContain('run the migration in a NEW tab');
  });

  it('the pre-check carries every marker, the grantor row (W-1), Q11 and the status row, and no Q10', () => {
    for (const marker of [
      "'PRECHECK STATUS'",
      "'Q1 exists '",
      "'Q2 owner '",
      "'Q3 secdef '",
      "'Q4 privileges '",
      "'Q5 grantees '",
      "'Q5 grantors '",
      "'Q6 callers count '",
      "'Q6 caller '",
      "'Q7 policies count '",
      "'Q7 policy '",
      "'Q8 views count '",
      "'Q8 view '",
      "'Q9 cron '",
      "'Q11 dependents count '",
      "'Q11 dependent '",
    ]) {
      expect(precheck).toContain(marker);
    }
    expect(precheck).toContain("' OTHER GRANTOR stop here'");
    expect(precheck).toContain('ORDER BY final_report.sort_order, final_report.item');
    // Q10 resolved the bare pg_* lock names in slice 1; no slice 2 name shadows a built-in.
    expect(precheck).not.toMatch(/Q10|is_lock_wrapper|bare_signature/);
  });

  // SA S2-1: pg_depend is the only catalog that records column defaults, CHECK
  // constraints, index expressions, rules and policy expressions calling the
  // function. Those run as the inserting role. In slice 2 any dependent stops.
  it('the pre-check Q11 reads pg_depend for the function, describes each dependent with its catalog and deptype, and stops on any row', () => {
    expect(precheck).toContain('JOIN pg_catalog.pg_depend');
    expect(precheck).toContain("ON pg_depend.refclassid = 'pg_proc'::regclass");
    expect(precheck).toContain('AND pg_depend.refobjid = fn_state.fn_oid');
    expect(precheck).toContain('pg_catalog.pg_describe_object(pg_depend.classid, pg_depend.objid, pg_depend.objsubid)');
    expect(precheck).toContain('pg_depend.classid::regclass::text AS dependent_catalog');
    expect(precheck).toContain('pg_depend.deptype::text AS dependent_type');
    expect(precheck).toMatch(/'Q11 dependent '[\s\S]*?\|\| ' stop here'\s+FROM dependent_hit/);
  });

  it('the pre-check expected grantees equal the TSV execute_grantees, read directly from the TSV', () => {
    const rows = tsvFunctionRows();
    for (const fn of SLICE_2) {
      const matches = rows.filter((cols) => cols[1] === fn.name);
      expect(matches).toHaveLength(1);
      expect(precheck).toContain(`('${fn.name}', '${fn.signature}', ${SLICE_2.indexOf(fn) + 1}, '${matches[0][11]}')`);
    }
  });

  it('the pre-check reads cron.job only behind to_regclass', () => {
    expect(precheck).toMatch(/WHEN pg_catalog\.to_regclass\('cron\.job'\) IS NULL THEN 'cron not installed'\s+WHEN strpos\(lower\(query_to_xml\('TABLE cron\.job'/);
  });

  // Slice 1 prod pre-check 2026-10-08: a C-collated actual list against a
  // default-collated expected list read DIFFERS on equal sets. Every
  // string_agg ordering is pinned to an explicit COLLATE "C".
  it('the pre-check orders every string_agg with COLLATE "C" so both Q5 sides sort the same on any database collation', () => {
    const total = (precheck.match(/string_agg\(/g) ?? []).length;
    const aggregates = [...precheck.matchAll(/string_agg\(([\s\S]*?)\)\s+FROM /g)].map((match) => match[1]);
    expect(total).toBeGreaterThanOrEqual(4);
    expect(aggregates).toHaveLength(total);
    for (const aggregate of aggregates) {
      const orderBy = aggregate.match(/ORDER BY ([\s\S]*)$/);
      expect(orderBy).not.toBeNull();
      expect(orderBy![1].trim()).toMatch(/ COLLATE "C"$/);
    }
  });
});

// SA S2-2: the two negative-call blocks the user pastes after apply live in the
// workplan's QA section (not a sixth file), so the paste rules are checked there.
describe('the negative-call blocks in the workplan QA section', () => {
  const workplan = read(WORKPLAN);
  const section = workplan.slice(workplan.indexOf('### Negative call check'));
  const blocks = [...section.slice(0, section.indexOf('\n---')).matchAll(/```sql\n([\s\S]*?)```/g)].map((match) => match[1]);

  it('holds exactly two blocks: anon on get_user_credit_balance and authenticated on get_user_subscription_info', () => {
    expect(blocks).toHaveLength(2);
    expect(statementsOf(blocks[0])).toEqual([
      'BEGIN',
      'SET LOCAL ROLE anon',
      'SELECT public.get_user_credit_balance(NULL::uuid)',
      'ROLLBACK',
    ]);
    expect(statementsOf(blocks[1])).toEqual([
      'BEGIN',
      'SET LOCAL ROLE authenticated',
      'SELECT public.get_user_subscription_info(NULL::uuid)',
      'ROLLBACK',
    ]);
  });

  it('both are paste-safe: no literal, no comment, no "into"', () => {
    for (const block of blocks) {
      expect(block).not.toContain("'");
      expect(block).not.toContain('--');
      expect(block).not.toContain('/*');
      expect(block).not.toMatch(/into/i);
    }
  });
});
