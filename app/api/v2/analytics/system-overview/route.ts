// app/api/v2/analytics/system-overview/route.ts
// API endpoint for business-focused analytics dashboard

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { SystemAnalyticsService } from '@/lib/services/SystemAnalyticsService';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { z } from 'zod';
import type { TimeRange } from '@/types/analytics';

const logger = createLogger({ module: 'AnalyticsAPI' });
const auditTrail = AuditTrailService.getInstance();

const querySchema = z.object({
  range: z.enum(['7d', '30d', '90d', 'all']).default('30d'),
});

export async function GET(request: NextRequest) {
  const correlationId = crypto.randomUUID();
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

    // 2. Validate query parameters
    const { searchParams } = new URL(request.url);
    const validationResult = querySchema.safeParse({
      range: searchParams.get('range'),
    });

    if (!validationResult.success) {
      requestLogger.warn({ errors: validationResult.error }, 'Invalid query parameters');
      return NextResponse.json(
        { success: false, error: 'Invalid query parameters', details: validationResult.error.issues },
        { status: 400 }
      );
    }

    const { range } = validationResult.data;

    requestLogger.info({ userId: user.id, range }, 'Fetching system analytics');

    // 3. Get analytics data
    const analyticsService = new SystemAnalyticsService();
    const data = await analyticsService.getBusinessOverview(user.id, range as TimeRange);

    // 4. Audit log (non-blocking)
    auditTrail.log({
      action: 'ANALYTICS_VIEWED',
      entityType: 'system',
      entityId: 'analytics',
      userId: user.id,
      resourceName: 'System Analytics Dashboard',
      metadata: { timeRange: range, heroMetrics: data.heroMetrics },
      severity: 'info',
      request,
    }).catch(err => requestLogger.error({ err }, 'Audit failed (non-blocking)'));

    requestLogger.info({ userId: user.id, range, dataSize: JSON.stringify(data).length }, 'Analytics fetched successfully');

    return NextResponse.json({ success: true, data });

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to fetch analytics');

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to load analytics',
        details: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : String(error)) : undefined
      },
      { status: 500 }
    );
  }
}
