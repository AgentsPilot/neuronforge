/**
 * The middleware branch for the public invite page (C-4, T-7, SA F-6).
 *
 *   - `/invite` passes straight through with `Referrer-Policy: no-referrer`,
 *     and a signed-in visitor is NOT sent to onboarding.
 *   - A business's own site `/invite` is still rewritten to that site.
 */

import { NextRequest } from 'next/server';

import { cookieHeader, sessionCookies, sessionWith } from '@/tests/helpers/supabaseSessionCookie';

const createClient = jest.fn(() => {
  throw new Error('the invite page must not reach the onboarding check');
});
jest.mock('@supabase/supabase-js', () => ({ createClient: (...args: unknown[]) => createClient(...(args as [])) }));

import { isPublicSurfacePath } from '@/components/PlatformChrome';
import { middleware } from '@/middleware';

/**
 * A real auth cookie, so the onboarding check WOULD run if reached: written by
 * the library's own writer under the name the middleware derives (PROD-1a,
 * SA C-7). The positive control below proves it is read on a protected path.
 */
function authCookie(): string {
  return cookieHeader(sessionCookies(sessionWith('eyJfake')));
}

const originalSiteHost = process.env.NEXT_PUBLIC_PUBLIC_SITE_HOST;

afterEach(() => {
  createClient.mockClear();
  if (originalSiteHost === undefined) delete process.env.NEXT_PUBLIC_PUBLIC_SITE_HOST;
  else process.env.NEXT_PUBLIC_PUBLIC_SITE_HOST = originalSiteHost;
});

describe('/invite on the platform', () => {
  it.each(['/invite', '/invite/'])('%s passes through with no-referrer, even with an auth cookie', async (path) => {
    const response = await middleware(
      new NextRequest(`http://localhost:3000${path}`, { headers: { cookie: authCookie(), host: 'localhost:3000' } })
    );
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('location')).toBeNull();
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(createClient).not.toHaveBeenCalled();
  });

  it('positive control: the same cookie on a protected path does reach the onboarding check', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      // The mock throws and the middleware's catch lets the request through; what matters is that it was reached.
      await middleware(new NextRequest('http://localhost:3000/v2/dashboard', { headers: { cookie: authCookie(), host: 'localhost:3000' } }));
      expect(createClient).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('a lookalike path such as /invitation is not on the allow-list', async () => {
    const response = await middleware(new NextRequest('http://localhost:3000/invitation', { headers: { host: 'localhost:3000' } }));
    expect(response.headers.get('referrer-policy')).toBeNull();
  });
});

describe('a business subdomain', () => {
  it('its own /invite path is still rewritten to the business site', async () => {
    /*
     * `development` stated, not assumed. `lvh.me` is the local stand-in for
     * wildcard DNS — every subdomain of it resolves to 127.0.0.1 — so
     * `publicSiteHost` now refuses it anywhere but a dev machine, the same way
     * `platformOrigin` has always refused a loopback app URL. This test
     * exercises that local mechanism, so it has to say it is on that machine.
     */
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    process.env.NEXT_PUBLIC_PUBLIC_SITE_HOST = 'lvh.me:3000';
    try {
      const response = await middleware(
        new NextRequest('http://joesgym.lvh.me:3000/invite', { headers: { host: 'joesgym.lvh.me:3000' } })
      );
      const rewrite = response.headers.get('x-middleware-rewrite');
      expect(rewrite).toBeTruthy();
      expect(rewrite).toContain('/invite');
      expect(rewrite).toContain('joesgym');
      expect(response.headers.get('referrer-policy')).toBeNull();
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });
});

describe('the second place a public route is registered (PlatformChrome)', () => {
  it('/invite gets no platform shell, so an invitee with no account loads no owner chrome', () => {
    expect(isPublicSurfacePath('/invite')).toBe(true);
    expect(isPublicSurfacePath('/invite/')).toBe(true);
    expect(isPublicSurfacePath('/invitation')).toBe(false);
  });
});
