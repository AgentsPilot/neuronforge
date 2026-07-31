// app/api/book/manage/[token]/intake/route.ts
// Self-service intake form endpoint for booking clients

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { verifyBookingToken } from '@/lib/services/BookingEmailService';
import { supabaseServer } from '@/lib/supabaseServer';
import { intakeRepository } from '@/lib/repositories/IntakeRepository';
import { z } from 'zod';

const logger = createLogger({ module: 'API', service: 'BookingIntake' });

const submitIntakeSchema = z.object({
  templateId: z.string().uuid(),
  templateKey: z.string(),
  responses: z.record(z.any())
});

// GET /api/book/manage/[token]/intake
// Returns intake template for this booking
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // Verify token
    const decoded = verifyBookingToken(token);
    if (!decoded) {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired link' },
        { status: 401 }
      );
    }

    const { bookingId, email } = decoded;

    // Fetch booking with service details
    const { data: booking, error } = await supabaseServer
      .from('scheduling_bookings')
      .select(`
        id,
        user_id,
        client_first_name,
        client_last_name,
        client_email,
        start_time,
        end_time,
        timezone,
        status,
        intake_responses,
        intake_completed_at,
        service:scheduling_services(
          id,
          service_name,
          duration_minutes
        )
      `)
      .eq('id', bookingId)
      .eq('client_email', email)
      .single();

    if (error || !booking) {
      return NextResponse.json(
        { success: false, error: 'Booking not found' },
        { status: 404 }
      );
    }

    // Check if intake already completed
    if (booking.intake_completed_at) {
      return NextResponse.json({
        success: true,
        alreadyCompleted: true,
        completedAt: booking.intake_completed_at,
        booking: {
          id: booking.id,
          clientName: [booking.client_first_name, booking.client_last_name].filter(Boolean).join(' '),
          startTime: booking.start_time,
          endTime: booking.end_time,
          timezone: booking.timezone,
          service: booking.service
        }
      });
    }

    // Check if booking is cancelled
    if (booking.status === 'cancelled') {
      return NextResponse.json(
        { success: false, error: 'This booking has been cancelled' },
        { status: 400 }
      );
    }

    // Get intake template for this user
    const { data: template, error: templateError } = await intakeRepository.getEnabledTemplateForUser(booking.user_id);

    if (templateError) {
      requestLogger.error({ err: templateError }, 'Failed to fetch intake template');
      throw templateError;
    }

    // No template configured
    if (!template) {
      return NextResponse.json({
        success: true,
        hasIntake: false,
        template: null,
        booking: {
          id: booking.id,
          clientName: [booking.client_first_name, booking.client_last_name].filter(Boolean).join(' '),
          startTime: booking.start_time,
          endTime: booking.end_time,
          timezone: booking.timezone,
          service: booking.service
        }
      });
    }

    // Fetch business info for branding
    const { data: profile } = await supabaseServer
      .from('business_profiles')
      .select('company_name, logo_url, primary_color')
      .eq('user_id', booking.user_id)
      .single();

    requestLogger.info({ bookingId, templateKey: template.template_key }, 'Intake template fetched');

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
      },
      booking: {
        id: booking.id,
        clientName: [booking.client_first_name, booking.client_last_name].filter(Boolean).join(' '),
        startTime: booking.start_time,
        endTime: booking.end_time,
        timezone: booking.timezone,
        service: booking.service
      },
      business: profile ? {
        name: profile.company_name,
        logoUrl: profile.logo_url,
        primaryColor: profile.primary_color
      } : null
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

  try {
    // Verify token
    const decoded = verifyBookingToken(token);
    if (!decoded) {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired link' },
        { status: 401 }
      );
    }

    const { bookingId, email } = decoded;

    // Parse and validate body
    const body = await request.json();
    const validated = submitIntakeSchema.parse(body);

    // Fetch booking
    const { data: booking, error } = await supabaseServer
      .from('scheduling_bookings')
      .select('id, user_id, client_email, status, intake_completed_at')
      .eq('id', bookingId)
      .eq('client_email', email)
      .single();

    if (error || !booking) {
      return NextResponse.json(
        { success: false, error: 'Booking not found' },
        { status: 404 }
      );
    }

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

    // Verify template exists
    const { data: template, error: templateError } = await intakeRepository.getTemplateById(validated.templateId);
    if (templateError || !template) {
      return NextResponse.json(
        { success: false, error: 'Invalid template' },
        { status: 400 }
      );
    }

    // Save intake responses
    const intakeData = {
      template_id: validated.templateId,
      template_key: validated.templateKey,
      responses: validated.responses
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

    requestLogger.info({ bookingId, templateKey: validated.templateKey }, 'Intake responses saved');

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
