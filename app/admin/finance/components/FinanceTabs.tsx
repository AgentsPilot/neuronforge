'use client';

/**
 * The finance page's two views, Overview and Accounts (finance health slice
 * 6a, M3-FR-1, SA-Q43). PAGE-LOCAL: nothing outside `app/admin/finance`
 * imports it, and nothing is added to the shared layout folder (SA-R-3).
 *
 * The L-8a pattern of Business OS AI: an APG tablist with MANUAL activation.
 * Left / Right (wrapping), Home and End move focus only; Enter or Space on the
 * focused tab is the button's own click, which selects it. Only the selected
 * tab is in the tab order (roving `tabIndex`); each tab names its panel with
 * `aria-controls`, and the panel names its tab with `aria-labelledby`.
 *
 * The selected tab is the URL's (`tab=accounts`; absent = Overview): selecting
 * one calls `onSelect`, which the view writes through its URL filter state
 * (`useAdminFilters`, Finance F-4).
 */

import { useRef, type KeyboardEvent, type ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { TAB_ACCOUNTS, TAB_OVERVIEW, TAB_PLANS, TABS_LABEL } from '../financeCopy';

export type FinanceTab = 'overview' | 'accounts' | 'plans';

const TABS: readonly (readonly [FinanceTab, string])[] = [
  ['overview', TAB_OVERVIEW],
  ['accounts', TAB_ACCOUNTS],
  // Money MK-4 (§3.2): the Subscriptions page as a tab, Plan mix on top.
  ['plans', TAB_PLANS],
];

export const financeTabId = (id: FinanceTab) => `finance-tab-${id}`;
export const financePanelId = (id: FinanceTab) => `finance-panel-${id}`;

export function FinanceTabs({ selected, onSelect }: { selected: FinanceTab; onSelect: (tab: FinanceTab) => void }) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = TABS.length - 1;
    const target =
      event.key === 'ArrowRight'
        ? (index + 1) % TABS.length
        : event.key === 'ArrowLeft'
          ? (index + last) % TABS.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (target === null) return;
    event.preventDefault();
    buttons.current[target]?.focus();
  };

  return (
    <div className="flex gap-1 border-b border-slate-700" role="tablist" aria-label={TABS_LABEL} data-testid="finance-tabs">
      {TABS.map(([id, label], index) => (
        <button
          key={id}
          ref={(element) => {
            buttons.current[index] = element;
          }}
          type="button"
          role="tab"
          id={financeTabId(id)}
          aria-selected={selected === id}
          aria-controls={financePanelId(id)}
          tabIndex={selected === id ? 0 : -1}
          data-testid={`finance-tab-${id}`}
          onClick={() => onSelect(id)}
          onKeyDown={(event) => onKeyDown(event, index)}
          className={cn(
            '-mb-px border-b-2 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500',
            selected === id ? 'border-purple-400 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** The panel of one tab, labelled by its tab. */
export function FinanceTabPanel({ id, children }: { id: FinanceTab; children: ReactNode }) {
  return (
    <div role="tabpanel" id={financePanelId(id)} aria-labelledby={financeTabId(id)} data-testid={`finance-panel-${id}`}>
      {children}
    </div>
  );
}
