/**
 * Subdomain Check API
 * GET - Check if a subdomain is available
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { WebsitePageRepository } from '@/lib/repositories/WebsitePageRepository';
import {
  validatePrefix,
  normalizePrefix,
  PREFIX_REJECTION_MESSAGE,
} from '@/lib/business-os/reservedPrefixes';
import { publicSiteUrl } from '@/lib/utils/origins';

const logger = createLogger({ module: 'SubdomainCheckAPI' });

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const subdomain = searchParams.get('subdomain');

    if (!subdomain) {
      return NextResponse.json(
        { success: false, error: 'Subdomain parameter is required' },
        { status: 400 }
      );
    }

    /*
     * Shape and reserved names come from `reservedPrefixes.ts`, the same module
     * middleware and the write path use.
     *
     * This route used to carry its own copy of both, and the reserved list here
     * disagreed with middleware's: `preview` was absent here and present there,
     * so this endpoint reported it AVAILABLE while middleware would refuse to
     * serve it — a business could take the name and end up with a permanently
     * unreachable site, with no error raised anywhere along the way.
     */
    const verdict = validatePrefix(subdomain);
    if (!verdict.ok) {
      return NextResponse.json({
        success: true,
        available: false,
        reason: PREFIX_REJECTION_MESSAGE[verdict.reason],
      });
    }

    const normalized = normalizePrefix(subdomain);

    const pageRepo = new WebsitePageRepository(supabaseServer);
    const result = await pageRepo.checkSubdomainAvailable(normalized);

    if (result.error) {
      throw result.error;
    }

    return NextResponse.json({
      success: true,
      available: result.data,
      subdomain: normalized,
      // The address it would actually be served at, from the one resolver —
      // this line used to read `https://${subdomain}.agentpilot.io`.
      url: result.data ? publicSiteUrl(normalized) : null
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to check subdomain');
    return NextResponse.json(
      { success: false, error: 'Failed to check subdomain' },
      { status: 500 }
    );
  }
}
