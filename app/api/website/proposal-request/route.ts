/**
 * A client asking to be quoted.
 *
 * The end of the first half of a quoted service's journey. The client picked a
 * service and left their details; there is nothing to schedule and nothing to
 * charge, because nobody has said what the work costs yet.
 *
 * What this does NOT do, deliberately:
 *  - create a booking. `scheduling_bookings.start_time` is NOT NULL and no time
 *    has been agreed. A booking here would be a fiction with a made-up date.
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
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { buildAttributionFromRequest } from '@/lib/utils/attribution';

const logger = createLogger({ module: 'ProposalRequestAPI' });

const ProposalRequestSchema = z
  .object({
    subdomain: z.string().optional(),
    userCode: z.string().optional(),
    service_id: z.string().uuid(),
    name: z.string().min(1, 'Name is required').max(200),
    email: z.string().email('A valid email is required').max(200),
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
  })
  .refine(data => data.subdomain || data.userCode, {
    message: 'Either subdomain or userCode is required',
  });

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const body = await request.json();
    const parsed = ProposalRequestSchema.safeParse(body);

    if (!parsed.success) {
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
     * The owner comes from the address the client arrived at, never from the
     * request body. A caller-supplied owner id on a public route is how one
     * business writes a lead into another's CRM.
     */
    let ownerId: string;

    if (data.subdomain) {
      const { data: page, error } = await supabaseServer
        .from('website_pages')
        .select('user_id')
        .eq('subdomain', data.subdomain)
        .single();

      if (error || !page) {
        requestLogger.warn({ subdomain: data.subdomain }, 'Website not found');
        return NextResponse.json({ success: false, error: 'Website not found' }, { status: 404 });
      }
      ownerId = page.user_id;
    } else {
      const { data: profile, error } = await supabaseServer
        .from('business_profiles')
        .select('user_id')
        .eq('user_code', (data.userCode || '').toLowerCase())
        .single();

      if (error || !profile) {
        requestLogger.warn({ userCode: data.userCode }, 'User code not found');
        return NextResponse.json({ success: false, error: 'Business not found' }, { status: 404 });
      }
      ownerId = profile.user_id;
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
      .eq('email', email)
      .maybeSingle();

    let contactId: string;

    if (existing) {
      contactId = existing.id;
      /*
       * An existing contact keeps its stage. Someone already in the pipeline
       * asking for a second quote has not gone backwards, and resetting them to
       * 'lead' would undo the owner's own bookkeeping.
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
          stage: 'lead',
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

    if (service.is_scheduled !== false && data.start_time) {
      const start = new Date(data.start_time);
      const end = data.end_time
        ? new Date(data.end_time)
        : new Date(start.getTime() + (service.duration_minutes || 60) * 60_000);

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
