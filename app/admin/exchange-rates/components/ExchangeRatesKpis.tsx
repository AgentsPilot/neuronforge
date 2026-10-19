'use client';

/**
 * The Exchange rates KPI strip (Admin Exchange Rates slice 1a, SQ-7): one tile,
 * "Stale rates" = enabled currencies whose rate was not updated in 35 days,
 * measured against the server's read time. A row counts as enabled only when
 * `isEnabled` is true (a null in the database already reads as false, SA §10
 * ruling 1). The base currency is left out of both figures: its rate is fixed
 * and can never be updated, so counting it would keep the tile above zero
 * forever (review finding B-1). Amber when above zero. No link target, no
 * fetch here.
 */

import { KpiStrip, KpiTile } from '@/app/admin/components/layout/KpiStrip';
import { formatCount } from '@/app/admin/components/layout/adminFormat';
import {
  BASE_CURRENCY,
  STALE_DESCRIPTION,
  isRateStale,
  type ExchangeRatesPayload,
} from '@/lib/admin/exchangeRates/exchangeRateRules';

export interface ExchangeRatesKpisProps {
  /** Null before the first read, and while the page shows an error (K-10). */
  payload: ExchangeRatesPayload | null;
  /** A read is in flight. */
  loading: boolean;
}

export function ExchangeRatesKpis({ payload, loading }: ExchangeRatesKpisProps) {
  if (!payload) return loading ? <KpiStrip loading placeholderCount={1} /> : null;

  const enabled = payload.rates.filter((rate) => rate.isEnabled === true && rate.currencyCode !== BASE_CURRENCY);
  const stale = enabled.filter((rate) => isRateStale(rate, payload.readAt)).length;

  return (
    <KpiStrip>
      <KpiTile
        testId="kpi-stale-rates"
        label="Stale rates"
        value={formatCount(stale)}
        sub={`of ${formatCount(enabled.length)} enabled, ${STALE_DESCRIPTION}`}
        status={stale > 0 ? 'amber' : null}
      />
    </KpiStrip>
  );
}
