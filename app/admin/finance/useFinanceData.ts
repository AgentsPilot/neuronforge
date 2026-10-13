'use client';

/**
 * Fetches the finance page's one route for a query string. A newer query
 * aborts the older request, the response is never cached, and `reload` is the
 * Retry of every section (one route serves them all, SA-Q8).
 *
 * Logs a fetch failure only, never a query value: the account id in it is a
 * filter the server already logs against the admin.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { createLogger } from '@/lib/logger';
import type { FinancePayload } from '@/lib/business-os/finance/financeTypes';

const logger = createLogger({ module: 'AdminFinancePage' });

export const FINANCE_API_PATH = '/api/admin/business-os/finance';

export interface FinanceData {
  data: FinancePayload | null;
  loading: boolean;
  /** The server's own message (e.g. "Business not found"), or a generic one. */
  error: string | null;
  reload: () => void;
}

export function useFinanceData(queryString: string, fallbackError: string): FinanceData {
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
        const response = await fetch(`${FINANCE_API_PATH}?${queryString}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        const body = (await response.json().catch(() => null)) as
          | { success: true; data: FinancePayload }
          | { success: false; error?: string }
          | null;
        if (controller.signal.aborted) return;
        if (!response.ok || !body || !body.success) {
          setData(null);
          setError((body && !body.success && body.error) || fallbackError);
          return;
        }
        setData(body.data);
      } catch (err) {
        if (controller.signal.aborted) return;
        logger.error({ err }, 'Failed to load the finance page');
        setData(null);
        setError(fallbackError);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [queryString, attempt, fallbackError]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { data, loading, error, reload };
}
