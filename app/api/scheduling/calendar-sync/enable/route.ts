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

    /*
     * ───────────────────────────────────────────────────────────────────────────
     * 4. THE FIRST SYNC IS AWAITED, SO "ENABLED" MEANS "YOUR DIARY IS LOADED".
     *
     * This was fire-and-forget, and the caller refreshed the calendar the moment
     * the response landed — which is BEFORE any event has been fetched. The
     * owner turned sync on, watched the week redraw with nothing blocked, and
     * reasonably concluded it had not worked. Whether it eventually appeared
     * depended on a race they could not see.
     *
     * Awaiting it also removes a second race: the client used to fire its own
     * refresh afterwards, so two syncs ran against the same calendar at once.
     *
     * A FAILED FETCH DOES NOT FAIL THE REQUEST. Turning sync on and reading the
     * diary are two different things: the setting is saved either way, the cron
     * will retry in five minutes, and an owner told "we could not reach your
     * calendar" can act on that — where a 500 would leave them believing the
     * switch itself is broken.
     * ───────────────────────────────────────────────────────────────────────────
     */
    const sync = await CalendarSyncService.syncExternalEvents(user.id).catch(err => {
      requestLogger.error({ err, userId: user.id }, 'Initial external sync failed');
      return null;
    });

    const syncError = sync === null ? 'sync_failed' : sync.errors[0] ?? null;

    if (syncError) {
      requestLogger.warn(
        { userId: user.id, provider: validated.provider, syncError },
        'Calendar sync enabled, but the first read of the calendar did not succeed'
      );
    }

    // 5. Return success
    return NextResponse.json({
      success: true,
      message: `Calendar sync enabled with ${validated.provider}`,
      /** How many events the first read found, for the caller to report. */
      events: sync?.total ?? 0,
      /** Present when the setting is on but the calendar could not be read. */
      syncError,
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
