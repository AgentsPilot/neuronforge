/**
 * GET /api/business-os/channel-insights - Where a business's clients come from
 *
 * Groups leads acquired in the period by the channel they arrived from, with the
 * bookings and revenue each channel produced. Requires no connected account and
 * no configuration: attribution comes from the referrer already recorded on
 * every lead by lib/utils/attribution.ts.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { channelPerformanceService } from '@/lib/business-os/channel-insights/ChannelPerformanceService';

const logger = createLogger({ module: 'ChannelInsightsAPI' });

/** Same vocabulary as the reports page period filter. */
const querySchema = z.object({
  period: z.enum(['week', 'month', 'year', 'all']).default('month'),
});

const PERIOD_DAYS: Record<'week' | 'month' | 'year', number> = {
  week: 7,
  month: 30,
  year: 365,
};

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // 1. Authenticate
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Validate input
    const parsed = querySchema.safeParse({
      period: request.nextUrl.searchParams.get('period') ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid period. Expected week, month, year or all.' },
        { status: 400 }
      );
    }
    const { period } = parsed.data;

    // 3. Execute
    // 'all' uses the epoch so the query keeps one shape rather than branching.
    const since =
      period === 'all'
        ? new Date(0).toISOString()
        : new Date(Date.now() - PERIOD_DAYS[period] * 24 * 60 * 60 * 1000).toISOString();

    const performance = await channelPerformanceService.getPerformance(user.id, since);

    requestLogger.info(
      { userId: user.id, period, channels: performance.rows.length },
      'Channel insights served'
    );

    // 4. Return
    return NextResponse.json({ success: true, data: { period, ...performance } });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to load channel insights');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined,
      },
      { status: 500 }
    );
  }
}
