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
 * Order (S1-FR-5, §11A.0): KPI strip, our revenue, takings through the
 * platform (Section 2 block B, slice 2a, directly under our revenue),
 * Section 1, Section 3, Section 4 (credits, slice 1b), then Section 6 block
 * B, client payment problems (slice 2b), last.
 *
 * Money M-1 (finance health §11D.3): with a business picked, the account
 * header and the account summary sit above the KPI strip (never with all
 * businesses, M1-FR-10). The picked NAME is held here, in state, and never in
 * the URL, a request or a log (SA-Q32, AC-109): the URL is written only from
 * the query, whose type has no name field.
 */

import { useCallback, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { RefreshCw } from 'lucide-react';

import { parseFinanceUrl, serialiseFinanceUrl, type FinanceQuery } from '../financeUrl';
import { useFinanceData } from '../useFinanceData';
import { LOADING, NOTICE_LABEL, NAME_PLATFORM, PAGE_LOAD_FAILED, PAGE_PURPOSE, PAGE_TITLE, PRESET_LABELS, REFRESH, RETRY } from '../financeCopy';
import { accountNameFor, type PickedName } from '../financeAccount';
import { AccountHeader } from './AccountHeader';
import { AccountSummary } from './AccountSummary';
import { AccountsByPlanSection } from './AccountsByPlanSection';
import { AiCostSection } from './AiCostSection';
import { CreditsSection } from './CreditsSection';
import { FinanceFilterBar } from './FinanceFilterBar';
import { FinanceKpiStrip } from './FinanceKpiStrip';
import { PaymentProblemsSection } from './PaymentProblemsSection';
import { RevenuePanel } from './RevenuePanel';
import { TakingsSection } from './TakingsSection';

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

  // SA-Q32: the name the admin picked, for the chip, the header and the summary only.
  const [pickedName, setPickedName] = useState<PickedName | null>(null);
  const onPick = useCallback(
    (accountId: string, name: string | null) => {
      setPickedName({ accountId, name });
      setQuery({ ...query, accountId: accountId || null });
    },
    [query, setQuery]
  );
  const accountName = query.accountId !== null ? accountNameFor(query.accountId, pickedName, data) : null;
  const chipName = accountName === null ? null : accountName.platform ? NAME_PLATFORM : accountName.name;

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

      <FinanceFilterBar
        query={query}
        resolved={data ? { from: data.window.from, to: data.window.to } : null}
        onChange={setQuery}
        onPick={onPick}
        chipName={chipName}
      />

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
          {data.accountId !== null && (
            <>
              <AccountHeader
                accountId={data.accountId}
                name={accountNameFor(data.accountId, pickedName, data)}
                accounts={data.accounts}
              />
              <AccountSummary
                accountId={data.accountId}
                window={data.window}
                aiCost={data.aiCost}
                revenue={data.revenue}
                credits={data.credits}
                accounts={data.accounts}
              />
            </>
          )}
          <FinanceKpiStrip tiles={data.tiles} farOverAllowancePercent={data.credits.farOverAllowancePercent} windowLabel={windowLabel} />
          <RevenuePanel revenue={data.revenue} windowLabel={windowLabel} onRetry={reload} />
          <TakingsSection takings={data.takings} windowLabel={windowLabel} onRetry={reload} />
          <AccountsByPlanSection accounts={data.accounts} windowLabel={windowLabel} onRetry={reload} />
          <AiCostSection aiCost={data.aiCost} accountId={data.accountId} window={data.window} windowLabel={windowLabel} onRetry={reload} />
          <CreditsSection credits={data.credits} windowLabel={windowLabel} onRetry={reload} />
          <PaymentProblemsSection problems={data.paymentProblems} windowLabel={windowLabel} onRetry={reload} />
        </div>
      )}
    </div>
  );
}
