/**
 * The scheduler's queue is the execution layer's own ledger, claimed properly.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY ASSERT ON SQL TEXT
 *
 * Jest has no Postgres, so the runner's tests model `FOR UPDATE SKIP LOCKED`
 * rather than executing it. That leaves the half that actually guarantees
 * no-double-running untested — and it is the half where a plausible-looking
 * edit does the most damage:
 *
 *   drop SKIP LOCKED           two passes block on each other, and the second
 *                              spends its whole budget waiting
 *   drop the status filter      a completed run is claimed again and the agent
 *                              runs twice
 *   drop the type filter        a MANUAL execution gets claimed by the
 *                              scheduler and re-run behind the owner's back
 *   lower the lease below 60s   the reaper reclaims a LIVE run — the function
 *                              has not been killed yet — and the agent runs
 *                              twice
 *   grant to authenticated      a browser session can claim and release work
 *                              across every tenant
 *
 * None of those break a mocked test. All of them are visible in the file.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND IT PINS THAT NO NEW TABLE WAS CREATED
 *
 * An earlier attempt at this work built a parallel `scheduled_agent_runs` table
 * in the Business OS half of the codebase — the data layer UNDERNEATH the
 * execution layer — beside the eight bounded chaser queues that live there.
 * That was a side system next to the thing it belonged inside.
 *
 * `agent_executions` has recorded agent runs since the beginning and already
 * carried `scheduled_at`, `status`, `retry_count`, `next_retry_at`,
 * `cron_expression` and `execution_type`. This migration adds the lease and
 * nothing else, and the tests below fail if it ever grows a table again.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const MIGRATION = 'supabase/migrations/20261101_agent_executions_claim.sql';
const sql = readFileSync(join(process.cwd(), MIGRATION), 'utf-8');

/** The migration with its commentary stripped, so prose cannot satisfy a test. */
const code = sql
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Just one function's body.
 *
 * Every assertion about a function slices to this rather than searching the
 * whole file, because `COMMENT ON FUNCTION … IS '…'` is real SQL that quotes
 * the very phrases these tests look for. A negative control proved the point on
 * the previous version of this file: with `SKIP LOCKED` deleted, a whole-file
 * `toContain` still passed on the comment text.
 */
function bodyOf(name: 'claim_due_scheduled_executions' | 'reap_stale_scheduled_executions'): string {
  const start = code.indexOf(`FUNCTION public.${name}`);
  expect(start).toBeGreaterThan(-1);
  /* To the next CREATE FUNCTION, or to the REVOKE block that follows both. */
  const after = code.slice(start + 1);
  const nextFn = after.indexOf('CREATE OR REPLACE FUNCTION');
  const revoke = after.indexOf('REVOKE ALL ON FUNCTION');
  const ends = [nextFn, revoke].filter((i) => i > -1);
  const end = ends.length ? start + 1 + Math.min(...ends) : code.length;
  return code.slice(start, end);
}

describe('it adds to the existing ledger and creates nothing new', () => {
  it('creates no table at all', () => {
    /* The whole correction. A scheduler queue beside `agent_executions` is a
       second answer to a question the execution layer already answers. */
    expect(code).not.toMatch(/CREATE TABLE/i);
  });

  it('adds only the lease, because the rest was already there', () => {
    expect(code).toContain('ALTER TABLE public.agent_executions');
    expect(code).toContain('ADD COLUMN IF NOT EXISTS claimed_by UUID');
    expect(code).toContain('ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ');

    /* Nothing else is added. `retry_count`, `next_retry_at`, `scheduled_at`,
       `status`, `cron_expression` and `execution_type` all predate this. */
    const added = [...code.matchAll(/ADD COLUMN IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
    expect(added.sort()).toEqual(['claimed_at', 'claimed_by']);
  });

  it('leaves agent_scheduler_state alone', () => {
    /*
     * There IS a ten-column table of that name with zero rows that looks built
     * for this. Every column duplicates `agents` or `agent_executions`, so
     * writing it would give the scheduler two clocks that can disagree. The
     * reasoning is in the migration header; this pins the decision.
     */
    expect(code).not.toContain('agent_scheduler_state');
    expect(sql).toMatch(/WHY NOT `agent_scheduler_state`/);
  });

  it('is honest that a lease needs a clock, not a boolean', () => {
    expect(sql).toMatch(/cannot answer "is this claim dead", because a boolean has no clock/);
  });
});

describe('the claim', () => {
  it('is an RPC, because PostgREST cannot express the lock', () => {
    expect(code).toContain('CREATE OR REPLACE FUNCTION public.claim_due_scheduled_executions');
    expect(bodyOf('claim_due_scheduled_executions')).toMatch(/RETURNS SETOF public\.agent_executions/);
  });

  it('locks with SKIP LOCKED, so two passes never take one row and never block', () => {
    expect(bodyOf('claim_due_scheduled_executions')).toContain('FOR UPDATE SKIP LOCKED');
  });

  it('claims and reads in one round trip', () => {
    /* `RETURNING *` on the UPDATE. A claim-then-reselect leaves a window where
       the row is claimed and the runner does not know it. */
    const claim = bodyOf('claim_due_scheduled_executions');
    expect(claim).toContain('RETURNING *');
    expect(claim).toContain("SET status = 'running'");
    expect(claim).toContain('retry_count = COALESCE(retry_count, 0) + 1');
    expect(claim).toContain('claimed_at = now()');
  });

  it('only ever considers pending rows that are due', () => {
    /* The terminal status IS the dedupe marker: a completed or failed run is
       invisible here, so it can never be executed a second time. */
    const claim = bodyOf('claim_due_scheduled_executions');
    expect(claim).toContain("WHERE status = 'pending'");
    expect(claim).toContain('next_retry_at IS NULL OR next_retry_at <= now()');
  });

  it('can never touch a manual execution', () => {
    /*
     * The sharpest hazard of putting the queue on the shared ledger. Someone
     * pressing Run on /api/run-agent produces rows in this table; the pilot
     * writes its own with `execution_type: 'manual'` hardcoded. Without this
     * filter the scheduler could claim and re-run one.
     */
    const claim = bodyOf('claim_due_scheduled_executions');
    expect(claim).toContain("execution_type = 'scheduled'");
  });

  it('drains the oldest missed tick first', () => {
    /* Newest-wins starves a backlog: the agent that has been failing longest
       would be the last one ever retried. */
    expect(bodyOf('claim_due_scheduled_executions')).toContain('ORDER BY scheduled_at NULLS FIRST, created_at');
  });

  it('is bounded even if the caller asks for everything', () => {
    expect(bodyOf('claim_due_scheduled_executions')).toMatch(
      /LIMIT LEAST\(GREATEST\(COALESCE\(p_batch, 1\), 1\), 100\)/
    );
  });

  it('refuses a null runner rather than claiming for nobody', () => {
    expect(bodyOf('claim_due_scheduled_executions')).toMatch(/IF p_runner IS NULL THEN\s*\n\s*RAISE EXCEPTION/);
  });
});

describe('the reaper', () => {
  it('dead-letters at max attempts with the marker the admin page compares', () => {
    const reap = bodyOf('reap_stale_scheduled_executions');
    expect(reap).toContain('dead-letter: max attempts');
    expect(reap).toContain('COALESCE(retry_count, 0) >= p_max_attempts');
  });

  it('backs off exponentially, capped at an hour', () => {
    expect(bodyOf('reap_stale_scheduled_executions')).toContain(
      'least(3600, 60 * power(2, COALESCE(retry_count, 0))::int)'
    );
  });

  it('only reclaims a claim that is older than the lease AND exists', () => {
    const reap = bodyOf('reap_stale_scheduled_executions');
    expect(reap).toContain('claimed_at < now() - make_interval(secs => p_lease_seconds)');
    /* `claimed_at IS NOT NULL` as well: a NULL comparison is NULL, not true,
       but stating it keeps the predicate readable and survives a rewrite. */
    expect(reap).toContain('claimed_at IS NOT NULL');
  });

  it('is scoped to scheduled runs, like the claim', () => {
    expect(bodyOf('reap_stale_scheduled_executions')).toContain("execution_type = 'scheduled'");
  });

  it('keeps the evidence rather than deleting a dead row', () => {
    /* A dead-lettered row is the only record that something is broken, and the
       thing an admin replays once it is fixed. */
    expect(code).not.toMatch(/DELETE FROM/i);
  });
});

describe('one scheduled run per tick', () => {
  it('is enforced by the database, not by the scheduler remembering', () => {
    /* The CAS on `agents.next_run` is an application-level race. This is the
       backstop under it, keyed on the TICK so two attempts at one tick are one
       row while consecutive ticks are two. */
    expect(code).toContain('CREATE UNIQUE INDEX IF NOT EXISTS agent_executions_one_scheduled_run_per_tick');
    expect(code).toMatch(/ON public\.agent_executions \(agent_id, scheduled_at\)/);
  });

  it('is partial, so a person pressing Run twice is not a duplicate', () => {
    /*
     * Two manual runs are two runs, not a collision. Making this unique over
     * the whole table would refuse the second — and there are a thousand
     * existing rows it would have had to be reconciled against.
     */
    const idx = code.slice(code.indexOf('agent_executions_one_scheduled_run_per_tick'));
    expect(idx).toMatch(/WHERE execution_type = 'scheduled' AND scheduled_at IS NOT NULL/);
  });

  it('indexes exactly the predicate the claim filters', () => {
    /* A partial index on a different status does not back the claim, and the
       claim is the hot path across a table with a thousand terminal rows. */
    expect(code).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_agent_executions_claimable[\s\S]*?WHERE status = 'pending' AND execution_type = 'scheduled'/
    );
  });
});

describe('the lease and the route agree', () => {
  it('the route lives for less time than the lease allows', () => {
    /*
     * THE ONE NUMBER PAIR THAT MATTERS. The platform hard-kills the function at
     * `maxDuration`, which is what makes a claim older than the lease PROVABLY
     * dead rather than guessed at. Lease below maxDuration = the reaper
     * reclaims a run that is still sending, and the agent runs twice.
     */
    const route = readFileSync(
      join(process.cwd(), 'app/api/run-scheduled-agents/route.ts'),
      'utf-8'
    );
    const maxDuration = Number(route.match(/export const maxDuration = (\d+);/)?.[1]);

    const runner = readFileSync(
      join(process.cwd(), 'lib/execution/scheduledAgentRunner.ts'),
      'utf-8'
    );
    const lease = Number(runner.match(/export const LEASE_SECONDS = (\d+);/)?.[1]);

    expect(maxDuration).toBe(60);
    expect(lease).toBe(90);
    expect(lease).toBeGreaterThan(maxDuration);
  });
});

describe('it is reachable only by the service role', () => {
  it('revokes both functions from every browser-facing role', () => {
    for (const fn of [
      'public.claim_due_scheduled_executions(UUID, INT)',
      'public.reap_stale_scheduled_executions(INT, INT)',
    ]) {
      expect(code).toContain(`REVOKE ALL ON FUNCTION ${fn} FROM PUBLIC, anon, authenticated;`);
      expect(code).toContain(`GRANT EXECUTE ON FUNCTION ${fn} TO service_role;`);
    }
  });

  it('adds no RLS policy, because the ledger already has its own', () => {
    /* `agent_executions` predates this work and carries whatever access rules
       it already had. A migration about claiming has no business redefining
       who may read an execution. */
    expect(code).not.toMatch(/CREATE POLICY/i);
    expect(code).not.toMatch(/ENABLE ROW LEVEL SECURITY/i);
  });
});
