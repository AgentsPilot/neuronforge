/**
 * The onboarding check asks Supabase as rarely as it can get away with.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS REALLY TESTING
 *
 * Not "does it return the right answer" — that part was never broken. It is
 * HOW MANY TIMES it asks, because the cost was two network round trips per
 * request with nothing shared and nothing remembered: `auth.getUser` measured
 * at 1.58s and a profile read at 262ms, paid again by the next request, and
 * the one after that.
 *
 * Every assertion below counts calls. A version of this module that returns
 * perfect answers and makes one round trip per caller is the bug.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY BOTH A CACHE AND AN IN-FLIGHT MAP
 *
 * They solve different halves and neither covers the other.
 *
 * A result cache only helps the SECOND caller. Twelve requests arriving in the
 * same millisecond all miss it, because none has finished — so all twelve
 * start their own lookup. That simultaneity is the burst that took the server
 * down, and sharing the in-flight promise is the only thing that collapses it.
 *
 * The in-flight map, in turn, does nothing once a lookup has resolved. That is
 * the cache's half.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  onboardingVerdict,
  __resetOnboardingCacheForTests,
  __setServiceClientForTests,
} from '@/lib/security/onboardingVerdict';

const log = { debug: () => {} };

/** A Supabase stand-in that counts what it was asked and can be made slow. */
function fakeSupabase(opts: {
  user?: { id: string } | null;
  authError?: boolean;
  onboardingCompleted?: boolean | null;
  profileError?: boolean;
  /** Milliseconds the auth call takes, so concurrency can be exercised. */
  latency?: number;
}) {
  const calls = { getUser: 0, profile: 0 };

  const client = {
    auth: {
      getUser: async () => {
        calls.getUser++;
        if (opts.latency) await new Promise(r => setTimeout(r, opts.latency));
        return opts.authError
          ? { data: { user: null }, error: new Error('auth down') }
          : { data: { user: opts.user ?? { id: 'u1' } }, error: null };
      },
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => {
            calls.profile++;
            return opts.profileError
              ? { data: null, error: new Error('db down') }
              : {
                  data:
                    opts.onboardingCompleted === null
                      ? null
                      : { onboarding_completed: opts.onboardingCompleted ?? true },
                  error: null,
                };
          },
        }),
      }),
    }),
  };

  return { client, calls };
}

beforeEach(() => {
  __resetOnboardingCacheForTests();
});

describe('the answer itself', () => {
  it('lets a completed user through', async () => {
    const { client } = fakeSupabase({ onboardingCompleted: true });
    __setServiceClientForTests(client as never);

    await expect(onboardingVerdict('tok', log)).resolves.toBe('ok');
  });

  it('sends an incomplete user to onboarding', async () => {
    const { client } = fakeSupabase({ onboardingCompleted: false });
    __setServiceClientForTests(client as never);

    await expect(onboardingVerdict('tok', log)).resolves.toBe('onboard');
  });

  it('sends a user with no profile row to onboarding', async () => {
    // The original rule: no profile means onboarding was never finished.
    const { client } = fakeSupabase({ onboardingCompleted: null });
    __setServiceClientForTests(client as never);

    await expect(onboardingVerdict('tok', log)).resolves.toBe('onboard');
  });

  it('answers "unknown" when auth fails, and does not redirect on it', async () => {
    /*
     * The caller continues on `unknown`, exactly as the original code did.
     * This is UX routing; the protected pages do their own authorisation, and
     * turning an auth hiccup into a redirect loop would be far worse than
     * letting one request through.
     */
    const { client, calls } = fakeSupabase({ authError: true });
    __setServiceClientForTests(client as never);

    await expect(onboardingVerdict('tok', log)).resolves.toBe('unknown');
    expect(calls.profile).toBe(0);
  });
});

describe('it asks once, not once per request', () => {
  it('serves the second caller from cache, with no round trip at all', async () => {
    const { client, calls } = fakeSupabase({ onboardingCompleted: true });
    __setServiceClientForTests(client as never);

    await onboardingVerdict('tok', log);
    await onboardingVerdict('tok', log);
    await onboardingVerdict('tok', log);

    expect(calls.getUser).toBe(1);
    expect(calls.profile).toBe(1);
  });

  it('caches a redirect as readily as a pass', async () => {
    // Otherwise the users who most need the page to be fast — the ones being
    // bounced to onboarding — keep paying full price.
    const { client, calls } = fakeSupabase({ onboardingCompleted: false });
    __setServiceClientForTests(client as never);

    await onboardingVerdict('tok', log);
    await expect(onboardingVerdict('tok', log)).resolves.toBe('onboard');

    expect(calls.getUser).toBe(1);
  });

  it('keeps separate answers for separate sessions', async () => {
    const { client, calls } = fakeSupabase({ onboardingCompleted: true });
    __setServiceClientForTests(client as never);

    await onboardingVerdict('token-a', log);
    await onboardingVerdict('token-b', log);

    expect(calls.getUser).toBe(2);
  });
});

describe('a burst collapses into one lookup', () => {
  it('twelve simultaneous requests make ONE round trip', async () => {
    /*
     * ─────────────────────────────────────────────────────────────────────
     * THE ONE THAT MATTERS.
     *
     * This is the measured failure: Next prefetches every link in the
     * viewport, a dozen requests land together, and before this they each
     * opened their own 1.58-second call. A result cache cannot help — none
     * of them has finished yet. Only sharing the in-flight promise does.
     *
     * The latency is deliberate: with an instant stub they would serialise
     * and pass for the wrong reason.
     * ─────────────────────────────────────────────────────────────────────
     */
    const { client, calls } = fakeSupabase({ onboardingCompleted: true, latency: 30 });
    __setServiceClientForTests(client as never);

    const results = await Promise.all(
      Array.from({ length: 12 }, () => onboardingVerdict('tok', log))
    );

    expect(results).toEqual(Array(12).fill('ok'));
    expect(calls.getUser).toBe(1);
    expect(calls.profile).toBe(1);
  });

  it('does not share between different sessions in the same burst', async () => {
    const { client, calls } = fakeSupabase({ onboardingCompleted: true, latency: 20 });
    __setServiceClientForTests(client as never);

    await Promise.all([
      onboardingVerdict('a', log),
      onboardingVerdict('a', log),
      onboardingVerdict('b', log),
      onboardingVerdict('b', log),
    ]);

    expect(calls.getUser).toBe(2);
  });

  it('clears the in-flight entry when the lookup throws', async () => {
    /*
     * A rejection left in the map would be awaited by every later request,
     * forever — the failure turning permanent. The `finally` is what stops
     * one bad minute becoming a dead instance.
     */
    let shouldThrow = true;
    const client = {
      auth: {
        getUser: async () => {
          if (shouldThrow) throw new Error('network');
          return { data: { user: { id: 'u1' } }, error: null };
        },
      },
      from: () => ({
        select: () => ({
          eq: () => ({ single: async () => ({ data: { onboarding_completed: true }, error: null }) }),
        }),
      }),
    };
    __setServiceClientForTests(client as never);

    await expect(onboardingVerdict('tok', log)).rejects.toThrow('network');

    shouldThrow = false;
    await expect(onboardingVerdict('tok', log)).resolves.toBe('ok');
  });
});

describe('what is deliberately NOT remembered', () => {
  it('never caches a failed profile read', async () => {
    /*
     * A transient error is not an answer. Remembering it would hold a fully
     * onboarded user in the redirect for the whole TTL over one bad query.
     */
    const { client, calls } = fakeSupabase({ profileError: true });
    __setServiceClientForTests(client as never);

    await expect(onboardingVerdict('tok', log)).resolves.toBe('onboard');
    await onboardingVerdict('tok', log);

    expect(calls.getUser).toBe(2);
  });

  it('never caches an auth failure', async () => {
    const { client, calls } = fakeSupabase({ authError: true });
    __setServiceClientForTests(client as never);

    await onboardingVerdict('tok', log);
    await onboardingVerdict('tok', log);

    expect(calls.getUser).toBe(2);
  });
});
