/**
 * GET/POST /api/website/booking/intake - Public intake form endpoint for booking flow
 * GET: Get intake template for a user (public, no auth required for clients)
 * POST: Submit intake responses for a booking
 */

import { NextRequest, NextResponse } from 'next/server';
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
    let userId = searchParams.get('userId');

    // If subdomain is provided, look up the website owner
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

    // 2. Get enabled template for this user
    const { data: template, error } = await intakeRepository.getEnabledTemplateForUser(userId);
    if (error) {
      throw error;
    }

    // No template or intake disabled
    if (!template) {
      return NextResponse.json({
        success: true,
        hasIntake: false,
        template: null
      });
    }

    requestLogger.info({ userId, templateKey: template.template_key }, 'Intake template found');

    return NextResponse.json({
      success: true,
      hasIntake: true,
      template: {
        id: template.id,
        template_key: template.template_key,
        name_en: template.name_en,
        name_es: template.name_es,
        name_he: template.name_he,
        fields: template.fields
      }
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

    // 3. Verify template exists
    const { data: template, error: templateError } = await intakeRepository.getTemplateById(templateId);
    if (templateError || !template) {
      requestLogger.warn({ templateId }, 'Template not found');
      return NextResponse.json(
        { success: false, error: 'Template not found' },
        { status: 404 }
      );
    }

    // 4. Save intake responses (using service role for public access)
    const intakeData = {
      template_id: templateId,
      template_key: templateKey,
      responses
    };

    requestLogger.info({ bookingId, intakeData }, 'Attempting to save intake responses');

    const { data: updateResult, error: updateError } = await supabaseServer
      .from('scheduling_bookings')
      .update({
        intake_responses: intakeData,
        intake_completed_at: new Date().toISOString()
      })
      .eq('id', bookingId)
      .select('id, intake_responses, intake_completed_at')
      .single();

    if (updateError) {
      requestLogger.error({ err: updateError, bookingId }, 'Failed to update booking with intake');
      throw updateError;
    }

    requestLogger.info({ bookingId, templateKey, updateResult }, 'Intake responses saved successfully');

    return NextResponse.json({
      success: true,
      message: 'Intake responses saved'
    });

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
