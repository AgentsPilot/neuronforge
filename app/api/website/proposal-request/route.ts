/**
 * A client asking to be quoted.
 *
 * The end of the first half of a quoted service's journey. The client picked a
 * service and left their details; there is nothing to schedule and nothing to
 * charge, because nobody has said what the work costs yet.
 *
 * It DOES create a booking, with no times on it when no meeting was picked.
 * That is new: the original rule was "a request is not a booking", justified by
 * `scheduling_bookings.start_time` being NOT NULL — true when it was written,
 * and false since meetings moved onto `scheduling_meetings` and took the clock
 * with them. The owner looks for the job in their bookings, and everything they
 * do next hangs off one.
 *
 * What it still does NOT do, deliberately:
 *  - invent a time. The booking carries no clock rather than a made-up date,
 *    which is what the original comment was right to refuse.
 *  - create an invoice or take payment. There is no price.
 *
 * What it does: makes sure the person exists in the CRM, records what they
 * asked for, and tells the owner. The proposal itself is the owner's next move.
 *
 * Public and unauthenticated, like the other website form endpoints — the
 * subdomain or user code identifies the business, and nothing here trusts a
 * caller-supplied owner id.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { notifyOwnerOfLead } from '@/lib/services/LeadAlertService';
import { BookingEmailService } from '@/lib/services/BookingEmailService';
import { sendQuoteReceivedEmail } from '@/lib/services/QuoteRequestEmailService';
import { buildAttributionFromRequest } from '@/lib/utils/attribution';
import { enrichCaptureAttribution } from '@/lib/business-os/enrichCaptureAttribution';
import { ConsentInputSchema } from '@/lib/validation/consent';
import { recordConsent } from '@/lib/consent/recordConsent';
import { crmPipelineStagesRepository } from '@/lib/repositories/CRMPipelineStagesRepository';
import { schedulingTimeOffRepository } from '@/lib/repositories/SchedulingTimeOffRepository';
import { closedDayVerdict } from '@/lib/scheduling/closedDay';
import { businessDateKey, businessHhmm, safeTimezone } from '@/lib/scheduling/businessTime';
import { getWebsitePageRepository } from '@/lib/repositories/WebsitePageRepository';
import { emailLikePattern } from '@/lib/utils/emailMatch';

const logger = createLogger({ module: 'ProposalRequestAPI' });

const ProposalRequestSchema = z
  .object({
    subdomain: z.string().optional(),
    userCode: z.string().optional(),
    service_id: z.string().uuid(),
    name: z.string().min(1, 'Name is required').max(200),
    /* Normalised before validation — see the note on the contact form route:
     a stray space made Zod reject a valid address, and mixed case created a
     second contact because the lookups match with `=`. */
    email: z.string().trim().toLowerCase().email('A valid email is required').max(200),
    phone: z.string().max(50).optional(),
    /** Anything the client wants the quote to account for. */
    note: z.string().max(2000).optional(),
    /*
     * The consultation slot, when the service books one.
     *
     * "Book a free site visit and I'll quote you" is a real appointment with a
     * real time — the owner has to be somewhere. Absent for a service quoted
     * without a meeting.
     */
    start_time: z.string().datetime().optional(),
    end_time: z.string().datetime().optional(),
    timezone: z.string().max(64).optional(),
    page_url: z.string().max(500).optional(),
    /** Marketing consent, where the client ticked the box. Never required. */
    consent: ConsentInputSchema,
  });

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * NEITHER IDENTIFIER IS A VALID STATE: IT MEANS PREVIEW.
 *
 * This schema used to `.refine()` that a `subdomain` or a `userCode` was
 * present. That is true of a visitor on a published site, and false of the one
 * person most likely to use this form first: the owner, previewing their own
 * page from the website editor while signed in. The preview deliberately sends
 * neither — identifying the business from the session is the whole arrangement,
 * and `/api/website/booking/create` states it plainly: "if not provided,
 * authenticated user is used (preview mode)".
 *
 * So every quote request made from preview was refused with a 400, and nothing
 * was recorded: `quote_requested` had zero rows across every account since the
 * day this route was written.
 *
 * The owner is still never taken from the body. It comes from the address the
 * client arrived at, or from the session, and a signed-in user can only file a
 * request against their own business.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const body = await request.json();
    const parsed = ProposalRequestSchema.safeParse(body);

    if (!parsed.success) {
      /*
       * Say which field, in the log, where somebody will see it.
       *
       * ───────────────────────────────────────────────────────────────────────
       * This returned 400 silently. The reason existed only in the response
       * body, so a client who could not request a quote produced a server with
       * nothing to say about it, and the only way to find out was to open the
       * browser's network tab on the failing machine.
       *
       * FIELD PATHS AND CODES ONLY. This is a public, unauthenticated endpoint
       * carrying a name, an email and a phone number; logging the values that
       * failed validation would put a stranger's contact details in the log
       * every time one of them typed their email wrong.
       * ───────────────────────────────────────────────────────────────────────
       */
      requestLogger.warn(
        {
          issues: parsed.error.errors.map(issue => ({
            field: issue.path.join('.') || '(root)',
            code: issue.code,
          })),
        },
        'Quote request refused: the submitted form did not validate'
      );

      return NextResponse.json(
        { success: false, error: 'Invalid request', details: parsed.error.errors },
        { status: 400 }
      );
    }

    const data = parsed.data;

    const attribution = buildAttributionFromRequest(request, {
      captureChannel: 'form',
      pageUrl: data.page_url,
      generateSessionId: true,
    });

    /*
     * Where they came from: the page KIND, and the smart link if one sent them.
     * Shared with every other capture route, because five copies of this had
     * drifted into three different answers — see `enrichCaptureAttribution`.
     */
    await enrichCaptureAttribution(attribution, {
      subdomain: data.subdomain,
      pageUrl: data.page_url,
    });

    /*
     * The owner comes from the address the client arrived at, never from the
     * request body. A caller-supplied owner id on a public route is how one
     * business writes a lead into another's CRM.
     */
    let ownerId: string;

    if (data.subdomain) {
      const { data: page, error } = await getWebsitePageRepository(supabaseServer).findBySubdomainAny(data.subdomain);

      if (error || !page) {
        requestLogger.warn({ subdomain: data.subdomain }, 'Website not found');
        return NextResponse.json({ success: false, error: 'Website not found' }, { status: 404 });
      }
      ownerId = page.user_id;
    } else if (data.userCode) {
      const { data: profile, error } = await supabaseServer
        .from('business_profiles')
        .select('user_id')
        .eq('user_code', data.userCode.toLowerCase())
        .single();

      if (error || !profile) {
        requestLogger.warn({ userCode: data.userCode }, 'User code not found');
        return NextResponse.json({ success: false, error: 'Business not found' }, { status: 404 });
      }
      ownerId = profile.user_id;
    } else {
      /*
       * Preview: the owner looking at their own page, signed in.
       *
       * Taken from the session, never from the body — the same branch
       * `/api/website/booking/create` ends with, and the reason a quote request
       * from the editor reaches the right CRM. An unauthenticated caller with
       * no subdomain gets a 401 rather than a guess.
       */
      const user = await getUser();
      if (!user) {
        requestLogger.warn({}, 'Quote request with no subdomain, no user code and no session');
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
      }
      ownerId = user.id;
    }

    /*
     * The service must belong to that owner AND actually be quoted.
     *
     * Scoped to `ownerId` so a service id lifted from another business cannot
     * be requested here; checked for `sale_mode` so this endpoint cannot be
     * used to bypass the payment step of a service that is sold directly.
     */
    const { data: service, error: serviceError } = await supabaseServer
      .from('scheduling_services')
      .select('id, service_name, sale_mode, status, is_scheduled, duration_minutes')
      .eq('id', data.service_id)
      .eq('user_id', ownerId)
      .maybeSingle();

    if (serviceError || !service) {
      requestLogger.warn({ serviceId: data.service_id, ownerId }, 'Service not found for this business');
      return NextResponse.json({ success: false, error: 'Service not found' }, { status: 404 });
    }

    if (service.sale_mode !== 'proposal') {
      requestLogger.warn(
        { serviceId: data.service_id, saleMode: service.sale_mode },
        'Quote requested for a service that is sold directly'
      );
      return NextResponse.json(
        { success: false, error: 'This service is not quoted' },
        { status: 400 }
      );
    }

    // ---- the contact -------------------------------------------------------

    const email = data.email.toLowerCase().trim();
    const [firstName, ...rest] = data.name.trim().split(/\s+/);
    const lastName = rest.join(' ') || null;

    const { data: existing } = await supabaseServer
      .from('crm_contacts')
      .select('id')
      .eq('user_id', ownerId)
      /* `ilike`, not `eq`: an address stored before this route started
         normalising is whatever the visitor typed, so a case-sensitive match
         misses it and a SECOND contact is created for the same person. The
         insert side is normalised now; this is what finds the rows that
         predate it. No wildcards in the value, so it stays an equality match
         in everything but case. */
      .ilike('email', emailLikePattern(email))
      .maybeSingle();

    let contactId: string;

    /*
     * ───────────────────────────────────────────────────────────────────────
     * THE FIRST STAGE OF THIS OWNER'S PIPELINE, NOT THE WORD "lead".
     *
     * `stage: 'lead'` was written here as a literal. Pipeline vocabulary is
     * per-tenant: a business whose stages read inquiry > initial_consultation
     * > family_enrolled > completed has no 'lead', so a quote request filed a
     * contact into a stage that does not exist on their board. Observed live —
     * one contact sitting at 'lead' on an account where nothing else does, and
     * the owner asking what it was.
     *
     * The five other routes that create a contact already resolve it this way
     * (`booking/create`, `scheduling/bookings`, `crm/subscribers`,
     * `forms/contact`, `CapabilityEngine`). This was the odd one out.
     *
     * `'lead'` remains the fallback for an account with no stages configured,
     * which is what every one of those five does — a contact with an unknown
     * stage is still better than no contact.
     * ───────────────────────────────────────────────────────────────────────
     */
    /*
     * The start of this owner's board, resolved in one place. Previously an
     * inline read ending `|| 'lead'` — a stage many pipelines do not contain.
     * Null means no pipeline: the column's own DEFAULT then applies.
     */
    const { data: firstStage } = await crmPipelineStagesRepository.firstStageKey(ownerId);

    if (existing) {
      contactId = existing.id;
      /*
       * An existing contact keeps its stage. Someone already in the pipeline
       * asking for a second quote has not gone backwards, and resetting them to
       * the first stage would undo the owner's own bookkeeping.
       */
      await supabaseServer
        .from('crm_contacts')
        .update({ phone: data.phone || undefined, updated_at: new Date().toISOString() })
        .eq('id', contactId)
        .eq('user_id', ownerId);
    } else {
      const { data: created, error: createError } = await supabaseServer
        .from('crm_contacts')
        .insert({
          user_id: ownerId,
          first_name: firstName,
          last_name: lastName,
          email,
          phone: data.phone || null,
          ...(firstStage ? { stage: firstStage } : {}),
          source: 'quote_request',
          source_metadata: attribution,
        })
        .select('id')
        .single();

      if (createError || !created) {
        requestLogger.error({ err: createError, ownerId }, 'Could not create the contact');
        return NextResponse.json(
          { success: false, error: 'Could not record the request' },
          { status: 500 }
        );
      }
      contactId = created.id;
    }

    /*
     * Marketing consent, where the client gave it. After the contact exists and
     * non-blocking: a failure here loses a consent record, never a quote
     * request. An untouched checkbox writes nothing rather than a withdrawal.
     */
    void recordConsent({
      userId: ownerId,
      contactId,
      email: data.email,
      consent: data.consent,
      sourceSurface: 'proposal_request',
      sourcePageUrl: data.page_url ?? null,
      attribution,
    });

    // ---- the consultation, where the service books one ---------------------

    /*
     * A scheduled quoted service creates a REAL booking.
     *
     * This is the site visit, or the free intake call — the meeting where the
     * work gets scoped, and the thing the quote will be based on. It has a
     * time the client chose and the owner has to attend, so it belongs in the
     * calendar like any other appointment.
     *
     * The earlier reasoning here — "a request is not a booking" — holds only
     * for a service quoted WITHOUT a meeting. Once there is a time, withholding
     * the booking would leave the owner with a lead and no idea when they had
     * agreed to turn up.
     */
    let bookingId: string | null = null;

    /*
     * WHETHER A CONSULTATION WAS ACTUALLY BOOKED.
     *
     * Named, because two decisions below depend on it and one of them used to
     * read `bookingId` instead — which worked only while a booking existed in
     * this branch alone. The moment a quoted service with NO meeting started
     * writing a booking too, that proxy broke and the client was emailed "your
     * booking is confirmed" for a package with no date and no quote.
     *
     * A booking ROW is not an appointment. This is the appointment.
     */
    const booksAConsultation = service.is_scheduled !== false && Boolean(data.start_time);

    /*
     * `data.start_time` repeated, although `booksAConsultation` already proves
     * it: narrowing does not travel through an intermediate boolean, so the
     * compiler still sees `string | undefined` here and `new Date(undefined)`
     * is an Invalid Date rather than an error anyone would notice. Asserted
     * with `!` it would compile and stay a silent trap; checked, the type is
     * honest and the runtime behaviour is identical.
     */
    if (booksAConsultation && data.start_time) {
      const start = new Date(data.start_time);
      const end = data.end_time
        ? new Date(data.end_time)
        : new Date(start.getTime() + (service.duration_minutes || 60) * 60_000);

      /*
       * ─────────────────────────────────────────────────────────────────────
       * NOT ONTO A DAY THE BUSINESS IS CLOSED.
       *
       * A client asking for a quote picks a time for the consultation, and
       * nothing had stopped that landing on a holiday. No money has moved
       * here, so the honest answer is to refuse and let them pick again —
       * answered as `slot_taken`, which is the wording the page already has and
       * the right instruction. Their contact row, created above, stays; the
       * request itself is written below and so is not recorded until a time the
       * business can actually keep has been chosen.
       *
       * An unreadable list allows it, the same way every other public surface
       * decides — see `website/booking/create`.
       * ─────────────────────────────────────────────────────────────────────
       */
      const zone = safeTimezone(data.timezone);
      const dateKey = businessDateKey(start, zone);

      const { data: timeOff, error: timeOffError } = await schedulingTimeOffRepository.list(ownerId, {
        from: dateKey,
        to: dateKey,
      });

      if (timeOffError) {
        requestLogger.warn({ err: timeOffError, ownerId }, 'Time off unreadable; the time is allowed');
      }

      const closed = timeOffError
        ? { closed: false as const }
        : closedDayVerdict(timeOff ?? [], dateKey, {
            start: businessHhmm(start, zone),
            end: businessHhmm(end, zone),
          });

      if (closed.closed) {
        requestLogger.info(
          { ownerId, date: dateKey, kind: closed.kind },
          'Quote request refused a time on a closed day'
        );
        return NextResponse.json(
          { success: false, code: 'slot_taken', error: 'This time slot is no longer available' },
          { status: 409 }
        );
      }

      const { data: booking, error: bookingError } = await supabaseServer
        .from('scheduling_bookings')
        .insert({
          user_id: ownerId,
          service_id: service.id,
          contact_id: contactId,
          start_time: start.toISOString(),
          end_time: end.toISOString(),
          timezone: data.timezone || 'UTC',
          status: 'confirmed',
          booking_source: 'quote_request',
          // The client's own words about the job, where the owner will look
          // for them when preparing the quote.
          notes: data.note?.trim() || null,
        })
        .select('id')
        .single();

      if (bookingError) {
        /*
         * The lead is already saved, so the request is not lost — but the
         * meeting is, and that is worth shouting about: the client believes
         * they have an appointment.
         */
        requestLogger.error(
          { err: bookingError, ownerId, contactId, serviceId: service.id },
          'Quote request saved but the consultation booking failed'
        );
      } else {
        bookingId = booking.id;
      }
    } else {
      /*
       * ─────────────────────────────────────────────────────────────────────
       * A QUOTED SERVICE WITH NO MEETING IS STILL A JOB.
       *
       * This branch wrote nothing. The reason given at the top of the file was
       * that `scheduling_bookings.start_time` is NOT NULL, so a booking with
       * no agreed time was impossible — and that was true when it was written.
       *
       * It stopped being true when meetings were separated onto
       * `scheduling_meetings` and the clock moved with them: the column is
       * nullable now. The rule outlived the constraint that forced it.
       *
       * What it cost: a client picked a package from a smart link, left their
       * details and finished. The owner got the email, went to look for the
       * job in their bookings, and found nothing — the request existed only as
       * a line in the contact's activity timeline. Everything the owner does
       * next (quote it, chase it, take the money) hangs off a booking.
       *
       * `pending`, not `confirmed`: nobody has said what the work costs yet,
       * which is the whole point of a quote. The scheduled branch above says
       * `confirmed` because there a TIME has been agreed and the owner has to
       * turn up for it. Here nothing has been agreed at all.
       *
       * No times, deliberately — a made-up date is the fiction the original
       * comment was right to refuse. The booking carries no clock, and the
       * journey for a quoted service has no date step to want one.
       * ─────────────────────────────────────────────────────────────────────
       */
      const { data: booking, error: bookingError } = await supabaseServer
        .from('scheduling_bookings')
        .insert({
          user_id: ownerId,
          service_id: service.id,
          contact_id: contactId,
          start_time: null,
          end_time: null,
          timezone: data.timezone || null,
          status: 'pending',
          booking_source: 'quote_request',
          notes: data.note?.trim() || null,
        })
        .select('id')
        .single();

      if (bookingError) {
        /* The lead and the activity below still land, so the request is not
           lost — but the owner's list will not show it, which is the fault
           this branch exists to fix. Loud, and not fatal. */
        requestLogger.error(
          { err: bookingError, ownerId, contactId, serviceId: service.id },
          'Quote request saved but its booking failed — it will not appear in the bookings list'
        );
      } else {
        bookingId = booking.id;
      }
    }

    // ---- the record of what they asked for ---------------------------------

    /*
     * Written as a CRM activity rather than a new table.
     *
     * Phase 1 has no `proposals` row to hang this on, and the owner needs to
     * see the request the moment it arrives. The activity is where the contact
     * drawer already reads its timeline, so this shows up with no new surface —
     * and when proposals land, the activity stays as the record of the ask.
     */
    const noteLine = data.note?.trim();
    const description = [
      service.service_name,
      noteLine ? `— ${noteLine}` : null,
    ]
      .filter(Boolean)
      .join(' ');

    const { error: activityError } = await supabaseServer.from('crm_activities').insert({
      user_id: ownerId,
      contact_id: contactId,
      activity_type: 'quote_requested',
      title: service.service_name,
      description,
      auto_logged: true,
      source_capability: 'website',
      // The service that was asked about. `crm_activities` carries no metadata
      // column — this is the one link it has, and it is the one that matters.
      source_entity_id: service.id,
      activity_date: new Date().toISOString(),
    });

    if (activityError) {
      /*
       * The contact exists and the owner will see them; losing the timeline
       * entry is worse than nothing but far better than telling a client their
       * request failed when their details are safely recorded.
       */
      requestLogger.error({ err: activityError, ownerId, contactId }, 'Could not log the request activity');
    }

    /*
     * Tell the owner. This route's header has always said it does — *"records
     * what they asked for, and tells the owner"* — and it contained no email
     * code at all.
     *
     * This is the one alert that cannot be automated away: the answer is a
     * PRICE, and nobody but the owner can write it. An enquiry can be met with
     * a booking link; a quote request met with a booking link ducks the
     * question that was actually asked.
     */
    /*
     * ───────────────────────────────────────────────────────────────────────
     * AND TELL THE CLIENT, WHEN THEY HAVE JUST BOOKED A TIME.
     *
     * A quoted service can book a consultation: "come and see it and I'll
     * quote you" is a real appointment, and the row written above is
     * `status: 'confirmed'` like any other. Only the owner was told. The client
     * chose a slot on a public page, was shown a confirmation screen, and
     * received nothing at all — no date, no address, no way to cancel or move
     * it. Every other booking on the platform sends that email.
     *
     * So this is `sendBookingConfirmation`, the same one the ordinary booking
     * path sends, against the same booking row. No new template and no second
     * kind of confirmation that could drift from the first.
     *
     * AWAITED, not fired and forgotten. A floating promise on a serverless
     * function may never run: the instance freezes the moment the response is
     * returned. That is the exact fault that cost this platform its booking
     * confirmations once already, in `website/booking/create`.
     *
     * Neither failure fails the request: the lead is saved, the activity is
     * logged, and a missing email is recoverable where a lost request is not.
     * ───────────────────────────────────────────────────────────────────────
     */
    const [ownerAlert, clientConfirmation] = await Promise.allSettled([
      notifyOwnerOfLead({
        ownerId,
        contactId,
        kind: 'quote',
        contactName: data.name,
        contactEmail: data.email,
        phone: data.phone,
        message: data.note,
        serviceName: service.service_name,
      }),
      /*
       * The client hears from us either way, and hears the right thing.
       *
       * WITH a consultation: the ordinary booking confirmation, carrying the
       * date, the address and the links to move or cancel it.
       *
       * WITHOUT one: a receipt for the request itself. Nothing to confirm and
       * nothing to calendar, so a booking confirmation would be describing an
       * appointment that does not exist — but silence is worse, because from
       * the client's side a form that answers nothing is indistinguishable
       * from one that failed.
       *
       * Asked of `booksAConsultation`, NOT of `bookingId`. Both branches write
       * a booking now, so the id says only that the row exists — it says
       * nothing about whether there is an appointment to confirm. Reading it
       * as though it did sent "ההזמנה שלך אושרה" to a client who had asked for
       * a quote on a package: nothing was confirmed, nothing was priced, and
       * there was no date in the mail because there is no date.
       */
      booksAConsultation && bookingId
        ? BookingEmailService.sendBookingConfirmation(bookingId, ownerId)
        : sendQuoteReceivedEmail({
            ownerId,
            contactId,
            clientEmail: data.email,
            clientName: data.name,
            serviceName: service.service_name,
            note: data.note,
            timezone: data.timezone,
          }),
    ]);

    if (ownerAlert.status === 'rejected') {
      requestLogger.warn({ err: ownerAlert.reason, contactId }, 'Owner alert failed (non-blocking)');
    }

    /*
     * One check for both, because both now return the same `{ sent, error }`
     * and both are the same promise to the client: that something arrives.
     */
    if (clientConfirmation.status === 'rejected') {
      requestLogger.warn(
        { err: clientConfirmation.reason, bookingId, hasConsultation: !!bookingId },
        'Client email failed (non-blocking)'
      );
    } else if (clientConfirmation.value && !clientConfirmation.value.sent) {
      requestLogger.warn(
        { bookingId, hasConsultation: !!bookingId, error: clientConfirmation.value.error },
        'Client email reached no transport'
      );
    }

    requestLogger.info(
      { ownerId, contactId, serviceId: service.id },
      'Quote requested'
    );

    return NextResponse.json({ success: true, data: { contactId, bookingId } });
  } catch (error) {
    requestLogger.error({ err: error }, 'Quote request failed');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
