/**
 * One-click unsubscribe (RFC 8058), for the mail client rather than the person.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS FOR
 *
 * Gmail and Outlook show their own "Unsubscribe" control beside the sender when
 * an email declares `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. The
 * client then POSTs to the URL in `List-Unsubscribe`, unauthenticated, and
 * expects the sender to act on it without a confirmation page.
 *
 * The transport deliberately did NOT declare one-click until now — the comment
 * on `unsubscribeUrl` says why: advertising it without an endpoint behind it is
 * worse than advertising nothing, because the client posts, nothing happens,
 * and the sender looks broken. This is that endpoint.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * UNAUTHENTICATED BY DESIGN, AND SAFE BECAUSE OF THE TOKEN.
 *
 * There is no session here and never will be: the POST comes from Google's
 * servers, not from the reader's browser. The signed token is the whole of the
 * authorisation, and it carries the only two things that matter — whose list,
 * and which address. A forged or edited one fails the signature and gets a 400.
 *
 * It is not a credential worth stealing: the worst a leaked token does is stop
 * an email its holder could have stopped by asking.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * GET REDIRECTS TO THE PAGE.
 *
 * The same URL sits in `List-Unsubscribe`, and a person clicking the link in
 * the body arrives here with a GET. They get the branded page, which does the
 * withdrawal itself and explains what still reaches them.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from 'next/server';

import { createLogger } from '@/lib/logger';
import { withdrawConsent } from '@/lib/consent/withdrawConsent';

const logger = createLogger({ module: 'API', service: 'Unsubscribe' });

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A person clicked the link in the body. Hand them the page. */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');

  if (!token) {
    return NextResponse.redirect(new URL('/consent/unsubscribe/invalid', request.nextUrl.origin));
  }

  return NextResponse.redirect(
    new URL(`/consent/unsubscribe/${encodeURIComponent(token)}`, request.nextUrl.origin)
  );
}

/** The mail client did it on their behalf. */
export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  const token = request.nextUrl.searchParams.get('token');

  if (!token) {
    return NextResponse.json({ success: false, error: 'Missing token' }, { status: 400 });
  }

  const outcome = await withdrawConsent(token, {
    via: 'list_unsubscribe',
    userAgent: request.headers.get('user-agent'),
  });

  if (!outcome.ok) {
    /* The token is never logged: it names a real person's address. */
    requestLogger.warn({ reason: outcome.reason }, 'One-click unsubscribe refused');

    /*
     * 400 for a token we cannot read, 500 for a write that failed. The
     * difference matters to the sending client: Gmail retries a 5xx and gives
     * up on a 4xx, and a failed withdrawal is exactly the case worth retrying.
     */
    return NextResponse.json(
      { success: false, error: 'Could not unsubscribe' },
      { status: outcome.reason === 'invalid' ? 400 : 500 }
    );
  }

  requestLogger.info({ alreadyOff: outcome.alreadyOff }, 'One-click unsubscribe');

  return NextResponse.json({ success: true });
}
