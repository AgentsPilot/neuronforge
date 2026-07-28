/**
 * POST /api/scheduling/calendar-sync/sync-all
 * Sync all confirmed bookings that don't have calendar events yet
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { CalendarSyncService } from '@/lib/services/CalendarSyncService';

const logger = createLogger({ module: 'CalendarSyncAllAPI' });

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

    requestLogger.info({ userId: user.id }, 'Starting sync all bookings');

    // 2. Sync all bookings
    const result = await CalendarSyncService.syncAllBookings(user.id);

    // 3. Return result
    return NextResponse.json({
      success: true,
      total: result.total,
      synced: result.synced,
      failed: result.failed,
      errors: result.errors.length > 0 ? result.errors : undefined
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to sync all bookings');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
