/**
 * The Environment page's filters (admin environment view EC-4; requirement
 * FR-21; Admin Layout Standard §5.5, §5.6; SA Q4-7, Q4-11, E4-4).
 *
 * - `group` lives in the address bar through `useAdminFilters`: the default
 *   (all groups) is omitted (U-3) and an unknown id is ignored (U-4).
 * - `search` is page-only (U-1, D-6 (a)): read from an inbound link, never
 *   written to the URL.
 *
 * The page URL's filters never reach the API request: the route refuses any
 * parameter (SA-C9), and the page's fetch carries no query string.
 *
 * Module-level on purpose: the hook relies on the spec's identity being stable.
 */

import { textFilter, type AdminFilterSpec } from '@/app/admin/components/layout/useAdminFilters';

import { isGroupFilter, type EnvironmentFilterState } from './environmentDisplay';

export const ENVIRONMENT_FILTER_SPEC: AdminFilterSpec<EnvironmentFilterState> = {
  group: textFilter({ key: 'group', defaultValue: '', isValid: isGroupFilter }),
  search: textFilter({ key: 'search', defaultValue: '', pageOnly: true }),
};
