/**
 * Send a sign-up code for an invite (invite-only signup, Slice 1b; T-5, L-2).
 *
 *   POST /api/public/invites/signup/code   { token }
 *
 * PUBLIC BY DESIGN: the visitor has no account yet; holding the token is the
 * authorisation, and the code goes only to the invite's own email (the lock).
 *
 * Answers (headers `no-store` and `no-referrer` on every one):
 *   200 { codeExpiresAt, resendAvailableAt }       a code was emailed
 *   200 { state: 'not_recognised' }                byte-identical to validate (AC-2)
 *   400 invalid_request                            body shape only
 *   409 signed_in | existing_account | used | revoked | expired | unavailable |
 *       paid_invites_not_available | signup_in_progress | try_again
 *   429 code_recently_sent | code_limit_reached    with retryAfterSeconds
 *   503 unavailable_try_again | code_not_sent
 *
 * A signed-in visitor is refused before the invite is even read (L-8): an
 * invite never attaches to whoever happens to be signed in.
 *
 * Rate limiting is per invite (SA's decision, option A): one code per 60 s,
 * five per 24 h. The per-IP Vercel Firewall rule is hardening (OI-1).
 *
 * Logs: correlation id, outcome, invite id on a match. Never the token, the
 * hash, the code or the email.
 */

import { NextRequest, NextResponse } from 'next/server';

import { requestSignupCode } from '@/lib/business-os/invites/inviteRedemption';
import { signupCodeRequestSchema } from '@/lib/business-os/invites/inviteSchemas';
import {
  SIGNUP_RESPONSE_HEADERS,
  buildRedemptionDeps,
  flushRedemptionAudit,
  refusalToHttp,
} from '@/lib/business-os/invites/redemptionDeps';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const logger = createLogger({ module: 'PublicInviteSignupCodeAPI' });

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  const body = await request.json().catch(() => undefined);
  const parsed = signupCodeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'invalid_request' }, { status: 400, headers: SIGNUP_RESPONSE_HEADERS });
  }

  try {
    // L-8: a signed-in visitor must sign out first. Checked before any read.
    const user = await getUser().catch((err: unknown) => {
      // SA N-2: an auth lookup that fails is treated as signed out (the account
      // created is always a NEW one, never the signed-in one), but it is said.
      requestLogger.warn({ err }, 'Session check failed; treating the visitor as signed out');
      return null;
    });
    if (user) {
      requestLogger.info({ outcome: 'signed_in' }, 'Signup code refused: a session is present');
      return NextResponse.json({ success: false, error: 'signed_in' }, { status: 409, headers: SIGNUP_RESPONSE_HEADERS });
    }

    const outcome = await requestSignupCode(parsed.data.token, buildRedemptionDeps({ logger: requestLogger, correlationId, request }));
    await flushRedemptionAudit(requestLogger);

    if (outcome.ok) {
      requestLogger.info({ outcome: 'code_sent' }, 'Signup code requested');
      return NextResponse.json(
        { success: true, data: { codeExpiresAt: outcome.codeExpiresAt, resendAvailableAt: outcome.resendAvailableAt } },
        { status: 200, headers: SIGNUP_RESPONSE_HEADERS }
      );
    }

    const { status, body: answer } = refusalToHttp(outcome);
    requestLogger.info({ outcome: outcome.kind === 'refused' ? outcome.error : outcome.kind }, 'Signup code refused');
    return NextResponse.json(answer, { status, headers: SIGNUP_RESPONSE_HEADERS });
  } catch (error) {
    requestLogger.error({ err: error, outcome: 'error' }, 'Signup code request failed');
    return NextResponse.json({ success: false, error: 'unavailable_try_again' }, { status: 503, headers: SIGNUP_RESPONSE_HEADERS });
  }
}
