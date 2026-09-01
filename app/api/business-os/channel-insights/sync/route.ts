/**
 * POST /api/business-os/channel-insights/sync - Refresh a user's channel data now
 *
 * Exists so connecting an account shows numbers immediately rather than "check
 * back tomorrow". Rate limited to once an hour per user: the nightly cron is the
 * normal path, and the platforms' data only moves daily.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { channelConnectionRepository } from '@/lib/repositories/ChannelConnectionRepository';
import { channelMetricsSyncService } from '@/lib/business-os/channel-insights/ChannelMetricsSyncService';

const logger = createLogger({ module: 'ChannelSyncAPI' });

const MIN_INTERVAL_MS = 60 * 60 * 1000;

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { data: connections } = await channelConnectionRepository.findEnabledByUser(user.id);
    if (!connections?.length) {
      return NextResponse.json(
        { success: false, error: 'no_connections', message: 'No channels are connected yet.' },
        { status: 409 }
      );
    }

    // Rate limit on the stored cursor rather than a separate store: it is
    // already the record of when we last called out.
    const mostRecentSync = connections
      .map(c => (c.last_synced_at ? new Date(c.last_synced_at).getTime() : 0))
      .reduce((max, t) => Math.max(max, t), 0);

    const sinceLast = Date.now() - mostRecentSync;
    if (mostRecentSync > 0 && sinceLast < MIN_INTERVAL_MS) {
      const retryInMinutes = Math.ceil((MIN_INTERVAL_MS - sinceLast) / 60000);
      return NextResponse.json(
        {
          success: false,
          error: 'rate_limited',
          message: `Already refreshed recently. Try again in ${retryInMinutes} minutes.`,
          retryInMinutes,
        },
        { status: 429 }
      );
    }

    const results = await channelMetricsSyncService.syncUser(user.id);
    const failed = results.filter(r => r.error);

    requestLogger.info(
      { userId: user.id, synced: results.length, failed: failed.length },
      'Manual channel sync complete'
    );

    return NextResponse.json({
      success: true,
      data: {
        synced: results.length,
        daysWritten: results.reduce((sum, r) => sum + r.daysWritten, 0),
        // Reported rather than swallowed — a partly failed sync should not look
        // like a clean one.
        failures: failed.map(r => ({ platform: r.platform, error: r.error })),
      },
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Manual channel sync failed');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
