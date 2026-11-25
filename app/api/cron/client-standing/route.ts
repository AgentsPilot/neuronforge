/**
 * Takes today's picture of how every business's clients have behaved.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS RUNS AT ALL, WHEN THE ANSWER IS COMPUTED ON READ
 *
 * The drawer badge and the detectors do NOT need this job: they compute a
 * client's standing from source rows every time they are asked, which is what
 * stops them going stale the way an insight's figures did.
 *
 * What a computation cannot do is remember. "Missed one session in six last
 * quarter and four in eight this one" is the sentence an owner can act on, and
 * it can only ever be assembled from pictures taken at the time — the source
 * rows say what happened, never what the record looked like on a given day.
 *
 * AND IT CANNOT BE CAUGHT UP LATER. A snapshot of last Tuesday cannot be
 * recomputed once the sessions and instalments behind it have moved on. Either
 * this starts recording now or that history does not exist. That is the whole
 * reason the job ships before anything reads it.
 *
 * ── WHY IT IS CHEAP ─────────────────────────────────────────────────────────
 * Five scoped reads per account, and a write only for clients whose picture
 * CHANGED since the last one. On a quiet day it writes nothing at all.
 *
 * ── WHY EVERY ACCOUNT, NOT THE "ACTIVE" ONES ────────────────────────────────
 * The sibling crons enumerate through `business_events`. A client's standing
 * moves on facts that do not always write one — a session marked missed, an
 * instalment falling overdue by the passage of time alone — so an account with
 * no event today can still have a client whose record changed today. The
 * account list is the honest source, and it is small.
 */

import { NextRequest, NextResponse } from 'next/server';

import { snapshotClientStandings } from '@/lib/business-os/clients/clientStandingStore';
import { withCronRunRecord } from '@/lib/cron/cronRunRecorder';
import { createLogger } from '@/lib/logger';
import { isAuthorizedCronRequest } from '@/lib/cron/cronAuth';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ module: 'ClientStandingCron' });

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Cron auth: lib/cron/cronAuth.ts, fail-closed (PROD-1b, A5).

/*
 * Wrapped by `withCronRunRecord` below rather than exported directly.
 *
 * Without it this job ran but left no trace in `bos_cron_runs`, so it had no
 * run history and could never show as late or stopped on the crons page — the
 * one job on the schedule nobody could tell had failed.
 */
async function runJob(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  if (!isAuthorizedCronRequest(request, logger)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  const stats = { accounts: 0, clients: 0, written: 0, unchanged: 0, failed: 0 };

  try {
    const { data: accounts, error } = await supabaseServer
      .from('business_profiles')
      .select('user_id');

    if (error) throw error;

    const userIds = [...new Set((accounts ?? []).map(row => String(row.user_id)))];
    stats.accounts = userIds.length;

    /*
     * One account's failure is not the run's. A missing table or a malformed
     * row for one business must not cost every other business its picture of
     * the day — and a day missed is a day that cannot be recovered.
     */
    for (const userId of userIds) {
      try {
        const result = await snapshotClientStandings(supabaseServer, userId);
        stats.clients += result.computed;
        stats.written += result.written;
        stats.unchanged += result.unchanged;
      } catch (err) {
        stats.failed += 1;
        requestLogger.error({ err, userId }, 'Client standing snapshot failed for an account');
      }
    }

    requestLogger.info({ ...stats, ms: Date.now() - startedAt }, 'Client standing run complete');

    return NextResponse.json({ success: true, data: stats });
  } catch (error) {
    requestLogger.error({ err: error, ...stats }, 'Client standing run failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Client standing run failed',
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined,
      },
      { status: 500 }
    );
  }
}

export const GET = withCronRunRecord('client-standing', runJob);
