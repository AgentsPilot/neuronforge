/**
 * Redeem a handoff code for a session on THIS origin.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Consumes the code atomically — `claim_auth_handoff_code` is a single
 * `UPDATE … WHERE used_at IS NULL AND expires_at > now() RETURNING`, so two
 * requests racing on one code cannot both win — and returns a `token_hash` the
 * browser exchanges for a session with `verifyOtp`.
 *
 * WHY A TOKEN HASH RATHER THAN THE TOKENS THEMSELVES: the point of this whole
 * change is that a long-lived refresh token never travels anywhere it can be
 * replayed. The hash is minted by Supabase for this one exchange, so the
 * response is no more reusable than the code was.
 *
 * Same-origin only: this is called by `/auth/handoff` on this app. It carries no
 * CORS headers, so a browser on another origin cannot read its response.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ module: 'AuthHandoffRedeemAPI' });

const RedeemSchema = z.object({
  // A uuid, because that is what the minting route generates. Anything else is
  // not a code this system issued, and is refused before it reaches the database.
  code: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  /*
   * One message for every failure, and one status.
   *
   * Unknown, already used, expired and malformed are deliberately
   * indistinguishable: telling them apart tells someone probing codes which
   * ones exist and which have already been spent.
   */
  const refuse = () =>
    NextResponse.json({ success: false, error: 'This sign-in link is no longer valid' }, { status: 400 });

  try {
    const body = await request.json().catch(() => null);
    const parsed = RedeemSchema.safeParse(body);
    if (!parsed.success) return refuse();

    const { data: claimed, error: claimError } = await supabaseServer.rpc(
      'claim_auth_handoff_code',
      { p_code: parsed.data.code }
    );

    if (claimError) throw claimError;

    const userId: string | undefined = Array.isArray(claimed)
      ? claimed[0]?.claimed_user_id
      : undefined;

    if (!userId) {
      requestLogger.warn('Handoff code was unknown, spent or expired');
      return refuse();
    }

    const { data: userRecord, error: lookupError } =
      await supabaseServer.auth.admin.getUserById(userId);

    if (lookupError || !userRecord?.user?.email) {
      requestLogger.error({ err: lookupError, userId }, 'Redeemed a code for a user with no email');
      return refuse();
    }

    /*
     * Generates the link without sending mail, which is what the admin API does
     * — this is not an email flow, it is the only supported way to mint a
     * session for a user we have already authenticated by another means.
     */
    const { data: link, error: linkError } = await supabaseServer.auth.admin.generateLink({
      type: 'magiclink',
      email: userRecord.user.email,
    });

    if (linkError || !link?.properties?.hashed_token) {
      requestLogger.error({ err: linkError, userId }, 'Could not mint a session for a valid code');
      return refuse();
    }

    requestLogger.info({ userId }, 'Redeemed an auth handoff code');

    return NextResponse.json({
      success: true,
      tokenHash: link.properties.hashed_token,
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to redeem an auth handoff code');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
