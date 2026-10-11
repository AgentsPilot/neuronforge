/**
 * Guard over migration 20261051, SECURITY DEFINER lockdown slice 5
 * (docs/requirements/SECURITY_DEFINER_FUNCTIONS_LOCKDOWN_REQUIREMENT.md FR-5,
 * workplan docs/workplans/SECDEF_LOCKDOWN_SLICE5_WORKPLAN.md).
 *
 * Removes client EXECUTE (PUBLIC, anon, authenticated) from the last 18
 * anon-executable SECURITY DEFINER functions in public. Every one is a trigger
 * function, and service_role is kept (SA Q-1). PostgreSQL checks EXECUTE on a
 * trigger function only at CREATE TRIGGER, never when the trigger fires, so no
 * write path changes; the slice is hygiene plus closing client CREATE TRIGGER.
 *
 * WHY A TEST OVER SQL TEXT: there is no branch database. The user pastes the
 * pre-check, the migration (in a NEW tab), the checker, the acceptance blocks
 * and, if ever needed, the rollback into the Supabase SQL editor by hand
 * (FR-0.6). Same shape as the slice 2 to 4a tests, with the slice 5 changes:
 * the slice list is derived from the TSV kind = trigger rows, the pre-check
 * checks the return type (Q3, SA Q-3) and judges pg_trigger dependents with an
 * exactly-one count (Q11, SA Q-2), the D1 surface row is information only
 * (SA S5-2), and the acceptance blocks follow SA Q-5 and S5-1.
 *
 * The slice 6 guard (supabase/__tests__/security-definer-surface.guard.test.ts)
 * scans this migration on every run. Its analyser is not imported: importing a
 * .test.ts file would register and re-run every guard suite inside this file.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const MIGRATION = join(ROOT, 'supabase', 'migrations', '20261051_secdef_lockdown_slice5_trigger_functions.sql');
const ROLLBACK = join(ROOT, 'supabase', 'SQL Scripts', '20261051_secdef_lockdown_slice5_trigger_functions_rollback.sql');
const CHECKER = join(ROOT, 'scripts', 'check-secdef-lockdown-slice5-migration.sql');
const PRECHECK = join(ROOT, 'scripts', 'precheck-secdef-lockdown-slice5.sql');
const TSV = join(ROOT, 'docs', 'investigations', 'secdef_prod_inventory_2026-10-07.tsv');
const WORKPLAN = join(ROOT, 'docs', 'workplans', 'SECDEF_LOCKDOWN_SLICE5_WORKPLAN.md');

const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const migration = read(MIGRATION);
const rollback = read(ROLLBACK);
const checker = read(CHECKER);
const precheck = read(PRECHECK);

/** The one prod grant shape (TSV), and what the rollback grants back. */
const TSV_GRANTEES = 'PUBLIC postgres anon authenticated service_role';
const ROLLBACK_GRANTEES = 'PUBLIC, anon, authenticated';

/** FR-5, in the order of the workplan §1.1. */
const FR_5 = [
  'advance_contact_on_completed_booking',
  'auto_set_agent_org_id',
  'create_user_settings',
  'increment_smart_link_click_count',
  'link_subscriber_to_contact',
  'log_document_activity',
  'log_exchange_rate_change',
  'marketing_consent_project',
  'promote_contact_on_payment',
  'update_user_storage_used',
  'tg_activity_reply_events',
  'tg_booking_events',
  'tg_contact_events',
  'tg_invoice_events',
  'tg_page_view_events',
  'tg_proposal_events',
  'tg_service_events',
  'tg_transaction_events',
];

/** Already closed by 20261009, so not in this slice. */
const ALREADY_CLOSED = ['business_os_plan_fact_onboarding', 'business_os_plan_fact_profile'];

const SLICE_5 = FR_5.map((name) => ({ name, signature: `public.${name}()` }));
const SIGNATURES = SLICE_5.map((fn) => fn.signature);
const sorted = (values: string[]) => [...values].sort();

/** The two regclass literals of the D1 surface row (SA S5-2). */
const D1_TABLES = ['public.scheduling_services', 'public.business_events'];

/** Punctuated literals each file may hold (C-7). Everything else must be plain. */
const PUNCTUATED_ALLOWED: Record<string, string[]> = {
  migration: SIGNATURES,
  rollback: SIGNATURES,
  checker: SIGNATURES,
  precheck: [...SIGNATURES, 'cron.job', 'TABLE cron.job', ...D1_TABLES],
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
  const array = block.match(/ARRAY\[([\s\S]*?)\]\s+LOOP/);
  expect(array).not.toBeNull();
  return literalsOf(array![1]);
}

function tsvTriggerRows(): string[][] {
  return read(TSV)
    .split('\n')
    .slice(1)
    .filter(Boolean)
    .map((line) => line.split('\t'))
    .filter((cols) => cols[0] === 'trigger');
}

const roleCheck = (role: string, negate: boolean) =>
  new RegExp(
    `IF ${negate ? 'NOT ' : ''}pg_catalog\\.has_function_privilege\\('${role}', slice_function, 'EXECUTE'\\) THEN\\s+RAISE EXCEPTION`
  );

describe('the slice list agrees with the prod TSV (kind = trigger rows)', () => {
  const rows = tsvTriggerRows();

  it.each(SLICE_5)('$name: exactly one TSV trigger row, no arguments, the one grant shape, one trigger', (fn) => {
    const matches = rows.filter((cols) => cols[1] === fn.name);
    expect(matches).toHaveLength(1);
    const [, , identityArgs, nargs, , , , xAnon, , xService, , executeGrantees, triggers] = matches[0];

    expect(identityArgs).toBe('');
    expect(nargs).toBe('0');
    expect(fn.signature).toBe(`public.${fn.name}()`);
    expect(xAnon).toBe('t');
    expect(xService).toBe('t');
    expect(executeGrantees).toBe(TSV_GRANTEES);
    const restored = executeGrantees.split(' ').filter((grantee) => !['postgres', 'service_role'].includes(grantee));
    expect(restored.join(', ')).toBe(ROLLBACK_GRANTEES);
    expect(triggers.trim()).toBe('1');
  });

  it('the slice is exactly the anon-executable trigger rows, and the two closed plan-fact rows are excluded', () => {
    const anonTriggers = rows.filter((cols) => cols[7] === 't').map((cols) => cols[1]);
    expect(sorted(anonTriggers)).toEqual(sorted(FR_5));
    for (const name of ALREADY_CLOSED) {
      const closed = rows.filter((cols) => cols[1] === name);
      expect(closed).toHaveLength(1);
      expect(closed[0][7]).toBe('f');
      expect(SIGNATURES.join(' ')).not.toContain(name);
    }
    expect(rows).toHaveLength(FR_5.length + ALREADY_CLOSED.length);
  });

  it('holds 18 distinct functions', () => {
    expect(new Set(SIGNATURES).size).toBe(18);
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
  // an identifier (2026-10-04). Banned as a substring, in any case.
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

  it.each(files)('%s uses no LIKE pattern', (_name, file) => {
    expect(read(file)).not.toMatch(/\bI?LIKE\b/i);
  });

  // The slice 6 guard scans scripts/*.sql too (its O-1 tripwire) and flags the
  // phrase even inside a string. None of these files has a reason to say it.
  it.each(files)('%s never says SECURITY DEFINER, not even in a string', (_name, file) => {
    expect(read(file)).not.toMatch(/SECURITY\s+DEFINER/i);
  });
});

describe('the migration: 18 revoke and service_role grant pairs plus in-transaction post-conditions', () => {
  const { block, rest } = splitDoBlock(migration);
  const statements = statementsOf(rest);

  it('is one BEGIN ... COMMIT', () => {
    expect(statements[0]).toBe('BEGIN');
    expect(statements[statements.length - 1]).toBe('COMMIT');
    expect(statements.filter((s) => s === 'BEGIN' || s === 'COMMIT')).toHaveLength(2);
  });

  it('holds one REVOKE from all three client grantees and one GRANT to service_role per function, in order (FR-0.1, Q-1)', () => {
    const expected = SLICE_5.flatMap((fn) => [
      `REVOKE EXECUTE ON FUNCTION ${fn.signature} FROM PUBLIC, anon, authenticated`,
      `GRANT EXECUTE ON FUNCTION ${fn.signature} TO service_role`,
    ]);
    expect(statements.slice(1, -1)).toEqual(expected);
  });

  it('every REVOKE lists PUBLIC, anon and authenticated (C-8)', () => {
    const revokes = statements.filter((s) => s.startsWith('REVOKE'));
    expect(revokes).toHaveLength(18);
    for (const revoke of revokes) expect(revoke).toMatch(/ FROM PUBLIC, anon, authenticated$/);
  });

  it('every GRANT is to service_role only', () => {
    const grants = statements.filter((s) => s.startsWith('GRANT'));
    expect(grants).toHaveLength(18);
    for (const grant of grants) expect(grant).toMatch(/ TO service_role$/);
  });

  it('the ON FUNCTION signature set equals the slice list', () => {
    const named = [...rest.matchAll(/ON FUNCTION (public\.\w+\([^)]*\))/g)].map((match) => match[1]);
    expect(sorted([...new Set(named)])).toEqual(sorted(SIGNATURES));
  });

  it('the post-condition loop holds exactly the 18 signatures', () => {
    expect(sorted(arrayLiteralsOf(block))).toEqual(sorted(SIGNATURES));
  });

  it('the loop fails, never skips, on a missing function (C-2); public, anon and authenticated closed, service_role kept', () => {
    expect(block).toContain('slice_function := pg_catalog.to_regprocedure(slice_signature);');
    expect(block).toMatch(/IF slice_function IS NULL THEN\s+RAISE EXCEPTION/);
    expect(block).toMatch(roleCheck('public', false));
    expect(block).toMatch(roleCheck('anon', false));
    expect(block).toMatch(roleCheck('authenticated', false));
    expect(block).toMatch(roleCheck('service_role', true));
  });

  it('the DO block uses direct booleans only (C-7)', () => {
    expect(block).not.toMatch(/\bSELECT\b/i);
  });

  it('changes no body, search_path, owner, trigger or other object (SA Q-3)', () => {
    expect(migration).not.toMatch(/\b(ALTER|CREATE|DROP|CASCADE|TABLE|OWNER)\b/);
    expect(migration).not.toMatch(/SECURITY|search_path|REVOKE ALL/i);
    expect(migration).not.toMatch(/\btrigger\b/i);
  });
});

describe('the rollback restores the measured prod pre-state', () => {
  const { block, rest } = splitDoBlock(rollback);
  const statements = statementsOf(rest);

  it('is one BEGIN ... COMMIT of one GRANT per function to PUBLIC, anon and authenticated, in order', () => {
    expect(statements[0]).toBe('BEGIN');
    expect(statements[statements.length - 1]).toBe('COMMIT');
    expect(statements.slice(1, -1)).toEqual(
      SLICE_5.map((fn) => `GRANT EXECUTE ON FUNCTION ${fn.signature} TO ${ROLLBACK_GRANTEES}`)
    );
  });

  it('revokes nothing and touches no other object or trigger', () => {
    expect(rollback).not.toMatch(/\b(REVOKE|ALTER|CREATE|DROP|CASCADE|TABLE)\b/);
    expect(rollback).not.toMatch(/\btrigger\b/i);
  });

  it('checks in the same transaction that all four roles execute the 18 again', () => {
    expect(sorted(arrayLiteralsOf(block))).toEqual(sorted(SIGNATURES));
    expect(block).toMatch(/IF slice_function IS NULL THEN\s+RAISE EXCEPTION/);
    for (const role of ['public', 'anon', 'authenticated', 'service_role']) expect(block).toMatch(roleCheck(role, true));
    expect(block).not.toMatch(/\bSELECT\b/i);
  });
});

describe('the checker and the pre-check', () => {
  const writeKeywords = /\b(INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|ALTER|DROP|CREATE)\b/;

  it('both are read-only from their first statement and write nothing (word-boundary match)', () => {
    for (const text of [checker, precheck]) {
      expect(statementsOf(text)[0]).toBe('SET default_transaction_read_only = on');
      expect(text).not.toMatch(writeKeywords);
    }
  });

  it('both list exactly the slice signatures', () => {
    for (const text of [checker, precheck]) {
      const listed = literalsOf(text).filter((literal) => /^public\.\w+\(/.test(literal));
      expect(sorted(listed)).toEqual(sorted(SIGNATURES));
    }
  });

  it('the checker lists every function with keeps_authenticated false', () => {
    SLICE_5.forEach((fn, index) => {
      expect(checker).toContain(`('${fn.name}', '${fn.signature}', ${index + 1}, false)`);
    });
    expect(checker).not.toMatch(/'public\.[^']*', \d+, true\)/);
  });

  it('the checker reports a VERDICT row first, PASS only when every check passes', () => {
    expect(checker).toContain("'VERDICT' AS check_name");
    expect(checker).toMatch(/CASE WHEN EXISTS \(SELECT 1 FROM checks WHERE checks\.result <> 'PASS'\) THEN 'FAIL' ELSE 'PASS' END/);
    expect(checker).toContain('ORDER BY report.sort_order');
  });

  it('the checker expects public, anon and authenticated false, service_role true, and a NULL fails (C-2)', () => {
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

  it('the pre-check carries every marker, the grantor row, Q11, Q12 and the status row, and no Q0 or Q10', () => {
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
      "'Q12 d1 surface '",
      "'Q12 d1 verdict information only'",
    ]) {
      expect(precheck).toContain(marker);
    }
    expect(precheck).toContain("' OTHER GRANTOR stop here'");
    expect(precheck).toContain('ORDER BY final_report.sort_order, final_report.item');
    expect(precheck).not.toMatch(/Q0|vector|Q10|is_lock_wrapper|bare_signature|4b review/);
  });

  it('the pre-check expected grantees equal the TSV execute_grantees, read directly from the TSV', () => {
    const rows = tsvTriggerRows();
    SLICE_5.forEach((fn, index) => {
      const matches = rows.filter((cols) => cols[1] === fn.name);
      expect(matches).toHaveLength(1);
      expect(precheck).toContain(`('${fn.name}', '${fn.signature}', ${index + 1}, '${matches[0][11]}', false)`);
    });
  });

  it('the pre-check Q4 compares public against the shape, the other three must be true', () => {
    expect(precheck).toContain("strpos(watched.expected_grantees, 'PUBLIC') > 0 AS expects_public");
    expect(precheck).toContain(
      "WHEN pg_catalog.has_function_privilege('public', fn_state.fn_oid, 'EXECUTE') = fn_state.expects_public"
    );
  });

  // SA Q-3: a slice function that does not return trigger would be reachable
  // over /rpc, so the §1.4 argument would not hold for it.
  it('the pre-check Q3 is ok only for a SECDEF function that returns trigger, and shows type and language', () => {
    expect(precheck).toContain("pg_proc.prorettype = 'trigger'::regtype AS returns_trigger");
    expect(precheck).toContain('pg_catalog.format_type(pg_proc.prorettype, NULL) AS return_type');
    expect(precheck).toContain('fn_language.lanname::text AS language_name');
    expect(precheck).toContain(
      "CASE WHEN fn_state.is_secdef IS TRUE AND fn_state.returns_trigger IS TRUE THEN ' ok' ELSE ' stop here' END"
    );
  });

  // C-4 (SA Q-4): with keeps_authenticated false for all 18, an INVOKER caller
  // stops and a SECDEF caller stops unless owned by postgres.
  it('the pre-check Q6 keeps the C-4 caller rule and has no informational tag', () => {
    expect(precheck).toMatch(
      /CASE\s+WHEN caller_proc\.caller_secdef THEN caller_proc\.caller_owner <> 'postgres'\s+WHEN NOT caller_proc\.keeps_authenticated THEN true\s+WHEN caller_proc\.caller_is_trigger THEN true\s+ELSE caller_proc\.caller_anon_executes\s+END AS needs_stop/
    );
    expect(precheck).toMatch(/CASE WHEN caller_verdict\.needs_stop THEN ' stop here' ELSE ' ok' END\s+FROM caller_verdict/);
  });

  it('the pre-check Q7 stops on any policy whose roles include public, anon or authenticated', () => {
    expect(precheck).toMatch(/ELSE pg_policies\.roles && ARRAY\['public', 'anon', 'authenticated'\]::name\[\]/);
  });

  // SA Q-2: a pg_trigger dependent is ok and shows its table; any other catalog
  // stops; the count of pg_trigger dependents must be exactly 1 (TSV triggers).
  it('the pre-check Q11 judges pg_trigger dependents and requires exactly one per function', () => {
    expect(precheck).toContain('JOIN pg_catalog.pg_depend');
    expect(precheck).toContain("ON pg_depend.refclassid = 'pg_proc'::regclass");
    expect(precheck).toContain('AND pg_depend.refobjid = fn_state.fn_oid');
    expect(precheck).toContain('LEFT JOIN pg_catalog.pg_trigger AS dependent_trigger');
    expect(precheck).toContain(
      "NOT (pg_depend.classid = 'pg_trigger'::regclass AND dependent_trigger.oid IS NOT NULL) AS needs_stop"
    );
    expect(precheck).toContain("COALESCE(dependent_trigger.tgrelid::regclass::text, 'none') AS trigger_table");
    expect(precheck).toMatch(/AND dependent_hit\.is_trigger_dependent\) = 1\s+THEN ' ok'\s+ELSE ' expected exactly 1 trigger stop here'/);
    expect(precheck).toMatch(/'Q11 dependent '[\s\S]*?CASE WHEN dependent_hit\.needs_stop THEN ' stop here' ELSE ' ok' END\s+FROM dependent_hit/);
    expect(precheck).not.toContain('pg_policy AS dependent_policy');
  });

  // SA S5-2: information only. It gates D1, never the migration, so it must
  // never print the phrase PRECHECK STATUS counts.
  it('the pre-check Q12 lists the D1 surface and never says stop here', () => {
    expect(precheck).toContain("pg_trigger.tgrelid = pg_catalog.to_regclass('public.scheduling_services')");
    expect(precheck).toContain("pg_trigger.tgrelid = pg_catalog.to_regclass('public.business_events')");
    expect(precheck).toContain('WHERE NOT pg_trigger.tgisinternal');
    for (const known of ['tg_service_events', 'update_scheduling_services_updated_at', 'service_currency_lock']) {
      expect(precheck).toContain(`('${known}')`);
    }
    expect(precheck).toContain("strpos(lower(COALESCE(trigger_proc.prosrc, '')), 'http') > 0");
    expect(precheck).toContain("strpos(lower(COALESCE(trigger_proc.prosrc, '')), 'dblink') > 0");
    const q12 = precheck.slice(precheck.indexOf("'Q12 d1 surface '"), precheck.indexOf("'checked at utc'"));
    expect(q12).toContain('D1 SKIP use the logs');
    expect(q12).not.toContain('stop here');
    expect(precheck).toMatch(/WHEN \(SELECT count\(\*\) FROM report WHERE strpos\(report\.detail, 'stop here'\) > 0\) = 0 THEN 'CLEAN'/);
  });

  it('the pre-check reads cron.job only behind to_regclass', () => {
    expect(precheck).toMatch(/WHEN pg_catalog\.to_regclass\('cron\.job'\) IS NULL THEN 'cron not installed'\s+WHEN strpos\(lower\(query_to_xml\('TABLE cron\.job'/);
  });

  // Slice 1 prod pre-check 2026-10-08: equal sets read DIFFERS under mixed
  // collations. Every string_agg ordering is pinned to COLLATE "C".
  it('the pre-check orders every string_agg with COLLATE "C"', () => {
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

// SA Q-5, S5-1 and S3-4: the acceptance blocks the user pastes live in the
// workplan QA section (not extra files), so the paste rules are checked there.
describe('the acceptance blocks in the workplan QA section', () => {
  const workplan = read(WORKPLAN);
  const start = workplan.indexOf('### Acceptance blocks');
  const section = workplan.slice(start);
  const body = section.slice(0, section.indexOf('\n---'));
  const blocks = [...body.matchAll(/```sql\n([\s\S]*?)```/g)].map((match) => match[1]);
  const hours = (count: number) => `pg_catalog.now() - pg_catalog.make_interval(hours => ${count})`;
  const roleBlock = (role: string, statement: string) => ['BEGIN', `SET LOCAL ROLE ${role}`, statement, 'ROLLBACK'];
  const D1_LITERALS = ['request.jwt.claims', 'sub'];

  const EXPECTED: Array<[string, string[]]> = [
    ['N1', roleBlock('anon', 'SELECT public.tg_service_events()')],
    [
      'D1',
      [
        'BEGIN',
        "SELECT pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', admin_users.user_id)::text, true) AS claims_set FROM public.admin_users WHERE admin_users.is_active AND admin_users.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.scheduling_services WHERE scheduling_services.user_id = admin_users.user_id AND scheduling_services.price IS NOT NULL) ORDER BY admin_users.user_id LIMIT 1",
        'SET LOCAL ROLE authenticated',
        'UPDATE public.scheduling_services SET price = scheduling_services.price + 1 WHERE scheduling_services.user_id = auth.uid() AND scheduling_services.price IS NOT NULL',
        'RESET ROLE',
        'SELECT (SELECT count(*) FROM public.scheduling_services WHERE scheduling_services.user_id = auth.uid() AND scheduling_services.price IS NOT NULL) AS priced_services, (SELECT count(*) FROM public.business_events WHERE business_events.user_id = auth.uid() AND business_events.created_at >= pg_catalog.now()) AS events_this_transaction',
        'ROLLBACK',
      ],
    ],
    ['N2', roleBlock('authenticated', 'SELECT public.create_user_settings()')],
    ['P1', roleBlock('service_role', 'SELECT public.tg_service_events()')],
    [
      'EVENTS',
      [
        `SELECT business_events.event_type, count(*) AS events FROM public.business_events WHERE business_events.created_at >= ${hours(24)} GROUP BY business_events.event_type ORDER BY business_events.event_type`,
      ],
    ],
    [
      'SIGNUP',
      [
        `SELECT count(*) AS new_users, count(profiles.id) AS with_profile FROM auth.users LEFT JOIN public.profiles ON profiles.id = users.id WHERE users.created_at >= ${hours(24)}`,
      ],
    ],
  ];

  it('the section exists and holds exactly the blocks, in order', () => {
    expect(start).toBeGreaterThan(0);
    expect(blocks).toHaveLength(EXPECTED.length);
  });

  it.each(EXPECTED.map(([name], index) => [name, index] as [string, number]))('block %s is pinned statement for statement', (_name, index) => {
    expect(statementsOf(blocks[index])).toEqual(EXPECTED[index][1]);
  });

  it('every block is paste-safe: no comment, no "into", no single-letter alias, no timestamp literal; only D1 holds its two literals', () => {
    blocks.forEach((block, index) => {
      expect(block).not.toContain('--');
      expect(block).not.toContain('/*');
      expect(block).not.toMatch(/into/i);
      expect(block).not.toMatch(/\bAS [a-z]\b/i);
      expect(block).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(block).not.toMatch(/\b(timestamp|interval)\s+'/i);
      expect(literalsOf(block)).toEqual(EXPECTED[index][0] === 'D1' ? D1_LITERALS : []);
    });
  });

  it('every role block ends in ROLLBACK, so nothing persists and the role reverts', () => {
    blocks.forEach((block) => {
      const statements = statementsOf(block);
      if (statements[0] === 'BEGIN') expect(statements[statements.length - 1]).toBe('ROLLBACK');
    });
  });

  // SA S5-1, S5-2 and S5-3: the lead-ins carry the wording and the rules the user acts on.
  it('the lead-ins carry the S5-1 wording, the S5-2 gate and the unconditional rollback rule', () => {
    expect(body).toContain("an active admin account's own rows");
    expect(body).toContain('Run D1 only when the pre-check row `Q12 d1 verdict information only` reads `D1 may run`');
    expect(body).toContain('roll back at once, without waiting for attribution');
    expect(body).toContain('Optional (SA Q-5).');
  });
});
