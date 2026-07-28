/**
 * POST /api/scheduling/calendar-sync/enable
 * Enable calendar sync for a user with a specific provider
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { CalendarSyncService } from '@/lib/services/CalendarSyncService';
import { z } from 'zod';

const logger = createLogger({ module: 'CalendarSyncEnableAPI' });

const enableSchema = z.object({
  provider: z.enum(['google_calendar', 'outlook'])
});

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
    const validated = enableSchema.parse(body);

    requestLogger.info({ userId: user.id, provider: validated.provider }, 'Enabling calendar sync');

    // 3. Enable sync
    const result = await CalendarSyncService.enableSync(user.id, validated.provider);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error || 'Failed to enable calendar sync' },
        { status: 500 }
      );
    }

    // 4. Trigger initial external events sync (non-blocking)
    CalendarSyncService.syncExternalEvents(user.id)
      .catch(err => requestLogger.error({ err }, 'Initial external sync failed'));

    // 5. Return success
    return NextResponse.json({
      success: true,
      message: `Calendar sync enabled with ${validated.provider}`
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid provider. Must be google_calendar or outlook' },
        { status: 400 }
      );
    }

    requestLogger.error({ err: error }, 'Failed to enable calendar sync');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
