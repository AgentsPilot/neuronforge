'use client';

/**
 * Fetches the finance page's one route for a query string. A newer query
 * aborts the older request, the response is never cached, and `reload` is the
 * Retry of every section (one route serves them all, SA-Q8).
 *
 * Logs a fetch failure only, never a query value: the account id in it is a
 * filter the server already logs against the admin.
 *
 * Finance F-3: the body is read through the shared `readAdminResponse`
 * (Admin Layout Standard C-4, §5.10), so the words match every migrated admin
 * page: 401/403 say the session ended, the route's own error string is shown
 * verbatim, a non-JSON or malformed body falls to the shared fallback, and a
 * rejected fetch says ADMIN_NETWORK_ERROR.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { ADMIN_NETWORK_ERROR, adminReadFallback, readAdminResponse } from '@/app/admin/components/layout/readAdminResponse';
import { clientLogger } from '@/lib/logger/client';
import type { FinancePayload } from '@/lib/business-os/finance/financeTypes';

// A client file logs through the client logger (FU-5a-2, Admin Layout Standard F-56).
const logger = clientLogger.child({ module: 'AdminFinancePage' });

export const FINANCE_API_PATH = '/api/admin/business-os/finance';

/**
 * Noun for the shared fallback: "Could not read the finance page. Try again in a moment."
 * Exported so the page's first-load state reads "Reading the finance page…" (F-2).
 */
export const FINANCE_WHAT = 'the finance page';

export interface FinanceData {
  data: FinancePayload | null;
  loading: boolean;
  /** One admin-facing sentence from `readAdminResponse`, ADMIN_NETWORK_ERROR, or null. */
  error: string | null;
  reload: () => void;
}

/**
 * Every outcome takes its words from the shared reader. Finance F-2 dropped
 * the caller's `fallbackError` parameter (F-3 had left it feeding only the
 * defensive outer `catch`), which now shows the shared fallback sentence
 * (SA-W1: `adminReadFallback`, the sentence's one home).
 */
export function useFinanceData(queryString: string): FinanceData {
  const [data, setData] = useState<FinancePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        // Only the fetch sits inside this try: a rejection here is a network
        // failure, and nothing else is ever labelled as one. The browser's own
        // message is never shown (§5.10 rule 4).
        let response: Response;
        try {
          response = await fetch(`${FINANCE_API_PATH}?${queryString}`, {
            cache: 'no-store',
            signal: controller.signal,
          });
        } catch (err) {
          // A newer query aborted this one: it is not a failure, and it must not
          // overwrite the newer read.
          if (controller.signal.aborted) return;
          logger.error({ err }, 'Failed to load the finance page');
          setData(null);
          setError(ADMIN_NETWORK_ERROR);
          return;
        }
        // Never throws: a non-JSON reply (an HTML 502 from the edge, say) falls
        // to the shared fallback sentence.
        const result = await readAdminResponse<FinancePayload>(response, { what: FINANCE_WHAT, sessionEndedCopy: true });
        if (controller.signal.aborted) return;
        if (!result.ok) {
          setData(null);
          setError(result.message);
          return;
        }
        setData(result.data);
      } catch (err) {
        // Defensive: nothing above is expected to throw.
        if (controller.signal.aborted) return;
        logger.error({ err }, 'Failed to load the finance page');
        setData(null);
        setError(adminReadFallback(FINANCE_WHAT));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [queryString, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { data, loading, error, reload };
}
