'use client';

/**
 * Refresh and auto-refresh for the LLM Usage tab (Layer 1.1 FR-10, FR-11).
 *
 * Side effects around the pure `refreshReducer`:
 * - one report request at a time; auto-refresh re-arms a `setTimeout` only
 *   after the previous request finished (never `setInterval`, so a slow request
 *   can't cause an overlap);
 * - a hidden browser tab pauses auto-refresh (no request is sent while hidden);
 * - unmount (leaving the tab) clears the timer and aborts the in-flight request;
 * - Debug Logs: manual refreshes and every error are logged; a successful
 *   automatic refresh is not, so a 10 s interval can't flood the 50-entry panel.
 *
 * Client-only; imports types from server modules, never values (RC-8).
 */

import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { ApiEnvelope, LlmUsageReport, ReportTrigger } from '@/lib/business-os/usage/llmUsageReportTypes';
import {
  canStartRequest,
  initialRefreshState,
  refreshReducer,
  type AutoRefreshInterval,
  type RefreshState,
} from './llmUsageRefreshMachine';

export const LLM_USAGE_REPORT_PATH = '/api/admin/business-os/llm-usage';

export type DebugLogType = 'info' | 'success' | 'error';

export interface FetchReportResult {
  status: number;
  body: ApiEnvelope<LlmUsageReport> | null;
}

export type FetchReport = (
  params: { accountId: string; startIso: string; trigger: ReportTrigger },
  signal: AbortSignal
) => Promise<FetchReportResult>;

/** The real request: same-origin GET (session cookie), with a correlation id. */
export const fetchLlmUsageReport: FetchReport = async ({ accountId, startIso, trigger }, signal) => {
  const qs = new URLSearchParams({ accountId, since: startIso, trigger }).toString();
  const response = await fetch(`${LLM_USAGE_REPORT_PATH}?${qs}`, {
    method: 'GET',
    headers: { 'x-correlation-id': crypto.randomUUID() },
    signal,
  });
  let body: ApiEnvelope<LlmUsageReport> | null = null;
  try {
    body = (await response.json()) as ApiEnvelope<LlmUsageReport>;
  } catch {
    body = null;
  }
  return { status: response.status, body };
};

export interface UseLlmUsageAutoRefreshOptions {
  initialStartIso: string;
  onLog?: (type: DebugLogType, message: string) => void;
  onResponse?: (payload: unknown) => void;
  fetchReport?: FetchReport;
}

export interface UseLlmUsageAutoRefresh {
  state: RefreshState;
  selectAccount: (accountId: string | null) => void;
  setStart: (startIso: string) => void;
  refresh: () => void;
  setAutoRefresh: (on: boolean) => void;
  setIntervalSec: (intervalSec: AutoRefreshInterval) => void;
}

function isHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

export function useLlmUsageAutoRefresh({
  initialStartIso,
  onLog,
  onResponse,
  fetchReport = fetchLlmUsageReport,
}: UseLlmUsageAutoRefreshOptions): UseLlmUsageAutoRefresh {
  const [state, dispatch] = useReducer(refreshReducer, initialStartIso, initialRefreshState);

  // Refs let the timer and async callbacks read the latest values without
  // re-creating effects on every render.
  const stateRef = useRef(state);
  stateRef.current = state;
  const requestCounter = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const onLogRef = useRef(onLog);
  onLogRef.current = onLog;
  const onResponseRef = useRef(onResponse);
  onResponseRef.current = onResponse;

  const runRequest = useCallback(
    async (trigger: ReportTrigger) => {
      const current = stateRef.current;
      if (!canStartRequest(current, trigger) || !current.accountId) return;

      const requestId = ++requestCounter.current;
      const controller = new AbortController();
      abortRef.current = controller;
      // Mark in flight synchronously, so a timer firing in the same tick sees it.
      stateRef.current = { ...current, inFlight: { requestId, trigger } };
      dispatch({ type: 'REQUEST_START', requestId, trigger });

      if (trigger === 'manual') onLogRef.current?.('info', 'Refreshing LLM usage report...');

      try {
        const { status, body } = await fetchReport(
          { accountId: current.accountId, startIso: current.startIso, trigger },
          controller.signal
        );
        if (!mountedRef.current || controller.signal.aborted) return;

        if (status >= 200 && status < 300 && body?.success) {
          dispatch({ type: 'REQUEST_OK', requestId, report: body.data });
          if (trigger === 'manual') {
            onLogRef.current?.('success', `LLM usage report → ${status}`);
            onResponseRef.current?.(body);
          }
        } else {
          const message = body && !body.success ? body.error : `HTTP ${status}`;
          dispatch({ type: 'REQUEST_FAIL', requestId, status, message });
          onLogRef.current?.('error', `LLM usage report (${trigger}) → ${message}`);
          if (trigger === 'manual') onResponseRef.current?.(body);
        }
      } catch (err) {
        if (!mountedRef.current || controller.signal.aborted) return;
        const message = err instanceof Error ? err.message : String(err);
        dispatch({ type: 'REQUEST_FAIL', requestId, status: 0, message });
        onLogRef.current?.('error', `LLM usage report (${trigger}) failed: ${message}`);
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [fetchReport]
  );

  // Auto-refresh timer: armed only while running and idle, so it re-arms after
  // each request completes and never overlaps one.
  const { status: autoStatus, intervalSec } = state.auto;
  const idle = state.inFlight === null;
  const { settledRequests } = state;
  useEffect(() => {
    if (autoStatus !== 'running' || !idle) return;
    const timer = setTimeout(() => {
      if (isHidden()) {
        dispatch({ type: 'VISIBILITY_HIDDEN' });
        return;
      }
      void runRequest('auto');
    }, intervalSec * 1000);
    return () => clearTimeout(timer);
    // settledRequests: re-arm after every finished request (see the reducer).
  }, [autoStatus, idle, intervalSec, settledRequests, runRequest]);

  // Pause as soon as the browser tab is hidden. Becoming visible again does not
  // resume: the next manual refresh does (FR-10).
  useEffect(() => {
    const onVisibility = () => {
      if (isHidden()) dispatch({ type: 'VISIBILITY_HIDDEN' });
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // Leaving the tab unmounts this hook: stop everything.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const abortInFlight = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  return {
    state,
    selectAccount: useCallback(
      (accountId: string | null) => {
        if (stateRef.current.accountId !== accountId) abortInFlight();
        dispatch({ type: 'SELECT_ACCOUNT', accountId });
      },
      [abortInFlight]
    ),
    setStart: useCallback(
      (startIso: string) => {
        if (stateRef.current.startIso !== startIso) abortInFlight();
        dispatch({ type: 'SET_START', startIso });
      },
      [abortInFlight]
    ),
    refresh: useCallback(() => void runRequest('manual'), [runRequest]),
    setAutoRefresh: useCallback((on: boolean) => dispatch({ type: 'TOGGLE_AUTO', on }), []),
    setIntervalSec: useCallback(
      (value: AutoRefreshInterval) => dispatch({ type: 'SET_INTERVAL', intervalSec: value }),
      []
    ),
  };
}
