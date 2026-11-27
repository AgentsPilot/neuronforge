'use client';

/**
 * The Danger Zone's state (account deletion lifecycle DL-2a; workplan
 * docs/workplans/BUSINESS_OS_DELETION_DL2_WORKPLAN.md §5.2, D-3).
 *
 * The open deletion request is read FIRST, from
 * `GET /api/business-os/account/closure` (not behind the switch, so Keep stays
 * reachable when the switch is off). The pre-check
 * (`/api/business-os/account/deletion-check`, which runs the cleanup function)
 * is read only when no request is open, or when the closure read failed: if
 * a request was in fact open, the request route answers `already_requested`
 * and the panel re-reads.
 *
 *   closure loading         → the pre-check is not started yet; today's body
 *   closure open            → the pending view; the pre-check is never called
 *   closure none or error   → the pre-check's state, as before DL-2a
 *
 * `refreshClosure()` re-reads the closure only (never the pre-check), and
 * resolves with what it read, so the drawer can tell "now open" from "still
 * none" after an answer.
 *
 * Client-safe (SA W-5): the schemas only; no repository, no deps file, no
 * date helper.
 *
 * @module hooks/useAccountClosure
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createLogger } from '@/lib/logger';
import { closureStatusResponseSchema, type ClosureStatusView } from '@/lib/business-os/account-deletion/schemas';
import { useAccountDeletionCheck, type AccountDeletionCheckState } from '@/hooks/useAccountDeletionCheck';

const logger = createLogger({ module: 'useAccountClosure' });

export const ACCOUNT_CLOSURE_URL = '/api/business-os/account/closure';

export type ClosureReadState =
  | { status: 'loading' }
  | { status: 'none' }
  | { status: 'error' }
  | { status: 'open'; closure: ClosureStatusView };

/** One read of the closure route, parsed with the route's own schema. Never throws. */
export async function readClosure(): Promise<Exclude<ClosureReadState, { status: 'loading' }>> {
  if (typeof fetch !== 'function') return { status: 'error' };
  try {
    const response = await fetch(ACCOUNT_CLOSURE_URL, { method: 'GET', credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) {
      logger.warn({ status: response.status }, 'Account closure read did not answer 200');
      return { status: 'error' };
    }
    const parsed = closureStatusResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      logger.warn({ issue: parsed.error.issues[0]?.path.join('.') ?? null }, 'Account closure read answered an unexpected shape');
      return { status: 'error' };
    }
    const closure = parsed.data.data.closure;
    return closure ? { status: 'open', closure } : { status: 'none' };
  } catch (err) {
    logger.warn({ err }, 'Account closure read failed');
    return { status: 'error' };
  }
}

export interface UseAccountClosure {
  state: ClosureReadState;
  refresh: () => Promise<Exclude<ClosureReadState, { status: 'loading' }>>;
}

export function useAccountClosure(): UseAccountClosure {
  const [state, setState] = useState<ClosureReadState>(() => (typeof fetch === 'function' ? { status: 'loading' } : { status: 'error' }));
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    const next = await readClosure();
    if (mounted.current) setState(next);
    return next;
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (typeof fetch === 'function') void refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  return { state, refresh };
}

export interface DangerZoneState {
  closure: ClosureReadState;
  /** The pre-check, meaningful only while `closure` is `none` or `error` (loading until then). */
  check: AccountDeletionCheckState;
  refreshClosure: () => Promise<Exclude<ClosureReadState, { status: 'loading' }>>;
}

/** The pre-check, started only once `isNeeded` turns true. */
function useDeferredDeletionCheck(isNeeded: boolean, lang: string | undefined): AccountDeletionCheckState {
  const { state, start } = useAccountDeletionCheck({ deferred: true, lang });
  useEffect(() => {
    if (isNeeded) start();
  }, [isNeeded, start]);
  return state;
}

export interface UseDangerZoneStateOptions {
  /** DL-2b: the UI language, passed to the pre-check as `?lang=` (the plan name's language). */
  lang?: string;
}

export function useDangerZoneState({ lang }: UseDangerZoneStateOptions = {}): DangerZoneState {
  const { state: closure, refresh } = useAccountClosure();
  // Once a request was seen open in this mount, a later "none" (after Keep) does not start the
  // pre-check: the cleanup function would run for nothing while the kept message is shown.
  const [hasSeenOpen, setHasSeenOpen] = useState(false);
  useEffect(() => {
    if (closure.status === 'open') setHasSeenOpen(true);
  }, [closure.status]);
  const isCheckNeeded = !hasSeenOpen && closure.status !== 'open' && (closure.status === 'none' || closure.status === 'error');
  const check = useDeferredDeletionCheck(isCheckNeeded, lang);
  return { closure, check, refreshClosure: refresh };
}

/**
 * `router.refresh()` of the host page (D-8), through the public
 * `next/navigation` API (SA CR-1). Every Danger Zone host is an App Router
 * page; tests that render a host mock `next/navigation`.
 */
export function useHostRefresh(): () => void {
  const router = useRouter();
  return useCallback(() => {
    router.refresh();
  }, [router]);
}
