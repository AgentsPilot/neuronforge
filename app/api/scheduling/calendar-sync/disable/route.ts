/**
 * POST /api/scheduling/calendar-sync/disable
 * Disable calendar sync for a user
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { CalendarSyncService } from '@/lib/services/CalendarSyncService';

const logger = createLogger({ module: 'CalendarSyncDisableAPI' });

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

    requestLogger.info({ userId: user.id }, 'Disabling calendar sync');

    // 2. Disable sync
    const result = await CalendarSyncService.disableSync(user.id);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error || 'Failed to disable calendar sync' },
        { status: 500 }
      );
    }

    // 3. Return success
    return NextResponse.json({
      success: true,
      message: 'Calendar sync disabled'
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to disable calendar sync');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
