/**
 * A client asking for their money back.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT RECORDS A REQUEST. IT MOVES NO MONEY, EVER.
 *
 * The refund itself goes through `lib/payments/RefundService.ts`, from a
 * surface the OWNER pressed — the dialog, or a card that opens it. Nothing a
 * client can reach may call it, and the catalogue's `movesMoney` gate exists
 * so an automation cannot either.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BOOKING IS CHECKED AGAINST THE SERVER'S OWN LIST, NOT TRUSTED
 *
 * `booking_id` arrives from a browser, so it is treated as a suggestion. The
 * same function that built the list the client was shown is run again here, and
 * the id must appear in it. That is what stops a client naming a booking that
 * is not theirs, or one of theirs with nothing refundable left, and it holds
 * even if the page was edited before the press.
 *
 * `amount` is checked against that list too, for the same reason: the cap the
 * form drew is not a cap, it is a label.
 *
 * @module app/api/book/manage/[token]/refund
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { resolvePortalAccess } from '@/lib/security/portalAccess';
import { rateLimit, tooManyRequests, RATE_LIMITS } from '@/lib/security/rateLimit';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { refundableBookingsFor } from '@/lib/payments/refundableBookings';
import { REFUND_REASON_KEYS } from '@/lib/payments/refundReasons';

const logger = createLogger({ module: 'API', service: 'PortalRefundRequest' });

const schema = z.object({
  booking_id: z.string().uuid(),
  amount: z.number().positive(),
  /* The owner's own five words, so the request reads in the vocabulary their
     refund dialog already uses. */
  reason: z.enum(REFUND_REASON_KEYS as unknown as [string, ...string[]]).optional(),
  note: z.string().max(2000).optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  /* No session stands in front of this route. */
  const throttle = await rateLimit(request, 'refund-request', RATE_LIMITS.write);
  if (!throttle.allowed) return tooManyRequests(RATE_LIMITS.write.windowSeconds);

  try {
    const access = resolvePortalAccess(token, request.headers.get('cookie'));
    if (!access) {
      const failures = await rateLimit(request, 'refund-request', RATE_LIMITS.write, 'failure');
      if (!failures.allowed) return tooManyRequests(RATE_LIMITS.write.windowSeconds);

      return NextResponse.json(
        { success: false, code: 'invalid_link', error: 'Invalid or expired link' },
        { status: 401 }
      );
    }

    const { bookingId: tokenBookingId, email } = access;

    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'That request was not complete.',
          details: process.env.NODE_ENV === 'development' ? parsed.error.errors : undefined,
        },
        { status: 400 }
      );
    }

    /*
     * The TOKEN'S booking, which proves who is asking. The booking being asked
     * ABOUT may be a different one — a client is sent a link about one thing
     * and may mean another — so the two are kept apart on purpose.
     */
    const { data: holder, error: holderError } = await supabaseServer
      .from('scheduling_bookings')
      .select('id, user_id, contact_id, contact:crm_contacts(email, first_name, last_name)')
      .eq('id', tokenBookingId)
      .maybeSingle();

    if (holderError || !holder) {
      requestLogger.warn({ err: holderError, bookingId: tokenBookingId }, 'Booking not found');
      return NextResponse.json({ success: false, error: 'Booking not found' }, { status: 404 });
    }

    const contact = Array.isArray(holder.contact) ? holder.contact[0] : holder.contact;
    const contactEmail = (contact as { email?: string } | null)?.email ?? '';

    /* The same check every other write on this route makes, in the same place:
       the token's address must be the booking's own contact. */
    if (contactEmail.toLowerCase() !== email.toLowerCase()) {
      requestLogger.warn({ bookingId: tokenBookingId }, 'Email mismatch on a refund request');
      return NextResponse.json({ success: false, error: 'Booking not found' }, { status: 404 });
    }

    if (!holder.contact_id) {
      return NextResponse.json(
        { success: false, error: 'There is nothing to refund on this booking.' },
        { status: 409 }
      );
    }

    /* Rebuilt server-side. What the browser sent is only allowed to CHOOSE
       from this, never to widen it. */
    const allowed = await refundableBookingsFor({
      userId: holder.user_id,
      contactId: holder.contact_id as string,
    });

    const target = allowed.find(b => b.bookingId === parsed.data.booking_id);

    if (!target) {
      requestLogger.warn(
        { contactId: holder.contact_id, asked: parsed.data.booking_id },
        'Refund asked for a booking that is not refundable for this client'
      );
      return NextResponse.json(
        { success: false, error: 'There is nothing left to refund on that booking.' },
        { status: 409 }
      );
    }

    /* A cent of slack for the float that came back through JSON. */
    if (parsed.data.amount > target.refundable + 0.001) {
      return NextResponse.json(
        { success: false, error: 'That is more than was paid for that booking.' },
        { status: 400 }
      );
    }

    const { data: created, error: insertError } = await supabaseServer
      .from('refund_requests')
      .insert({
        user_id: holder.user_id,
        contact_id: holder.contact_id,
        booking_id: target.bookingId,
        amount_requested: parsed.data.amount,
        /* The booking's own currency, from the server's list. Never the
           browser's, and never a default: a business may price one client in
           another currency. */
        currency: target.currency,
        reason: parsed.data.reason ?? null,
        note: parsed.data.note ?? null,
        /*
         * `submitted` IS THE HANDOFF TO THE AGENT, AND IT IS NOT A CARD YET.
         *
         * This said `awaiting_owner` while nothing assessed a request — the
         * form went straight to the owner's card. The refund agent changed
         * that: it claims rows in exactly this status, reads the booking and
         * the ledger, and writes `awaiting_owner` together with its
         * recommendation. One status, one meaning — "a person has to answer
         * this, and here is what we think".
         *
         * Writing `awaiting_owner` here breaks both halves: the agent's filter
         * never matches, so nothing is ever assessed, and the owner gets a card
         * with an empty recommendation panel. Both were observed.
         */
        status: 'submitted',
        source: 'portal_form',
      })
      .select('id')
      .single();

    if (insertError) {
      /*
       * 23505 is the one-open-request-per-booking index doing its job: they
       * have asked already. Told plainly, because "try again" would be a lie
       * and a second card about one thing is the outcome it exists to prevent.
       */
      if ((insertError as { code?: string }).code === '23505') {
        return NextResponse.json(
          { success: false, code: 'already_asked', error: 'You have already asked about that one. We are looking at it.' },
          { status: 409 }
        );
      }

      requestLogger.error({ err: insertError, userId: holder.user_id }, 'Could not record the refund request');
      return NextResponse.json(
        { success: false, error: 'We could not send that. Try again in a moment.' },
        { status: 500 }
      );
    }

    requestLogger.info(
      { userId: holder.user_id, requestId: created?.id, bookingId: target.bookingId },
      'Refund request recorded'
    );

    /*
     * ─────────────────────────────────────────────────────────────────────────
     * THE OWNER IS TOLD BY THE CARD, AND BY NOTHING ELSE HERE.
     *
     * This used to call `notifyOwnerOfLead({ kind: 'enquiry' })`, which was
     * wrong in three ways and shipped anyway:
     *
     *  1. THE WRONG STORY. `enquiry` means a stranger wrote in. The owner got
     *     "someone contacted you", the client's note as the whole message, and
     *     an "open details" button — with no mention of a refund and no mention
     *     of the amount. The one fact that matters, "they want ₪5,000 back",
     *     was the one fact the email did not carry.
     *
     *  2. IT INVITED A REPLY TO THE CLIENT. That template prints the client's
     *     address and sets Reply-To to them, because for a real enquiry that is
     *     the point. Here it put a reply box in front of an owner who had not
     *     yet decided anything.
     *
     *  3. IT QUEUED AN AUTOMATIC REPLY TO THE CLIENT. `LeadAlertService` calls
     *     `queueLeadReply` for `enquiry` only — the "here is a link to book"
     *     invitation. Sent to somebody who has just asked for their money back,
     *     that is the worst available answer. It was SKIPPED by the gate on
     *     2026-11-13 rather than refused by design, which is a near miss and
     *     not a safeguard.
     *
     * The card is the notification: `refund_requested` in
     * `lib/business-os/gaps/definitions.ts` renders the request with the
     * amount, the reason, the booking and the client's own words, and the
     * assessment adds a recommendation within five minutes. An owner-facing
     * email that says what actually happened is worth building; reusing the
     * lead template to fake one was not.
     * ─────────────────────────────────────────────────────────────────────────
     */

    /*
     * ─────────────────────────────────────────────────────────────────────────
     * AND THE REFUND AGENT IS NUDGED, IF THIS OWNER HAS ONE.
     *
     * `CADENCE_CRON.daily` is 09:00 UTC, so a request submitted at 10:00 would
     * sit for twenty-three hours before anything looked at it — and the owner
     * would hear about it from the client first. `runAutomationNow` is what the
     * Run now button calls: it sets `next_run` and the five-minute sweep picks
     * it up, so the card has a recommendation on it within minutes.
     *
     * Non-blocking and entirely optional. A business that has not installed the
     * agent gets no nudge and no error — their card renders the request cold,
     * which is exactly what this feature did before the agent existed. The
     * client's request is already saved by this point; nothing here can lose it.
     * ─────────────────────────────────────────────────────────────────────────
     */
    void (async () => {
      try {
        const { installedAutomations, runAutomationNow } = await import(
          '@/lib/business-os/automations/install'
        );
        /*
         * `installedAutomations` ensures the essential agents first, so a
         * business whose owner has never opened the agents page still gets
         * this request assessed. It respects a pause: an owner who switched
         * the refund agent off is not re-enrolled by a client submitting a
         * form.
         */
        const installed = await installedAutomations(holder.user_id);
        const agent = installed.find(a => a.automationId === 'assess_refund_requests');
        if (!agent) return;

        await runAutomationNow(holder.user_id, agent.agentId);
        requestLogger.info({ agentId: agent.agentId }, 'Nudged the refund agent');
      } catch (err) {
        requestLogger.warn({ err }, 'Could not nudge the refund agent (non-blocking)');
      }
    })();

    return NextResponse.json({ success: true, data: { id: created?.id } });
  } catch (error) {
    requestLogger.error({ err: error }, 'Refund request failed');
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
