/**
 * A client holding a grant cookie gets their business's branding.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BUG THIS COVERS, WHICH SHIPPED ONCE ALREADY
 *
 * The portal's address bar carries a bare booking id, not a token — that is the
 * point of it, since holding the id grants nothing. The credential is a signed
 * grant cookie, and `resolvePublicBranding` has to read it to know whose
 * business the page belongs to.
 *
 * It passed the WHOLE `Cookie` header to `readGrants`, which tried to verify
 * `ap_portal_grant=eyJ...` — name, equals sign and all — as a JWT. That threw,
 * no grants came back, branding resolved to null, the layout rendered its
 * unbranded fallback, and the client was told "Booking not found" while holding
 * a perfectly valid grant.
 *
 * The extraction helper existed at the time. It simply was not called here,
 * which is precisely the kind of mistake no type can catch: both sides are
 * strings.
 *
 * These test `cookieValue` directly, because it is the piece that was skipped
 * and the piece a future edit would skip again. The header shapes are the ones
 * a browser actually sends.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { cookieValue } from '@/lib/security/portalAccess';
import { PORTAL_GRANT_COOKIE } from '@/lib/security/portalGrant';

/** A JWT-shaped value, so the failure mode is the real one. */
const GRANT = 'eyJhbGciOiJIUzI1NiJ9.eyJiIjoiMTIzIn0.c2lnbmF0dXJl';

describe('pulling the grant out of a Cookie header', () => {
  it('returns the value alone, never the name with it', () => {
    /*
     * ─────────────────────────────────────────────────────────────────────
     * THE ONE THAT MATTERS.
     *
     * `ap_portal_grant=eyJ...` is not a JWT. Handing that to the verifier is
     * what blanked the branding and produced "Booking not found".
     * ─────────────────────────────────────────────────────────────────────
     */
    const header = `${PORTAL_GRANT_COOKIE}=${GRANT}`;

    expect(cookieValue(header, PORTAL_GRANT_COOKIE)).toBe(GRANT);
    expect(cookieValue(header, PORTAL_GRANT_COOKIE)).not.toContain('=');
  });

  it('finds it among the other cookies a browser sends', () => {
    // Never alone in practice: a real header carries session, analytics and
    // preference cookies around it, in no guaranteed order.
    const header = [
      'sb-proj-auth-token.0=abc',
      `${PORTAL_GRANT_COOKIE}=${GRANT}`,
      'locale=he',
    ].join('; ');

    expect(cookieValue(header, PORTAL_GRANT_COOKIE)).toBe(GRANT);
  });

  it('is not fooled by a cookie whose name merely ends with this one', () => {
    /*
     * A prefix match would accept `other_ap_portal_grant` and hand back
     * somebody else's value. The name is compared whole.
     */
    const header = `other_${PORTAL_GRANT_COOKIE}=not-the-grant; ${PORTAL_GRANT_COOKIE}=${GRANT}`;

    expect(cookieValue(header, PORTAL_GRANT_COOKIE)).toBe(GRANT);
  });

  it('decodes a percent-encoded value', () => {
    // Cookies are URL-encoded on the way out; a JWT survives it untouched, but
    // anything carrying `=` padding or `+` does not.
    const header = `${PORTAL_GRANT_COOKIE}=${encodeURIComponent('a+b/c=')}`;

    expect(cookieValue(header, PORTAL_GRANT_COOKIE)).toBe('a+b/c=');
  });

  it('survives a malformed encoding rather than throwing', () => {
    /*
     * A lone `%` makes `decodeURIComponent` throw. Thrown here it would take
     * out branding for the whole page — the same blank-page outcome, from the
     * opposite cause — so the raw value is returned instead and the grant
     * verifier rejects it on its own terms.
     */
    const header = `${PORTAL_GRANT_COOKIE}=100%`;

    expect(() => cookieValue(header, PORTAL_GRANT_COOKIE)).not.toThrow();
    expect(cookieValue(header, PORTAL_GRANT_COOKIE)).toBe('100%');
  });

  it('returns nothing when there is no cookie at all', () => {
    // The ordinary case for a client arriving on a signed link: no grant yet,
    // and branding comes from the token instead.
    expect(cookieValue(null, PORTAL_GRANT_COOKIE)).toBeUndefined();
    expect(cookieValue(undefined, PORTAL_GRANT_COOKIE)).toBeUndefined();
    expect(cookieValue('', PORTAL_GRANT_COOKIE)).toBeUndefined();
    expect(cookieValue('locale=he; theme=dark', PORTAL_GRANT_COOKIE)).toBeUndefined();
  });
});

describe('the branding resolver calls it', () => {
  it('passes the extracted value to readGrants, not the raw header', () => {
    /*
     * Source-level, and deliberately so: what broke was not a function
     * returning the wrong answer — `cookieValue` and `readGrants` were both
     * correct — but one call site passing the wrong string to the other. Both
     * are `string`, so nothing but this notices.
     */
    const source = require('fs').readFileSync(
      require('path').join(process.cwd(), 'lib/branding/publicBranding.ts'),
      'utf8'
    );

    expect(source).toMatch(/readGrants\(cookieValue\(ref\.grantCookie, PORTAL_GRANT_COOKIE\)\)/);
    expect(source).not.toMatch(/readGrants\(ref\.grantCookie\)/);
  });
});
