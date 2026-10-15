import 'server-only';

/**
 * The platform's custom design tokens, read on the server (performance slice
 * TH-1, TH-2 folded in), so the brand colours are in the HTML from the first
 * frame instead of arriving from a browser database read after mount.
 *
 * ── Data access (CLAUDE.md rules 1 and 4) ───────────────────────────────────
 * Through `systemConfigRepository.getByKey`, whose default client is
 * `supabaseServer` (service role). INTENTIONAL RLS BYPASS: global platform
 * setting, no `user_id` column. `system_settings_config` is a platform-wide
 * key/value table; this is one read-only value that every owner sees, the key
 * is a module constant (never caller-supplied), and nothing user-specific is
 * read, cached or returned. The service role also keeps this read working when
 * TH-2b tightens the table's anon read policy.
 *
 * ── The guarantees, each asserted in `__tests__/readV2CustomTokens.test.ts` ──
 *   1. Never throws, never rejects. Safe to leave dangling when the payment
 *      hold redirects.
 *   2. Returns only validated values (`sanitizeV2CustomTokens`), deep-frozen.
 *   3. Process-level cache, single-flight, STALE-WHILE-REVALIDATE (SA RC-15):
 *      when a last good value exists it is returned at once, whether fresh,
 *      expired or in back-off; an expired value starts (or joins) the single
 *      refresh WITHOUT waiting for it, and the next load gets the new value.
 *      A back-off after a failure applies with or without a last good value.
 *   4. Only a call with NO last good value waits, and never longer than
 *      `V2_CUSTOM_TOKENS_DEADLINE_MS` (a page) or the caller's own `waitMs`
 *      (the correction route). `readV2CustomTokensWithStatus` says whether the
 *      answer is KNOWN (a completed read, including a known-empty reset) or
 *      UNKNOWN (no completed read yet), so the provider can correct a cold
 *      render from the browser (SA RC-16).
 *
 * ── A refresh that outlives its request ─────────────────────────────────────
 * The background refresh is a plain promise that never rejects (`refresh`
 * catches everything). If the platform freezes the instance after the
 * response, the flight resumes or times out on the next invocation; the stale
 * value keeps being served meanwhile, and the back-off covers a dropped
 * socket. Deliberately no `waitUntil`/`after` (not stable in Next 14.2; a new
 * pattern).
 *   5. Logs key names, counts, reasons and durations, never a token value.
 *      Every completed read logs one `info` line with `{ ms, keys }` (SA CR-1):
 *      production logs at `info` only, and that line is the data source for
 *      the cold-miss read-time gate (workplan §7.3, RC-10(e)). At most one per
 *      TTL per instance, plus one per back-off while failing.
 *
 * Only `force-dynamic` segments may call it (guard G-9): a static render would
 * bake the tokens into build output.
 */

import { createLogger } from '@/lib/logger';
import { systemConfigRepository } from '@/lib/repositories/SystemConfigRepository';
import {
  V2_CUSTOM_TOKENS_CONFIG_KEY,
  sanitizeV2CustomTokensDetailed,
  type V2CustomTokens,
} from '@/lib/design-system-v2/customTokens';

const logger = createLogger({ module: 'V2CustomTokensRead' });

/**
 * How long a read value is served without refreshing it. The tokens are
 * cosmetic, platform-wide and changed only by an admin, a few times a year.
 * After it, the stale value is still served at once while one background
 * refresh runs (RC-15), so a change reaches each instance within the TTL plus
 * one page load, and a warm instance reads at most once a minute.
 */
export const V2_CUSTOM_TOKENS_TTL_MS = 60_000;

/**
 * After a failed read, do not ask again for this long, whether or not a last
 * good value exists. Otherwise a database outage on a cold instance would cost
 * one query per page load.
 */
export const V2_CUSTOM_TOKENS_RETRY_BACKOFF_MS = 10_000;

/**
 * The longest a page waits, and only a page with NO last good value (a cold
 * instance) ever waits (RC-15). `supabaseFetch` times out at 20 s in production
 * and does not retry an abort, and the read is single-flight, so without this
 * one stalled socket would hold every cold owner page on the instance for up to
 * 20 s. Past the deadline the page renders the defaults, the read carries on
 * and fills the cache, and the provider corrects that page from the browser
 * because the answer was UNKNOWN (SA RC-10, RC-16).
 */
export const V2_CUSTOM_TOKENS_DEADLINE_MS = 1000;

/**
 * How long the browser correction route (`/api/design-system/v2-custom-tokens`)
 * may wait for a cold read. It holds no page, so it can wait longer than a page;
 * it races the SAME single flight, it does not start a second reader (RC-16).
 */
export const V2_CUSTOM_TOKENS_ROUTE_WAIT_MS = 5000;

const EMPTY: V2CustomTokens = Object.freeze({});

interface CacheState {
  /** The last successfully read value, if any. */
  value: V2CustomTokens | null;
  /** When `value` was read. */
  storedAtMs: number;
  /** No new read before this time (after a failure). */
  retryNotBeforeMs: number;
  /** The read in flight, shared by every caller. */
  inFlight: Promise<void> | null;
}

let state: CacheState = { value: null, storedAtMs: 0, retryNotBeforeMs: 0, inFlight: null };

/** Tests only. No production file may call it (guard G-11). */
export function __resetV2CustomTokensCacheForTests(): void {
  state = { value: null, storedAtMs: 0, retryNotBeforeMs: 0, inFlight: null };
}

function fallback(): V2CustomTokens {
  return state.value ?? EMPTY;
}

/** One read; updates the cache. Never rejects. */
async function refresh(): Promise<void> {
  const startedAt = Date.now();
  try {
    const { data, error } = await systemConfigRepository.getByKey(V2_CUSTOM_TOKENS_CONFIG_KEY);
    if (error) {
      // getByKey has already logged the error with its `err`; no second copy.
      logger.warn({ reason: 'read_failed', ms: Date.now() - startedAt }, 'Custom tokens unavailable; serving the last good value or the defaults');
      state.retryNotBeforeMs = Date.now() + V2_CUSTOM_TOKENS_RETRY_BACKOFF_MS;
      return;
    }

    // No row (a reset, or never saved) is a valid answer: the defaults.
    const raw: unknown = data ? data.value : null;
    if (raw !== null && raw !== undefined && (typeof raw !== 'object' || Array.isArray(raw))) {
      logger.warn({ err: new Error(`v2_custom_tokens is a ${Array.isArray(raw) ? 'array' : typeof raw}`) }, 'Custom tokens are not an object; using the defaults');
    }
    const { tokens, droppedKeys } = sanitizeV2CustomTokensDetailed(raw);
    if (droppedKeys.length > 0) {
      logger.warn({ droppedKeys }, 'Ignored custom tokens that are not valid; their defaults apply');
    }
    state.value = tokens;
    state.storedAtMs = Date.now();
    state.retryNotBeforeMs = 0;
    logger.info({ ms: Date.now() - startedAt, keys: Object.keys(tokens).length }, 'Custom tokens read');
  } catch (err) {
    logger.warn({ err, ms: Date.now() - startedAt }, 'Custom tokens read threw; serving the last good value or the defaults');
    state.retryNotBeforeMs = Date.now() + V2_CUSTOM_TOKENS_RETRY_BACKOFF_MS;
  }
}

/**
 * Start (or join) the single read in flight. No deadline is armed here: a
 * background (stale-while-revalidate) refresh has nobody waiting, so it must
 * not log "this page uses the defaults" (SA-D1). A waiting caller arms it with
 * `deadlineOf`, at most once per flight.
 */
function startFlight(): Promise<void> {
  if (!state.inFlight) {
    const flight = refresh().finally(() => {
      if (state.inFlight === flight) state.inFlight = null;
    });
    state.inFlight = flight;
  }
  return state.inFlight;
}

const deadlineFor = new WeakMap<Promise<void>, Promise<void>>();

/** The page deadline for this flight, armed on first need, once per flight. */
function deadlineOf(flight: Promise<void>): Promise<void> {
  let deadline = deadlineFor.get(flight);
  if (!deadline) {
    deadline = makeDeadline(flight);
    deadlineFor.set(flight, deadline);
  }
  return deadline;
}

/** Resolves at the deadline (logging once) unless the flight finishes first. */
function makeDeadline(flight: Promise<void>): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      logger.warn({ deadlineMs: V2_CUSTOM_TOKENS_DEADLINE_MS }, 'Custom tokens read is slow; this page uses the last good value or the defaults');
      resolve();
    }, V2_CUSTOM_TOKENS_DEADLINE_MS);
    // Clear the timer when the read wins, so nothing lingers.
    void flight.then(() => clearTimeout(timer));
  });
}

export interface V2CustomTokensResult {
  tokens: V2CustomTokens;
  /**
   * True once a read has completed in this process (`state.value !== null`),
   * including a known-empty reset (`{}`). False when nothing has completed yet:
   * the caller is rendering the defaults without knowing they are right.
   */
  known: boolean;
}

function current(): V2CustomTokensResult {
  return { tokens: fallback(), known: state.value !== null };
}

/**
 * The tokens and whether they are known. Never rejects.
 *
 * `waitMs` is how long a call with no last good value may wait for the shared
 * flight; it defaults to the page deadline. A call with a value never waits.
 */
export async function readV2CustomTokensWithStatus(
  options: { waitMs?: number } = {}
): Promise<V2CustomTokensResult> {
  try {
    const now = Date.now();
    const inBackoff = now < state.retryNotBeforeMs;

    if (state.value) {
      // Stale-while-revalidate: never make a page wait when a value exists.
      if (now - state.storedAtMs > V2_CUSTOM_TOKENS_TTL_MS && !inBackoff) void startFlight();
      return current();
    }

    if (inBackoff) return current();

    const done = startFlight();
    const waitMs = options.waitMs;
    if (waitMs === undefined || waitMs === V2_CUSTOM_TOKENS_DEADLINE_MS) {
      await Promise.race([done, deadlineOf(done)]);
    } else {
      // A caller with its own wait (the correction route) races the same flight
      // against its own timer, cleared when the flight wins.
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        done,
        new Promise<void>((resolve) => { timer = setTimeout(resolve, waitMs); }),
      ]);
      if (timer) clearTimeout(timer);
    }
    return current();
  } catch (err) {
    // Unreachable by construction (refresh never rejects); kept so the contract
    // "never rejects" does not depend on that.
    logger.warn({ err }, 'Custom tokens read failed unexpectedly; using the defaults');
    return current();
  }
}

/**
 * What the four layouts call (the name their placement guards pin): the tokens
 * and whether they are known, with the page deadline. The layout passes
 * `known` to `V2ThemeProvider` as `customTokensKnown` (RC-16).
 */
export function readV2CustomTokens(): Promise<V2CustomTokensResult> {
  return readV2CustomTokensWithStatus();
}
