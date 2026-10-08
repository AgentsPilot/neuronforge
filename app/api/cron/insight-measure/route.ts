/**
 * Insight Measurement Cron — did the advice help?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The second half of a loop that has only ever had a first half. The advisor
 * has always recorded the figure that made a card fire and whether the owner
 * acted; it has never gone back to look. This sweep re-reads the metric at 30
 * and 90 days and stores what it finds in `insight_measurements`.
 *
 * ⚠️ MOST ROWS WILL READ `unmeasurable` AT FIRST, AND THAT IS CORRECT.
 *
 * Both readings come from `derived_metrics`, and that series exists for only
 * 2 of the 11 metric keys live insights name: the metrics engine aggregates
 * `business_events`, while most detector metrics are STATES read from module
 * tables. A sweep of entirely unmeasurable rows is the loop reporting that
 * honestly, not a degraded run — which is why `unmeasurable` is stored rather
 * than skipped, and why it does not colour the job amber.
 *
 * WHY THIS IS NOT A CLAIM/LEASE DRAIN
 *
 * The `durable-queue-drain` pattern guards work with an external effect, where
 * double-processing means a second email or a second charge. Nothing is sent
 * or charged here: the sweep reads two numbers and writes one row, and the
 * unique index on `(insight_id, horizon_days)` makes a repeat attempt a
 * swallowed conflict. A second concurrent run is wasteful, never harmful.
 *
 * @see docs/architecture/BUSINESS_OS_INSIGHTS_MODULE.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { withCronRunRecord } from '@/lib/cron/cronRunRecorder';
import { supabaseServer } from '@/lib/supabaseServer';
import { measureDueInsights } from '@/lib/business-os/insight/outcome/MeasurementService';

const logger = createLogger({ module: 'InsightMeasureCron' });

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Fail closed.
 *
 * A public URL where the bearer token is the only thing separating a Vercel
 * invocation from an arbitrary caller. The three older insight crons each
 * shipped with a missing secret meaning "allow" and had to be corrected
 * (hazard H4); this one starts correct.
 */
function verifyCronSecret(request: NextRequest): boolean {
  if (process.env.NODE_ENV === 'development') return true;

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    logger.error('CRON_SECRET not configured - refusing cron request (fail-closed)');
    return false;
  }

  return request.headers.get('authorization') === `Bearer ${cronSecret}`;
}

async function runJob(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  if (!verifyCronSecret(request)) {
    requestLogger.warn('Unauthorized cron request');
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const startTime = Date.now();

  try {
    requestLogger.info('Starting insight measurement sweep');

    const summary = await measureDueInsights(supabaseServer);

    /*
     * `unmeasurable` is expected to dominate at first and is not an error:
     * most detectors compute straight from module tables rather than from
     * `derived_metrics`, so there is no series to re-read. A sweep of all
     * unmeasurable rows is a true report, not a failure.
     */
    requestLogger.info(
      { summary, durationMs: Date.now() - startTime },
      'Insight measurement sweep complete'
    );

    return NextResponse.json({
      success: true,
      data: { ...summary, durationMs: Date.now() - startTime },
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Insight measurement sweep failed');

    return NextResponse.json(
      {
        success: false,
        error: 'Measurement sweep failed',
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined,
      },
      { status: 500 }
    );
  }
}

/**
 * Every proven Vercel cron run is recorded (admin reorganisation slice 5): the
 * job body, its auth check and its response are unchanged; recording never
 * fails the job. See lib/cron/cronRunRecorder.ts.
 *
 * Wired 2026-10-07, once `20261006g_insight_measurements.sql` was applied.
 * Scheduled at 04:55 — after `insight-metrics` (03:00), whose series both of
 * this job's readings come from, and on a minute no other job holds.
 */
export const GET = withCronRunRecord('insight-measure', runJob);

/** Manual trigger, development only — the same gate the sibling crons use. */
export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json(
      { success: false, error: 'POST only allowed in development' },
      { status: 405 }
    );
  }

  return GET(request);
}
