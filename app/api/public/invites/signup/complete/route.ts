/**
 * Complete a champion signup from an invite (invite-only signup, Slice 1b;
 * FR-11 to FR-13, R-1, I-1 to I-6, D-1).
 *
 *   POST /api/public/invites/signup/complete   { token, signupCode, password }
 *
 * PUBLIC BY DESIGN. The body is exactly the token, the code and the password
 * (L-1): the email, the grant and the account id come from the server, and any
 * other key is a 400 (`.strict()`, AC-6).
 *
 * The flow is `completeSignup` in `lib/business-os/invites/inviteRedemption.ts`:
 * count the attempt, compare the code, CLAIM the invite for a server-generated
 * account id, create the confirmed account with that id, then finalise (plan
 * row, lineage, redeemed stamp) in one SQL function. Nothing is ever deleted.
 *
 * Answers (headers `no-store` and `no-referrer` on every one):
 *   200 { email, redirectTo }                      the account exists; the browser
 *                                                  signs in with the password it
 *                                                  just set (F-2). The full email is
 *                                                  returned only here, after mailbox
 *                                                  proof (F-6).
 *   200 { state: 'not_recognised' }                byte-identical to validate (AC-2)
 *   400 invalid_request | weak_password
 *   409 signed_in | existing_account | used | revoked | expired | unavailable |
 *       paid_invites_not_available | signup_in_progress | code_expired |
 *       code_locked | code_invalid (+ attemptsRemaining) | try_again
 *   503 unavailable_try_again
 *
 * Logs: correlation id, outcome, invite and account ids. Never the token, the
 * hash, the code, the password or the email.
 */

import { NextRequest, NextResponse } from 'next/server';

import { completeSignup } from '@/lib/business-os/invites/inviteRedemption';
import { completeSignupSchema } from '@/lib/business-os/invites/inviteSchemas';
import {
  REDEMPTION_LANDING_PATHS,
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

const logger = createLogger({ module: 'PublicInviteSignupCompleteAPI' });

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  const body = await request.json().catch(() => undefined);
  const parsed = completeSignupSchema.safeParse(body);
  if (!parsed.success) {
    // The password's length rules are body-shape rules too: never echo the value.
    return NextResponse.json({ success: false, error: 'invalid_request' }, { status: 400, headers: SIGNUP_RESPONSE_HEADERS });
  }

  try {
    const user = await getUser().catch((err: unknown) => {
      // SA N-2: an auth lookup that fails is treated as signed out (the account
      // created is always a NEW one, never the signed-in one), but it is said.
      requestLogger.warn({ err }, 'Session check failed; treating the visitor as signed out');
      return null;
    });
    if (user) {
      requestLogger.info({ outcome: 'signed_in' }, 'Signup refused: a session is present');
      return NextResponse.json({ success: false, error: 'signed_in' }, { status: 409, headers: SIGNUP_RESPONSE_HEADERS });
    }

    const outcome = await completeSignup(parsed.data, buildRedemptionDeps({ logger: requestLogger, correlationId, request }));
    await flushRedemptionAudit(requestLogger);

    if (outcome.ok) {
      requestLogger.info({ outcome: 'redeemed', inviteId: outcome.inviteId, accountId: outcome.accountId }, 'Signup completed');
      return NextResponse.json(
        // FR-13 / FR-35: a champion to onboarding; a friend (Slice 5b) to the payment hold.
        { success: true, data: { email: outcome.email, redirectTo: REDEMPTION_LANDING_PATHS[outcome.landing] } },
        { status: 200, headers: SIGNUP_RESPONSE_HEADERS }
      );
    }

    const { status, body: answer } = refusalToHttp(outcome);
    requestLogger.info({ outcome: outcome.kind === 'refused' ? outcome.error : outcome.kind }, 'Signup refused');
    return NextResponse.json(answer, { status, headers: SIGNUP_RESPONSE_HEADERS });
  } catch (error) {
    requestLogger.error({ err: error, outcome: 'error' }, 'Signup failed');
    return NextResponse.json({ success: false, error: 'unavailable_try_again' }, { status: 503, headers: SIGNUP_RESPONSE_HEADERS });
  }
}
