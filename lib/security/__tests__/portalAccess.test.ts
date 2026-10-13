/**
 * Who may open a booking once the token has left the address bar.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The exchange replaces a credential in the URL with an identifier in the URL
 * plus a credential in a cookie. That is only an improvement if the identifier
 * genuinely grants nothing — so the cases worth testing are the ones where it
 * might: a booking id with no cookie, a cookie for the wrong booking, a forged
 * cookie, and an expired one.
 *
 * If any of those open a booking, the change made things worse rather than
 * better, because a booking id is now visible in a place a token never was.
 * ─────────────────────────────────────────────────────────────────────────────
 */

process.env.BOOKING_TOKEN_SECRET = 'test-secret-for-portal-grants';

import * as jwt from 'jsonwebtoken';

import { generateBookingToken } from '@/lib/services/BookingEmailService';
import { resolvePortalAccess, looksLikeBookingId, cookieValue } from '@/lib/security/portalAccess';
import { PORTAL_GRANT_COOKIE, readGrants, withGrant } from '@/lib/security/portalGrant';

const BOOKING = '94d85c07-1d35-4ab8-8e41-193f1375025c';
const OTHER = 'f3770fd4-37cb-4752-99cf-0f84d20c14d3';
const EMAIL = 'client@example.test';

const cookieWith = (value: string) => `${PORTAL_GRANT_COOKIE}=${encodeURIComponent(value)}`;
const grantFor = (bookingId: string, email = EMAIL) => cookieWith(withGrant([], bookingId, email));

describe('telling the two forms apart', () => {
  it('recognises a booking id', () => {
    expect(looksLikeBookingId(BOOKING)).toBe(true);
  });

  it('does not mistake a token for one', () => {
    /*
     * By shape, never by trying one and falling back. A fallback would give a
     * malformed token a second chance as an id, which is the kind of ambiguity
     * that becomes a bypass.
     */
    expect(looksLikeBookingId(generateBookingToken(BOOKING, EMAIL))).toBe(false);
  });

  it('rejects near-misses rather than being lenient', () => {
    for (const bad of ['', 'not-a-uuid', BOOKING.slice(0, -1), `${BOOKING}x`, '../' + BOOKING]) {
      expect(looksLikeBookingId(bad)).toBe(false);
    }
  });
});

describe('the link still works, exactly as it always did', () => {
  it('opens the booking it names', () => {
    expect(resolvePortalAccess(generateBookingToken(BOOKING, EMAIL), null)).toEqual({
      bookingId: BOOKING,
      email: EMAIL,
      via: 'token',
    });
  });

  it('works with no cookie at all', () => {
    /*
     * The fallback that keeps a client in a private window, or with cookies
     * refused, able to reach their own booking. Nothing is gated on the
     * exchange succeeding.
     */
    expect(resolvePortalAccess(generateBookingToken(BOOKING, EMAIL), '')).not.toBeNull();
  });

  it('refuses a token signed with another key', () => {
    const forged = jwt.sign({ bookingId: BOOKING, email: EMAIL }, 'wrong', { expiresIn: '30d' });
    expect(resolvePortalAccess(forged, null)).toBeNull();
  });
});

describe('a booking id grants nothing on its own', () => {
  it('is refused with no cookie', () => {
    /*
     * ─────────────────────────────────────────────────────────────────────────
     * THE ONE THAT MATTERS.
     *
     * The id is in the address bar now — in history, in screenshots, in
     * anything a client pastes. If it opened a booking by itself, the exchange
     * would have replaced a credential that leaks with an identifier that
     * leaks and grants, which is strictly worse than where we started.
     * ─────────────────────────────────────────────────────────────────────────
     */
    expect(resolvePortalAccess(BOOKING, null)).toBeNull();
    expect(resolvePortalAccess(BOOKING, '')).toBeNull();
    expect(resolvePortalAccess(BOOKING, 'something=else')).toBeNull();
  });

  it('is refused when the cookie names a DIFFERENT booking', () => {
    // One grant must not open the rest. A client legitimately holds several.
    expect(resolvePortalAccess(BOOKING, grantFor(OTHER))).toBeNull();
  });

  it('is refused when the cookie is forged', () => {
    const forged = jwt.sign({ grants: [{ bookingId: BOOKING, email: EMAIL }] }, 'wrong', {
      expiresIn: '2h',
    });
    expect(resolvePortalAccess(BOOKING, cookieWith(forged))).toBeNull();
  });

  it('is refused when the cookie has expired', () => {
    const stale = jwt.sign(
      { grants: [{ bookingId: BOOKING, email: EMAIL }] },
      process.env.BOOKING_TOKEN_SECRET!,
      { expiresIn: '-1s' }
    );
    expect(resolvePortalAccess(BOOKING, cookieWith(stale))).toBeNull();
  });

  it('is allowed only with a grant naming it', () => {
    expect(resolvePortalAccess(BOOKING, grantFor(BOOKING))).toEqual({
      bookingId: BOOKING,
      email: EMAIL,
      via: 'grant',
    });
  });

  it('carries the address the original link was signed for', () => {
    /*
     * The grant must not widen what the link gave. Downstream routes compare
     * this against the booking's contact, so a grant that lost the address
     * would skip that check entirely.
     */
    const access = resolvePortalAccess(BOOKING, grantFor(BOOKING, 'someone@else.test'));
    expect(access?.email).toBe('someone@else.test');
  });
});

describe('holding several bookings at once', () => {
  it('keeps every granted booking reachable', () => {
    // A package card offers six siblings; a client moves between them.
    const value = withGrant(withGrantList(), OTHER, EMAIL);
    expect(resolvePortalAccess(BOOKING, cookieWith(value))).not.toBeNull();
    expect(resolvePortalAccess(OTHER, cookieWith(value))).not.toBeNull();
  });

  function withGrantList() {
    return readGrants(withGrant([], BOOKING, EMAIL));
  }

  it('re-granting one does not duplicate it', () => {
    const once = readGrants(withGrant([], BOOKING, EMAIL));
    const twice = readGrants(withGrant(once, BOOKING, EMAIL));
    expect(twice.filter(g => g.bookingId === BOOKING)).toHaveLength(1);
  });

  it('caps the list rather than growing without bound', () => {
    let grants = readGrants(withGrant([], BOOKING, EMAIL));
    for (let i = 0; i < 40; i++) {
      grants = readGrants(withGrant(grants, `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, EMAIL));
    }
    expect(grants.length).toBeLessThanOrEqual(12);
  });
});

describe('reading one cookie out of a header', () => {
  it('finds it among others', () => {
    expect(cookieValue(`a=1; ${PORTAL_GRANT_COOKIE}=xyz; b=2`, PORTAL_GRANT_COOKIE)).toBe('xyz');
  });

  it('does not match a cookie whose name merely ends with it', () => {
    expect(cookieValue(`not_${PORTAL_GRANT_COOKIE}=xyz`, PORTAL_GRANT_COOKIE)).toBeUndefined();
  });

  it('is undefined for an absent header', () => {
    expect(cookieValue(null, PORTAL_GRANT_COOKIE)).toBeUndefined();
    expect(cookieValue('', PORTAL_GRANT_COOKIE)).toBeUndefined();
  });
});
