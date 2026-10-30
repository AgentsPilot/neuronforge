/**
 * The execution layer's missing piece: running an agent by the clock.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHERE THIS SITS
 *
 *     AgentsPilot EXECUTION LAYER   ← this file
 *            ▲                ▲
 *            │                │       two doorways, one agent
 *     INSIGHT SYSTEM     PROMPT FLOW
 *            │
 *     BUSINESS OS                     the data and management layer
 *
 * An agent is an `agents` row with a compiled plan in `pilot_steps`, and
 * `WorkflowPilot.execute` is the only thing that reads it. It has run thousands
 * of times — but always because somebody ASKED, over HTTP at /api/run-agent.
 * Nothing ever ran one on a schedule. This module decides WHEN, and nothing
 * else: execution is `WorkflowPilot`, untouched.
 *
 * It does not care which doorway made the agent. A prompt-created agent and one
 * the insight system recommended are the same row by the time they get here;
 * the only difference is where their runtime values were stored, which
 * `inputsFor` resolves, and whether there is a prompt to pass.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT SELECTS ON THE SCHEDULING CONTRACT, NOT ON A TAG
 *
 * `mode='scheduled'` AND `schedule_enabled` AND `status='active'` AND
 * `next_run <= now()` — the five columns both creation paths already write.
 * Selecting on them rather than on a tag is what makes this one mechanism
 * instead of several, and means an agent scheduled tomorrow by any route
 * travels the identical road with no new code.
 *
 * `status='active'` is also the whole of pause: pausing an agent writes
 * `status='inactive'` and nothing else, so this filter is what makes it real.
 *
 * `mode='on_demand'` agents are excluded BY THE QUERY — not by a check a later
 * change could edit away. They simply do not match.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE QUEUE IS `agent_executions`
 *
 * No new table. The execution layer's own ledger already carries `scheduled_at`
 * (the tick), `status`, `retry_count`, `next_retry_at`, `cron_expression` and
 * `execution_type`; migration 20261101 added only the lease. So a queued run is
 * a `pending` scheduled row in the ledger it will be recorded in anyway.
 *
 * @see supabase/migrations/20261101_agent_executions_claim.sql
 * @see lib/repositories/ScheduledExecutionRepository.ts
 */

import parser from 'cron-parser';

import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { WorkflowPilot } from '@/lib/pilot';
import type { Agent as PilotAgent } from '@/lib/pilot/types';
import {
  scheduledExecutionRepository,
  type ScheduledExecution,
} from '@/lib/repositories/ScheduledExecutionRepository';
import { isAgentSchedulerEnabled } from '@/lib/utils/featureFlags';
import { currentPlanIfStale } from './committedPlan';
import { nextTickAfter } from '@/lib/business-os/schedule/interval';
import { scheduleIntervalOf } from '@/lib/business-os/schedule/stored';
import { auditLog } from '@/lib/services/AuditTrailService';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { inputsFor } from './inputsFor';

const logger = createLogger({ module: 'scheduledAgentRunner' });

/**
 * How long a claim is honoured before the reaper assumes the runner died.
 *
 * MUST exceed the route's `maxDuration` (60s). The platform hard-kills the
 * function at that point, so a row still `running` past this is provably dead
 * rather than merely slow. Raising one without the other reclaims a LIVE run
 * and executes the agent twice.
 */
export const LEASE_SECONDS = 90;

/** Attempts before a run is dead-lettered and stops being retried. */
export const MAX_ATTEMPTS = 5;

/**
 * How many agents may be queued, and how many runs drained, per pass.
 *
 * Bounded because the route has sixty seconds, and oldest-first in both phases
 * so a backlog drains in the order it accumulated. The route's old body had no
 * limit at all and fanned out with an unbounded `Promise.allSettled`.
 */
export const QUEUE_PER_PASS = 25;
export const DRAIN_PER_PASS = 10;

export interface ScheduledAgentPassResult {
  /** Agents whose `next_run` had passed. */
  due: number;
  /** Ticks turned into a queued run. */
  queued: number;
  /** Runs claimed and executed to completion. */
  ran: number;
  /** Runs claimed that failed. */
  failed: number;
  /** Runs claimed that were deliberately not executed. */
  skipped: number;
  /** Runs recovered from a pass that was killed mid-execution. */
  reaped: number;
}

/** Just the columns the scheduler needs. Never `select('*')` on `agents`. */
const AGENT_COLUMNS =
  'id, user_id, agent_name, status, schedule_cron, timezone, next_run, last_run, ' +
  'pilot_steps, workflow_steps, plugins_required, user_prompt, agent_config, ' +
  'created_at, updated_at';

interface DueAgent {
  id: string;
  user_id: string;
  agent_name: string;
  status: string;
  schedule_cron: string | null;
  timezone: string | null;
  next_run: string | null;
  last_run: string | null;
  pilot_steps: unknown;
  workflow_steps: unknown;
  plugins_required: string[] | null;
  user_prompt: string | null;
  agent_config: Record<string, unknown> | null;
  created_at: string;
  updated_at: string | null;
}

/**
 * How far into the hour one owner's agents sit. Deterministic, 0 to 59.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY ANY OFFSET AT ALL
 *
 * Every cadence in `CADENCE_CRON` fires at `0 9` — `daily`, `every_3_days`,
 * `weekly`, `fortnightly` and `monthly` alike. So on the 1st of a month every
 * adopted agent on the platform is due in the same minute. The drain takes 25
 * per pass and passes run every five minutes: five thousand agents due at
 * 09:00 would take the better part of a day to work through, and the agent at
 * the back would send its "you did not finish booking" mail at teatime.
 *
 * Nothing about that is visible at three scheduled agents, which is exactly
 * why it goes in now — the fix is free today and a migration later.
 *
 * DETERMINISTIC, AND KEYED ON THE OWNER
 *
 * Not random: a run must land at the same minute every day, or the owner
 * cannot tell when their business writes to its clients. Not per agent either
 * — one business's six agents staying together is the behaviour its owner
 * already understands. So the whole account moves as one, and accounts spread
 * across the hour.
 *
 * FNV-1a, the same hash `inboxPlanVersion` uses, so the codebase has one of
 * these and not two.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function scheduleOffsetMinutes(userId: string): number {
  let hash = 0x811c9dc5;

  for (let i = 0; i < userId.length; i += 1) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash % 60;
}

/**
 * Does this expression name one time of day, rather than a repeating interval?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE OFFSET MUST NOT TOUCH A SUB-HOURLY CADENCE, AND THIS IS WHY.
 *
 * An offset added to a repeating interval does not shift it, it STRETCHES it.
 * Take the mailbox channel, which runs every fifteen minutes: a run lands at
 * :17, the clock is read again, the next quarter hour is :30, plus the same
 * seventeen minutes is :47. Thirty minutes between runs instead of fifteen —
 * the cadence silently halved, which is the exact accident the mailbox
 * migration was careful to avoid inheriting.
 *
 * A fixed daily time has no such problem: 09:00 plus seventeen minutes is
 * 09:17 today and 09:17 tomorrow, because the next occurrence is computed from
 * the clock and not from the last run.
 *
 * So the test is on the SHAPE of the expression: both the minute and the hour
 * must be a single number. `0 9 * * *` and `0 9 1,15 * *` qualify — the day
 * fields may list or step as much as they like, since a once-a-day agent fires
 * at one time whichever days those are. A stepped minute field, or an hour
 * field of `*`, does not.
 *
 * (Written in words on purpose. A literal step expression inside a block
 * comment terminates it, which has now broken this file's siblings twice and
 * this comment once.)
 * ─────────────────────────────────────────────────────────────────────────────
 */
function namesAFixedTime(cron: string): boolean {
  const [minute, hour] = cron.trim().split(/\s+/);

  return /^\d+$/.test(minute ?? '') && /^\d+$/.test(hour ?? '');
}

/**
 * The next time this cron expression comes round, in the agent's own timezone,
 * moved into this owner's minute of the hour.
 *
 * Null on an unreadable expression. The route's old body fell back to
 * `now + 1 hour`, which invents a cadence nobody chose and then runs an agent
 * on it. For something that writes to a business's clients in its name, a
 * refusal that says so is the only honest answer.
 *
 * The offset is added AFTER the cron is parsed rather than baked into the
 * expression, for two reasons: the expression is what the owner is shown as
 * their cadence and must keep saying "every morning", and an offset applied
 * here is self-correcting — the cron is re-read from the clock after every run,
 * so the same owner lands on the same minute each time without anything
 * storing it.
 */
export function nextRunAfter(cron: string, timezone: string, userId?: string): Date | null {
  try {
    const next = parser
      .parseExpression(cron, { tz: timezone, currentDate: new Date() })
      .next()
      .toDate();

    if (!userId || !namesAFixedTime(cron)) return next;

    return new Date(next.getTime() + scheduleOffsetMinutes(userId) * 60_000);
  } catch (error) {
    logger.error({ err: error, cron, timezone }, 'Unreadable cron expression; agent not rescheduled');
    return null;
  }
}

/**
 * When this agent is next due, by whichever clock it was given.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO CLOCKS, AND WHY NOT ONE
 *
 * An interval, where the owner said "every N" and N is a number of days. Cron
 * cannot state that: a step on the day-of-month field means days 1, 4, 7 … 28,
 * 31 and then 1, so the gap across the end of a month is a day rather than
 * three. The interval is added to the TICK, which is exact and keeps the time
 * of day because the tick is already at it.
 *
 * A cron expression for everything else — minutes, hours, a named weekday, a
 * day of the month, and every agent installed before intervals existed. Those
 * are expressions a parser answers exactly, and they get the per-owner offset.
 *
 * The two cannot be merged by converting one into the other. Cron cannot say
 * "every three days", and an interval cannot say "Mondays" — which is what the
 * prompt flow's own builder emits, and what `weekly` has always meant.
 *
 * An interval agent also HAS a cron, written by `storageFor`, and this function
 * is where it is decided that the cron is not the answer. The expression states
 * the time of day so the row is selectable and legible; the interval states the
 * cadence. Reading them the other way round would run a three-day agent daily.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function nextRunFor(agent: DueAgent, tick: Date): Date | null {
  const interval = scheduleIntervalOf(agent.agent_config);

  if (interval) return nextTickAfter(tick, interval);

  if (!agent.schedule_cron) return null;

  return nextRunAfter(agent.schedule_cron, agent.timezone || 'UTC', agent.user_id);
}

/**
 * Phase 1 — turn due agents into queued runs.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CLAIM IS THE COMPARE-AND-SWAP ON `next_run`.
 *
 * Queueing is a read-then-write, so two overlapping passes both see the same
 * due agent. Moving `next_run` forward with a WHERE on the value we read makes
 * exactly one of them the winner: the loser updates no rows and skips. The
 * partial UNIQUE on (agent_id, scheduled_at) then backs it up in the database,
 * so a race that somehow beat the CAS still cannot produce two runs of a tick.
 *
 * `.is()` for a null and `.eq()` otherwise, because they are NOT the same
 * operator in PostgREST. The route's old body used `.eq('next_run', null)`
 * unconditionally, which matches nothing — so an agent whose `next_run` was
 * never seeded could never be claimed, for ever. `inboxChannelRunner` has the
 * correct version and names that bug in its own comment.
 * ─────────────────────────────────────────────────────────────────────────────
 */
async function queueDue(result: ScheduledAgentPassResult): Promise<void> {
  const now = new Date().toISOString();

  const { data, error } = await supabaseServer
    .from('agents')
    .select(AGENT_COLUMNS)
    .eq('mode', 'scheduled')
    .eq('schedule_enabled', true)
    .eq('status', 'active')
    .is('deleted_at', null)
    .not('schedule_cron', 'is', null)
    .lte('next_run', now)
    .order('next_run', { ascending: true })
    .limit(QUEUE_PER_PASS);

  if (error) {
    logger.error({ err: error }, 'Could not read due agents');
    return;
  }

  const due = (data ?? []) as unknown as DueAgent[];
  result.due = due.length;

  for (const agent of due) {
    const log = logger.child({ agentId: agent.id, userId: agent.user_id });

    const tick = agent.next_run;
    /*
     * A tick is required and a cron is NOT: an interval-scheduled agent has no
     * expression to parse. The guard used to demand both, which would have made
     * every agent created with the new control permanently invisible here —
     * active, correct and never run.
     */
    if (!tick) continue;

    const nextRun = nextRunFor(agent, new Date(tick));
    if (!nextRun) {
      /* No readable clock: an unparseable cron and no interval either. Left
         exactly as it is — not rescheduled, not run, and logged above. An agent
         visibly stuck beats one running on a cadence nobody chose. */
      continue;
    }

    const { data: claimed, error: claimError } = await supabaseServer
      .from('agents')
      .update({ next_run: nextRun.toISOString(), updated_at: new Date().toISOString() })
      .eq('id', agent.id)
      .eq('next_run', tick)
      .select('id');

    if (claimError) {
      log.error({ err: claimError }, 'Could not claim the tick');
      continue;
    }

    if (!claimed || claimed.length === 0) {
      log.debug('Another pass already claimed this agent');
      continue;
    }

    /*
     * `last_run` is deliberately NOT written here.
     *
     * The route's old body wrote it at claim time, which made "when did this
     * last run" mean "when was it last picked up" — a lie whenever the run then
     * failed. The ledger row carries the truth, and completion is what ends it.
     */
    const { data: row, error: queueError } = await scheduledExecutionRepository.queueRun({
      agent_id: agent.id,
      user_id: agent.user_id,
      scheduled_at: tick,
      cron_expression: agent.schedule_cron,
    });

    if (queueError) {
      /*
       * The tick is claimed and nothing is queued, so this tick is lost. It is
       * the one lossy path here and it is deliberate: rolling the CAS back
       * without a guard could resurrect a tick another pass is already working.
       * The next interval picks the agent up.
       */
      log.error({ err: queueError, tick }, 'Tick claimed but not queued; it is lost');
      continue;
    }

    if (row) {
      result.queued += 1;
      log.info({ tick, nextRun: nextRun.toISOString() }, 'Queued a scheduled run');

      /*
       * The SOC2 record that the platform decided to run somebody's agent.
       *
       * This route was the ONLY writer of `AGENT_RUN_STARTED` — a registered
       * event with an `agentspilot` audience — so delegating the body without
       * carrying it over would leave a catalogued event nothing writes. Logged
       * at the moment the tick is committed to, which is the decision worth
       * recording; what the run then did is in `agent_executions`.
       *
       * Non-blocking, per CLAUDE.md: an audit failure must never fail the work.
       */
      auditLog({
        action: AUDIT_EVENTS.AGENT_RUN_STARTED,
        entityType: 'agent',
        entityId: agent.id,
        userId: agent.user_id,
        resourceName: agent.agent_name,
        details: {
          execution_id: row.id,
          execution_type: 'scheduled',
          cron_expression: agent.schedule_cron,
          timezone: agent.timezone || 'UTC',
          scheduled_at: tick,
          next_run: nextRun.toISOString(),
          previous_next_run: tick,
          trigger_type: 'cron',
        },
        severity: 'info',
        complianceFlags: ['SOC2'],
      }).catch((err) => log.error({ err }, 'Audit failed (non-blocking)'));
    } else {
      /* The unique index spoke: already queued. Correct, and not a warning. */
      log.debug({ tick }, 'Tick already queued');
    }
  }
}

/** Phase 2 — claim queued runs and execute them. */
async function drain(runnerId: string, result: ScheduledAgentPassResult): Promise<void> {
  const claimed = await scheduledExecutionRepository.claimDue(runnerId, DRAIN_PER_PASS);
  if (claimed.length === 0) return;

  logger.info({ count: claimed.length, runnerId }, 'Claimed scheduled runs');

  /*
   * Serial, like `inboxChannelRunner` and unlike the route's old unbounded
   * concurrency. One run can walk a plan that writes to twenty-five people;
   * running ten of those at once inside a sixty-second function is how a pass
   * gets killed mid-send.
   */
  for (const run of claimed) {
    await executeOne(run, result);
  }
}

async function executeOne(
  run: ScheduledExecution,
  result: ScheduledAgentPassResult
): Promise<void> {
  const log = logger.child({ runId: run.id, agentId: run.agent_id, userId: run.user_id });

  try {
    /*
     * Re-read the agent at the moment of execution, scoped to the owner on the
     * claimed row.
     *
     * Between queueing and claiming the owner may have paused it, removed it,
     * or had its plan replaced. The guardrail belongs HERE, where the effect
     * happens, rather than at queue time — only this path can be sure.
     */
    const { data, error } = await supabaseServer
      .from('agents')
      .select(AGENT_COLUMNS)
      .eq('id', run.agent_id)
      .eq('user_id', run.user_id)
      .is('deleted_at', null)
      .maybeSingle();

    if (error) throw error;

    const agent = data as unknown as DueAgent | null;

    if (!agent) {
      await scheduledExecutionRepository.markSkipped(run.id, 'agent no longer exists');
      result.skipped += 1;
      return;
    }

    if (agent.status !== 'active') {
      /* Paused or archived since this was queued. A skip, not a failure: the
         owner decided, and the row records that they did. */
      await scheduledExecutionRepository.markSkipped(run.id, `agent is ${agent.status}`);
      result.skipped += 1;
      log.info({ status: agent.status }, 'Run skipped: the agent is no longer active');
      return;
    }

    /*
     * ───────────────────────────────────────────────────────────────────────
     * BRING THE PLAN UP TO DATE BEFORE RUNNING IT.
     *
     * Each owner gets their own `agents` row and the runtime reads the plan OFF
     * that row, so the plan is COPIED there at install. `planVersion` exists to
     * make that copy detectable when it falls behind, and until now nothing
     * compared the two — so a fix to a committed plan reached new installs
     * only.
     *
     * That was not hypothetical, and it has now happened to both families of
     * committed plan. All six adopted plans used a bare `{{stop_after_days}}`
     * where the pilot resolves `{{input.stop_after_days}}`, so every one failed
     * on its FIRST step; and the mailbox plans filed leads through the retired
     * `crm` plugin. In both cases correcting the committed file did nothing for
     * the agents already installed, and they would have carried the fault for
     * ever.
     *
     * Done HERE, at the moment of execution, because this is the one place
     * every run passes through: an owner who never reinstalls still gets the
     * fix, and a plan that is current costs one string comparison.
     * ───────────────────────────────────────────────────────────────────────
     */
    const fresher = await currentPlanIfStale(agent);
    if (fresher) {
      const { error: refreshError } = await supabaseServer
        .from('agents')
        .update({
          pilot_steps: fresher.steps,
          workflow_steps: fresher.steps,
          plugins_required: fresher.pluginsRequired,
          /* Built by the family that owns the agent, because each keeps its
             stamp under its own key. */
          agent_config: fresher.agentConfig,
          updated_at: new Date().toISOString(),
        })
        .eq('id', agent.id)
        .eq('user_id', agent.user_id);

      if (refreshError) {
        /* Run the stale plan rather than nothing: it may still work, and the
           next pass tries the refresh again. Loud, because a plan that cannot
           be refreshed is a fix that cannot land. */
        log.error(
          { err: refreshError, source: fresher.source, name: fresher.name },
          'Could not refresh a stale plan'
        );
      } else {
        agent.pilot_steps = fresher.steps;
        agent.workflow_steps = fresher.steps;
        agent.plugins_required = fresher.pluginsRequired;
        log.info(
          { source: fresher.source, name: fresher.name, planVersion: fresher.planVersion },
          'Refreshed a stale plan onto the agent before running it'
        );
      }
    }

    const steps = (agent.pilot_steps ?? agent.workflow_steps) as unknown[] | null;
    if (!Array.isArray(steps) || steps.length === 0) {
      /* No prompt fallback on purpose. An agent with no plan has nothing to
         execute, and improvising one is what the old dispatch path did. */
      await scheduledExecutionRepository.markSkipped(run.id, 'agent has no compiled plan');
      result.skipped += 1;
      return;
    }

    const inputValues = await inputsFor(agent);

    const pilotAgent: PilotAgent = {
      id: agent.id,
      user_id: agent.user_id,
      agent_name: agent.agent_name,
      /*
       * The prompt where there is one, empty where there is not — the single
       * difference between the two creation doorways. Safe because `userInput`
       * reaches only the memory injector and a serialization inside the pilot;
       * the plan is what executes.
       */
      user_prompt: agent.user_prompt ?? '',
      /* JSONB columns arrive as `unknown`. The cast is the same one
         /api/run-agent and `inboxChannelRunner` make at this seam: the shape is
         guaranteed by the compiler that wrote them, not by this read. */
      pilot_steps: agent.pilot_steps as PilotAgent['pilot_steps'],
      workflow_steps: agent.workflow_steps as PilotAgent['workflow_steps'],
      plugins_required: agent.plugins_required ?? [],
      status: agent.status,
      created_at: agent.created_at,
      updated_at: agent.updated_at ?? undefined,
    };

    const pilot = new WorkflowPilot(supabaseServer);

    /*
     * `runMode: 'production'` stated explicitly. It is the pilot's default, but
     * a scheduled run that writes to real clients should not depend on a
     * default staying what it is, and the positional signature makes the intent
     * invisible otherwise.
     *
     * The pilot writes its own `workflow_executions` record. It also writes a
     * derived `agent_executions` row of its own with `execution_type: 'manual'`
     * hardcoded — which is why the claim is scoped to `'scheduled'`: the
     * pilot's row can never be mistaken for queued work.
     */
    const execution = await pilot.execute(
      pilotAgent,
      agent.user_id,
      pilotAgent.user_prompt,
      inputValues,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'production'
    );

    const executionId = (execution as { executionId?: string })?.executionId ?? null;
    const succeeded = (execution as { success?: boolean })?.success;

    /*
     * ───────────────────────────────────────────────────────────────────────
     * THE PILOT REPORTS FAILURE BY RETURNING, NOT BY THROWING.
     *
     * `pilot.execute` resolves with `{ success: false }` when a step fails —
     * it does not reject. So a `try` around it catches a crash and nothing
     * else, and the first version of this counted a failed plan as a completed
     * run: `ran: 2, failed: 0` while `workflow_executions` said `failed`. The
     * ledger row said `completed` with `success: false` inside it, which is a
     * row that contradicts itself.
     *
     * Found by running it for real. No test caught it, because every mock
     * resolved truthfully.
     * ───────────────────────────────────────────────────────────────────────
     */
    if (succeeded === false) {
      const retry = (run.retry_count ?? 0) < MAX_ATTEMPTS;
      const why = (execution as { error?: string; message?: string })?.error
        ?? (execution as { message?: string })?.message
        ?? 'the plan reported failure';

      await scheduledExecutionRepository.markFailed(run.id, why, retry);
      result.failed += 1;

      /* `last_run` is NOT written: the agent did not successfully run. */
      log.error(
        { executionId, attempts: run.retry_count, willRetry: retry },
        'Scheduled run failed inside the plan'
      );
      return;
    }

    /*
     * `last_run` written once the work is actually done, so it means "last
     * ran" rather than "last picked up". The ledger row holds the detail.
     */
    await supabaseServer
      .from('agents')
      .update({ last_run: new Date().toISOString() })
      .eq('id', agent.id)
      .eq('user_id', agent.user_id);

    await scheduledExecutionRepository.markCompleted(run.id, {
      executionId,
      success: succeeded ?? null,
    });

    result.ran += 1;
    log.info({ executionId }, 'Scheduled run completed');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const retry = (run.retry_count ?? 0) < MAX_ATTEMPTS;

    await scheduledExecutionRepository.markFailed(run.id, message, retry);
    result.failed += 1;

    log.error({ err: error, attempts: run.retry_count, willRetry: retry }, 'Scheduled run failed');
  }
}

/**
 * One pass: recover abandoned runs, queue what is due, execute what is queued.
 *
 * The reaper goes FIRST so a run abandoned by a killed function is eligible in
 * this same pass rather than waiting another interval.
 */
export async function runScheduledAgents(): Promise<ScheduledAgentPassResult> {
  const result: ScheduledAgentPassResult = {
    due: 0,
    queued: 0,
    ran: 0,
    failed: 0,
    skipped: 0,
    reaped: 0,
  };

  /*
   * The off switch, checked before anything is read.
   *
   * Returning the zero result rather than throwing is deliberate: a scheduler
   * that is switched off is not a failed pass, and the response should not say
   * it was. Zero counts with no error is how an operator tells "off" from
   * "broken".
   */
  if (!isAgentSchedulerEnabled()) {
    logger.info('Agent scheduler is switched off; nothing was read or run');
    return result;
  }

  /* A fresh id per pass. The lease belongs to this invocation, not to the
     deployment — two concurrent passes must never share one. */
  const runnerId = crypto.randomUUID();

  const reaped = await scheduledExecutionRepository.reapStale(LEASE_SECONDS, MAX_ATTEMPTS);
  result.reaped = reaped.length;

  await queueDue(result);
  await drain(runnerId, result);

  return result;
}
