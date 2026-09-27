/**
 * Guard over the Business OS cron run record migration (admin reorganisation
 * slice 5, part B; SA SC-3, SC-5).
 *
 * WHY A TEST OVER SQL TEXT. Jest cannot run SQL and there is no branch
 * database. The behaviour is proven by the dry run in the migration header,
 * which the user runs on PROD inside a block that always rolls back. These are
 * the properties that can be checked from the file alone, and whose loss would
 * be silent: a dropped CHECK that lets owner text in, a REVOKE lost in a
 * rebase, a function that became SECURITY DEFINER.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const FILE = join(process.cwd(), 'supabase', 'migrations', '20261011_bos_cron_runs.sql');
const ROLLBACK = join(process.cwd(), 'supabase', 'SQL Scripts', '20261011_bos_cron_runs_rollback.sql');
const raw = readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');

function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const i = line.indexOf('--');
      return i === -1 ? line : line.slice(0, i);
    })
    .join('\n');
}

const sql = stripComments(raw);
const flat = sql.replace(/\s+/g, ' ');
const runbook = (() => {
  const start = raw.indexOf('RUNBOOK SQL');
  return raw.slice(start, raw.indexOf('═══ */', start));
})();

function createTable(name: string): string {
  const start = sql.indexOf(`CREATE TABLE public.${name} (`);
  expect(start).toBeGreaterThanOrEqual(0);
  return sql.slice(start, sql.indexOf(');\n', start) + 2).replace(/\s+/g, ' ');
}

describe('one transaction, plain CREATE (safe to run twice: a second paste fails and changes nothing)', () => {
  it('is wrapped in exactly one BEGIN … COMMIT', () => {
    expect(flat.match(/\bBEGIN;/g)).toHaveLength(1);
    expect(flat.match(/\bCOMMIT;/g)).toHaveLength(1);
    expect(flat.indexOf('BEGIN;')).toBeLessThan(flat.indexOf('CREATE TABLE'));
    expect(flat.lastIndexOf('COMMIT;')).toBeGreaterThan(flat.lastIndexOf('GRANT'));
  });

  it('uses plain CREATE TABLE, never IF NOT EXISTS', () => {
    expect(flat).toContain('CREATE TABLE public.bos_cron_runs (');
    expect(flat).toContain('CREATE TABLE public.bos_cron_run_recording (');
    expect(flat).not.toMatch(/IF NOT EXISTS/i);
  });

  it('touches nothing but its own objects: no DROP, TRUNCATE, DELETE or UPDATE, and ALTER only its own tables', () => {
    expect(flat).not.toMatch(/\b(DROP|TRUNCATE)\b/);
    expect(flat).not.toMatch(/\bDELETE FROM\b|\bUPDATE public\./);
    const alters = flat.match(/ALTER TABLE public\.(\w+)/g) ?? [];
    expect(alters.length).toBe(2);
    for (const alter of alters) expect(alter).toMatch(/bos_cron_run(s|_recording)$/);
  });
});

describe('SC-3: the CHECKs that keep owner text out (immutable expressions only)', () => {
  const runs = () => createTable('bos_cron_runs');

  it('counts: an object of numbers, bounded, with plain keys', () => {
    const t = runs();
    expect(t).toContain("jsonb_typeof(counts) = 'object'");
    expect(t).toContain('octet_length(counts::text) <= 1024');
    // STRICT (SA-1): lax mode would unwrap {"a":[1]} / {"a":[]} and let an array through.
    expect(t).toContain(`NOT jsonb_path_exists(counts, 'strict $.* ? (@.type() != "number")')`);
    expect(t).not.toMatch(/jsonb_path_exists\(counts, '\$\.\* \?/);
    expect(t).toContain(`NOT jsonb_path_exists(counts, '$.keyvalue() ? (!(@.key like_regex "^[a-zA-Z][a-zA-Z0-9]{0,39}$"))')`);
  });

  it('error_class is a closed list, a failure always has one, and only a failure may', () => {
    const t = runs();
    expect(t).toContain("error_class IN ('http_error', 'exception', 'timeout')");
    expect(t).toContain("CHECK (outcome <> 'failed' OR error_class IS NOT NULL)");
    expect(t).toContain("CHECK (error_class IS NULL OR outcome = 'failed')");
  });

  it('a running row is bare, and running <=> no finish time', () => {
    const t = runs();
    expect(t).toContain("CHECK ( outcome <> 'running' OR (duration_ms IS NULL AND http_status IS NULL AND error_class IS NULL) )");
    expect(t).toContain("CHECK ((outcome = 'running') = (finished_at IS NULL))");
  });

  it('the deadline is after the start and at most 20 minutes after it', () => {
    const t = runs();
    expect(t).toContain('CHECK (deadline_at > started_at)');
    expect(t).toContain("CHECK (deadline_at <= started_at + interval '20 minutes')");
  });

  it('outcome, source and job are constrained', () => {
    const t = runs();
    expect(t).toContain("outcome IN ('running', 'succeeded', 'partial', 'failed')");
    expect(t).toContain("source IN ('vercel_cron', 'other')");
    expect(t).toContain("job ~ '^[a-z][a-z0-9-]{0,63}$'");
  });

  it('no CHECK uses a subquery (Postgres refuses them)', () => {
    expect(runs()).not.toMatch(/CHECK\s*\([^)]*SELECT/i);
  });

  it('there is no user_id or business column', () => {
    expect(runs()).not.toMatch(/user_id|business|email|message/);
  });

  it('the recording table holds one row, inserted by the migration', () => {
    expect(createTable('bos_cron_run_recording')).toContain('CHECK (id = 1)');
    expect(flat).toContain('INSERT INTO public.bos_cron_run_recording DEFAULT VALUES;');
  });
});

describe('RLS and privileges', () => {
  it('RLS on both tables, and no policy at all', () => {
    expect(flat).toContain('ALTER TABLE public.bos_cron_runs ENABLE ROW LEVEL SECURITY;');
    expect(flat).toContain('ALTER TABLE public.bos_cron_run_recording ENABLE ROW LEVEL SECURITY;');
    expect(flat).not.toMatch(/CREATE POLICY/i);
  });

  it('REVOKE ALL from every API role, service_role included, then exact grants', () => {
    expect(flat).toContain(
      'REVOKE ALL ON TABLE public.bos_cron_runs, public.bos_cron_run_recording FROM PUBLIC, anon, authenticated, service_role;'
    );
    expect(flat).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bos_cron_runs TO service_role;');
    expect(flat).toContain('GRANT SELECT ON TABLE public.bos_cron_run_recording TO service_role;');
    expect(flat).not.toMatch(/GRANT[^;]*(TRUNCATE|REFERENCES|TRIGGER|ALL PRIVILEGES)/i);
    expect(flat).not.toMatch(/GRANT[^;]*TO (anon|authenticated|PUBLIC)/i);
  });
});

describe('SC-5: the summary function', () => {
  const fn = () => flat.slice(flat.indexOf('CREATE FUNCTION public.admin_bos_cron_run_summary'), flat.indexOf('$$;') + 3);

  it('is a plain CREATE FUNCTION, never OR REPLACE (F-15: a second paste fails and changes nothing)', () => {
    expect(flat).toContain('CREATE FUNCTION public.admin_bos_cron_run_summary(');
    expect(flat).not.toMatch(/OR REPLACE/i);
  });

  it('is SQL, STABLE, SECURITY INVOKER, with an empty search_path', () => {
    const header = fn().slice(0, fn().indexOf('AS $$'));
    expect(header).toContain('LANGUAGE sql');
    expect(header).toContain('STABLE');
    expect(header).toContain('SECURITY INVOKER');
    expect(header).toContain("SET search_path = ''");
    expect(header).not.toContain('SECURITY DEFINER');
  });

  it('returns the last Vercel cron start as its own column', () => {
    expect(fn()).toContain('last_cron_started_at timestamptz');
    expect(fn()).toContain("r.source = 'vercel_cron'");
  });

  it('clamps its own limits: at most 50 jobs, 1..20 recent runs', () => {
    expect(fn()).toContain('[1:50]');
    expect(fn()).toContain('LEAST(GREATEST(COALESCE(p_recent, 10), 1), 20)');
  });

  it('"did not finish" is derived: running and past its deadline', () => {
    expect(fn()).toContain("(r.outcome = 'failed' OR (r.outcome = 'running' AND r.deadline_at < COALESCE(p_now, now())))");
  });

  it('every table name is schema-qualified inside the body', () => {
    const body = fn().slice(fn().indexOf('AS $$'));
    for (const match of body.match(/\bFROM\s+(\w+(\.\w+)?)/g) ?? []) {
      const name = match.replace(/FROM\s+/, '');
      if (name === 'unnest' || name.startsWith('(')) continue;
      expect(name).toMatch(/^public\./);
    }
  });

  it('EXECUTE for service_role only', () => {
    expect(flat).toContain(
      'REVOKE ALL ON FUNCTION public.admin_bos_cron_run_summary(text[], timestamptz, integer) FROM PUBLIC, anon, authenticated, service_role;'
    );
    expect(flat).toContain(
      'GRANT EXECUTE ON FUNCTION public.admin_bos_cron_run_summary(text[], timestamptz, integer) TO service_role;'
    );
  });
});

describe('the runbook (house style of 20261010)', () => {
  it('has a pre-check, an access check, a dry run that always rolls back, and "nothing kept"', () => {
    expect(runbook).toContain('STEP 1: PRE-CHECK');
    expect(runbook).toContain('P01 names free');
    expect(runbook).toContain('STEP 3: ACCESS CHECK');
    expect(runbook).toContain('STEP 4: DRY RUN');
    expect(runbook).toContain("RAISE EXCEPTION 'DRY RUN %");
    expect(runbook).toContain("'PASS'");
    expect(runbook).toContain('NOTHING KEPT');
    // SA-7: once PR-2 is live, the table holds real runs; the dry-run rows must not survive.
    expect(runbook.replace(/\s*\n--\s*/g, ' ')).toContain('Once PR-2 is live');
    expect(runbook).toContain("WHERE job = 'dry-run-job'");
    expect(runbook).toContain('SET LOCAL ROLE service_role');
  });

  it('the dry run exercises every refusal: string count, bad key, message as class, running with finish, failure without class, far deadline', () => {
    const refusals = [
      'D-2', 'D-2a', 'D-2b', 'D-2c', 'D-3', 'D-4', 'D-5', 'D-6', 'D-7',
      'D-12', 'D-13', 'D-14', 'D-15', 'D-16', 'D-17', 'D-18', 'D-19', 'D-20',
    ];
    for (const id of refusals) expect(runbook).toContain(`'${id} PASS`);
    expect(runbook.match(/EXCEPTION WHEN check_violation/g)?.length).toBe(refusals.length);
    // SA-1: the two arrays lax mode would have let through.
    expect(runbook).toContain(`'{"a": [1]}'`);
    expect(runbook).toContain(`'{"a": []}'`);
    // The expected text the user checks for is unchanged.
    expect(runbook).toContain('Expect the error text to start with "DRY RUN PASS"');
    expect(runbook).toContain("CASE WHEN v_fail THEN 'FAIL' ELSE 'PASS' END");
    expect(runbook).toContain('{"a b": 1}');
  });

  it('the access check asks one privilege per call where a list would mean "any"', () => {
    expect(runbook).toContain("has_table_privilege('service_role', 'public.bos_cron_runs', 'SELECT')");
    expect(runbook).toContain("has_table_privilege('service_role', 'public.bos_cron_runs', 'DELETE')");
  });

  it('the rollback is a separate file outside supabase/migrations, and drops exactly the three objects', () => {
    expect(existsSync(ROLLBACK)).toBe(true);
    const rb = stripComments(readFileSync(ROLLBACK, 'utf8')).replace(/\s+/g, ' ');
    expect(rb).toContain('DROP FUNCTION IF EXISTS public.admin_bos_cron_run_summary(text[], timestamptz, integer);');
    expect(rb).toContain('DROP TABLE IF EXISTS public.bos_cron_runs;');
    expect(rb).toContain('DROP TABLE IF EXISTS public.bos_cron_run_recording;');
    expect(rb.match(/\bDROP\b/g)).toHaveLength(3);
    expect(raw).toContain('supabase/SQL Scripts/20261011_bos_cron_runs_rollback.sql');
  });
});
