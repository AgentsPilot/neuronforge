/**
 * The middleware lets `/account-deleted` through without the onboarding check
 * (data export DE-10b.2): the visitor has just been signed out, and a stale
 * cookie must not send them to onboarding.
 */

import { NextRequest } from 'next/server';

const createClient = jest.fn(() => {
  throw new Error('the account-deleted page must not reach the onboarding check');
});
jest.mock('@supabase/supabase-js', () => ({ createClient: (...args: unknown[]) => createClient(...(args as [])) }));

import { middleware } from '@/middleware';

function staleAuthCookie(): string {
  const token = Buffer.from(JSON.stringify({ access_token: 'eyJdead' })).toString('base64');
  return `sb-jgccgkyhpwirgknnceoh-auth-token.0=base64-${token}`;
}

it('passes /account-deleted straight through, even with a stale auth cookie', async () => {
  const response = await middleware(
    new NextRequest('http://localhost:3000/account-deleted?lang=he', { headers: { cookie: staleAuthCookie(), host: 'localhost:3000' } })
  );
  expect(response.headers.get('location')).toBeNull();
  expect(response.headers.get('x-middleware-next')).toBe('1');
  expect(createClient).not.toHaveBeenCalled();
});
