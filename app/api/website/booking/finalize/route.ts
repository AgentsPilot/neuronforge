/**
 * Website Booking Finalization API
 * POST - Finalize a booking after payment succeeds
 *
 * This endpoint:
 * 1. Updates the booking status to 'confirmed' and payment_status to 'paid'
 * 2. Creates/updates the CRM contact (if not already created)
 * 3. Links the contact to the booking
 * 4. Creates the CRM activity log
 *
 * Called after payment succeeds for paid services.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { BookingEmailService } from '@/lib/services/BookingEmailService';
import { syncBookingToOwnerCalendar } from '@/lib/scheduling/syncBookingCalendar';
import Stripe from 'stripe';
import { isInstallmentPlan } from '@/lib/payments/PaymentPlanService';
import { planPhases } from '@/lib/payments/planSchedule';
import { fromMinorUnits } from '@/lib/payments/refundMath';
import {
  locatePaymentIntentAccount,
  resolveUserConnectAccounts,
  type ChargeAccountColumns,
} from '@/lib/payments/stripeAccountContext';
import { z } from 'zod';
import { getWebsitePageRepository } from '@/lib/repositories/WebsitePageRepository';
import { loadAttempt, materialiseAttempt } from '@/lib/scheduling/materialiseAttempt';
import { verifyAttemptPayment } from '@/lib/scheduling/verifyAttemptPayment';

const logger = createLogger({ module: 'WebsiteBookingFinalizeAPI' });

const FinalizeSchema = z
  .object({
    subdomain: z.string().optional(),
    /*
     * One of these two, never neither.
     *
     * `booking_id` is a booking that already exists — every path that takes no
     * money writes one before the client ever gets here, and those are
     * unchanged.
     *
     * `attempt_id` is a card journey, where no booking exists yet BECAUSE the
     * client might not have come back. The booking is created below, once the
     * payment is known to have succeeded.
     */
    booking_id: z.string().uuid('Invalid booking ID').optional(),
    attempt_id: z.string().uuid('Invalid attempt ID').optional(),
    payment_intent_id: z.string().optional(),
    payment_status: z.enum(['pending', 'paid', 'failed']).optional(),
  })
  .refine(body => Boolean(body.booking_id) || Boolean(body.attempt_id), {
    message: 'One of booking_id or attempt_id is required',
  });

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const body = await request.json();

    // Validate input
    const validationResult = FinalizeSchema.safeParse(body);
    if (!validationResult.success) {
      requestLogger.warn({ errors: validationResult.error.flatten() }, 'Validation failed');
      return NextResponse.json(
        { success: false, error: 'Invalid request data', details: validationResult.error.flatten() },
        { status: 400 }
      );
    }

    const data = validationResult.data;

    /*
     * ─────────────────────────────────────────────────────────────────────────
     * THE BOOKING IS CREATED HERE, NOT BEFORE.
     *
     * For a card journey `create` wrote only an `abandoned_bookings` row: the
     * client was leaving to pay and might never return, and a booking written
     * then held the slot against every other client for ever.
     *
     * So the booking comes into existence at the first moment anybody knows the
     * client finished. Everything below this block is untouched and runs
     * against a real booking row exactly as it did before — which is the point
     * of materialising here rather than threading a second meaning through the
     * four hundred lines that follow.
     *
     * Only on `paid`. A `failed` or `pending` finalisation leaves the attempt
     * open, so the client can try again on the same record and the sweeper
     * closes it if they do not.
     * ─────────────────────────────────────────────────────────────────────────
     */
    let bookingId = data.booking_id ?? null;

    if (!bookingId && data.attempt_id) {
      if (data.payment_status !== 'paid') {
        requestLogger.info(
          { attemptId: data.attempt_id, paymentStatus: data.payment_status },
          'Finalise called without a successful payment; attempt left open'
        );
        return NextResponse.json(
          { success: false, error: 'Payment has not completed', code: 'not_paid' },
          { status: 400 }
        );
      }

      const attempt = await loadAttempt(data.attempt_id);

      if (!attempt) {
        requestLogger.warn({ attemptId: data.attempt_id }, 'No such booking attempt');
        return NextResponse.json(
          { success: false, error: 'Booking attempt not found' },
          { status: 404 }
        );
      }

      /*
       * ── ASK STRIPE, NOT THE BROWSER ─────────────────────────────────────
       *
       * `data.payment_status` above is a field the client sends. On its own it
       * meant a POST carrying a valid attempt uuid and `payment_status:
       * 'paid'` created a contact and a confirmed, paid booking with no money
       * anywhere.
       *
       * The check below is the same standard this route already applies forty
       * lines down to which account a charge lives on: "nothing it sends is
       * evidence". Either witness will do — the PaymentIntent the embedded
       * form returns, or the Checkout session recorded on the attempt — and
       * both are read from Stripe.
       */
      const verdict = await verifyAttemptPayment(attempt, data.payment_intent_id);

      if (!verdict.paid) {
        requestLogger.error(
          { attemptId: attempt.id, reason: verdict.reason, paymentIntentId: data.payment_intent_id },
          'Finalise refused: the payment could not be confirmed with Stripe'
        );

        return NextResponse.json(
          {
            success: false,
            code: 'payment_unverified',
            /* Deliberately not "you did not pay": a client who did pay and hit
               a lookup failure must not be told they did not. */
            error: 'We could not confirm that payment. Nothing has been booked or charged twice.',
          },
          { status: 402 }
        );
      }

      requestLogger.info(
        { attemptId: attempt.id, via: verdict.via },
        'Payment confirmed with Stripe; creating the booking'
      );

      const made = await materialiseAttempt(attempt);

      if (!made.ok) {
        /*
         * `slot_taken` is the one place in this design where money has been
         * taken and no booking exists. Nothing held the slot while the client
         * was paying, so somebody else could finish first. The caller refunds;
         * it is never left as a bare error for the client to interpret.
         */
        requestLogger.error(
          { attemptId: attempt.id, reason: made.reason },
          'Could not create the booking for a payment that succeeded'
        );

        return NextResponse.json(
          {
            success: false,
            code: made.reason,
            error:
              made.reason === 'slot_taken'
                ? 'That time was taken while you were paying. Your payment will be returned.'
                : 'Your payment succeeded but the booking could not be created.',
            refund_required: true,
          },
          { status: 409 }
        );
      }

      bookingId = made.bookingId;
    }

    // Look up the booking with contact data via JOIN
    // Note: client_* fields removed from scheduling_bookings - now JOINed from crm_contacts
    const { data: booking, error: bookingError } = await supabaseServer
      .from('scheduling_bookings')
      .select(`
        id,
        user_id,
        service_id,
        start_time,
        timezone,
        contact_id,
        status,
        payment_status,
        contact:crm_contacts(
          id,
          first_name,
          last_name,
          email,
          phone
        )
      `)
      .eq('id', bookingId)
      .single();

    if (bookingError || !booking) {
      requestLogger.warn({ bookingId }, 'Booking not found');
      return NextResponse.json(
        { success: false, error: 'Booking not found' },
        { status: 404 }
      );
    }

    // Verify subdomain matches booking owner (if provided)
    if (data.subdomain) {
      const { data: websitePage, error: pageError } = await getWebsitePageRepository(supabaseServer).findBySubdomainAny(data.subdomain);

      if (pageError || !websitePage || websitePage.user_id !== booking.user_id) {
        requestLogger.warn({ subdomain: data.subdomain, bookingUserId: booking.user_id }, 'Subdomain mismatch');
        return NextResponse.json(
          { success: false, error: 'Booking not found' },
          { status: 404 }
        );
      }
    }

    const ownerId = booking.user_id;


    // Get contact data from the JOIN
    const contact = Array.isArray(booking.contact) ? booking.contact[0] : booking.contact;

    // Contact should already exist from /create endpoint (contact_id is NOT NULL)
    // Just upgrade the stage to 'active_client' since payment succeeded
    const contactId = booking.contact_id;

    if (!contactId) {
      // This should not happen since contact_id is now NOT NULL in the database
      requestLogger.error({ bookingId: booking.id }, 'Contact missing - contact_id is required');
      return NextResponse.json(
        { success: false, error: 'Booking is missing contact information' },
        { status: 500 }
      );
    }

    /*
     * Nothing to do here any more.
     *
     * This promoted the contact inline, which is how only the paths that
     * remembered to ask ever promoted anyone.
     *
     * The rule now lives in the database: `promote_contact_on_payment` on
     * `payment_transactions`, firing on a row that is `succeeded` for more
     * than zero, and resolving the business's own client stage by
     * `stage_type`. This route records such a row, so the promotion follows
     * from that and needs nothing here.
     *
     * NOT "a booking was confirmed", which an earlier version of this note
     * claimed and named `promote_contact_on_confirmed_booking` for. That
     * trigger was DROPPED in 20260920: a free intro call is confirmed and is
     * not a sale, so confirmation promoted people who had bought nothing.
     */

    // Get service name for activity logging
    const { data: service } = await supabaseServer
      .from('scheduling_services')
      .select('service_name')
      .eq('id', booking.service_id)
      .single();

    // Get service details for payment transaction record
    const { data: serviceDetails } = await supabaseServer
      .from('scheduling_services')
      .select('service_name, price, currency, payment_type, installment_count')
      .eq('id', booking.service_id)
      .single();

    /*
     * A payment plan's money is NOT recorded here.
     *
     * This route writes `amount: serviceDetails.price` — the whole service
     * price. For a plan that is the wrong number by design: the client paid one
     * period, and Stripe will collect the rest over the coming months. Writing
     * the full total here recorded ₪1,000 of revenue for a ₪333 charge, and
     * then `recordPlanPeriodPaid` recorded the real ₪333 from `invoice.paid` on
     * top of it — the same payment banked twice, once at triple its value.
     *
     * The webhook is the correct authority for every period, including the
     * first: it is the only one that sees periods 2..n at all, and it takes the
     * amount from the invoice Stripe actually charged rather than from a price
     * that describes the agreement instead of the payment.
     */
    const isPlanBooking = isInstallmentPlan(serviceDetails ?? {});

    if (isPlanBooking) {
      requestLogger.info(
        { bookingId: booking.id, serviceId: booking.service_id },
        'Payment plan booking — leaving every period to the webhook to record'
      );
    }

    // Create payment transaction record if we have a payment_intent_id
    let paymentTransactionId: string | null = null;
    if (data.payment_intent_id && serviceDetails?.price && !isPlanBooking) {
      // Which Stripe account this charge lives on — asked of Stripe, not taken
      // from the browser.
      //
      // This route finalises from the client, so nothing it sends is evidence.
      // The account still has to be recorded here or the payment is
      // unrefundable: these are direct charges, and a refund issued against the
      // wrong account either errors or returns money from the wrong balance.
      //
      // A failure to resolve is not fatal. The payment is real and must be
      // recorded either way; it is simply marked unresolved, which makes the
      // refund path refuse rather than guess, and puts the row in the
      // reconciler's queue.
      let accountContext: ChargeAccountColumns = {
        stripe_connect_account_id: null,
        charge_account_kind: 'platform',
        account_resolution: 'unknown',
      };

      try {
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
        const candidates = await resolveUserConnectAccounts(supabaseServer, ownerId);
        accountContext = await locatePaymentIntentAccount(
          stripe,
          data.payment_intent_id,
          candidates
        );
      } catch (accountError) {
        requestLogger.warn(
          { err: accountError, paymentIntentId: data.payment_intent_id },
          'Could not resolve the Stripe account for this payment; recording it as unresolved'
        );
      }

      const { data: paymentTransaction, error: paymentError } = await supabaseServer
        .from('payment_transactions')
        .insert({
          ...accountContext,
          user_id: ownerId,
          contact_id: contactId,
          service_id: booking.service_id, // Proper column for revenue tracking (added in migration 20260809)
          // THE COLUMN, not metadata.
          //
          // It has existed since 20260810_add_booking_id_to_payment_transactions,
          // and the comment saying it was coming "in a future migration" outlived
          // the migration. Both readers query the column: `findSettledForBooking`
          // and `resolveRefundTarget`. So every website booking payment was
          // unrefundable — "no settled payment is recorded against this" — and
          // the paid-booking delete guard could not see it either, so a paid
          // booking deleted cleanly and orphaned its money.
          booking_id: booking.id,
          stripe_payment_intent_id: data.payment_intent_id,
          amount: serviceDetails.price,  // SINGLE source of truth for payment amount
          currency: serviceDetails.currency || 'USD',
          status: data.payment_status === 'paid' ? 'succeeded' : 'pending',
          payment_method: 'card',
          processor_type: 'stripe', // Required for refunds to work correctly
          description: `Booking: ${service?.service_name || 'Service'}`,
          metadata: {
            // Kept alongside the column, not instead of it: rows written before
            // this fix carry it only here, and reconciliation reads both.
            booking_id: booking.id,
            source: 'website_booking'
          },
          paid_at: data.payment_status === 'paid' ? new Date().toISOString() : null
        })
        .select('id')
        .single();

      /*
       * A DUPLICATE IS NOT A FAILURE. IT MEANS THE WEBHOOK GOT HERE FIRST.
       *
       * ───────────────────────────────────────────────────────────────────────
       * `payment_transactions.stripe_payment_intent_id` is unique, and Stripe's
       * `payment_intent.succeeded` webhook records the same payment from the
       * other side. Whichever arrives second violates that constraint — and on
       * a cold serverless invocation, or a dev compile, it is routinely this
       * one: the webhook fired while this route was still compiling.
       *
       * Treating 23505 like any other insert error cost a real client: the money
       * was taken and recorded (correctly, and linked to the booking by the
       * webhook via `metadata.booking_id`), this route returned 500 before
       * reaching the update below, and so the booking stayed `pending` while its
       * `payment_status` read `paid`. No confirmation email was sent at all. The
       * owner saw an unconfirmed booking; the client saw nothing and had paid
       * €100.
       *
       * The constraint did exactly its job — it stopped the money being counted
       * twice. What was wrong was reading that as "the payment is not recorded".
       * So the existing row is adopted and the finalisation continues.
       * ───────────────────────────────────────────────────────────────────────
       */
      const isDuplicate = paymentError?.code === '23505';

      if (isDuplicate) {
        /*
         * ADOPTING IT IS NOT ENOUGH — IT HAS TO BE ATTACHED TO THIS BOOKING.
         *
         * ─────────────────────────────────────────────────────────────────────
         * This read the existing row's id and continued, on the reasoning in
         * the note above: the webhook "already linked it to the booking via
         * `metadata.booking_id`".
         *
         * That is true only when the booking already existed when the webhook
         * ran. On a smart link it does NOT: the client pays first and the
         * booking is written seconds later, so the webhook's row carries
         * `metadata.booking_id: null` and no `booking_id` column either.
         * Adopting it left the payment permanently unattached while
         * `booking.payment_id` pointed at it — a link in one direction only.
         *
         * Everything that finds a booking's money by `booking_id` then finds
         * none: `propagate_refund_to_booking` resolves a NULL target so a
         * refund leaves the booking reading `paid`, `notifyRefund` resolves
         * the recipient through the booking so the client is never told, and
         * the client's own portal totals nothing.
         *
         * Live case: transaction 906f586d, ₪150 succeeded at 21:46:45, booking
         * dbafeb6e written at 21:46:47, `updated_at` never moved off
         * `created_at`.
         *
         * `linkPaymentsToBooking` is the usual repair and could not help here:
         * it finds the payment through Stripe's SEARCH API, which is
         * eventually consistent and returns nothing for an object seconds old.
         * That is why these rows were only ever linked by the 15-minute
         * reconcile cron, long after the refund had been issued.
         *
         * No search is needed. This route was handed the payment intent id by
         * the browser and has already verified it against Stripe, so the row
         * is identified exactly and stamped here.
         *
         * `.is('booking_id', null)` keeps it idempotent: a row the webhook did
         * manage to link is never moved to a different booking.
         * ─────────────────────────────────────────────────────────────────────
         */
        const { data: adopted } = await supabaseServer
          .from('payment_transactions')
          .update({ booking_id: booking.id, contact_id: contactId })
          .eq('stripe_payment_intent_id', data.payment_intent_id)
          .eq('user_id', ownerId)
          .is('booking_id', null)
          .select('id')
          .maybeSingle();

        /* Already linked — by the webhook, or by a retry of this route. Read it
           so the booking still gets its `payment_id` below either way. */
        const { data: existing } = adopted
          ? { data: adopted }
          : await supabaseServer
              .from('payment_transactions')
              .select('id')
              .eq('stripe_payment_intent_id', data.payment_intent_id)
              .eq('user_id', ownerId)
              .maybeSingle();

        paymentTransactionId = existing?.id ?? null;

        requestLogger.info(
          {
            bookingId: booking.id,
            paymentIntentId: data.payment_intent_id,
            paymentTransactionId,
            attached: Boolean(adopted),
          },
          'The webhook recorded this payment first; attached its transaction to the booking and continuing'
        );
      } else if (paymentError) {
        // A real insert failure. Still not non-blocking: the booking was about
        // to be marked paid regardless, which is the exact inversion
        // `invoiceSettlement` was rewritten to avoid — money recorded nowhere, a
        // booking claiming it arrived, and nothing refundable. Stripe has the
        // money either way, so failing here leaves the webhook to settle it,
        // which is the correct authority.
        requestLogger.error(
          { err: paymentError, bookingId: booking.id, paymentIntentId: data.payment_intent_id },
          'Could not record the payment; leaving the booking for the webhook to settle'
        );

        return NextResponse.json(
          { success: false, error: 'Could not record this payment. It will be confirmed shortly.' },
          { status: 500 }
        );
      } else {
        paymentTransactionId = paymentTransaction?.id || null;
        requestLogger.info({ paymentTransactionId, paymentIntentId: data.payment_intent_id }, 'Payment transaction created');
      }
    }

    // Update booking with confirmed status and payment transaction reference
    // Note: contact_id should already be set from /create, but update it to be safe
    const updateData: Record<string, string | number | null> = {
      contact_id: contactId,
      status: 'confirmed',
      payment_status: data.payment_status || 'paid'
      // Removed total_amount - payment amount should only exist in payment_transactions
      // This prevents double-counting in revenue calculations
    };

    // Store payment transaction ID reference (UUID) instead of Stripe intent ID
    if (paymentTransactionId) {
      updateData.payment_id = paymentTransactionId;
    }

    const { error: updateError } = await supabaseServer
      .from('scheduling_bookings')
      .update(updateData)
      .eq('id', bookingId);

    if (updateError) {
      requestLogger.error({ err: updateError }, 'Failed to update booking');
      return NextResponse.json(
        { success: false, error: 'Failed to finalize booking' },
        { status: 500 }
      );
    }

    /*
     * ─────────────────────────────────────────────────────────────────────────
     * THE MONEY LEARNS WHICH BOOKING IT WAS FOR.
     *
     * Everything above tells the BOOKING about its payment. Nothing told the
     * payment about the booking, and every reader that goes looking for a
     * booking's money searches from that side: the drawer reads stages by
     * `booking_id`, `resolveRefundTargets` matches on `booking_id` or an
     * invoice, and the insight layer groups by client.
     *
     * The rows are written a minute before this, by the Stripe webhook, when
     * there is no booking to name. Stripe's metadata carries the attempt, and
     * this is the moment both exist.
     *
     * ── WHY NOT THE PAYMENT INTENT ──────────────────────────────────────────
     * This block used to key off `paymentTransactionId`, found from
     * `data.payment_intent_id`. That is null on the booking widget, which sends
     * only `attempt_id` — and for an instalment sale there is no payment intent
     * to send at all, because Stripe puts the charge on the subscription's
     * invoice. So the one path that sells instalments was the one path the fix
     * could never fire on.
     * ─────────────────────────────────────────────────────────────────────────
     */
    /* `bookingId` as well as the attempt: there is nothing to link money TO
       until the booking exists, and the parameter is `string` for that reason.
       It was passed as `string | null` here, which only type-checked because
       the build ignores these errors. */
    if (data.attempt_id && bookingId) {
      const { linkPaymentsToBooking } = await import('@/lib/payments/linkPaymentsToBooking');

      await linkPaymentsToBooking({
        attemptId: data.attempt_id,
        bookingId,
        contactId,
        userId: ownerId,
        /*
         * A SECOND LOCAL KEY, when the browser came back with one.
         *
         * The note above explains why this block keys off the attempt rather
         * than the payment intent, and that reasoning still holds — the widget
         * sends no intent, and an instalment sale's charge sits on the
         * subscription's invoice. It is passed ALONGSIDE, never instead: on a
         * plan it resolves the subscription through the charge's own
         * `metadata.subscription_id`, which is local and needs no Stripe index
         * to have caught up. See `findLocalByPaymentIntent`.
         */
        paymentIntentId: data.payment_intent_id ?? null,
      });
    }

    // Create CRM activity (non-blocking)
    // NOTE: the booking `crm_activities` row is logged automatically by Postgres trigger T2 on
    // the booking UPDATE-to-confirmed (contact_id set) — not inserted here (was double-logging).
    // (Scheduling plugin workplan §2 0.2.)

    /*
     * AWAITED, for the same reason as in `booking/create`.
     *
     * A promise dispatched after the response has no owner: the invocation is
     * frozen when it responds, and the confirmation, the intake request and the
     * `booking_confirmation_sent` activity are lost together without anything
     * rejecting. This is the paid path, so the client has just been charged —
     * the one case where silence is least acceptable.
     */
    // skipInvoice=true since payment is already completed
    const [confirmation, intakeRequest] = await Promise.allSettled([
      BookingEmailService.sendBookingConfirmation(booking.id, ownerId, { skipInvoice: true }),
      // Send intake form request email
      // This helps clients prepare for their appointment
      BookingEmailService.sendIntakeFormRequest(booking.id, ownerId),
    ]);

    if (confirmation.status === 'rejected') {
      requestLogger.warn({ err: confirmation.reason, bookingId: booking.id }, 'Booking confirmation email failed');
    } else if (!confirmation.value?.sent) {
      requestLogger.warn(
        { bookingId: booking.id, error: confirmation.value?.error },
        'Booking confirmation email was not delivered to any transport'
      );
    }

    if (intakeRequest.status === 'rejected') {
      requestLogger.warn({ err: intakeRequest.reason, bookingId: booking.id }, 'Intake form request email failed');
    }

    /*
     * No email to the owner for a booking, deliberately.
     *
     * A booking has already resolved itself: the client picked a time, paid,
     * and got a confirmation, and the sync below puts it in the calendar the
     * owner actually looks at — which sends its own notification. A separate
     * platform email would be a third telling of the same news, and a practice
     * with six appointments a day would get six messages saying things went
     * right, then start filtering the sender. The one that matters — somebody
     * WAITING on them — would go with it.
     *
     * The morning briefing counts the day's appointments; that is the right
     * cadence for news nobody has to act on.
     */
    /*
     * And put it in the owner's calendar (non-blocking).
     *
     * This is the route the booking widgets actually use, so it is the one that
     * matters: every client-made booking on the platform came through here and
     * none of them reached the calendar. See `lib/scheduling/syncBookingCalendar`.
     */
    syncBookingToOwnerCalendar(booking.id, ownerId, requestLogger)
      .catch(err => requestLogger.warn({ err, bookingId: booking.id }, 'Calendar sync failed'));

    // Send payment receipt (non-blocking) - reuse serviceDetails from earlier
    if (serviceDetails?.price && serviceDetails.price > 0 && contact?.email) {
      const clientName = [contact.first_name, contact.last_name].filter(Boolean).join(' ');
      /*
       * The receipt states what was CHARGED, not what was agreed.
       *
       * This sent `serviceDetails.price` unconditionally, so a client who paid
       * the first ₪333 of a three-part plan received a receipt for ₪1,000 —
       * a document saying they had paid three times what left their account.
       */
      const currency = serviceDetails.currency || 'USD';
      const chargedAmount = isPlanBooking
        ? fromMinorUnits(
            planPhases(serviceDetails.price, currency, serviceDetails.installment_count ?? 1)[0].amountMinor,
            currency
          )
        : serviceDetails.price;

      BookingEmailService.sendPaymentReceipt(ownerId, {
        customerEmail: contact.email,
        customerName: clientName,
        amount: chargedAmount,
        currency,
        bookingId: booking.id
      }).catch(err => requestLogger.warn({ err, bookingId: booking.id }, 'Payment receipt email failed'));
    }

    requestLogger.info(
      { bookingId: booking.id, contactId },
      'Booking finalized successfully'
    );

    return NextResponse.json({
      success: true,
      message: 'Booking confirmed!',
      booking: {
        id: booking.id,
        status: 'confirmed',
        payment_status: 'paid',
        contact_id: contactId
      }
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Booking finalization failed');
    return NextResponse.json(
      { success: false, error: 'Failed to finalize booking' },
      { status: 500 }
    );
  }
}
