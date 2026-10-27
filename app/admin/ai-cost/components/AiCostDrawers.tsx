'use client';

/**
 * The AI cost drawers (Money MK-8b; KPI restructure review §4.2, Q-7 "a side
 * drawer for a quick look from any list, with 'Open full view'"). READ-ONLY
 * (FIN NG-1, §8): the only button is Run leak check, a read; actions stay in
 * Businesses (BD-23).
 *
 *   Business drawer        from a Leak check result row: the business's AI
 *                          cost in the window, its billing periods, a Leak
 *                          check for it, "Open full view"
 *   Billing-period drawer  from a period check row: one account's one period,
 *                          stored against rebuilt from rows, then that
 *                          business's AI cost in the window, "Open full view"
 *
 * ONE PROVIDER, ONE DRAWER (Finance's MK-8 shape, SA-5): the provider fills the
 * row-open context (`aiCostRowOpen.tsx`) and holds one `AdminDrawer`. Its
 * content gets a NULL context, so nothing inside a drawer opens another.
 *
 * ONE READ, ONLY WHEN OPEN: `useDrawerResource` with `readAiCostDrawer`, the
 * credit report for that business in the dates of the report on screen: the
 * request the page itself sends with that business picked (Pin C row 7). The
 * key is null while the drawer is closed and while the page has no settled
 * report (`window` null, SA-WP-MK8B C-3), so the page's load requests are
 * unchanged (T-12, Pin C).
 *
 * Every figure prints through the strip's own functions (`AiCostKpis.tsx`,
 * SA-Q-MK8B-3), so the drawer says exactly what the strip says for that
 * business picked. Lists use the report's `formatUsd` (`$`, sub-cent kept);
 * credits are units, never money. Nothing is added across currencies: AI cost
 * is USD by definition (CUR-5).
 */

import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';

import { AdminDrawer, DrawerField, DrawerFields, DrawerSection } from '@/app/admin/components/layout/AdminDrawer';
import { AdminError, AdminLoading, AdminNotice } from '@/app/admin/components/layout/AdminStates';
import { ADMIN_TABLE, ADMIN_TABLE_WRAP, ADMIN_TBODY, ADMIN_TD, ADMIN_TD_NUM, ADMIN_TH, ADMIN_TH_NUM, ADMIN_THEAD } from '@/app/admin/components/layout/adminTable';
import { useDrawerResource } from '@/app/admin/components/layout/useDrawerResource';
import { aboveTile, chargedValue, periodsTile, recordedValue } from '@/app/admin/business-os-llm/components/costs/AiCostKpis';
import { PeriodCheckChip } from '@/app/admin/business-os-llm/components/costs/CostsSections';
import { LeakCheckPanel } from '@/app/admin/business-os-llm/components/costs/LeakCheckPanel';
import {
  COSTS_PLATFORM_ACCOUNT,
  COSTS_WHOLE_PERIODS_LABEL,
  KPI_ABOVE,
  KPI_CHARGED,
  KPI_MAY_BE_INCOMPLETE,
  KPI_PERIODS,
  KPI_RECORDED,
  KPI_RECORDED_SCOPE,
  KPI_UNKNOWN,
} from '@/app/admin/business-os-llm/costCopy';
import { formatCount, formatCredits, formatDay, formatUsd } from '@/app/admin/business-os-llm/costFormat';
import type { CostPeriodFigures, CostReportPayload } from '@/app/admin/business-os-llm/costTypes';

import { AI_COST_DRAWER } from '../aiCostDrawerCopy';
import { aiCostDrawerKey, readAiCostDrawer } from '../aiCostDrawerReads';
import { AiCostDrawerContext, aiCostBusinessName, targetKey, type AiCostDrawerTarget } from './aiCostRowOpen';

/** "Open full view": the AI cost page with this business picked, same window, Summary & checks. */
export type AiCostFullViewHref = (accountId: string, anchor: `#${string}` | null) => string;

const NOTE = 'text-xs text-slate-400';
const LINK =
  'text-sm text-purple-300 underline hover:text-purple-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-400';

/** A figure with its line under it, when there is one. */
function WithSub({ value, sub }: { value: string; sub: string | null }) {
  return (
    <>
      {value}
      {sub && <span className={`block ${NOTE}`}>{sub}</span>}
    </>
  );
}

/** The business's AI cost in the window: the strip's five figures for this business, plus credits and charges. */
function WindowFigures({ data, title }: { data: CostReportPayload; title: string }) {
  const charged = data.chargedInWindow;
  const chargedKnown = charged.status !== 'unknown';
  const above = aboveTile(data);
  const periods = periodsTile(data);
  return (
    <DrawerSection title={title} testId="ai-cost-drawer-window">
      <p className={NOTE} data-testid="ai-cost-drawer-window-line">
        {AI_COST_DRAWER.windowLine(data.window.from, data.window.to)}
        {data.incomplete && <> &middot; {KPI_MAY_BE_INCOMPLETE}</>}
      </p>
      <DrawerFields>
        <DrawerField label={KPI_CHARGED} testId="ai-cost-drawer-charged">
          {chargedValue(data)}
        </DrawerField>
        <DrawerField label={AI_COST_DRAWER.creditsCharged} testId="ai-cost-drawer-credits">
          {chargedKnown && charged.credits !== null ? AI_COST_DRAWER.credits(formatCredits(charged.credits)) : KPI_UNKNOWN}
        </DrawerField>
        <DrawerField label={AI_COST_DRAWER.charges} testId="ai-cost-drawer-charges">
          {chargedKnown && charged.charges !== null ? formatCount(charged.charges) : KPI_UNKNOWN}
        </DrawerField>
        <DrawerField label={KPI_RECORDED} testId="ai-cost-drawer-recorded">
          <WithSub value={recordedValue(data)} sub={KPI_RECORDED_SCOPE} />
        </DrawerField>
        <DrawerField label={KPI_ABOVE} testId="ai-cost-drawer-above">
          <WithSub value={above.value} sub={above.sub} />
        </DrawerField>
        <DrawerField label={KPI_PERIODS} testId="ai-cost-drawer-periods-not-matching">
          <WithSub value={periods.value} sub={periods.sub} />
        </DrawerField>
      </DrawerFields>
    </DrawerSection>
  );
}

/** The business's billing periods, one line each, with the page's check chip. No opener inside a drawer. */
function PeriodsList({ data }: { data: CostReportPayload }) {
  return (
    <DrawerSection title={AI_COST_DRAWER.periodsSection} testId="ai-cost-drawer-periods">
      <p className={NOTE}>{COSTS_WHOLE_PERIODS_LABEL}</p>
      {data.periods.length === 0 ? (
        <p className="text-sm text-slate-300">{AI_COST_DRAWER.periodsNone}</p>
      ) : (
        <ul className="space-y-1 text-sm text-slate-200">
          {data.periods.map((p) => (
            <li key={p.periodStart} data-testid="ai-cost-drawer-period" className="flex flex-wrap items-center gap-2">
              <span className="font-mono">{formatDay(p.periodStart)}</span>
              {p.stored ? (
                <span>
                  {AI_COST_DRAWER.credits(formatCredits(p.stored.creditsTotal))} &middot; {formatUsd(p.stored.costUsd)} &middot;{' '}
                  {formatCount(p.stored.charges)} {AI_COST_DRAWER.charges.toLowerCase()}
                </span>
              ) : (
                <span className="text-red-300">{AI_COST_DRAWER.noTotalsRow}</span>
              )}
              <PeriodCheckChip matches={p.matches} />
            </li>
          ))}
        </ul>
      )}
    </DrawerSection>
  );
}

const FIGURE_KEYS = Object.keys(AI_COST_DRAWER.figures) as Array<keyof CostPeriodFigures>;

function formatFigure(key: keyof CostPeriodFigures, value: number): string {
  if (key === 'costUsd') return formatUsd(value);
  if (key === 'charges' || key === 'fallbackPriced') return formatCount(value);
  return formatCredits(value);
}

/** One account's one period: stored against rebuilt from rows, figure by figure (§4.2 "Period drawer"). */
function PeriodPart({ data, accountId, periodStart }: { data: CostReportPayload; accountId: string; periodStart: string }) {
  const line = data.periods.find((p) => p.accountId === accountId && p.periodStart === periodStart);
  if (!line) {
    return (
      <DrawerSection title={AI_COST_DRAWER.periodSection} testId="ai-cost-drawer-period-part">
        <p className="text-sm text-slate-300" data-testid="ai-cost-drawer-period-gone">
          {AI_COST_DRAWER.periodNotInWindow}
        </p>
      </DrawerSection>
    );
  }
  const { stored, fromRows, matches } = line;
  // QA B-1: the rebuilt sum is a CHECKED figure only when the report checked this period. When it
  // could not (`matches` null, e.g. the rows read stopped at its ceiling), the sum is partial: it is
  // not shown, the chip says "not checked", and nothing is marked as differing.
  const rebuilt = matches === null ? null : fromRows;
  return (
    <DrawerSection title={AI_COST_DRAWER.periodSection} testId="ai-cost-drawer-period-part">
      <p className={NOTE}>{COSTS_WHOLE_PERIODS_LABEL}</p>
      <PeriodCheckChip matches={matches} />
      {!stored && <p className="text-sm text-red-300">{AI_COST_DRAWER.noTotalsRow}</p>}
      {!fromRows && <p className="text-sm text-slate-300">{AI_COST_DRAWER.rowsNotRead}</p>}
      <div className={ADMIN_TABLE_WRAP}>
        <table className={ADMIN_TABLE} aria-label={AI_COST_DRAWER.periodSection} data-testid="ai-cost-drawer-period-table">
          <thead className={ADMIN_THEAD}>
            <tr>
              <th scope="col" className={ADMIN_TH}>{AI_COST_DRAWER.columnFigure}</th>
              <th scope="col" className={ADMIN_TH_NUM}>{AI_COST_DRAWER.columnStored}</th>
              <th scope="col" className={ADMIN_TH_NUM}>{AI_COST_DRAWER.columnRebuilt}</th>
            </tr>
          </thead>
          <tbody className={ADMIN_TBODY}>
            {FIGURE_KEYS.map((key) => {
              // Only a period the report found NOT to match is marked (QA B-1), never on a partial sum.
              const differs = matches === false && stored !== null && rebuilt !== null && stored[key] !== rebuilt[key];
              return (
                <tr key={key} data-testid={`ai-cost-drawer-figure-${key}`}>
                  <td className={ADMIN_TD}>{AI_COST_DRAWER.figures[key]}</td>
                  <td className={ADMIN_TD_NUM}>{stored ? formatFigure(key, stored[key]) : '—'}</td>
                  <td className={ADMIN_TD_NUM}>
                    {rebuilt ? formatFigure(key, rebuilt[key]) : '—'}
                    {/* SA-WP-MK8B C-5: text, not colour alone: a visible word, which a screen reader reads too. */}
                    {differs && (
                      <span className="ml-2 text-red-300" data-testid="ai-cost-drawer-differs">
                        ({AI_COST_DRAWER.differs})
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </DrawerSection>
  );
}

function FullViewLink({ href }: { href: string }) {
  return (
    <p>
      <a href={href} data-testid="ai-cost-drawer-open-full" className={LINK}>
        {AI_COST_DRAWER.openFull}
      </a>
    </p>
  );
}

function DrawerBody({ target, data, fullViewHref }: { target: AiCostDrawerTarget; data: CostReportPayload; fullViewHref: AiCostFullViewHref }) {
  if (target.kind === 'period') {
    return (
      <div className="space-y-5" data-testid="ai-cost-period-drawer-body">
        <PeriodPart data={data} accountId={target.accountId} periodStart={target.periodStart} />
        <WindowFigures data={data} title={AI_COST_DRAWER.businessSection} />
        <FullViewLink href={fullViewHref(target.accountId, '#costs-periods')} />
      </div>
    );
  }
  return (
    <div className="space-y-5" data-testid="ai-cost-business-drawer-body">
      <WindowFigures data={data} title={AI_COST_DRAWER.windowSection} />
      <PeriodsList data={data} />
      <LeakCheckPanel accountId={target.accountId} accountLabel={aiCostBusinessName(target)} variant="drawer" />
      <FullViewLink href={fullViewHref(target.accountId, null)} />
    </div>
  );
}

export interface AiCostDrawerProviderProps {
  /**
   * The dates of the report ON SCREEN, or null: no settled report (loading or
   * failed), or a business is picked (the page is then the full view). Null
   * means no openers and no drawer read (SA-WP-MK8B C-3).
   */
  window: { from: string; to: string } | null;
  /** The page's report failure, shown in an open drawer instead of a silent wait (C-4). */
  pageError: string | null;
  fullViewHref: AiCostFullViewHref;
  children: ReactNode;
}

export function AiCostDrawerProvider({ window, pageError, fullViewHref, children }: AiCostDrawerProviderProps) {
  const [target, setTarget] = useState<AiCostDrawerTarget | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const key = target !== null && window !== null ? aiCostDrawerKey(window, target.accountId) : null;
  const state = useDrawerResource(key, readAiCostDrawer);

  const open = useCallback((next: AiCostDrawerTarget, opener: HTMLElement) => {
    openerRef.current = opener;
    setTarget(next);
  }, []);
  const value = useMemo(() => ({ open, openKey: target ? targetKey(target) : null }), [open, target]);

  let body: ReactNode = null;
  if (target !== null) {
    if (window === null && pageError !== null) body = <AdminError message={pageError} testId="ai-cost-drawer-error" />;
    else if (state.kind === 'ready') body = <DrawerBody target={target} data={state.data} fullViewHref={fullViewHref} />;
    else if (state.kind === 'error')
      body =
        state.message === COSTS_PLATFORM_ACCOUNT ? (
          <AdminNotice testId="ai-cost-drawer-platform">{state.message}</AdminNotice>
        ) : (
          <AdminError message={state.message} testId="ai-cost-drawer-error" />
        );
    else body = <AdminLoading what={AI_COST_DRAWER.what} />;
  }

  return (
    <AiCostDrawerContext.Provider value={window === null ? null : value}>
      {children}
      <AdminDrawer
        open={target !== null}
        onClose={() => setTarget(null)}
        onReturnFocus={() => openerRef.current?.focus()}
        title={target ? aiCostBusinessName(target) : AI_COST_DRAWER.titleFallback}
        titleSuffix={target?.kind === 'period' ? AI_COST_DRAWER.periodTitleSuffix(formatDay(target.periodStart)) : undefined}
        testId="ai-cost-drawer"
      >
        {/* Nothing inside a drawer opens another (its Leak check result, its periods). */}
        <AiCostDrawerContext.Provider value={null}>{body}</AiCostDrawerContext.Provider>
      </AdminDrawer>
    </AiCostDrawerContext.Provider>
  );
}
