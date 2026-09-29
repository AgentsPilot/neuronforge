/**
 * The middleware branch for the public invite page (C-4, T-7, SA F-6).
 *
 *   - `/invite` passes straight through with `Referrer-Policy: no-referrer`,
 *     and a signed-in visitor is NOT sent to onboarding.
 *   - A business's own site `/invite` is still rewritten to that site.
 */

import { NextRequest } from 'next/server';

const createClient = jest.fn(() => {
  throw new Error('the invite page must not reach the onboarding check');
});
jest.mock('@supabase/supabase-js', () => ({ createClient: (...args: unknown[]) => createClient(...(args as [])) }));

import { isPublicSurfacePath } from '@/components/PlatformChrome';
import { middleware } from '@/middleware';

/** A plausible auth cookie, so the onboarding check WOULD run if reached. */
function authCookie(): string {
  const token = Buffer.from(JSON.stringify({ access_token: 'eyJfake' })).toString('base64');
  return `sb-jgccgkyhpwirgknnceoh-auth-token.0=base64-${token}`;
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

  it('a lookalike path such as /invitation is not on the allow-list', async () => {
    const response = await middleware(new NextRequest('http://localhost:3000/invitation', { headers: { host: 'localhost:3000' } }));
    expect(response.headers.get('referrer-policy')).toBeNull();
  });
});

describe('a business subdomain', () => {
  it('its own /invite path is still rewritten to the business site', async () => {
    process.env.NEXT_PUBLIC_PUBLIC_SITE_HOST = 'lvh.me:3000';
    const response = await middleware(
      new NextRequest('http://joesgym.lvh.me:3000/invite', { headers: { host: 'joesgym.lvh.me:3000' } })
    );
    const rewrite = response.headers.get('x-middleware-rewrite');
    expect(rewrite).toBeTruthy();
    expect(rewrite).toContain('/invite');
    expect(rewrite).toContain('joesgym');
    expect(response.headers.get('referrer-policy')).toBeNull();
  });
});

describe('the second place a public route is registered (PlatformChrome)', () => {
  it('/invite gets no platform shell, so an invitee with no account loads no owner chrome', () => {
    expect(isPublicSurfacePath('/invite')).toBe(true);
    expect(isPublicSurfacePath('/invite/')).toBe(true);
    expect(isPublicSurfacePath('/invitation')).toBe(false);
  });
});
