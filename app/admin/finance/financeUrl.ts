/**
 * The finance page's URL filters (finance & business health slice 1a, L-4,
 * SA-F11 condition 1): one pure parse / serialise pair.
 *
 * Only ids and enums ever reach the URL (`preset`, `from`, `to`, `accountId`),
 * never a business name. An invalid value falls back to the default (This
 * month, All businesses) with a small notice; it never crashes the page. The
 * server re-validates everything with its own strict schema, so the URL is
 * input, never authority.
 */

import {
  ADMIN_WINDOW_CHOICES,
  customRangeProblem,
  type AdminWindowChoice,
} from '@/app/admin/components/adminWindowPresets';

export interface FinanceQuery {
  preset: AdminWindowChoice;
  /** Set only for `custom`. */
  from: string | null;
  /** Set only for `custom`. */
  to: string | null;
  accountId: string | null;
}

export const DEFAULT_FINANCE_QUERY: FinanceQuery = { preset: 'this_month', from: null, to: null, accountId: null };

/** The only keys the page reads or writes. */
export const FINANCE_URL_KEYS = ['preset', 'from', 'to', 'accountId'] as const;

export const FINANCE_URL_NOTICE = 'The link had a filter this page could not use, so the default view is shown.';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Read the filters from the URL. Unknown keys are ignored; anything invalid gives the default plus a notice. */
export function parseFinanceUrl(params: URLSearchParams, now: Date): { query: FinanceQuery; notice: string | null } {
  const invalid = { query: DEFAULT_FINANCE_QUERY, notice: FINANCE_URL_NOTICE };

  for (const key of FINANCE_URL_KEYS) {
    if (params.getAll(key).length > 1) return invalid;
  }

  const rawPreset = params.get('preset');
  const rawFrom = params.get('from');
  const rawTo = params.get('to');
  const rawAccount = params.get('accountId');

  let preset: AdminWindowChoice = DEFAULT_FINANCE_QUERY.preset;
  if (rawPreset !== null) {
    if (!(ADMIN_WINDOW_CHOICES as readonly string[]).includes(rawPreset)) return invalid;
    preset = rawPreset as AdminWindowChoice;
  }

  let accountId: string | null = null;
  if (rawAccount !== null && rawAccount !== '') {
    if (!UUID_PATTERN.test(rawAccount)) return invalid;
    accountId = rawAccount.toLowerCase();
  }

  if (preset === 'custom') {
    if (rawFrom === null || rawTo === null || customRangeProblem(rawFrom, rawTo, now) !== null) return invalid;
    return { query: { preset, from: rawFrom, to: rawTo, accountId }, notice: null };
  }

  // A preset's dates are resolved by the server's clock: client dates are dropped.
  return { query: { preset, from: null, to: null, accountId }, notice: null };
}

/** Write the filters back: `preset` always, `from` / `to` only for custom, `accountId` only when set. */
export function serialiseFinanceUrl(query: FinanceQuery): string {
  const params = new URLSearchParams();
  params.set('preset', query.preset);
  if (query.preset === 'custom' && query.from !== null && query.to !== null) {
    params.set('from', query.from);
    params.set('to', query.to);
  }
  if (query.accountId !== null) params.set('accountId', query.accountId);
  return params.toString();
}
