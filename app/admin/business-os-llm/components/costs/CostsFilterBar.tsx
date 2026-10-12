'use client';

/**
 * The Costs & credits tab's filter bar (Admin Layout Standard §5.5, §7.12;
 * L-9a workplan §2.3), replacing the tab's own controls:
 *
 *   Window (the standard five, then this tab's 90 days, D-2 (b); From / To
 *   under Custom only, both required) → Business (the shared picker, SA-R-11)
 *   → Clear → Read at + Refresh; and the business chip.
 *
 * Costs has no filter of its own (part 4). Every filter applies at once
 * through the tab's `useAdminFilters`, except Custom's dates (the shared Apply).
 *
 * The business chip names the business: the name picked in the picker, else
 * the report's own name for that account, else the short id (RC-6: no lookup).
 */

import { AdminFilterBar, type AdminActiveChip } from '@/app/admin/components/layout/AdminFilterBar';
import { AdminBusinessPicker, businessFilterChip } from '@/app/admin/components/layout/AdminBusinessPicker';

import { COSTS_WHAT } from '../../costCopy';
import { COSTS_DEFAULT_WINDOW, COSTS_WINDOW_EXTRAS, type CostsFilters } from '../../costsFilters';

export interface CostsFilterBarProps {
  filters: CostsFilters;
  setFilters: (patch: Partial<CostsFilters>) => void;
  onClear: () => void;
  canClear: boolean;
  /** The chip's name for the applied business, or null for the short id. */
  businessName: string | null;
  onPickBusiness: (accountId: string, name: string | null) => void;
  busy: boolean;
  readAt: string | null;
  onRefresh: () => void;
}

export function CostsFilterBar({
  filters,
  setFilters,
  onClear,
  canClear,
  businessName,
  onPickBusiness,
  busy,
  readAt,
  onRefresh,
}: CostsFilterBarProps) {
  const chips: AdminActiveChip[] = [];
  if (filters.account) {
    chips.push(
      businessFilterChip({ accountId: filters.account, name: businessName, onRemove: () => setFilters({ account: '' }) }),
    );
  }

  return (
    <AdminFilterBar
      what={COSTS_WHAT}
      busy={busy}
      onRefresh={onRefresh}
      readAt={readAt}
      windowControl={{
        value: filters.window,
        defaultValue: COSTS_DEFAULT_WINDOW,
        onChange: (next) => setFilters({ window: next }),
        extras: COSTS_WINDOW_EXTRAS,
        // The route takes two whole dates or neither.
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
    />
  );
}
