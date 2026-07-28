/**
 * GET /api/scheduling/calendar-sync/status
 * Get calendar sync status and statistics for a user
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { CalendarSyncService } from '@/lib/services/CalendarSyncService';

const logger = createLogger({ module: 'CalendarSyncStatusAPI' });

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

    // 2. Get sync status
    const status = await CalendarSyncService.getSyncStatus(user.id);

    // 3. Return status
    return NextResponse.json({
      success: true,
      ...status
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to get calendar sync status');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
