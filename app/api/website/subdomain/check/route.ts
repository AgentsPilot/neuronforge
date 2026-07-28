/**
 * Subdomain Check API
 * GET - Check if a subdomain is available
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { WebsitePageRepository } from '@/lib/repositories/WebsitePageRepository';

const logger = createLogger({ module: 'SubdomainCheckAPI' });

// Reserved subdomains that cannot be used
const RESERVED_SUBDOMAINS = [
  'www', 'app', 'api', 'admin', 'dashboard', 'mail', 'email',
  'help', 'support', 'docs', 'blog', 'status', 'dev', 'staging',
  'test', 'demo', 'cdn', 'assets', 'static', 'media', 'images',
  'auth', 'login', 'signup', 'register', 'account', 'billing',
  'payment', 'checkout', 'cart', 'shop', 'store', 'marketplace'
];

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

    // Validate subdomain format
    const subdomainRegex = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;
    if (!subdomainRegex.test(subdomain)) {
      return NextResponse.json({
        success: true,
        available: false,
        reason: 'Invalid format. Use 3-30 lowercase letters, numbers, and hyphens. Must start and end with a letter or number.'
      });
    }

    // Check reserved subdomains
    if (RESERVED_SUBDOMAINS.includes(subdomain)) {
      return NextResponse.json({
        success: true,
        available: false,
        reason: 'This subdomain is reserved'
      });
    }

    const pageRepo = new WebsitePageRepository(supabaseServer);
    const result = await pageRepo.checkSubdomainAvailable(subdomain);

    if (result.error) {
      throw result.error;
    }

    return NextResponse.json({
      success: true,
      available: result.data,
      subdomain,
      url: result.data ? `https://${subdomain}.agentpilot.io` : null
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to check subdomain');
    return NextResponse.json(
      { success: false, error: 'Failed to check subdomain' },
      { status: 500 }
    );
  }
}
