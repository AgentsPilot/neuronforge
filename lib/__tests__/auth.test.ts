/**
 * `getUser` verifies a session as rarely as it safely can.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THESE COUNT, AND WHY
 *
 * Not whether the right user comes back — that was never broken. HOW MANY
 * TIMES it asks Supabase, because 233 API routes call this and each one opened
 * its own remote verification.
 *
 * Opening a single CRM contact drawer fires nine API calls at once. Nine
 * verifications of ONE session went out together, and Supabase began refusing
 * them:
 *
 *     TypeError: fetch failed … read ECONNRESET   at GoTrueClient._getUser
 *     GET /api/scheduling/bookings      401 in 35529ms
 *     GET /api/crm/contacts/…/consent   401 in 35493ms
 *
 * Those 401s were false. The owner was signed in; the connection died and this
 * returned null. An auth failure produced by load is the worst kind, because
 * it locks out exactly the people who are legitimately there.
 *
 * A version of this file where every assertion passes but the call count is
 * one-per-caller is the bug.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const cookieJar: { name: string; value: string }[] = [];
let getUserCalls = 0;
let nextResult: { user: unknown; error: unknown } = { user: { id: 'u1' }, error: null };
let latencyMs = 0;

jest.mock('next/headers', () => ({
  cookies: () => ({
    getAll: () => cookieJar,
    set: () => {},
  }),
}));

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => {
        getUserCalls++;
        if (latencyMs) await new Promise(r => setTimeout(r, latencyMs));
        return { data: { user: nextResult.user }, error: nextResult.error };
      },
    },
  }),
}));

import { getUser } from '@/lib/auth';

/** A distinct session, so each test starts with a cache miss. */
let sessionCounter = 0;
function freshSession() {
  sessionCounter++;
  cookieJar.length = 0;
  cookieJar.push(
    { name: 'sb-proj-auth-token.0', value: `chunk-a-${sessionCounter}` },
    { name: 'sb-proj-auth-token.1', value: `chunk-b-${sessionCounter}` }
  );
}

beforeEach(() => {
  getUserCalls = 0;
  latencyMs = 0;
  nextResult = { user: { id: 'u1' }, error: null };
  freshSession();
});

describe('it still verifies', () => {
  it('returns the user Supabase confirms', async () => {
    await expect(getUser()).resolves.toEqual({ id: 'u1' });
    expect(getUserCalls).toBe(1);
  });

  it('returns null when there is no auth cookie, without asking', async () => {
    cookieJar.length = 0;
    await expect(getUser()).resolves.toBeNull();
    expect(getUserCalls).toBe(0);
  });

  it('returns null when Supabase rejects the token', async () => {
    nextResult = { user: null, error: null };
    await expect(getUser()).resolves.toBeNull();
  });
});

describe('a burst of callers shares one verification', () => {
  it('nine concurrent calls make ONE round trip', async () => {
    /*
     * ─────────────────────────────────────────────────────────────────────
     * THE ONE THAT MATTERS.
     *
     * This is the measured failure: one contact drawer, nine API calls, nine
     * simultaneous verifications, ECONNRESET. A result cache cannot help —
     * none of them has finished. Only sharing the in-flight promise does.
     *
     * The latency is deliberate: with an instant stub they would serialise
     * and the test would pass for the wrong reason.
     * ─────────────────────────────────────────────────────────────────────
     */
    latencyMs = 25;

    const results = await Promise.all(Array.from({ length: 9 }, () => getUser()));

    expect(results.every(r => (r as { id: string })?.id === 'u1')).toBe(true);
    expect(getUserCalls).toBe(1);
  });

  it('does not share between different sessions', async () => {
    latencyMs = 20;
    const a = getUser();

    const first = [...cookieJar];
    freshSession();
    const b = getUser();

    await Promise.all([a, b]);
    expect(getUserCalls).toBe(2);
    expect(first[0].value).not.toBe(cookieJar[0].value);
  });

  it('keys on every auth cookie, not just the first chunk', async () => {
    /*
     * The token is split across cookies once it exceeds 4KB. Keying on one
     * chunk would let two sessions that happen to share it be treated as the
     * same person — an identity collision, not a performance bug.
     */
    await getUser();
    cookieJar[1] = { name: 'sb-proj-auth-token.1', value: 'a-different-second-chunk' };
    await getUser();

    expect(getUserCalls).toBe(2);
  });
});

describe('what is never remembered', () => {
  it('does not cache a rejected session', async () => {
    nextResult = { user: null, error: null };

    await getUser();
    await getUser();

    expect(getUserCalls).toBe(2);
  });

  it('does not cache a dropped connection', async () => {
    /*
     * The failure this whole change exists to stop. An ECONNRESET says
     * nothing about who the caller is; remembering it as "not authenticated"
     * would turn one bad second into a lockout for everyone on the instance.
     */
    nextResult = { user: null, error: new Error('fetch failed: ECONNRESET') };

    await expect(getUser()).resolves.toBeNull();
    await expect(getUser()).resolves.toBeNull();

    expect(getUserCalls).toBe(2);

    // And it recovers the moment Supabase does.
    nextResult = { user: { id: 'u1' }, error: null };
    await expect(getUser()).resolves.toEqual({ id: 'u1' });
  });

  it('clears the in-flight entry when the call throws', async () => {
    /*
     * A rejection left in the map would be awaited by every later caller,
     * forever. The `finally` is what stops one failure becoming permanent.
     */
    const boom = new Error('network');
    jest.spyOn(global, 'setTimeout');

    nextResult = {
      get user(): never {
        throw boom;
      },
      error: null,
    };

    await expect(getUser()).rejects.toThrow('network');

    nextResult = { user: { id: 'u1' }, error: null };
    await expect(getUser()).resolves.toEqual({ id: 'u1' });
  });
});

describe('the second caller pays nothing', () => {
  it('is served from cache', async () => {
    await getUser();
    await getUser();
    await getUser();

    expect(getUserCalls).toBe(1);
  });
});
