/**
 * Business Web Address API
 * GET - The subdomain every public surface of this business publishes under
 *
 * Read by the website page so its Settings screen shows the address the
 * business is actually using — which may have been chosen while publishing a
 * landing page, long before any website existed. Reading it off the homepage,
 * as the page used to, showed nothing at all in that case.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { resolveBusinessSubdomain } from '@/lib/business-os/businessSubdomain';

const logger = createLogger({ module: 'BusinessSubdomainAPI' });

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const subdomain = await resolveBusinessSubdomain(user.id);
    return NextResponse.json({ success: true, subdomain });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to read the business web address');
    return NextResponse.json(
      { success: false, error: 'Failed to read the business web address' },
      { status: 500 }
    );
  }
}
