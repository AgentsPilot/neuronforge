/**
 * The middleware lets `/account-deleted` through without the onboarding check
 * (data export DE-10b.2): the visitor has just been signed out, and a stale
 * cookie must not send them to onboarding.
 *
 * The cookie is written by the library's own writer under the name the
 * middleware derives (PROD-1a, SA C-7), and a positive control in this file
 * proves the same cookie DOES reach the check on a protected path. Without
 * it, a cookie the middleware could not read would make "not called" pass
 * for the wrong reason.
 */

import { NextRequest } from 'next/server';

import { cookieHeader, sessionCookies, sessionWith } from '@/tests/helpers/supabaseSessionCookie';

const createClient = jest.fn(() => {
  throw new Error('the account-deleted page must not reach the onboarding check');
});
jest.mock('@supabase/supabase-js', () => ({ createClient: (...args: unknown[]) => createClient(...(args as [])) }));

import { middleware } from '@/middleware';

function staleAuthCookie(): string {
  return cookieHeader(sessionCookies(sessionWith('eyJdead')));
}

afterEach(() => {
  createClient.mockClear();
});

it('passes /account-deleted straight through, even with a stale auth cookie', async () => {
  const response = await middleware(
    new NextRequest('http://localhost:3000/account-deleted?lang=he', { headers: { cookie: staleAuthCookie(), host: 'localhost:3000' } })
  );
  expect(response.headers.get('location')).toBeNull();
  expect(response.headers.get('x-middleware-next')).toBe('1');
  expect(createClient).not.toHaveBeenCalled();
});

it('positive control: the same cookie on a protected path does reach the onboarding check', async () => {
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    // The mock throws and the middleware's catch lets the request through; what matters is that it was reached.
    await middleware(
      new NextRequest('http://localhost:3000/v2/dashboard', { headers: { cookie: staleAuthCookie(), host: 'localhost:3000' } })
    );
    expect(createClient).toHaveBeenCalled();
  } finally {
    errorSpy.mockRestore();
  }
});
