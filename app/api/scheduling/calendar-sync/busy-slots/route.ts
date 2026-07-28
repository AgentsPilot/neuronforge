/**
 * GET /api/scheduling/calendar-sync/busy-slots
 * Get busy time slots from external calendar events
 * Used to block availability in booking flow
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { CalendarSyncService } from '@/lib/services/CalendarSyncService';

const logger = createLogger({ module: 'CalendarSyncBusySlotsAPI' });

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

    // 2. Parse query parameters
    const { searchParams } = new URL(request.url);
    const start = searchParams.get('start');
    const end = searchParams.get('end');

    if (!start || !end) {
      return NextResponse.json(
        { success: false, error: 'start and end query parameters are required' },
        { status: 400 }
      );
    }

    // Validate date formats
    const startDate = new Date(start);
    const endDate = new Date(end);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return NextResponse.json(
        { success: false, error: 'Invalid date format. Use ISO 8601 format.' },
        { status: 400 }
      );
    }

    // 3. Get busy slots from database
    const busySlots = await CalendarSyncService.getExternalBusySlots(
      user.id,
      startDate.toISOString(),
      endDate.toISOString()
    );

    // 4. Return busy slots
    return NextResponse.json({
      success: true,
      busy_slots: busySlots
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to get busy slots');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
