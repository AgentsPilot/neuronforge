'use client';

/**
 * The Exchange rates KPI strip (Admin Exchange Rates slice 1c.1, FR-20 to
 * FR-22, SA-1c-2 / SA-1c-3; replaces slice 1a's one "Stale rates" tile, SQ-7,
 * per the user's page review D-7). Two tiles, in this order:
 *
 *   Enabled currencies  "N of X": N = rows whose `isEnabled` is true (a null in
 *                       the database already reads as false, SA §10 ruling 1),
 *                       X = every row. USD is counted: it is a real, enabled
 *                       currency. No status colour.
 *   Last rate change    The newest history row: "ILS 3.65 → 3.70" (or "ILS set
 *                       to 3.70" when there is no old rate), by whom and when
 *                       (UTC). The two rates are the stored strings side by
 *                       side: no arithmetic, no percentage (D-5). On / off
 *                       switches are not rate changes and never show here
 *                       (SQ-14). "No changes yet" when there is no history.
 *
 * Both tiles count the WHOLE plain-GET payload, never a filtered view and
 * never the one-currency history read (SA-1c-2). There is no Stale tile; each
 * row still carries its Stale chip (FR-8). No link target, no fetch here.
 */

import { KpiStrip, KpiTile } from '@/app/admin/components/layout/KpiStrip';
import { formatCount, formatUtc } from '@/app/admin/components/layout/adminFormat';
import type { ExchangeRateHistoryWire, ExchangeRatesPayload } from '@/lib/admin/exchangeRates/exchangeRateRules';

import { changedByText } from './changedByText';

export interface ExchangeRatesKpisProps {
  /** Null before the first read, and while the page shows an error (K-10). */
  payload: ExchangeRatesPayload | null;
  /** A read is in flight. */
  loading: boolean;
}

/** "ILS 3.65 → 3.70", or "ILS set to 3.70": the stored strings, as stored. */
function rateChangeText(row: ExchangeRateHistoryWire): string {
  return row.oldRate === null
    ? `${row.currencyCode} set to ${row.newRate}`
    : `${row.currencyCode} ${row.oldRate} → ${row.newRate}`;
}

export function ExchangeRatesKpis({ payload, loading }: ExchangeRatesKpisProps) {
  if (!payload) return loading ? <KpiStrip loading placeholderCount={2} /> : null;

  const enabled = payload.rates.filter((rate) => rate.isEnabled === true).length;
  const last = payload.history[0] ?? null;

  return (
    <KpiStrip>
      <KpiTile
        testId="kpi-enabled-currencies"
        label="Enabled currencies"
        value={`${formatCount(enabled)} of ${formatCount(payload.rates.length)}`}
      />
      <KpiTile
        testId="kpi-last-rate-change"
        label="Last rate change"
        value={last ? rateChangeText(last) : 'No changes yet'}
        sub={last ? `by ${changedByText(last)}, ${formatUtc(last.changedAt)}` : null}
      />
    </KpiStrip>
  );
}
