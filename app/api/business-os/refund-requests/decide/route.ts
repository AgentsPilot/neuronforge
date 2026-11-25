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
import { resolveEmailBranding } from '@/lib/email/branding';
import { sendEmail } from '@/lib/notifications/emailTransport';
import { generateRefundDeclinedEmail } from '@/lib/email/templates/refund-declined';
import { resolveBusinessTimezone } from '@/lib/business-os/businessDay';

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
  /*
   * WHAT THE CLIENT IS TOLD, when the owner has approved a message to send.
   *
   * Drafted by `refund-requests/decline-draft`, edited by the owner, and
   * posted back here with the decision so the two happen together: a decision
   * recorded without its message leaves a client waiting, and a message sent
   * without its decision leaves the request open.
   *
   * Optional, and absent means silence — exactly what this route did before
   * the message existed. `handled` never carries one: the owner settled it
   * their own way and has already spoken to the client.
   */
  message: z.string().trim().min(1).max(4000).optional(),
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
    const { requestId, decision, message } = decideSchema.parse(body);

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
     * AND THE CLIENT IS TOLD, WHEN THE OWNER APPROVED SOMETHING TO SAY.
     *
     * Declining used to end here. The request closed, the card cleared, and
     * the client — who had asked for their own money back — heard nothing at
     * all, indefinitely. Approving a refund has always emailed them; refusing
     * one said nothing, which is the wrong way round: the "no" is the message
     * that actually needs sending.
     *
     * AFTER the decision, deliberately. The decision is the thing that must
     * not be lost; a transport that is down must not cost the owner a press
     * they have already confirmed. So a failed send is logged loudly and the
     * decision still stands — and because the request is now closed, the owner
     * sees it in the client's record rather than as a card that never clears.
     *
     * The message is the owner's own text (drafted, then edited by them), so
     * nothing here writes prose: `generateRefundDeclinedEmail` only puts it in
     * the business's frame. Its length is logged, never its content.
     * ─────────────────────────────────────────────────────────────────────────
     */
    if (decision === 'declined' && message && data.contact_id) {
      try {
        const { data: contact } = await supabaseServer
          .from('crm_contacts')
          .select('email, first_name')
          .eq('id', data.contact_id)
          .eq('user_id', user.id)
          .maybeSingle();

        const clientEmail = (contact as { email?: string } | null)?.email?.trim();

        if (!clientEmail) {
          requestLogger.warn(
            { userId: user.id, requestId },
            'Declined with a message, but this client has no email address on file'
          );
        } else {
          /*
           * ─────────────────────────────────────────────────────────────────
           * AND WHICH REQUEST IS BEING ANSWERED.
           *
           * The message alone made the client work that out. Somebody with
           * two bookings and one request in the air got a paragraph saying
           * no, with no amount, no date and nothing naming what it was about.
           *
           * `start_time` comes back with the service name — one more column
           * on a query already being made — and the clock is read from
           * `user_preferences`, the only authoritative timezone (CLAUDE.md
           * § Currency & Timezone; `business_profiles.timezone` does not
           * exist and naming it would fail the whole select).
           * ─────────────────────────────────────────────────────────────────
           */
          const [branding, { data: booking }, { data: prefs }] = await Promise.all([
            resolveEmailBranding(user.id),
            data.booking_id
              ? supabaseServer
                  .from('scheduling_bookings')
                  .select('start_time, service:scheduling_services(service_name)')
                  .eq('id', data.booking_id)
                  .eq('user_id', user.id)
                  .maybeSingle()
              : Promise.resolve({ data: null }),
            supabaseServer
              .from('user_preferences')
              .select('timezone')
              .eq('user_id', user.id)
              .maybeSingle(),
          ]);

          const service = (booking as { service?: { service_name?: string } | null } | null)?.service;

          const { timezone } = resolveBusinessTimezone({
            preferencesTimezone: (prefs as { timezone?: string | null } | null)?.timezone,
          });

          const { subject, html } = generateRefundDeclinedEmail({
            message,
            serviceName: (Array.isArray(service) ? service[0] : service)?.service_name ?? null,
            /* Facts from the record, under the owner's words. */
            amountRequested: data.amount_requested,
            currency: data.currency,
            bookingAt: (booking as { start_time?: string | null } | null)?.start_time ?? null,
            requestedAt: data.created_at,
            timezone,
            locale: branding.locale,
            branding,
          });

          const result = await sendEmail({
            kind: 'transactional',
            to: [clientEmail],
            subject,
            html,
            ownerUserId: user.id,
          });

          requestLogger.info(
            { userId: user.id, requestId, sent: result.sent, provider: result.provider, length: message.length },
            'Told the client their refund was declined'
          );
        }
      } catch (sendError) {
        /* Never into the response: the decision is recorded and must stand. */
        requestLogger.error(
          { errName: (sendError as Error)?.name, userId: user.id, requestId },
          'Recorded the decline but could not tell the client'
        );
      }
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
