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

const log = { debug: () => {}, warn: () => {} };

/** A Supabase stand-in that counts what it was asked and can be made slow. */
function fakeSupabase(opts: {
  user?: { id: string } | null;
  authError?: boolean;
  onboardingCompleted?: boolean | null;
  profileError?: boolean;
  /** A row that EXISTS but whose column is null — distinct from no row. */
  nullColumn?: boolean;
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
          /* `maybeSingle`, matching the module. Under `single` a missing row
             came back as an ERROR, so `onboardingCompleted: null` below was
             modelling something PostgREST never actually returns. */
          maybeSingle: async () => {
            calls.profile++;
            if (opts.profileError) return { data: null, error: new Error('db down') };
            if (opts.nullColumn) return { data: { onboarding_completed: null }, error: null };
            return {
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
    /*
     * The original rule: no profile means onboarding was never finished.
     *
     * Worth pinning hard, because the `maybeSingle` change made this path a
     * non-error. Get it wrong in the other direction and every user who has
     * not yet onboarded — most of them — sails past onboarding instead.
     */
    const { client } = fakeSupabase({ onboardingCompleted: null });
    __setServiceClientForTests(client as never);

    await expect(onboardingVerdict('tok', log)).resolves.toBe('onboard');
  });

  it('answers "unknown" when the PROFILE read fails, and does not redirect', async () => {
    /*
     * ─────────────────────────────────────────────────────────────────────
     * THE OUTAGE TEST.
     *
     * This returned 'onboard' on a failed profile read. On 2026-10-29 one bad
     * service-role credential therefore sent every request to
     * `/onboarding-chat`, which sent the user back, which redirected again —
     * a loop with no error anywhere, for about an hour and a half, and it
     * read as an auth bug rather than a wrong environment variable.
     *
     * A read that failed is not an answer about onboarding. The only honest
     * verdict is 'unknown', which the caller lets through.
     * ─────────────────────────────────────────────────────────────────────
     */
    const { client } = fakeSupabase({ profileError: true });
    __setServiceClientForTests(client as never);

    await expect(onboardingVerdict('tok', log)).resolves.toBe('unknown');
  });

  it('answers "unknown" for a COMPLETED user too, the people the outage actually hurt', async () => {
    /*
     * This takes the same branch as the test above, and deliberately so: when
     * the read fails there is no row to tell the two users apart, which is the
     * whole point. `onboardingCompleted: true` documents WHO was harmed —
     * people who had finished onboarding long ago and were still bounced — not
     * a second code path. The fixture cannot express one, because PostgREST
     * cannot return both a row and an error.
     */
    const { client } = fakeSupabase({ onboardingCompleted: true, profileError: true });
    __setServiceClientForTests(client as never);

    await expect(onboardingVerdict('tok', log)).resolves.toBe('unknown');
  });

  it('treats a row whose onboarding_completed is null as not onboarded', async () => {
    // Pins the truthiness check — the one place a schema default could flip a
    // verdict without anything else in this file changing.
    const { client } = fakeSupabase({ nullColumn: true });
    __setServiceClientForTests(client as never);

    await expect(onboardingVerdict('tok', log)).resolves.toBe('onboard');
  });

  it('warns when the profile read fails, at a level production keeps', async () => {
    /*
     * The edge logger's threshold is `info` outside development, so a `debug`
     * line here would vanish in production — the onboarding gate off
     * platform-wide and nothing in the logs to attribute it to. This assertion
     * is the only thing standing between that and a silent repeat of
     * 2026-10-29.
     */
    const warn = jest.fn();
    const { client } = fakeSupabase({ profileError: true });
    __setServiceClientForTests(client as never);

    await onboardingVerdict('tok', { debug: () => {}, warn });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toHaveProperty('err');
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
          eq: () => ({
            maybeSingle: async () => ({ data: { onboarding_completed: true }, error: null }),
          }),
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
     * A transient error is not an answer. Remembering it would pin a whole
     * session to 'unknown' for the TTL over one bad query — and, before the
     * verdict was corrected, would have held a fully onboarded user in the
     * redirect for that long instead.
     */
    const { client, calls } = fakeSupabase({ profileError: true });
    __setServiceClientForTests(client as never);

    await expect(onboardingVerdict('tok', log)).resolves.toBe('unknown');
    await onboardingVerdict('tok', log);

    expect(calls.getUser).toBe(2);
  });

  it('DOES cache a user who has no profile row yet', async () => {
    /*
     * The counterpart to the test above, and the reason the two must be told
     * apart. Under `single` this was an error and so was never remembered, so
     * the users least likely to have a profile — most of them — paid both
     * round trips on every single request. That is the cost this module
     * exists to remove.
     */
    const { client, calls } = fakeSupabase({ onboardingCompleted: null });
    __setServiceClientForTests(client as never);

    await expect(onboardingVerdict('tok', log)).resolves.toBe('onboard');
    await expect(onboardingVerdict('tok', log)).resolves.toBe('onboard');

    expect(calls.getUser).toBe(1);
    expect(calls.profile).toBe(1);
  });

  it('never caches an auth failure', async () => {
    const { client, calls } = fakeSupabase({ authError: true });
    __setServiceClientForTests(client as never);

    await onboardingVerdict('tok', log);
    await onboardingVerdict('tok', log);

    expect(calls.getUser).toBe(2);
  });
});
