'use client';

/**
 * The Exchange rates admin view (Admin Exchange Rates slice 1a; requirement
 * ADMIN_EXCHANGE_RATES_REQUIREMENT.md §5.1, SA-R3, SA-R4, SA-R11; slice 1c.1,
 * §5.5.3 to §5.5.5, SQ-12 to SQ-15).
 *
 * A manual, admin-only table of rates (units of each currency per 1 USD).
 * Nothing on the platform converts money with them (D-5). Reached by its URL
 * only (D-6); slice 2 renders this same view from a Finance tab, which is why
 * it lives outside `app/admin/finance/` (SA-R13).
 *
 * Every read and write goes through the admin route (no Supabase client, no
 * `CurrencyService`, no outside host — pinned by the Exchange rates guard in
 * `app/admin/__tests__/redundantPages.source.guard.test.ts`, which also counts
 * exactly three `fetch(` call sites in this folder):
 *   GET   /api/admin/exchange-rates                 rates, newest 10 changes, readAt
 *   GET   /api/admin/exchange-rates?currency=<CODE> that currency's newest 10 changes
 *   PATCH /api/admin/exchange-rates/<CODE>          one rate, or one on/off switch
 *
 * The KPIs and the overall history always come from the plain GET; the
 * one-currency read only feeds the history panel (SA-1c-2). That read is
 * re-run after a successful rate save and on Refresh, never after an on/off
 * switch (a switch writes no history row, SA Q-3). Every one-currency read
 * takes a number from `historyRequest`; selecting another currency, "Show all
 * currencies" and unmounting also take one, so a late answer for an earlier
 * request is dropped and can neither reopen a closed panel nor set state after
 * unmount (SA W-3).
 *
 * Layout standard: shared header, the KPI strip, a Refresh-only bar with
 * "Read at", shared loading / error / empty states, shared table constants and
 * chips, UTC dates. Responses are read through `readAdminResponse` (never an
 * own `.json(`); a network failure shows the shared sentence and the browser's
 * own message is never shown.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { AdminFilterBar } from '@/app/admin/components/layout/AdminFilterBar';
import { AdminPageHeader } from '@/app/admin/components/layout/AdminPageHeader';
import { AdminEmpty, AdminError, AdminLoading } from '@/app/admin/components/layout/AdminStates';
import { ADMIN_NETWORK_ERROR, readAdminResponse } from '@/app/admin/components/layout/readAdminResponse';
import type {
  ExchangeRateHistoryPayload,
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

/** The selected currency's own history read (SQ-12). */
interface CurrencyHistory {
  code: string;
  /** The last answer for this code; kept on screen while a re-read runs. */
  payload: ExchangeRateHistoryPayload | null;
  loading: boolean;
  error: string | null;
}

export function ExchangeRatesView() {
  const [payload, setPayload] = useState<ExchangeRatesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);
  const [currencyHistory, setCurrencyHistory] = useState<CurrencyHistory | null>(null);
  // The newest one-currency request; an answer carrying an older number is dropped (SA W-3).
  const historyRequest = useRef(0);
  // The open panel's code, for the Refresh / save re-reads.
  const openCode = currencyHistory?.code ?? null;
  // The same code, readable after an await (SA C-1): a save that finishes after
  // the admin closed the panel, or switched currency, must not reopen the old one.
  const openCodeRef = useRef<string | null>(null);
  useEffect(() => {
    openCodeRef.current = openCode;
  }, [openCode]);

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

  /** One currency's newest changes (SQ-12). Only the newest request may write state. */
  const loadCurrencyHistory = useCallback(async (code: string) => {
    const request = ++historyRequest.current;
    setCurrencyHistory((current) => ({
      code,
      payload: current?.code === code ? current.payload : null,
      loading: true,
      error: null,
    }));
    // Callers check the counter first: only the newest request may write state.
    const settle = (next: Partial<CurrencyHistory>) => {
      setCurrencyHistory((current) => (current && current.code === code ? { ...current, loading: false, ...next } : current));
    };

    let response: Response;
    try {
      response = await fetch(`/api/admin/exchange-rates?currency=${encodeURIComponent(code)}`, { cache: 'no-store' });
    } catch {
      if (request !== historyRequest.current) return;
      settle({ error: ADMIN_NETWORK_ERROR });
      return;
    }
    const result = await readAdminResponse<ExchangeRateHistoryPayload>(response, {
      what: `the ${code} rate changes`,
      sessionEndedCopy: true,
    });
    // The one gate for an answer: a newer selection, "Show all" or unmount retired this request (SA W-3).
    if (request !== historyRequest.current) return;
    if (!result.ok) {
      logger.warn({ currencyCode: code, status: result.status }, 'Exchange rate history read failed');
      settle({ error: result.message });
      return;
    }
    settle({ payload: result.data, error: null });
  }, []);

  /** Open one currency's history, or close the panel (null): both retire any request in flight. */
  const showHistory = useCallback(
    (code: string | null) => {
      if (code === null) {
        historyRequest.current += 1;
        setCurrencyHistory(null);
        return;
      }
      void loadCurrencyHistory(code);
    },
    [loadCurrencyHistory]
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Unmount retires any one-currency request still in flight (SA W-3).
  useEffect(
    () => () => {
      historyRequest.current += 1;
    },
    []
  );

  /** Refresh: the plain read, and the open panel's own read (SA Q-3). */
  const refresh = useCallback(() => {
    void load();
    if (openCode) void loadCurrencyHistory(openCode);
  }, [load, loadCurrencyHistory, openCode]);

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
      // A changed rate adds a history row (the trigger): read again so both history views show it (SA Q-3).
      if (message === null) {
        void load({ afterSave: true });
        // Read after the await: the panel as it is NOW, not when Save was clicked (SA C-1).
        const open = openCodeRef.current;
        if (open) void loadCurrencyHistory(open);
      }
      return message;
    },
    [patch, load, loadCurrencyHistory]
  );

  // An on/off switch writes no history row (SQ-14): nothing is re-read (SA Q-3).
  const setEnabled = useCallback(
    (currencyCode: string, isEnabled: boolean) => patch(currencyCode, { field: 'enabled', isEnabled }),
    [patch]
  );

  return (
    <div className="space-y-6">
      <AdminPageHeader title="Exchange rates" purpose={PURPOSE} />

      {/* K-10: hidden while the page shows an error. */}
      <ExchangeRatesKpis payload={error ? null : payload} loading={loading} />

      <AdminFilterBar what={WHAT} busy={loading} onRefresh={refresh} readAt={payload?.readAt ?? null} />

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
              onShowHistory={showHistory}
              historyFor={openCode}
            />
          )}
          {currencyHistory ? (
            <RateHistoryTable
              rows={currencyHistory.payload?.history ?? []}
              currencyCode={currencyHistory.code}
              loading={currencyHistory.loading && !currencyHistory.payload}
              busy={currencyHistory.loading}
              error={currencyHistory.error}
              onRetry={() => void loadCurrencyHistory(currencyHistory.code)}
              onShowAll={() => showHistory(null)}
            />
          ) : (
            <RateHistoryTable rows={payload.history} currencyCode={null} onShowAll={() => showHistory(null)} />
          )}
        </div>
      )}
    </div>
  );
}
