/**
 * Test Analytics API - DEV ONLY
 * POST - Add test page views for development testing
 *
 * Only available in development mode
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { WebsiteAnalyticsRepository, hashIP } from '@/lib/repositories/WebsiteAnalyticsRepository';
import { WebsitePageRepository } from '@/lib/repositories/WebsitePageRepository';

const logger = createLogger({ module: 'TestAnalyticsAPI' });

export async function POST(request: NextRequest) {
  // Only allow in development
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json(
      { success: false, error: 'Only available in development mode' },
      { status: 403 }
    );
  }

  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const count = body.count || 5; // Default 5 test views

    // Get user's page
    const pageRepo = new WebsitePageRepository(supabaseServer);
    const pagesResult = await pageRepo.findByUserId(user.id);

    if (!pagesResult.data || pagesResult.data.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No website pages found' },
        { status: 404 }
      );
    }

    const page = pagesResult.data[0];
    const subdomain = page.subdomain || 'test';

    // Create test page views
    const analyticsRepo = new WebsiteAnalyticsRepository(supabaseServer);
    const testDevices = ['desktop', 'mobile', 'tablet'];
    const testReferrers = ['https://google.com', 'https://facebook.com', 'https://linkedin.com', null];

    const viewsCreated = [];
    for (let i = 0; i < count; i++) {
      // Generate unique IP hash for each "visitor" (some repeated for returning visitors)
      const visitorId = Math.floor(Math.random() * (count * 0.7)); // ~70% unique
      const ipHash = hashIP(`test-visitor-${visitorId}`);

      const result = await analyticsRepo.trackPageView({
        page_id: page.id,
        user_id: user.id,
        subdomain,
        user_agent: `Mozilla/5.0 (Test Browser ${i})`,
        referer: testReferrers[Math.floor(Math.random() * testReferrers.length)],
        ip_hash: ipHash,
        device_type: testDevices[Math.floor(Math.random() * testDevices.length)]
      });

      if (result.data) {
        viewsCreated.push(result.data.id);
      }
    }

    requestLogger.info({ userId: user.id, count: viewsCreated.length }, 'Created test page views');

    return NextResponse.json({
      success: true,
      message: `Created ${viewsCreated.length} test page views`,
      subdomain,
      views_created: viewsCreated.length
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to create test page views');
    return NextResponse.json(
      { success: false, error: 'Failed to create test views' },
      { status: 500 }
    );
  }
}
