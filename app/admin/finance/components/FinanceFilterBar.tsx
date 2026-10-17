'use client';

/**
 * The finance page's filter bar (Finance F-4, Admin Layout Standard §5.5):
 * a thin wrapper over the shared `AdminFilterBar`, as AI cost & usage's
 * `AnalyticsFilterBar` is. In the fixed §5.5 order: the Window control
 * (Today, 7 days, 30 days, This month, Custom; the shared `DatePresets`, Apply
 * needing both dates), the shared business picker, Clear, then "Read at" and
 * Refresh (DV-1 ended: Refresh left the header), the chip row, and the
 * picker's standing help line as the bar's last line.
 *
 * F-4 replaces the LF-6 local alignment, the local preset buttons and M-1's
 * local chip renderer with the shared bar, which owns all three. The chip is
 * the shared `businessFilterChip` ("Business: {name}", else the short id; X
 * "Remove business"); the name is the view's (SA-Q32), never the URL's.
 *
 * SA-W5 (a): a custom window the finance route would refuse (an end after
 * today UTC, more than 92 days) is not applied; its sentence shows under the
 * bar as a red alert while the Custom row stays open to fix it.
 *
 * DF-6 (DF6-FR-9): "Since it started" is offered only while a business is picked.
 */

import { useId } from 'react';

import { AdminBusinessPicker, businessFilterChip } from '@/app/admin/components/layout/AdminBusinessPicker';
import { AdminFilterBar } from '@/app/admin/components/layout/AdminFilterBar';
import type { AdminWindowValue } from '@/app/admin/components/layout/adminWindow';

import { FILTER_BUSINESS_HELP } from '../financeCopy';
import { FINANCE_DEFAULT_WINDOW, FINANCE_WINDOW_EXTRAS, type FinanceFilters } from '../financeFilters';
import { FINANCE_WHAT } from '../useFinanceData';

interface Props {
  filters: FinanceFilters;
  onWindowChange: (next: AdminWindowValue) => void;
  /** A business picked: its id and the picked name (the name stays in the view's state, never the URL). */
  onPick: (accountId: string, name: string | null) => void;
  onRemoveBusiness: () => void;
  /** The chip's name, decided by the view (SA-Q32); null shows the short id. */
  chipName: string | null;
  onClear: () => void;
  canClear: boolean;
  busy: boolean;
  /** The payload's `generatedAt`, for "Read at HH:mm UTC". */
  readAt: string | null;
  onRefresh: () => void;
  /** SA-W5 (a): the refused custom window's sentence, or null. */
  windowProblem: string | null;
}

export function FinanceFilterBar({
  filters,
  onWindowChange,
  onPick,
  onRemoveBusiness,
  chipName,
  onClear,
  canClear,
  busy,
  readAt,
  onRefresh,
  windowProblem,
}: Props) {
  const helpId = useId();

  return (
    <div className="space-y-2" data-testid="finance-filters">
      <AdminFilterBar
        what={FINANCE_WHAT}
        busy={busy}
        readAt={readAt}
        onRefresh={onRefresh}
        windowControl={{
          value: filters.window,
          defaultValue: FINANCE_DEFAULT_WINDOW,
          onChange: onWindowChange,
          extras: filters.account ? FINANCE_WINDOW_EXTRAS : [],
          requireBothDates: true,
        }}
        business={
          <div className="w-64">
            <AdminBusinessPicker selectedAccountId={filters.account} onSelect={onPick} describedBy={helpId} />
          </div>
        }
        onClear={onClear}
        canClear={canClear}
        chips={filters.account ? [businessFilterChip({ accountId: filters.account, name: chipName, onRemove: onRemoveBusiness })] : []}
        help={{ id: helpId, text: FILTER_BUSINESS_HELP, testId: 'finance-business-help' }}
      />
      {windowProblem && (
        <p role="alert" className="text-xs text-red-300" data-testid="finance-window-problem">
          {windowProblem}
        </p>
      )}
    </div>
  );
}
