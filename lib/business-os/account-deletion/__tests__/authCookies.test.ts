/**
 * Expiring the session cookies after a self-delete (data export DE-10b.2,
 * workplan §2.6; SA V-3).
 */

import { NextRequest, NextResponse } from 'next/server';
import { authCookiePattern, expireAuthCookies, supabaseProjectRef } from '../authCookies';

const REF = 'jgccgkyhpwirgknnceoh';
const URL_ = `https://${REF}.supabase.co`;

function requestWith(cookie: string): NextRequest {
  return new NextRequest('http://localhost/api/business-os/account/delete', { method: 'POST', headers: { cookie } });
}

function setCookies(response: NextResponse): string[] {
  return response.headers.getSetCookie ? response.headers.getSetCookie() : [response.headers.get('set-cookie') ?? ''];
}

describe('supabaseProjectRef', () => {
  it('is the first label of the project host', () => {
    expect(supabaseProjectRef(URL_)).toBe(REF);
    expect(supabaseProjectRef('http://127.0.0.1:54321')).toBe('127');
  });

  it('is null for nothing or a bad URL', () => {
    // `undefined` falls back to NEXT_PUBLIC_SUPABASE_URL (the default parameter), so it is not asserted here.
    expect(supabaseProjectRef('')).toBeNull();
    expect(supabaseProjectRef('not a url')).toBeNull();
  });
});

describe('authCookiePattern', () => {
  const pattern = authCookiePattern(REF)!;

  it.each([`sb-${REF}-auth-token`, `sb-${REF}-auth-token.0`, `sb-${REF}-auth-token.12`, `sb-${REF}-auth-token-code-verifier`])(
    'matches %s',
    (name) => expect(pattern.test(name)).toBe(true)
  );

  it.each([`sb-other-auth-token`, `sb-${REF}-auth-token-user`, `x-sb-${REF}-auth-token`, `sb-${REF}-auth-token.a`, 'bos_language', 'NEXT_LOCALE'])(
    'does not match %s',
    (name) => expect(pattern.test(name)).toBe(false)
  );

  it('is null when the ref is unknown', () => {
    expect(authCookiePattern(null)).toBeNull();
  });
});

describe('expireAuthCookies', () => {
  it('expires the base cookie and its chunked variants, nothing else', () => {
    const request = requestWith(
      `sb-${REF}-auth-token.0=a; sb-${REF}-auth-token.1=b; sb-${REF}-auth-token-code-verifier=c; bos_language=he; sb-other-auth-token=x`
    );
    const response = NextResponse.json({ ok: true });
    const expired = expireAuthCookies(request.cookies, response, REF);

    expect(expired.sort()).toEqual([`sb-${REF}-auth-token-code-verifier`, `sb-${REF}-auth-token.0`, `sb-${REF}-auth-token.1`].sort());
    const headers = setCookies(response).join('\n');
    for (const name of expired) {
      const line = setCookies(response).find((cookie) => cookie.startsWith(`${name}=`));
      expect(line).toBeDefined();
      expect(line).toMatch(/Max-Age=0/i);
      expect(line).toMatch(/Path=\//);
      expect(line).toMatch(/SameSite=lax/i);
      expect(line).not.toMatch(/HttpOnly/i);
      expect(line).not.toMatch(/Secure/i);
      expect(line).not.toMatch(/Domain=/i);
    }
    // The language cookie and another project's cookie are left alone.
    expect(headers).not.toContain('bos_language');
    expect(headers).not.toContain('sb-other-auth-token');
  });

  it('expires only cookies the request carried (no guessing of chunk names)', () => {
    const response = NextResponse.json({ ok: true });
    expect(expireAuthCookies(requestWith(`sb-${REF}-auth-token=a`).cookies, response, REF)).toEqual([`sb-${REF}-auth-token`]);
    expect(setCookies(response).filter((line) => line !== '')).toHaveLength(1);
  });

  it('does nothing when the project ref is unknown', () => {
    const response = NextResponse.json({ ok: true });
    expect(expireAuthCookies(requestWith(`sb-${REF}-auth-token=a`).cookies, response, null)).toEqual([]);
  });
});
