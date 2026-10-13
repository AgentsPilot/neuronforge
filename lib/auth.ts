import { cookies } from 'next/headers'
import { createHash } from 'crypto'
import { createServerClient } from '@supabase/ssr'
import { supabaseFetch } from '@/lib/supabaseFetch'
import type { User } from '@supabase/supabase-js'

/**
 * Who is calling, verified against Supabase Auth — asked once per session
 * rather than once per request.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FIXES
 *
 * `supabase.auth.getUser()` is a REMOTE call. It is what makes this function
 * trustworthy — it validates the token with the auth server rather than
 * decoding a cookie — and it is also why 233 API routes calling it
 * unconditionally brought the platform down.
 *
 * Opening one CRM contact drawer fires nine API calls at once: activities,
 * tasks, emails, documents, services, availability, money, bookings, consent.
 * Each built its own client and opened its own round trip, so nine
 * verifications of ONE session went out simultaneously. Supabase started
 * refusing them:
 *
 *     TypeError: fetch failed … read ECONNRESET   at GoTrueClient._getUser
 *     GET /api/scheduling/bookings      401 in 35529ms
 *     GET /api/crm/contacts/…/consent   401 in 35493ms
 *     GET /api/payments/money…          200 in 49802ms
 *
 * Note the 401s. The owner was signed in. The connection died, this returned
 * null, and the route reported "not authorised" — a false negative produced by
 * load, which is the worst shape an auth failure can take.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO MECHANISMS, BECAUSE THEY COVER DIFFERENT HALVES
 *
 * The CACHE stops the second caller paying. The IN-FLIGHT map stops nine
 * simultaneous callers each paying, which a cache cannot do because none of
 * them has finished yet. The burst is the thing that broke, so the in-flight
 * map is the load-bearing half.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS NOT TRADED AWAY
 *
 * Verification still happens, against the auth server, exactly as before. What
 * changes is how often.
 *
 * The window is deliberately short. A session revoked mid-flight stays usable
 * for up to `TTL_MS`, and that is a real trade: thirty seconds of a signed-out
 * token still working on owner-facing APIs. It is the right side of the line
 * because the alternative — what is happening now — is signed-IN owners being
 * told they are not authorised, which is both more common and more damaging.
 *
 * A FAILURE IS NEVER CACHED. A dropped connection is not an answer about who
 * someone is, and remembering it would turn one bad second into a minute of
 * lockout for everybody on that instance.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Short: this is an identity check, not a preference. */
const TTL_MS = 30_000

/** Bounded, so a long-lived instance cannot grow one entry per session. */
const MAX_ENTRIES = 500

const verified = new Map<string, { user: User; expiresAt: number }>()

/**
 * Verifications currently in flight.
 *
 * Nine concurrent callers share one round trip instead of opening nine. This
 * is the half that addresses the burst.
 */
const inflight = new Map<string, Promise<User | null>>()

/**
 * The session's own cookies, as a key.
 *
 * Hashed, because these values ARE the session — a Map keyed on raw tokens is
 * a credential store nobody asked for, visible in a heap dump. The hash is
 * one-way and is all the cache needs.
 *
 * Every Supabase auth cookie is included, not just the first: the token is
 * chunked across several when it exceeds 4KB, and keying on one chunk would
 * collide between sessions that happen to share it.
 */
function sessionKey(all: { name: string; value: string }[]): string | null {
  const auth = all
    .filter(c => c.name.includes('auth-token'))
    .sort((a, b) => a.name.localeCompare(b.name))

  if (auth.length === 0) return null

  return createHash('sha256')
    .update(auth.map(c => `${c.name}=${c.value}`).join(';'))
    .digest('hex')
}

function remember(key: string, user: User): void {
  /* Oldest-first eviction; `Map` keeps insertion order. */
  if (verified.size >= MAX_ENTRIES) {
    const oldest = verified.keys().next().value
    if (oldest) verified.delete(oldest)
  }
  verified.set(key, { user, expiresAt: Date.now() + TTL_MS })
}

function cached(key: string): User | null {
  const hit = verified.get(key)
  if (!hit) return null

  if (hit.expiresAt < Date.now()) {
    verified.delete(key)
    return null
  }

  return hit.user
}

export async function getUser() {
  const cookieStore = cookies()
  const key = sessionKey(cookieStore.getAll())

  /* No auth cookie at all: nothing to verify and nothing to cache. */
  if (!key) return null

  const known = cached(key)
  if (known) return known

  const existing = inflight.get(key)
  if (existing) return existing

  const verify = (async (): Promise<User | null> => {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              )
            } catch {
              // The `setAll` method was called from a Server Component.
              // This can be ignored if you have middleware refreshing
              // user sessions.
            }
          },
        },
        /*
         * Under the same connection cap as every other Supabase client.
         *
         * `getUser` is the single most-called query on the platform, and this
         * client sat outside the pool — so the one request every route makes
         * first was also the one with no ceiling on sockets. `supabaseFetch`
         * was written for this exact stack trace (`GoTrueClient._getUser`,
         * ECONNRESET) and never applied here.
         *
         * The cache and the in-flight dedup above reduce how OFTEN this runs;
         * the pool bounds what happens when it does run many times at once.
         * They solve different halves and the second half was missing.
         */
        global: { fetch: supabaseFetch },
      }
    )

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()

    if (error || !user) {
      /*
       * Not remembered, and deliberately so. This is reached both by a
       * genuinely signed-out caller and by a dropped connection, and the two
       * are indistinguishable here. Caching either would make a blip
       * persistent — which is the failure this whole change exists to stop.
       */
      return null
    }

    remember(key, user)
    return user
  })()

  inflight.set(key, verify)

  try {
    return await verify
  } finally {
    /* In a `finally`, so a rejection cannot leave an entry every later caller
       awaits forever. */
    inflight.delete(key)
  }
}
