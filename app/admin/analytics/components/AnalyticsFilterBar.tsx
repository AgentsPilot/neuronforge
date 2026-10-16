'use client';

/**
 * AI cost & usage's filter bar (Admin Layout Standard §5.5, §7.5; L-2a workplan
 * §3.7): Window (the standard five plus this page's 24 hours and 90 days),
 * Business, Scope, Group by, Clear, Read at + Refresh, and the chip row.
 *
 * Scope stays the one-click `role="switch"` (SA Q-7, a recorded page deviation
 * from §5.5 part 4). Its accessible name reads the visible "Scope" label AND
 * its own text, "Scope Business OS only", because the on / off state refers to
 * "Business OS only" (SA M-3).
 *
 * Chips: the business; the category (All scope); one per applied drill filter,
 * with the label recorded at the drill click while its id is applied, else the
 * value itself (an id shortened, the full value on hover; SA-R-11, RC-6: no
 * lookup).
 */

import { useId } from 'react';

import {
  ADMIN_FIELD_CONTROL,
  ADMIN_FIELD_LABEL,
  AdminFilterBar,
  type AdminActiveChip,
} from '@/app/admin/components/layout/AdminFilterBar';
import { AdminBusinessPicker, businessFilterChip } from '@/app/admin/components/layout/AdminBusinessPicker';
import { formatShortId } from '@/app/admin/components/layout/adminTable';

import {
  ANALYTICS_DEFAULT_WINDOW,
  ANALYTICS_WINDOW_EXTRAS,
  isExecutionValue,
  isUuid,
  type AnalyticsFilters,
  type DrillField,
} from '../analyticsFilters';
import { breakdownOptionsFor, type Scope } from '../analyticsTypes';

/** A readable label recorded at a drill click, valid only while `id` is the applied value. */
export interface DrillLabel {
  id: string;
  label: string;
}

export type DrillLabels = Partial<Record<DrillField, DrillLabel>>;

/** The noun phrase for "Read at", "Refresh …" and the shared states. */
export const ANALYTICS_WHAT = 'AI calls and usage';

/** Drill chips in bar order. Agent and execution exist only in the All scope (C3-2). */
const DRILL_CHIPS: ReadonlyArray<{ field: Exclude<DrillField, 'account'>; key: string; name: string; allOnly?: boolean }> = [
  { field: 'provider', key: 'provider', name: 'Provider' },
  { field: 'model', key: 'model', name: 'Model' },
  { field: 'activity', key: 'activity', name: 'Activity' },
  { field: 'requestType', key: 'request_type', name: 'Request type' },
  { field: 'feature', key: 'feature', name: 'Feature' },
  { field: 'component', key: 'component', name: 'Component' },
  { field: 'endpoint', key: 'endpoint', name: 'Endpoint' },
  { field: 'agent', key: 'agent', name: 'Agent', allOnly: true },
  { field: 'execution', key: 'execution', name: 'Execution', allOnly: true },
];

const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  creation: 'Creation',
  execution: 'Execution',
  memory: 'Memory',
  system: 'System',
};

/** The recorded label while its id is applied; else the value, an id shortened. */
export function drillValueLabel(labels: DrillLabels, field: DrillField, value: string): string {
  const recorded = labels[field];
  if (recorded && recorded.id === value) return recorded.label;
  return isUuid(value) || isExecutionValue(value) ? formatShortId(value) : value;
}

const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500';

export interface AnalyticsFilterBarProps {
  filters: AnalyticsFilters;
  setFilters: (patch: Partial<AnalyticsFilters>) => void;
  onClear: () => void;
  canClear: boolean;
  onScopeToggle: () => void;
  labels: DrillLabels;
  /** The business last picked in the picker, with its name (not in the URL). */
  pickedBusiness: { accountId: string; name: string | null } | null;
  onPickBusiness: (accountId: string, name: string | null) => void;
  busy: boolean;
  readAt: string | null;
  onRefresh: () => void;
}

export function AnalyticsFilterBar({
  filters,
  setFilters,
  onClear,
  canClear,
  onScopeToggle,
  labels,
  pickedBusiness,
  onPickBusiness,
  busy,
  readAt,
  onRefresh,
}: AnalyticsFilterBarProps) {
  const scopeLabelId = useId();
  const scopeTextId = useId();
  const groupById = useId();
  const scope: Scope = filters.scope;
  const isBos = scope === 'bos';

  const chips: AdminActiveChip[] = [];
  if (filters.account) {
    // The picked name first (only for the id it was picked for), then a drill
    // label for the same id, else the short id.
    const pickedName =
      pickedBusiness && pickedBusiness.accountId === filters.account ? pickedBusiness.name : null;
    const drilled = labels.account && labels.account.id === filters.account ? labels.account.label : null;
    chips.push(
      businessFilterChip({
        accountId: filters.account,
        name: pickedName ?? drilled,
        onRemove: () => setFilters({ account: '' }),
      }),
    );
  }
  if (!isBos && filters.category !== 'all') {
    chips.push({
      key: 'category',
      label: `Category: ${CATEGORY_LABELS[filters.category] ?? filters.category}`,
      testId: 'filter-chip-category',
      removeLabel: 'Remove category',
      onRemove: () => setFilters({ category: 'all' }),
    });
  }
  for (const { field, key, name, allOnly } of DRILL_CHIPS) {
    const value = filters[field];
    if (!value || (allOnly && isBos)) continue;
    chips.push({
      key,
      label: `${name}: ${drillValueLabel(labels, field, value)}`,
      title: value,
      testId: `filter-chip-${key}`,
      removeLabel: `Remove ${name.toLowerCase()}`,
      onRemove: () => setFilters({ [field]: '' }),
    });
  }

  return (
    <AdminFilterBar
      what={ANALYTICS_WHAT}
      busy={busy}
      onRefresh={onRefresh}
      readAt={readAt}
      windowControl={{
        value: filters.window,
        defaultValue: ANALYTICS_DEFAULT_WINDOW,
        onChange: (next) => setFilters({ window: next }),
        extras: ANALYTICS_WINDOW_EXTRAS,
        // The route takes a two-sided window only (SA Q-3).
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
      <div>
        <span id={scopeLabelId} className={ADMIN_FIELD_LABEL}>
          Scope
        </span>
        {/* Business OS lens (slice 2a). The route applies the platform's own
            definition of a Business OS row, legacy-tagged rows included. */}
        <button
          type="button"
          role="switch"
          aria-checked={isBos}
          aria-labelledby={`${scopeLabelId} ${scopeTextId}`}
          data-testid="scope-toggle"
          onClick={onScopeToggle}
          className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${FOCUS_RING} ${
            isBos
              ? 'border-purple-500/50 bg-purple-500/20 text-purple-200'
              : 'border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white'
          }`}
        >
          <span id={scopeTextId}>Business OS only</span>
        </button>
      </div>
      <div className="w-full sm:w-44">
        <label htmlFor={groupById} className={ADMIN_FIELD_LABEL}>
          Group by
        </label>
        <select
          id={groupById}
          data-testid="group-by-select"
          value={filters.groupBy}
          onChange={(event) => {
            const picked = breakdownOptionsFor(scope).find((option) => option.value === event.target.value);
            if (picked) setFilters({ groupBy: picked.value });
          }}
          className={`${ADMIN_FIELD_CONTROL} w-full`}
        >
          {breakdownOptionsFor(scope).map((option) => (
            <option key={option.value} value={option.value} data-testid={`group-by-${option.value}`}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </AdminFilterBar>
  );
}
