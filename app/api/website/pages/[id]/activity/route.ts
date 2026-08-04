/**
 * Page Activity/Analytics API
 * GET - Check if a page has activity or fetch full analytics
 *   ?full=true - Returns full analytics summary
 *   default - Returns hasActivity and viewCount only
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { WebsiteAnalyticsRepository } from '@/lib/repositories/WebsiteAnalyticsRepository';

const logger = createLogger({ module: 'PageActivityAPI' });

// Default zero analytics for fallback
const ZERO_ANALYTICS = {
  total_views: 0,
  unique_visitors: 0,
  views_today: 0,
  visitors_today: 0,
  views_this_month: 0,
  visitors_this_month: 0,
  views_30d: 0,
  visitors_30d: 0,
  views_7d: 0,
  visitors_7d: 0
};

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const analyticsRepo = new WebsiteAnalyticsRepository(supabaseServer);

    // Check if full analytics are requested
    const { searchParams } = new URL(request.url);
    const fullAnalytics = searchParams.get('full') === 'true';

    if (fullAnalytics) {
      // Return full analytics summary
      const summaryResult = await analyticsRepo.getPageSummary(id, user.id);

      requestLogger.info({
        pageId: id,
        userId: user.id,
        analytics: summaryResult.data
      }, 'Fetched page analytics');

      return NextResponse.json({
        success: true,
        analytics: summaryResult.data || ZERO_ANALYTICS
      });
    }

    // Default: Check page views for activity check
    const activityResult = await analyticsRepo.hasPageActivity(id, user.id);

    if (activityResult.error) {
      throw activityResult.error;
    }

    requestLogger.info({
      pageId: id,
      userId: user.id,
      hasActivity: activityResult.data?.hasActivity,
      viewCount: activityResult.data?.viewCount
    }, 'Checked page activity');

    return NextResponse.json({
      success: true,
      hasActivity: activityResult.data?.hasActivity || false,
      viewCount: activityResult.data?.viewCount || 0
    });
  } catch (error) {
    requestLogger.error({ err: error, id }, 'Failed to check page activity');
    return NextResponse.json(
      { success: false, error: 'Failed to check page activity' },
      { status: 500 }
    );
  }
}
