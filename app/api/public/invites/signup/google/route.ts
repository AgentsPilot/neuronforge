/**
 * Complete a champion signup from an invite WITH GOOGLE (invite-only signup,
 * Slice 3b; FR-11 to FR-13, D-1 to D-11, SA R-1, R-2, R-5, R-6, R-11).
 *
 *   POST /api/public/invites/signup/google   { token, idToken, nonce }
 *
 * PUBLIC BY DESIGN. The body is exactly the invite token, Google's ID token and
 * the RAW nonce whose SHA-256 the page gave Google (L-1): the email, the grant
 * and the account id come from the server, and any other key is a 400
 * (`.strict()`, AC-6).
 *
 * The flow is `completeGoogleSignup` in `lib/business-os/invites/inviteRedemption.ts`:
 * the same checks as the code path, then the Google proof (verified signature,
 * our client id as `aud`, the nonce, a fresh `iat`, `email_verified`, an address
 * Google is authoritative for), then the email lock, then the SAME claim →
 * create → finalise path as `/complete`, with a password-less account. The
 * server mints no session (D-1): on 200 the browser calls Supabase's
 * `signInWithIdToken` with the same token, which also links the Google
 * identity to the new account.
 *
 * INERT UNTIL CONFIGURED (D-9, R-6): with `NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID`
 * unset this answers 404 before reading the body or the session.
 *
 * Answers (headers `no-store` and `no-referrer` on every one):
 *   200 { redirectTo }                             redeemed. No email: the page
 *                                                  already shows the masked one.
 *   200 { state: 'not_recognised' }                byte-identical to validate (AC-2)
 *   400 invalid_request | google_token_invalid
 *   404 google_signin_not_configured
 *   409 signed_in | existing_account | used | revoked | expired | unavailable |
 *       paid_invites_not_available | signup_in_progress | try_again |
 *       google_email_unverified | google_use_code | google_email_mismatch
 *   503 unavailable_try_again                      incl. Google's certificates
 *                                                  unreachable (R-5)
 *
 * Logs: correlation id, outcome, invite and account ids. Never the invite
 * token, the ID token, the nonce, either email or the Google `sub`, and never
 * a Zod issue about the body (R-11). The verifier never throws (R-1), so
 * nothing Google-derived can reach the catch-all below.
 */

import { NextRequest, NextResponse } from 'next/server';

import { googleSignInClientId } from '@/lib/business-os/invites/googleSignInConfig';
import { completeGoogleSignup } from '@/lib/business-os/invites/inviteRedemption';
import { completeGoogleSignupSchema } from '@/lib/business-os/invites/inviteSchemas';
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
// Must stay below the claim lease (INVITE_CLAIM_LEASE_SECONDS, SA D-4), so a
// live request never sees its own claim lapse. Next.js reads this statically;
// `signupCodePolicy.ts` holds the same number and a test pins that they agree.
export const maxDuration = 60;

const logger = createLogger({ module: 'PublicInviteSignupGoogleAPI' });

/** Where a new champion lands (FR-13). */
const LANDING = '/onboarding-chat';

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  // D-9: switched off entirely until the dedicated client id is configured.
  if (!googleSignInClientId()) {
    return NextResponse.json(
      { success: false, error: 'google_signin_not_configured' },
      { status: 404, headers: SIGNUP_RESPONSE_HEADERS }
    );
  }

  const body = await request.json().catch(() => undefined);
  const parsed = completeGoogleSignupSchema.safeParse(body);
  if (!parsed.success) {
    // R-11: nothing about the body is logged; its fields are bearer secrets.
    return NextResponse.json({ success: false, error: 'invalid_request' }, { status: 400, headers: SIGNUP_RESPONSE_HEADERS });
  }

  try {
    const user = await getUser().catch((err: unknown) => {
      // SA N-2 (1b): an auth lookup that fails is treated as signed out (the
      // account created is always a NEW one, never the signed-in one), but it is said.
      requestLogger.warn({ err }, 'Session check failed; treating the visitor as signed out');
      return null;
    });
    if (user) {
      requestLogger.info({ outcome: 'signed_in' }, 'Google signup refused: a session is present');
      return NextResponse.json({ success: false, error: 'signed_in' }, { status: 409, headers: SIGNUP_RESPONSE_HEADERS });
    }

    const outcome = await completeGoogleSignup(parsed.data, buildRedemptionDeps({ logger: requestLogger, correlationId, request }));
    await flushRedemptionAudit(requestLogger);

    if (outcome.ok) {
      requestLogger.info({ outcome: 'redeemed', method: 'google', inviteId: outcome.inviteId, accountId: outcome.accountId }, 'Signup completed');
      return NextResponse.json({ success: true, data: { redirectTo: LANDING } }, { status: 200, headers: SIGNUP_RESPONSE_HEADERS });
    }

    const { status, body: answer } = refusalToHttp(outcome);
    requestLogger.info({ outcome: outcome.kind === 'refused' ? outcome.error : outcome.kind, method: 'google' }, 'Signup refused');
    return NextResponse.json(answer, { status, headers: SIGNUP_RESPONSE_HEADERS });
  } catch (error) {
    requestLogger.error({ err: error, outcome: 'error', method: 'google' }, 'Google signup failed');
    return NextResponse.json({ success: false, error: 'unavailable_try_again' }, { status: 503, headers: SIGNUP_RESPONSE_HEADERS });
  }
}
