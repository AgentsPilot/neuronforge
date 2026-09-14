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
     * Kick the drain rather than waiting up to five minutes for the cron.
     *
     * Non-blocking, and it goes through the same claim RPC the cron uses, so
     * the two cannot both send. "Send now" that takes five minutes is not
     * send now.
     */
    dispatchLeadResponses().catch(err =>
      requestLogger.warn({ err }, 'Immediate drain failed; the cron will pick it up')
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
    }
    requestLogger.error({ err: error }, 'Failed to control a queued reply');
    return NextResponse.json({ success: false, error: 'Failed' }, { status: 500 });
  }
}
