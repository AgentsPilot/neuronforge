/**
 * The owner's answer to a client's refund request.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS ROUTE MOVES NO MONEY. IT RECORDS THE TWO ANSWERS THAT ARE NOT A REFUND.
 *
 * Saying yes is a refund, and a refund goes through the owner's own dialog ->
 * `/api/payments/refunds` -> `RefundService`, which owns the over-refund check
 * under a row lock, the cross-currency refusal, two layers of idempotency and
 * the ledger row written before Stripe is called. Accepting a `refunded` status
 * here would let a request be marked settled without any of that having
 * happened — a row claiming money went back when none did.
 *
 * So this route accepts `declined` and `handled`, and never `refunded`. The
 * request is closed, the card clears, the conversation it came from is
 * settled, and the money is exactly where it was.
 *
 * `handled` is the owner saying they dealt with it themselves — a transfer, a
 * phone call, something agreed off the record. The platform deliberately does
 * not claim to know which, which is why it is its own status rather than a
 * second spelling of one of the others.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { refundRequestRepository } from '@/lib/repositories/RefundRequestRepository';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ module: 'RefundRequestDecideAPI' });
const auditTrail = AuditTrailService.getInstance();

const decideSchema = z.object({
  requestId: z.string().uuid(),
  /*
   * TWO ANSWERS, AND DELIBERATELY NOT `refunded`.
   *
   *   declined  the owner said no, and the client will be told
   *   handled   the owner dealt with it themselves — a bank transfer, a phone
   *             call, something agreed off the record. The platform does not
   *             claim to know which, which is exactly why it is not `refunded`.
   *
   * `refunded` must come from a refund that actually happened: the database
   * trigger on `payment_refunds` writes it, wherever the money was returned
   * from. A schema accepting it here would make this route a second way to
   * claim money moved when none did.
   */
  decision: z.enum(['declined', 'handled']),
});

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { requestId, decision } = decideSchema.parse(body);

    const { data, error } = await refundRequestRepository.decide(requestId, user.id, decision);

    if (error) {
      requestLogger.error({ err: error, userId: user.id, requestId }, 'Refund decision failed');
      return NextResponse.json(
        { success: false, error: 'Failed to record the decision' },
        { status: 500 }
      );
    }

    /*
     * No row means it was not this business's request, or it had already been
     * answered. Both are "nothing to do here", and neither is a server fault:
     * a second press of the same button must not rewrite the first answer.
     */
    if (!data) {
      requestLogger.info({ userId: user.id, requestId }, 'Refund request was already settled');
      return NextResponse.json(
        { success: false, error: 'already_settled' },
        { status: 409 }
      );
    }

    /*
     * ─────────────────────────────────────────────────────────────────────────
     * AND THE CONVERSATION IT CAME FROM IS SETTLED TOO.
     *
     * A request that arrived by email has a mail thread behind it, and the
     * receptionist's row for that thread is what `client_reply_waiting` reads
     * to decide whether somebody is still waiting for a reply. Answering the
     * refund without settling the thread leaves the owner a card asking them
     * to reply to a client whose question they have just answered.
     *
     * `reply_handled` is the receptionist's own word for a settled thread, and
     * the gap already filters on it per thread — so this needs no new
     * mechanism, only the row.
     *
     * Non-blocking and scoped to the thread. Scoping to the CONTACT instead
     * would repeat the bug that silenced every other escalation from one
     * person for ever.
     * ─────────────────────────────────────────────────────────────────────────
     */
    if (data.source_thread_id && data.contact_id) {
      await supabaseServer
        .from('crm_activities')
        .insert({
          user_id: user.id,
          contact_id: data.contact_id,
          activity_type: 'reply_handled',
          title: 'refund',
          source_thread_id: data.source_thread_id,
          activity_date: new Date().toISOString(),
        })
        .then(({ error: activityError }) => {
          if (activityError) {
            requestLogger.warn(
              { err: activityError, requestId },
              'Could not settle the conversation this refund came from'
            );
          }
        });
    }

    /*
     * Audited, and the flush awaited (WC-7): this is the record of a business
     * telling a client no about their own money. `log()` only queues, and a
     * serverless instance that freezes before the background timer runs takes
     * the row with it.
     */
    auditTrail
      .log({
        action: decision === 'handled' ? 'REFUND_REQUEST_HANDLED' : 'REFUND_REQUEST_DECLINED',
        entityType: 'refund_request',
        entityId: data.id,
        userId: user.id,
        details: {
          bookingId: data.booking_id,
          contactId: data.contact_id,
          amountRequested: data.amount_requested,
          currency: data.currency,
          reason: data.reason,
          source: data.source,
        },
        request,
      })
      .catch(err => requestLogger.error({ err }, 'Audit failed (non-blocking)'));

    await auditTrail
      .flush()
      .catch(err => requestLogger.error({ err }, 'Audit flush failed'));

    requestLogger.info({ userId: user.id, requestId, decision }, 'Refund request answered');

    return NextResponse.json({ success: true, data: { id: data.id, status: data.status } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid input', details: error.flatten() },
        { status: 400 }
      );
    }
    requestLogger.error({ err: error }, 'Refund decision request failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
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
