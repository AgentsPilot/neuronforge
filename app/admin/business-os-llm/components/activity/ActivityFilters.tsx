'use client';

/**
 * The Activity tab's controls (FR-B3, NFR-7): six window presets plus an
 * explicit From / To, the business, area, outcome and trigger filters, a
 * minimum cost, and the sort. Every control is a native element with a label,
 * so it is reachable and named for a keyboard or a screen reader.
 *
 * Presets, selects and the sort apply at once. The typed values (dates and the
 * minimum cost) apply with the Apply button, so a half-typed date never fires
 * a read.
 */

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

// Reused, not rebuilt (OQ-3, SA-approved): the audit trail's business picker
// over the existing admin businesses endpoint. Its `@/lib/logger` import is
// client-safe and already in the admin bundle.
import { BusinessAccountPicker } from '@/app/admin/audit-trail/BusinessAccountPicker';

import { ACTIVITY_PRESETS, type ActivityPreset } from '../../activityPresets';
import {
  OUTCOME_LABELS,
  PRESET_LABELS,
  SHOW_ALL_BUSINESSES,
  SORT_LABELS,
  TRIGGER_LABELS,
} from '../../activityCopy';
import type { ActivityAreaOption, ActivityOutcome, ActivitySort, ActivityTrigger } from '../../activityTypes';

export interface ActivityQuery {
  from: string;
  to: string;
  accountId: string;
  area: string;
  outcome: '' | ActivityOutcome;
  trigger: '' | ActivityTrigger;
  minCostUsd: string;
  sort: ActivitySort;
}

interface Props {
  query: ActivityQuery;
  preset: ActivityPreset | 'custom';
  areas: ActivityAreaOption[];
  /** The chosen business's name when the list has one, for the chip. */
  accountLabel: string | null;
  onPreset: (preset: ActivityPreset) => void;
  onChange: (patch: Partial<ActivityQuery>, custom?: boolean) => void;
}

const SELECT = 'rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200';
const FIELD = 'flex flex-col text-[11px] text-slate-400';

export function ActivityFilters({ query, preset, areas, accountLabel, onPreset, onChange }: Props) {
  const [from, setFrom] = useState(query.from);
  const [to, setTo] = useState(query.to);
  const [minCost, setMinCost] = useState(query.minCostUsd);

  // A preset moves the window: the typed fields follow it.
  useEffect(() => {
    setFrom(query.from);
    setTo(query.to);
  }, [query.from, query.to]);

  const apply = () => {
    const custom = from !== query.from || to !== query.to;
    onChange({ from, to, minCostUsd: minCost.trim() }, custom);
  };

  return (
    <div className="space-y-3" data-testid="activity-controls">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap rounded-lg border border-slate-700 p-0.5" role="group" aria-label="Window">
          {ACTIVITY_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onPreset(p)}
              aria-pressed={preset === p}
              className={`rounded-md px-3 py-1 text-xs ${
                preset === p ? 'bg-purple-500/20 text-purple-200' : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              {PRESET_LABELS[p]}
            </button>
          ))}
        </div>

        <label className={FIELD}>
          From (UTC)
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={SELECT} />
        </label>
        <label className={FIELD}>
          To (UTC)
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={SELECT} />
        </label>
        <label className={FIELD}>
          Minimum cost (USD)
          <input
            type="text"
            inputMode="decimal"
            value={minCost}
            placeholder="any"
            onChange={(e) => setMinCost(e.target.value)}
            className={`${SELECT} w-28`}
          />
        </label>
        <button
          type="button"
          onClick={apply}
          className="rounded-lg border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800"
        >
          Apply
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-64">
          <BusinessAccountPicker selectedAccountId={query.accountId} onSelect={(accountId) => onChange({ accountId })} />
        </div>

        <label className={FIELD}>
          Area
          <select value={query.area} onChange={(e) => onChange({ area: e.target.value })} className={SELECT}>
            <option value="">All areas</option>
            {areas.map((a) => (
              <option key={a.area} value={a.area}>
                {a.area}
              </option>
            ))}
          </select>
        </label>

        <label className={FIELD}>
          Outcome
          <select
            value={query.outcome}
            onChange={(e) => onChange({ outcome: e.target.value as ActivityQuery['outcome'] })}
            className={SELECT}
          >
            <option value="">All outcomes</option>
            {(Object.keys(OUTCOME_LABELS) as ActivityOutcome[]).map((o) => (
              <option key={o} value={o}>
                {OUTCOME_LABELS[o]}
              </option>
            ))}
          </select>
        </label>

        <label className={FIELD}>
          Trigger
          <select
            value={query.trigger}
            onChange={(e) => onChange({ trigger: e.target.value as ActivityQuery['trigger'] })}
            className={SELECT}
          >
            <option value="">All triggers</option>
            {(Object.keys(TRIGGER_LABELS) as ActivityTrigger[]).map((t) => (
              <option key={t} value={t}>
                {TRIGGER_LABELS[t]}
              </option>
            ))}
          </select>
        </label>

        <div className="flex rounded-lg border border-slate-700 p-0.5" role="group" aria-label="Sort">
          {(Object.keys(SORT_LABELS) as ActivitySort[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onChange({ sort: s })}
              aria-pressed={query.sort === s}
              className={`rounded-md px-3 py-1 text-xs ${
                query.sort === s ? 'bg-purple-500/20 text-purple-200' : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              {SORT_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      {query.accountId && (
        <p className="flex items-center gap-2 text-xs text-slate-300" data-testid="activity-account-chip">
          Business: <span className="font-medium">{accountLabel ?? `${query.accountId.slice(0, 8)}…`}</span>
          <button
            type="button"
            onClick={() => onChange({ accountId: '' })}
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
