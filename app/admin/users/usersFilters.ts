/**
 * The Businesses list's URL filter (Admin Layout Standard §5.6, §7.7; L-4a).
 *
 * Only the status lives in the address bar, through `useAdminFilters`: the
 * default `active` is omitted (U-3) and an unknown value is ignored (U-4). The
 * search text is held by the page and is never read from or written to the URL
 * (D-6 (a)): it is usually a person's name or email.
 *
 * `account` is a one-shot inbound key (Money M-1, SA-Q33, SA-W57; layout U-10
 * exception, E-38): read on arrival, never written, removed by the hook's first
 * write. It opens that business's drawer once the list has loaded, and filters
 * nothing. The precedent is Audit trail's page-only `search`.
 *
 * Module-level on purpose: the hook relies on the spec's identity being stable.
 */

import { textFilter, type AdminFilterSpec } from '@/app/admin/components/layout/useAdminFilters';
import { toStatusFilter } from './userName';

export interface UsersFilters {
  /** One of the list route's three values; `toStatusFilter` narrows it at the use site. */
  status: string;
  /** One-shot: an account id to open once on arrival ('' = none). Page-only, never written. */
  account: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const USERS_FILTER_SPEC: AdminFilterSpec<UsersFilters> = {
  status: textFilter({
    key: 'status',
    defaultValue: 'active',
    // The three values the list route accepts, from the one place that names them (SA S-2).
    isValid: (raw) => toStatusFilter(raw) === raw,
  }),
  // A malformed value fails `isValid`, so it is ignored; the mount write removes it either way.
  account: textFilter({ key: 'account', defaultValue: '', pageOnly: true, isValid: (raw) => UUID.test(raw) }),
};

/** Noun phrase for the bar, the loading line and the fixed error copy. */
export const USERS_WHAT = 'the business list';
