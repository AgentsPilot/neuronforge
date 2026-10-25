// app/api/book/manage/[token]/intake/route.ts
// Self-service intake form endpoint for booking clients

import { BookingEmailService } from '@/lib/services/BookingEmailService';
import { resolvePortalAccess } from '@/lib/security/portalAccess';
import { rateLimit, tooManyRequests, RATE_LIMITS } from '@/lib/security/rateLimit';
import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { intakeRepository } from '@/lib/repositories/IntakeRepository';
import { resolveIntakeForSending } from '@/lib/business-os/intake/resolveIntake';
import { outcomeRecorded } from '@/lib/business-os/bookingStatus';
import { z } from 'zod';

const logger = createLogger({ module: 'API', service: 'BookingIntake' });

/**
 * Only the answers.
 *
 * `templateId` and `templateKey` used to arrive here and decide what the
 * submission was filed against. They are gone: which form this is belongs to
 * the business, is resolved server-side, and is not a client's to assert.
 */
const submitIntakeSchema = z.object({
  responses: z.record(z.any()),
});

// GET /api/book/manage/[token]/intake
// Returns the published intake form for this booking
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  /*
   * Throttled: no session stands in front of this route.
   */
  const throttle = await rateLimit(request, 'intake-read', RATE_LIMITS.read);
  if (!throttle.allowed) return tooManyRequests(RATE_LIMITS.read.windowSeconds);

  try {
    // Verify token
    /* Either a signed link or a booking id backed by the grant cookie — the
       id alone is never enough. See `resolvePortalAccess`. */
    const access = resolvePortalAccess(token, request.headers.get('cookie'));
    if (!access) {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired link' },
        { status: 401 }
      );
    }

    const { bookingId, email } = access;

    // Fetch booking with service and contact details
    // Note: client_* fields removed from scheduling_bookings - now JOINed from crm_contacts
    const { data: booking, error } = await supabaseServer
      .from('scheduling_bookings')
      .select(`
        id,
        user_id,
        contact_id,
        start_time,
        end_time,
        timezone,
        status,
        intake_responses,
        intake_completed_at,
        contact:crm_contacts(
          first_name,
          last_name,
          email
        ),
        service:scheduling_services(
          id,
          service_name,
          duration_minutes
        )
      `)
      .eq('id', bookingId)
      .single();

    if (error || !booking) {
      return NextResponse.json(
        { success: false, error: 'Booking not found' },
        { status: 404 }
      );
    }

    // Get contact data from JOIN and verify email matches the token
    const contact = Array.isArray(booking.contact) ? booking.contact[0] : booking.contact;
    const contactEmail = contact?.email || '';
    if (contactEmail.toLowerCase() !== email.toLowerCase()) {
      return NextResponse.json(
        { success: false, error: 'Booking not found' },
        { status: 404 }
      );
    }

    // Fetch business info for branding early - needed for all responses (language, branding)
    // Note: logo_url and primary_color columns don't exist in business_profiles table
    // The logo comes from the business profile — see lib/branding/businessLogo.ts
    const { data: profile, error: profileError } = await supabaseServer
      .from('business_profiles')
      .select('company_name, logo_url, language')
      .eq('user_id', booking.user_id)
      .single();

    if (profileError && profileError.code !== 'PGRST116') {
      // Only log if it's not a "no rows found" error
      requestLogger.warn({
        err: profileError,
        errorCode: profileError.code,
        errorMessage: profileError.message,
        userId: booking.user_id,
        bookingId: booking.id
      }, 'Failed to fetch business profile for intake form');
    }

    const businessData = profile ? {
      name: profile.company_name,
      logoUrl: profile.logo_url,
      primaryColor: '#4F46E5', // Default color since primary_color column doesn't exist
      language: profile.language || 'en'
    } : null;

    requestLogger.info({
      businessData,
      profileLanguage: profile?.language,
      rawProfile: profile ? { company_name: profile.company_name, language: profile.language } : null,
      userId: booking.user_id
    }, 'Business data for intake form');

    /*
     * ── ALREADY ANSWERED: SHOW THEM WHAT THEY SENT ──────────────────────────
     *
     * This returned the date and nothing else, so a client following their own
     * "view answers" link got "you have already filled this in" and no way to
     * see a single word of it. The one thing they came for was the one thing
     * withheld — and it is their own writing, about their own child in the case
     * that reported this.
     *
     * Nothing has to be fetched to fix it. The submission stores a SNAPSHOT of
     * the questions beside the answers, precisely so a form edited or
     * republished later still renders readably. So the answered form is handed
     * back exactly as it was submitted.
     *
     * READ-ONLY by construction: these are the recorded answers, not the live
     * form, and POST refuses a second submission on `intake_completed_at`
     * independently of anything sent here.
     * ────────────────────────────────────────────────────────────────────────
     */
    if (booking.intake_completed_at) {
      const submitted = (booking.intake_responses ?? null) as {
        questions?: Array<Record<string, unknown>>;
        responses?: Record<string, unknown>;
      } | null;

      return NextResponse.json({
        success: true,
        alreadyCompleted: true,
        completedAt: booking.intake_completed_at,
        /*
         * Only when both halves are present. A booking completed before the
         * snapshot was stored has answers nobody can label, and a list of bare
         * values is worse than the sentence it replaces.
         */
        answered:
          submitted?.questions?.length && submitted?.responses
            ? { questions: submitted.questions, responses: submitted.responses }
            : null,
        booking: {
          id: booking.id,
          clientName: [contact?.first_name, contact?.last_name].filter(Boolean).join(' '),
          startTime: booking.start_time,
          endTime: booking.end_time,
          timezone: booking.timezone,
          service: booking.service
        },
        business: businessData
      });
    }

    // Check if booking is cancelled
    if (booking.status === 'cancelled') {
      return NextResponse.json(
        { success: false, error: 'This booking has been cancelled' },
        { status: 400 }
      );
    }

    /*
     * And every other way the appointment can already be over.
     *
     * The test above covers the one the owner presses most, and `no_show` and
     * `completed` end a meeting just as finally. Without this a client marked
     * absent could still open the form, fill it in and attach files to it —
     * answers landing on a booking nobody will look at again, after the owner's
     * own card had stopped asking for them.
     *
     * Separate from the cancelled branch rather than folded into it: the two
     * deserve different sentences, and the cancelled one is the copy (and, in
     * the upload route, the error CODE) that the client-side already handles.
     */
    if (outcomeRecorded(booking.status)) {
      return NextResponse.json(
        { success: false, code: 'settled', error: 'This booking has already taken place' },
        { status: 400 }
      );
    }

    /*
     * The published form, or nothing.
     *
     * This called `getEnabledTemplateForUser`, whose own docblock said nothing
     * on a public surface should — and which gated on `collect_during_booking`,
     * a flag the settings API accepted and discarded. A business with it false
     * received an intake email whose link opened this page saying there was no
     * form.
     *
     * `resolveIntakeForSending` is the one answer now, and it takes no audience
     * argument: whether a form may be shown depends on the business having one
     * published and enabled, which does not change with who is looking.
     *
     * That matters most HERE. The client is holding a link the business already
     * sent them, so any check about whether we were asked to send it has been
     * answered by the email existing. The `forClient` flag this used to pass
     * was ignored anyway, but had it ever been honoured it would have broken
     * every form sent by hand — which is exactly the failure described above,
     * one flag later.
     */
    const { form } = await resolveIntakeForSending(booking.user_id);

    if (!form) {
      return NextResponse.json({
        success: true,
        hasIntake: false,
        form: null,
        booking: {
          id: booking.id,
          clientName: [contact?.first_name, contact?.last_name].filter(Boolean).join(' '),
          startTime: booking.start_time,
          endTime: booking.end_time,
          timezone: booking.timezone,
          service: booking.service
        },
        business: businessData
      });
    }

    requestLogger.info({ bookingId, formId: form.id, version: form.version }, 'Intake form fetched');

    return NextResponse.json({
      success: true,
      hasIntake: true,
      // The form, in the business's language. There is no label to pick from
      // three any more — a per-business form is written in one.
      form: {
        id: form.id,
        version: form.version,
        questions: form.questions,
      },
      booking: {
        id: booking.id,
        clientName: [contact?.first_name, contact?.last_name].filter(Boolean).join(' '),
        startTime: booking.start_time,
        endTime: booking.end_time,
        timezone: booking.timezone,
        service: booking.service
      },
      business: businessData
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Error fetching intake form');
    return NextResponse.json(
      { success: false, error: 'Failed to fetch intake form' },
      { status: 500 }
    );
  }
}

// POST /api/book/manage/[token]/intake
// Submit intake responses for the booking
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  /*
   * The write, gated apart from the read above: answering the form is a thing a client does once.
   */
  const throttle = await rateLimit(request, 'intake-submit', RATE_LIMITS.write);
  if (!throttle.allowed) return tooManyRequests(RATE_LIMITS.write.windowSeconds);

  try {
    // Verify token
    /* Either a signed link or a booking id backed by the grant cookie — the
       id alone is never enough. See `resolvePortalAccess`. */
    const access = resolvePortalAccess(token, request.headers.get('cookie'));
    if (!access) {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired link' },
        { status: 401 }
      );
    }

    const { bookingId, email } = access;

    // Parse and validate body
    const body = await request.json();
    const validated = submitIntakeSchema.parse(body);

    // Fetch booking with contact email via JOIN
    // Note: client_* fields removed from scheduling_bookings - now JOINed from crm_contacts
    const { data: postBooking, error } = await supabaseServer
      .from('scheduling_bookings')
      .select(`
        id,
        user_id,
        contact_id,
        status,
        intake_completed_at,
        contact:crm_contacts(email)
      `)
      .eq('id', bookingId)
      .single();

    if (error || !postBooking) {
      return NextResponse.json(
        { success: false, error: 'Booking not found' },
        { status: 404 }
      );
    }

    // Get contact email from JOIN and verify it matches the token
    const postContact = Array.isArray(postBooking.contact) ? postBooking.contact[0] : postBooking.contact;
    const postContactEmail = postContact?.email || '';
    if (postContactEmail.toLowerCase() !== email.toLowerCase()) {
      return NextResponse.json(
        { success: false, error: 'Booking not found' },
        { status: 404 }
      );
    }

    // Use alias to avoid variable shadowing
    const booking = postBooking;

    // Check if already completed
    if (booking.intake_completed_at) {
      return NextResponse.json(
        { success: false, error: 'Intake form has already been submitted' },
        { status: 400 }
      );
    }

    // Check if booking is cancelled
    if (booking.status === 'cancelled') {
      return NextResponse.json(
        { success: false, error: 'This booking has been cancelled' },
        { status: 400 }
      );
    }

    /*
     * And every other way the appointment can already be over.
     *
     * The test above covers the one the owner presses most, and `no_show` and
     * `completed` end a meeting just as finally. Without this a client marked
     * absent could still open the form, fill it in and attach files to it —
     * answers landing on a booking nobody will look at again, after the owner's
     * own card had stopped asking for them.
     *
     * Separate from the cancelled branch rather than folded into it: the two
     * deserve different sentences, and the cancelled one is the copy (and, in
     * the upload route, the error CODE) that the client-side already handles.
     */
    if (outcomeRecorded(booking.status)) {
      return NextResponse.json(
        { success: false, code: 'settled', error: 'This booking has already taken place' },
        { status: 400 }
      );
    }

    /*
     * Resolved SERVER-SIDE from the business, never taken from the submission.
     *
     * The form id used to arrive in the body and be looked up. A client posting
     * a different id would have their answers filed against a form they were
     * never shown — and since the questions are snapshotted next to the answers
     * below, that snapshot would then be a lie about what was asked.
     */
    const { form } = await resolveIntakeForSending(booking.user_id);

    if (!form) {
      return NextResponse.json(
        { success: false, error: 'This form is no longer being collected' },
        { status: 400 }
      );
    }

    /*
     * The QUESTIONS travel with the answers.
     *
     * A form is edited and republished; without the questions recorded here, a
     * submission from an earlier version renders as a list of values with
     * nothing to say what was asked. `form_id` and `version` identify it;
     * the snapshot is what makes it readable regardless.
     */
    const intakeData = {
      form_id: form.id,
      version: form.version,
      questions: form.questions,
      responses: validated.responses,
    };

    const { error: updateError } = await supabaseServer
      .from('scheduling_bookings')
      .update({
        intake_responses: intakeData,
        intake_completed_at: new Date().toISOString()
      })
      .eq('id', bookingId);

    if (updateError) {
      requestLogger.error({ err: updateError }, 'Failed to save intake responses');
      throw updateError;
    }

    requestLogger.info({ bookingId, formId: form.id, version: form.version }, 'Intake responses saved');

    /*
     * Tell them it arrived.
     *
     * Non-blocking, and after the write on purpose: the answers are saved
     * whether or not this sends, and a client who filled in a form must never
     * see it fail because an email provider was down. The confirmation is a
     * courtesy; the submission is the thing.
     */
    BookingEmailService.sendIntakeReceivedConfirmation(bookingId, booking.user_id).catch(err =>
      requestLogger.warn({ err, bookingId }, 'Intake received confirmation failed (non-blocking)')
    );

    return NextResponse.json({
      success: true,
      message: 'Intake form submitted successfully'
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid request data', details: error.errors },
        { status: 400 }
      );
    }
    requestLogger.error({ err: error }, 'Error submitting intake form');
    return NextResponse.json(
      { success: false, error: 'Failed to submit intake form' },
      { status: 500 }
    );
  }
}
