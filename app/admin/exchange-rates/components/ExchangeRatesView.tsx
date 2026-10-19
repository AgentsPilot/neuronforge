'use client';

/**
 * The Exchange rates admin view (Admin Exchange Rates slice 1a; requirement
 * ADMIN_EXCHANGE_RATES_REQUIREMENT.md §5.1, SA-R3, SA-R4, SA-R11, SQ-7).
 *
 * A manual, admin-only table of rates (units of each currency per 1 USD).
 * Nothing on the platform converts money with them (D-5). Reached by its URL
 * only (D-6); slice 2 renders this same view from a Finance tab, which is why
 * it lives outside `app/admin/finance/` (SA-R13).
 *
 * Every read and write goes through the admin route (no Supabase client, no
 * `CurrencyService`, no outside host — pinned by the Exchange rates guard in
 * `app/admin/__tests__/redundantPages.source.guard.test.ts`):
 *   GET   /api/admin/exchange-rates                 rates, newest 50 changes, readAt
 *   PATCH /api/admin/exchange-rates/<CODE>          one rate, or one on/off switch
 *
 * Layout standard: shared header, the one-tile KPI strip, a Refresh-only bar
 * with "Read at", shared loading / error / empty states, shared table
 * constants and chips, UTC dates. Responses are read through
 * `readAdminResponse` (never an own `.json(`); a network failure shows the
 * shared sentence and the browser's own message is never shown.
 */

import { useCallback, useEffect, useState } from 'react';

import { AdminFilterBar } from '@/app/admin/components/layout/AdminFilterBar';
import { AdminPageHeader } from '@/app/admin/components/layout/AdminPageHeader';
import { AdminEmpty, AdminError, AdminLoading } from '@/app/admin/components/layout/AdminStates';
import { ADMIN_NETWORK_ERROR, readAdminResponse } from '@/app/admin/components/layout/readAdminResponse';
import type {
  ExchangeRatePatchResult,
  ExchangeRatePatchBody,
  ExchangeRatesPayload,
} from '@/lib/admin/exchangeRates/exchangeRateRules';
import { clientLogger } from '@/lib/logger/client';

import { ExchangeRatesKpis } from './ExchangeRatesKpis';
import { ExchangeRatesTable } from './ExchangeRatesTable';
import { RateHistoryTable } from './RateHistoryTable';

const logger = clientLogger.child({ module: 'AdminExchangeRates' });

/** Noun phrase for the loading line, the fallback error and the Refresh name. */
const WHAT = 'the exchange rates';

/** Shown when a rate was saved but the re-read that refreshes the history failed (review item 4). */
export const REFRESH_AFTER_SAVE_FAILED = 'Saved; could not refresh history';

const PURPOSE =
  'Rates an admin keeps by hand, in units of each currency per 1 USD. Nothing on the platform converts money with them.';

export function ExchangeRatesView() {
  const [payload, setPayload] = useState<ExchangeRatesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);

  /**
   * One read. After a save (`afterSave`), a failed re-read keeps the data on
   * screen (the saved row is already in it) and shows a short notice instead
   * of a page-level error: the save itself succeeded.
   */
  const load = useCallback(async (options: { afterSave?: boolean } = {}) => {
    setLoading(true);
    if (!options.afterSave) setError(null);
    setRefreshNotice(null);
    const failed = (message: string) => {
      if (options.afterSave) setRefreshNotice(REFRESH_AFTER_SAVE_FAILED);
      else setError(message);
    };
    try {
      let response: Response;
      try {
        response = await fetch('/api/admin/exchange-rates', { cache: 'no-store' });
      } catch {
        failed(ADMIN_NETWORK_ERROR);
        return;
      }
      const result = await readAdminResponse<ExchangeRatesPayload>(response, { what: WHAT, sessionEndedCopy: true });
      if (!result.ok) {
        logger.warn({ status: result.status, afterSave: Boolean(options.afterSave) }, 'Exchange rates read failed');
        failed(result.message);
        return;
      }
      setPayload(result.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** One PATCH; resolves to an error message for the row, or null after the row was replaced. */
  const patch = useCallback(
    async (currencyCode: string, body: ExchangeRatePatchBody): Promise<string | null> => {
      let response: Response;
      try {
        response = await fetch(`/api/admin/exchange-rates/${encodeURIComponent(currencyCode)}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch {
        return ADMIN_NETWORK_ERROR;
      }
      const result = await readAdminResponse<ExchangeRatePatchResult>(response, {
        what: `the change to ${currencyCode}`,
        sessionEndedCopy: true,
      });
      if (!result.ok) {
        logger.warn({ currencyCode, field: body.field, status: result.status }, 'Exchange rate change refused');
        return result.message;
      }
      const saved = result.data.rate;
      setPayload((current) =>
        current
          ? { ...current, rates: current.rates.map((rate) => (rate.currencyCode === saved.currencyCode ? saved : rate)) }
          : current
      );
      logger.info({ currencyCode, field: body.field, unchanged: result.data.unchanged }, 'Exchange rate changed');
      return null;
    },
    []
  );

  const saveRate = useCallback(
    async (currencyCode: string, rate: string) => {
      const message = await patch(currencyCode, { field: 'rate', rate });
      // A changed rate adds a history row (the trigger): read again so the panel shows it.
      if (message === null) void load({ afterSave: true });
      return message;
    },
    [patch, load]
  );

  const setEnabled = useCallback(
    (currencyCode: string, isEnabled: boolean) => patch(currencyCode, { field: 'enabled', isEnabled }),
    [patch]
  );

  return (
    <div className="space-y-6">
      <AdminPageHeader title="Exchange rates" purpose={PURPOSE} />

      {/* K-10: hidden while the page shows an error. */}
      <ExchangeRatesKpis payload={error ? null : payload} loading={loading} />

      <AdminFilterBar what={WHAT} busy={loading} onRefresh={() => void load()} readAt={payload?.readAt ?? null} />

      {error && <AdminError message={error} testId="page-error" onRetry={() => void load()} />}

      {refreshNotice && (
        <p role="status" data-testid="refresh-after-save-notice" className="text-sm text-amber-300">
          {refreshNotice}
        </p>
      )}

      {!payload && loading && <AdminLoading what={WHAT} />}

      {payload && (
        <div data-testid="exchange-rates-content" aria-busy={loading} className="space-y-8">
          {payload.rates.length === 0 ? (
            <AdminEmpty testId="rates-empty" message="No currencies are recorded." />
          ) : (
            <ExchangeRatesTable
              rates={payload.rates}
              readAt={payload.readAt}
              onSaveRate={saveRate}
              onSetEnabled={setEnabled}
              onShowHistory={setHistoryFor}
              historyFor={historyFor}
            />
          )}
          <RateHistoryTable history={payload.history} currencyCode={historyFor} onShowAll={() => setHistoryFor(null)} />
        </div>
      )}
    </div>
  );
}
