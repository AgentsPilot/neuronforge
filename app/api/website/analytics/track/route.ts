/**
 * POST /api/website/analytics/track — record one page view
 *
 * Called from the browser, not from the server render. That distinction is the
 * whole point: the previous server-side collector ran inside an internal
 * fetch and therefore read that request's headers, recording a null referer,
 * Node's user-agent and the app server's IP for every visitor.
 *
 * From the browser we get `document.referrer` (which survives cases the Referer
 * header drops), the landing URL's UTM parameters, a real device and a real IP —
 * everything needed to resolve which channel sent the visitor.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import {
  WebsiteAnalyticsRepository,
  hashIP,
  detectDeviceType,
} from '@/lib/repositories/WebsiteAnalyticsRepository';
import { WebsitePageRepository } from '@/lib/repositories/WebsitePageRepository';

const logger = createLogger({ module: 'TrackAnalyticsAPI' });

const bodySchema = z.object({
  page_id: z.string().uuid().optional(),
  subdomain: z.string().min(1).max(100).optional(),
  /** document.referrer — more reliable than the Referer header. */
  referrer: z.string().max(2048).optional(),
  /** Landing URL query parameters, which the referer cannot carry. */
  utm_source: z.string().max(255).optional(),
  utm_medium: z.string().max(255).optional(),
  utm_campaign: z.string().max(255).optional(),
  source: z.string().max(50).optional(),
});

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
    }
    const { page_id, subdomain: providedSubdomain, referrer, utm_source, utm_medium, utm_campaign } =
      parsed.data;

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

      const pageResult = await pageRepo.findById(page_id, user.id);
      if (pageResult.error || !pageResult.data) {
        return NextResponse.json({ success: false, error: 'Page not found' }, { status: 404 });
      }

      pageId = pageResult.data.id;
      userId = user.id;
      subdomain = pageResult.data.subdomain || 'unknown';
    } else if (providedSubdomain) {
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

    // The owner looking at their own page is not an audience. Recorded but
    // flagged, so historical counts stay auditable while every visitor metric
    // can exclude it.
    const isOwnerView = !!user && user.id === userId;

    const userAgent = request.headers.get('user-agent') || null;
    // The client's document.referrer is preferred: the Referer header is dropped
    // on https->http, by some privacy modes, and by several in-app browsers.
    const effectiveReferrer = referrer || request.headers.get('referer') || null;

    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      request.headers.get('cf-connecting-ip') ||
      null;

    // Null when the IP is unknown, never a synthesised per-request value. The
    // previous fallback hashed a timestamp, which minted a brand-new "unique
    // visitor" on every single request and inflated the count without limit.
    const ipHash = ip ? hashIP(ip) : null;

    const result = await analyticsRepo.trackPageView({
      page_id: pageId,
      user_id: userId,
      subdomain,
      user_agent: userAgent,
      referer: effectiveReferrer,
      ip_hash: ipHash,
      device_type: detectDeviceType(userAgent),
      utm_source: utm_source ?? null,
      utm_medium: utm_medium ?? null,
      utm_campaign: utm_campaign ?? null,
      is_owner_view: isOwnerView,
    });

    if (result.error) {
      throw result.error;
    }

    requestLogger.debug({ subdomain, isOwnerView }, 'Page view tracked');

    return NextResponse.json({ success: true, tracked: true });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to track page view');
    return NextResponse.json({ success: false, error: 'Failed to track view' }, { status: 500 });
  }
}
