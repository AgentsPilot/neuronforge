/**
 * GET /api/cron/calendar-sync
 * Background cron job to sync external calendar events
 *
 * This endpoint is called by Vercel Cron every 5 minutes.
 * It syncs external calendar events for all users with calendar sync enabled.
 *
 * Configure in vercel.json:
 * {
 *   "crons": [{
 *     "path": "/api/cron/calendar-sync",
 *     "schedule": "0/5 * * * *"
 *   }]
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { CalendarSyncService } from '@/lib/services/CalendarSyncService';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';

const logger = createLogger({ module: 'CalendarSyncCron' });

// Verify cron secret to prevent unauthorized access
const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(request: NextRequest) {
  const correlationId = crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // Verify authorization
    // In production, Vercel sends an Authorization header with CRON_SECRET
    const authHeader = request.headers.get('authorization');
    if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
      // Also allow internal calls without auth in development
      if (process.env.NODE_ENV === 'production') {
        requestLogger.warn('Unauthorized cron request');
        return NextResponse.json(
          { success: false, error: 'Unauthorized' },
          { status: 401 }
        );
      }
    }

    requestLogger.info('Starting calendar sync cron job');
    const startTime = Date.now();

    // Get users who need sync (stale after 5 minutes)
    const usersResult = await businessProfileRepository.getUsersWithCalendarSyncEnabled(5);

    if (usersResult.error || !usersResult.data) {
      requestLogger.error({ err: usersResult.error }, 'Failed to get users for calendar sync');
      return NextResponse.json(
        { success: false, error: 'Failed to get users' },
        { status: 500 }
      );
    }

    const users = usersResult.data;
    requestLogger.info({ userCount: users.length }, 'Found users needing calendar sync');

    // Process results
    const results = {
      total: users.length,
      synced: 0,
      failed: 0,
      errors: [] as Array<{ userId: string; error: string }>
    };

    // Sync each user (process in batches to avoid timeouts)
    const BATCH_SIZE = 10;
    for (let i = 0; i < users.length; i += BATCH_SIZE) {
      const batch = users.slice(i, i + BATCH_SIZE);

      // Process batch in parallel
      const batchResults = await Promise.allSettled(
        batch.map(async (user) => {
          try {
            const syncResult = await CalendarSyncService.syncExternalEvents(user.userId);
            if (syncResult.errors.length > 0) {
              return { userId: user.userId, success: false, error: syncResult.errors[0] };
            }
            return { userId: user.userId, success: true };
          } catch (error) {
            return { userId: user.userId, success: false, error: (error as Error).message };
          }
        })
      );

      // Aggregate results
      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          if (result.value.success) {
            results.synced++;
          } else {
            results.failed++;
            results.errors.push({ userId: result.value.userId, error: result.value.error || 'Unknown error' });
          }
        } else {
          results.failed++;
        }
      }
    }

    const duration = Date.now() - startTime;
    requestLogger.info({
      duration,
      ...results,
      errorCount: results.errors.length
    }, 'Calendar sync cron job completed');

    return NextResponse.json({
      success: true,
      duration_ms: duration,
      total: results.total,
      synced: results.synced,
      failed: results.failed
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Calendar sync cron job failed');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
