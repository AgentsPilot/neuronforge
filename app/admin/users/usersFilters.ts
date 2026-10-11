/**
 * The Businesses list's URL filter (Admin Layout Standard §5.6, §7.7; L-4a).
 *
 * Only the status lives in the address bar, through `useAdminFilters`: the
 * default `active` is omitted (U-3) and an unknown value is ignored (U-4). The
 * search text is held by the page and is never read from or written to the URL
 * (D-6 (a)): it is usually a person's name or email.
 *
 * Module-level on purpose: the hook relies on the spec's identity being stable.
 */

import { textFilter, type AdminFilterSpec } from '@/app/admin/components/layout/useAdminFilters';
import { toStatusFilter } from './userName';

export interface UsersFilters {
  /** One of the list route's three values; `toStatusFilter` narrows it at the use site. */
  status: string;
}

export const USERS_FILTER_SPEC: AdminFilterSpec<UsersFilters> = {
  status: textFilter({
    key: 'status',
    defaultValue: 'active',
    // The three values the list route accepts, from the one place that names them (SA S-2).
    isValid: (raw) => toStatusFilter(raw) === raw,
  }),
};

/** Noun phrase for the bar, the loading line and the fixed error copy. */
export const USERS_WHAT = 'the business list';
