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
 * exactly four `fetch(` call sites in this folder):
 *   GET   /api/admin/exchange-rates?from=&to=                 rates, the newest 10
 *                                                             changes in the window,
 *                                                             the all-time lastChange,
 *                                                             readAt, lastSync, viewer
 *   GET   /api/admin/exchange-rates?currency=<CODE>&from=&to= that currency's newest
 *                                                             10 changes in the window
 *   PATCH /api/admin/exchange-rates/<CODE>                    one rate, or one on/off switch
 *                                                             (also Accept suggestion)
 *   POST  /api/admin/exchange-rates/sync                      the ECB suggestions (slice 1e)
 *
 * Slice 1e (§5.7, SA §13.7 SA-1e-1 / SA-1e-2, §13.8 SQ-49 / SQ-51): this view
 * owns the sync. An action row between the filter bar and the content holds
 * "Sync rates" (disabled while a sync runs and while there is no successful
 * plain read), the always-visible source line (a new-tab link to the ECB's
 * human page through `ECB_SOURCE_PAGE_URL`: navigation only, never fetched),
 * the outcome sentence and, after a successful sync, the status line. The
 * columns follow the visit's last SUCCESSFUL sync; a failed sync shows its
 * sentence and leaves the columns and the tile as they were. Each sync takes a
 * number from `syncRequest`, so an answer after unmount (or after a newer
 * sync) writes nothing. Accept goes through the same `patch` as a manual save,
 * with `expectedRate` (the sync's base) and `origin`, then runs the save's
 * re-reads; success adds the code to the accepted set, which the next
 * successful sync clears. The "Rates last checked" tile shows the visit's own
 * sync ahead of the GET's `lastSync`, so a later re-read cannot move it back.
 *
 * Slice 1f (D-11, SA §13.9 SQ-55 (a')): the tile also names who ran the
 * check. After a reload the server labels the sync's actor; right after this
 * visit's own sync the name is the plain GET's `viewer` (the signed-in admin
 * of the page, who is the admin who posted to `/sync`), kept in `viewerRef`
 * from the newest successful plain read. No new request, so still four
 * `fetch(` call sites.
 *
 * The KPIs and the overall history always come from the plain GET; the
 * one-currency read only feeds the history panel (SA-1c-2). That read is
 * re-run after a successful rate save and on Refresh, never after an on/off
 * switch (a switch writes no history row, SA Q-3). Every one-currency read
 * takes a number from `historyRequest`; selecting another currency, "Show all
 * currencies" and unmounting also take one, so a late answer for an earlier
 * request is dropped and can neither reopen a closed panel nor set state after
 * unmount (SA W-3). Every plain read takes a number from `loadRequest` the
 * same way (slice 1d, SA-1d-1): only the newest may write state.
 *
 * Slice 1d (D-8, §5.6, SQ-25 to SQ-34): the Window control above the history
 * table (rendered by `RateHistoryTable`, SA-1d-5) is page state only, never
 * the URL (Finance owns `range` / `from` / `to` on the tab, SQ-25), default
 * This month. Both GETs carry `from` / `to`, resolved from the applied window
 * with the clock of each read (SQ-27), so Refresh and the save re-reads carry
 * it too. A window change runs Refresh's reads (SQ-34): the plain read, plus
 * the open panel's read; choosing the window already applied reads nothing
 * (SA-1d-6). Each answer records the window it was read under, and captions
 * use that, never the control's current value (SA-1d-2). The "Last rate
 * change" tile reads the all-time `lastChange`, so no window moves it.
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
import { ExternalLink } from 'lucide-react';

import {
  ADMIN_FIELD_CONTROL,
  ADMIN_FIELD_LABEL,
  AdminFilterBar,
} from '@/app/admin/components/layout/AdminFilterBar';
import { AdminEmpty, AdminError, AdminLoading } from '@/app/admin/components/layout/AdminStates';
import { ADMIN_NETWORK_ERROR, readAdminResponse } from '@/app/admin/components/layout/readAdminResponse';
import { useAdminFilters } from '@/app/admin/components/layout/useAdminFilters';
import { windowEquals, type AdminWindowValue } from '@/app/admin/components/layout/adminWindow';
import { ADMIN_BUTTON } from '@/app/admin/components/layout/adminTable';
import type {
  ExchangeRateHistoryPayload,
  ExchangeRatePatchResult,
  ExchangeRatePatchBody,
} from '@/lib/admin/exchangeRates/exchangeRateRules';
import {
  ECB_SOURCE_LABEL,
  ECB_SOURCE_NOTE,
  ECB_SOURCE_PAGE_URL,
  lastSyncFromSync,
  syncOutcomeText,
  type ExchangeRateSyncPayload,
  type ExchangeRatesReadPayload,
  type LastRateSyncWire,
  type RateViewerWire,
} from '@/lib/admin/exchangeRates/rateSyncRules';
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
import { HISTORY_DEFAULT_WINDOW, historyWindowParams } from '../historyWindow';
import { ExchangeRatesKpis } from './ExchangeRatesKpis';
import { ExchangeRatesTable, syncSourceLine, type RateSyncView } from './ExchangeRatesTable';
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
  /** The window `payload` was read under (SA-1d-2): its caption's period. */
  window: AdminWindowValue;
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

/** Noun phrase for the sync's fallback error. */
const SYNC_WHAT = 'the public exchange rates';

/** Shown when Accept is pressed for a row that no longer has a suggestion (a guard, not a normal path). */
const NO_SUGGESTION = 'There is no suggestion to accept. Sync again.';

/**
 * An answer from before slice 1e carries no `lastSync`: the tile then says it
 * could not check, never "No sync on record" (an unknown is not a "no").
 */
const LAST_SYNC_UNKNOWN: LastRateSyncWire = { status: 'unavailable' };

/** Search input cap: currency codes and names are short. */
const SEARCH_MAX_LENGTH = 64;

export interface ExchangeRatesViewProps {
  /** L-9a: false while a Finance tab hides this view (slice 2). Default true. */
  active?: boolean;
}

export function ExchangeRatesView({ active = true }: ExchangeRatesViewProps = {}) {
  const [payload, setPayload] = useState<ExchangeRatesReadPayload | null>(null);
  // The window `payload.history` was read under (SA-1d-2): its caption's period.
  const [payloadWindow, setPayloadWindow] = useState<AdminWindowValue>(HISTORY_DEFAULT_WINDOW);
  // The applied history window (slice 1d, SQ-25): page state only. The ref is
  // the same value for the reads, which run after awaits and from callbacks
  // with empty deps; both are set only in `changeHistoryWindow`.
  const [historyWindow, setHistoryWindow] = useState<AdminWindowValue>(HISTORY_DEFAULT_WINDOW);
  const historyWindowRef = useRef<AdminWindowValue>(HISTORY_DEFAULT_WINDOW);
  // The newest plain read; an answer carrying an older number is dropped (SA-1d-1).
  const loadRequest = useRef(0);
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

  // Slice 1e (SA-1e-2): the sync lives here, the folder's only fetch owner.
  const [syncing, setSyncing] = useState(false);
  // The visit's last SUCCESSFUL sync and the codes accepted since it (SA-1e-1).
  const [syncView, setSyncView] = useState<RateSyncView | null>(null);
  // `acceptSuggestion` has empty-ish deps: it reads the sync as it is when Accept is pressed.
  const syncViewRef = useRef<RateSyncView | null>(null);
  useEffect(() => {
    syncViewRef.current = syncView;
  }, [syncView]);
  // A failed sync's sentence, or the server's refusal (a live region by the button).
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  // The tile's value from this visit's own successful sync (SQ-51 (5)); ahead of the GET's.
  const [visitLastSync, setVisitLastSync] = useState<LastRateSyncWire | null>(null);
  // The newest sync; an answer carrying an older number (or after unmount) is dropped.
  const syncRequest = useRef(0);
  // Slice 1f (SQ-55 (a')): the signed-in admin from the newest successful plain read; names this visit's own sync.
  const viewerRef = useRef<RateViewerWire | null>(null);

  /**
   * One read. After a save (`afterSave`), a failed re-read keeps the data on
   * screen (the saved row is already in it) and shows a short notice instead
   * of a page-level error: the save itself succeeded.
   */
  const load = useCallback(async (options: { afterSave?: boolean } = {}) => {
    // SA-1d-1: only the newest plain read may write state; a newer read or
    // unmount retires this one.
    const request = ++loadRequest.current;
    const isCurrent = () => request === loadRequest.current;
    // The window as applied NOW, resolved with the clock of this read (SQ-27).
    const readWindow = historyWindowRef.current;
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
        response = await fetch(`/api/admin/exchange-rates?${historyWindowParams(readWindow, new Date())}`, {
          cache: 'no-store',
        });
      } catch {
        if (isCurrent()) failed(ADMIN_NETWORK_ERROR);
        return;
      }
      const result = await readAdminResponse<ExchangeRatesReadPayload>(response, { what: WHAT, sessionEndedCopy: true });
      if (!isCurrent()) return;
      if (!result.ok) {
        logger.warn({ status: result.status, afterSave: Boolean(options.afterSave) }, 'Exchange rates read failed');
        failed(result.message);
        return;
      }
      // Every successful plain read releases the held rows (SQ-9).
      setHeld(NO_HELD);
      setPayload(result.data);
      // `?? null`: an answer from before slice 1f (deploy skew) has no viewer.
      viewerRef.current = result.data.viewer ?? null;
      setPayloadWindow(readWindow);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, []);

  /** One currency's newest changes (SQ-12). Only the newest request may write state. */
  const loadCurrencyHistory = useCallback(async (code: string) => {
    const request = ++historyRequest.current;
    // The window as applied NOW, resolved with the clock of this read (SQ-27).
    const readWindow = historyWindowRef.current;
    setCurrencyHistory((current) => {
      const kept = current?.code === code ? current : null;
      return {
        code,
        // Shown rows keep the window they were read under until a new answer lands (SA-1d-2).
        payload: kept ? kept.payload : null,
        window: kept ? kept.window : readWindow,
        loading: true,
        error: null,
      };
    });
    // Callers check the counter first: only the newest request may write state.
    const settle = (next: Partial<CurrencyHistory>) => {
      setCurrencyHistory((current) => (current && current.code === code ? { ...current, loading: false, ...next } : current));
    };

    let response: Response;
    try {
      response = await fetch(
        `/api/admin/exchange-rates?currency=${encodeURIComponent(code)}&${historyWindowParams(readWindow, new Date())}`,
        { cache: 'no-store' }
      );
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
    settle({ payload: result.data, window: readWindow, error: null });
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

  // Unmount retires any request still in flight (SA W-3, SA-1d-1).
  useEffect(
    () => () => {
      historyRequest.current += 1;
      loadRequest.current += 1;
      syncRequest.current += 1;
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

  /**
   * A new history window (slice 1d). The same window reads nothing (SA-1d-6:
   * this covers a second click on the pressed This month). Otherwise apply it,
   * then run Refresh's reads (SQ-34), which read the ref at call time.
   */
  const changeHistoryWindow = (next: AdminWindowValue) => {
    if (windowEquals(next, historyWindowRef.current)) return;
    historyWindowRef.current = next;
    setHistoryWindow(next);
    refresh();
  };

  /** One PATCH; resolves to an error message for the row, or null after the row was replaced. */
  const patch = useCallback(
    async (
      currencyCode: string,
      body: ExchangeRatePatchBody,
      // Slice 1e (QA edge 1): lets Accept tell a 409 `rate_changed` from other refusals.
      onRefused?: (status: number) => void
    ): Promise<string | null> => {
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
        onRefused?.(result.status);
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

  /**
   * "Sync rates" (slice 1e). The server reads the ECB; nothing is saved. Only a
   * successful answer replaces the columns, clears the accepted set and moves
   * the tile; a failure shows its sentence and leaves all three as they were.
   */
  const runSync = useCallback(async () => {
    const request = ++syncRequest.current;
    const isCurrent = () => request === syncRequest.current;
    setSyncing(true);
    setSyncNotice(null);
    try {
      let response: Response;
      try {
        response = await fetch('/api/admin/exchange-rates/sync', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        });
      } catch {
        if (isCurrent()) setSyncNotice(ADMIN_NETWORK_ERROR);
        return;
      }
      const result = await readAdminResponse<ExchangeRateSyncPayload>(response, { what: SYNC_WHAT, sessionEndedCopy: true });
      if (!isCurrent()) return;
      if (!result.ok) {
        logger.warn({ status: result.status }, 'Exchange rate sync refused');
        setSyncNotice(result.message);
        return;
      }
      const answer = result.data;
      if (answer.outcome !== 'ok') {
        logger.warn({ outcome: answer.outcome }, 'Exchange rate sync could not read the public rates');
        setSyncNotice(syncOutcomeText(answer.outcome));
        return;
      }
      setSyncView({ answer, accepted: NO_CODES });
      // Slice 1f: the checker is the page's viewer (a ref, so the deps stay empty).
      const checked = lastSyncFromSync(answer, viewerRef.current);
      if (checked) setVisitLastSync(checked);
      logger.info({ suggestions: answer.suggestions.length }, 'Exchange rates synced');
    } finally {
      if (isCurrent()) setSyncing(false);
    }
  }, []);

  /**
   * Accept one row's suggestion (slice 1e.2) through the SAME `patch` as a
   * manual save, with the sync's base as `expectedRate` (a changed base is a
   * 409, SQ-44) and `origin` (SQ-43). Then the save's re-reads, and the code
   * joins the accepted set of the sync it was accepted from.
   */
  const acceptSuggestion = useCallback(
    async (currencyCode: string): Promise<string | null> => {
      const view = syncViewRef.current;
      const suggestion = view?.answer.suggestions.find((entry) => entry.currencyCode === currencyCode);
      if (!view || !suggestion || suggestion.suggestedRate === null || view.answer.rateDate === null) return NO_SUGGESTION;
      let rateChanged = false;
      const message = await patch(
        currencyCode,
        {
          field: 'rate',
          rate: suggestion.suggestedRate,
          expectedRate: suggestion.currentRate,
          origin: { kind: 'sync', source: 'ecb', rateDate: view.answer.rateDate },
        },
        (status) => {
          rateChanged = status === 409;
        }
      );
      if (message !== null) {
        // QA edge 1: the stored rate moved since the sync. Re-read the plain list through
        // the existing `load`, so the row shows the new rate and SA-1e-1 state (3) "Rate
        // changed since the sync", not a stale Accept. No new fetch( (G-6 stays at 4).
        if (rateChanged) void load();
        return message;
      }
      // Only the sync it was accepted from: a newer sync since then starts a clean set.
      setSyncView((current) =>
        current && current.answer === view.answer
          ? { ...current, accepted: new Set(current.accepted).add(currencyCode) }
          : current
      );
      void load({ afterSave: true });
      const open = openCodeRef.current;
      if (open) void loadCurrencyHistory(open);
      return null;
    },
    [patch, load, loadCurrencyHistory]
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
  // SQ-51 (5): the visit's own sync first, so a later re-read cannot move the tile back.
  const lastSync = visitLastSync ?? payload?.lastSync ?? LAST_SYNC_UNKNOWN;

  return (
    <div className="space-y-6">
      {/* K-10: hidden while the page shows an error. */}
      <ExchangeRatesKpis payload={error ? null : payload} loading={loading} lastSync={lastSync} />

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

      {/* Slice 1e: rendered from the first render, so "disabled with no plain read" is real (Q-1). */}
      <div data-testid="rate-sync" className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className={ADMIN_BUTTON}
            data-testid="sync-rates"
            disabled={syncing || !payload}
            aria-busy={syncing}
            onClick={() => void runSync()}
          >
            {syncing ? 'Syncing…' : 'Sync rates'}
          </button>
          <p data-testid="rate-sync-source" className="text-xs text-slate-400">
            Source:{' '}
            <a
              href={ECB_SOURCE_PAGE_URL}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="rate-sync-source-link"
              className="inline-flex items-center gap-1 text-purple-300 underline hover:text-purple-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
            >
              {ECB_SOURCE_LABEL}
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
            . {ECB_SOURCE_NOTE}
          </p>
        </div>
        <div role="status" data-testid="rate-sync-status" className="text-xs">
          {syncNotice ? (
            <span data-testid="rate-sync-notice" className="text-amber-300">
              {syncNotice}
            </span>
          ) : syncView ? (
            <span data-testid="rate-sync-line" className="text-slate-400">
              Source: {syncSourceLine(syncView.answer)}
            </span>
          ) : null}
        </div>
      </div>

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
                  sync={syncView}
                  onAcceptSuggestion={acceptSuggestion}
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
              window={historyWindow}
              defaultWindow={HISTORY_DEFAULT_WINDOW}
              onWindowChange={changeHistoryWindow}
              rowsWindow={currencyHistory.window}
            />
          ) : (
            <RateHistoryTable
              rows={payload.history}
              currencyCode={null}
              onShowAll={() => showHistory(null)}
              window={historyWindow}
              defaultWindow={HISTORY_DEFAULT_WINDOW}
              onWindowChange={changeHistoryWindow}
              rowsWindow={payloadWindow}
            />
          )}
        </div>
      )}
    </div>
  );
}
