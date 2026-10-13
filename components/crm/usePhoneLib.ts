'use client';

/**
 * The owner-side phone library, fetched after first paint and shared by every field.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY (PERF-2, docs/requirements/PERFORMANCE_IMPROVEMENT_SCOPING.md §11.2 PC-2)
 *
 * `react-phone-number-input` was a static import of the contact modal, the
 * contact drawer's details section and the booking modal, so it was in the
 * first download of every page that could open one of them, before anybody
 * had clicked anything.
 *
 * HOW THE FIELD STILL DRAWS IN THE SAME FRAME AS THE OTHER FIELDS
 *
 * One download per page, started as soon as a component that may show a
 * phone field mounts (or a page calls `usePrefetchPhoneLib`), which is after
 * the page has painted and needs no click (AC-2.1). The module is held here
 * once it arrives, and `usePhoneLib` reads it SYNCHRONOUSLY: a modal or drawer
 * opened after that point renders the real field in its first frame
 * (AC-2.2), with no suspense boundary and no extra render.
 *
 * Only an owner who opens a surface before the download finishes sees
 * `PhoneFieldPlaceholder` in the field's place for that moment. Nothing about
 * the stored value or validation depends on which of the two was on screen
 * (AC-2.4).
 *
 * IF THE DOWNLOAD FAILS (offline after load), the failure is logged and the
 * placeholder shows. It is retried on the next INTERACTION, not only on the
 * next mount: every re-render of a host while the library is missing (the
 * modal opening, the owner typing in another field) tries again, and so does
 * pressing the placeholder itself. That matters because the dashboard's
 * contact modal and the header's booking modal are mounted once and never
 * remount, so a mount-only retry would leave them on the placeholder, with
 * Save disabled for a new contact, until a reload. Nothing throws into the
 * surface around the field.
 *
 * Why not `next/dynamic`: React resolves a lazy component on its first
 * render, so a field first rendered when a modal opens would suspend for at
 * least one frame even with the chunk already downloaded. A plain module
 * holder has no such frame.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useEffect, useSyncExternalStore } from 'react';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'usePhoneLib' });

/** The shape of `components/crm/phoneLib.ts`. A type query: erased at build time. */
export type PhoneLib = typeof import('@/components/crm/phoneLib');

type Status = 'idle' | 'loading' | 'loaded' | 'failed';

let phoneLib: PhoneLib | null = null;
let status: Status = 'idle';
let pending: Promise<PhoneLib | null> | null = null;
const listeners = new Set<() => void>();

function setStatus(next: Status): void {
  status = next;
  listeners.forEach(listener => listener());
}

/**
 * Start (or join) the download. Never rejects: resolves to null on failure,
 * so callers can fire and forget.
 */
export function loadPhoneLib(): Promise<PhoneLib | null> {
  if (phoneLib) return Promise.resolve(phoneLib);
  if (pending) return pending;

  setStatus('loading');
  pending = import('@/components/crm/phoneLib').then(
    mod => {
      phoneLib = mod;
      setStatus('loaded');
      return mod;
    },
    (err: unknown) => {
      logger.warn({ err }, 'Phone library failed to load; the field shows its placeholder');
      // Cleared so the next mount of a phone field tries again.
      pending = null;
      setStatus('failed');
      return null;
    }
  );
  return pending;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getPhoneLib = () => phoneLib;
const getStatus = () => status;
// The server never holds the library, and hydration must match the server.
const getServerPhoneLib = (): PhoneLib | null => null;
const getServerStatus = (): Status => 'idle';

/**
 * The phone library, or null while it is still arriving.
 *
 * Mounting this starts the download, so a component that may show a phone
 * field prefetches it just by being on the page, even while closed.
 */
export function usePhoneLib(): PhoneLib | null {
  const current = useSyncExternalStore(subscribe, getPhoneLib, getServerPhoneLib);
  /*
   * No dependency list on purpose: while the library is missing, every render
   * of the host (open, typing) asks again. `loadPhoneLib` joins a download
   * already in flight and does not remember failures, and a failure changes
   * only `status`, which this hook does not read, so a failed attempt cannot
   * cause the re-render that would retry it: no loop.
   */
  useEffect(() => {
    if (!current) void loadPhoneLib();
  });
  return current;
}

/**
 * True once the download has finished, whether it succeeded or failed.
 *
 * For a page that opens a phone surface on its own at load (a deep link) and
 * should wait for the field rather than draw it late, without ever being
 * blocked by a failed download.
 */
export function usePhoneLibSettled(): boolean {
  const current = useSyncExternalStore(subscribe, getStatus, getServerStatus);
  useEffect(() => {
    void loadPhoneLib();
  }, []);
  return current === 'loaded' || current === 'failed';
}

/**
 * Start the download after first paint, for a page whose phone surfaces are
 * mounted only on click and so cannot prefetch it themselves.
 */
export function usePrefetchPhoneLib(): void {
  useEffect(() => {
    void loadPhoneLib();
  }, []);
}
