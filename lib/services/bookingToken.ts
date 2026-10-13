/**
 * The signed token on a `/book/manage/[token]` link: minting and checking it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS ITS OWN FILE, AND NOT A TIDYING-UP
 *
 * These two functions lived in `BookingEmailService` — 2,800 lines that
 * statically import 38 other modules: every email template, five repositories,
 * the mail transport, the intake resolver. Reaching it pulls in 71 first-party
 * modules and roughly 27,600 lines of source.
 *
 * And all of that was being imported to call `jwt.sign`, on the client-facing
 * surface, by:
 *
 *   • `lib/security/portalAccess.ts`   — every portal route
 *   • `lib/branding/publicBranding.ts` — every PUBLIC page: invoice, proposal,
 *                                        cancel, reschedule, intake, booking
 *   • the portal layout and page, and the portal's own API route
 *
 * Measured on the portal layout: 34,243 lines of first-party source reachable,
 * 27,647 of them through this one import. Four fifths of the module graph of a
 * page a client opens from an email, for an HMAC over two strings.
 *
 * In production that is bundle size and cold start. In development it is worse:
 * Next compiles each route's server graph separately and holds it, so the same
 * 27,600 lines are paid for again by every public route.
 *
 * `lib/payments/invoicePayLink.ts` had already hit this and worked around it
 * with a dynamic `import()` at call time, documenting the cost in a comment.
 * That workaround can now go: the weight it was avoiding is no longer here.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS MODULE IMPORTS `jsonwebtoken` AND NOTHING ELSE, AND MUST STAY THAT WAY.
 *
 * Anything added here is added to every public page on the platform. There is
 * a guard test on exactly that.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/services/bookingToken
 */

import * as jwt from 'jsonwebtoken';

/**
 * The secret these links are signed with.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FATAL WHEN UNSET, and read lazily so it is the send that fails rather than
 * the import of this module.
 *
 * It used to end `|| 'fallback-secret-change-in-prod'`. The token IS the
 * authorisation on `/book/manage/[token]` — it is what tells cancel and
 * reschedule which booking the caller may act on — so in any environment where
 * neither variable was set, every one of those links was signed with a string
 * printed in this repository. Anyone reading the source could mint a token for
 * any booking id and cancel a stranger's appointment.
 *
 * A link that cannot be signed is an email that does not go out, which is
 * strictly better than one that anybody can forge. `lib/consent/confirmToken.ts`
 * reached the same conclusion for the same reason; this matches it.
 *
 * `NEXTAUTH_SECRET` remains as a fallback only because it is what production
 * has been signing with — dropping it would invalidate every link already in a
 * client's inbox. It is NOT an auth secret: nothing in this app authenticates
 * with NextAuth, and it survives purely as the value these three token systems
 * inherited. Set `BOOKING_TOKEN_SECRET` explicitly and the fallback stops
 * mattering.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function bookingTokenSecret(): string {
  const configured = process.env.BOOKING_TOKEN_SECRET || process.env.NEXTAUTH_SECRET;

  if (!configured) {
    throw new Error(
      'BOOKING_TOKEN_SECRET (or NEXTAUTH_SECRET) must be set to sign booking management links'
    );
  }

  return configured;
}

/** Token expiry for booking management links (30 days). */
const TOKEN_EXPIRY_DAYS = 30;

/**
 * Generate a signed token for booking management URLs.
 *
 * Exported because a route that has already verified one token may need to mint
 * a sibling — the package manage page signs each meeting of the block for the
 * same address, which grants nothing the caller did not already hold.
 */
export function generateBookingToken(bookingId: string, email: string): string {
  return jwt.sign(
    { bookingId, email },
    bookingTokenSecret(),
    { expiresIn: `${TOKEN_EXPIRY_DAYS}d` }
  );
}

/**
 * Verify and decode a booking management token.
 */
export function verifyBookingToken(token: string): { bookingId: string; email: string } | null {
  /*
   * Resolved OUTSIDE the try on purpose.
   *
   * A missing secret and a forged token are different failures and must not
   * produce the same answer. Inside the try, the throw would be swallowed and
   * returned as `null` — so a misconfigured deployment would tell every real
   * client their valid link was invalid, and nothing would say why.
   */
  const secret = bookingTokenSecret();

  try {
    const decoded = jwt.verify(token, secret) as { bookingId: string; email: string };
    return decoded;
  } catch {
    return null;
  }
}
