'use client';

/**
 * The History block's read (finance slice 8.3, E-85 / S8-F1): it fetches ONLY
 * while the block is open, so the Finance page still sends exactly one request
 * on load (AC-173 and the other one-fetch tests are unchanged). The same shape
 * as `useFinanceData`: an abort per change, the shared response reader, and
 * the shared sentences.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ADMIN_NETWORK_ERROR, adminReadFallback, readAdminResponse } from '@/app/admin/components/layout/readAdminResponse';
import { clientLogger } from '@/lib/logger/client';
import type { FinanceHistoryView } from '@/lib/business-os/finance/historyView';
import { FINANCE_HISTORY_API_PATH } from './historyUrl';

const logger = clientLogger.child({ module: 'AdminFinanceHistory' });

/** Noun phrase for the shared reader's sentences. */
export const HISTORY_WHAT = 'the finance history';

export interface FinanceHistoryData {
  view: FinanceHistoryView | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useFinanceHistory(queryString: string, open: boolean): FinanceHistoryData {
  const [view, setView] = useState<FinanceHistoryView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Closed: no request, ever (E-85).
    if (!open) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        let response: Response;
        try {
          response = await fetch(`${FINANCE_HISTORY_API_PATH}?${queryString}`, { cache: 'no-store', signal: controller.signal });
        } catch (err) {
          if (controller.signal.aborted) return;
          logger.error({ err }, 'Failed to load the finance history');
          setView(null);
          setError(ADMIN_NETWORK_ERROR);
          return;
        }
        const result = await readAdminResponse<FinanceHistoryView>(response, { what: HISTORY_WHAT, sessionEndedCopy: true });
        if (controller.signal.aborted) return;
        if (!result.ok) {
          setView(null);
          setError(result.message);
          return;
        }
        setView(result.data);
      } catch (err) {
        if (controller.signal.aborted) return;
        logger.error({ err }, 'Failed to load the finance history');
        setView(null);
        setError(adminReadFallback(HISTORY_WHAT));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [queryString, open, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { view, loading, error, reload };
}
