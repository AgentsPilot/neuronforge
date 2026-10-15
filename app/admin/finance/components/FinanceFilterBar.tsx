'use client';

/**
 * The one filter bar (L-3, S1-FR-3): Today / 7d / 30d / This month / Custom
 * (UTC dates, applied with Apply so a half-typed date never fires a read) and
 * the business picker. Every control is a native element with a label.
 *
 * LF-6 (user request 2026-10-14): the L-4a alignment, applied locally. The row
 * is top-aligned; every field is a label row then a control, and the controls
 * with no label of their own (the Window group, Apply) sit under
 * `AdminFieldSpacer`, so all inputs start on one line. The picker's help line
 * stays under its input and only grows the picker column downward. Control
 * heights match the picker input (L-4a SA Q-6).
 *
 * Money M-1 (M1-FR-1 to M1-FR-3, SA-W68, SA-W70): the business picker is the
 * shared `AdminBusinessPicker` (the original audit-trail picker is deleted). Its
 * standing note is a page-owned help line under the whole row, wired to the
 * picker's input through `describedBy` (the L-4a SA Q-5 pattern), so the row
 * keeps its five items. The active chip is the shared `businessFilterChip`
 * wording ("Business: {name}", else the short id; X "Remove business"),
 * rendered by a LOCAL `FinanceActiveChip` until Finance moves onto
 * `AdminFilterBar` in M-6 (DF-4). The URL keys are unchanged (`accountId`).
 */

import { useEffect, useId, useState } from 'react';
import { X } from 'lucide-react';

import { ADMIN_WINDOW_PRESETS, customRangeProblem } from '@/app/admin/components/adminWindowPresets';
import { AdminBusinessPicker, businessFilterChip } from '@/app/admin/components/layout/AdminBusinessPicker';
import { AdminFieldSpacer, type AdminActiveChip } from '@/app/admin/components/layout/AdminFilterBar';
import { cn } from '@/lib/utils';
import type { FinanceQuery } from '../financeUrl';
import { FILTER_APPLY, FILTER_BUSINESS_HELP, FILTER_FROM, FILTER_TO, PRESET_LABELS } from '../financeCopy';

// gap-1: the label row is then exactly `AdminFieldSpacer`'s height (an 11px line plus mb-1).
const FIELD = 'flex flex-col gap-1 text-[11px] text-slate-400';
// py-2: as tall as the picker input, so the controls also end on one line.
const INPUT = 'rounded border border-slate-700 bg-slate-900 px-2 py-2 text-xs text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-400';

/**
 * SA-W68 / SA-WR-39: the shared chip object, rendered with the same classes as
 * `AdminFilterBar`'s private `Chip`. LOCAL and never exported: Money M-6 (DF-4)
 * moves Finance onto `AdminFilterBar`, which deletes this. Its label, title,
 * test id and remove label are the object's, unchanged.
 */
function FinanceActiveChip({ chip }: { chip: AdminActiveChip }) {
  return (
    <span
      data-testid={chip.testId}
      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-200"
    >
      <span className="max-w-[18rem] truncate" title={chip.title}>
        {chip.label}
      </span>
      <button
        type="button"
        aria-label={chip.removeLabel}
        onClick={chip.onRemove}
        className="flex h-5 w-5 items-center justify-center rounded text-slate-300 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </span>
  );
}

interface Props {
  query: FinanceQuery;
  /** The resolved window's dates, to seed the custom fields. */
  resolved: { from: string; to: string } | null;
  onChange: (query: FinanceQuery) => void;
  /** A business picked: its id and the picked name (the name stays in the view's state, never the URL). */
  onPick: (accountId: string, name: string | null) => void;
  /** The chip's name, decided by the view (SA-Q32); null shows the short id. */
  chipName: string | null;
}

export function FinanceFilterBar({ query, resolved, onChange, onPick, chipName }: Props) {
  const helpId = useId();
  const [from, setFrom] = useState(query.from ?? resolved?.from ?? '');
  const [to, setTo] = useState(query.to ?? resolved?.to ?? '');
  const [problem, setProblem] = useState<string | null>(null);

  // A preset moves the window: the typed fields follow it.
  useEffect(() => {
    setFrom(query.from ?? resolved?.from ?? '');
    setTo(query.to ?? resolved?.to ?? '');
  }, [query.from, query.to, resolved?.from, resolved?.to]);

  const apply = () => {
    const issue = customRangeProblem(from, to, new Date());
    setProblem(issue);
    if (!issue) onChange({ ...query, preset: 'custom', from, to });
  };

  return (
    <div className="space-y-2" data-testid="finance-filters">
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <AdminFieldSpacer />
          <div className="flex flex-wrap rounded-lg border border-slate-700 p-0.5" role="group" aria-label="Window">
            {ADMIN_WINDOW_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => onChange({ ...query, preset: p, from: null, to: null })}
                aria-pressed={query.preset === p}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-400',
                  query.preset === p ? 'bg-purple-500/20 text-purple-200' : 'text-slate-300 hover:bg-slate-800'
                )}
              >
                {PRESET_LABELS[p]}
              </button>
            ))}
            <span
              className={cn('rounded-md px-3 py-1.5 text-xs', query.preset === 'custom' ? 'bg-purple-500/20 text-purple-200' : 'text-slate-400')}
              aria-current={query.preset === 'custom' ? 'true' : undefined}
            >
              {PRESET_LABELS.custom}
            </span>
          </div>
        </div>

        <label className={FIELD}>
          {FILTER_FROM}
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={INPUT} />
        </label>
        <label className={FIELD}>
          {FILTER_TO}
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={INPUT} />
        </label>
        <div>
          <AdminFieldSpacer />
          <button
            type="button"
            onClick={apply}
            className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-400"
          >
            {FILTER_APPLY}
          </button>
        </div>

        {/* The shared picker renders no note of its own; the help line under
            the row describes it (SA-W70 b), so this column is no taller than
            its neighbours. */}
        <div className="w-64">
          <AdminBusinessPicker
            selectedAccountId={query.accountId ?? ''}
            onSelect={(accountId, name) => onPick(accountId, name)}
            describedBy={helpId}
          />
        </div>
      </div>

      <p id={helpId} className="text-xs text-slate-400" data-testid="finance-business-help">
        {FILTER_BUSINESS_HELP}
      </p>

      {problem && (
        <p className="text-xs text-amber-300" role="alert">
          {problem}
        </p>
      )}

      {query.accountId && (
        <div className="flex flex-wrap items-center gap-2">
          <FinanceActiveChip
            chip={businessFilterChip({
              accountId: query.accountId,
              name: chipName,
              onRemove: () => onChange({ ...query, accountId: null }),
            })}
          />
        </div>
      )}
    </div>
  );
}
