/**
 * The middleware finds THIS project's session cookie, in either form the
 * library writes it, and never throws at import (PROD-1a, A2; SA D-1, D-3,
 * C-7). Workplan section 10.2.
 *
 * `onboardingVerdict` is mocked: it is the seam to Supabase. The cookie is
 * built by the shared writer (`tests/helpers/supabaseSessionCookie.ts`), under
 * the name derived from the address the Jest setup configured.
 */

import { NextRequest } from 'next/server';

import { configuredStorageKey, cookieHeader, sessionCookies, sessionWith } from '@/tests/helpers/supabaseSessionCookie';

const mockVerdict = jest.fn();
jest.mock('@/lib/security/onboardingVerdict', () => ({
  onboardingVerdict: (...args: unknown[]) => mockVerdict(...args),
}));

import { middleware } from '@/middleware';

const PROTECTED = 'http://localhost:3000/v2/dashboard';

function request(cookie?: string): NextRequest {
  const headers: Record<string, string> = { host: 'localhost:3000' };
  if (cookie) headers.cookie = cookie;
  return new NextRequest(PROTECTED, { headers });
}

/** Error-level records the edge logger wrote (it writes JSON lines through console.error). */
function errorRecords(spy: jest.SpyInstance): Array<Record<string, unknown>> {
  return spy.mock.calls
    .map((call) => {
      try {
        return JSON.parse(String(call[0])) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((record): record is Record<string, unknown> => record !== null && record.level === 50);
}

let errorSpy: jest.SpyInstance;

beforeEach(() => {
  mockVerdict.mockReset();
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  errorSpy.mockRestore();
});

function expectRedirectToOnboarding(response: Response): void {
  const location = response.headers.get('location');
  expect(location).not.toBeNull();
  expect(new URL(location as string).pathname).toBe('/onboarding-chat');
}

function expectPassedThrough(response: Response): void {
  expect(response.headers.get('location')).toBeNull();
  expect(response.headers.get('x-middleware-next')).toBe('1');
}

describe('positive controls: the derived cookie reaches the check', () => {
  it('a chunked session, verdict "onboard": redirected, verdict asked with the token', async () => {
    mockVerdict.mockResolvedValue('onboard');
    const cookies = sessionCookies(sessionWith('tok-chunked', 6000));
    // A session large enough that the library's writer splits it.
    expect(cookies.length).toBeGreaterThan(1);

    const response = await middleware(request(cookieHeader(cookies)));

    expectRedirectToOnboarding(response);
    expect(mockVerdict).toHaveBeenCalledTimes(1);
    expect(mockVerdict.mock.calls[0][0]).toBe('tok-chunked');
  });

  it('an unchunked session, verdict "onboard": redirected (D-3, the form the old loop missed)', async () => {
    mockVerdict.mockResolvedValue('onboard');
    const cookies = sessionCookies(sessionWith('tok-single'));
    expect(cookies.map((c) => c.name)).toEqual([configuredStorageKey()]);

    const response = await middleware(request(cookieHeader(cookies)));

    expectRedirectToOnboarding(response);
    expect(mockVerdict.mock.calls[0][0]).toBe('tok-single');
  });
});

describe('the behaviour table', () => {
  it('verdict "ok": passes through', async () => {
    mockVerdict.mockResolvedValue('ok');
    const response = await middleware(request(cookieHeader(sessionCookies(sessionWith('tok-ok')))));
    expectPassedThrough(response);
    expect(mockVerdict).toHaveBeenCalledTimes(1);
  });

  it('both forms present: the unchunked one wins, as in the library', async () => {
    mockVerdict.mockResolvedValue('ok');
    const pairs = [...sessionCookies(sessionWith('tok-chunked', 6000)), ...sessionCookies(sessionWith('tok-single'))];
    await middleware(request(cookieHeader(pairs)));
    expect(mockVerdict.mock.calls[0][0]).toBe('tok-single');
  });

  it('another project’s cookie name: the verdict is not asked, the request passes', async () => {
    mockVerdict.mockResolvedValue('onboard');
    const other = sessionCookies(sessionWith('tok-other'), `sb-${'z'.repeat(20)}-auth-token`);
    const response = await middleware(request(cookieHeader(other)));
    expectPassedThrough(response);
    expect(mockVerdict).not.toHaveBeenCalled();
  });

  it('a lone -code-verifier cookie is not read as a session', async () => {
    mockVerdict.mockResolvedValue('onboard');
    const response = await middleware(request(`${configuredStorageKey()}-code-verifier=base64-eyJ9`));
    expectPassedThrough(response);
    expect(mockVerdict).not.toHaveBeenCalled();
  });

  it('a malformed session cookie: passes through with one error line (the catch path)', async () => {
    mockVerdict.mockResolvedValue('onboard');
    const response = await middleware(request(`${configuredStorageKey()}=base64-ab+/cd`));
    expectPassedThrough(response);
    expect(mockVerdict).not.toHaveBeenCalled();
    const errors = errorRecords(errorSpy);
    expect(errors).toHaveLength(1);
    expect(errors[0].msg).toBe('Onboarding check failed; allowing the request through');
  });
});

describe('an address the cookie name cannot be derived from (D-1, F1)', () => {
  it.each([
    ['unset', undefined],
    ['not a url', 'not a url'],
  ])('%s: import does not throw; the request passes with one error line', async (_label, value) => {
    const original = process.env.NEXT_PUBLIC_SUPABASE_URL;
    // The cookie is built while the address is still valid, so it WOULD be read if the name could be derived.
    const cookie = cookieHeader(sessionCookies(sessionWith('tok-x')));
    try {
      if (value === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      else process.env.NEXT_PUBLIC_SUPABASE_URL = value;

      let isolated: typeof import('@/middleware') | undefined;
      expect(() => {
        jest.isolateModules(() => {
          // eslint-disable-next-line @typescript-eslint/no-require-imports -- a fresh import under the broken address is the point
          isolated = require('@/middleware');
        });
      }).not.toThrow();

      mockVerdict.mockResolvedValue('onboard');
      const response = await (isolated as typeof import('@/middleware')).middleware(request(cookie));

      expectPassedThrough(response);
      expect(mockVerdict).not.toHaveBeenCalled();
      const errors = errorRecords(errorSpy);
      expect(errors).toHaveLength(1);
      expect(errors[0].msg).toBe(
        'Session cookie name cannot be derived: the public Supabase address is missing or invalid; skipping the onboarding check'
      );
    } finally {
      if (original === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      else process.env.NEXT_PUBLIC_SUPABASE_URL = original;
    }
  });
});
