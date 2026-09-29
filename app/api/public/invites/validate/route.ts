/**
 * The public invite check (invite-only signup, Slice 0; FR-8, FR-10, C-4).
 *
 *   POST /api/public/invites/validate   { token }
 *
 * PUBLIC BY DESIGN: the visitor has no account yet, and holding the token is
 * the authorisation. Outside `/api/admin/**` on purpose (C-4).
 *
 * ── Why POST, and where the token comes from (T-7) ──────────────────────────
 * The page reads the token from the URL fragment, which never reaches a server
 * or an access log, strips it from the address bar, and sends it here in the
 * body. It is never in a URL, a query string or a Referer.
 *
 * ── One answer for every bad token (AC-2, SA ruling F-2) ────────────────────
 * Any well-formed body gets 200. A malformed, unknown or wrong token gets the
 * byte-identical `{ state: 'not_recognised' }` with the same headers. 400 is
 * only for a body that is not `{ token: string }`, which says nothing about any
 * token. 503 means the lookup itself failed and the visitor should try again.
 *
 * ── An email that already has an account (Slice 1a, FR-8a) ─────────────────
 * For a matched, pending invite whose email already has an account, the answer
 * is `existing_account`: the page sends the person to the normal sign-in page.
 * Nothing authenticates anyone here, and nothing is burned or changed (BQ-7).
 * The first such open is audited (`BOS_INVITE_OPENED_BY_EXISTING_ACCOUNT`,
 * anonymous actor, the invite id only), then flushed before the response,
 * because a serverless instance can freeze after it (WC-7).
 *
 * ── Logs ────────────────────────────────────────────────────────────────────
 * The correlation id and the outcome; the invite id only on a match. Never the
 * token, never its hash. (Pino also redacts `token`, as a backstop only.)
 *
 * Per-IP rate limiting is an ops follow-up (a Vercel Firewall rule), not an
 * in-memory limiter here, which would not survive serverless scaling (C-4).
 */

import { NextRequest, NextResponse } from 'next/server';

import { AUDIT_EVENTS } from '@/lib/audit/events';
import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';
import { validateInviteBodySchema } from '@/lib/business-os/invites/inviteSchemas';
import { viewInviteByToken } from '@/lib/business-os/invites/publicInviteView';
import { createLogger } from '@/lib/logger';
import { authAccountRepository } from '@/lib/repositories/AuthAccountRepository';
import { businessOsInviteRepository } from '@/lib/repositories/BusinessOsInviteRepository';
import { AuditTrailService } from '@/lib/services/AuditTrailService';

// Node for node:crypto; dynamic because every answer depends on the request
// and must never be cached (C-4, R-6).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const logger = createLogger({ module: 'PublicInviteValidateAPI' });
const auditTrail = AuditTrailService.getInstance();

/** On every response, success or not. */
const RESPONSE_HEADERS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
} as const;

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  const body = await request.json().catch(() => undefined);
  const parsed = validateInviteBodySchema.safeParse(body);
  if (!parsed.success) {
    requestLogger.info({ outcome: 'invalid_request' }, 'Invite check refused: body shape');
    return NextResponse.json(
      { success: false, error: 'invalid_request' },
      { status: 400, headers: RESPONSE_HEADERS }
    );
  }

  try {
    const outcome = await viewInviteByToken(parsed.data.token, {
      repository: businessOsInviteRepository,
      accounts: authAccountRepository,
      config: getEntitlementConfig(),
      now: new Date(),
      logger: requestLogger,
    });

    if (!outcome.ok) {
      requestLogger.error({ outcome: 'lookup_failed' }, 'Invite check could not read the invite');
      return NextResponse.json(
        { success: false, error: 'unavailable_try_again' },
        { status: 503, headers: RESPONSE_HEADERS }
      );
    }

    requestLogger.info(
      outcome.inviteId
        ? { outcome: outcome.response.state, inviteId: outcome.inviteId }
        : { outcome: outcome.response.state },
      'Invite checked'
    );

    if (outcome.firstOpenByExistingAccount && outcome.inviteId) {
      // Durable record: the row's `opened_by_existing_account_at`. This is the
      // investigation trail on top of it. No email, no token, no hash.
      await auditTrail
        .log({
          action: AUDIT_EVENTS.BOS_INVITE_OPENED_BY_EXISTING_ACCOUNT,
          entityType: 'business_os_invite',
          entityId: outcome.inviteId,
          userId: null,
          actorId: null,
          details: { correlationId },
          request,
        })
        .catch((err) => requestLogger.error({ err }, 'Audit failed (non-blocking)'));
      await auditTrail.flush().catch((err) => requestLogger.error({ err }, 'Audit flush failed'));
    }

    return NextResponse.json({ success: true, data: outcome.response }, { status: 200, headers: RESPONSE_HEADERS });
  } catch (error) {
    // Never the token: the error comes from the lookup or the offer, and the
    // token is not in scope of either message.
    requestLogger.error({ err: error, outcome: 'error' }, 'Invite check failed');
    return NextResponse.json(
      { success: false, error: 'unavailable_try_again' },
      { status: 503, headers: RESPONSE_HEADERS }
    );
  }
}
