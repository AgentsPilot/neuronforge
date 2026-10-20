'use client';

/**
 * The Exchange rates admin view (Admin Exchange Rates slice 1a; requirement
 * ADMIN_EXCHANGE_RATES_REQUIREMENT.md §5.1, SA-R3, SA-R4, SA-R11; slice 1c.1,
 * §5.5.3 to §5.5.5, SQ-12 to SQ-15).
 *
 * A manual, admin-only table of rates (units of each currency per 1 USD).
 * Nothing on the platform converts money with them (D-5). Rendered only by
 * Finance's Exchange rates tab (slice 2); the old URL `/admin/exchange-rates`
 * redirects there since slice 2b. It lives outside `app/admin/finance/` (SA-R13).
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
 * Layout standard: no header of its own (slice 2a, SQ-21: the page that owns
 * the one h1 renders it, with `EXCHANGE_RATES_PURPOSE`), the KPI strip, the shared filter bar with
 * "Read at", shared loading / error / empty states, shared table constants and
 * chips, UTC dates. Responses are read through `readAdminResponse` (never an
 * own `.json(`); a network failure shows the shared sentence and the browser's
 * own message is never shown.
 *
 * Slice 1c.2 (§5.5.1, FR-14 to FR-16, SQ-8, SQ-9, SA-1c-5): the bar holds Show
 * (Enabled only by default, Disabled only, All; in the URL as `currencies`,
 * see `exchangeRatesFilters.ts`) and a code-or-name Search held by this view
 * only, never written to the URL. The filter narrows the rates table only: the
 * KPIs and the history list keep the whole plain-GET payload (SA-1c-2). A
 * filter change reads nothing. A currency switched on or off here stays
 * visible ("held") until Refresh, the next successful read, or any filter or
 * search change, so its row and the keyboard focus do not vanish (SQ-9).
 * `active` would be false only while a page keeps this view mounted but hidden
 * (L-9a). Finance unmounts hidden panels, so no caller passes false today.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';

import {
  ADMIN_FIELD_CONTROL,
  ADMIN_FIELD_LABEL,
  AdminFilterBar,
} from '@/app/admin/components/layout/AdminFilterBar';
import { AdminEmpty, AdminError, AdminLoading } from '@/app/admin/components/layout/AdminStates';
import { ADMIN_NETWORK_ERROR, readAdminResponse } from '@/app/admin/components/layout/readAdminResponse';
import { useAdminFilters } from '@/app/admin/components/layout/useAdminFilters';
import type {
  ExchangeRateHistoryPayload,
  ExchangeRatePatchResult,
  ExchangeRatePatchBody,
  ExchangeRatesPayload,
} from '@/lib/admin/exchangeRates/exchangeRateRules';
import { clientLogger } from '@/lib/logger/client';

// Relative on purpose: the alias path would spell the page route, which the
// G-4 guard (redundantPages.source.guard) refuses anywhere in product code.
import {
  CURRENCY_SHOW_OPTIONS,
  EXCHANGE_RATES_FILTER_SPEC,
  NO_MATCHING_CURRENCIES,
  currencyCountLine,
  toCurrencyShow,
  visibleRates,
  type ExchangeRatesFilters,
} from '../exchangeRatesFilters';
import { ExchangeRatesKpis } from './ExchangeRatesKpis';
import { ExchangeRatesTable } from './ExchangeRatesTable';
import { RateHistoryTable } from './RateHistoryTable';

const logger = clientLogger.child({ module: 'AdminExchangeRates' });

/** Noun phrase for the loading line, the fallback error and the Refresh name. */
const WHAT = 'the exchange rates';

/** Shown when a rate was saved but the re-read that refreshes the history failed (review item 4). */
export const REFRESH_AFTER_SAVE_FAILED = 'Saved; could not refresh history';

/**
 * The page header's sentence (slice 2a, SQ-21), rendered by whoever owns the
 * h1: the Finance tab (the standalone page was deleted in slice 2b).
 */
export const EXCHANGE_RATES_PURPOSE =
  'Rates an admin keeps by hand, in units of each currency per 1 USD. Nothing on the platform converts money with them.';

/** The selected currency's own history read (SQ-12). */
interface CurrencyHistory {
  code: string;
  /** The last answer for this code; kept on screen while a re-read runs. */
  payload: ExchangeRateHistoryPayload | null;
  loading: boolean;
  error: string | null;
}

/**
 * The codes switched in this view, and the view they were switched under
 * (SQ-9). They count only while `filters` is the same object and the search
 * has not been edited since: the hook gives a new `filters` object on every
 * value change (outside changes included), so any Show or Search change, even
 * a change and back, retires the set in that same render, with no effect.
 */
interface HeldRows {
  filters: ExchangeRatesFilters | null;
  searchVersion: number;
  codes: ReadonlySet<string>;
}

const NO_CODES: ReadonlySet<string> = new Set<string>();
const NO_HELD: HeldRows = { filters: null, searchVersion: -1, codes: NO_CODES };

/** Search input cap: currency codes and names are short. */
const SEARCH_MAX_LENGTH = 64;

export interface ExchangeRatesViewProps {
  /** L-9a: false while a Finance tab hides this view (slice 2). Default true. */
  active?: boolean;
}

export function ExchangeRatesView({ active = true }: ExchangeRatesViewProps = {}) {
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

  // Slice 1c.2: Show in the URL (SQ-8); Search held here only, never in the URL.
  const { filters, setFilters, clear, isDefault } = useAdminFilters(EXCHANGE_RATES_FILTER_SPEC, { active });
  const show = toCurrencyShow(filters.currencies);
  const [searchTerm, setSearchTerm] = useState('');
  // Bumped by every search edit and by Clear: part of the held set's view (SQ-9).
  const [searchVersion, setSearchVersion] = useState(0);
  const [held, setHeld] = useState<HeldRows>(NO_HELD);
  // `patch` has empty deps, so it cannot read `filters` / `searchVersion` from
  // its closure (they would be the first render's). These refs give it the
  // view as it is when the PATCH settles (SA Q-3, C-1).
  const filtersRef = useRef<ExchangeRatesFilters>(filters);
  const searchVersionRef = useRef(searchVersion);
  useEffect(() => {
    filtersRef.current = filters;
    searchVersionRef.current = searchVersion;
  }, [filters, searchVersion]);
  const showId = useId();
  const searchId = useId();

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
      // Every successful plain read releases the held rows (SQ-9).
      setHeld(NO_HELD);
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
    // Before the read, so a failed Refresh still releases the held rows (SQ-9).
    setHeld(NO_HELD);
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
      // SQ-9 / SA C-1: an on/off switch holds its row, in the SAME synchronous
      // step that replaces it, so the row never renders once as "switched, not
      // held" (it would unmount under the filter and lose focus). A rate save
      // is never held.
      if (body.field === 'enabled') {
        const view = { filters: filtersRef.current, searchVersion: searchVersionRef.current };
        setHeld((current) =>
          current.filters === view.filters && current.searchVersion === view.searchVersion
            ? { ...current, codes: new Set(current.codes).add(saved.currencyCode) }
            : { ...view, codes: new Set([saved.currencyCode]) }
        );
      }
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

  const changeSearch = (value: string) => {
    setSearchTerm(value);
    setSearchVersion((n) => n + 1);
  };

  /** §5.5 part 5: back to the defaults (Enabled only, empty search). Reads nothing. */
  const clearAll = () => {
    clear();
    setSearchTerm('');
    setSearchVersion((n) => n + 1);
  };

  // One expression for the bar's Clear and the empty state's Clear (SA minor item).
  const canClear = !isDefault || searchTerm !== '';
  // The held set counts only under the view it was taken in (SQ-9, SA Q-3).
  const heldNow = held.filters === filters && held.searchVersion === searchVersion ? held.codes : NO_CODES;
  const rows = payload ? visibleRates(payload.rates, show, searchTerm, heldNow) : [];

  return (
    <div className="space-y-6">
      {/* K-10: hidden while the page shows an error. */}
      <ExchangeRatesKpis payload={error ? null : payload} loading={loading} />

      {/* Controls from the first render (SA Q-1): Show is URL state, meaningful before any data. */}
      <AdminFilterBar
        what={WHAT}
        busy={loading}
        onRefresh={refresh}
        readAt={payload?.readAt ?? null}
        onClear={clearAll}
        canClear={canClear}
      >
        <div>
          <label htmlFor={showId} className={ADMIN_FIELD_LABEL}>
            Show
          </label>
          <select
            id={showId}
            data-testid="currencies-show"
            value={show}
            onChange={(event) => setFilters({ currencies: toCurrencyShow(event.target.value) })}
            className={ADMIN_FIELD_CONTROL}
          >
            {CURRENCY_SHOW_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={searchId} className={ADMIN_FIELD_LABEL}>
            Search
          </label>
          <input
            id={searchId}
            type="search"
            data-testid="currencies-search"
            value={searchTerm}
            onChange={(event) => changeSearch(event.target.value)}
            placeholder="Code or name"
            maxLength={SEARCH_MAX_LENGTH}
            autoComplete="off"
            className={`${ADMIN_FIELD_CONTROL} w-48`}
          />
        </div>
      </AdminFilterBar>

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
            <div className="space-y-2">
              {/* Plain text, not a live region: it would be announced on every keystroke (SA Q-2). */}
              <p data-testid="rates-count" className="text-xs text-slate-400">
                {currencyCountLine(rows.length, payload.rates.length)}
              </p>
              {rows.length === 0 ? (
                <AdminEmpty
                  testId="rates-filtered-empty"
                  message={NO_MATCHING_CURRENCIES}
                  onClear={canClear ? clearAll : undefined}
                />
              ) : (
                <ExchangeRatesTable
                  rates={rows}
                  readAt={payload.readAt}
                  onSaveRate={saveRate}
                  onSetEnabled={setEnabled}
                  onShowHistory={showHistory}
                  historyFor={openCode}
                />
              )}
            </div>
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
