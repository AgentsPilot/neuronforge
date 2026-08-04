/**
 * Website Analytics API
 * GET - Fetch analytics for user's website
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { WebsiteAnalyticsRepository } from '@/lib/repositories/WebsiteAnalyticsRepository';
import { WebsitePageRepository } from '@/lib/repositories/WebsitePageRepository';

const logger = createLogger({ module: 'WebsiteAnalyticsAPI' });

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

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const pageRepo = new WebsitePageRepository(supabaseServer);

    // Get user's homepage (main website page, not landing pages)
    const homepageResult = await pageRepo.getHomepage(user.id);
    if (homepageResult.error || !homepageResult.data) {
      return NextResponse.json({
        success: true,
        analytics: ZERO_ANALYTICS
      });
    }

    const homepage = homepageResult.data;
    const subdomain = homepage.subdomain;

    // Get analytics for homepage only (not landing pages)
    let summaryData = ZERO_ANALYTICS;
    try {
      const analyticsRepo = new WebsiteAnalyticsRepository(supabaseServer);
      const summaryResult = await analyticsRepo.getPageSummary(homepage.id, user.id);
      if (summaryResult.data) {
        summaryData = summaryResult.data;
      }
    } catch (analyticsError) {
      requestLogger.warn({ err: analyticsError }, 'Analytics table query failed, returning zeros');
    }

    requestLogger.info({ userId: user.id, subdomain, pageId: homepage.id, summaryData }, 'Fetched website analytics (homepage only)');

    return NextResponse.json({
      success: true,
      analytics: summaryData,
      subdomain
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to fetch website analytics');
    // Return zeros instead of 500 error
    return NextResponse.json({
      success: true,
      analytics: ZERO_ANALYTICS
    });
  }
}
