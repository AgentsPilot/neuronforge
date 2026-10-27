'use client';

/**
 * The AI cost page (Money MK-3, KPI restructure review §4; SA-6), in the §4
 * order: the header, the fixed Charged vs Recorded legend, the tab list
 * (Summary & checks, Calls), the strip A-K1 to A-K5 (the same on both tabs,
 * BD-29), then the shown tab's bar and content.
 *
 * MK-3b (SA-CR-MK3A DV-1, SA-Q-MK3-2):
 *   - ONE URL spec (`../aiCostFilters.ts`), `tab` included, owned here: the
 *     window and the business are one value on both tabs, and a tab switch, a
 *     window or a business change is one write. Leaving Calls resets its own
 *     keys (Finance's TAB_RESET), so Summary & checks' address carries none.
 *     Clear resets every filter and keeps the tab.
 *   - ONE report read (`../useCostReport.ts`), lifted out of `CostsTab`, keyed
 *     on the window and the business only: a tab switch or a Calls drill never
 *     re-reads it. A linked window is read as the whole UTC days that cover it,
 *     and the line under the strip says so (SA-Q-MK3-3); `system` (a Calls
 *     drill value) reads every business, also said (SA-Q-MK3-4).
 *   - Only the shown tab's content is mounted (the other panel is an empty,
 *     hidden tabpanel): two bars, two business pickers and two window controls
 *     on one page would be one too many of each. The report is the page's, so
 *     switching back to Summary & checks reads nothing; the Calls tab re-reads
 *     its drill-down when it is opened again. A Leak check result is not kept
 *     across a tab switch (it is an on-demand check, run again in one click).
 *
 * SA-CR-MK3B F-1: the strip is never silently absent. When the report read
 * fails, Summary & checks shows the failure in its content (the platform
 * notice, or the error with Try again); on the Calls tab, where that content
 * is not mounted, the SAME notice or error takes the strip's place, so it is
 * shown exactly once on either tab. No new words: the hook's message is the
 * report's own (the platform sentence, the route's reason such as the 92-day
 * cap, or the shared network sentence).
 *
 * Money MK-8b: Summary & checks sits inside the AI cost drawer provider
 * (`AiCostDrawers.tsx`). With every business shown and a settled report on
 * screen, the period check and Leak check rows open their drawers; the
 * drawer reads only when opened, in the dates of the report on screen, so the
 * page's load requests are unchanged (T-12). With a business picked the page
 * is the full view: no openers (SA-Q-MK8B-4).
 *
 * A client component with no read of its own but the report: the page sits
 * under `app/admin/layout.tsx`, whose `requireAdminPage` runs first, and every
 * read goes to an admin route that runs `requireAdmin` first.
 */

import { useCallback, useMemo } from 'react';

import { AdminPageHeader } from '@/app/admin/components/layout/AdminPageHeader';
import { AdminError, AdminNotice } from '@/app/admin/components/layout/AdminStates';
import type { KpiTileFilter } from '@/app/admin/components/layout/KpiStrip';
import { useAdminFilters } from '@/app/admin/components/layout/useAdminFilters';
import { AiCostKpis } from '@/app/admin/business-os-llm/components/costs/AiCostKpis';
import { CostsTab, costsSectionsShown } from '@/app/admin/business-os-llm/components/costs/CostsTab';
import { CallsTab } from '@/app/admin/analytics/components/CallsTab';

import {
  AI_COST_LEGEND,
  AI_COST_PURPOSE,
  AI_COST_SYSTEM_STRIP_NOTE,
  AI_COST_TITLE,
  aiCostCoveringDaysLine,
} from '../aiCostCopy';
import {
  AI_COST_CLEAR_PATCH,
  AI_COST_FILTER_SPEC,
  AI_COST_PATH,
  CALLS_ONLY_RESET,
  aiCostCanClear,
  reportAccountOf,
  reportDates,
  reportSearch,
  type AiCostFilters,
  type AiCostTab,
} from '../aiCostFilters';
import { useCostReport } from '../useCostReport';
import { AiCostDrawerProvider, type AiCostFullViewHref } from './AiCostDrawers';
import { AiCostTabPanel, AiCostTabs } from './AiCostTabs';

/** The patch a tab choice writes: leaving Calls resets its own keys. */
const tabPatch = (tab: AiCostTab): Partial<AiCostFilters> =>
  tab === 'checks' ? { tab, ...CALLS_ONLY_RESET } : { tab };

export function AiCostView() {
  const { filters, setFilters, hrefFor } = useAdminFilters(AI_COST_FILTER_SPEC);
  const tab = filters.tab;

  // One report request per window or business change (never per tab or Calls drill). The window
  // value keeps its identity while unchanged (the hook's `windowEquals`), so the memo holds.
  const request = useMemo(
    () => ({
      search: reportSearch(filters.window, filters.account, new Date()),
    }),
    [filters.window, filters.account]
  );
  const reportState = useCostReport(request);
  const { report, loading, error, reread } = reportState;

  const selectTab = useCallback((next: AiCostTab) => setFilters(tabPatch(next)), [setFilters]);
  const clear = useCallback(() => setFilters(AI_COST_CLEAR_PATCH), [setFilters]);
  const canClear = aiCostCanClear(filters);

  /** A strip tile that switches tab (and lands on a block): its real link, and the same switch applied. */
  const tabLink = useCallback(
    (target: AiCostTab, anchor: `#${string}` | null): KpiTileFilter => ({
      href: `${AI_COST_PATH}${hrefFor(tabPatch(target))}${anchor ?? ''}`,
      apply: () => {
        selectTab(target);
        if (anchor && typeof window !== 'undefined') {
          // After the panel is shown; jsdom has no scrollIntoView, so it is optional.
          window.requestAnimationFrame(() => document.getElementById(anchor.slice(1))?.scrollIntoView?.());
        }
      },
    }),
    [hrefFor, selectTab]
  );

  const covering = filters.window.kind === 'linked' ? reportDates(filters.window, new Date()) : null;

  // MK-8b (SA-WP-MK8B C-3): the drawers open only from a settled report of every business, in its own dates.
  const drawerWindow =
    report && !loading && !error && reportAccountOf(filters.account) === null
      ? { from: report.window.from, to: report.window.to }
      : null;
  const fullViewHref = useCallback<AiCostFullViewHref>(
    (accountId, anchor) => `${AI_COST_PATH}${hrefFor({ ...tabPatch('checks'), account: accountId })}${anchor ?? ''}`,
    [hrefFor]
  );

  return (
    <div className="space-y-6">
      <AdminPageHeader title={AI_COST_TITLE} purpose={AI_COST_PURPOSE} badge={{ label: 'Read-only' }} />
      {/* §4: one vocabulary, fixed at the top of the page, on every tab. */}
      <dl
        data-testid="ai-cost-legend"
        className="space-y-1 rounded-lg border border-slate-700 bg-slate-800/40 px-4 py-3 text-xs text-slate-300"
      >
        <div>
          <dt className="inline font-semibold text-white">{AI_COST_LEGEND.charged.term}</dt>{' '}
          <dd className="inline">{AI_COST_LEGEND.charged.text}</dd>
        </div>
        <div>
          <dt className="inline font-semibold text-white">{AI_COST_LEGEND.recorded.term}</dt>{' '}
          <dd className="inline">{AI_COST_LEGEND.recorded.text}</dd>
        </div>
      </dl>

      <AiCostTabs selected={tab} onSelect={selectTab} />

      <div className="space-y-2">
        {/* F-1: on Calls a failed report takes the strip's place; Summary & checks shows it in its content. */}
        {tab === 'calls' &&
          error &&
          (error.kind === 'platform_account' ? (
            <AdminNotice testId="ai-cost-strip-platform-account">{error.message}</AdminNotice>
          ) : (
            <AdminError testId="ai-cost-strip-error" message={error.message} onRetry={reread} />
          ))}
        <AiCostKpis
          report={report}
          firstLoad={loading && !report && !error}
          sectionsShown={costsSectionsShown(report)}
          tab={tab}
          tabLink={tabLink}
        />
        {covering?.covering && (
          <p className="text-xs text-slate-400" data-testid="ai-cost-covering-days">
            {aiCostCoveringDaysLine(covering.from, covering.to)}
          </p>
        )}
        {filters.account === 'system' && (
          <p className="text-xs text-slate-400" data-testid="ai-cost-system-note">
            {AI_COST_SYSTEM_STRIP_NOTE}
          </p>
        )}
      </div>

      <AiCostTabPanel id="checks" hidden={tab !== 'checks'}>
        {tab === 'checks' && (
          <AiCostDrawerProvider window={drawerWindow} pageError={error?.message ?? null} fullViewHref={fullViewHref}>
            <CostsTab
              filters={{
                window: filters.window,
                account: reportAccountOf(filters.account) ?? '',
              }}
              setFilters={setFilters}
              onClear={clear}
              canClear={canClear}
              state={reportState}
            />
          </AiCostDrawerProvider>
        )}
      </AiCostTabPanel>

      <AiCostTabPanel id="calls" hidden={tab !== 'calls'}>
        {tab === 'calls' && (
          <CallsTab
            filters={filters}
            setFilters={setFilters}
            clear={clear}
            canClear={canClear}
            hrefFor={hrefFor}
            active={tab === 'calls'}
          />
        )}
      </AiCostTabPanel>
    </div>
  );
}
