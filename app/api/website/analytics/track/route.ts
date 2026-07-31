/**
 * Website Analytics Track API
 * POST - Track a page view from any source (preview, public, embedded)
 *
 * Supports authenticated tracking (preview mode) and can be extended for public tracking
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { WebsiteAnalyticsRepository, hashIP, detectDeviceType } from '@/lib/repositories/WebsiteAnalyticsRepository';
import { WebsitePageRepository } from '@/lib/repositories/WebsitePageRepository';

const logger = createLogger({ module: 'TrackAnalyticsAPI' });

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const body = await request.json();
    const { page_id, subdomain: providedSubdomain, source } = body;

    // Try to get authenticated user (for preview/admin tracking)
    const user = await getUser();

    const pageRepo = new WebsitePageRepository(supabaseServer);
    const analyticsRepo = new WebsiteAnalyticsRepository(supabaseServer);

    let pageId = page_id;
    let userId: string;
    let subdomain: string;

    if (page_id) {
      // Tracking by page_id (preview mode - requires auth)
      if (!user) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
      }

      // Verify page belongs to user
      const pageResult = await pageRepo.findById(page_id, user.id);
      if (pageResult.error || !pageResult.data) {
        return NextResponse.json({ success: false, error: 'Page not found' }, { status: 404 });
      }

      pageId = pageResult.data.id;
      userId = user.id;
      subdomain = pageResult.data.subdomain || 'unknown';
    } else if (providedSubdomain) {
      // Tracking by subdomain (public mode)
      const pageResult = await pageRepo.findBySubdomainAny(providedSubdomain);
      if (pageResult.error || !pageResult.data) {
        return NextResponse.json({ success: false, error: 'Page not found' }, { status: 404 });
      }

      pageId = pageResult.data.id;
      userId = pageResult.data.user_id;
      subdomain = providedSubdomain;
    } else {
      return NextResponse.json(
        { success: false, error: 'page_id or subdomain required' },
        { status: 400 }
      );
    }

    // Get visitor info from request
    const userAgent = request.headers.get('user-agent') || null;
    const referer = request.headers.get('referer') || null;

    // Get IP from various headers
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      request.headers.get('cf-connecting-ip') ||
      'unknown';

    const ipHash = ip !== 'unknown' ? hashIP(ip) : hashIP(`session-${Date.now()}`);
    const deviceType = detectDeviceType(userAgent);

    // Track the view
    const result = await analyticsRepo.trackPageView({
      page_id: pageId,
      user_id: userId,
      subdomain,
      user_agent: userAgent,
      referer,
      ip_hash: ipHash,
      device_type: deviceType
    });

    if (result.error) {
      throw result.error;
    }

    requestLogger.debug({ subdomain, source, deviceType }, 'Page view tracked');

    return NextResponse.json({
      success: true,
      tracked: true
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to track page view');
    return NextResponse.json(
      { success: false, error: 'Failed to track view' },
      { status: 500 }
    );
  }
}
