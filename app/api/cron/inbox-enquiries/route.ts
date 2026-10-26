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

/*
 * `runInboxChannels` IS NOT IMPORTED HERE. It is loaded inside the handler.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY, AND IT IS NOT A STYLE CHOICE
 *
 * The runner reaches the whole workflow engine, and one module on that path
 * throws while it is being EVALUATED rather than when it is called:
 *
 *   inboxChannelRunner → @/lib/pilot → lib/orchestration/RoutingService
 *                      → lib/supabaseAdmin, which throws
 *                        "Missing Supabase environment variables" at import
 *                        unless `SUPABASE_URL` is set.
 *
 * `SUPABASE_URL` is a SEPARATE variable from `NEXT_PUBLIC_SUPABASE_URL`, and a
 * deployment that has only the prefixed one builds every other route and dies
 * on this one. Measured twice on 2026-10-25: the same chain took out the jest
 * run (fixed with an env stub) and then the Vercel deployment, while the local
 * build and GitHub's `next build` both passed, because both environments
 * happened to have it.
 *
 * Imported lazily, nothing on that path is evaluated at build time, so this
 * route can be compiled and deployed by an environment that is missing a
 * variable it only needs at RUN time — and if it is still missing when the
 * cron fires, the catch below turns it into a logged 500 for one invocation
 * instead of a failed deploy for the whole application.
 *
 * It also keeps `lib/pilot` out of this function's bundle, which is a cron
 * that reads mailboxes and has no business carrying the agent runtime.
 * ─────────────────────────────────────────────────────────────────────────────
 */

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
    /* Loaded here, not at the top of the file — see the note on the imports. */
    const { runInboxChannels } = await import('@/lib/business-os/leads/inboxChannelRunner');
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
