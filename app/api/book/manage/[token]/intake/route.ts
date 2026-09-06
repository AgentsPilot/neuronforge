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

    // Check if intake already completed
    if (booking.intake_completed_at) {
      return NextResponse.json({
        success: true,
        alreadyCompleted: true,
        completedAt: booking.intake_completed_at,
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
          clientName: [contact?.first_name, contact?.last_name].filter(Boolean).join(' '),
          startTime: booking.start_time,
          endTime: booking.end_time,
          timezone: booking.timezone,
          service: booking.service
        },
        business: businessData
      });
    }

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
