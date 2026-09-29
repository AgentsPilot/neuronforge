import 'server-only';

/**
 * Verify the Google ID token a champion presents on the invite page
 * (invite-only signup, Slice 3b; D-5, D-6, SA Q-2, Q-6, R-1, R-2, R-5, R-6).
 *
 * The token is the MAILBOX PROOF for a Google signup, replacing the emailed
 * code. This module answers one question, "does this token prove, for our
 * client, that the bearer controls this address right now?", and returns the
 * address or a fixed reason. The caller then compares the address with the
 * invite's (the email lock) and never sees anything else from the token.
 *
 * ── R-1: this never throws, and never passes a library error on ─────────────
 * `google-auth-library` puts the WHOLE token payload (email, `sub`, name,
 * picture) into its error messages ("Token used too late, … : {…}", "No issue
 * time in token: {…}", "Invalid token signature: <jwt>"). So every call into it
 * is inside a `try`, and a caught error is reduced to a fixed reason code on
 * the spot. The error object and its message go into no log, audit, response
 * or rethrow. This module logs nothing at all. The only part of a caught error
 * ever READ is the library's own "Failed to retrieve verification
 * certificates" prefix, to tell a Google outage from a bad token (R-5).
 *
 * ── The checks, all fail-closed (R-5) ───────────────────────────────────────
 *   1. client id configured (else `not_configured`, before any network call)
 *   2. Google's certificates fetched (else `unavailable`: an outage is not the
 *      invitee's bad token)
 *   3. `verifyIdToken`: signature against Google's certs, `aud` = our single
 *      client id, `iss`, `exp` (else `invalid`)
 *   4. our own re-checks: `iss` is one of Google's two forms; `aud` is our id;
 *      the `nonce` claim exists and equals SHA-256(rawNonce) in lowercase hex
 *      (D-6: binds the token to THIS page's button press); `iat` exists and is
 *      at most 600 s old and at most 300 s in the future; `email` is a
 *      non-empty string with an `@`
 *   5. `email_verified === true`, strictly (else `unverified`)
 *   6. R-2, the authoritative-address rule: Google vouches for an address only
 *      when it is `@gmail.com`, or when the token's `hd` (Workspace) claim is
 *      the address's own domain. Any other Google account (a consumer account
 *      registered on someone else's domain) is `not_authoritative`: Google once
 *      checked the address, which says nothing about who controls it today.
 *      Such invitees use the emailed code instead.
 *
 * No Gmail dot or `+tag` folding (D-7): the email returned is only trimmed and
 * lower-cased.
 *
 * ── Q-2: the library and its one client ─────────────────────────────────────
 * `google-auth-library` is imported HERE and nowhere else, behind
 * `server-only`, so a client import fails the build. There is ONE module-level
 * `OAuth2Client`, so Google's certificates stay cached (per their
 * `Cache-Control`) across requests on a warm instance.
 */

import { createHash, timingSafeEqual } from 'crypto';

import { OAuth2Client } from 'google-auth-library';

import { googleSignInClientId } from './googleSignInConfig';

/** D-6: a token issued more than this long ago is refused, whatever its `exp`. */
export const GOOGLE_ID_TOKEN_MAX_AGE_SECONDS = 600;
/** R-5: clock skew tolerated for an `iat` in the future. */
export const GOOGLE_ID_TOKEN_MAX_FUTURE_SECONDS = 300;

const GOOGLE_ISSUERS: readonly string[] = ['accounts.google.com', 'https://accounts.google.com'];
const GMAIL_DOMAIN = 'gmail.com';

/** The library's own prefix for a failed certificate fetch (see `getFederatedSignonCertsAsync`). */
const CERT_FETCH_FAILURE_PREFIX = 'Failed to retrieve verification certificates';

/** Why a token was refused, as a fixed code. Safe to log; carries nothing from the token. */
export type GoogleIdTokenInvalidReason =
  | 'verification_failed'
  | 'claims_unreadable'
  | 'issuer'
  | 'audience'
  | 'nonce'
  | 'issued_at'
  | 'email_missing';

export type GoogleIdTokenVerification =
  | { kind: 'ok'; email: string }
  | { kind: 'invalid'; reason: GoogleIdTokenInvalidReason }
  | { kind: 'unverified' }
  | { kind: 'not_authoritative' }
  | { kind: 'unavailable' }
  | { kind: 'not_configured' };

/** What the redemption flow is given (injected, so tests fake it). */
export type VerifyGoogleIdToken = (input: { idToken: string; rawNonce: string }) => Promise<GoogleIdTokenVerification>;

/**
 * The two calls this module makes on Google's client. `OAuth2Client` satisfies
 * it; a test fakes exactly these.
 */
export interface GoogleTokenClient {
  getFederatedSignonCertsAsync(): Promise<unknown>;
  verifyIdToken(options: { idToken: string; audience: string }): Promise<{ getPayload(): object | undefined }>;
}

const UNAVAILABLE: GoogleIdTokenVerification = { kind: 'unavailable' };
const invalid = (reason: GoogleIdTokenInvalidReason): GoogleIdTokenVerification => ({ kind: 'invalid', reason });

/** D-6: the nonce Google Identity Services was given is SHA-256(rawNonce), lowercase hex. */
export function hashGoogleNonce(rawNonce: string): string {
  return createHash('sha256').update(rawNonce, 'utf8').digest('hex');
}

function sameText(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * True only for the library's certificate-fetch failure. Reads the message's
 * PREFIX and nothing more; the message itself is never kept (R-1).
 */
function isCertFetchFailure(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith(CERT_FETCH_FAILURE_PREFIX);
}

/** Steps 4 to 6 on a payload whose signature, `aud`, `iss` and `exp` the library accepted. */
function checkClaims(
  payload: Record<string, unknown>,
  expected: { audience: string; rawNonce: string; nowSeconds: number }
): GoogleIdTokenVerification {
  if (typeof payload.iss !== 'string' || !GOOGLE_ISSUERS.includes(payload.iss)) return invalid('issuer');
  if (payload.aud !== expected.audience) return invalid('audience');

  if (typeof payload.nonce !== 'string' || !sameText(payload.nonce, hashGoogleNonce(expected.rawNonce))) {
    return invalid('nonce');
  }

  const iat = payload.iat;
  if (
    typeof iat !== 'number' ||
    !Number.isFinite(iat) ||
    expected.nowSeconds - iat > GOOGLE_ID_TOKEN_MAX_AGE_SECONDS ||
    iat - expected.nowSeconds > GOOGLE_ID_TOKEN_MAX_FUTURE_SECONDS
  ) {
    return invalid('issued_at');
  }

  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return invalid('email_missing');

  if (payload.email_verified !== true) return { kind: 'unverified' };

  // R-2: checked before the caller compares addresses, so a refusal here never
  // reveals whether the addresses would have matched.
  const domain = email.slice(at + 1);
  const hostedDomain = typeof payload.hd === 'string' ? payload.hd.trim().toLowerCase() : null;
  if (domain !== GMAIL_DOMAIN && hostedDomain !== domain) return { kind: 'not_authoritative' };

  return { kind: 'ok', email };
}

/** The verifier over an injected client, client id and clock (tests use this directly). */
export function createGoogleIdTokenVerifier(deps: {
  client: GoogleTokenClient;
  clientId: () => string | null;
  now: () => Date;
}): VerifyGoogleIdToken {
  return async ({ idToken, rawNonce }) => {
    const audience = deps.clientId();
    if (!audience) return { kind: 'not_configured' };

    // The outer `try` is the R-1 guarantee: nothing below can make this throw.
    try {
      try {
        await deps.client.getFederatedSignonCertsAsync();
      } catch {
        return UNAVAILABLE;
      }

      let payload: object | undefined;
      try {
        const ticket = await deps.client.verifyIdToken({ idToken, audience });
        payload = ticket.getPayload();
      } catch (error) {
        // R-1: the error's message may hold the whole payload. It is neither
        // logged nor kept: only mapped to a fixed outcome.
        return isCertFetchFailure(error) ? UNAVAILABLE : invalid('verification_failed');
      }
      if (!payload || typeof payload !== 'object') return invalid('claims_unreadable');

      return checkClaims(payload as Record<string, unknown>, {
        audience,
        rawNonce,
        nowSeconds: deps.now().getTime() / 1000,
      });
    } catch {
      return invalid('verification_failed');
    }
  };
}

// Q-2: one client per module instance, so Google's certificates stay cached.
const googleClient = new OAuth2Client();

/** The production verifier: Google's client, the one configured client id, the real clock. */
export const verifyGoogleIdToken: VerifyGoogleIdToken = createGoogleIdTokenVerifier({
  client: googleClient,
  clientId: googleSignInClientId,
  now: () => new Date(),
});
