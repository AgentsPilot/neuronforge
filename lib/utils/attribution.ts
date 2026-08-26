/**
 * Attribution Utility
 * Extracts and validates UTM parameters and other attribution data
 * Used by conversion endpoints to track lead sources
 */

import { createLogger } from '@/lib/logger';
import crypto from 'crypto';

const logger = createLogger({ module: 'Attribution' });

/**
 * Lead source metadata structure stored in crm_contacts.source_metadata
 */
export interface LeadSourceMetadata {
  // Capture context
  capture_channel: 'booking' | 'form' | 'payment' | 'smart_link' | 'website' | 'manual';
  capture_page_url?: string;
  capture_timestamp?: string;

  // UTM parameters
  utm_source?: string;      // e.g., 'instagram', 'google', 'newsletter'
  utm_medium?: string;      // e.g., 'social', 'cpc', 'email'
  utm_campaign?: string;    // e.g., 'summer-sale-2026'
  utm_content?: string;     // e.g., 'bio-link', 'post-42'
  utm_term?: string;        // for paid search keywords

  // Smart Link tracking
  smart_link_id?: string;
  smart_link_code?: string;
  smart_link_name?: string;

  // Session tracking
  session_id?: string;

  // Referrer
  referrer_url?: string;
  referrer_domain?: string;

  // Device info
  device_type?: 'desktop' | 'mobile' | 'tablet';
  user_agent?: string;
}

/**
 * Extract UTM parameters from URL search params or request
 */
export function extractUTMParams(
  urlOrParams: URL | URLSearchParams | string | null
): Pick<LeadSourceMetadata, 'utm_source' | 'utm_medium' | 'utm_campaign' | 'utm_content' | 'utm_term'> {
  if (!urlOrParams) {
    return {};
  }

  let params: URLSearchParams;

  if (typeof urlOrParams === 'string') {
    try {
      const url = new URL(urlOrParams);
      params = url.searchParams;
    } catch {
      // Maybe it's just query string
      params = new URLSearchParams(urlOrParams);
    }
  } else if (urlOrParams instanceof URL) {
    params = urlOrParams.searchParams;
  } else {
    params = urlOrParams;
  }

  const result: Pick<LeadSourceMetadata, 'utm_source' | 'utm_medium' | 'utm_campaign' | 'utm_content' | 'utm_term'> = {};

  // Extract and sanitize UTM params
  const utmSource = params.get('utm_source');
  const utmMedium = params.get('utm_medium');
  const utmCampaign = params.get('utm_campaign');
  const utmContent = params.get('utm_content');
  const utmTerm = params.get('utm_term');

  if (utmSource) result.utm_source = sanitizeParam(utmSource);
  if (utmMedium) result.utm_medium = sanitizeParam(utmMedium);
  if (utmCampaign) result.utm_campaign = sanitizeParam(utmCampaign);
  if (utmContent) result.utm_content = sanitizeParam(utmContent);
  if (utmTerm) result.utm_term = sanitizeParam(utmTerm);

  return result;
}

/**
 * Extract referrer information
 */
export function extractReferrer(
  refererHeader: string | null
): Pick<LeadSourceMetadata, 'referrer_url' | 'referrer_domain'> {
  if (!refererHeader) {
    return {};
  }

  try {
    const url = new URL(refererHeader);
    return {
      referrer_url: refererHeader,
      referrer_domain: url.hostname.replace('www.', '')
    };
  } catch {
    return {};
  }
}

/**
 * Detect device type from user agent
 */
export function detectDeviceType(userAgent: string | null): 'desktop' | 'mobile' | 'tablet' {
  if (!userAgent) return 'desktop';

  const ua = userAgent.toLowerCase();

  // Tablet detection (before mobile, as tablets often have 'mobile' in UA)
  if (
    ua.includes('ipad') ||
    ua.includes('tablet') ||
    (ua.includes('android') && !ua.includes('mobile'))
  ) {
    return 'tablet';
  }

  // Mobile detection
  if (
    ua.includes('mobile') ||
    ua.includes('iphone') ||
    ua.includes('ipod') ||
    ua.includes('android') ||
    ua.includes('webos') ||
    ua.includes('blackberry')
  ) {
    return 'mobile';
  }

  return 'desktop';
}

/**
 * Generate a session ID for tracking conversion from click to completion
 */
export function generateSessionId(): string {
  return crypto.randomUUID();
}

/**
 * Hash an IP address for privacy-conscious unique visitor counting
 */
export function hashIP(ip: string, salt?: string): string {
  const data = salt ? `${ip}:${salt}` : ip;
  return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
}

/**
 * Get client IP from request headers (handles proxies)
 */
export function getClientIP(headers: Headers): string | null {
  // Check various headers in order of preference
  const xForwardedFor = headers.get('x-forwarded-for');
  if (xForwardedFor) {
    // Take the first IP in the chain
    return xForwardedFor.split(',')[0].trim();
  }

  const xRealIP = headers.get('x-real-ip');
  if (xRealIP) {
    return xRealIP;
  }

  const cfConnectingIP = headers.get('cf-connecting-ip');
  if (cfConnectingIP) {
    return cfConnectingIP;
  }

  return null;
}

/**
 * Extended attribution metadata including click tracking fields
 */
export interface AttributionWithTracking extends LeadSourceMetadata {
  ip_hash?: string;
}

/**
 * Build complete attribution metadata from a request
 */
export function buildAttributionFromRequest(
  request: Request,
  options: {
    captureChannel: LeadSourceMetadata['capture_channel'];
    pageUrl?: string;
    smartLinkId?: string;
    smartLinkCode?: string;
    smartLinkName?: string;
    sessionId?: string;
    generateSessionId?: boolean;  // Auto-generate session ID if not provided
  }
): AttributionWithTracking {
  const url = new URL(request.url);
  const headers = request.headers;

  // Extract UTM params from URL
  const utmParams = extractUTMParams(url);

  // Extract referrer
  const refererInfo = extractReferrer(headers.get('referer'));

  // Detect device
  const userAgent = headers.get('user-agent');
  const deviceType = detectDeviceType(userAgent);

  // Get client IP and hash it
  const clientIP = getClientIP(headers);
  const ipHash = clientIP ? hashIP(clientIP, new Date().toDateString()) : undefined;

  // Session ID - use provided, check URL param, or generate
  let sessionId = options.sessionId;
  if (!sessionId) {
    // Check for _sid in URL (from smart link redirect)
    const urlSessionId = url.searchParams.get('_sid');
    sessionId = urlSessionId || (options.generateSessionId !== false ? generateSessionId() : undefined);
  }

  const metadata: AttributionWithTracking = {
    capture_channel: options.captureChannel,
    capture_page_url: options.pageUrl || url.pathname,
    capture_timestamp: new Date().toISOString(),
    ...utmParams,
    ...refererInfo,
    device_type: deviceType,
    user_agent: userAgent || undefined,
    ip_hash: ipHash,
    session_id: sessionId
  };

  // Add smart link info if provided
  if (options.smartLinkId) metadata.smart_link_id = options.smartLinkId;
  if (options.smartLinkCode) metadata.smart_link_code = options.smartLinkCode;
  if (options.smartLinkName) metadata.smart_link_name = options.smartLinkName;

  // Log for debugging
  logger.debug(
    {
      channel: metadata.capture_channel,
      hasUTM: !!metadata.utm_source,
      hasReferrer: !!metadata.referrer_domain,
      hasSmartLink: !!metadata.smart_link_id,
      hasSession: !!metadata.session_id
    },
    'Built attribution metadata'
  );

  return metadata;
}

/**
 * Merge existing metadata with new metadata
 * Preserves original capture info but updates with new UTM/referrer data
 */
export function mergeAttributionMetadata(
  existing: Partial<LeadSourceMetadata> | null,
  incoming: Partial<LeadSourceMetadata>
): LeadSourceMetadata {
  // Start with existing data
  const merged: LeadSourceMetadata = {
    capture_channel: existing?.capture_channel || incoming.capture_channel || 'manual',
    ...existing,
    ...incoming
  };

  // Preserve original capture timestamp if it exists
  if (existing?.capture_timestamp) {
    merged.capture_timestamp = existing.capture_timestamp;
  }

  return merged;
}

/**
 * Build UTM query string from metadata
 * Used when redirecting through smart links
 */
export function buildUTMQueryString(metadata: Partial<LeadSourceMetadata>): string {
  const params = new URLSearchParams();

  if (metadata.utm_source) params.set('utm_source', metadata.utm_source);
  if (metadata.utm_medium) params.set('utm_medium', metadata.utm_medium);
  if (metadata.utm_campaign) params.set('utm_campaign', metadata.utm_campaign);
  if (metadata.utm_content) params.set('utm_content', metadata.utm_content);
  if (metadata.utm_term) params.set('utm_term', metadata.utm_term);

  return params.toString();
}

/**
 * Add attribution params to a URL
 */
export function addAttributionToURL(
  baseUrl: string,
  metadata: Partial<LeadSourceMetadata>,
  sessionId?: string
): string {
  try {
    const url = new URL(baseUrl);

    // Add UTM params
    if (metadata.utm_source) url.searchParams.set('utm_source', metadata.utm_source);
    if (metadata.utm_medium) url.searchParams.set('utm_medium', metadata.utm_medium);
    if (metadata.utm_campaign) url.searchParams.set('utm_campaign', metadata.utm_campaign);
    if (metadata.utm_content) url.searchParams.set('utm_content', metadata.utm_content);
    if (metadata.utm_term) url.searchParams.set('utm_term', metadata.utm_term);

    // Add session ID for conversion tracking
    if (sessionId) url.searchParams.set('_sid', sessionId);

    return url.toString();
  } catch {
    // If URL is invalid, return as-is
    return baseUrl;
  }
}

/**
 * Append UTM parameters to a URL (used by smart link redirect)
 * Does not overwrite existing UTM params in the URL
 */
export function appendUTMToUrl(
  baseUrl: string,
  params: Record<string, string>
): string {
  try {
    const url = new URL(baseUrl);

    // Add params only if they don't already exist
    for (const [key, value] of Object.entries(params)) {
      if (value && !url.searchParams.has(key)) {
        url.searchParams.set(key, value);
      }
    }

    return url.toString();
  } catch {
    // If URL is invalid, try to append as query string
    const separator = baseUrl.includes('?') ? '&' : '?';
    const queryString = Object.entries(params)
      .filter(([, v]) => v)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    return queryString ? `${baseUrl}${separator}${queryString}` : baseUrl;
  }
}

/**
 * Sanitize a parameter value (prevent injection, limit length)
 */
function sanitizeParam(value: string): string {
  return value
    .slice(0, 100)
    .replace(/[<>'"&]/g, '')
    .trim();
}

/**
 * Check if attribution metadata has any meaningful data
 */
export function hasAttribution(metadata: Partial<LeadSourceMetadata> | null | undefined): boolean {
  if (!metadata) return false;

  return !!(
    metadata.utm_source ||
    metadata.utm_medium ||
    metadata.utm_campaign ||
    metadata.smart_link_id ||
    metadata.referrer_domain
  );
}
