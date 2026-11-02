'use client';

/**
 * The state of the export drawer (export redesign MX-1b, workplan §10; BQ-E5-3,
 * user 2026-10-27; SA C-1, C-8).
 *
 *   - Ticks: nothing is ticked when the drawer opens (BQ-E5-3). "Select all"
 *     ticks every offered module, or clears them all when all are ticked.
 *   - Export: refused while nothing is ticked, while a request is in flight
 *     (a ref guards a double click inside one render), and after a
 *     `daily_limit` refusal until its `retryAt`.
 *   - Started: the caller shows the confirmation pop-up (BQ-E5-3); this hook
 *     clears the ticks and reloads the history, so the new request shows.
 *   - Refusals (in progress, daily limit, …) stay inline in the drawer.
 *   - History: the drawer reads it every time it opens, starting from
 *     `loading` (MX-3.1: there is no switch probe any more to pre-fetch it).
 *   - MX-4b (H-1): "Show older" (`loadOlder`) reads the page older than the
 *     last request shown and appends it, dropping any request id already in
 *     the list (SA C-4). A failed older read keeps the list and says so, with
 *     a retry. A first-page reload discards an older read still in flight,
 *     and "Show older" does nothing while a first-page read is open; an older
 *     answer is appended only if the list still ends with its cursor (SA CR-1).
 *   - MX-4b (N-1): when the drawer opens and the server's `nextExportAt` is in
 *     the future, Export is off with the same `daily_limit` sentence and timer
 *     a refused click sets (no new state, no new words). A hint only: a
 *     refusal the database already gave is kept, and a failed history read
 *     leaves Export on (the POST decides).
 *
 * The modules are sent in the module map's order, whatever order they were
 * ticked in, so the "Export requested" email and the history read the same.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchModuleExportHistory,
  startModuleExport,
  type ExportHistoryRequest,
  type ModuleExportRefusalCode,
  type ModuleExportStartVerdict,
} from '@/lib/client/businessOsDataExport';

/** A refusal shown inline. `retryAt` only for `daily_limit`. */
export interface ExportDrawerRefusal {
  code: ModuleExportRefusalCode;
  retryAt?: string;
}

export type ExportHistoryState =
  | { kind: 'loading' }
  | { kind: 'ok'; requests: ExportHistoryRequest[]; hasMore: boolean }
  | { kind: 'error' };

export interface ExportDrawerStarted {
  sentTo: string;
  requestedEmailSent: boolean;
}

export interface ExportDrawerState {
  selected: ReadonlySet<string>;
  isAllSelected: boolean;
  toggle: (moduleId: string) => void;
  toggleAll: () => void;
  isBusy: boolean;
  /** Export is refused right now (nothing ticked, busy, or the daily limit until its time). */
  isExportDisabled: boolean;
  refusal: ExportDrawerRefusal | null;
  /** True after a start whose "Export requested" email could not be confirmed. */
  isConfirmationMissing: boolean;
  /** The login email of the request just started, for the drawer's polite status line (SA CR-1); null otherwise. */
  startedTo: string | null;
  history: ExportHistoryState;
  /** Reads the first page again (the drawer's Try again after a failed read). */
  reloadHistory: () => void;
  /** MX-4b: reads the next older page and appends it. Does nothing without `hasMore` or while one is loading. */
  loadOlder: () => void;
  isLoadingOlder: boolean;
  /** MX-4b: the last "Show older" read failed; the list shown is kept. */
  isOlderUnavailable: boolean;
  submit: () => void;
}

/** setTimeout cannot hold more than about 24.8 days; a daily limit never needs that much. */
const MAX_TIMER_MS = 2 ** 31 - 1;

export function useExportDrawer(options: {
  open: boolean;
  /** The offered module ids, in map order. */
  moduleIds: readonly string[];
  onStarted: (started: ExportDrawerStarted) => void;
}): ExportDrawerState {
  const { open, moduleIds, onStarted } = options;
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [isBusy, setIsBusy] = useState(false);
  const [refusal, setRefusal] = useState<ExportDrawerRefusal | null>(null);
  const [blockedUntil, setBlockedUntil] = useState<string | null>(null);
  const [isConfirmationMissing, setIsConfirmationMissing] = useState(false);
  const [startedTo, setStartedTo] = useState<string | null>(null);
  const [history, setHistory] = useState<ExportHistoryState>({ kind: 'loading' });
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [isOlderUnavailable, setIsOlderUnavailable] = useState(false);

  const isInFlight = useRef(false);
  const isMounted = useRef(true);
  const historyCall = useRef(0);
  const isOlderInFlight = useRef(false);
  const isFirstPageInFlight = useRef(false);
  const onStartedRef = useRef(onStarted);
  useEffect(() => {
    onStartedRef.current = onStarted;
  }, [onStarted]);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  /**
   * The first page. `applyLimitHint` only for the read of an open (and its Try
   * again): after a start the database has just answered for itself.
   */
  const loadFirstPage = useCallback((applyLimitHint: boolean) => {
    const call = ++historyCall.current;
    // SA CR-1: while this read is open, the list on screen is the old one, so "Show older" must wait.
    isFirstPageInFlight.current = true;
    // A newer first page wins over any older page still in flight.
    isOlderInFlight.current = false;
    setIsLoadingOlder(false);
    setIsOlderUnavailable(false);
    setHistory((previous) => (previous.kind === 'ok' ? previous : { kind: 'loading' }));
    void fetchModuleExportHistory().then((verdict) => {
      if (!isMounted.current || call !== historyCall.current) return;
      isFirstPageInFlight.current = false;
      if (verdict.kind !== 'ok') {
        setHistory({ kind: 'error' });
        return;
      }
      setHistory({ kind: 'ok', requests: verdict.requests, hasMore: verdict.hasMore });
      const retryAt = verdict.nextExportAt;
      if (applyLimitHint && retryAt !== null && Date.parse(retryAt) > Date.now()) {
        // The same state a refused click sets; a refusal the database already gave is kept.
        setRefusal((previous) => (previous?.code === 'daily_limit' ? previous : { code: 'daily_limit', retryAt }));
        setBlockedUntil((previous) => previous ?? retryAt);
      }
    });
  }, []);

  const reloadHistory = useCallback(() => loadFirstPage(true), [loadFirstPage]);

  const loadOlder = useCallback(() => {
    // SA CR-1: never while a first-page read is open (its answer will replace the list this cursor comes from).
    if (isFirstPageInFlight.current || isOlderInFlight.current || history.kind !== 'ok' || !history.hasMore) return;
    const last = history.requests[history.requests.length - 1];
    if (!last) return;
    isOlderInFlight.current = true;
    const call = historyCall.current;
    setIsLoadingOlder(true);
    setIsOlderUnavailable(false);
    // C-4: the cursor time is the server's own string, untouched.
    void fetchModuleExportHistory({ before: { requestedAt: last.requestedAt, requestId: last.requestId } }).then((verdict) => {
      if (!isMounted.current || call !== historyCall.current) return;
      isOlderInFlight.current = false;
      setIsLoadingOlder(false);
      if (verdict.kind !== 'ok') {
        setIsOlderUnavailable(true);
        return;
      }
      setHistory((previous) => {
        if (previous.kind !== 'ok') return previous;
        // SA CR-1, second guard: append only to the list the cursor was taken from, so no gap can open.
        if (previous.requests[previous.requests.length - 1]?.requestId !== last.requestId) return previous;
        // C-4: a request id already shown is never shown twice.
        const seen = new Set(previous.requests.map((request) => request.requestId));
        const fresh = verdict.requests.filter((request) => {
          if (seen.has(request.requestId)) return false;
          seen.add(request.requestId);
          return true;
        });
        return { kind: 'ok', requests: [...previous.requests, ...fresh], hasMore: verdict.hasMore };
      });
    });
  }, [history]);

  // Every open: nothing ticked (BQ-E5-3), no old message, a fresh history.
  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setRefusal((previous) => (previous?.code === 'daily_limit' ? previous : null));
    setIsConfirmationMissing(false);
    setStartedTo(null);
    loadFirstPage(true);
  }, [open, loadFirstPage]);

  // The daily limit lifts at its time: Export comes back by itself.
  useEffect(() => {
    if (!blockedUntil) return;
    const wait = Date.parse(blockedUntil) - Date.now();
    const lift = () => {
      setBlockedUntil(null);
      setRefusal((previous) => (previous?.code === 'daily_limit' ? null : previous));
    };
    if (!Number.isFinite(wait) || wait <= 0) {
      lift();
      return;
    }
    const timer = setTimeout(lift, Math.min(wait, MAX_TIMER_MS));
    return () => clearTimeout(timer);
  }, [blockedUntil]);

  const toggle = useCallback((moduleId: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(moduleId)) next.delete(moduleId);
      else next.add(moduleId);
      return next;
    });
  }, []);

  const isAllSelected = moduleIds.length > 0 && moduleIds.every((id) => selected.has(id));

  const toggleAll = useCallback(() => {
    setSelected(isAllSelected ? new Set() : new Set(moduleIds));
  }, [isAllSelected, moduleIds]);

  const isExportDisabled = selected.size === 0 || isBusy || blockedUntil !== null;

  const submit = useCallback(() => {
    if (isInFlight.current || selected.size === 0 || blockedUntil !== null) return;
    isInFlight.current = true;
    setIsBusy(true);
    setRefusal(null);
    setIsConfirmationMissing(false);
    setStartedTo(null);
    const modules = moduleIds.filter((id) => selected.has(id));
    startModuleExport(modules)
      .catch((): ModuleExportStartVerdict => ({ kind: 'refused', code: 'failed' }))
      .then((verdict) => {
        isInFlight.current = false;
        if (!isMounted.current) return;
        setIsBusy(false);
        if (verdict.kind === 'started') {
          setSelected(new Set());
          setIsConfirmationMissing(!verdict.requestedEmailSent);
          setStartedTo(verdict.sentTo);
          onStartedRef.current({ sentTo: verdict.sentTo, requestedEmailSent: verdict.requestedEmailSent });
          loadFirstPage(false);
          return;
        }
        setRefusal({ code: verdict.code, ...(verdict.retryAt ? { retryAt: verdict.retryAt } : {}) });
        if (verdict.code === 'daily_limit' && verdict.retryAt) setBlockedUntil(verdict.retryAt);
        if (verdict.code === 'in_progress') loadFirstPage(false);
      });
  }, [blockedUntil, loadFirstPage, moduleIds, selected]);

  return {
    selected,
    isAllSelected,
    toggle,
    toggleAll,
    isBusy,
    isExportDisabled,
    refusal,
    isConfirmationMissing,
    startedTo,
    history,
    reloadHistory,
    loadOlder,
    isLoadingOlder,
    isOlderUnavailable,
    submit,
  };
}
