'use client';

/**
 * Money MK-7 (KPI restructure review §6 item 13): History under its KPIs. The
 * slice 8.3 History block is SPLIT: the plan-mix trend sits under Plan mix and
 * the credits trend under Credits, each a `HistoryTrend` with its own Show /
 * Hide toggle.
 *
 * ONE SHARED LAZY FETCH: `FinanceHistoryProvider` holds the one
 * `useFinanceHistory` (the same route, query and reader) and asks for the
 * history only while at least one trend is open. Two open trends share one
 * request and one view, and the page still sends exactly one request on load
 * (E-85, AC-173). Open state is local, never a URL key.
 *
 * FORMAT ONLY (E-99): no fold, no sort, no date arithmetic; the server's view
 * is shown as it came. Every sentence of the old block (the subtitle, the start
 * line, "not available yet", "no history yet", the error with Try again) is
 * said by each trend, unchanged.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { AdminError, AdminLoading, AdminNotice } from '@/app/admin/components/layout/AdminStates';

import {
  HISTORY_CREDITS,
  HISTORY_HIDE,
  HISTORY_NONE_YET,
  HISTORY_NOT_INSTALLED,
  HISTORY_PLAN_MIX,
  HISTORY_SHOW,
  HISTORY_SUBTITLE,
  HISTORY_TITLE,
  HISTORY_WEEKLY,
  historyNoneInWindow,
  historyStartsOn,
} from '../financeCopy';
import type { FinanceQuery } from '../financeUrl';
import { serialiseHistoryQuery } from '../historyUrl';
import { HISTORY_WHAT, useFinanceHistory, type FinanceHistoryData } from '../useFinanceHistory';
import { HistoryTableView } from './HistoryBlock';

const NOTE = 'text-xs text-slate-400';
const BUTTON =
  'inline-flex items-center rounded border border-slate-600 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-400';

/** MK-7: the two trends, each under its own KPI block. */
export type HistoryTrendKind = 'planMix' | 'credits';

const TREND: Record<HistoryTrendKind, { caption: string; testId: string }> = {
  planMix: { caption: HISTORY_PLAN_MIX, testId: 'history-plan-mix' },
  credits: { caption: HISTORY_CREDITS, testId: 'history-credits' },
};

interface SharedHistory {
  data: FinanceHistoryData;
  /** A trend reports whether it is open; the read runs while any is. */
  setOpen: (trend: HistoryTrendKind, open: boolean) => void;
}

const HistoryContext = createContext<SharedHistory | null>(null);

/**
 * MK-7: the ONE history read for the page's trends. Closed on every load: it
 * requests nothing until a trend is opened (E-85), and only while at least one
 * is open, so two open trends share one request. Open state is local, never a
 * URL key.
 */
export function FinanceHistoryProvider({ query, children }: { query: Pick<FinanceQuery, 'preset' | 'from' | 'to'>; children: ReactNode }) {
  const [openTrends, setOpenTrends] = useState<{ planMix: boolean; credits: boolean }>({ planMix: false, credits: false });
  const anyOpen = openTrends.planMix || openTrends.credits;
  const data = useFinanceHistory(serialiseHistoryQuery(query), anyOpen);
  const setOpen = useCallback(
    (trend: HistoryTrendKind, open: boolean) => setOpenTrends((was) => (was[trend] === open ? was : { ...was, [trend]: open })),
    []
  );
  const value = useMemo(() => ({ data, setOpen }), [data, setOpen]);
  return <HistoryContext.Provider value={value}>{children}</HistoryContext.Provider>;
}

/**
 * MK-7: one trend under its KPI block. Its own toggle; the shared read (the
 * provider above) answers both trends. Formats only (E-99).
 */
export function HistoryTrend({ trend }: { trend: HistoryTrendKind }) {
  const shared = useContext(HistoryContext);
  const [open, setOpenLocal] = useState(false);
  const { testId, caption } = TREND[trend];
  const report = shared?.setOpen;
  useEffect(() => {
    report?.(trend, open);
  }, [report, trend, open]);
  // A trend that unmounts (a tab switch) is no longer open.
  useEffect(() => () => report?.(trend, false), [report, trend]);

  const view = shared?.data.view ?? null;
  const loading = shared?.data.loading ?? false;
  const error = shared?.data.error ?? null;
  const reload = shared?.data.reload ?? (() => undefined);
  const headingId = `${testId}-trend-heading`;
  const bodyId = `${testId}-trend-body`;

  return (
    <div className="space-y-2 border-t border-slate-700 pt-3" role="group" aria-labelledby={headingId} data-testid={`${testId}-trend`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={headingId} className="text-sm font-medium text-slate-200">
          {HISTORY_TITLE}
        </h3>
        <button
          type="button"
          className={BUTTON}
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpenLocal((was) => !was)}
          data-testid={`${testId}-toggle`}
        >
          {open ? HISTORY_HIDE : HISTORY_SHOW}
        </button>
      </div>
      <p className={NOTE}>{HISTORY_SUBTITLE}</p>
      {open && (
        <div id={bodyId} className="space-y-3" data-testid={`${testId}-trend-body`}>
          {loading && !view && <AdminLoading what={HISTORY_WHAT} />}
          {error && <AdminError message={error} testId={`${testId}-error`} onRetry={reload} />}
          {!error && view?.state === 'not_installed' && <AdminNotice testId={`${testId}-not-installed`}>{HISTORY_NOT_INSTALLED}</AdminNotice>}
          {!error && view && view.state !== 'not_installed' && (
            <>
              <p className="text-sm text-slate-200" data-testid={`${testId}-start-line`}>
                {view.state === 'no_history'
                  ? HISTORY_NONE_YET
                  : view.state === 'none_in_window'
                    ? historyNoneInWindow(view.firstSnapshotDate ?? '')
                    : historyStartsOn(view.firstSnapshotDate ?? '')}
              </p>
              {view.state === 'ready' && (
                <>
                  {view.weekly && (
                    <p className={NOTE} data-testid={`${testId}-weekly`}>
                      {HISTORY_WEEKLY}
                    </p>
                  )}
                  <HistoryTableView caption={caption} table={trend === 'planMix' ? view.planMix : view.credits} testId={testId} />
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
