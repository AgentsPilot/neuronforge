'use client';

/**
 * The finance page's body (slice 1a, S1-FR-1 to S1-FR-6, L-1 to L-7).
 *
 * THE URL IS THE STATE (L-4): the filters are read from `useSearchParams`
 * (inside the page's Suspense boundary) through the pure `parseFinanceUrl`, and
 * a change is written back with `router.replace(…, { scroll: false })`, never
 * `push`. A reload or a shared link reproduces the view. An invalid value falls
 * back to the default with a small notice. Only ids and enums reach the URL.
 *
 * Order (S1-FR-5): KPI strip, our revenue, Section 1, Section 3. No Section 2,
 * 4, 5 or 6 heading in slice 1a.
 */

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { RefreshCw } from 'lucide-react';

import { parseFinanceUrl, serialiseFinanceUrl, type FinanceQuery } from '../financeUrl';
import { useFinanceData } from '../useFinanceData';
import { LOADING, NOTICE_LABEL, PAGE_LOAD_FAILED, PAGE_PURPOSE, PAGE_TITLE, PRESET_LABELS, REFRESH, RETRY } from '../financeCopy';
import { AccountsByPlanSection } from './AccountsByPlanSection';
import { AiCostSection } from './AiCostSection';
import { FinanceFilterBar } from './FinanceFilterBar';
import { FinanceKpiStrip } from './FinanceKpiStrip';
import { RevenuePanel } from './RevenuePanel';

export function FinanceView() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const { query, notice } = useMemo(
    () => parseFinanceUrl(new URLSearchParams(searchParams?.toString() ?? ''), new Date()),
    [searchParams]
  );
  const queryString = serialiseFinanceUrl(query);
  const { data, loading, error, reload } = useFinanceData(queryString, PAGE_LOAD_FAILED);

  const setQuery = useCallback(
    (next: FinanceQuery) => router.replace(`${pathname ?? '/admin/finance'}?${serialiseFinanceUrl(next)}`, { scroll: false }),
    [router, pathname]
  );

  const windowLabel = data
    ? `${PRESET_LABELS[data.window.preset]}, ${data.window.from} to ${data.window.to} UTC`
    : PRESET_LABELS[query.preset];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-700 pb-4">
        <div>
          <h1 className="text-xl font-semibold text-white">{PAGE_TITLE}</h1>
          <p className="mt-1 text-sm text-slate-400">{PAGE_PURPOSE}</p>
          {data && <p className="mt-1 text-xs text-slate-500" data-testid="as-of">{windowLabel}</p>}
        </div>
        <button
          type="button"
          onClick={reload}
          aria-busy={loading}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          {REFRESH}
        </button>
      </header>

      <FinanceFilterBar query={query} resolved={data ? { from: data.window.from, to: data.window.to } : null} onChange={setQuery} />

      {notice && (
        <p className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200" role="status" data-testid="finance-url-notice">
          {NOTICE_LABEL} {notice}
        </p>
      )}

      {loading && !data && <p className="text-sm text-slate-400">{LOADING}</p>}

      {error && (
        <div className="flex items-center gap-3 text-sm text-slate-300" role="alert" data-testid="finance-error">
          <span>{error}</span>
          <button type="button" onClick={reload} className="rounded border border-slate-600 px-2 py-1 text-xs hover:bg-slate-700">
            {RETRY}
          </button>
        </div>
      )}

      {data && !error && (
        <div className="space-y-4">
          <FinanceKpiStrip tiles={data.tiles} />
          <RevenuePanel revenue={data.revenue} />
          <AccountsByPlanSection accounts={data.accounts} windowLabel={windowLabel} onRetry={reload} />
          <AiCostSection aiCost={data.aiCost} accountId={data.accountId} windowLabel={windowLabel} onRetry={reload} />
        </div>
      )}
    </div>
  );
}
