'use client';

/**
 * The self-delete drawer's data (data export DE-10b.2, workplan §2.7).
 *
 * One read of `GET /api/business-os/account/deletion-check` when the Danger
 * Zone body mounts (it mounts when its dialog or panel opens), and `refresh`
 * for a re-check after the server refused a delete. The response is parsed
 * with the route's own schema.
 *
 *   loading  nothing known yet
 *   off      the switch is off: the Danger Zone keeps today's body
 *   error    the check could not be read: also today's body, so a failure
 *            never shows a delete control that might not work
 *   ready    the switch is on: `data` holds availability, blockers and facts
 *
 * @module hooks/useAccountDeletionCheck
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createLogger } from '@/lib/logger';
import { deletionCheckResponseSchema, type DeletionCheckData } from '@/lib/business-os/account-deletion/schemas';

const logger = createLogger({ module: 'useAccountDeletionCheck' });

export const ACCOUNT_DELETION_CHECK_URL = '/api/business-os/account/deletion-check';

export type EnabledDeletionCheck = Extract<DeletionCheckData, { enabled: true }>;

export type AccountDeletionCheckState =
  | { status: 'loading' }
  | { status: 'off' }
  | { status: 'error' }
  | { status: 'ready'; data: EnabledDeletionCheck };

export interface UseAccountDeletionCheck {
  state: AccountDeletionCheckState;
  refresh: () => Promise<void>;
  /** Deferred mode (DL-2a): the first read, once; later calls do nothing. */
  start: () => void;
}

export interface UseAccountDeletionCheckOptions {
  /**
   * DL-2a (DL-2 workplan §5.2, D-3): do not read on mount; wait for `start()`.
   * The Danger Zone reads the open closure first and needs the pre-check only
   * when no request is open, so it never runs the cleanup function for an
   * account that already asked.
   */
  deferred?: boolean;
}

async function readCheck(): Promise<AccountDeletionCheckState> {
  if (typeof fetch !== 'function') return { status: 'error' };
  try {
    const response = await fetch(ACCOUNT_DELETION_CHECK_URL, { method: 'GET', credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) {
      logger.warn({ status: response.status }, 'Account deletion check did not answer 200');
      return { status: 'error' };
    }
    const parsed = deletionCheckResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      logger.warn({ issue: parsed.error.issues[0]?.path.join('.') ?? null }, 'Account deletion check answered an unexpected shape');
      return { status: 'error' };
    }
    return parsed.data.data.enabled ? { status: 'ready', data: parsed.data.data } : { status: 'off' };
  } catch (err) {
    logger.warn({ err }, 'Account deletion check failed');
    return { status: 'error' };
  }
}

export function useAccountDeletionCheck({ deferred = false }: UseAccountDeletionCheckOptions = {}): UseAccountDeletionCheck {
  // No fetch at all (an old browser, a test without one): today's body from the first render, no request.
  const [state, setState] = useState<AccountDeletionCheckState>(() =>
    typeof fetch === 'function' ? { status: 'loading' } : { status: 'error' }
  );
  const mounted = useRef(true);
  const started = useRef(false);

  const refresh = useCallback(async () => {
    const next = await readCheck();
    if (mounted.current) setState(next);
  }, []);

  const start = useCallback(() => {
    if (started.current || typeof fetch !== 'function') return;
    started.current = true;
    void refresh();
  }, [refresh]);

  useEffect(() => {
    mounted.current = true;
    if (!deferred) start();
    return () => {
      mounted.current = false;
    };
  }, [deferred, start]);

  return { state, refresh, start };
}
