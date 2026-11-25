/**
 * The session cookie name and reader the middleware uses (PROD-1a, A2; SA
 * D-1, D-3, C-2, C-6). Workplan section 10.1.
 *
 * Every address that looks like a hosted project is built from parts
 * (`'a'.repeat(20)`), so the hardcoded-ref guard (envConfigHardening G-5)
 * does not read a fixture as a real project's (C-2).
 */

import { createClient } from '@supabase/supabase-js';

import { readSessionAccessToken, supabaseAuthStorageKey, supabaseProjectRef } from '@/lib/supabaseAuthCookie';
import { cookieHeader, sessionCookies, sessionWith, type CookiePair } from '@/tests/helpers/supabaseSessionCookie';

const HOSTED_REF = 'a'.repeat(20);
const HOSTED = `https://${HOSTED_REF}.supabase.co`;
const KEY = `sb-${HOSTED_REF}-auth-token`;

/** A cookie jar lookup over name/value pairs, as `request.cookies.get(name)?.value` gives. */
function jar(pairs: CookiePair[]): (name: string) => string | undefined {
  const byName = new Map(pairs.map(({ name, value }) => [name, value]));
  return (name) => byName.get(name);
}

/**
 * What supabase-js itself does with an address: throws, or builds a client
 * whose default storage key we read back. Construction opens no connection
 * (no session persisted, no refresh timer); `tests/jest-no-network.ts` would
 * refuse one if it tried.
 */
function supabaseJsStorageKey(url: string | undefined): { threw: true } | { threw: false; storageKey: string } {
  let client: unknown;
  try {
    // `as string`: supabase-js types the address as a string, but its own
    // validation is what decides an undefined one, and that is the behaviour
    // under test.
    client = createClient(url as string, 'k', { auth: { persistSession: false, autoRefreshToken: false } });
  } catch {
    return { threw: true };
  }
  // `storageKey` is protected on SupabaseClient; read through a structural
  // cast because the parity with it is the whole point of this test.
  return { threw: false, storageKey: (client as { storageKey: string }).storageKey };
}

describe('supabaseAuthStorageKey', () => {
  it('a hosted address gives sb-<ref>-auth-token', () => {
    expect(supabaseProjectRef(HOSTED)).toBe(HOSTED_REF);
    expect(supabaseAuthStorageKey(HOSTED)).toBe(KEY);
  });

  it('a custom domain or a local address follows the first host label, as supabase-js does', () => {
    expect(supabaseAuthStorageKey('https://db.example.com')).toBe('sb-db-auth-token');
    expect(supabaseAuthStorageKey('http://127.0.0.1:54321')).toBe('sb-127-auth-token');
  });

  it.each([[''], ['   '], ['not a url'], ['ftp://x.example.com']])('is null, without throwing, for %p (failure path)', (url) => {
    expect(() => supabaseAuthStorageKey(url)).not.toThrow();
    expect(supabaseAuthStorageKey(url)).toBeNull();
  });

  it('reads NEXT_PUBLIC_SUPABASE_URL when called, not at import, and is null when it is unset', () => {
    const original = process.env.NEXT_PUBLIC_SUPABASE_URL;
    try {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      expect(supabaseAuthStorageKey()).toBeNull();
      process.env.NEXT_PUBLIC_SUPABASE_URL = HOSTED;
      expect(supabaseAuthStorageKey()).toBe(KEY);
    } finally {
      if (original === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      else process.env.NEXT_PUBLIC_SUPABASE_URL = original;
    }
  });
});

describe('parity with supabase-js (R-4, C-6)', () => {
  /*
   * The D-1 premise: when we cannot name the cookie, supabase-js cannot build
   * a client from the same address either, so nobody can be signed in for
   * the gate to miss. Asserted both ways over addresses that include the two
   * the previous helper refused although supabase-js accepts them (an IPv6
   * loopback and an underscore host). With that helper this table fails.
   */
  const ADDRESSES: Array<string | undefined> = [
    undefined,
    '',
    '   ',
    'not a url',
    'ftp://x.example.com',
    'http://',
    'http://[::1]:54321',
    'http://under_score:54321',
    HOSTED,
    `  ${HOSTED}/  `,
    `HTTPS://${'B'.repeat(20)}.supabase.co`,
    'https://db.example.com',
    'http://127.0.0.1:54321',
    'http://localhost:54321',
  ];

  it.each(ADDRESSES.map((url) => [url]))('%p: null exactly where createClient throws, else the same storage key', (url) => {
    const original = process.env.NEXT_PUBLIC_SUPABASE_URL;
    try {
      // `undefined` would otherwise fall back to the configured address (the default parameter).
      if (url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      const ours = supabaseAuthStorageKey(url);
      const theirs = supabaseJsStorageKey(url);
      if (theirs.threw) {
        expect(ours).toBeNull();
      } else {
        expect(ours).toBe(theirs.storageKey);
      }
    } finally {
      if (original === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      else process.env.NEXT_PUBLIC_SUPABASE_URL = original;
    }
  });

  it('names the two hosts the old helper refused, so the gate cannot silently go off there', () => {
    expect(supabaseAuthStorageKey('http://[::1]:54321')).not.toBeNull();
    expect(supabaseAuthStorageKey('http://under_score:54321')).toBe('sb-under_score-auth-token');
  });
});

describe('readSessionAccessToken', () => {
  it('reads an unchunked session cookie (the form small sessions take, D-3)', async () => {
    const cookies = sessionCookies(sessionWith('tok-single'), KEY);
    expect(cookies.map((c) => c.name)).toEqual([KEY]);
    await expect(readSessionAccessToken(jar(cookies), KEY)).resolves.toBe('tok-single');
  });

  it('reassembles a chunked session (.0, .1, ...)', async () => {
    const cookies = sessionCookies(sessionWith('tok-chunked', 6000), KEY);
    expect(cookies.length).toBeGreaterThan(1);
    expect(cookies[0].name).toBe(`${KEY}.0`);
    await expect(readSessionAccessToken(jar(cookies), KEY)).resolves.toBe('tok-chunked');
  });

  it('reads a plain-JSON value, as the library does when the base64- prefix is absent', async () => {
    const value = JSON.stringify({ access_token: 'tok-plain' });
    await expect(readSessionAccessToken(jar([{ name: KEY, value }]), KEY)).resolves.toBe('tok-plain');
  });

  it('prefers the unchunked cookie when both forms are present, as the library does', async () => {
    const pairs = [...sessionCookies(sessionWith('tok-chunked', 6000), KEY), ...sessionCookies(sessionWith('tok-single'), KEY)];
    await expect(readSessionAccessToken(jar(pairs), KEY)).resolves.toBe('tok-single');
  });

  it('is null with no cookie, a lone code-verifier cookie, or no access token', async () => {
    await expect(readSessionAccessToken(jar([]), KEY)).resolves.toBeNull();
    await expect(readSessionAccessToken(jar([{ name: `${KEY}-code-verifier`, value: 'base64-eyJ9' }]), KEY)).resolves.toBeNull();
    const noToken = sessionCookies({ refresh_token: 'r' }, KEY);
    await expect(readSessionAccessToken(jar(noToken), KEY)).resolves.toBeNull();
    const nonString = sessionCookies({ access_token: 42 }, KEY);
    await expect(readSessionAccessToken(jar(nonString), KEY)).resolves.toBeNull();
  });

  it('ignores another project’s session', async () => {
    const other = sessionCookies(sessionWith('tok-other'), `sb-${'z'.repeat(20)}-auth-token`);
    await expect(readSessionAccessToken(jar(other), KEY)).resolves.toBeNull();
  });

  it('throws on a malformed value, for the caller’s catch (failure path)', async () => {
    // Standard base64 with `+` and `/`, which the base64url reader rejects.
    await expect(readSessionAccessToken(jar([{ name: KEY, value: 'base64-ab+/cd' }]), KEY)).rejects.toThrow();
    await expect(readSessionAccessToken(jar([{ name: KEY, value: 'not json{' }]), KEY)).rejects.toThrow();
  });

  it('the shared fixture writer produces a header the middleware can carry', () => {
    const header = cookieHeader(sessionCookies(sessionWith('t'), KEY));
    expect(header.startsWith(`${KEY}=base64-`)).toBe(true);
  });
});
