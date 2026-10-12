'use client';

/**
 * The Activity tab's filter bar (Admin Layout Standard §5.5, §7.11; L-8a
 * workplan §2.3), replacing the tab's own controls:
 *
 *   Window (the standard five, then this tab's Yesterday, This week, Last week
 *   and Last month, D-2 (b); From / To under Custom only, both required) →
 *   Business (the shared picker) → Area, Outcome, Trigger, Minimum cost with
 *   its own Apply, Sort → Clear → Read at + Refresh; and the business chip.
 *
 * Every filter applies at once through the page's `useAdminFilters`, except
 * the two typed ones: Custom's dates (the shared Apply) and the minimum cost
 * (its own "Apply minimum cost", or Enter). The minimum cost's draft follows
 * the applied value whenever ANY applied filter changes (a preset, a select,
 * Clear, a link), so a preset click discards an unapplied minimum cost (F-73).
 *
 * QA-L8a-1: a malformed amount ("abc", "5.", ".5", "-1", "1,000") is refused
 * here with a short inline message, by the same format rule the URL parse uses:
 * no request, nothing written to the URL. Applied, it would be dropped by the
 * next re-parse (a tab switch), which then read again. A well-formed amount
 * still goes to the route, so its size and precision messages still show.
 *
 * The business chip names the business: the name picked in the picker, else
 * the first row's name when the list is for that business (the tab's rule
 * before L-8a), else the short id (RC-6: no lookup).
 */

import { useId, useState } from 'react';

import {
  ADMIN_FIELD_CONTROL,
  ADMIN_FIELD_LABEL,
  AdminFieldSpacer,
  AdminFilterBar,
  type AdminActiveChip,
} from '@/app/admin/components/layout/AdminFilterBar';
import { AdminBusinessPicker, businessFilterChip } from '@/app/admin/components/layout/AdminBusinessPicker';

import {
  APPLY_MIN_COST_LABEL,
  MIN_COST_FORMAT_PROBLEM,
  MIN_COST_LABEL,
  OUTCOME_LABELS,
  SORT_LABEL,
  SORT_LABELS,
  TRIGGER_LABELS,
} from '../../activityCopy';
import { ACTIVITY_DEFAULT_WINDOW, ACTIVITY_WINDOW_EXTRAS, isMinCostValue, type ActivityFilters } from '../../activityFilters';
import type { ActivityAreaOption, ActivityOutcome, ActivitySort, ActivityTrigger } from '../../activityTypes';

/** The noun phrase for "Refresh …" and the loading state (D-15). */
export const ACTIVITY_WHAT = 'the AI activity';

const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500';

const isOutcome = (value: string): value is ActivityOutcome => Object.keys(OUTCOME_LABELS).includes(value);
const isTrigger = (value: string): value is ActivityTrigger => Object.keys(TRIGGER_LABELS).includes(value);

export interface ActivityFilterBarProps {
  filters: ActivityFilters;
  setFilters: (patch: Partial<ActivityFilters>) => void;
  onClear: () => void;
  canClear: boolean;
  /** The areas the last payload listed (kept across reads). */
  areas: readonly ActivityAreaOption[];
  /** The chip's name for the applied business, or null for the short id. */
  businessName: string | null;
  onPickBusiness: (accountId: string, name: string | null) => void;
  busy: boolean;
  readAt: string | null;
  onRefresh: () => void;
}

export function ActivityFilterBar({
  filters,
  setFilters,
  onClear,
  canClear,
  areas,
  businessName,
  onPickBusiness,
  busy,
  readAt,
  onRefresh,
}: ActivityFilterBarProps) {
  const areaId = useId();
  const outcomeId = useId();
  const triggerId = useId();
  const minCostId = useId();
  const minCostProblemId = useId();
  const sortLabelId = useId();

  // F-73: the typed minimum cost starts from what is applied, and goes back to
  // it whenever any applied filter changes. `filters` is identity-stable (a
  // new object only when a value changed), so this runs once per change.
  const [draft, setDraft] = useState(filters.minCost);
  const [minCostProblem, setMinCostProblem] = useState<string | null>(null);
  const [seen, setSeen] = useState(filters);
  if (seen !== filters) {
    setSeen(filters);
    setDraft(filters.minCost);
    setMinCostProblem(null);
  }

  // Empty clears the filter. A malformed amount is refused here (QA-L8a-1); a
  // well-formed one goes to the route, whose too-large / too-precise messages
  // still show (QA E-2).
  const applyMinCost = () => {
    const value = draft.trim();
    if (value !== '' && !isMinCostValue(value)) {
      setMinCostProblem(MIN_COST_FORMAT_PROBLEM);
      return;
    }
    setMinCostProblem(null);
    setFilters({ minCost: value });
  };

  // A URL area not (yet) in the payload's list gets its own option, so the
  // select never shows "All areas" over an applied filter.
  const areaNames = areas.map((option) => option.area);
  if (filters.area && !areaNames.includes(filters.area)) areaNames.push(filters.area);

  const chips: AdminActiveChip[] = [];
  if (filters.account) {
    chips.push(
      businessFilterChip({ accountId: filters.account, name: businessName, onRemove: () => setFilters({ account: '' }) }),
    );
  }

  return (
    <AdminFilterBar
      what={ACTIVITY_WHAT}
      busy={busy}
      onRefresh={onRefresh}
      readAt={readAt}
      windowControl={{
        value: filters.window,
        defaultValue: ACTIVITY_DEFAULT_WINDOW,
        onChange: (next) => setFilters({ window: next }),
        extras: ACTIVITY_WINDOW_EXTRAS,
        // The route takes two whole dates and nothing else.
        requireBothDates: true,
      }}
      business={
        <div className="w-full sm:w-64">
          <AdminBusinessPicker selectedAccountId={filters.account} onSelect={onPickBusiness} />
        </div>
      }
      onClear={onClear}
      canClear={canClear}
      chips={chips}
    >
      <div className="w-full sm:w-40">
        <label htmlFor={areaId} className={ADMIN_FIELD_LABEL}>
          Area
        </label>
        <select
          id={areaId}
          value={filters.area}
          onChange={(event) => setFilters({ area: event.target.value })}
          className={`${ADMIN_FIELD_CONTROL} w-full`}
        >
          <option value="">All areas</option>
          {areaNames.map((area) => (
            <option key={area} value={area}>
              {area}
            </option>
          ))}
        </select>
      </div>

      <div className="w-full sm:w-40">
        <label htmlFor={outcomeId} className={ADMIN_FIELD_LABEL}>
          Outcome
        </label>
        <select
          id={outcomeId}
          value={filters.outcome}
          onChange={(event) => {
            const value = event.target.value;
            setFilters({ outcome: isOutcome(value) ? value : '' });
          }}
          className={`${ADMIN_FIELD_CONTROL} w-full`}
        >
          <option value="">All outcomes</option>
          {(Object.keys(OUTCOME_LABELS) as ActivityOutcome[]).map((outcome) => (
            <option key={outcome} value={outcome}>
              {OUTCOME_LABELS[outcome]}
            </option>
          ))}
        </select>
      </div>

      <div className="w-full sm:w-40">
        <label htmlFor={triggerId} className={ADMIN_FIELD_LABEL}>
          Trigger
        </label>
        <select
          id={triggerId}
          value={filters.trigger}
          onChange={(event) => {
            const value = event.target.value;
            setFilters({ trigger: isTrigger(value) ? value : '' });
          }}
          className={`${ADMIN_FIELD_CONTROL} w-full`}
        >
          <option value="">All triggers</option>
          {(Object.keys(TRIGGER_LABELS) as ActivityTrigger[]).map((trigger) => (
            <option key={trigger} value={trigger}>
              {TRIGGER_LABELS[trigger]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-start gap-2">
        <div>
          <label htmlFor={minCostId} className={ADMIN_FIELD_LABEL}>
            {MIN_COST_LABEL}
          </label>
          <input
            id={minCostId}
            type="text"
            inputMode="decimal"
            value={draft}
            placeholder="any"
            aria-invalid={minCostProblem !== null}
            aria-describedby={minCostProblem !== null ? minCostProblemId : undefined}
            onChange={(event) => {
              setMinCostProblem(null);
              setDraft(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                applyMinCost();
              }
            }}
            className={`${ADMIN_FIELD_CONTROL} w-28`}
          />
        </div>
        <div>
          <AdminFieldSpacer />
          <button
            type="button"
            aria-label={APPLY_MIN_COST_LABEL}
            onClick={applyMinCost}
            className={`rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700 ${FOCUS_RING}`}
          >
            Apply
          </button>
        </div>
        {minCostProblem && (
          <div>
            <AdminFieldSpacer />
            <p id={minCostProblemId} role="alert" data-testid="activity-min-cost-problem" className="py-1.5 text-xs text-red-300">
              {minCostProblem}
            </p>
          </div>
        )}
      </div>

      <div>
        <span id={sortLabelId} className={ADMIN_FIELD_LABEL}>
          {SORT_LABEL}
        </span>
        <div role="group" aria-labelledby={sortLabelId} className="inline-flex rounded-lg border border-slate-700 bg-slate-900/50 p-0.5">
          {(Object.keys(SORT_LABELS) as ActivitySort[]).map((sort) => {
            const pressed = filters.sort === sort;
            return (
              <button
                key={sort}
                type="button"
                aria-pressed={pressed}
                onClick={() => setFilters({ sort })}
                className={`rounded-md px-2.5 py-1.5 text-xs transition-colors ${FOCUS_RING} ${
                  pressed ? 'bg-purple-500/20 text-purple-200' : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                {SORT_LABELS[sort]}
              </button>
            );
          })}
        </div>
      </div>
    </AdminFilterBar>
  );
}
