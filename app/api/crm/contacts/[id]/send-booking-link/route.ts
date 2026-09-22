/**
 * Send one contact a link they can book themselves in with.
 *
 * The one-click reply behind the Incoming enquiries card. All of the judgement
 * — is there a bookable link, does its journey actually run, has this person
 * already been written to — lives in `LeadBookingLinkService`, so the chase in
 * a later phase reaches exactly the same decisions from a cron rather than
 * re-implementing them.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { sendBookingLink } from '@/lib/services/LeadBookingLinkService';
import { z } from 'zod';

const logger = createLogger({ module: 'SendBookingLinkAPI' });

/*
 * A service id and nothing else.
 *
 * Deliberately no URL: the caller says WHICH of the business's own services to
 * point at, never where to send somebody. The service is then re-read scoped to
 * this user inside the service layer, so a foreign id is refused rather than
 * turned into a link. No `user_id` field, and no `.passthrough()`.
 */
const SendSchema = z.object({
  service_id: z.string().uuid().nullish(),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: contactId } = await params;
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId, contactId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const validated = SendSchema.parse(body);

    const outcome = await sendBookingLink(contactId, user.id, {
      serviceId: validated.service_id ?? null,
      // A person clicked Send, in reply to an enquiry. Transactional.
      trigger: 'owner',
    });

    if (!outcome.ok) {
      /*
       * A refusal is reported as 200 with a reason, not as an error.
       *
       * Every one of these is a thing the OWNER can fix — set your working
       * hours, this person left no email address — and the card renders the
       * reason as a next step. A 4xx would put it in a generic error toast that
       * says nothing useful.
       */
      requestLogger.info({ reason: outcome.reason }, 'Booking link not sent');
      return NextResponse.json({
        success: false,
        reason: outcome.reason,
        detail: outcome.detail,
      });
    }

    return NextResponse.json({
      success: true,
      alreadySent: outcome.alreadySent,
      bookingUrl: outcome.bookingUrl,
      serviceName: outcome.serviceName,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
    }
    requestLogger.error({ err: error }, 'Failed to send booking link');
    return NextResponse.json(
      { success: false, error: 'Failed to send the booking link' },
      { status: 500 }
    );
  }
}
