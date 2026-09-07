/**
 * GET/POST /api/website/booking/intake - Public intake form endpoint for booking flow
 * GET: Get intake template for a user (public, no auth required for clients)
 * POST: Submit intake responses for a booking
 */

import { NextRequest, NextResponse } from 'next/server';
import { resolvePublicOwner } from '@/lib/business-os/publicOwner';
import { createLogger } from '@/lib/logger';
import { intakeRepository } from '@/lib/repositories/IntakeRepository';
import { supabaseServer } from '@/lib/supabaseServer';
import { z } from 'zod';

const logger = createLogger({ module: 'PublicIntakeAPI' });

// Schema for GET request
const getIntakeSchema = z.object({
  userId: z.string().uuid(),
});

// Schema for POST request
const submitIntakeSchema = z.object({
  bookingId: z.string().uuid(),
  subdomain: z.string().optional(), // Alternative to userId - looks up via website
  userId: z.string().uuid().optional(), // The business owner's user ID
  templateId: z.string().uuid(),
  templateKey: z.string(),
  responses: z.record(z.any())
}).refine(data => data.subdomain || data.userId, {
  message: 'Either subdomain or userId must be provided'
});

/**
 * GET /api/website/booking/intake?subdomain=xxx OR ?userId=xxx
 * Public endpoint - Get intake template for a user's booking flow
 * Supports both subdomain lookup (public website) and direct userId
 */
export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // 1. Get userId from query params (either directly or via subdomain lookup)
    const { searchParams } = new URL(request.url);
    const subdomain = searchParams.get('subdomain');
    // A smart link identifies its business by short code. Without this the
    // shared booking flow could not fetch an intake form on that surface, which
    // is one reason smart links had no intake step at all.
    const userCode = searchParams.get('user_code');
    let userId = searchParams.get('userId');

    if ((subdomain || userCode) && !userId) {
      const owner = await resolvePublicOwner({ subdomain, userCode });

      if (!owner) {
        return NextResponse.json(
          { success: false, error: 'Website not found' },
          { status: 404 }
        );
      }
      userId = owner.userId;
    }

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Missing subdomain or userId parameter' },
        { status: 400 }
      );
    }

    // Validate UUID
    const validation = getIntakeSchema.safeParse({ userId });
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid userId' },
        { status: 400 }
      );
    }

    requestLogger.info({ userId, subdomain }, 'Fetching public intake template');

    // 2. Check if intake is enabled in the client journey flow
    // Look up the process block to see if "intake" is in client_flow
    if (subdomain) {
      const { data: pageData } = await supabaseServer
        .from('website_pages')
        .select('id')
        .eq('subdomain', subdomain)
        .single();

      if (pageData) {
        const { data: processBlock } = await supabaseServer
          .from('website_blocks')
          .select('content')
          .eq('page_id', pageData.id)
          .eq('block_type', 'process')
          .single();

        // Check if services_only is true OR intake is not in client_flow
        if (processBlock?.content) {
          const content = processBlock.content as { services_only?: boolean; client_flow?: string[] };
          if (content.services_only === true) {
            requestLogger.info({ subdomain }, 'Services only mode - intake disabled');
            return NextResponse.json({
              success: true,
              hasIntake: false,
              template: null
            });
          }
          /*
           * No `client_flow` gate here.
           *
           * Intake is a BUSINESS setting — one form, switched on or off — and
           * `client_flow` is a page-level snapshot taken when the page was
           * written. Gating on it meant a business that turned intake on
           * afterwards never saw it: the stored flow still said no, and nothing
           * anywhere explained why the form it had just configured was absent.
           *
           * Step 3 below already asks the only question that matters — does
           * this business have an enabled template — and returns nothing when
           * it does not. The `services_only` check above stays, because that IS
           * a page-level choice: it says this page only lists services and
           * takes no bookings at all.
           */
        }
      }
    }

    /*
     * 3. There is no intake DURING booking any more.
     *
     * Intake follows the booking: the client gets an email with a token link,
     * and answers there. That is one form per business, published by the owner,
     * answered once — not a form embedded mid-flow that a client meets before
     * their booking even exists.
     *
     * This used to call `getEnabledTemplateForUser`, which read
     * `user_intake_settings.template_id` — a column the intake migration
     * dropped — so every booking page that asked logged a Postgres error while
     * the visitor saw nothing at all.
     *
     * `hasIntake: false` is the shape both callers already handle, so the step
     * simply does not appear. Removing the in-flow step from `BookingWidget`
     * and `ProcessFlowSection` is the follow-up; answering honestly here is
     * what stops the error and the half-flow today.
     */
    requestLogger.info({ userId }, 'In-flow intake is retired; intake is sent after booking');

    return NextResponse.json({
      success: true,
      hasIntake: false,
      template: null
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to fetch intake template');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/website/booking/intake
 * Public endpoint - Submit intake responses for a booking
 */
export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // 1. Validate input
    const body = await request.json();
    const validation = submitIntakeSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid request body', details: validation.error.errors },
        { status: 400 }
      );
    }

    const { bookingId, subdomain, templateId, templateKey, responses } = validation.data;
    let { userId } = validation.data;

    // Resolve userId from subdomain if needed
    if (subdomain && !userId) {
      const { data: websitePage, error: pageError } = await supabaseServer
        .from('website_pages')
        .select('user_id')
        .eq('subdomain', subdomain)
        .single();

      if (pageError || !websitePage) {
        return NextResponse.json(
          { success: false, error: 'Website not found' },
          { status: 404 }
        );
      }
      userId = websitePage.user_id;
    }

    requestLogger.info({ bookingId, userId, subdomain, templateKey }, 'Submitting intake responses');

    // 2. Verify booking exists and belongs to the user (using service role since this is public)
    const { data: booking, error: bookingError } = await supabaseServer
      .from('scheduling_bookings')
      .select('id, user_id')
      .eq('id', bookingId)
      .eq('user_id', userId!)
      .single();

    if (bookingError || !booking) {
      requestLogger.warn({ bookingId, userId }, 'Booking not found');
      return NextResponse.json(
        { success: false, error: 'Booking not found' },
        { status: 404 }
      );
    }

    /*
     * 3. Nothing should be arriving here.
     *
     * The GET above no longer offers a form, so no current client can reach
     * this. It verified the template against `intake_form_templates`, a table
     * that no longer exists — and writing an answer keyed to a template id
     * would produce a submission the drawer cannot read, since submissions now
     * carry their own questions.
     *
     * Refused rather than deleted: a stale page still holding the old flow gets
     * a clear answer instead of a 404 from a route that vanished. The intake
     * that reaches this client is the emailed one.
     */
    requestLogger.warn(
      { bookingId, userId, templateId },
      'In-flow intake submission refused; intake is answered from the emailed link'
    );

    return NextResponse.json(
      {
        success: false,
        error: 'Intake is now completed from the link we email after booking.',
      },
      { status: 410 }
    );

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to submit intake responses');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
      },
      { status: 500 }
    );
  }
}
