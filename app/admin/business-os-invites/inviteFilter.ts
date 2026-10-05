/**
 * Slice 1c (FR-5, SA F-9): the list's filters and email search.
 *
 * ── Why on the screen, and why it decides nothing ───────────────────────────
 * The GET already returns the newest invites (up to the server's ceiling), so
 * filtering them here costs no second read and sends nothing the admin types to
 * the server or to a log. Every condition matches a field the server already
 * decided: `state` (from `deriveInviteState`), `openedByExistingAccountAt`, and
 * `redemptionStoppedHalfway` (the D-3 derivation). Nothing here compares a date,
 * so the screen can never disagree with the server about an invite's state
 * (C-11).
 *
 * "Opened by an existing account" and "stopped halfway" are conditions, not
 * states: an invite in either is still pending, expired or revoked as well.
 */

import type { InviteIssuerKind, InviteRow, InviteState } from './types';

export type InviteStateFilter = 'all' | InviteState | 'opened_by_existing_account' | 'stopped_halfway';

/** The state options, in the order the select shows them. */
export const INVITE_STATE_FILTERS: ReadonlyArray<{ value: InviteStateFilter; label: string }> = [
  { value: 'all', label: 'All states' },
  { value: 'pending', label: 'Pending' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'expired', label: 'Expired' },
  { value: 'revoked', label: 'Revoked' },
  { value: 'opened_by_existing_account', label: 'Opened by an existing account' },
  { value: 'stopped_halfway', label: 'Signup stopped halfway' },
];

/** Slice 5a (F5a-11): admin-issued, champion-issued (friend invites), or both. */
export type InviteIssuerFilter = 'all' | InviteIssuerKind;

/** The issuer options, in the order the select shows them. */
export const INVITE_ISSUER_FILTERS: ReadonlyArray<{ value: InviteIssuerFilter; label: string }> = [
  { value: 'all', label: 'All issuers' },
  { value: 'admin', label: 'Issued by an admin' },
  { value: 'account', label: 'Friend invites (champions)' },
];

/** `'all'` for the type or the issuer means no filter on it. */
export interface InviteListFilter {
  state: InviteStateFilter;
  inviteType: string;
  issuer: InviteIssuerFilter;
  query: string;
}

export const EMPTY_INVITE_FILTER: InviteListFilter = { state: 'all', inviteType: 'all', issuer: 'all', query: '' };

/** A row from an older server has no issuer: it was an admin invite. */
function issuerOf(invite: InviteRow): InviteIssuerKind {
  return invite.issuerKind ?? 'admin';
}

function matchesState(invite: InviteRow, state: InviteStateFilter): boolean {
  switch (state) {
    case 'all':
      return true;
    case 'opened_by_existing_account':
      return invite.openedByExistingAccountAt !== null;
    case 'stopped_halfway':
      return invite.redemptionStoppedHalfway;
    default:
      return invite.state === state;
  }
}

/**
 * The rows that pass every active condition, in their original order.
 *
 * The search is a case-insensitive substring of the email, taken literally: a
 * plain `includes`, so `%`, `_` and `*` are characters, not wildcards.
 */
export function filterInvites(invites: InviteRow[], filter: InviteListFilter): InviteRow[] {
  const needle = filter.query.trim().toLowerCase();
  return invites.filter(
    (invite) =>
      matchesState(invite, filter.state) &&
      (filter.inviteType === 'all' || invite.inviteType === filter.inviteType) &&
      (filter.issuer === 'all' || issuerOf(invite) === filter.issuer) &&
      (needle.length === 0 || invite.email.toLowerCase().includes(needle))
  );
}

/** True when any condition narrows the list. */
export function isFilterActive(filter: InviteListFilter): boolean {
  return filter.state !== 'all' || filter.inviteType !== 'all' || filter.issuer !== 'all' || filter.query.trim().length > 0;
}
