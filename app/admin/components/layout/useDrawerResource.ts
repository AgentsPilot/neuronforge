/**
 * The drawer's own read (Admin Layout Standard C-9, §5.8 D-7; SA Q-9 and M-4 on
 * L-8): for a drawer that owns a request, keyed by the row it shows.
 *
 * The page passes `read(key, signal)`, which does the `fetch` AND the body read
 * and answers `{ ok: true, data }` or `{ ok: false, message }` in its own words
 * (a 404 decided on the status before the body, the route's error string, the
 * page's fallback). This hook only manages the state around it, so the shared
 * folder stays fetch-free (L-1e F-1: only the business picker fetches) and only
 * `readJsonBody.ts` reads a body (S-6).
 *
 * - Key `null` (the drawer is closed): `idle`, and no read.
 * - Key set or changed: `loading`, then ONE read with a fresh `AbortController`.
 *   The previous read is aborted and anything it answers later is ignored
 *   (newest wins). Closing aborts too, and so does unmounting. Reopening the
 *   same key after a close reads again.
 * - A read that rejects while current shows `ADMIN_NETWORK_ERROR` (§5.10 rule
 *   3), never the rejection's own text. A rejection after an abort sets nothing.
 * - The latest `read` is kept in a ref and only `key` starts a read, so a page
 *   may pass an inline function.
 * - No stale frame (SA M-4): the state remembers the key it belongs to, and the
 *   hook answers `loading` whenever that key is not the current one. A key
 *   change A to B therefore never renders A's data under B's title, not even
 *   for the one render before the effect runs.
 *
 * No `'use client'`: a hook module, as `useAdminFilters.ts`; the client
 * component that calls it carries the directive.
 */

import { useEffect, useRef, useState } from 'react';

import { ADMIN_NETWORK_ERROR } from './readAdminResponse';

/** What the page's `read` answers: the data, or one admin-facing message. */
export type DrawerRead<T> = { ok: true; data: T } | { ok: false; message: string };

export type DrawerResourceState<T> =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: T };

export type DrawerReader<T> = (key: string, signal: AbortSignal) => Promise<DrawerRead<T>>;

const IDLE = { kind: 'idle' } as const;
const LOADING = { kind: 'loading' } as const;

interface Settled<T> {
  /** The key this answer belongs to (SA M-4). */
  key: string;
  state: { kind: 'error'; message: string } | { kind: 'ready'; data: T };
}

export function useDrawerResource<T>(key: string | null, read: DrawerReader<T>): DrawerResourceState<T> {
  // Declared before the read effect, so a commit that changes both the key and
  // the function runs the read with the new function.
  const readRef = useRef(read);
  useEffect(() => {
    readRef.current = read;
  }, [read]);

  const [settled, setSettled] = useState<Settled<T> | null>(null);

  useEffect(() => {
    if (key === null) {
      // Closed: forget the last answer, so reopening the same key shows
      // `loading` until its new read lands, never the earlier figures.
      setSettled(null);
      return;
    }
    let current = true;
    const controller = new AbortController();
    // A `read` that throws before returning a promise lands in the rejection
    // branch below instead of escaping the effect (QA L-8b E-2). Called in the
    // same tick, so the read still starts with the effect.
    let pending: ReturnType<typeof readRef.current>;
    try {
      pending = readRef.current(key, controller.signal);
    } catch (err) {
      pending = Promise.reject(err);
    }
    pending.then(
      (result) => {
        if (!current) return;
        setSettled({
          key,
          state: result.ok ? { kind: 'ready', data: result.data } : { kind: 'error', message: result.message },
        });
      },
      () => {
        // An abort (close, key change, unmount) is not a failure of the
        // current read: nothing to show. Otherwise the shared words (§5.10).
        if (!current) return;
        setSettled({ key, state: { kind: 'error', message: ADMIN_NETWORK_ERROR } });
      },
    );
    return () => {
      current = false;
      controller.abort();
    };
  }, [key]);

  if (key === null) return IDLE;
  if (settled === null || settled.key !== key) return LOADING;
  return settled.state;
}
