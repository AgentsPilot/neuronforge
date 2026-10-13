'use client';

/**
 * The one filter bar (L-3, S1-FR-3): Today / 7d / 30d / This month / Custom
 * (UTC dates, applied with Apply so a half-typed date never fires a read) and
 * the business picker. Every control is a native element with a label.
 */

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

// Reused, not rebuilt (L-6): the audit trail's business picker over the
// existing admin businesses endpoint.
import { BusinessAccountPicker } from '@/app/admin/audit-trail/BusinessAccountPicker';
import { ADMIN_WINDOW_PRESETS, customRangeProblem } from '@/app/admin/components/adminWindowPresets';
import { cn } from '@/lib/utils';
import type { FinanceQuery } from '../financeUrl';
import {
  BUSINESS_CHIP,
  FILTER_APPLY,
  FILTER_FROM,
  FILTER_TO,
  PRESET_LABELS,
  SHOW_ALL_BUSINESSES,
} from '../financeCopy';

const FIELD = 'flex flex-col text-[11px] text-slate-400';
const INPUT = 'rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-400';

interface Props {
  query: FinanceQuery;
  /** The resolved window's dates, to seed the custom fields. */
  resolved: { from: string; to: string } | null;
  onChange: (query: FinanceQuery) => void;
}

export function FinanceFilterBar({ query, resolved, onChange }: Props) {
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
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap rounded-lg border border-slate-700 p-0.5" role="group" aria-label="Window">
          {ADMIN_WINDOW_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onChange({ ...query, preset: p, from: null, to: null })}
              aria-pressed={query.preset === p}
              className={cn(
                'rounded-md px-3 py-1 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-400',
                query.preset === p ? 'bg-purple-500/20 text-purple-200' : 'text-slate-300 hover:bg-slate-800'
              )}
            >
              {PRESET_LABELS[p]}
            </button>
          ))}
          <span
            className={cn('rounded-md px-3 py-1 text-xs', query.preset === 'custom' ? 'bg-purple-500/20 text-purple-200' : 'text-slate-500')}
            aria-current={query.preset === 'custom' ? 'true' : undefined}
          >
            {PRESET_LABELS.custom}
          </span>
        </div>

        <label className={FIELD}>
          {FILTER_FROM}
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={INPUT} />
        </label>
        <label className={FIELD}>
          {FILTER_TO}
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={INPUT} />
        </label>
        <button
          type="button"
          onClick={apply}
          className="rounded-lg border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-400"
        >
          {FILTER_APPLY}
        </button>

        <div className="w-64">
          <BusinessAccountPicker
            selectedAccountId={query.accountId ?? ''}
            onSelect={(accountId) => onChange({ ...query, accountId: accountId || null })}
          />
        </div>
      </div>

      {problem && (
        <p className="text-xs text-amber-300" role="alert">
          {problem}
        </p>
      )}

      {query.accountId && (
        <p className="flex items-center gap-2 text-xs text-slate-300" data-testid="finance-account-chip">
          {BUSINESS_CHIP} <span className="font-medium">{`${query.accountId.slice(0, 8)}…`}</span>
          <button
            type="button"
            onClick={() => onChange({ ...query, accountId: null })}
            className="inline-flex items-center gap-1 rounded border border-slate-700 px-2 py-0.5 hover:bg-slate-800"
          >
            <X className="h-3 w-3" aria-hidden="true" />
            {SHOW_ALL_BUSINESSES}
          </button>
        </p>
      )}
    </div>
  );
}
