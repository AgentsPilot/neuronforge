/**
 * Whether a session still needs onboarding, asked as rarely as possible.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A MODULE AND NOT TEN LINES OF MIDDLEWARE
 *
 * It was ten lines of middleware, and it cost two network round trips on EVERY
 * request that was not explicitly exempt: `auth.getUser` against Supabase Auth
 * (measured at 1.58s) and a `business_profiles` read (another 262ms). Nothing
 * remembered the answer and nothing shared a lookup, so a burst of requests
 * meant a burst of round trips. It took the dev server down and it took Vercel
 * down for a second account.
 *
 * Lifted out so the caching and the deduplication can be TESTED. They are the
 * load-bearing part of the fix and they were previously unreachable from a
 * test, which is how the measurement that "proved" the fix turned out to be
 * measuring nothing at all.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { supabaseFetch } from '@/lib/supabaseFetch'

/**
 * The onboarding verdict, remembered for a moment.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * Deciding whether a user still needs onboarding cost TWO network round trips
 * on every single request: `auth.getUser` against Supabase Auth (measured at
 * 1.58s) and a `business_profiles` read (another 262ms). Nothing remembered the
 * answer, so the next request paid it again, and the one after that.
 *
 * The answer is close to immutable. A user completes onboarding once and then
 * never needs asking again; the only transition that matters is false → true,
 * and it happens on a page that is itself exempt from this check.
 *
 * Sixty seconds is therefore a bound on one specific piece of staleness, and it
 * is worth being exact about which, because nothing here invalidates on
 * completion — there is no setter, and `/onboarding-chat` is bypassed before
 * this is ever reached, so finishing onboarding writes nothing to this cache.
 *
 * What that costs: a `false` is only ever cached at the moment a user is
 * redirected INTO onboarding. If they finish within sixty seconds of that
 * redirect, their first protected page bounces them back once, and the next
 * attempt succeeds. Onboarding takes rather longer than a minute, so the case
 * is narrow — but it is a real bounce, not an impossible one.
 *
 * Who that now covers changed. While the profile read used `single`, a missing
 * row came back as an error and was never cached, so almost nobody held a
 * cached `false`. The read now distinguishes the two, and the typical holder of
 * a cached `false` is the user with no profile row at all — most of this
 * project's users. The window is the same width; the set inside it is not.
 *
 * Should that ever matter, the fix is a `rememberOnboarding(token, true)`
 * exported from here and called where completion is written. It is deliberately
 * NOT done on spec: it would put a cache-coherence dependency on the completion
 * path to buy back one redirect in a minute-wide window.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PER INSTANCE, ON PURPOSE
 *
 * This is in-process, so it does nothing for a cold start and nothing across
 * serverless instances. That is fine and is the whole point: the problem being
 * solved is a BURST — many requests arriving at one warm instance at once —
 * not a slow first request. A shared cache would be another dependency on the
 * path whose latency started this.
 *
 * Keyed on the access token rather than a user id, so the key is already
 * scoped to one session and a rotated token simply misses.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const ONBOARDING_TTL_MS = 60_000
/** Bounded, so a long-lived instance cannot grow one entry per token forever. */
const ONBOARDING_CACHE_MAX = 500

const onboardingCache = new Map<string, { completed: boolean; expiresAt: number }>()

function cachedOnboarding(token: string): boolean | null {
  const hit = onboardingCache.get(token)
  if (!hit) return null

  if (hit.expiresAt < Date.now()) {
    onboardingCache.delete(token)
    return null
  }

  return hit.completed
}

/**
 * Lookups currently in flight, keyed the same way.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PIECE THE RESULT CACHE CANNOT DO.
 *
 * A result cache only helps the SECOND request. Twelve prefetches arriving in
 * the same millisecond all miss it, because none of them has finished yet —
 * so all twelve start their own `auth.getUser` against a dependency measured
 * at 1.58 seconds. That simultaneity is the burst, and it is what took the
 * server down.
 *
 * Sharing the promise collapses them into one round trip. The twelfth request
 * awaits the first request's answer rather than asking again.
 *
 * Deleted in a `finally`, so a rejection cannot leave a poisoned entry that
 * every later request awaits forever.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const inflight = new Map<string, Promise<'ok' | 'onboard' | 'unknown'>>()

function rememberOnboarding(token: string, completed: boolean): void {
  /* Oldest-first eviction. `Map` preserves insertion order, so the first key
     is the least recently added. */
  if (onboardingCache.size >= ONBOARDING_CACHE_MAX) {
    const oldest = onboardingCache.keys().next().value
    if (oldest) onboardingCache.delete(oldest)
  }

  onboardingCache.set(token, { completed, expiresAt: Date.now() + ONBOARDING_TTL_MS })
}

/**
 * One service-role client for the whole instance.
 *
 * `createClient` was called per request, allocating a client and its fetch
 * machinery for a single read. It holds no per-request state, so one is
 * enough.
 */
/* Explicitly `SupabaseClient`, not `ReturnType<typeof createClient>`: the
   latter resolves the generic's defaults and infers every row as `never`,
   which the inline call never did because it inferred at the call site. */
let serviceClient: SupabaseClient | null = null

function getServiceClient() {
  if (!serviceClient) {
    serviceClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      /* Under the same connection cap as every other Supabase client. A client
         that opts out of the bound re-opens the hole for its own traffic. */
      { global: { fetch: supabaseFetch } }
    )
  }
  return serviceClient
}

/**
 * Does this session still need onboarding? Asked at most once per token, and
 * at most once concurrently.
 *
 * `unknown` means the question could not be answered — no user, the auth call
 * failed, or the profile read failed. The caller continues in that case,
 * exactly as the original code did: this is UX routing, and the protected
 * pages do their own auth.
 */
export async function onboardingVerdict(
  accessToken: string,
  log: {
    debug: (c: Record<string, unknown>, m: string) => void
    warn: (c: Record<string, unknown>, m: string) => void
  }
): Promise<'ok' | 'onboard' | 'unknown'> {
  const remembered = cachedOnboarding(accessToken)
  if (remembered !== null) return remembered ? 'ok' : 'onboard'

  /* Somebody is already asking. Wait for their answer instead of asking too. */
  const existing = inflight.get(accessToken)
  if (existing) return existing

  const lookup = (async (): Promise<'ok' | 'onboard' | 'unknown'> => {
    const supabase = getServiceClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken)
    log.debug({ hasUser: !!user, hasAuthError: !!authError }, 'Token verified')

    if (authError || !user) return 'unknown'

    /* `maybeSingle`, not `single`. A user with no profile row is the normal
       state before onboarding — most of this project's users are in it — but
       `single` reports it as a PGRST116 error, indistinguishable here from the
       database being unreachable. The two need opposite answers, so the read
       must stop conflating them. */
    const { data: profile, error: profileError } = await supabase
      .from('business_profiles')
      .select('onboarding_completed')
      .eq('user_id', user.id)
      .maybeSingle()

    log.debug(
      {
        userId: user.id,
        hasProfile: !!profile,
        onboardingCompleted: profile?.onboarding_completed ?? null,
        profileError: profileError?.message,
      },
      'Onboarding status resolved'
    )

    /*
     * A failed read is not an answer, so it must not become a redirect.
     *
     * This used to fall through to 'onboard', which on 2026-10-29 turned one
     * bad service-role credential into an outage: every request was sent to
     * `/onboarding-chat`, which sent the user back, which redirected again. A
     * loop, with nothing on screen to say what was wrong.
     *
     * 'unknown' lets the request through instead. That is the right way for UX
     * routing to fail — the protected pages do their own authorisation, so the
     * cost is a completed user seeing one page they would have been redirected
     * away from, against nobody being able to use the product at all.
     */
    if (profileError) {
      /* `warn`, not `debug`. The edge logger's threshold is `info` outside
         development (`lib/logger/edge.ts`), so a debug line here is dropped in
         production — and this branch is reached precisely when the database or
         the credential is wrong. Returning 'unknown' quietly would trade the
         redirect loop for a silent one: the onboarding gate off platform-wide,
         with nothing in the logs to attribute it to. Being unable to see it is
         what made 2026-10-29 take an hour and a half. */
      log.warn(
        { err: profileError, userId: user.id },
        'Onboarding profile read failed; answering "unknown" and letting the request through'
      )
      return 'unknown'
    }

    if (profile?.onboarding_completed) {
      rememberOnboarding(accessToken, true)
      return 'ok'
    }

    rememberOnboarding(accessToken, false)
    return 'onboard'
  })()

  inflight.set(accessToken, lookup)

  try {
    return await lookup
  } finally {
    inflight.delete(accessToken)
  }
}

/**
 * Drops every cached and in-flight answer.
 *
 * Exported for tests only. A long-lived instance never needs this; a test that
 * shares state with the previous test is a test that passes for the wrong
 * reason.
 */
export function __resetOnboardingCacheForTests(): void {
  onboardingCache.clear()
  inflight.clear()
  serviceClient = null
}

/** Swaps the Supabase client. Tests only — see the note above. */
export function __setServiceClientForTests(client: SupabaseClient | null): void {
  serviceClient = client
}
