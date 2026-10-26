'use client';

/**
 * The AI cost page's two views (Money MK-3b, KPI restructure review §4):
 * Summary & checks (`tab=checks`, the default) and Calls (`tab=calls`).
 * PAGE-LOCAL, the Finance tabs' pattern (`FinanceTabs.tsx`, L-8a): an APG
 * tablist with MANUAL activation. Left / Right (wrapping), Home and End move
 * focus only; Enter or Space on the focused tab is the button's own click,
 * which selects it. Only the selected tab is in the tab order (roving
 * `tabIndex`); each tab names its panel with `aria-controls`, and the panel
 * names its tab with `aria-labelledby`.
 */

import { useRef, type KeyboardEvent, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

import { AI_COST_TAB_CALLS, AI_COST_TAB_CHECKS, AI_COST_TABS_LABEL } from '../aiCostCopy';
import type { AiCostTab } from '../aiCostFilters';

const TABS: readonly (readonly [AiCostTab, string])[] = [
  ['checks', AI_COST_TAB_CHECKS],
  ['calls', AI_COST_TAB_CALLS],
];

export const aiCostTabId = (id: AiCostTab) => `ai-cost-tab-${id}`;
export const aiCostPanelId = (id: AiCostTab) => `ai-cost-panel-${id}`;

export function AiCostTabs({ selected, onSelect }: { selected: AiCostTab; onSelect: (tab: AiCostTab) => void }) {
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
    <div className="flex gap-1 border-b border-slate-700" role="tablist" aria-label={AI_COST_TABS_LABEL} data-testid="ai-cost-tabs">
      {TABS.map(([id, label], index) => (
        <button
          key={id}
          ref={(element) => {
            buttons.current[index] = element;
          }}
          type="button"
          role="tab"
          id={aiCostTabId(id)}
          aria-selected={selected === id}
          aria-controls={aiCostPanelId(id)}
          tabIndex={selected === id ? 0 : -1}
          data-testid={`ai-cost-tab-${id}`}
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

/** One tab's panel, labelled by its tab. Hidden (not unmounted) while another tab is shown. */
export function AiCostTabPanel({ id, hidden, children }: { id: AiCostTab; hidden: boolean; children: ReactNode }) {
  return (
    <div role="tabpanel" id={aiCostPanelId(id)} aria-labelledby={aiCostTabId(id)} hidden={hidden} data-testid={`ai-cost-panel-${id}`}>
      {children}
    </div>
  );
}
