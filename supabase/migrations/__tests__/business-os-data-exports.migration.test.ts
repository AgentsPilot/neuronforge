/**
 * Guard over migration 20261074, the data export jobs table, start function
 * and private bucket (data export DE-8a; workplan
 * BUSINESS_OS_DATA_EXPORT_DE8A_WORKPLAN.md §3, §8.1, SA conditions C-1 to C-9).
 *
 * WHY A TEST OVER SQL TEXT: there is no branch database. TL pastes the
 * pre-check, the migration, the checker, the probe and, if needed, the
 * rollback into the Supabase SQL editor by hand. The probe proves the
 * behaviour on PROD (always rolled back); this file pins the text so a later
 * edit cannot quietly loosen the rate limit, the tenant scope or the grants.
 *
 * Each rule is a detector over SQL text. The negative controls feed planted,
 * broken copies to the same detectors, so a detector that cannot fail is
 * caught here and not on PROD.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { EXPORT_JOB_POLICY } from '@/lib/business-os/data-export/jobPolicy';
// The stamp of the 20261075 cleanup function. Was the generated CLEANUP_FUNCTION_VERSION; finance 4b.1's
// 20261077 moved that on (2026-10-17), and the DE-8a checker and rollback name the 20261075 function itself.
const CLEANUP_FUNCTION_VERSION = 'a824848e0a538477';

const ROOT = process.cwd();
const FILE = {
  migration: join(ROOT, 'supabase', 'migrations', '20261074_business_os_data_exports.sql'),
  precheck: join(ROOT, 'scripts', 'precheck-business-os-data-exports.sql'),
  checker: join(ROOT, 'scripts', 'check-business-os-data-exports.sql'),
  probe: join(ROOT, 'scripts', 'probe-business-os-data-exports.sql'),
  rollback: join(ROOT, 'scripts', 'rollback-business-os-data-exports.sql'),
  measure: join(ROOT, 'scripts', 'measure-data-export-size.sql'),
};
const CLEANUP_MIGRATION = join(ROOT, 'supabase', 'migrations', '20261075_operator_test_account_cleanup_data_exports.sql');

const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

const migration = read(FILE.migration);

function between(sql: string, start: string, end: string): string {
  const from = sql.indexOf(start);
  expect([start, from >= 0]).toEqual([start, true]);
  const to = sql.indexOf(end, from + start.length);
  expect([end, to > from]).toEqual([end, true]);
  return sql.slice(from, to + end.length);
}

const functionOf = (sql: string) => between(sql, 'CREATE FUNCTION public.business_os_data_export_start(', '$start$;');
const bodyOf = (sql: string) => between(sql, 'AS $start$', '$start$;');
const tableOf = (sql: string) => between(sql, 'CREATE TABLE public.business_os_data_exports (', '\n);');
const statementsOf = (body: string) => body.split(';').map(squash).filter(Boolean);
const outsideBlocks = (sql: string) => sql.replace(/DO \$(\w+)\$[\s\S]*?\$\1\$;/g, '').replace(/AS \$start\$[\s\S]*?\$start\$;/g, '');

// ── Detectors (each returns its problems; [] means the rule holds) ─────────

/** MT-5: RLS on, no policy, browser roles revoked, no grant to a browser role. */
function grantProblems(sql: string): string[] {
  const problems: string[] = [];
  if (!/ALTER TABLE public\.business_os_data_exports ENABLE ROW LEVEL SECURITY;/.test(sql)) problems.push('RLS not enabled');
  if (/CREATE POLICY/i.test(sql)) problems.push('a policy is created');
  if (!sql.includes('REVOKE ALL ON TABLE public.business_os_data_exports FROM PUBLIC, anon, authenticated, service_role;')) {
    problems.push('table revoke missing');
  }
  for (const grant of statementsOf(outsideBlocks(sql)).filter((s) => /^GRANT\b/i.test(s))) {
    if (/\bTO\b.*\b(anon|authenticated|PUBLIC)\b/i.test(grant)) problems.push(`grant to a browser role: ${grant}`);
    if (/\bALL\b/i.test(grant)) problems.push(`blanket grant: ${grant}`);
  }
  if (!sql.includes('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.business_os_data_exports TO service_role;')) {
    problems.push('service_role grant is not exactly SELECT, INSERT, UPDATE, DELETE (SA C-4)');
  }
  return problems;
}

/** MT-6 + C-5: invoker, volatile, fixed search_path, EXECUTE for service_role only after the CREATE. */
function functionProblems(sql: string): string[] {
  const problems: string[] = [];
  const fn = functionOf(sql);
  const header = fn.slice(0, fn.indexOf('AS $start$'));
  if (!header.includes('LANGUAGE plpgsql\nVOLATILE\nSECURITY INVOKER\nSET search_path = pg_catalog, public, pg_temp\n')) {
    problems.push('header is not plpgsql, VOLATILE, SECURITY INVOKER, fixed search_path');
  }
  if (/\b(STABLE|IMMUTABLE)\b/i.test(header)) problems.push('declared STABLE or IMMUTABLE (SA C-5)');
  if (/SECURITY\s+DEFINER/i.test(sql)) problems.push('SECURITY DEFINER appears (SA Q-1)');
  const sig = 'public.business_os_data_export_start(uuid, uuid, text)';
  const revoke = sql.indexOf(`REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC, anon, authenticated, service_role;`);
  const grant = sql.indexOf(`GRANT EXECUTE ON FUNCTION ${sig} TO service_role;`);
  const create = sql.indexOf('CREATE FUNCTION public.business_os_data_export_start(');
  if (!(create >= 0 && revoke > create && grant > revoke)) problems.push('REVOKE then GRANT EXECUTE not after the CREATE');
  const functionGrants = statementsOf(outsideBlocks(sql)).filter((s) => /^GRANT .* ON FUNCTION/i.test(s));
  if (functionGrants.length !== 1) problems.push(`expected one function grant, found ${functionGrants.length}`);
  return problems;
}

/** MT-7: the advisory lock is the first statement after the input guards, before any table statement. */
function lockProblems(sql: string): string[] {
  const body = bodyOf(sql);
  const lock = body.indexOf("PERFORM pg_catalog.pg_advisory_xact_lock(\n    pg_catalog.hashtextextended('business_os_data_export:' || p_user_id::text, 0));");
  const firstTable = body.search(/public\.business_os_data_exports/);
  const lastGuard = body.lastIndexOf('END IF;', lock);
  if (lock < 0) return ['advisory lock missing'];
  const problems: string[] = [];
  if (!(firstTable > lock)) problems.push('a table statement runs before the lock');
  if (squash(body.slice(lastGuard + 'END IF;'.length, lock)) !== '') problems.push('something runs between the guards and the lock');
  return problems;
}

/** MT-8: stale rule is running only, created_at < now() - 90 seconds. */
function staleProblems(sql: string): string[] {
  const stale = statementsOf(bodyOf(sql)).find((s) => s.startsWith('UPDATE public.business_os_data_exports'));
  if (!stale) return ['stale UPDATE missing'];
  const expected =
    "UPDATE public.business_os_data_exports AS job SET status = 'failed', failure_reason = 'timeout', finished_at = now(), updated_at = now() " +
    "WHERE job.user_id = p_user_id AND job.status = 'running' AND job.created_at < now() - interval '90 seconds'";
  return stale === expected ? [] : [`stale rule changed: ${stale}`];
}

/** MT-9: three per rolling 24 hours over running, ready, expired; failed never counts. */
function dailyProblems(sql: string): string[] {
  const body = squash(bodyOf(sql));
  const expected =
    'v_third_newest := ( SELECT job.created_at FROM public.business_os_data_exports AS job WHERE job.user_id = p_user_id ' +
    "AND job.status IN ('running', 'ready', 'expired') AND job.created_at > now() - interval '24 hours' " +
    'ORDER BY job.created_at DESC OFFSET 2 LIMIT 1)';
  const problems: string[] = [];
  if (!body.includes(expected)) problems.push('daily count changed');
  const counted = body.match(/job\.status IN \(([^)]*)\) AND job\.created_at >/);
  if (counted && /'failed'/.test(counted[1])) problems.push('failed is counted');
  if (!body.includes("RETURN QUERY SELECT 'daily_limit'::text, NULL::uuid, v_third_newest + interval '24 hours';")) {
    problems.push('daily_limit retry time changed');
  }
  return problems;
}

/** MT-10: every table statement in the body is scoped by user_id = p_user_id; the INSERT names p_user_id. */
function tenantProblems(sql: string): string[] {
  const problems: string[] = [];
  const statements = statementsOf(bodyOf(sql));
  const touching = statements.filter((s) => /(FROM|UPDATE) public\.business_os_data_exports/.test(s));
  if (touching.length !== 3) problems.push(`expected 3 scoped statements, found ${touching.length}`);
  for (const statement of touching) {
    if (!/\bjob\.user_id = p_user_id\b/.test(statement)) problems.push(`unscoped: ${statement.slice(0, 80)}`);
  }
  const insert = statements.find((s) => s.includes('INSERT INTO public.business_os_data_exports'));
  if (!insert || !insert.includes('VALUES (p_user_id, p_requested_by, p_requested_by_kind, \'running\')')) {
    problems.push('the INSERT does not name p_user_id first');
  }
  if (!functionOf(sql).startsWith('CREATE FUNCTION public.business_os_data_export_start(p_user_id uuid, p_requested_by uuid, p_requested_by_kind text)\n')) {
    problems.push('the function takes other arguments than the account, the requester and the kind (no job id)');
  }
  return problems;
}

/** MT-12: bucket inserted private, 50 MB, zip only, no ON CONFLICT, no storage DDL. */
function bucketProblems(sql: string): string[] {
  const problems: string[] = [];
  const insert =
    "INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)\n" +
    "VALUES ('business-data-exports', 'business-data-exports', false, 52428800, ARRAY['application/zip']::text[]);";
  if (!sql.includes(insert)) problems.push('bucket insert changed');
  if (/ON CONFLICT/i.test(sql)) problems.push('ON CONFLICT present');
  if (/COMMENT ON (TABLE )?storage|DROP POLICY|CREATE POLICY/i.test(sql)) problems.push('storage DDL present (V-6)');
  if (!/LIKE '%business-data-exports%'/.test(sql)) problems.push('the pg_policies assertion does not name the bucket');
  return problems;
}

/** SA C-1 and C-2: the expiry CHECK has no NULL hole and uses 72 hours. */
function expiryProblems(sql: string): string[] {
  const table = tableOf(sql);
  const problems: string[] = [];
  const expected =
    "CHECK ((ready_at IS NULL) = (expires_at IS NULL) AND (ready_at IS NULL OR expires_at = ready_at + interval '72 hours'))";
  if (!table.includes(expected)) problems.push('expiry CHECK is not the NULL-safe 72 hour form');
  if (/\(ready_at IS NULL AND expires_at IS NULL\) OR/.test(table)) problems.push('the old NULL-hole form is present');
  if (/interval '3 days'/.test(sql)) problems.push("'3 days' is session time zone dependent (SA C-2)");
  return problems;
}

// ── The rules over the real files ──────────────────────────────────────────

describe('MT-1 one transaction', () => {
  const code = migration.split('\n').filter((line) => !line.startsWith('--')).join('\n').trim();

  it('BEGIN, lock timeout first, NOTIFY last before COMMIT', () => {
    expect(code.startsWith("BEGIN;\n\nSET LOCAL lock_timeout = '5s';\n")).toBe(true);
    expect(code.endsWith("NOTIFY pgrst, 'reload schema';\n\nCOMMIT;")).toBe(true);
    expect(code.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(code.match(/^COMMIT;$/gm)).toHaveLength(1);
  });

  it('a pre-guard refuses when the table, function or bucket exists, or browser roles may CREATE', () => {
    const guard = between(migration, 'DO $pre_guard$', '$pre_guard$;');
    expect(migration.indexOf('DO $pre_guard$')).toBeLessThan(migration.indexOf('CREATE TABLE'));
    expect(guard).toContain("pg_catalog.has_schema_privilege('anon', 'public', 'CREATE')");
    expect(guard).toContain("pg_catalog.has_schema_privilege('authenticated', 'public', 'CREATE')");
    expect(guard).toContain("pg_catalog.to_regclass('public.business_os_data_exports') IS NOT NULL");
    expect(guard).toContain("pg_catalog.to_regprocedure('public.business_os_data_export_start(uuid, uuid, text)') IS NOT NULL");
    expect(guard).toContain("bucket.id = 'business-data-exports'");
    expect(guard.match(/RAISE EXCEPTION/g)).toHaveLength(4);
  });
});

describe('MT-2 / MT-3 the table', () => {
  const table = tableOf(migration);

  it('has exactly the planned columns and types', () => {
    const columns = [...table.matchAll(/^ {2}(\w+)\s+(uuid|text|bigint|integer|timestamptz)\b/gm)].map((m) => `${m[1]} ${m[2]}`);
    expect(columns).toEqual([
      'id uuid', 'user_id uuid', 'requested_by uuid', 'requested_by_kind text', 'status text', 'failure_reason text',
      'bytes bigint', 'file_count integer', 'row_count integer', 'created_at timestamptz', 'finished_at timestamptz',
      'ready_at timestamptz', 'expires_at timestamptz', 'expired_at timestamptz', 'owner_downloaded_at timestamptz',
      'updated_at timestamptz',
    ]);
  });

  it('has exactly one foreign key, user_id to auth.users on delete cascade; requested_by has none (SA Q-2)', () => {
    expect(table.match(/REFERENCES/g)).toHaveLength(1);
    expect(table).toContain('user_id             uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,');
    expect(table).toMatch(/^ {2}requested_by {8}uuid {8}NOT NULL,$/m);
  });

  it('pins the status, reason and kind lists and the owner-is-requester rule', () => {
    expect(table).toContain("CHECK (status IN ('queued', 'running', 'ready', 'failed', 'expired'))");
    expect(table).toContain("CHECK (failure_reason IS NULL OR failure_reason IN ('over_ceiling', 'timeout', 'error'))");
    expect(table).toContain("CHECK (requested_by_kind IN ('owner', 'admin'))");
    expect(table).toContain("CHECK (requested_by_kind <> 'owner' OR requested_by = user_id)");
    expect(table.match(/CONSTRAINT business_os_data_exports_\w+/g)).toHaveLength(11);
  });

  it('C-1 / C-2: the expiry CHECK is NULL-safe and 72 hours', () => {
    expect(expiryProblems(migration)).toEqual([]);
  });

  it('C-1: every other boolean = CHECK compares only IS [NOT] NULL or NOT NULL operands', () => {
    for (const check of [...table.matchAll(/CHECK \(\((.+)\) = \((.+)\)\)$/gm)]) {
      for (const side of [check[1], check[2]]) {
        expect([side, /IS (NOT )?NULL$|^status (=|IN) /.test(side)]).toEqual([side, true]);
      }
    }
  });

  it('has no trigger', () => {
    expect(migration).not.toMatch(/CREATE (OR REPLACE )?TRIGGER/i);
  });
});

describe('MT-4 one export in progress per account', () => {
  it('a unique index on user_id where status is queued or running', () => {
    expect(squash(migration)).toContain(
      "CREATE UNIQUE INDEX business_os_data_exports_one_in_progress ON public.business_os_data_exports (user_id) WHERE status IN ('queued', 'running');"
    );
  });

  it('a unique violation at insert is answered as in_progress, not raised', () => {
    expect(squash(bodyOf(migration))).toContain(
      "EXCEPTION WHEN unique_violation THEN RETURN QUERY SELECT 'in_progress'::text, NULL::uuid, now() + interval '90 seconds'; RETURN;"
    );
  });
});

describe('the rules over the real migration', () => {
  it('MT-5 grants', () => expect(grantProblems(migration)).toEqual([]));
  it('MT-6 / C-5 function header and EXECUTE', () => expect(functionProblems(migration)).toEqual([]));
  it('MT-7 the lock comes first', () => expect(lockProblems(migration)).toEqual([]));
  it('MT-8 stale rule', () => expect(staleProblems(migration)).toEqual([]));
  it('MT-9 daily count', () => expect(dailyProblems(migration)).toEqual([]));
  it('MT-10 tenant scope', () => expect(tenantProblems(migration)).toEqual([]));
  it('MT-12 bucket', () => expect(bucketProblems(migration)).toEqual([]));

  it('input guards raise 22023 for bad arguments and an owner kind with another requester', () => {
    const body = squash(bodyOf(migration));
    expect(body).toContain(
      "IF p_user_id IS NULL OR p_requested_by IS NULL OR p_requested_by_kind IS NULL OR p_requested_by_kind NOT IN ('owner', 'admin') THEN RAISE EXCEPTION USING ERRCODE = '22023'"
    );
    expect(body).toContain("IF p_requested_by_kind = 'owner' AND p_requested_by <> p_user_id THEN RAISE EXCEPTION USING ERRCODE = '22023'");
    expect(body).toContain("RETURN QUERY SELECT 'in_progress'::text, NULL::uuid, v_in_progress_since + interval '90 seconds';");
  });
});

describe('MT-11 the SQL literals equal EXPORT_JOB_POLICY (SA Q-10)', () => {
  const body = bodyOf(migration);

  it('limit, window, stale rule, retention, bucket', () => {
    expect(body).toContain(`OFFSET ${EXPORT_JOB_POLICY.DAILY_LIMIT - 1} LIMIT 1`);
    expect(body.match(/interval '(\d+) hours'/g)).toEqual(Array(2).fill(`interval '${EXPORT_JOB_POLICY.DAILY_WINDOW_HOURS} hours'`));
    expect(body.match(/interval '(\d+) seconds'/g)).toEqual(Array(3).fill(`interval '${EXPORT_JOB_POLICY.STALE_RUNNING_SECONDS} seconds'`));
    expect(tableOf(migration)).toContain(`ready_at + interval '${EXPORT_JOB_POLICY.RETENTION_HOURS} hours'`);
    expect(migration).toContain(`'${EXPORT_JOB_POLICY.BUCKET}', '${EXPORT_JOB_POLICY.BUCKET}', false, ${EXPORT_JOB_POLICY.BUCKET_FILE_SIZE_LIMIT_BYTES}, ARRAY['${EXPORT_JOB_POLICY.BUCKET_MIME_TYPE}']`);
    expect(migration).toContain(`bucket.file_size_limit = ${EXPORT_JOB_POLICY.BUCKET_FILE_SIZE_LIMIT_BYTES}`);
  });
});

describe('MT-13 the post-condition block covers every item', () => {
  const block = between(migration, 'DO $post_condition$', '$post_condition$;');

  it('runs after the bucket insert and before NOTIFY', () => {
    expect(migration.indexOf('DO $post_condition$')).toBeGreaterThan(migration.indexOf('INSERT INTO storage.buckets'));
    expect(migration.indexOf('DO $post_condition$')).toBeLessThan(migration.indexOf("NOTIFY pgrst, 'reload schema';"));
  });

  it.each([
    ['1 RLS and no policy', ['cls.relrowsecurity', "pol.tablename = 'business_os_data_exports'"]],
    ['2 browser roles hold nothing', ["ARRAY['public', 'anon', 'authenticated']", 'has_table_privilege(v_role, v_table, v_privilege)', 'has_any_column_privilege(v_role, v_table, v_privilege)', "'TRUNCATE', 'REFERENCES', 'TRIGGER'"]],
    ['3 service_role exactly four', ["has_table_privilege('service_role', v_table, v_privilege)", "ARRAY['TRUNCATE', 'REFERENCES', 'TRIGGER']"]],
    ['4 unique partial index', ['ix.indisunique', "LIKE '%(user_id) WHERE (status = ANY (ARRAY[''queued''::text, ''running''::text]))'"]],
    ['5 function', ['NOT fn.prosecdef', "fn.provolatile = 'v'", "fn.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']", 'aclexplode(fn.proacl)', 'acl.grantee = 0', 'fn.proacl IS NOT NULL', "has_function_privilege('anon', v_function, 'EXECUTE')", "has_function_privilege('service_role', v_function, 'EXECUTE')"]],
    ['6 bucket', ['bucket.public = false', 'bucket.file_size_limit = 52428800', "bucket.allowed_mime_types = ARRAY['application/zip']::text[]"]],
    ['7 storage policies (named and C-9 unrestricted)', ["LIKE '%business-data-exports%'", "NOT LIKE '%bucket_id%'", "pol.roles && ARRAY['public', 'anon', 'authenticated']::name[]"]],
    ['8 no trigger and one cascade FK', ['NOT trg.tgisinternal', "con.contype = 'f'", "con.confdeltype = 'c'", "att.attname = 'user_id'"]],
  ])('item %s', (item, needles) => {
    expect(block).toContain(`post-condition ${item.split(' ')[0]}`);
    for (const needle of needles) expect([item, needle, block.includes(needle)]).toEqual([item, needle, true]);
  });
});

// ── Paste safety, every file ───────────────────────────────────────────────

const ALL: Array<[string, string]> = Object.entries(FILE).map(([name, file]) => [name, file]);

/** Removes the SQL keywords the editor accepts (INSERT INTO, RETURNING x.y INTO). */
const withoutIntoKeywords = (sql: string) => sql.replace(/\bINSERT INTO /g, '').replace(/\bRETURNING \w+\.\w+ INTO /g, '');

describe('MT-14 / MT-15 SQL-editor safety and companion files', () => {
  it.each(ALL)('%s exists', (_name, file) => expect(existsSync(file)).toBe(true));

  it.each(ALL)('%s has "into" only as the INSERT INTO / RETURNING INTO keyword', (_name, file) => {
    expect(withoutIntoKeywords(read(file))).not.toMatch(/into/i);
  });

  it('the exact keyword counts: migration 3, probe 8, the others 0', () => {
    const count = (file: string) => (read(file).match(/into/gi) ?? []).length;
    expect(count(FILE.migration)).toBe(3);
    expect(count(FILE.probe)).toBe(8);
    for (const file of [FILE.precheck, FILE.checker, FILE.rollback, FILE.measure]) expect(count(file)).toBe(0);
  });

  it.each(ALL)('%s never says SECURITY DEFINER (the guard treats it in a DO body as F-2)', (_name, file) => {
    expect(read(file)).not.toMatch(/SECURITY\s+DEFINER/i);
  });

  it.each(ALL)('%s has an even number of single quotes and closes its dollar quotes', (_name, file) => {
    const sql = read(file);
    expect((sql.match(/'/g) ?? []).length % 2).toBe(0);
    expect((sql.match(/\$[A-Za-z_]*\$/g) ?? []).length % 2).toBe(0);
  });

  it.each(ALL)('%s keeps comments to header lines without semicolons or apostrophes', (_name, file) => {
    const lines = read(file).split('\n');
    const firstCode = lines.findIndex((line) => line !== '' && !line.startsWith('--'));
    lines.forEach((line, index) => {
      if (line.includes('--')) {
        expect([index, line.startsWith('-- ') && index < firstCode && !/[;']/.test(line)]).toEqual([index, true]);
      }
    });
    expect(read(file)).not.toContain('/*');
  });

  it('the pre-check, checker and measure script are read-only', () => {
    for (const file of [FILE.precheck, FILE.checker, FILE.measure]) {
      const sql = read(file);
      expect(sql.startsWith('SET default_transaction_read_only = on;\n')).toBe(true);
      expect(sql.replace(/'[^']*'/g, "''")).not.toMatch(/\b(INSERT|UPDATE|DELETE|GRANT|REVOKE|DROP|ALTER|CREATE|TRUNCATE)\b/);
    }
  });

  it('the pre-check carries Q1 to Q11, Q11 being the C-9 unrestricted storage policy query', () => {
    const precheck = read(FILE.precheck);
    for (let q = 1; q <= 11; q += 1) expect(precheck).toContain(`'Q${q}`);
    expect(precheck).toContain("NOT LIKE '%bucket_id%'");
  });
});

describe('MT-15 the checker', () => {
  const checker = read(FILE.checker);

  it('ends in a VERDICT row over PASS / FAIL rows; NULL counts as FAIL, so it reports FAIL before apply', () => {
    expect(checker).toContain("SELECT 99, 'VERDICT',");
    expect(checker).toContain("CASE WHEN COALESCE(results.passed, false) THEN 'PASS' ELSE 'FAIL' END AS status");
    expect(checker.trimEnd().endsWith('ORDER BY results.check_order;')).toBe(true);
    expect(checker.match(/^ {2}SELECT \d+, 'C\d\d /gm)).toHaveLength(17);
  });

  it('C-4, C-5, C-9 and the cleanup stamp each have a row', () => {
    expect(checker).toContain("'C07 service_role lacks TRUNCATE, REFERENCES and TRIGGER'");
    expect(checker).toContain("fn.provolatile = 'v'");
    expect(checker).toContain("'C15 no storage policy opens every bucket to browser roles'");
    expect(checker).toContain(`position('${CLEANUP_FUNCTION_VERSION}' IN fn.prosrc) > 0`);
    expect(read(CLEANUP_MIGRATION)).toContain(`'version', '${CLEANUP_FUNCTION_VERSION}'`);
  });
});

describe('MT-15 the probe (SA C-3)', () => {
  const probe = read(FILE.probe);
  const serviceStart = probe.indexOf('  SET LOCAL ROLE service_role;');
  const serviceEnd = probe.indexOf('  RESET ROLE;');

  it('is one DO block that refuses read-only sessions and unknown ids, and always ends by raising', () => {
    expect(probe.startsWith('DO $probe$\n')).toBe(true);
    expect(probe.trimEnd().endsWith('$probe$;')).toBe(true);
    expect(probe).toContain("IF current_setting('transaction_read_only') = 'on' THEN");
    expect(probe).toContain('IF NOT EXISTS (SELECT 1 FROM auth.users AS u WHERE u.id = v_user) THEN');
    expect(probe).toContain("v_user_text text := 'paste-your-user-id-here';");
    const last = probe.trimEnd().split('\n').slice(-3).join('\n');
    expect(last).toContain("RAISE EXCEPTION 'PROBE PASS P1 to P14. This error is expected and rolls everything back';");
  });

  it('every P1 to P11 start runs as service_role, and the role is restored and checked', () => {
    expect(serviceStart).toBeGreaterThan(0);
    expect(serviceEnd).toBeGreaterThan(serviceStart);
    expect(probe.slice(serviceStart, serviceStart + 120)).toContain("IF current_user <> 'service_role' THEN");
    // Calls only: the refusal check names the signature, (uuid, uuid, text), as the editor role.
    const starts = [...probe.matchAll(/public\.business_os_data_export_start\((?!uuid)/g)].map((m) => m.index!);
    const p12 = probe.indexOf("RAISE NOTICE 'P12 PASS");
    const before = starts.filter((index) => index < probe.indexOf("RAISE NOTICE 'P11 PASS"));
    expect(before).toHaveLength(17);
    for (const index of before) expect(index > serviceStart && index < serviceEnd).toBe(true);
    expect(probe.slice(serviceEnd, serviceEnd + 120)).toContain('IF current_user <> v_me THEN');
    expect(starts.filter((index) => index > serviceEnd && index < p12)).toHaveLength(1);
  });

  it('P12 and P13 switch roles only inside blocks that catch 42501, and check the role after each', () => {
    const blocks = [...probe.matchAll(/BEGIN\n {4}SET LOCAL ROLE (authenticated|anon);\n {4}PERFORM 1 FROM [^\n]+\n {2}EXCEPTION WHEN insufficient_privilege THEN v_raised := true;\n {2}END;\n {2}IF NOT v_raised THEN RAISE EXCEPTION 'PROBE FAIL P1[23][^\n]+\n {2}IF current_user <> v_me THEN RAISE EXCEPTION/g)];
    expect(blocks.map((m) => m[1])).toEqual(['authenticated', 'authenticated', 'anon', 'anon']);
    expect(probe.match(/SET LOCAL ROLE (authenticated|anon);/g)).toHaveLength(4);
  });

  it('reports every step P1 to P13 and the P14 note', () => {
    for (let step = 1; step <= 13; step += 1) expect(probe).toContain(`RAISE NOTICE 'P${step} PASS`);
    expect(probe).toContain("RAISE NOTICE 'P14 INFO");
  });

  it('tests both boundaries: 89 / 91 seconds and 23 h 59 m / 24 h 1 s', () => {
    for (const age of ["interval '91 seconds'", "interval '89 seconds'", "interval '24 hours 1 second'", "interval '23 hours 59 minutes'"]) {
      expect(probe).toContain(age);
    }
  });
});

describe('MT-15 the rollback', () => {
  const rollback = read(FILE.rollback);

  it('refuses while the bucket holds files or any live cleanup function names the table, then drops function before table', () => {
    const guard = between(rollback, 'DO $rollback_guard$', '$rollback_guard$;');
    expect(guard).toContain("obj.bucket_id = 'business-data-exports'");
    // SA-CR-4B1-R R-1: content, not a stamp, so every later cleanup version (20261077 on) also blocks it.
    expect(guard).toContain("position('business_os_data_exports' IN fn.prosrc) > 0");
    expect(guard).not.toContain(`position('${CLEANUP_FUNCTION_VERSION}' IN fn.prosrc)`);
    expect(guard).toContain('Roll back the live cleanup version (20261077, then 20261075) first');
    const dropFunction = rollback.indexOf('DROP FUNCTION IF EXISTS public.business_os_data_export_start(uuid, uuid, text);');
    const dropTable = rollback.indexOf('DROP TABLE IF EXISTS public.business_os_data_exports;');
    expect(rollback.indexOf('$rollback_guard$;')).toBeLessThan(dropFunction);
    expect(dropFunction).toBeLessThan(dropTable);
    expect(dropFunction).toBeGreaterThan(0);
  });

  it('leaves the bucket row for the dashboard and is one transaction', () => {
    expect(rollback).not.toMatch(/DELETE FROM storage|DROP .*storage/i);
    expect(rollback).toContain('delete it in the Storage dashboard');
    expect(rollback.startsWith("BEGIN;\n\nSET LOCAL lock_timeout = '5s';\n")).toBe(true);
    expect(rollback.trimEnd().endsWith('COMMIT;')).toBe(true);
  });
});

// ── Negative controls: each detector can fail ──────────────────────────────

describe('MT-NC planted broken copies fail their detector', () => {
  const plant = (from: string, to: string) => {
    expect(migration).toContain(from);
    return migration.replace(from, to);
  };

  it("'failed' in the counted list fails MT-9", () => {
    expect(dailyProblems(plant("job.status IN ('running', 'ready', 'expired')", "job.status IN ('running', 'ready', 'expired', 'failed')"))).not.toEqual([]);
  });

  it('a statement missing user_id = p_user_id fails MT-10', () => {
    expect(tenantProblems(plant('WHERE job.user_id = p_user_id AND job.status IN', 'WHERE job.status IN'))).not.toEqual([]);
  });

  it('a GRANT SELECT to authenticated fails MT-5', () => {
    expect(grantProblems(plant('COMMIT;', 'GRANT SELECT ON TABLE public.business_os_data_exports TO authenticated;\n\nCOMMIT;'))).not.toEqual([]);
  });

  it('queued in the stale rule fails MT-8', () => {
    expect(staleProblems(plant("AND job.status = 'running'", "AND job.status IN ('queued', 'running')"))).not.toEqual([]);
  });

  it('ON CONFLICT DO NOTHING on the bucket fails MT-12', () => {
    expect(bucketProblems(plant("ARRAY['application/zip']::text[]);", "ARRAY['application/zip']::text[])\nON CONFLICT DO NOTHING;"))).not.toEqual([]);
  });

  it('the old NULL-hole expiry CHECK fails C-1', () => {
    const old = "CHECK ((ready_at IS NULL AND expires_at IS NULL) OR expires_at = ready_at + interval '72 hours')";
    expect(expiryProblems(plant(
      "CHECK ((ready_at IS NULL) = (expires_at IS NULL) AND (ready_at IS NULL OR expires_at = ready_at + interval '72 hours'))",
      old
    ))).not.toEqual([]);
  });

  it("'3 days' in the expiry CHECK fails C-2", () => {
    expect(expiryProblems(plant("ready_at + interval '72 hours'))", "ready_at + interval '3 days'))"))).not.toEqual([]);
  });

  it('a STABLE function fails C-5', () => {
    expect(functionProblems(plant('LANGUAGE plpgsql\nVOLATILE\n', 'LANGUAGE plpgsql\nSTABLE\n'))).not.toEqual([]);
  });

  it('a lock moved after the stale UPDATE fails MT-7', () => {
    const lock = "  PERFORM pg_catalog.pg_advisory_xact_lock(\n    pg_catalog.hashtextextended('business_os_data_export:' || p_user_id::text, 0));\n\n";
    const moved = plant(lock, '').replace("  v_in_progress_since := (", `${lock}  v_in_progress_since := (`);
    expect(lockProblems(moved)).not.toEqual([]);
  });

  it('a grant to service_role of ALL fails MT-5 (SA C-4)', () => {
    expect(grantProblems(plant(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.business_os_data_exports TO service_role;',
      'GRANT ALL ON TABLE public.business_os_data_exports TO service_role;'
    ))).not.toEqual([]);
  });
});

describe('DE-10a pins (workplan §9 T-21, T-22; SA W10-8)', () => {
  it('T-21 (DX-4): the limits have no kind predicate, so an admin-started export counts against the account', () => {
    const touching = statementsOf(bodyOf(migration)).filter((s) => /(FROM|UPDATE) public\.business_os_data_exports/.test(s));
    expect(touching.length).toBeGreaterThan(0);
    for (const statement of touching) {
      expect({ statement: statement.slice(0, 80), kind: statement.includes('requested_by_kind') }).toEqual({ statement: statement.slice(0, 80), kind: false });
    }
    const index = squash(migration).match(/CREATE UNIQUE INDEX business_os_data_exports_one_in_progress [^;]*;/)?.[0] ?? '';
    expect(index).not.toBe('');
    expect(index).not.toContain('requested_by_kind');
  });

  it('T-22: the hard delete (20261075) counts AND lists for removal the export bucket under the account folder', () => {
    const cleanup = read(CLEANUP_MIGRATION);
    const lines = cleanup.split('\n');
    const BUCKETS = "objects.bucket_id IN ('contact-documents', 'website-images', 'business-purge-snapshots', 'business-data-exports') AND starts_with(objects.name, target.user_id::text || '/')";
    // Guard G-12, in both copies (the check and the delete): the login is not removed while such an object remains.
    expect(lines.filter((line) => line.includes('SELECT count(*) FROM storage.objects AS objects') && line.includes(BUCKETS))).toHaveLength(2);
    // The storage rows the delete runner removes exactly (runCleanupDelete empties what the check lists).
    const storageRows = cleanup.indexOf("SELECT 3, 'storage', 0, 'empty this folder'");
    expect(storageRows).toBeGreaterThan(0);
    expect(cleanup.slice(storageRows, cleanup.indexOf('UNION ALL', storageRows))).toContain(`WHERE ${BUCKETS}`);
  });
});
