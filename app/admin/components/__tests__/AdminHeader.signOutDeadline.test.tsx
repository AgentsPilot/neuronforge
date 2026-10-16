/**
 * @jest-environment jsdom
 *
 * The admin header's Sign out leaves even when every network call hangs
 * (slice C-c, SA-CC-9).
 *
 * The other AdminHeader test mocks `signOutUser`; `jest.mock` is per file, so
 * this one runs the REAL `signOutUser` with only the Supabase client and
 * `fetch` faked, both never settling. It proves the caller-level outcome the
 * unit tests only imply: the redirect happens at 9 s, not before and not
 * never, and no session cookie is left behind.
 */

import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';

const never = <T,>() => new Promise<T>(() => undefined);
const signOutCalls: string[] = [];

jest.mock('@/lib/supabaseClient', () => ({
  supabase: {
    auth: {
      signOut: (opts: { scope: string }) => {
        signOutCalls.push(opts.scope);
        return never();
      },
    },
  },
}));

const sessionUser = { id: 'session-user', email: 'admin@example.com' };
jest.mock('@/components/UserProvider', () => ({
  useAuth: () => ({ user: sessionUser }),
}));

jest.mock('@/lib/utils/marketingUrl', () => ({
  marketingLogoutUrl: () => 'https://marketing.example/logout',
}));

jest.mock('@/lib/logger/client', () => {
  const noop = () => undefined;
  const logger = { error: noop, warn: noop, info: noop, debug: noop, child: () => logger };
  return { clientLogger: logger };
});

jest.mock('@/lib/repositories/UserProfileRepository', () => ({
  userProfileRepository: { findById: jest.fn() },
}));

import AdminHeader from '../AdminHeader';

const SESSION_COOKIES = ['sb-abcd-auth-token.0', 'sb-abcd-auth-token.1'];

describe('AdminHeader sign-out with every request hung', () => {
  const original = window.location;

  beforeEach(() => {
    jest.useFakeTimers();
    global.fetch = jest.fn(() => never<Response>()) as unknown as typeof fetch;
    // Not `Secure`: jsdom on http://localhost would drop it and the check would pass for the wrong reason.
    for (const name of SESSION_COOKIES) document.cookie = `${name}=base64-c2Vzc2lvbg; Path=/; SameSite=Lax`;
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', { value: original, writable: true });
    jest.useRealTimers();
  });

  it('redirects at 9 000 ms, not at 8 999, and leaves no session cookie', async () => {
    const replace = jest.fn();
    Object.defineProperty(window, 'location', { value: { ...original, replace }, writable: true });
    expect(document.cookie).toContain('sb-abcd-auth-token.0');

    render(<AdminHeader adminName="Dana Levi" onMenuClick={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    await act(async () => {
      await jest.advanceTimersByTimeAsync(8999);
    });
    expect(replace).not.toHaveBeenCalled();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(1);
    });
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('https://marketing.example/logout');
    expect(signOutCalls).toEqual(['global', 'local']);
    for (const name of SESSION_COOKIES) expect(document.cookie).not.toContain(name);
  });
});
