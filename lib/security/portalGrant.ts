/**
 * The cookie that lets a client stay in their portal once the link has done its
 * job, so the credential can leave the address bar.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE TOKEN CANNOT JUST STAY IN THE URL
 *
 * It arrives there — an email can carry nothing but a URL — and everything
 * downstream of that is exposure: browser history, a client pasting their
 * address bar into a support chat, a screenshot, a shared laptop, and every
 * proxy access log between them and us. `Referer` and search indexing are
 * already closed; the address bar itself is what is left.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SHAPE, AND WHY IT IS NOT A SESSION
 *
 * This is NOT a login. It grants exactly what the link that created it granted:
 * one booking, named explicitly, for the address the link was signed for. It
 * confers nothing about any other booking and nothing about the platform.
 *
 * One cookie carrying a LIST rather than a cookie per booking, because a client
 * legitimately has several — the package card alone offers six siblings — and a
 * cookie each would accumulate without bound and race each other on `Path`.
 * The list is capped and newest-first, so a client working through a package
 * keeps the ones they are using.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW IT EXPIRES, TWICE
 *
 * A SESSION cookie, so it dies when the browser closes, AND a short `exp` in
 * the payload, so it dies anyway. Both, because "browser close" barely happens
 * on a phone and a shared device is the case this must not get wrong: a cookie
 * that outlives the person at the keyboard is worse than the URL it replaced,
 * since the URL at least required somebody to re-open the email.
 *
 * Two hours. Long enough to read a quote, fill in an intake form and pay;
 * short enough that coming back tomorrow means clicking the link again, which
 * costs a client nothing and is the behaviour we want.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as jwt from 'jsonwebtoken';

/** The booking token's own secret: one key for the client-facing surface. */
function secret(): string {
  const configured = process.env.BOOKING_TOKEN_SECRET || process.env.NEXTAUTH_SECRET;

  if (!configured) {
    throw new Error(
      'BOOKING_TOKEN_SECRET (or NEXTAUTH_SECRET) must be set to sign portal grants'
    );
  }

  return configured;
}

export const PORTAL_GRANT_COOKIE = 'ap_portal_grant';

/** See the note above: short, and deliberately shorter than the link itself. */
export const GRANT_TTL_SECONDS = 2 * 60 * 60;

/**
 * How many bookings one browser may hold at once.
 *
 * A package is six, and a client may have a couple of unrelated appointments
 * on top. Twelve covers that with room; beyond it the oldest fall off, which
 * costs nothing — the link re-grants them.
 */
const MAX_GRANTS = 12;

export interface PortalGrant {
  /** The booking this grants, and nothing else. */
  bookingId: string;
  /** The address the originating link was signed for. */
  email: string;
}

interface GrantPayload {
  grants: PortalGrant[];
}

/** Everything still valid in this cookie. Empty for absent, tampered or expired. */
export function readGrants(cookieValue: string | undefined | null): PortalGrant[] {
  if (!cookieValue) return [];

  try {
    const decoded = jwt.verify(cookieValue, secret()) as GrantPayload;
    if (!Array.isArray(decoded?.grants)) return [];

    return decoded.grants.filter(
      (g): g is PortalGrant => Boolean(g && typeof g.bookingId === 'string' && typeof g.email === 'string')
    );
  } catch {
    /* Tampered, expired, or signed with a key we no longer use. All three mean
       the same thing to the caller: present no grant and fall back to the link. */
    return [];
  }
}

/** The grant for one booking, or null. */
export function grantFor(grants: PortalGrant[], bookingId: string): PortalGrant | null {
  return grants.find(g => g.bookingId === bookingId) ?? null;
}

/**
 * The cookie value carrying `existing` plus this one.
 *
 * Newest first and de-duplicated, so re-entering a booking refreshes its place
 * rather than adding a second copy, and the cap drops the least recently used.
 */
export function withGrant(
  existing: PortalGrant[],
  bookingId: string,
  email: string
): string {
  const grants: PortalGrant[] = [
    { bookingId, email },
    ...existing.filter(g => g.bookingId !== bookingId),
  ].slice(0, MAX_GRANTS);

  return jwt.sign({ grants } satisfies GrantPayload, secret(), {
    expiresIn: GRANT_TTL_SECONDS,
  });
}

/**
 * The attributes, in one place so no caller can set a weaker version.
 *
 * `httpOnly` — script must not be able to read it; the whole point is that it
 *   is not in a place a page can copy.
 * `sameSite: 'lax'` — follows a link from an email client, does not ride a
 *   cross-site POST.
 * `secure` outside development — it is a credential.
 * NO `maxAge` and NO `expires` — a session cookie, see the note above. The
 *   payload's own `exp` is the second bound.
 * `path: '/'` — the portal and the invoice page are different trees and a
 *   client moves between them.
 */
export function portalGrantCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV !== 'development',
    path: '/',
  };
}
