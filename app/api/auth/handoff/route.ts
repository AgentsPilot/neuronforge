/**
 * Mint a single-use code for a completed sign-in on the marketing origin.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The marketing site signs someone in, then needs the app — a different origin,
 * with its own browser storage — to know about it. It used to do that by putting
 * the access AND refresh tokens in the URL fragment of the landing page.
 *
 * Now it calls here with its access token in the Authorization header (a header,
 * not a URL, so it reaches no history and no referrer), gets back a code that is
 * good for sixty seconds and one use, and sends the person to
 * `/auth/handoff?code=…`. The code is worthless once redeemed, so the same URL
 * replayed from history does nothing.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * THE ACCOUNT COMES FROM THE TOKEN, NEVER FROM THE REQUEST. The body is not
 * read. A caller who could name a user id here could mint a sign-in for anyone.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { marketingOrigin } from '@/lib/utils/origins';

const logger = createLogger({ module: 'AuthHandoffAPI' });

/** Sixty seconds: long enough for a redirect, short enough to be useless if leaked. */
const CODE_TTL_SECONDS = 60;

/*
 * Exactly one origin may call this, and it is resolved rather than written —
 * `*` would let any page on the internet mint a sign-in from a token it had
 * somehow obtained, and a hardcoded origin would be the sixth domain literal
 * this codebase had to untangle.
 */
function corsHeaders(request: NextRequest): Record<string, string> {
  const allowed = marketingOrigin();
  const origin = request.headers.get('origin');

  return {
    'Access-Control-Allow-Origin': origin === allowed ? allowed : 'null',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type, x-correlation-id',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });
  const headers = corsHeaders(request);

  try {
    const origin = request.headers.get('origin');
    if (origin && origin !== marketingOrigin()) {
      requestLogger.warn('Handoff requested from an unexpected origin');
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403, headers });
    }

    const authorization = request.headers.get('authorization') || '';
    const accessToken = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';

    if (!accessToken) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401, headers });
    }

    /*
     * Verified against Supabase, not decoded here.
     *
     * A JWT read locally proves only that someone produced a well-formed
     * string. This asks the issuer, so a revoked or forged token fails.
     */
    const anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const { data: userData, error: userError } = await anon.auth.getUser(accessToken);

    if (userError || !userData?.user) {
      requestLogger.warn('Handoff token did not verify');
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401, headers });
    }

    const code = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + CODE_TTL_SECONDS * 1000).toISOString();

    // Service role: RLS grants this table to nobody, deliberately (see migration).
    const { error: insertError } = await supabaseServer.from('auth_handoff_codes').insert({
      code,
      user_id: userData.user.id,
      expires_at: expiresAt,
    });

    if (insertError) throw insertError;

    requestLogger.info({ userId: userData.user.id }, 'Minted an auth handoff code');

    return NextResponse.json({ success: true, code, expiresAt }, { headers });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to mint an auth handoff code');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500, headers }
    );
  }
}
