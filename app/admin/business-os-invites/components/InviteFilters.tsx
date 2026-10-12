'use client';

/**
 * Slice 1c (FR-5): the controls above the invite list — an email search, state,
 * invite type and issuer. They only describe the filter; `inviteFilter.ts`
 * applies it. The type options come from the GET payload, so this names no
 * invite type.
 *
 * ── The shared filter bar (Admin Layout Standard L-6, §5.5) ─────────────────
 * Since L-6 this is the page's bar: the four controls with visible labels, a
 * Clear that is always there (disabled at the defaults), "Read at" and Refresh.
 * No Window and no business slot: invites have no date filter (C-11) and are
 * not per business.
 *
 * ── Never the URL (D-7 (a)) ─────────────────────────────────────────────────
 * The filter lives in the page's own state and is never written to the URL,
 * history or storage: this page shows a once-only invite link, and nothing on
 * it may survive a reload. That is why this file uses the bar but not the
 * shared URL hook; the source guard proves it, transitively.
 *
 * ── Nothing to filter (SA L-6 M-3) ──────────────────────────────────────────
 * Before the first read and over an empty list the bar is Refresh-only. The bar
 * counts as "has controls" when its children OR its `onClear` is set, so the
 * three come from one conditional object, all undefined together.
 */

import { useId } from 'react';

import { ADMIN_FIELD_CONTROL, ADMIN_FIELD_LABEL, AdminFilterBar } from '@/app/admin/components/layout/AdminFilterBar';

import {
  INVITE_ISSUER_FILTERS,
  INVITE_STATE_FILTERS,
  isFilterActive,
  type InviteIssuerFilter,
  type InviteListFilter,
  type InviteStateFilter,
} from '../inviteFilter';

/** Noun phrase: Refresh is named "Refresh invites", the loading line "Reading invites…". */
export const INVITES_WHAT = 'invites';

interface Props {
  filter: InviteListFilter;
  inviteTypes: Array<{ type: string; label: string }>;
  /** False before the first read and when the read returned no invites: Refresh only. */
  hasInvites: boolean;
  onChange: (filter: InviteListFilter) => void;
  onClear: () => void;
  onRefresh: () => void;
  busy: boolean;
  /** ISO time of the last successful read. */
  readAt: string | null;
}

export function InviteFilters({ filter, inviteTypes, hasInvites, onChange, onClear, onRefresh, busy, readAt }: Props) {
  const searchId = useId();
  const stateId = useId();
  const typeId = useId();
  const issuerId = useId();

  // One object, so the three can never disagree about whether there are controls.
  const controls = hasInvites
    ? {
        children: (
          <>
            <div>
              <label htmlFor={searchId} className={ADMIN_FIELD_LABEL}>
                Search
              </label>
              <input
                id={searchId}
                type="search"
                data-testid="invite-search"
                value={filter.query}
                onChange={(event) => onChange({ ...filter, query: event.target.value })}
                placeholder="Search email"
                maxLength={320}
                autoComplete="off"
                className={`${ADMIN_FIELD_CONTROL} w-56`}
              />
            </div>

            <div>
              <label htmlFor={stateId} className={ADMIN_FIELD_LABEL}>
                State
              </label>
              <select
                id={stateId}
                data-testid="invite-state-filter"
                value={filter.state}
                onChange={(event) => onChange({ ...filter, state: event.target.value as InviteStateFilter })}
                className={ADMIN_FIELD_CONTROL}
              >
                {INVITE_STATE_FILTERS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor={typeId} className={ADMIN_FIELD_LABEL}>
                Invite type
              </label>
              <select
                id={typeId}
                data-testid="invite-type-filter"
                value={filter.inviteType}
                onChange={(event) => onChange({ ...filter, inviteType: event.target.value })}
                className={ADMIN_FIELD_CONTROL}
              >
                <option value="all">All types</option>
                {inviteTypes.map((option) => (
                  <option key={option.type} value={option.type}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor={issuerId} className={ADMIN_FIELD_LABEL}>
                Issuer
              </label>
              <select
                id={issuerId}
                data-testid="invite-issuer-filter"
                value={filter.issuer}
                onChange={(event) => onChange({ ...filter, issuer: event.target.value as InviteIssuerFilter })}
                className={ADMIN_FIELD_CONTROL}
              >
                {INVITE_ISSUER_FILTERS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </>
        ),
        onClear,
        canClear: isFilterActive(filter),
      }
    : { children: undefined, onClear: undefined, canClear: undefined };

  return <AdminFilterBar what={INVITES_WHAT} busy={busy} readAt={readAt} onRefresh={onRefresh} {...controls} />;
}
