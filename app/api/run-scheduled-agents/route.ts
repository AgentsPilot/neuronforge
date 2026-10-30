/**
 * The platform scheduler: run the agents whose schedule has come round.
 *
 * Every five minutes. One pass recovers runs whose function was killed
 * mid-execution, turns due agents into queued runs, and executes what is
 * queued.
 *
 * ---------------------------------------------------------------------------
 * ONE SCHEDULER FOR EVERY AGENT, WHICHEVER DOORWAY MADE IT
 *
 *     AgentsPilot EXECUTION LAYER   ← this route and lib/execution
 *            ▲                ▲
 *            │                │       two doorways, one agent
 *     INSIGHT SYSTEM     PROMPT FLOW
 *            │
 *     BUSINESS OS                     the data and management layer
 *
 * It selects on the scheduling contract — `mode='scheduled'`,
 * `schedule_enabled`, `status='active'`, `next_run` passed — and not on a tag,
 * so an agent written from a prompt and one the insight system recommended
 * travel the same road. `mode='on_demand'` agents are excluded by the query.
 *
 * Business OS keeps its own bounded chasers on their own crons
 * (`payment-reminders`, `insight-actions`, `lead-response`, …). This does not
 * touch them: they are the data layer's jobs, they are limited by design, and
 * an agent reaches Business OS data only through the `business-os` plugin.
 *
 * ---------------------------------------------------------------------------
 * WHAT CHANGED IN THIS ROUTE
 *
 * It used to read every scheduled agent on the platform with no limit, fan out
 * with an unbounded `Promise.allSettled`, advance `next_run` BEFORE the work,
 * and then dispatch through QStash to `/api/cron/process-queue` — which runs
 * `runAgentWithContext` or `runAgentKit`. Both are prompt-driven and neither
 * reads `pilot_steps`, so a compiled plan could not run that way at all: for an
 * agent with no prompt it died on `null.trim()` before doing anything.
 *
 * Now it delegates to `lib/execution/scheduledAgentRunner`, which claims each
 * tick with a compare-and-swap, queues it as a `pending` scheduled row of
 * `agent_executions`, claims that row with `FOR UPDATE SKIP LOCKED`, and
 * executes the plan through `WorkflowPilot` — the one thing in the codebase
 * that reads `pilot_steps`, and the same executor /api/run-agent has used
 * thousands of times.
 *
 * ---------------------------------------------------------------------------
 * IT STAYS SWITCHED OFF UNTIL SAID OTHERWISE
 *
 * `AGENT_SCHEDULER_ENABLED` is server-only and defaults to off, so this lands
 * recovering nothing, queueing nothing and running nothing, and answers with
 * zero counts. See the flag's own comment for what must be true first.
 *
 * @see lib/execution/scheduledAgentRunner.ts
 * @see supabase/migrations/20261101_agent_executions_claim.sql
 */

import { NextRequest, NextResponse } from 'next/server';

import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'Cron', service: 'ScheduledAgents' });

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/**
 * Must stay BELOW the runner's 90-second lease, or the reaper reclaims a run
 * that is still executing and the agent runs twice. The platform's hard kill at
 * this boundary is what makes a stale claim provably dead rather than guessed
 * at, so these two numbers move together or not at all.
 *
 * Was 30, which was shorter than `/api/cron/process-queue`'s 60 on the far side
 * of its own dispatch.
 */
export const maxDuration = 60;

/**
 * Is this Vercel Cron, and not the open internet?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Replaces a check that failed OPEN. It compared the header against
 * `Bearer ${process.env.CRON_SECRET}` with no test that the secret existed, so
 * on an environment missing it the expected value was the literal string
 * "Bearer undefined" — which anyone could send. It also logged the header it
 * rejected, putting a credential into the log line.
 *
 * The same shape every Business OS cron uses, and fails closed for the same
 * reason: a scheduler that runs for strangers is worse than one that does not
 * run.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function verifyCronSecret(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;

  if (process.env.NODE_ENV === 'development') {
    return true;
  }

  if (!cronSecret) {
    logger.error('CRON_SECRET not configured - refusing cron request (fail-closed)');
    return false;
  }

  return request.headers.get('authorization') === `Bearer ${cronSecret}`;
}

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  if (!verifyCronSecret(request)) {
    /* The header itself is never logged: it is a credential. */
    requestLogger.warn('Rejected an unauthenticated scheduler request');
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();

  try {
    /*
     * Imported lazily, inside the handler, on purpose.
     *
     * The runner reaches `@/lib/pilot`, whose import chain ends at
     * `lib/supabaseAdmin` and throws "Missing Supabase environment variables"
     * AT IMPORT TIME unless `SUPABASE_URL` is set — a different variable from
     * `NEXT_PUBLIC_SUPABASE_URL`. A top-level import therefore takes down the
     * whole route, and a build, before any code runs. That cost a deployment on
     * 2026-10-25; `/api/cron/inbox-enquiries` carries the same note.
     */
    const { runScheduledAgents } = await import('@/lib/execution/scheduledAgentRunner');

    const result = await runScheduledAgents();

    /*
     * Logged at info even when nothing happened: a scheduler that silently
     * stops running agents looks exactly like one with nothing due. The counts
     * are what separate the two, and a switched-off pass reports zeros with no
     * error rather than a failure.
     *
     * Agent names are deliberately absent — an agent's name is owner text.
     */
    requestLogger.info({ ...result, durationMs: Date.now() - startedAt }, 'Scheduler pass complete');

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    requestLogger.error({ err: error }, 'Scheduler pass failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Scheduler pass failed',
        details:
          process.env.NODE_ENV === 'development'
            ? error instanceof Error
              ? error.message
              : String(error)
            : undefined,
      },
      { status: 500 }
    );
  }
}
