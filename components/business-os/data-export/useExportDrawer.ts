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
 *   - History: the first page comes from the switch probe; the drawer reloads
 *     it every time it opens (SA optimisation suggestion).
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

export type ExportHistoryState = { kind: 'loading' } | { kind: 'ok'; requests: ExportHistoryRequest[] } | { kind: 'error' };

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
  reloadHistory: () => void;
  submit: () => void;
}

/** setTimeout cannot hold more than about 24.8 days; a daily limit never needs that much. */
const MAX_TIMER_MS = 2 ** 31 - 1;

export function useExportDrawer(options: {
  open: boolean;
  /** The offered module ids, in map order. */
  moduleIds: readonly string[];
  initialHistory: ExportHistoryRequest[] | null;
  onStarted: (started: ExportDrawerStarted) => void;
}): ExportDrawerState {
  const { open, moduleIds, initialHistory, onStarted } = options;
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [isBusy, setIsBusy] = useState(false);
  const [refusal, setRefusal] = useState<ExportDrawerRefusal | null>(null);
  const [blockedUntil, setBlockedUntil] = useState<string | null>(null);
  const [isConfirmationMissing, setIsConfirmationMissing] = useState(false);
  const [startedTo, setStartedTo] = useState<string | null>(null);
  const [history, setHistory] = useState<ExportHistoryState>(
    initialHistory ? { kind: 'ok', requests: initialHistory } : { kind: 'error' }
  );

  const isInFlight = useRef(false);
  const isMounted = useRef(true);
  const historyCall = useRef(0);
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

  const reloadHistory = useCallback(() => {
    const call = ++historyCall.current;
    setHistory((previous) => (previous.kind === 'ok' ? previous : { kind: 'loading' }));
    void fetchModuleExportHistory().then((verdict) => {
      if (!isMounted.current || call !== historyCall.current) return;
      setHistory(verdict.kind === 'ok' ? { kind: 'ok', requests: verdict.requests } : { kind: 'error' });
    });
  }, []);

  // Every open: nothing ticked (BQ-E5-3), no old message, a fresh history.
  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setRefusal((previous) => (previous?.code === 'daily_limit' ? previous : null));
    setIsConfirmationMissing(false);
    setStartedTo(null);
    reloadHistory();
  }, [open, reloadHistory]);

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
          reloadHistory();
          return;
        }
        setRefusal({ code: verdict.code, ...(verdict.retryAt ? { retryAt: verdict.retryAt } : {}) });
        if (verdict.code === 'daily_limit' && verdict.retryAt) setBlockedUntil(verdict.retryAt);
        if (verdict.code === 'in_progress') reloadHistory();
      });
  }, [blockedUntil, moduleIds, reloadHistory, selected]);

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
    submit,
  };
}
