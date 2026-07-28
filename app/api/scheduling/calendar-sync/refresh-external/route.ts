/**
 * POST /api/scheduling/calendar-sync/refresh-external
 * Force refresh external calendar events for a user
 * Updates the stored external events from Google Calendar / Outlook
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { CalendarSyncService } from '@/lib/services/CalendarSyncService';

const logger = createLogger({ module: 'CalendarSyncRefreshExternalAPI' });

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

    requestLogger.info({ userId: user.id }, 'Refreshing external calendar events');

    // 2. Sync external events
    const result = await CalendarSyncService.syncExternalEvents(user.id);

    // 3. Return result
    return NextResponse.json({
      success: true,
      total: result.total,
      added: result.added,
      updated: result.updated,
      removed: result.removed,
      errors: result.errors.length > 0 ? result.errors : undefined
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to refresh external events');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
