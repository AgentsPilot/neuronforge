/**
 * The History block's request (finance slice 8.3, §11M.8 HS-FR-9, SA-W-8.3-7).
 * Pure: no `'use client'`, no React, no runtime import.
 *
 * The page's window only, in the history route's keys: `preset`, and `from` /
 * `to` for custom. Never a business: history is all businesses together, and
 * the route refuses one (400). The page's own serialiser (`financeUrl.ts`) is
 * frozen by AC-173 part C and is not touched; this is a separate function.
 */

import type { FinanceQuery } from './financeUrl';

export const FINANCE_HISTORY_API_PATH = '/api/admin/business-os/finance/history';

export function serialiseHistoryQuery(query: Pick<FinanceQuery, 'preset' | 'from' | 'to'>): string {
  const params = new URLSearchParams();
  params.set('preset', query.preset);
  if (query.preset === 'custom' && query.from !== null && query.to !== null) {
    params.set('from', query.from);
    params.set('to', query.to);
  }
  return params.toString();
}
