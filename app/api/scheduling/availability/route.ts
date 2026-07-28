/**
 * GET/POST /api/scheduling/availability
 * Business-level availability settings
 * Stores the user's weekly working hours for client bookings
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { supabaseServer } from '@/lib/supabaseServer';
import { z } from 'zod';

const logger = createLogger({ module: 'SchedulingAvailabilityAPI' });
const auditTrail = AuditTrailService.getInstance();

// Validation schema for time slot
const timeSlotSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/)
});

// Validation schema for weekly availability
const availabilitySchema = z.object({
  availability: z.object({
    sunday: z.array(timeSlotSchema),
    monday: z.array(timeSlotSchema),
    tuesday: z.array(timeSlotSchema),
    wednesday: z.array(timeSlotSchema),
    thursday: z.array(timeSlotSchema),
    friday: z.array(timeSlotSchema),
    saturday: z.array(timeSlotSchema)
  })
});

/**
 * GET - Fetch business availability
 */
export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // 1. Authenticate
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    requestLogger.info({ userId: user.id }, 'Fetching business availability');

    // 2. Fetch from business_profiles
    const { data, error } = await supabaseServer
      .from('business_profiles')
      .select('scheduling_availability')
      .eq('user_id', user.id)
      .single();

    if (error && error.code !== 'PGRST116') {
      requestLogger.error({ err: error, userId: user.id }, 'Failed to fetch availability');
      return NextResponse.json(
        { success: false, error: 'Failed to fetch availability' },
        { status: 500 }
      );
    }

    // 3. Return availability (or default empty)
    return NextResponse.json({
      success: true,
      availability: data?.scheduling_availability || null
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Request failed');
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
 * POST - Save business availability
 */
export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // 1. Authenticate
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // 2. Validate input
    const body = await request.json();
    const validated = availabilitySchema.parse(body);

    requestLogger.info({ userId: user.id }, 'Saving business availability');

    // 3. Check if profile exists, then update or insert
    const { data: existingProfile } = await supabaseServer
      .from('business_profiles')
      .select('id')
      .eq('user_id', user.id)
      .single();

    let data;
    let error;

    if (existingProfile) {
      // Update existing profile
      const result = await supabaseServer
        .from('business_profiles')
        .update({
          scheduling_availability: validated.availability,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', user.id)
        .select()
        .single();
      data = result.data;
      error = result.error;
    } else {
      // Insert new profile with required 'vertical' field
      const result = await supabaseServer
        .from('business_profiles')
        .insert({
          user_id: user.id,
          vertical: 'other', // Default for users who haven't completed onboarding
          scheduling_availability: validated.availability
        })
        .select()
        .single();
      data = result.data;
      error = result.error;
    }

    if (error) {
      requestLogger.error({ err: error, userId: user.id }, 'Failed to save availability');
      return NextResponse.json(
        { success: false, error: 'Failed to save availability' },
        { status: 500 }
      );
    }

    // 4. Audit log (non-blocking)
    auditTrail
      .log({
        action: 'SCHEDULING_AVAILABILITY_UPDATED',
        userId: user.id,
        entityType: 'business_profile',
        entityId: data.id,
        metadata: { availability: validated.availability },
        request
      })
      .catch(err => requestLogger.error({ err }, 'Audit failed'));

    // 5. Return success
    requestLogger.info({ userId: user.id }, 'Business availability saved');
    return NextResponse.json({
      success: true,
      availability: validated.availability
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      requestLogger.warn({ err: error }, 'Validation error');
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid input',
          details: process.env.NODE_ENV === 'development' ? error.errors : undefined
        },
        { status: 400 }
      );
    }

    requestLogger.error({ err: error }, 'Request failed');
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
