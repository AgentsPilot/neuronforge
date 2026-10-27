/**
 * Module export MX-1a (workplan §3, §6 T-1; SA Review Notes 2026-10-26 M-1, M-2, M-3, M-5, M-6, M-8):
 * migration 20261095, its rollback, the pre-check and the 20261095 checker.
 *
 * The SQL literals are the authority (the limits, the window, the lease, the
 * attempt caps, the batch clamps), and moduleExportPolicy.ts mirrors them.
 * This suite fails CI when the two disagree. One SQL site per mirror constant
 * (M-5): each site has its own pin, and a planted copy proves that a change at
 * one site fails only that pin.
 *
 * Source pins only: no database, no network. The behaviour is proved on the
 * QA replica (workplan §6, QA 1 to 8).
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  CODE_SHAPE,
  EXPORT_REQUEST_ORIGINS,
  MODULE_EXPORT_POLICY,
  MODULE_JOB_IN_FLIGHT,
  MODULE_JOB_NOT_COUNTED,
  MODULE_JOB_STATUSES,
  NOTICE_STATES,
  PART_STATES,
} from '@/lib/business-os/data-export/moduleExportPolicy';

/** The function names, literal here: this test does not import the repositories (their callers guard). */
const START_FUNCTION = 'business_os_export_request_start';
const CLAIM_FUNCTION = 'business_os_export_module_jobs_claim_due';
const REAP_FUNCTION = 'business_os_export_module_jobs_reap';

const ROOT = process.cwd();
/** CRLF normalised first (Windows checkouts, the #394 flake pattern). */
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n');

const MIGRATION = read('supabase', 'migrations', '20261095_business_os_export_requests.sql');
const ROLLBACK = read('supabase', 'SQL Scripts', '20261095_business_os_export_requests_rollback.sql');
const PRECHECK = read('scripts', 'precheck-export-requests.sql');
const CHECKER = read('scripts', 'check-export-requests-migration.sql');
const CHECKER_96 = read('scripts', 'check-test-account-cleanup-export-requests-migration.sql');

const REQUESTS = 'public.business_os_export_requests';
const JOBS = 'public.business_os_export_module_jobs';
const START_SIGNATURE = `public.${START_FUNCTION}(uuid, text, uuid, text[])`;
const CLAIM_SIGNATURE = `public.${CLAIM_FUNCTION}(uuid, integer)`;
const REAP_SIGNATURE = `public.${REAP_FUNCTION}()`;

const quoted = (values: ReadonlyArray<string>) => values.map((value) => `'${value}'`).join(', ');

/** The CREATE TABLE statement of one table. */
function createTable(sql: string, table: string): string {
  const start = sql.indexOf(`CREATE TABLE ${table} (`);
  return start < 0 ? '' : sql.slice(start, sql.indexOf('\n);\n', start) + 3);
}

/** The body of one dollar-quoted function, between its tags. */
function body(sql: string, tag: string): string {
  const open = `AS $${tag}$`;
  const start = sql.indexOf(open);
  if (start < 0) return '';
  const from = start + open.length;
  return sql.slice(from, sql.indexOf(`$${tag}$;`, from));
}

/** The statement that creates a function, up to its AS. */
function header(sql: string, name: string): string {
  const start = sql.indexOf(`CREATE FUNCTION public.${name}(`);
  const end = start < 0 ? -1 : sql.indexOf('\nAS $', start);
  return start < 0 || end < 0 ? '' : sql.slice(start, end);
}

const requestsTable = createTable(MIGRATION, REQUESTS);
const jobsTable = createTable(MIGRATION, JOBS);
const startBody = body(MIGRATION, 'start');
const claimBody = body(MIGRATION, 'claim');
const reapBody = body(MIGRATION, 'reap');

/** The literal pins, one key per SQL site (M-5). Every value is true on the committed SQL. */
type Policy = { -readonly [K in keyof typeof MODULE_EXPORT_POLICY]: number };
function literalPins(sql: string, policy: Policy = { ...MODULE_EXPORT_POLICY }): Record<string, boolean> {
  const start = body(sql, 'start');
  const claim = body(sql, 'claim');
  const reap = body(sql, 'reap');
  const jobs = createTable(sql, JOBS);
  const requests = createTable(sql, REQUESTS);
  const numbers = (text: string, pattern: RegExp) => [...text.matchAll(pattern)].map((match) => Number(match[1]));
  const all = (found: number[], expected: number, count: number) => found.length === count && found.every((n) => n === expected);
  const limits = [...start.matchAll(/v_limit := CASE WHEN p_origin = 'owner' THEN (\d+) ELSE (\d+) END;/g)];
  return {
    OWNER_DAILY_LIMIT: limits.length === 1 && Number(limits[0][1]) === policy.OWNER_DAILY_LIMIT,
    ADMIN_DAILY_LIMIT_PER_OWNER: limits.length === 1 && Number(limits[0][2]) === policy.ADMIN_DAILY_LIMIT_PER_OWNER,
    DAILY_WINDOW_HOURS: all(numbers(start, /interval '(\d+) hours'/g), policy.DAILY_WINDOW_HOURS, 2),
    'MAX_MODULES_PER_REQUEST@table': all(numbers(requests, /cardinality\(modules\) BETWEEN 1 AND (\d+)/g), policy.MAX_MODULES_PER_REQUEST, 1),
    'MAX_MODULES_PER_REQUEST@start': all(numbers(start, /cardinality\(p_modules\) > (\d+)/g), policy.MAX_MODULES_PER_REQUEST, 1),
    'LEASE_SECONDS@claim': all(numbers(claim, /now\(\) - interval '(\d+) seconds'/g), policy.LEASE_SECONDS, 1),
    'LEASE_SECONDS@reap': all(numbers(reap, /now\(\) - interval '(\d+) seconds'/g), policy.LEASE_SECONDS, 2),
    'NOTICE_MAX_ATTEMPTS@claim': all(numbers(claim, /job\.notice_attempts < (\d+)/g), policy.NOTICE_MAX_ATTEMPTS, 1),
    'NOTICE_MAX_ATTEMPTS@reap': all(numbers(reap, /job\.notice_attempts >= (\d+)/g), policy.NOTICE_MAX_ATTEMPTS, 1),
    BUILD_MAX_ATTEMPTS: all(numbers(reap, /job\.attempts >= (\d+)/g), policy.BUILD_MAX_ATTEMPTS, 1),
    RETRY_BACKOFF_SECONDS: all(numbers(reap, /now\(\) \+ interval '(\d+) seconds' \* job\.attempts/g), policy.RETRY_BACKOFF_SECONDS, 1),
    CLAIM_BATCH_MAX: all(numbers(claim, /LIMIT LEAST\(GREATEST\(coalesce\(p_batch, 1\), 1\), (\d+)\)/g), policy.CLAIM_BATCH_MAX, 1),
    REAP_BATCH_MAX: all(numbers(reap, /\n\s+LIMIT (\d+)\n/g), policy.REAP_BATCH_MAX, 1),
    // The jobs table itself holds no mirrored number: a limit there would be a second site.
    'no number in the jobs table': !/\b(420|300|270|24)\b/.test(jobs),
  };
}

const failingPins = (pins: Record<string, boolean>) => Object.entries(pins).filter(([, ok]) => !ok).map(([key]) => key).sort();

describe('20261095: the requests table (§3.1)', () => {
  it('has the columns of §3.1, user_id NOT NULL, admin_actor_id without a foreign key (D-5)', () => {
    for (const column of ['id', 'user_id', 'origin', 'admin_actor_id', 'modules', 'requested_at', 'requested_email_sent_at', 'created_at', 'updated_at']) {
      expect([column, new RegExp(`^\\s*${column}\\s`, 'm').test(requestsTable)]).toEqual([column, true]);
    }
    expect(requestsTable).toMatch(/^\s*user_id\s+uuid\s+NOT NULL,$/m);
    expect(requestsTable).toMatch(/^\s*admin_actor_id\s+uuid\s+NULL,$/m);
    expect(requestsTable).not.toMatch(/admin_actor_id\)\s+REFERENCES/);
  });

  it('the origin CHECK is EXPORT_REQUEST_ORIGINS, and admin_actor_id is set exactly for an admin request', () => {
    expect(requestsTable).toContain(`CONSTRAINT business_os_export_requests_origin_check\n    CHECK (origin IN (${quoted(EXPORT_REQUEST_ORIGINS)}))`);
    expect(requestsTable).toContain("CHECK ((origin = 'admin') = (admin_actor_id IS NOT NULL))");
  });

  it('the modules CHECK: 1 to 32 ids of CODE_SHAPE, no NULL, no empty element, no comma inside one', () => {
    const shape = CODE_SHAPE.source.slice(1, -1);
    expect(requestsTable).toContain(
      `CHECK (cardinality(modules) BETWEEN 1 AND ${MODULE_EXPORT_POLICY.MAX_MODULES_PER_REQUEST}\n` +
        '           AND array_position(modules, NULL) IS NULL\n' +
        `           AND array_to_string(modules, ',') ~ '^${shape}(,${shape})*$'\n` +
        "           AND cardinality(string_to_array(array_to_string(modules, ','), ',')) = cardinality(modules))"
    );
  });

  it('exactly three named CHECKs and one named foreign key (M-3)', () => {
    expect([...requestsTable.matchAll(/CONSTRAINT (\w+)\n\s+CHECK/g)].map((match) => match[1])).toEqual([
      'business_os_export_requests_origin_check',
      'business_os_export_requests_admin_shape',
      'business_os_export_requests_modules_shape',
    ]);
    expect(requestsTable).toContain(
      'CONSTRAINT business_os_export_requests_user_id_fkey\n    FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE,'
    );
    expect(requestsTable.match(/REFERENCES/g)).toHaveLength(1);
  });

  it('the per-user index serves the history, the limit counts and the foreign key', () => {
    expect(MIGRATION).toContain(`CREATE INDEX business_os_export_requests_user_requested\n  ON ${REQUESTS} (user_id, requested_at DESC);`);
  });
});

describe('20261095: the module jobs table (§3.2, M-1, M-3)', () => {
  it('the status CHECK is MODULE_JOB_STATUSES and the notice CHECK is NOTICE_STATES, each named on its own', () => {
    expect(jobsTable).toContain(`CONSTRAINT business_os_export_module_jobs_status_check\n    CHECK (status IN (${quoted(MODULE_JOB_STATUSES)}))`);
    expect(jobsTable).toContain(`CONSTRAINT business_os_export_module_jobs_notice_state_check\n    CHECK (notice_state IN (${quoted(NOTICE_STATES)}))`);
    expect(jobsTable).toMatch(/^\s*status\s+text\s+NOT NULL DEFAULT 'waiting',$/m);
    expect(jobsTable).toMatch(/^\s*notice_state\s+text\s+NOT NULL DEFAULT 'none',$/m);
    expect(jobsTable).toMatch(/^\s*parts\s+jsonb\s+NOT NULL DEFAULT '\[\]'::jsonb,$/m);
  });

  it('module, failure_code and last_error_code are shape-checked only, never value-listed (SA-P6, D-12)', () => {
    const shape = `'^${CODE_SHAPE.source.slice(1, -1)}$'`;
    expect(jobsTable).toContain(`CHECK (module ~ ${shape}`);
    expect(jobsTable).toContain(`AND (failure_code IS NULL OR failure_code ~ ${shape})`);
    expect(jobsTable).toContain(`AND (last_error_code IS NULL OR last_error_code ~ ${shape}))`);
    expect(jobsTable).not.toMatch(/failure_code IN \(/);
    expect(jobsTable).not.toMatch(/module IN \(/);
  });

  it('exactly twelve named CHECKs, in the order of §3.2', () => {
    expect([...jobsTable.matchAll(/CONSTRAINT (\w+)\n\s+CHECK/g)].map((match) => match[1])).toEqual([
      'business_os_export_module_jobs_status_check',
      'business_os_export_module_jobs_notice_state_check',
      'business_os_export_module_jobs_codes_shape',
      'business_os_export_module_jobs_counts_check',
      'business_os_export_module_jobs_claim_pair',
      'business_os_export_module_jobs_claim_shape',
      'business_os_export_module_jobs_waiting_has_no_parts',
      'business_os_export_module_jobs_parts_shape',
      'business_os_export_module_jobs_sent_shape',
      'business_os_export_module_jobs_failure_shape',
      'business_os_export_module_jobs_notice_shape',
      'business_os_export_module_jobs_finished_shape',
    ]);
  });

  it('two named single-column foreign keys, both ON DELETE CASCADE (D-4, M-3), and the one-per-module unique', () => {
    expect(jobsTable).toContain(
      `CONSTRAINT business_os_export_module_jobs_request_id_fkey\n    FOREIGN KEY (request_id) REFERENCES ${REQUESTS} (id) ON DELETE CASCADE,`
    );
    expect(jobsTable).toContain(
      'CONSTRAINT business_os_export_module_jobs_user_id_fkey\n    FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE,'
    );
    expect(jobsTable.match(/REFERENCES/g)).toHaveLength(2);
    expect(jobsTable).toContain('CONSTRAINT business_os_export_module_jobs_one_per_module\n    UNIQUE (request_id, module),');
    // No composite foreign key: G-10 and G-18 would refuse it on every check (SA MX1A-4).
    expect(MIGRATION).not.toMatch(/FOREIGN KEY \(\w+, /);
  });

  it('a waiting job can never carry a part (D-10), and the claim pair and shape (claim columns, skill step 1)', () => {
    expect(jobsTable).toContain("CHECK (status <> 'waiting' OR (parts = '[]'::jsonb AND parts_total IS NULL))");
    expect(jobsTable).toContain('CHECK ((claimed_by IS NULL) = (claimed_at IS NULL))');
    expect(jobsTable).toContain("CHECK ((status <> 'working' OR claimed_by IS NOT NULL) AND (status NOT IN ('waiting', 'sent') OR claimed_by IS NULL))");
  });

  it('the parts CHECK is in the positive form, CASE-guarded, with PART_STATES (M-1)', () => {
    const states = PART_STATES.map((state) => `@.state == "${state}"`).join(' || ');
    expect(jobsTable).toContain(
      "CHECK (CASE WHEN jsonb_typeof(parts) = 'array'\n" +
        '                THEN (CASE WHEN parts_total IS NULL THEN jsonb_array_length(parts) = 0 ELSE jsonb_array_length(parts) <= parts_total END)\n' +
        `                     AND jsonb_array_length(jsonb_path_query_array(parts, 'strict $[*] ? (@.type() == "object" && @.n.type() == "number" && @.state.type() == "string" && (${states}))')) = jsonb_array_length(parts)\n` +
        '                ELSE false END)'
    );
    // Never the negative form SA M-1 refused: a search for an invalid element passes a non-string state.
    expect(MIGRATION).not.toMatch(/NOT jsonb_path_exists/);
    expect(MIGRATION).not.toMatch(/'\$\[\*\]/);
  });

  it('sent needs every part accepted, counted positively (M-1), and interrupted needs a part', () => {
    expect(jobsTable).toContain(
      `AND jsonb_array_length(jsonb_path_query_array(parts, 'strict $[*] ? (@.state == "${PART_STATES[1]}")')) = parts_total`
    );
    expect(jobsTable).toContain("CHECK ((status = 'sent') = (sent_at IS NOT NULL)");
    expect(jobsTable).toContain("CHECK ((status IN ('failed', 'interrupted')) = (failure_code IS NOT NULL)");
    expect(jobsTable).toContain("AND (status <> 'interrupted' OR (failure_code = 'interrupted'");
    expect(jobsTable).toContain("CASE WHEN jsonb_typeof(parts) = 'array' THEN jsonb_array_length(parts) > 0 ELSE false END");
    expect(jobsTable).toContain("CHECK ((status IN ('failed', 'interrupted')) = (notice_state <> 'none')\n           AND (notice_state = 'sent') = (notice_sent_at IS NOT NULL))");
    expect(jobsTable).toContain("CHECK ((status IN ('sent', 'failed', 'interrupted')) = (finished_at IS NOT NULL))");
  });

  it('the queue indexes index exactly the claim and reap predicates; the per-user index exists', () => {
    expect(MIGRATION).toContain(`CREATE INDEX business_os_export_module_jobs_user_created\n  ON ${JOBS} (user_id, created_at DESC);`);
    expect(MIGRATION).toContain(`CREATE INDEX business_os_export_module_jobs_waiting\n  ON ${JOBS} (next_attempt_at NULLS FIRST, created_at)\n  WHERE status = 'waiting';`);
    expect(MIGRATION).toContain(`CREATE INDEX business_os_export_module_jobs_notice_due\n  ON ${JOBS} (created_at)\n  WHERE notice_state = 'due';`);
    expect(MIGRATION).toContain(`CREATE INDEX business_os_export_module_jobs_working\n  ON ${JOBS} (claimed_at)\n  WHERE status = 'working';`);
  });
});

/**
 * A model of the parts CHECK as Postgres evaluates it (M-1): strict mode, no
 * unwrap of a nested array, and a filter that errors (a missing key in strict
 * mode) is unknown and drops the element. The real proof is QA 2 on PG 15 + 17.
 */
function partsCheckAccepts(parts: unknown, partsTotal: number | null): boolean {
  if (!Array.isArray(parts)) return false;
  if (partsTotal === null ? parts.length !== 0 : parts.length > partsTotal) return false;
  const valid = parts.filter((element) => {
    if (element === null || typeof element !== 'object' || Array.isArray(element)) return false;
    const record = element as Record<string, unknown>;
    if (!('n' in record) || typeof record.n !== 'number') return false;
    if (!('state' in record) || typeof record.state !== 'string') return false;
    return (PART_STATES as ReadonlyArray<string>).includes(record.state);
  });
  return valid.length === parts.length;
}

describe('the parts CHECK refuses every bad element (M-1, modelled; QA 2 proves it live)', () => {
  const good = { n: 1, state: 'sending', resend_id: null, at: '2026-10-27T10:00:00Z' };
  it.each([
    ['a numeric state', [{ n: 1, state: 7 }]],
    ['a null state', [{ n: 1, state: null }]],
    ['a boolean state', [{ n: 1, state: true }]],
    ['an object state', [{ n: 1, state: { v: 'sending' } }]],
    ['a missing state', [{ n: 1 }]],
    ['a nested array element', [[good]]],
    ['a string element', ['sending']],
    ['an unknown state word', [{ n: 1, state: 'queued' }]],
    ['a missing n', [{ state: 'sending' }]],
    ['one bad element beside a good one', [good, { n: 2, state: 5 }]],
  ])('refuses %s', (_name, parts) => {
    expect(partsCheckAccepts(parts, 3)).toBe(false);
  });

  it('accepts sending and accepted parts within parts_total, and [] with no total', () => {
    expect(partsCheckAccepts([good, { ...good, n: 2, state: 'accepted' }], 2)).toBe(true);
    expect(partsCheckAccepts([], null)).toBe(true);
    expect(partsCheckAccepts([good], null)).toBe(false);
    expect(partsCheckAccepts([good, good, good], 2)).toBe(false);
    expect(partsCheckAccepts({ n: 1 }, 1)).toBe(false);
  });
});

describe('20261095: access (§3.2 Access)', () => {
  it('RLS on and no policy or trigger; revoke from every role, then SELECT, INSERT, UPDATE, DELETE to service_role only', () => {
    for (const table of [REQUESTS, JOBS]) {
      expect(MIGRATION).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
      const revoke = MIGRATION.indexOf(`REVOKE ALL ON TABLE ${table} FROM PUBLIC, anon, authenticated, service_role;`);
      expect(revoke).toBeGreaterThan(0);
      expect(MIGRATION.indexOf(`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${table} TO service_role;`)).toBeGreaterThan(revoke);
    }
    expect(MIGRATION).not.toMatch(/CREATE\s+POLICY/i);
    expect(MIGRATION).not.toMatch(/CREATE\s+TRIGGER/i);
    expect(MIGRATION.match(/^GRANT .*$/gm)).toEqual([
      `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${REQUESTS} TO service_role;`,
      `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${JOBS} TO service_role;`,
      `GRANT EXECUTE ON FUNCTION ${START_SIGNATURE} TO service_role;`,
      `GRANT EXECUTE ON FUNCTION ${CLAIM_SIGNATURE} TO service_role;`,
      `GRANT EXECUTE ON FUNCTION ${REAP_SIGNATURE} TO service_role;`,
    ]);
    expect(MIGRATION).not.toMatch(/\b(anon|authenticated)\b[^\n]*\bGRANT\b|GRANT[^\n]*\b(anon|authenticated)\b/);
  });

  it.each([
    [START_FUNCTION, START_SIGNATURE, 'start', '(p_user_id uuid, p_origin text, p_admin_actor_id uuid, p_modules text[])', 'RETURNS TABLE (result_outcome text, result_request_id uuid, result_retry_at timestamptz)\nLANGUAGE plpgsql'],
    [CLAIM_FUNCTION, CLAIM_SIGNATURE, 'claim', '(p_runner uuid, p_batch integer)', `RETURNS SETOF ${JOBS}\nLANGUAGE sql`],
    [REAP_FUNCTION, REAP_SIGNATURE, 'reap', '()', `RETURNS SETOF ${JOBS}\nLANGUAGE sql`],
  ])('%s runs with the rights of its caller, volatile, pinned search_path, EXECUTE service_role only', (name, signature, tag, args, returns) => {
    const head = header(MIGRATION, name);
    expect(head).toContain(`CREATE FUNCTION public.${name}${args}\n${returns}\nVOLATILE\nSECURITY INVOKER\nSET search_path = pg_catalog, public, pg_temp`);
    expect(head.endsWith('SET search_path = pg_catalog, public, pg_temp')).toBe(true);
    const revoke = MIGRATION.indexOf(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC, anon, authenticated, service_role;`);
    expect(revoke).toBeGreaterThan(MIGRATION.indexOf(`$${tag}$;`));
    expect(MIGRATION.indexOf(`GRANT EXECUTE ON FUNCTION ${signature} TO service_role;`)).toBeGreaterThan(revoke);
  });

  it('no function runs with its owner rights and none takes a lease parameter (D-8, MX1A-6)', () => {
    // The header comment names the skill's DEFINER shape it deviates from; the code never uses it.
    expect(scan(MIGRATION).code).not.toMatch(/SECURITY DEFINER/);
    expect(scan(MIGRATION).code.match(/SECURITY INVOKER/g)).toHaveLength(3);
    expect(MIGRATION).not.toContain('p_lease_seconds');
    expect(MIGRATION).not.toContain('p_max_attempts');
  });
});

describe('20261095: the start function (§3.3, D-6, D-7, M-5)', () => {
  it('refuses bad arguments with 22023 before the lock and before any write', () => {
    const refuse = "RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'export request start: invalid arguments';";
    expect(startBody.split(refuse).length - 1).toBe(2);
    expect(startBody).toContain('IF p_user_id IS NULL OR p_origin IS NULL OR p_modules IS NULL OR array_ndims(p_modules) IS DISTINCT FROM 1 THEN');
    expect(startBody).toContain(`IF p_origin NOT IN (${quoted(EXPORT_REQUEST_ORIGINS)})`);
    expect(startBody).toContain("OR (p_origin = 'admin') <> (p_admin_actor_id IS NOT NULL)");
    expect(startBody).toContain('OR array_position(p_modules, NULL) IS NOT NULL');
    expect(startBody).toContain(`WHERE given.module !~ '^${CODE_SHAPE.source.slice(1, -1)}$'`);
    expect(startBody).toContain('OR cardinality(ARRAY(SELECT DISTINCT given.module FROM unnest(p_modules) AS given(module))) <> cardinality(p_modules) THEN');
    expect(startBody.lastIndexOf(refuse)).toBeLessThan(startBody.indexOf('pg_advisory_xact_lock'));
    expect(startBody.lastIndexOf(refuse)).toBeLessThan(startBody.indexOf('INSERT'));
  });

  it('serialises per account with one advisory key for both origins, before any read (20261074 shape)', () => {
    expect(startBody).toContain(
      "PERFORM pg_catalog.pg_advisory_xact_lock(\n    pg_catalog.hashtextextended('business_os_export_request:' || p_user_id::text, 0));"
    );
    expect(startBody.indexOf('pg_advisory_xact_lock')).toBeLessThan(startBody.indexOf('FROM public.business_os_export_requests'));
  });

  it('in flight: any job of this account and origin in MODULE_JOB_IN_FLIGHT, answered before the limit', () => {
    expect(startBody).toContain(`AND job.status IN (${quoted(MODULE_JOB_IN_FLIGHT)})`);
    expect(startBody).toContain("RETURN QUERY SELECT 'in_progress'::text, NULL::uuid, NULL::timestamptz;");
    expect(startBody.indexOf("'in_progress'")).toBeLessThan(startBody.indexOf('v_limit :='));
    expect(startBody.match(/req\.origin = p_origin/g)).toHaveLength(2);
    expect(startBody.match(/req\.user_id = p_user_id/g)).toHaveLength(2);
  });

  it('counted: requests with a job not in MODULE_JOB_NOT_COUNTED; retry at the limit-th newest + the window', () => {
    expect(startBody).toContain(`WHERE job.request_id = req.id AND job.status NOT IN (${quoted(MODULE_JOB_NOT_COUNTED)}))`);
    expect(startBody).toContain('ORDER BY req.requested_at DESC\n     OFFSET (v_limit - 1) LIMIT 1);');
    expect(startBody).toContain(`RETURN QUERY SELECT 'daily_limit'::text, NULL::uuid, v_retry_from + interval '${MODULE_EXPORT_POLICY.DAILY_WINDOW_HOURS} hours';`);
    expect(startBody).toContain(`AND req.requested_at > now() - interval '${MODULE_EXPORT_POLICY.DAILY_WINDOW_HOURS} hours'`);
  });

  it('inserts the request with a fresh id, then one waiting job per module from the same arguments (D-4)', () => {
    expect(startBody).toContain('v_request_id := gen_random_uuid();');
    expect(startBody).toContain(
      'INSERT INTO public.business_os_export_requests (id, user_id, origin, admin_actor_id, modules)\n  VALUES (v_request_id, p_user_id, p_origin, p_admin_actor_id, p_modules);'
    );
    expect(startBody).toContain(
      'INSERT INTO public.business_os_export_module_jobs (request_id, user_id, module)\n  SELECT v_request_id, p_user_id, given.module FROM unnest(p_modules) AS given(module);'
    );
    expect(startBody).toContain("RETURN QUERY SELECT 'started'::text, v_request_id, NULL::timestamptz;");
    expect(startBody).not.toMatch(/\bRETURNING\b/);
  });
});

describe('20261095: the claim and reap functions (§3.4, §3.5, M-2, M-6)', () => {
  it('the claim takes waiting jobs past their backoff and due notices under their cap and lease, skip locked', () => {
    expect(claimBody).toContain('WHERE p_runner IS NOT NULL');
    expect(claimBody).toContain("(job.status = 'waiting' AND (job.next_attempt_at IS NULL OR job.next_attempt_at <= now()))");
    expect(claimBody).toContain(
      `OR (job.notice_state = 'due' AND job.notice_attempts < ${MODULE_EXPORT_POLICY.NOTICE_MAX_ATTEMPTS}\n` +
        `             AND (job.claimed_at IS NULL OR job.claimed_at < now() - interval '${MODULE_EXPORT_POLICY.LEASE_SECONDS} seconds'))`
    );
    expect(claimBody).toContain('FOR UPDATE SKIP LOCKED');
    expect(claimBody).toContain("SET status          = CASE WHEN job.status = 'waiting' THEN 'working' ELSE job.status END,");
    expect(claimBody).toContain("attempts        = CASE WHEN job.status = 'waiting' THEN job.attempts + 1 ELSE job.attempts END,");
    expect(claimBody).toContain("notice_attempts = CASE WHEN job.notice_state = 'due' THEN job.notice_attempts + 1 ELSE job.notice_attempts END,");
    expect(claimBody).toContain('RETURNING job.*;');
  });

  it('the reaper verdict is one CASE in the M-6 order: sent, interrupted, failed, retry, then notice given up', () => {
    const order = ["THEN 'sent'", "THEN 'interrupted'", "THEN 'failed'", "THEN 'retry'", "ELSE 'notice_given_up'"].map((word) => reapBody.indexOf(word));
    expect(order.every((index) => index > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(reapBody.match(/\bCASE\n/g)).toHaveLength(1);
    expect(reapBody).toContain(
      `AND jsonb_array_length(jsonb_path_query_array(job.parts, 'strict $[*] ? (@.state == "${PART_STATES[1]}")')) = job.parts_total`
    );
    expect(reapBody).toContain("WHEN job.status = 'working' AND jsonb_array_length(job.parts) > 0 THEN 'interrupted'");
  });

  it('the reaper writes what each verdict needs to pass the row CHECKs, and always clears the claim', () => {
    expect(reapBody).toContain("WHEN 'retry' THEN 'waiting'");
    expect(reapBody).toContain("parts_total     = CASE stale.verdict WHEN 'retry' THEN NULL ELSE job.parts_total END,");
    expect(reapBody).toContain("last_error_code = CASE stale.verdict WHEN 'retry' THEN 'lease_expired' ELSE job.last_error_code END,");
    expect(reapBody).toContain("failure_code    = CASE stale.verdict WHEN 'interrupted' THEN 'interrupted' WHEN 'failed' THEN 'attempts_exhausted'");
    expect(reapBody).toContain("notice_state    = CASE stale.verdict WHEN 'interrupted' THEN 'due' WHEN 'failed' THEN 'due'");
    expect(reapBody).toContain("WHEN 'notice_given_up' THEN 'given_up'");
    expect(reapBody).toContain("finished_at     = CASE WHEN stale.verdict IN ('sent', 'interrupted', 'failed') THEN now() ELSE job.finished_at END,");
    expect(reapBody).toContain('claimed_by      = NULL,\n         claimed_at      = NULL,');
    expect(reapBody).toContain('FOR UPDATE SKIP LOCKED');
    expect(reapBody).toContain('RETURNING job.*;');
    for (const code of ['lease_expired', 'attempts_exhausted', 'interrupted']) expect(CODE_SHAPE.test(code)).toBe(true);
  });
});

describe('the SQL literals equal MODULE_EXPORT_POLICY, one site per constant (M-5)', () => {
  it('every pin holds on the committed SQL', () => {
    expect(failingPins(literalPins(MIGRATION))).toEqual([]);
  });

  it.each([
    ['the owner limit', "THEN 2 ELSE 2 END", "THEN 3 ELSE 2 END", ['OWNER_DAILY_LIMIT']],
    ['the admin limit', "THEN 2 ELSE 2 END", "THEN 2 ELSE 3 END", ['ADMIN_DAILY_LIMIT_PER_OWNER']],
  ])('negative control: changing %s in the SQL fails only its own pin', (_name, from, to, failing) => {
    expect(MIGRATION.split(from).length - 1).toBe(1);
    expect(failingPins(literalPins(MIGRATION.replace(from, to)))).toEqual(failing);
  });

  it('negative control: the claim lease and the reap lease are separate sites', () => {
    const lease = `now() - interval '${MODULE_EXPORT_POLICY.LEASE_SECONDS} seconds'`;
    const first = MIGRATION.indexOf(lease);
    const last = MIGRATION.lastIndexOf(lease);
    expect(first).toBeGreaterThan(MIGRATION.indexOf('$claim$'));
    expect(first).toBeLessThan(MIGRATION.indexOf('$claim$;'));
    expect(last).toBeGreaterThan(MIGRATION.indexOf('$reap$'));
    const plant = (at: number) => `${MIGRATION.slice(0, at)}now() - interval '300 seconds'${MIGRATION.slice(at + lease.length)}`;
    expect(failingPins(literalPins(plant(first)))).toEqual(['LEASE_SECONDS@claim']);
    expect(failingPins(literalPins(plant(last)))).toEqual(['LEASE_SECONDS@reap']);
  });

  it.each(Object.keys(MODULE_EXPORT_POLICY).filter((key) => !['WORKER_MAX_DURATION_SECONDS', 'WORKER_BUDGET_SECONDS'].includes(key)))(
    'negative control: a different %s fails only its own pins',
    (key) => {
      const policy = { ...MODULE_EXPORT_POLICY, [key]: (MODULE_EXPORT_POLICY as Record<string, number>)[key] + 1 } as Policy;
      const failing = failingPins(literalPins(MIGRATION, policy));
      expect(failing.length).toBeGreaterThan(0);
      for (const pin of failing) expect([key, pin.split('@')[0]]).toEqual([key, key]);
    }
  );

  it('the worker limits are code-only (MX-3 route), and the SQL never names them', () => {
    expect(MIGRATION).not.toContain(String(MODULE_EXPORT_POLICY.WORKER_MAX_DURATION_SECONDS));
    expect(MIGRATION).not.toContain(String(MODULE_EXPORT_POLICY.WORKER_BUDGET_SECONDS));
  });
});

describe('20261095: guards (§3.6)', () => {
  it('pre-guards: browser CREATE, the objects absent, 20261093 applied, gen_random_uuid', () => {
    const pre = MIGRATION.slice(MIGRATION.indexOf('DO $pre_guard$'), MIGRATION.indexOf('$pre_guard$;'));
    expect(pre).toContain("pg_catalog.has_schema_privilege('anon', 'public', 'CREATE')");
    expect(pre).toContain(`pg_catalog.to_regclass('${REQUESTS}') IS NOT NULL`);
    expect(pre).toContain(`pg_catalog.to_regclass('${JOBS}') IS NOT NULL`);
    for (const signature of [START_SIGNATURE, CLAIM_SIGNATURE, REAP_SIGNATURE]) expect(pre).toContain(`pg_catalog.to_regprocedure('${signature}') IS NOT NULL`);
    expect(pre).toContain("pg_catalog.to_regclass('public.business_os_account_closures') IS NULL");
    expect(pre).toContain("pg_catalog.to_regprocedure('gen_random_uuid()') IS NULL");
    expect(MIGRATION.indexOf('$pre_guard$;')).toBeLessThan(MIGRATION.indexOf('CREATE TABLE'));
  });

  it('post-conditions 1 to 8, including the named foreign keys (M-3) and the one inbound link', () => {
    const post = MIGRATION.slice(MIGRATION.indexOf('DO $post_condition$'), MIGRATION.indexOf('$post_condition$;'));
    for (let n = 1; n <= 8; n++) expect(post).toContain(`Export requests post-condition ${n}:`);
    for (const name of ['business_os_export_requests_user_id_fkey', 'business_os_export_module_jobs_user_id_fkey', 'business_os_export_module_jobs_request_id_fkey']) {
      expect(post).toContain(`con.conname = '${name}'`);
    }
    expect(post).toContain("con.contype = 'f' AND con.confrelid = ANY (v_tables));\n  IF v_count <> 1 THEN");
    expect(post).toContain("idx.indexdef LIKE '%WHERE (status = ''waiting''::text)'");
    expect(post).toContain("idx.indexdef LIKE '%WHERE (notice_state = ''due''::text)'");
    expect(post).toContain("idx.indexdef LIKE '%WHERE (status = ''working''::text)'");
    expect(post).toContain('acl.grantee = 0');
    expect(post).toContain('AND NOT fn.prosecdef');
    // The named CHECK lists of post-condition 7 are exactly the ones the tables create.
    const named = [...MIGRATION.matchAll(/CONSTRAINT (business_os_export_\w+)\n\s+CHECK/g)].map((match) => match[1]);
    expect(named).toHaveLength(15);
    for (const name of named) expect(post).toContain(`'${name}'`);
    expect(post).toContain('IF v_count <> 3 THEN\n    RAISE EXCEPTION USING MESSAGE = \'Export requests post-condition 7: a named CHECK of the requests table');
    expect(post).toContain('IF v_count <> 12 THEN\n    RAISE EXCEPTION USING MESSAGE = \'Export requests post-condition 7: a named CHECK of the jobs table');
  });

  it('one transaction, a lock timeout, then the schema reload', () => {
    expect(MIGRATION).toMatch(/\nBEGIN;\n\nSET LOCAL lock_timeout = '5s';\n/);
    expect(MIGRATION.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';\n\nCOMMIT;")).toBe(true);
  });
});

// ── Paste safety (M-8): a small scanner of comments, string literals and dollar bodies ──

interface Token {
  kind: 'comment' | 'string';
  text: string;
}

/** Comments and single-quoted literals, recursing into `$tag$` bodies (a function or DO body is itself a literal). */
function scan(sql: string): { tokens: Token[]; code: string; unterminated: boolean } {
  const tokens: Token[] = [];
  let code = '';
  let i = 0;
  while (i < sql.length) {
    if (sql.startsWith('--', i)) {
      const end = sql.indexOf('\n', i);
      tokens.push({ kind: 'comment', text: sql.slice(i, end === -1 ? sql.length : end) });
      i = end === -1 ? sql.length : end;
      continue;
    }
    if (sql.startsWith('/*', i)) {
      const end = sql.indexOf('*/', i + 2);
      if (end === -1) return { tokens, code, unterminated: true };
      tokens.push({ kind: 'comment', text: sql.slice(i, end + 2) });
      i = end + 2;
      continue;
    }
    const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
    if (tag) {
      const close = sql.indexOf(tag[0], i + tag[0].length);
      if (close === -1) return { tokens, code, unterminated: true };
      const inner = scan(sql.slice(i + tag[0].length, close));
      if (inner.unterminated) return { tokens, code, unterminated: true };
      tokens.push(...inner.tokens);
      code += inner.code;
      i = close + tag[0].length;
      continue;
    }
    if (sql[i] === "'") {
      let j = i + 1;
      let text = '';
      for (;;) {
        if (j >= sql.length) return { tokens, code, unterminated: true };
        if (sql[j] === "'" && sql[j + 1] === "'") {
          text += "''";
          j += 2;
          continue;
        }
        if (sql[j] === "'") break;
        text += sql[j];
        j += 1;
      }
      tokens.push({ kind: 'string', text });
      i = j + 1;
      continue;
    }
    code += sql[i];
    i += 1;
  }
  return { tokens, code, unterminated: false };
}

const PASTED: ReadonlyArray<[string, string]> = [
  ['migration', MIGRATION],
  ['rollback', ROLLBACK],
  ['pre-check', PRECHECK],
  ['95 checker', CHECKER],
  ['96 checker', CHECKER_96],
];

describe('paste safety (M-8): the 95 migration, its rollback and the three scripts', () => {
  it.each(PASTED)('the %s has no "into" in any literal or comment, and no semicolon or apostrophe in a comment', (_name, sql) => {
    const scanned = scan(sql);
    expect(scanned.unterminated).toBe(false);
    for (const token of scanned.tokens) {
      expect([token.kind, token.text.slice(0, 60), /\binto\b/i.test(token.text)]).toEqual([token.kind, token.text.slice(0, 60), false]);
      if (token.kind === 'comment') expect([token.text, /[;']/.test(token.text)]).toEqual([token.text, false]);
      else expect([token.text.slice(0, 60), /;|--/.test(token.text)]).toEqual([token.text.slice(0, 60), false]);
    }
  });

  it.each(PASTED)('the %s keeps its comments to the header', (_name, sql) => {
    const lines = sql.split('\n');
    const firstCode = lines.findIndex((line) => line !== '' && !line.startsWith('--'));
    lines.forEach((line, index) => {
      if (line.trimStart().startsWith('--')) expect([index, index < firstCode]).toEqual([index, true]);
    });
  });

  it('"into" appears only as the two INSERT INTO keywords inside the start body; never SELECT or RETURNING ... INTO', () => {
    const inserts = [`INSERT INTO ${REQUESTS} (`, `INSERT INTO ${JOBS} (`];
    for (const insert of inserts) {
      expect(MIGRATION.split(insert).length - 1).toBe(1);
      expect(startBody).toContain(insert);
    }
    let rest = MIGRATION;
    for (const insert of inserts) rest = rest.split(insert).join('');
    expect(rest.match(/\binto\b/gi)).toBeNull();
    for (const [, sql] of PASTED) {
      expect(sql).not.toMatch(/\bSELECT\b[^;]*?\bINTO\s+v_/i);
      expect(sql).not.toMatch(/\bRETURNING\b[^;]*?\bINTO\b/i);
    }
    for (const [name, sql] of PASTED.slice(1)) expect([name, sql.match(/\binto\b/gi)]).toEqual([name, null]);
  });

  it('negative control: a planted "into" in a comment or a literal, and an apostrophe in a comment, are caught', () => {
    const offends = (sql: string) =>
      scan(sql).tokens.some((t) => /\binto\b/i.test(t.text) || (t.kind === 'comment' && /[;']/.test(t.text)));
    expect(offends(MIGRATION)).toBe(false);
    expect(offends(`-- turned into a row\n${MIGRATION}`)).toBe(true);
    expect(offends(MIGRATION.replace("'export request start: invalid arguments'", "'export request start: turned into nothing'"))).toBe(true);
    expect(offends(`-- the owner's request\n${MIGRATION}`)).toBe(true);
  });

  it('CRLF is normalised before every scan', () => {
    for (const [, sql] of PASTED) expect(sql).not.toMatch(/\r/);
  });
});

describe('20261095: rollback (§9)', () => {
  it('refuses while a table is missing, while the live cleanup names either table, and while any row exists', () => {
    expect(ROLLBACK).toContain(`pg_catalog.to_regclass('${REQUESTS}') IS NULL OR pg_catalog.to_regclass('${JOBS}') IS NULL`);
    expect(ROLLBACK).toContain("position('business_os_export_requests' in p.prosrc) > 0 OR position('business_os_export_module_jobs' in p.prosrc) > 0");
    const lock = ROLLBACK.indexOf(`LOCK TABLE ${REQUESTS}, ${JOBS} IN ACCESS EXCLUSIVE MODE;`);
    expect(lock).toBeGreaterThan(0);
    expect(lock).toBeLessThan(ROLLBACK.indexOf('v_rows := (SELECT count(*)'));
    expect(ROLLBACK).toContain(`v_rows := (SELECT count(*) FROM ${REQUESTS}) + (SELECT count(*) FROM ${JOBS});`);
  });

  it('drops the reap, claim and start functions, then the jobs table, then the requests table, in one transaction', () => {
    const drops = [
      `DROP FUNCTION IF EXISTS ${REAP_SIGNATURE};`,
      `DROP FUNCTION IF EXISTS ${CLAIM_SIGNATURE};`,
      `DROP FUNCTION IF EXISTS ${START_SIGNATURE};`,
      `DROP TABLE ${JOBS};`,
      `DROP TABLE ${REQUESTS};`,
    ].map((statement) => ROLLBACK.indexOf(statement));
    expect(drops.every((index) => index > ROLLBACK.indexOf('$rollback_guard$;'))).toBe(true);
    expect([...drops].sort((a, b) => a - b)).toEqual(drops);
    expect(ROLLBACK.match(/^DROP .*$/gm)).toHaveLength(5);
    expect(ROLLBACK).toMatch(/\nBEGIN;\n\nSET LOCAL lock_timeout = '5s';\n/);
    expect(ROLLBACK.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';\n\nCOMMIT;")).toBe(true);
  });
});

describe('the pre-check and the 20261095 checker (§5, §8)', () => {
  it('the pre-check requires the objects absent, 20261093 applied and the immutable jsonpath functions', () => {
    expect(PRECHECK).toContain(`pg_catalog.to_regclass('${REQUESTS}') IS NULL`);
    expect(PRECHECK).toContain(`pg_catalog.to_regclass('${JOBS}') IS NULL`);
    for (const signature of [START_SIGNATURE, CLAIM_SIGNATURE, REAP_SIGNATURE]) expect(PRECHECK).toContain(`pg_catalog.to_regprocedure('${signature}') IS NULL`);
    expect(PRECHECK).toContain("p.proname IN ('jsonb_path_query_array', 'jsonb_path_exists') AND p.pronargs = 4 AND p.provolatile <> 'i'");
  });

  it('checker row 8 names every CHECK constraint the migration creates, and row 5 every named foreign key', () => {
    const named = [...MIGRATION.matchAll(/CONSTRAINT (business_os_export_\w+)\n\s+CHECK/g)].map((match) => match[1]);
    for (const name of named) expect(CHECKER).toContain(`'${name}'`);
    expect(CHECKER).toContain("'business_os_export_requests_modules_shape')) = 3\n");
    expect(CHECKER).toContain("'business_os_export_module_jobs_notice_shape', 'business_os_export_module_jobs_finished_shape')) = 12\n");
    for (const name of [...MIGRATION.matchAll(/CONSTRAINT (\w+_fkey)\n/g)].map((match) => match[1])) expect(CHECKER).toContain(`con.conname = '${name}'`);
  });

  it('the checker pins the literals from MODULE_EXPORT_POLICY, and row 14 is the G-10 information row', () => {
    const p = MODULE_EXPORT_POLICY;
    expect(CHECKER).toContain(`position('interval ''${p.DAILY_WINDOW_HOURS} hours''' in p.prosrc) > 0`);
    expect(CHECKER).toContain(`position('v_limit := CASE WHEN p_origin = ''owner'' THEN ${p.OWNER_DAILY_LIMIT} ELSE ${p.ADMIN_DAILY_LIMIT_PER_OWNER} END' in p.prosrc) > 0`);
    expect(CHECKER).toContain(`position('job.status NOT IN (${MODULE_JOB_NOT_COUNTED.map((s) => `''${s}''`).join(', ')})' in p.prosrc) > 0`);
    expect(CHECKER.split(`position('interval ''${p.LEASE_SECONDS} seconds''' in p.prosrc) > 0`).length - 1).toBe(2);
    expect(CHECKER).toContain(`position('job.notice_attempts < ${p.NOTICE_MAX_ATTEMPTS}' in p.prosrc) > 0`);
    expect(CHECKER).toContain(`position('job.attempts >= ${p.BUILD_MAX_ATTEMPTS}' in p.prosrc) > 0`);
    expect(CHECKER).toContain(`position('job.notice_attempts >= ${p.NOTICE_MAX_ATTEMPTS}' in p.prosrc) > 0`);
    // Each pinned text is really in the migration body it names.
    expect(startBody).toContain(`v_limit := CASE WHEN p_origin = 'owner' THEN ${p.OWNER_DAILY_LIMIT} ELSE ${p.ADMIN_DAILY_LIMIT_PER_OWNER} END`);
    expect(startBody).toContain(`job.status NOT IN (${quoted(MODULE_JOB_NOT_COUNTED)})`);
    expect(CHECKER).toMatch(
      /SELECT 14, 'information only\. ok once 20261096 is live\. FAIL until then is expected: every test account check and delete refuses with G-10 on these tables'/
    );
  });

  it.each([
    ['pre-check', PRECHECK],
    ['checker', CHECKER],
  ])('the %s is one read-only statement ending ORDER BY checks.ord', (_name, sql) => {
    expect(sql).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|GRANT|REVOKE|TRUNCATE|DO|BEGIN)\b/im);
    expect(sql).not.toMatch(/\bset_config\(/i);
    expect(sql.trimEnd().endsWith('ORDER BY checks.ord;')).toBe(true);
    expect(sql.split(';').length - 1).toBe(1);
  });
});
