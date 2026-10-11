/**
 * Audit trail's filter spec and its request-param builder (Admin Layout
 * Standard L-1c, §4 of the L-1c workplan). Pure: no React, no fetch.
 *
 * The URL uses the standard names (`range`, `from`, `to`, `account`, `action`,
 * `severity`, `entity_type`); the old names (`date_from`, `date_to`,
 * `user_id`) are read forever and rewritten (U-9), so every existing inbound
 * link (Health tiles, the Businesses panel, the AI activity cutover notice)
 * opens the same view. `search` is page-only: read from a link, never written
 * (SA-R-8, D-6 (a)).
 *
 * The validators mirror the route's own schema (`lib/audit/requestSchemas.ts`,
 * whose identifier pattern is not exported): a value the route would refuse
 * with a 400 is ignored on arrival instead (U-4).
 *
 * The route itself is unchanged and still receives its own names, in the
 * page's historical order.
 */

import { textFilter, type AdminFilterSpec } from '@/app/admin/components/layout/useAdminFilters';
import { resolveWindow, windowFilter, type AdminWindowValue } from '@/app/admin/components/layout/adminWindow';

export interface AuditFilters {
  /** Default: no window (every date). */
  window: AdminWindowValue;
  /** One account's rows only. '' = every account. */
  account: string;
  action: string;
  severity: string;
  entityType: string;
  /** Free text; page-only. */
  search: string;
}

const IDENTIFIER = /^[A-Za-z0-9_]{1,64}$/;
const SEVERITIES: ReadonlySet<string> = new Set(['info', 'warning', 'critical']);
/** The shape the original account picker accepts as a pasted id. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The route's cap on `search`. */
const SEARCH_MAX = 200;

const isIdentifier = (raw: string) => IDENTIFIER.test(raw);
const isSeverity = (raw: string) => SEVERITIES.has(raw);
const isUuid = (raw: string) => UUID.test(raw);
const isSearch = (raw: string) => raw.length <= SEARCH_MAX;

export const AUDIT_DEFAULT_WINDOW: AdminWindowValue = { kind: 'none' };

export const AUDIT_FILTER_SPEC: AdminFilterSpec<AuditFilters> = {
  window: windowFilter({ defaultValue: AUDIT_DEFAULT_WINDOW, aliases: { date_from: 'from', date_to: 'to' } }),
  account: textFilter({ key: 'account', defaultValue: '', aliases: ['user_id'], isValid: isUuid }),
  action: textFilter({ key: 'action', defaultValue: 'all', isValid: isIdentifier }),
  severity: textFilter({ key: 'severity', defaultValue: 'all', isValid: isSeverity }),
  entityType: textFilter({ key: 'entity_type', defaultValue: 'all', isValid: isIdentifier }),
  search: textFilter({ key: 'search', defaultValue: '', pageOnly: true, isValid: isSearch }),
};

/**
 * The route's query, in the page's historical param order: action, severity,
 * entity_type, date_from, date_to, search, user_id, page, page_size.
 *
 * Whole dates go out as explicit UTC instants: the route hands the value
 * straight to `.gte` / `.lte('created_at', …)`, so a bare date as `date_to`
 * would stop at that day's midnight and drop the whole To day, and `Z` pins
 * UTC whatever the database timezone. The end of day carries microseconds
 * (SA S-1): `created_at` has microsecond precision. Linked bounds are sent
 * verbatim, as they always were.
 */
export function auditRequestParams(filters: AuditFilters, page: number, pageSize: number, now: Date): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.action !== 'all') params.append('action', filters.action);
  if (filters.severity !== 'all') params.append('severity', filters.severity);
  if (filters.entityType !== 'all') params.append('entity_type', filters.entityType);

  const resolved = resolveWindow(filters.window, now);
  if (resolved.kind === 'dates') {
    if (resolved.from !== null) params.append('date_from', `${resolved.from}T00:00:00.000Z`);
    if (resolved.to !== null) params.append('date_to', `${resolved.to}T23:59:59.999999Z`);
  } else if (resolved.kind === 'linked') {
    if (resolved.from !== null) params.append('date_from', resolved.from);
    if (resolved.to !== null) params.append('date_to', resolved.to);
  }

  if (isSearchActive(filters)) params.append('search', filters.search);
  if (filters.account) params.append('user_id', filters.account);
  params.append('page', page.toString());
  params.append('page_size', pageSize.toString());
  return params;
}

/**
 * The single definition of "a search is active", used both to decide whether
 * to send `search` and whether the totals may be shown, so the request and the
 * count line can never disagree.
 */
export function isSearchActive(filters: AuditFilters): boolean {
  return filters.search.trim().length > 0;
}
