'use client';

/**
 * The AI cost page's one report read (Money MK-3b, SA-CR-MK3A DV-1): lifted
 * out of `CostsTab`, unchanged, so the strip A-K1 to A-K5 has the report on
 * BOTH tabs and Summary & checks renders it.
 *
 * One `GET` to `/api/admin/business-os/credits/report` per window or business
 * change (the caller memoises `search`), never per tab switch or Calls drill.
 *
 * Only the NEWEST request may set the screen (SA CR-N2): each read takes a
 * sequence number and aborts the one before it, so a slow earlier response can
 * never overwrite a later window. A failed read clears the report instead of
 * leaving the previous window's figures under the error.
 *
 * A platform account (409 `platform_account`) is told apart from any other
 * failure, in the report's own words (SA M-2). That code must be seen before
 * any generic copy, so the read keeps its own branching on `readJsonBody`
 * rather than `readAdminResponse` (the L-9a reason, kept).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { ADMIN_NETWORK_ERROR } from '@/app/admin/components/layout/readAdminResponse';
import { readJsonBody } from '@/app/admin/components/layout/readJsonBody';
import { COSTS_ERROR_FALLBACK, COSTS_PLATFORM_ACCOUNT } from '@/app/admin/business-os-llm/costCopy';
import type { CostReportPayload } from '@/app/admin/business-os-llm/costTypes';

export const REPORT_URL = '/api/admin/business-os/credits/report';

export interface CostReportError {
  kind: 'platform_account' | 'other';
  message: string;
}

export interface CostReportState {
  report: CostReportPayload | null;
  loading: boolean;
  error: CostReportError | null;
  /** Re-send the same request (Refresh, Try again). */
  reread: () => void;
}

/** `request` is an object so the read is keyed on its identity: one read per new request, none otherwise. */
export function useCostReport(request: { search: string }): CostReportState {
  const [report, setReport] = useState<CostReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<CostReportError | null>(null);
  const sequence = useRef(0);
  const inFlight = useRef<AbortController | null>(null);

  const load = useCallback(async (search: string) => {
    const mine = ++sequence.current;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    const isCurrent = () => mine === sequence.current;

    setLoading(true);
    setError(null);
    try {
      let response: Response;
      try {
        response = await fetch(`${REPORT_URL}?${search}`, { signal: controller.signal });
      } catch {
        // A superseded (or aborted) request says nothing about the screen. A
        // network failure says the shared words, never the browser's (§5.10).
        if (!isCurrent()) return;
        setReport(null);
        setError({ kind: 'other', message: ADMIN_NETWORK_ERROR });
        return;
      }
      // A non-JSON body (a proxy's HTML error page) reads as null, so the page
      // shows its own words, never a parser message. A JSON error body still
      // gives the route's reason (400, 409). Newest wins before any setState (SA S-7).
      const body = await readJsonBody(response);
      if (!isCurrent()) return;
      if (!response.ok || body === null || body.success !== true) {
        setReport(null);
        setError(
          body?.error === 'platform_account'
            ? { kind: 'platform_account', message: COSTS_PLATFORM_ACCOUNT }
            : { kind: 'other', message: typeof body?.error === 'string' ? body.error : COSTS_ERROR_FALLBACK }
        );
        return;
      }
      setReport((body.data as CostReportPayload | undefined) ?? null);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(request.search);
  }, [load, request]);

  // Unmounting abandons the last read; nothing may set state afterwards.
  useEffect(
    () => () => {
      sequence.current += 1;
      inFlight.current?.abort();
    },
    []
  );

  const reread = useCallback(() => void load(request.search), [load, request]);

  return { report, loading, error, reread };
}
