/**
 * The owner's control over a reply that has not gone yet.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY CANCEL CAN FAIL, AND WHY THAT IS REPORTED HONESTLY
 *
 * A queued reply is either still pending or already claimed by the runner that
 * is about to send it. There is no third state and no way to un-send. So cancel
 * is a conditional update whose ROW COUNT is the answer: zero rows means a
 * runner got there first, and the only correct response is to say so rather
 * than to report a cancellation that did not happen.
 *
 * That is `ProposalSendService`'s claim-first doctrine read backwards — there,
 * everything visible happens after the claim succeeds; here, everything
 * cancellable stops being cancellable the moment it does.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { leadResponseRepository } from '@/lib/repositories/LeadResponseRepository';
import { dispatchLeadResponses } from '@/lib/services/LeadResponseDispatchService';
import { z } from 'zod';

const logger = createLogger({ module: 'LeadResponseControlAPI' });

/*
 * "Send now" runs the lead drain inside this request, so this route is a claim
 * path like the cron. Its runner must be provably dead before the reaper's
 * lease expires: 60 s here, below `LEASE_SECONDS = 90` in
 * LeadResponseDispatchService. Keep the two aligned (BL-7a part 2).
 */
export const maxDuration = 60;

/*
 * Rows the owner's click claims. Small, so the click waits for a few sends and
 * not a full cron batch of 25; anything else that is due goes with the cron.
 */
const SEND_NOW_BATCH = 5;

/*
 * An action and nothing else.
 *
 * No URL, no recipient, no `user_id`. The contact is in the path and is
 * re-checked against the caller inside the repository query; everything the
 * reply will contain was decided when it was queued.
 */
const ControlSchema = z.object({
  action: z.enum(['cancel', 'send_now']),
  kind: z.enum(['invite', 'chase']).default('invite'),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id: contactId } = await params;
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId, contactId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { action, kind } = ControlSchema.parse(body);

    if (action === 'cancel') {
      // Every clause is scoped: contact, kind, user, and still-pending.
      const { cancelled } = await leadResponseRepository.cancelPending(contactId, kind, user.id);
      if (!cancelled) {
        return NextResponse.json({ success: false, reason: 'already_sending' });
      }
      requestLogger.info({ kind }, 'Queued reply cancelled by the owner');
      return NextResponse.json({ success: true });
    }

    const { scheduled } = await leadResponseRepository.sendNow(contactId, kind, user.id);
    if (!scheduled) {
      return NextResponse.json({ success: false, reason: 'already_sending' });
    }

    /*
     * Drain now rather than waiting up to five minutes for the cron, and WAIT
     * for it.
     *
     * It goes through the same claim RPC the cron uses, so the two cannot both
     * claim a row. It is awaited, under the 60 s `maxDuration` above, because
     * a drain fired and forgotten can outlive this response: a frozen and
     * resumed instance can still hold a claimed row after the 90 s lease, when
     * the reaper has dead-lettered it. If an admin then retries that row, the
     * cron sends it and the late runner sends it again (BL-7a). Awaited and
     * capped, the runner is dead before the lease ends.
     *
     * The owner waits a few seconds; the user chose that over "send now" that
     * means "within five minutes" (Q-SA7C-1, option A).
     *
     * A failed drain is not the owner's failure: the row is already due, stays
     * pending, and the cron sends it. So it is logged and the answer is still
     * success.
     */
    try {
      // No chase sweep: the cron sweeps every 5 minutes, and the sweep is every business's work, not this owner's.
      await dispatchLeadResponses({ batch: SEND_NOW_BATCH, sweep: false });
    } catch (err) {
      requestLogger.warn({ err }, 'Immediate drain failed; the cron will pick it up');
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
    }
    requestLogger.error({ err: error }, 'Failed to control a queued reply');
    return NextResponse.json({ success: false, error: 'Failed' }, { status: 500 });
  }
}
