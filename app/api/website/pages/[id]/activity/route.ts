/**
 * Page Activity Check API
 * GET - Check if a page has activity (views, bookings) before deletion
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { WebsiteAnalyticsRepository } from '@/lib/repositories/WebsiteAnalyticsRepository';

const logger = createLogger({ module: 'PageActivityAPI' });

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

    // Check page views
    const activityResult = await analyticsRepo.hasPageActivity(id, user.id);

    if (activityResult.error) {
      throw activityResult.error;
    }

    // TODO: Could also check for bookings linked to this page's service
    // For now, we only check page views

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
