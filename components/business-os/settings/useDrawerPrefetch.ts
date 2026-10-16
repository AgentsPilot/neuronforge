'use client';

import { useCallback, useEffect, useRef } from 'react';

/**
 * Start a drawer's reads before it opens, and hand them to it when it does
 * (settings drawer review §0.6 C-5; C-a workplan A-4; SA C-a review Q-1,
 * SA-CA-8).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SCOPE
 *
 * Approved for settings-page drawers; another surface needs SA review. It is a
 * hook owned by the page component, not a cache: no provider, no context, no
 * module-level state and no exported store, so nothing it holds outlives the
 * page (a sign-out, a navigation).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SIX RULES
 *
 * 1. USED ONCE. `take()` hands the held set over and forgets it, usable or not.
 *    A reopen never sees a set from before the last close, so a discarded draft
 *    cannot come back (S-3).
 * 2. MAXIMUM AGE. A set is usable for `maxAgeMs` from the moment it STARTED.
 *    Older, it is dropped and the drawer reads for itself.
 * 3. KEY. Each set is held with the key it was started under (who, in what
 *    language). `take()` hands over only a set whose key is the current one, and
 *    a key change drops it, so one account or language never gets another's.
 * 4. ENABLED. `warm()` does nothing while `enabled` is false, and turning it
 *    false drops the held set. The page turns it off while its own reads run
 *    and while anything that can change the data is open.
 * 5. IDLE. With `warmOnIdle`, it warms once the browser is idle after `enabled`
 *    turns true (`requestIdleCallback`, or a timer where that does not exist).
 *    Unmounting, disabling or pausing first cancels it.
 * 6. PAUSED. While the drawer this hook serves is open, `paused` is true:
 *    `warm()` starts nothing (the idle warm firing late, a timer), because a
 *    save can happen in the drawer and a pair started meanwhile would carry
 *    the data from before it (QA-CA-B1). Turning `paused` false (the drawer
 *    closed) drops whatever is held, so the next warm is fresh.
 *
 *    Pausing is not disabling, on purpose: it does NOT drop on the way in. The
 *    drawer's content sits in a Radix portal, which mounts one commit after
 *    `open` turns true, after the page's effects for that render have run. A
 *    drop on the way in would empty the slot before the drawer took it (T-H6b,
 *    and T-D1/T-D2 with the real drawer, fail that way). `take()` works while
 *    paused; nothing can warm while paused, so all it can hand over is the set
 *    held when the drawer opened.
 *
 * `start` must not throw, and its promises must never reject: they may be
 * started speculatively and never awaited.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** How long a started set stays usable, from its start (SA C-a Q-3). */
export const DRAWER_PREFETCH_MAX_AGE_MS = 60_000;

/** The idle callback's own deadline, and the timer used where it does not exist. */
const IDLE_TIMEOUT_MS = 2_000;
const IDLE_FALLBACK_MS = 1_500;

export interface DrawerPrefetch<T> {
  /** Start the reads now, unless a usable set is already held. Stable identity. */
  warm: () => void;
  /** Hand over the held set if it is usable now, and forget it. Stable identity. */
  take: () => T | null;
}

export interface DrawerPrefetchOptions<T> {
  /** Starts the reads. Must not throw; its promises must never reject. */
  start: () => T;
  /** Who and in what language, e.g. `${userId}:${language}`. `null` = never prefetch. */
  key: string | null;
  /** False while the page is still loading, or while something that can change the data is open. */
  enabled: boolean;
  /** True while the drawer this hook serves is open (rule 6). Default false. */
  paused?: boolean;
  /** How long a started set stays usable, measured from its start. */
  maxAgeMs: number;
  /** Also warm once the browser is idle after `enabled` turns true. */
  warmOnIdle: boolean;
}

interface Held<T> {
  value: T;
  key: string;
  startedAt: number;
}

/** Rules 2 and 3: held, for the current key, and no older than the maximum age. */
function usable<T>(entry: Held<T> | null, key: string | null, maxAgeMs: number): entry is Held<T> {
  return entry !== null && key !== null && entry.key === key && Date.now() - entry.startedAt <= maxAgeMs;
}

export function useDrawerPrefetch<T>(options: DrawerPrefetchOptions<T>): DrawerPrefetch<T> {
  // The latest options, read through a ref so `warm` and `take` keep one
  // identity and can be handed out as event handlers and props.
  const latest = useRef(options);
  latest.current = options;

  const held = useRef<Held<T> | null>(null);

  const warm = useCallback(() => {
    const { start, key, enabled, paused = false, maxAgeMs } = latest.current;
    if (!enabled || paused || key === null) return;
    if (usable(held.current, key, maxAgeMs)) return;
    held.current = { value: start(), key, startedAt: Date.now() };
  }, []);

  const take = useCallback((): T | null => {
    const { key, maxAgeMs } = latest.current;
    const entry = held.current;
    held.current = null;
    return usable(entry, key, maxAgeMs) ? entry.value : null;
  }, []);

  const { enabled, key, warmOnIdle, paused = false } = options;

  // Rules 3 and 4: a new key, or turning off, drops what is held.
  useEffect(() => {
    if (!enabled) held.current = null;
  }, [enabled]);
  // Rule 6: un-pausing drops what is held; pausing does not (the hand-over).
  useEffect(() => {
    if (!paused) held.current = null;
  }, [paused]);
  useEffect(() => {
    held.current = null;
  }, [key]);

  // Rule 5.
  useEffect(() => {
    if (!warmOnIdle || !enabled || paused || key === null) return;
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(() => warm(), { timeout: IDLE_TIMEOUT_MS });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = window.setTimeout(warm, IDLE_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [enabled, paused, key, warmOnIdle, warm]);

  return { warm, take };
}
