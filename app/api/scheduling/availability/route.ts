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

    /*
     * 3. Write it — update first, insert only if there was nothing to update.
     *
     * This used to SELECT the profile to decide between update and insert,
     * which made every save two round trips instead of one for the case that is
     * almost always true: the profile exists. The update reports whether it
     * matched, so the question the select was asking is already answered by the
     * write itself.
     *
     * NOT an upsert, though `user_id` is unique: an upsert would have to carry
     * `vertical`, which is NOT NULL, and would overwrite the real vertical of
     * every existing profile with the 'other' placeholder meant for accounts
     * that never finished onboarding.
     *
     * `.select('id')` rather than `.select()`: only the id is used, for the
     * audit entry below, and the full row is wide — several JSON blobs among
     * them — so returning it was pure transfer.
     */
    let { data, error } = await supabaseServer
      .from('business_profiles')
      .update({
        scheduling_availability: validated.availability,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', user.id)
      .select('id')
      .maybeSingle();

    if (!error && !data) {
      const result = await supabaseServer
        .from('business_profiles')
        .insert({
          user_id: user.id,
          vertical: 'other', // Default for users who haven't completed onboarding
          scheduling_availability: validated.availability
        })
        .select('id')
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
        /*
         * A summary, not the blob.
         *
         * The whole weekly availability object was written into every audit
         * row — the same seven arrays, on every save, for a record nobody reads
         * back field by field. The day count is what makes an entry meaningful
         * in a list: it says whether hours were added or cleared.
         */
        details: {
          openDays: Object.values(validated.availability).filter(
            slots => Array.isArray(slots) && slots.length > 0
          ).length,
        },
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
