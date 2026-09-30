'use client';

/**
 * Slice 1c (FR-5): the controls above the invite list — state, invite type and
 * an email search. They only describe the filter; `inviteFilter.ts` applies it.
 * The type options come from the GET payload, so this names no invite type.
 */

import { Search, X } from 'lucide-react';

import {
  INVITE_ISSUER_FILTERS,
  INVITE_STATE_FILTERS,
  type InviteIssuerFilter,
  type InviteListFilter,
  type InviteStateFilter,
} from '../inviteFilter';

interface Props {
  filter: InviteListFilter;
  inviteTypes: Array<{ type: string; label: string }>;
  shown: number;
  total: number;
  isActive: boolean;
  onChange: (filter: InviteListFilter) => void;
  onClear: () => void;
}

export function InviteFilters({ filter, inviteTypes, shown, total, isActive, onChange, onClear }: Props) {
  return (
    <div data-testid="invite-filters" className="mb-3 flex flex-wrap items-center gap-2">
      <label className="relative flex items-center">
        <span className="sr-only">Search by email</span>
        <Search className="pointer-events-none absolute left-2 h-4 w-4 text-slate-500" aria-hidden="true" />
        <input
          type="search"
          data-testid="invite-search"
          value={filter.query}
          onChange={(event) => onChange({ ...filter, query: event.target.value })}
          placeholder="Search email"
          maxLength={320}
          autoComplete="off"
          className="w-56 rounded border border-slate-600 bg-slate-900 py-1.5 pl-8 pr-2 text-sm text-slate-200 placeholder:text-slate-500"
        />
      </label>

      <label className="flex items-center gap-1 text-sm text-slate-400">
        <span className="sr-only">Filter by state</span>
        <select
          data-testid="invite-state-filter"
          value={filter.state}
          onChange={(event) => onChange({ ...filter, state: event.target.value as InviteStateFilter })}
          className="rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm text-slate-200"
        >
          {INVITE_STATE_FILTERS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-1 text-sm text-slate-400">
        <span className="sr-only">Filter by invite type</span>
        <select
          data-testid="invite-type-filter"
          value={filter.inviteType}
          onChange={(event) => onChange({ ...filter, inviteType: event.target.value })}
          className="rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm text-slate-200"
        >
          <option value="all">All types</option>
          {inviteTypes.map((option) => (
            <option key={option.type} value={option.type}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-1 text-sm text-slate-400">
        <span className="sr-only">Filter by issuer</span>
        <select
          data-testid="invite-issuer-filter"
          value={filter.issuer}
          onChange={(event) => onChange({ ...filter, issuer: event.target.value as InviteIssuerFilter })}
          className="rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm text-slate-200"
        >
          {INVITE_ISSUER_FILTERS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {isActive && (
        <button
          type="button"
          onClick={onClear}
          className="flex items-center gap-1 rounded border border-slate-600 px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-700/50"
        >
          <X className="h-3 w-3" aria-hidden="true" />
          Clear
        </button>
      )}

      <span data-testid="invite-filter-count" className="text-xs text-slate-500">
        {isActive ? `${shown} of ${total} shown` : `${total} ${total === 1 ? 'invite' : 'invites'}`}
      </span>
    </div>
  );
}
