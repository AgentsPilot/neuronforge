/**
 * "Changed by" as the Exchange rates page shows it (Admin Exchange Rates slice
 * 1c.1, FR-19, SQ-13 with SA Q-1). The server decides the label
 * (`labelHistory`); this is only the page's safety net: the label when there
 * is one; "Unknown user" when there is no editor id at all; otherwise the
 * editor's short id, which is what a failed name lookup leaves (never
 * "Unknown user": "we could not look it up" is not "there is nobody").
 *
 * Used by the history table, the Last rate change tile and (slice 1f, SA
 * §13.9 SQ-56) the Rates last checked tile's "by {who}", so the three cannot
 * disagree. Pure; no fetch.
 */

import { formatShortId } from '@/app/admin/components/layout/adminTable';
import { UNKNOWN_USER_LABEL, type ExchangeRateHistoryWire } from '@/lib/admin/exchangeRates/exchangeRateRules';

export function changedByText(row: Pick<ExchangeRateHistoryWire, 'changedBy' | 'changedByLabel'>): string {
  if (row.changedByLabel) return row.changedByLabel;
  return row.changedBy ? formatShortId(row.changedBy) : UNKNOWN_USER_LABEL;
}
