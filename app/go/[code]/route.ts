/**
 * Smart Link Redirect API
 * GET - Public redirect endpoint for smart links
 *
 * This is a PUBLIC endpoint - no authentication required
 * Redirects to destination URL while tracking the click
 *
 * URL format: /go/[code]
 * Example: /go/abc123 → redirects to configured destination
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { smartLinkRepository } from '@/lib/repositories/SmartLinkRepository';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { buildAttributionFromRequest, appendUTMToUrl } from '@/lib/utils/attribution';

const logger = createLogger({ module: 'SmartLinkRedirect' });

/**
 * Where a visitor goes when the link does not work.
 *
 * Every one of these paths used to be `redirect('/')` — the platform's own
 * marketing homepage — so a client who clicked an expired link from a business
 * they know was dropped, without explanation, onto a B2B software site.
 */
function unavailable(request: NextRequest, reason: 'invalid' | 'notfound' | 'inactive' | 'error', userCode?: string | null) {
  const url = new URL('/go/unavailable', request.url);
  url.searchParams.set('reason', reason);
  // Only present for `inactive`, where the link still identifies its owner and
  // the screen can therefore be branded and offer the links that do work.
  if (userCode) url.searchParams.set('u', userCode);
  return NextResponse.redirect(url, { status: 302 });
}

interface RouteParams {
  params: Promise<{ code: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { code } = await params;
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId, code });

  requestLogger.info({ code }, 'Smart link redirect request received');

  try {
    // Validate code format (alphanumeric, 6-10 chars)
    if (!code || !/^[a-z0-9]{6,10}$/i.test(code)) {
      requestLogger.warn({ code }, 'Invalid smart link code format');
      return unavailable(request, 'invalid');
    }

    // Find the smart link
    const result = await smartLinkRepository.findByCode(code);
    requestLogger.info({ code, found: !!result.data, error: !!result.error }, 'Smart link lookup result');

    if (result.error || !result.data) {
      requestLogger.warn({ code }, 'Smart link not found');
      return unavailable(request, 'notfound');
    }

    const smartLink = result.data;

    // Check if link is active
    if (!smartLink.is_active) {
      requestLogger.info({ code, linkId: smartLink.id }, 'Smart link is inactive');
      // The link is off, but we know whose it is — so the client can be sent to
      // the business's working booking and contact pages instead of nowhere.
      const { data: ownerCode } = await businessProfileRepository.getUserCode(smartLink.user_id);
      return unavailable(request, 'inactive', ownerCode);
    }

    // Build attribution data from request
    const attribution = buildAttributionFromRequest(request, {
      captureChannel: 'smart_link',
      smartLinkId: smartLink.id,
      smartLinkCode: code
    });

    // Record the click
    const clickResult = await smartLinkRepository.recordClick(smartLink.id, {
      ipHash: attribution.ip_hash,
      userAgent: attribution.user_agent,
      referer: attribution.referrer_url,
      deviceType: attribution.device_type,
      sessionId: attribution.session_id
    });

    if (clickResult.error) {
      requestLogger.warn({ err: clickResult.error }, 'Failed to record click');
      // Continue with redirect even if click tracking fails
    }

    // Build destination URL with UTM parameters
    let destinationUrl = smartLink.destination_url;

    // Fix userCode in destination URL if it contains /c/ path
    // This handles legacy smart links created with wrong userCodes
    if (destinationUrl.includes('/c/')) {
      requestLogger.info({ destinationUrl, smartLinkUserId: smartLink.user_id }, 'Checking userCode in destination URL');
      const userCodeResult = await businessProfileRepository.getUserCode(smartLink.user_id);
      requestLogger.info({ actualUserCode: userCodeResult.data, error: !!userCodeResult.error }, 'getUserCode result');
      if (userCodeResult.data) {
        const actualUserCode = userCodeResult.data;
        // Fix any /c/[wrongCode]/ patterns - match userCode followed by / or ?
        const fixedUrl = destinationUrl.replace(/\/c\/[a-z0-9]+(?=\/|\?)/i, `/c/${actualUserCode}`);
        requestLogger.info({ originalUrl: destinationUrl, fixedUrl, actualUserCode, urlChanged: fixedUrl !== destinationUrl }, 'UserCode replacement result');
        if (fixedUrl !== destinationUrl) {
          destinationUrl = fixedUrl;
        }
      }
    }

    // Append UTM parameters from the smart link configuration
    const utmParams: Record<string, string> = {};
    if (smartLink.source) utmParams.utm_source = smartLink.source;
    if (smartLink.medium) utmParams.utm_medium = smartLink.medium;
    if (smartLink.campaign) utmParams.utm_campaign = smartLink.campaign;
    if (smartLink.content) utmParams.utm_content = smartLink.content;

    // Add session_id for conversion tracking
    if (attribution.session_id) {
      utmParams._sid = attribution.session_id;
    }

    // Append UTM params to destination URL
    if (Object.keys(utmParams).length > 0) {
      destinationUrl = appendUTMToUrl(destinationUrl, utmParams);
    }

    requestLogger.info(
      {
        code,
        linkId: smartLink.id,
        destination: smartLink.destination_type,
        clickId: clickResult.data?.id
      },
      'Smart link redirect'
    );

    // Perform the redirect
    // Handle both absolute URLs and relative paths
    const redirectUrl = destinationUrl.startsWith('http')
      ? destinationUrl
      : new URL(destinationUrl, request.url).toString();
    return NextResponse.redirect(redirectUrl, { status: 302 });
  } catch (error) {
    requestLogger.error({ err: error, code }, 'Smart link redirect failed');
    return unavailable(request, 'error');
  }
}
