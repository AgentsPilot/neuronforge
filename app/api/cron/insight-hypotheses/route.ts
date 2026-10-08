/**
 * Weekly: ask a model what to look at in each business, and look.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY ITS OWN CRON, AND WHY WEEKLY
 *
 * Not folded into `insight-detect`, which already loops every business serially
 * with LLM calls inside the loop and stops STARTING new ones at 240s to avoid
 * being killed mid-business (hazard H5). Adding a model call per business per
 * night to that would make a bad shape worse, for a pass whose findings change
 * over months rather than hours.
 *
 * WHAT A RUN COSTS, AND WHAT IT USUALLY PRODUCES
 *
 * One model call per business that clears `worthAsking`, then two cheap queries
 * per surviving proposal. Most weeks on most accounts it produces NOTHING, and
 * that is the correct outcome: the verifier is meant to turn away the questions
 * the data cannot answer. A run that confirmed something every week would mean
 * the thresholds were too loose, not that the business was interesting.
 *
 * NOTHING HERE REACHES AN OWNER. Confirmed findings land in
 * `insight_hypotheses` as `pending` and wait for a person. See the migration
 * header for why that review step is not optional.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';
import { withCronRunRecord } from '@/lib/cron/cronRunRecorder';
import { newBosGroupId } from '@/lib/business-os/llm/callCatalog';
import { runAiAction } from '@/lib/business-os/llm/aiActionAudit';
import { generateHypotheses } from '@/lib/business-os/insight/hypothesis/HypothesisService';
import {
  insightHypothesisRepository,
  type HypothesisInsert,
} from '@/lib/repositories/InsightHypothesisRepository';

export const runtime = 'nodejs';
export const maxDuration = 300;

const logger = createLogger({ module: 'InsightHypothesesCron' });

/**
 * Stop STARTING new businesses past this point.
 *
 * Below `maxDuration` with room for the business already in flight to finish.
 * Mirrors `insight-detect`'s `RUN_BUDGET_MS`: a run killed at the platform
 * limit loses everyone after the cut silently, with no cursor to resume from.
 * Reporting `usersRemaining` instead makes a schedule that cannot keep up
 * visible rather than mysterious.
 */
const RUN_BUDGET_MS = 240_000;

/** How many accounts one weekly run will touch. */
const MAX_USERS = 200;

/**
 * Fail CLOSED.
 *
 * Copied from `app/api/cron/payment-reminders/route.ts`, NOT from the insight
 * crons -- those treated a missing `CRON_SECRET` in production as authorised
 * until recently (hazard H4). This endpoint is a public URL and the bearer
 * secret is the only thing distinguishing Vercel's own call from anybody's.
 */
function verifyCronSecret(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  // Local manual triggering.
  if (process.env.NODE_ENV === 'development') return true;

  if (!cronSecret) {
    logger.error('CRON_SECRET not configured - refusing cron request (fail-closed)');
    return false;
  }

  return authHeader === `Bearer ${cronSecret}`;
}

/**
 * Accounts with enough trading history to be worth asking about.
 *
 * Bookings or invoices, which is the same pair `backfill-business-events` and
 * `automation-coverage` use. `worthAsking` in `buildProfile` then makes the
 * real decision per account, before any model call is paid for -- this is only
 * about not scanning the whole user table.
 */
async function candidateUsers(): Promise<string[]> {
  const ids = new Set<string>();

  const [{ data: bookings }, { data: invoices }] = await Promise.all([
    supabaseServer.from('scheduling_bookings').select('user_id').limit(1000),
    supabaseServer.from('payment_invoices').select('user_id').limit(1000),
  ]);

  for (const row of [...(bookings ?? []), ...(invoices ?? [])]) {
    if (row.user_id) ids.add(row.user_id as string);
  }

  return [...ids].slice(0, MAX_USERS);
}

async function runJob(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  if (!verifyCronSecret(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  const userIds = await candidateUsers();

  requestLogger.info({ userCount: userIds.length }, 'Hypothesis run starting');

  let asked = 0;
  let confirmed = 0;
  let rejected = 0;
  let skipped = 0;
  let failed = 0;
  let usersRemaining = 0;

  for (const [index, userId] of userIds.entries()) {
    if (Date.now() - startedAt > RUN_BUDGET_MS) {
      usersRemaining = userIds.length - index;
      requestLogger.warn(
        { usersRemaining, elapsedMs: Date.now() - startedAt },
        'Run budget reached; the rest wait for next week'
      );
      break;
    }

    /*
     * One group per business per run (Standard 3), minted here because this is
     * the function that owns the action. Logged where minted so a run can be
     * traced from the audit entry back to this line.
     */
    const groupId = newBosGroupId();

    try {
      // eslint-disable-next-line no-await-in-loop -- serial on purpose: one
      // model call at a time keeps the run's cost and duration predictable.
      const run = await runAiAction(
        {
          area: 'insights',
          actionType: 'insight_hypothesis_run',
          groupId,
          trigger: 'scheduled',
          accountId: userId,
          correlationId,
        },
        () => generateHypotheses(supabaseServer, userId, groupId)
      );

      if (run.skipped) {
        skipped += 1;
        continue;
      }

      asked += 1;

      /*
       * Both halves are stored: confirmed as `pending` for review, and the
       * turned-away ones as `unconfirmed` for learning. Keeping only the
       * confirmed half would leave the flattering portion of the evidence,
       * and the reject pile is how this feature is judged.
       */
      const rows: HypothesisInsert[] = [
        ...run.findings.map(f => ({
          userId,
          runGroupId: groupId,
          claim: f.claim,
          query: f.query as unknown as Record<string, unknown>,
          confirmWhen: f.confirmWhen as unknown as Record<string, unknown>,
          verdict: f.verdict as unknown as Record<string, unknown>,
          status: 'pending' as const,
          modelUsed: run.modelUsed,
        })),
        ...run.rejected.map(r => ({
          userId,
          runGroupId: groupId,
          claim: r.claim,
          query: {},
          confirmWhen: {},
          verdict: null,
          status: 'unconfirmed' as const,
          rejectReason: r.reason,
          modelUsed: run.modelUsed,
        })),
      ];

      // eslint-disable-next-line no-await-in-loop
      await insightHypothesisRepository.recordRun(rows);

      confirmed += run.findings.length;
      rejected += run.rejected.length;
    } catch (err) {
      /*
       * One business failing must not end the run for the rest, and the error
       * is logged WITHOUT the claim or the model's output -- those are prose
       * about somebody's business (Standard 5).
       */
      failed += 1;
      requestLogger.error({ err, userId }, 'Hypothesis generation failed for a business');
    }
  }

  const stats = { asked, confirmed, rejected, skipped, failed, usersRemaining, durationMs: Date.now() - startedAt };
  requestLogger.info(stats, 'Hypothesis run complete');

  return NextResponse.json({ success: true, data: stats });
}

/**
 * Every proven Vercel cron run is recorded (admin reorganisation slice 5): the
 * job body, its auth check and its response are unchanged; recording never
 * fails the job. See lib/cron/cronRunRecorder.ts.
 *
 * This route was scheduled in `vercel.json` with no registry row and no
 * recorder, so its runs were invisible on the operator page and two registry
 * tests had been failing on it. Both closed 2026-10-06.
 */
export const GET = withCronRunRecord('insight-hypotheses', runJob);

/** Vercel cron issues a GET; POST is here for manual triggering. */
export async function POST(request: NextRequest) {
  return runJob(request);
}
