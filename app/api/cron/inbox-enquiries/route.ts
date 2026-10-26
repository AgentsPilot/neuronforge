/**
 * Check every business's mailbox for new website enquiries.
 *
 * Every five minutes, because the number comes from the client's wait rather
 * than from our convenience: `reply_to_enquiries` sends fifteen minutes after a
 * lead is filed, chosen as "long enough to intervene, short enough that the
 * person who wrote in still has this business in mind". Polling every fifteen
 * would add fifteen more and halve that intent; polling every five keeps the
 * whole journey inside twenty.
 *
 * Each run is one filtered mailbox search per channel — unread, one sender, one
 * subject prefix, nothing older than setup day — which normally matches
 * nothing.
 *
 * This replaced nothing: the platform's generic scheduled-agent runner has been
 * switched off since 2026-09-27 and its revival is not this channel's to
 * decide. See the note in `lib/business-os/leads/inboxChannelRunner.ts`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { withCronRunRecord } from '@/lib/cron/cronRunRecorder';
import { runInboxChannels } from '@/lib/business-os/leads/inboxChannelRunner';

const logger = createLogger({ module: 'InboxEnquiriesCron' });

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Fail closed.
 *
 * This is a public URL and the bearer secret is the only thing separating a
 * Vercel invocation from an arbitrary caller — one who could otherwise make
 * every business on the platform read its own mailbox on demand. A missing
 * CRON_SECRET in production means the request cannot be authenticated, so it
 * is refused.
 */
function verifyCronSecret(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (process.env.NODE_ENV === 'development') {
    return true;
  }

  if (!cronSecret) {
    logger.error('CRON_SECRET not configured - refusing cron request (fail-closed)');
    return false;
  }

  return authHeader === `Bearer ${cronSecret}`;
}

async function runJob(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  if (!verifyCronSecret(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await runInboxChannels();

    /* Logged at info even when nothing happened: a channel that silently stops
       being checked looks identical to one with no new enquiries. */
    requestLogger.info(result, 'Inbox channels checked');
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    requestLogger.error({ err: error }, 'Inbox channel sweep failed');
    return NextResponse.json(
      { success: false, error: 'Inbox channel sweep failed' },
      { status: 500 }
    );
  }
}

/**
 * Every proven Vercel cron run is recorded (admin reorganisation slice 5): the
 * job body, its auth check and its response are unchanged; recording never
 * fails the job. See lib/cron/cronRunRecorder.ts.
 */
export const GET = withCronRunRecord('inbox-enquiries', runJob);
