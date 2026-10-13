/**
 * Who is asking, for every route under the booking portal.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE SEGMENT, TWO THINGS
 *
 * `/book/manage/<x>` carries either:
 *
 *   · a signed TOKEN, which is how a client arrives from their email; or
 *   · a booking ID, which is what the address bar holds afterwards, once the
 *     token has been exchanged for a grant cookie.
 *
 * They are told apart by shape, not by trying one and falling back: a booking
 * id is a UUID and a token is a JWT, and the two cannot be confused. Guessing
 * would mean a malformed token getting a second chance as an id, which is the
 * kind of ambiguity that turns into a bypass.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE THAT MATTERS
 *
 * A booking id ALONE is never enough. It is an identifier, not a credential —
 * it appears in the address bar precisely because holding it grants nothing.
 * Access requires the grant cookie to name that same booking, and the grant is
 * only ever created by presenting a valid token for it.
 *
 * So the id in the URL is never trusted; it selects which grant to look for.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { verifyBookingToken } from '@/lib/services/bookingToken';
import { PORTAL_GRANT_COOKIE, grantFor, readGrants } from '@/lib/security/portalGrant';

/** A v4-shaped UUID, which is what every booking id is. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function looksLikeBookingId(segment: string): boolean {
  return UUID.test(segment);
}

export interface PortalAccess {
  bookingId: string;
  email: string;
  /** Which credential answered: the link, or the cookie it was exchanged for. */
  via: 'token' | 'grant';
}

/**
 * Resolve the caller, or null.
 *
 * `cookieHeader` is the raw `Cookie` header; routes have it on the request and
 * server components get it from `cookies()`. Passing the raw string keeps this
 * usable from both without dragging `next/headers` into a module that API
 * routes import.
 */
export function resolvePortalAccess(
  segment: string,
  cookieHeader: string | null | undefined
): PortalAccess | null {
  /*
   * The id path. Requires a grant naming this exact booking — a cookie for a
   * DIFFERENT booking must not open this one, which is why the lookup is by id
   * rather than "is there any grant at all".
   */
  if (looksLikeBookingId(segment)) {
    const grant = grantFor(readGrants(cookieValue(cookieHeader, PORTAL_GRANT_COOKIE)), segment);
    return grant ? { bookingId: grant.bookingId, email: grant.email, via: 'grant' } : null;
  }

  /*
   * The link path. Unchanged from before any of this existed, so every link
   * already in an inbox keeps working exactly as it did — including after the
   * cookie has been introduced, and including when cookies are refused.
   */
  const decoded = verifyBookingToken(segment);
  if (!decoded?.bookingId || !decoded.email) return null;

  return { bookingId: decoded.bookingId, email: decoded.email, via: 'token' };
}

/**
 * One cookie out of a raw header.
 *
 * Hand-parsed rather than pulling in `next/headers`, which is unavailable in
 * the places this is called from and would make the module untestable in
 * isolation. The value is percent-decoded because that is how it was written.
 */
export function cookieValue(header: string | null | undefined, name: string): string | undefined {
  if (!header) return undefined;

  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;

    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return part.slice(eq + 1).trim();
    }
  }

  return undefined;
}
