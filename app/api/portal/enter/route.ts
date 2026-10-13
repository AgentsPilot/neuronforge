// app/api/portal/enter/route.ts
// Exchanges a booking link's token for a short-lived grant cookie, so the
// credential can leave the address bar.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { createLogger } from '@/lib/logger';
import { RATE_LIMITS, rateLimit, tooManyRequests } from '@/lib/security/rateLimit';
import { cookieValue, resolvePortalAccess } from '@/lib/security/portalAccess';
import {
  PORTAL_GRANT_COOKIE,
  portalGrantCookieOptions,
  readGrants,
  withGrant,
} from '@/lib/security/portalGrant';

const logger = createLogger({ module: 'API', service: 'PortalEnter' });

const EnterSchema = z.object({
  /* The token from the link. In a POST BODY, never a query string: a query
     would put it straight back into a URL, in the request line of every access
     log between us and the client — the thing this endpoint exists to stop. */
  token: z.string().min(1).max(4096),
});

/**
 * Trade a link for a grant.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * A booking link carries its credential in the path, because an email can carry
 * nothing else. Once the client has arrived, that is pure exposure: browser
 * history, a pasted address bar, a screenshot, a shared laptop, every proxy log
 * on the way. `Referer` and indexing are already closed; the address itself is
 * what remains.
 *
 * The portal calls this on arrival, gets back the booking id, and rewrites its
 * own address to `/book/manage/<booking id>` — which grants nothing on its own.
 * This is the shape `/invite` already uses, adapted so that server-side
 * rendering survives: the token still reaches the server once, which is the
 * price of keeping the portal branded and right-to-left on first paint.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DELIBERATELY REPEATABLE
 *
 * Exchanging does NOT consume the token. Mail scanners, Outlook Safe Links and
 * link previewers all fetch URLs before a human ever sees them; a single-use
 * exchange would be burned by a scanner and hand the actual client a dead link.
 * The token's own expiry is what bounds it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  /* Throttled like every other unauthenticated route; a rejected token counts
     against the tighter failure budget below. */
  const throttle = await rateLimit(request, 'portal-enter', RATE_LIMITS.read);
  if (!throttle.allowed) return tooManyRequests(RATE_LIMITS.read.windowSeconds);

  const parsed = EnterSchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  }

  const access = resolvePortalAccess(parsed.data.token, request.headers.get('cookie'));

  /*
   * Only a TOKEN may create a grant. A grant cookie presented here must not
   * mint another one, or holding any grant would be a way to extend every
   * grant indefinitely and the two-hour bound would mean nothing.
   */
  if (!access || access.via !== 'token') {
    const failures = await rateLimit(request, 'portal-enter', RATE_LIMITS.read, 'failure');
    if (!failures.allowed) return tooManyRequests(RATE_LIMITS.read.windowSeconds);

    requestLogger.warn('Portal grant refused: no valid link');
    return NextResponse.json(
      { success: false, error: 'Invalid or expired link' },
      { status: 401 }
    );
  }

  const value = withGrant(
    readGrants(cookieValue(request.headers.get('cookie'), PORTAL_GRANT_COOKIE)),
    access.bookingId,
    access.email
  );

  /*
   * The booking id goes back so the page can rewrite its own address to it.
   * Nothing else: this endpoint says who you may be, not what the booking is.
   */
  const response = NextResponse.json({ success: true, bookingId: access.bookingId });

  response.cookies.set(PORTAL_GRANT_COOKIE, value, portalGrantCookieOptions());

  requestLogger.info({ bookingId: access.bookingId }, 'Portal grant issued');

  return response;
}
