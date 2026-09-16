// app/api/business-os/purge/access/route.ts
//
// T30 companion — "may I see the internal Danger Zone?"
//
// The tab asks the server rather than guessing client-side. Hiding the tab is
// cosmetic; `authorizePurge` on the preview route is what actually stops the
// operation. But a tab that renders and then 403s on use is a worse experience
// than one that does not render, and a client-side guess is not a boundary.

import { NextRequest, NextResponse } from 'next/server';

import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { canUseInternalPurgeSurface } from '@/lib/business-os/purge/purgeAuthz';

const logger = createLogger({ module: 'PurgeAccessAPI' });

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const correlationId =
    request.headers.get('x-correlation-id') || crypto.randomUUID();

  try {
    const user = await getUser();
    if (!user) {
      // 200 with `allowed: false` rather than 401: this endpoint answers a
      // rendering question, and a signed-out visitor is a normal case, not an
      // error worth surfacing.
      return NextResponse.json({ success: true, data: { allowed: false, reason: 'signed_out' } });
    }

    const allowed = await canUseInternalPurgeSurface({
      id: user.id,
      email: user.email ?? null,
    });

    return NextResponse.json({
      success: true,
      data: {
        allowed,
        reason: allowed ? 'admin' : 'not_admin',
        // Echoed so the operator can confirm WHICH account the destructive
        // preview would target. On a local build pointed at production, that
        // is the single most important thing to show before anyone clicks.
        userId: user.id,
        email: user.email ?? null,
      },
    });
  } catch (error) {
    logger.child({ correlationId }).error({ err: error }, 'Purge access check failed');
    // Fail closed.
    return NextResponse.json({ success: true, data: { allowed: false, reason: 'error' } });
  }
}
