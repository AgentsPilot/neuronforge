/**
 * Guard over migration 20261044, SECURITY DEFINER lockdown slice 1
 * (docs/requirements/SECURITY_DEFINER_FUNCTIONS_LOCKDOWN_REQUIREMENT.md FR-1,
 * workplan docs/workplans/SECDEF_LOCKDOWN_SLICE1_WORKPLAN.md).
 *
 * Revokes EXECUTE from PUBLIC, anon and authenticated on 13 functions (the
 * queue claim/reap drains, the two public.pg_* advisory-lock wrappers and
 * auto_disable_ineffective_behavior_rules) and keeps service_role.
 *
 * WHY A TEST OVER SQL TEXT: there is no branch database. The user pastes the
 * pre-check, the migration (in a NEW tab), the checker and, if ever needed,
 * the rollback into the Supabase SQL editor by hand (FR-0.6). Same pattern as
 * the 20261039/20261040 boost_packs tests, extended with the C-8 asserts.
 *
 * The prod TSV is the source of truth for signatures and grantees, so the test
 * reads it: the signatures and the rollback grantees are checked against it,
 * not copied by hand.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const MIGRATION = join(ROOT, 'supabase', 'migrations', '20261044_secdef_lockdown_slice1_drains_locks.sql');
const ROLLBACK = join(ROOT, 'supabase', 'SQL Scripts', '20261044_secdef_lockdown_slice1_drains_locks_rollback.sql');
const CHECKER = join(ROOT, 'scripts', 'check-secdef-lockdown-slice1-migration.sql');
const PRECHECK = join(ROOT, 'scripts', 'precheck-secdef-lockdown-slice1.sql');
const TSV = join(ROOT, 'docs', 'investigations', 'secdef_prod_inventory_2026-10-07.tsv');

const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const migration = read(MIGRATION);
const rollback = read(ROLLBACK);
const checker = read(CHECKER);
const precheck = read(PRECHECK);

interface SliceFunction {
  name: string;
  signature: string;
  /** Grantees the rollback restores: the TSV grantees minus the owner (postgres) and service_role. */
  rollbackGrantees: string;
}

const DRAIN = 'PUBLIC';
const OPEN = 'PUBLIC, anon, authenticated';

/** FR-1, in the order of the workplan §1.1. */
const SLICE_1: SliceFunction[] = [
  { name: 'claim_due_daily_briefings', signature: 'public.claim_due_daily_briefings(uuid, integer)', rollbackGrantees: DRAIN },
  { name: 'claim_due_insight_actions', signature: 'public.claim_due_insight_actions(uuid, integer)', rollbackGrantees: DRAIN },
  { name: 'claim_due_lead_responses', signature: 'public.claim_due_lead_responses(uuid, integer)', rollbackGrantees: DRAIN },
  {
    name: 'claim_due_payment_automation_executions',
    signature: 'public.claim_due_payment_automation_executions(uuid, integer)',
    rollbackGrantees: DRAIN,
  },
  { name: 'claim_due_payment_reminders', signature: 'public.claim_due_payment_reminders(uuid, integer)', rollbackGrantees: DRAIN },
  { name: 'reap_stale_daily_briefings', signature: 'public.reap_stale_daily_briefings(integer, integer)', rollbackGrantees: DRAIN },
  { name: 'reap_stale_insight_actions', signature: 'public.reap_stale_insight_actions(integer, integer)', rollbackGrantees: DRAIN },
  { name: 'reap_stale_lead_responses', signature: 'public.reap_stale_lead_responses(integer, integer)', rollbackGrantees: DRAIN },
  {
    name: 'reap_stale_payment_automation_executions',
    signature: 'public.reap_stale_payment_automation_executions(integer, integer)',
    rollbackGrantees: DRAIN,
  },
  { name: 'reap_stale_payment_reminders', signature: 'public.reap_stale_payment_reminders(integer, integer)', rollbackGrantees: DRAIN },
  { name: 'pg_try_advisory_lock', signature: 'public.pg_try_advisory_lock(bigint)', rollbackGrantees: OPEN },
  { name: 'pg_advisory_unlock', signature: 'public.pg_advisory_unlock(bigint)', rollbackGrantees: OPEN },
  {
    name: 'auto_disable_ineffective_behavior_rules',
    signature: 'public.auto_disable_ineffective_behavior_rules(integer, numeric)',
    rollbackGrantees: OPEN,
  },
];

const SIGNATURES = SLICE_1.map((fn) => fn.signature);
const sorted = (values: string[]) => [...values].sort();

/** Punctuated literals each file may hold (C-7, SA ruling Q-1). Everything else must be plain. */
const PUNCTUATED_ALLOWED: Record<string, string[]> = {
  migration: SIGNATURES,
  rollback: SIGNATURES,
  checker: SIGNATURES,
  precheck: [...SIGNATURES, 'pg_try_advisory_lock(bigint)', 'pg_advisory_unlock(bigint)', 'cron.job', 'TABLE cron.job'],
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

describe('the slice list agrees with the prod TSV (kind = fn rows only)', () => {
  const rows = read(TSV)
    .split('\n')
    .slice(1)
    .filter(Boolean)
    .map((line) => line.split('\t'))
    .filter((cols) => cols[0] === 'fn');

  it.each(SLICE_1)('$name: exactly one TSV row, same identity types, rollback grantees derived from it', (fn) => {
    const matches = rows.filter((cols) => cols[1] === fn.name);
    expect(matches).toHaveLength(1);
    const [, , identityArgs, , , , , , , , , executeGrantees] = matches[0];

    const types = identityArgs
      .split(',')
      .map((arg) => arg.trim().split(' ').slice(1).join(' '))
      .join(', ');
    expect(fn.signature).toBe(`public.${fn.name}(${types})`);

    const restored = executeGrantees.split(' ').filter((grantee) => grantee !== 'postgres' && grantee !== 'service_role');
    expect(restored.join(', ')).toBe(fn.rollbackGrantees);
    expect(executeGrantees.split(' ')).toContain('service_role');
  });

  it('holds 13 distinct functions', () => {
    expect(new Set(SLICE_1.map((fn) => fn.name)).size).toBe(13);
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

  it('is one BEGIN ... COMMIT of 13 GRANT statements with the TSV grantees, in order', () => {
    expect(statements[0]).toBe('BEGIN');
    expect(statements[statements.length - 1]).toBe('COMMIT');
    expect(statements.slice(1, -1)).toEqual(
      SLICE_1.map((fn) => `GRANT EXECUTE ON FUNCTION ${fn.signature} TO ${fn.rollbackGrantees}`)
    );
  });

  it('revokes nothing and touches no other object', () => {
    expect(rollback).not.toMatch(/\b(REVOKE|ALTER|CREATE|DROP|CASCADE|TABLE)\b/);
  });

  it('checks in the same transaction that all four roles execute again (SA ruling Q-4)', () => {
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

  it('the pre-check carries every marker, the grantor row (W-1) and the status row', () => {
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
      "'Q10 bare name resolves '",
    ]) {
      expect(precheck).toContain(marker);
    }
    expect(precheck).toContain("' OTHER GRANTOR stop here'");
    expect(precheck).toContain('ORDER BY final_report.sort_order, final_report.item');
  });

  it('the pre-check expected grantees equal the TSV execute_grantees, read directly from the TSV', () => {
    const tsvRows = read(TSV)
      .split('\n')
      .slice(1)
      .map((line) => line.split('\t'))
      .filter((cols) => cols[0] === 'fn');
    for (const fn of SLICE_1) {
      const matches = tsvRows.filter((cols) => cols[1] === fn.name);
      expect(matches).toHaveLength(1);
      const tsvGrantees = matches[0][11];
      expect(precheck).toContain(`('${fn.name}', '${fn.signature}', ${SLICE_1.indexOf(fn) + 1}, '${tsvGrantees}'`);
    }
  });

  it('the pre-check reads cron.job only behind to_regclass, and resolves both bare lock names', () => {
    expect(precheck).toMatch(/WHEN pg_catalog\.to_regclass\('cron\.job'\) IS NULL THEN 'cron not installed'\s+WHEN strpos\(lower\(query_to_xml\('TABLE cron\.job'/);
    expect(precheck).toContain("'pg_try_advisory_lock(bigint)')");
    expect(precheck).toContain("'pg_advisory_unlock(bigint)')");
  });

  // Prod pre-check 2026-10-08: Q5 compared a C-collated actual list (grantee
  // names derive from type name) with a default-collated expected list, so
  // 'PUBLIC' sorted differently on each side and all 13 rows read DIFFERS
  // although the sets matched. PGlite runs in C collation and cannot show it,
  // so every string_agg ordering is pinned to an explicit COLLATE "C".
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
