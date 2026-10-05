'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Download, Receipt, ChevronLeft, ChevronRight, Loader2, AlertTriangle, Wallet, Clock, RotateCcw, TrendingUp, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MoneySummaryStrip } from './MoneySummaryStrip';
import { REPORTS_COLORS } from '@/lib/business-os/reports/constants';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { createLogger } from '@/lib/logger';
import { MoneyRow } from './MoneyRow';
import type { MoneyCurrencyTotals, MoneyEntry, MoneyItem, MoneyTotals } from '@/lib/payments/moneyItems';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { buildEntryActions } from '@/lib/payments/entryActions';
import { MoneyDetailDrawer } from './MoneyDetailDrawer';
import { RefundModal } from './RefundModal';

const logger = createLogger({ module: 'MoneyList' });

/**
 * The business's money, as one list.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * This replaces the Transactions and Invoices views, which showed a paid invoice
 * in both — once as the invoice and again as the payment that settled it — with
 * no way to add the two totals together.
 *
 * The grouping happens SERVER-SIDE, in /api/payments/money, and that is not an
 * arbitrary choice. The old lists paginate at ten rows each, and grouping across
 * two independently paginated sources is wrong in a way that looks right: an
 * invoice on page 1 whose payment is on page 3 renders as "awaiting payment" for
 * money that has already arrived. The server sees both sides at once and pages
 * the grouped rows instead.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/*
 * Ten rows a page.
 *
 * An order row expands in place to show its ledger, so a page of twenty was
 * long before anyone opened one. Ten keeps the summary strip and the first rows
 * on screen together, which is the comparison the page is for.
 *
 * The route validates `limit` as min(1).max(100), so this is the only place to
 * change it: the request, the page count and the "X–Y of Z" label all read it.
 */
const PAGE_SIZE = 10;

/*
 * The API's filter values, not the UI's.
 *
 * There are no chips any more — the summary cells are the filter, and each one
 * carries a figure as well as a name, which is what made the chip row redundant
 * beside it. `plans` and `draft` outlived the chips here because the ROUTE
 * still accepts them and another caller may send them; they simply have no
 * control on this page.
 */
type MoneyFilter =
  | 'all'
  | 'unpaid'
  | 'overdue'
  | 'paid'
  | 'refunded'
  | 'plans'
  | 'draft'
  | 'cancelled';

// Draft and cancelled were unreachable: the API had no such filter and the bar
// had no chip, so an unsent draft could not be found from this list at all.
type MoneySort = 'date' | 'amount' | 'client' | 'status';

const SORTS: MoneySort[] = ['date', 'amount', 'client', 'status'];

interface MoneyListProps {
  searchQuery?: string;
  /** Scroll to and mark a row, for deep links out of the CRM drawer. */
  highlightId?: string | null;
  /** Bumped by the caller to force a refetch after creating an invoice. */
  refreshKey?: number;
  /**
   * Hands the page a handle on the list's own actions, so Export can live in
   * the page header — where it was — while the data it exports stays here.
   */
  onReady?: (api: {
    exportCsv: () => void;
    /**
     * Whether the CURRENT VIEW has anything to put in a file.
     *
     * Carried to the page because the Export button lives in the header and the
     * rows live here, and a header button that writes a headings-only CSV looks
     * like a broken export rather than an empty ledger. Export takes what is on
     * screen, so the filtered count is the right one for it.
     */
    hasRows: boolean;
    /**
     * Whether this business has no money records AT ALL.
     *
     * A different question from `hasRows`, and the ledger needs this one. The
     * ledger spans its own date range and ignores the page's search and filter
     * entirely, so disabling it because somebody typed a search term that
     * matched nothing would be wrong.
     *
     * Only true when we can actually tell: no search, no filter, and nothing
     * came back. Under any filter the honest answer is "unknown", and unknown
     * leaves the button alone.
     */
    knownEmpty: boolean;
  }) => void;
}

export function MoneyList({
  searchQuery = '',
  highlightId,
  refreshKey,
  onReady,
}: MoneyListProps) {
  const { t, language, isRTL, timeZoneOptions } = useLanguage();

  const [items, setItems] = useState<MoneyItem[]>([]);
  const [totals, setTotals] = useState<MoneyTotals>({
    collected: 0,
    outstanding: 0,
    refunded: 0,
    // Both are required by the type and were missing from this literal, so the
    // pre-fetch render read `undefined` where a number was expected.
    cancelled: 0,
    overdue: 0,
    byCurrency: {},
  });
  const [total, setTotal] = useState(0);
  /**
   * How many rows the strip's figures are summing.
   *
   * Not `total`: that is the filtered count, which drives the pager. These two
   * deliberately differ the moment a KPI is clicked — the list narrows, the
   * summary does not.
   */
  const [summaryCount, setSummaryCount] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<MoneyFilter>('all');
  /*
   * Which row is drilled into. One at a time, so the list never becomes a
   * column of open ledgers with no rows left to compare them against.
   */
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  /**
   * Which kind of row the list is showing.
   *
   * A booking CONTAINS its money; an invoice with no booking IS the money. They
   * were two sections of one list, so a select-all could not mean either one and
   * reaching the invoices meant scrolling past every order.
   */
  const [kindView, setKindView] = useState<'bookings' | 'standalone'>('bookings');
  const [sort, setSort] = useState<MoneySort>('date');
  const [page, setPage] = useState(0);
  /** The entry being refunded. Refunds open a dialog rather than firing. */
  const [refundTarget, setRefundTarget] = useState<MoneyEntry | null>(null);
  /** The row whose full detail is open. */
  const [detail, setDetail] = useState<MoneyItem | null>(null);
  /** A refund the processor or the ledger refused. */
  const [refundError, setRefundError] = useState<string | null>(null);
  /**
   * How many refunds this business has actually issued.
   *
   * The card's amount is derived from the sales in view; this is a count of
   * refund EVENTS from the ledger, which is a different question and the one
   * "Returned to clients" was standing in for. Null until it arrives, so the
   * card never flashes a zero it does not know.
   */
  const [refundCount, setRefundCount] = useState<number | null>(null);
  /**
   * Rows picked for export.
   *
   * No checkbox column: a column of empty boxes is a permanent invitation to a
   * mode most readers never use. Clicking a row selects it once selection is
   * ON, and the bar that turns it on only appears when it is wanted.
   */
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const exportRef = useRef<() => void>(() => undefined);

  /*
   * Keep the open drawer pointed at the CURRENT row.
   *
   * `detail` is the item as it was when the row was clicked — a snapshot, not a
   * live reference. Refreshing the list rebuilt `items` and left the drawer
   * holding the old object, so after a refund the list behind it was right and
   * the drawer in front of it still showed the full amount. Closing and
   * reopening worked because that picked a fresh item, which is precisely the
   * step nobody should have to know about.
   *
   * Keyed on `items` alone: re-reading `detail` here would make this loop.
   */
  useEffect(() => {
    if (!detail) return;
    const fresh = items.find(item => item.key === detail.key);
    // Absent means it fell off the current page or out of the filter. Leaving
    // the old data up is better than the drawer emptying under the reader.
    if (fresh && fresh !== detail) setDetail(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const load = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    // Skeletons behind an open drawer read as the page reloading. The first
    // load still shows them; a refresh after an action just swaps the figures.
    if (!silent) setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
        filter,
        sort,
      });
      if (searchQuery.trim()) params.set('search', searchQuery.trim());

      /*
       * `no-store`. A refresh after a refund goes to the URL just fetched, so
       * without this it is answered from cache: the request completes, state is
       * set to what it already held, and the list insists the refund did not
       * happen.
       */
      const response = await fetch(`/api/payments/money?${params}`, { cache: 'no-store' });
      const result = await response.json();

      if (!result.success) throw new Error(result.error || 'Failed to load');

      setItems(result.data.items);
      setTotals(result.data.totals);
      setTotal(result.data.total);
      setSummaryCount(result.data.summaryCount ?? result.data.total);
      setTruncated(result.data.truncated);
    } catch (err) {
      // Said on screen, not only in the console. A money list that silently
      // renders empty reads as "you have no money", which is a lie.
      setError(err instanceof Error ? err.message : 'Failed to load');
      logger.warn({ err }, 'Money list failed to load');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [page, filter, sort, searchQuery]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  /*
   * The refund ledger's own count.
   *
   * Not derived from the rows in view: those are the SALES, and one sale can
   * carry several refunds while a filtered page can hide others entirely.
   * Re-read on `refreshKey` so issuing a refund updates the card.
   */
  useEffect(() => {
    let cancelled = false;

    fetch('/api/payments/refunds?list=1&limit=500')
      .then(response => (response.ok ? response.json() : null))
      .then(body => {
        if (cancelled || !body?.success) return;
        setRefundCount(body.data?.succeeded_count ?? 0);
      })
      .catch(() => {
        // The card falls back to its old wording rather than showing a wrong
        // count. A failed side-request must not disturb the money list.
      });

    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  // A new search or filter starts at the first page — staying on page 4 of a
  // result set that now has one page shows nothing.
  useEffect(() => {
    setPage(0);
  }, [filter, sort, searchQuery]);

  // A selection that survives a filter change would export rows the reader can
  // no longer see.
  useEffect(() => {
    setSelected(new Set());
  }, [filter, sort, searchQuery, page]);

  const formatCurrency = useCallback(
    (amount: number, currency: string) =>
      new Intl.NumberFormat(language === 'he' ? 'he-IL' : language === 'es' ? 'es-ES' : 'en-US', {
        style: 'currency',
        currency: currency || 'USD',
      }).format(amount),
    [language]
  );

  const formatDate = useCallback(
    (date: string) =>
      new Date(date).toLocaleDateString(
        language === 'he' ? 'he-IL' : language === 'es' ? 'es-ES' : 'en-US',
        timeZoneOptions({ year: 'numeric', month: 'short', day: 'numeric' })
      ),
    [language, timeZoneOptions]
  );

  /**
   * One figure per currency, not one figure labelled with whichever currency
   * happened to be first. `items[0].currency` over a mixed list printed a
   * meaningless sum under a confident symbol.
   */
  const currencies = Object.keys(totals.byCurrency);
  const shown = currencies.length > 0 ? currencies : [items[0]?.currency ?? 'USD'];

  const money = (pick: (c: MoneyCurrencyTotals) => number) =>
    shown
      .map(code =>
        formatCurrency(
          totals.byCurrency[code] ? pick(totals.byCurrency[code]) : 0,
          code
        )
      )
      // Stacked rather than joined on one line: two currencies side by side in
      // one value read as a single number with a stray symbol in it.
      .join('  ·  ');

  const totalPages = Math.ceil(total / PAGE_SIZE);

  // Bookings first. Everything else is money that belongs to no appointment —
  // an ad-hoc invoice, or a website purchase — and saying so stops it looking
  // like a booking whose details failed to load.
  const bookingItems = items.filter(item => item.kind === 'booking');
  const otherItems = items.filter(item => item.kind !== 'booking');
  /** What the switch above is showing, and the only thing select-all can mean. */
  const visibleItems = kindView === 'bookings' ? bookingItems : otherItems;
  /** Every row in view is chosen, so the select-all becomes a clear-all. */
  const allVisibleSelected =
    visibleItems.length > 0 && visibleItems.every(one => selected.has(one.key));

  /**
   * What clicking a row does.
   *
   * One meaning at a time: while picking rows to export a click selects, and
   * otherwise it opens the detail. A click that both selected AND opened would
   * make every export selection a drawer the reader has to dismiss.
   */
  const rowClicked = (item: MoneyItem) => {
    if (!selectMode) {
      setDetail(item);
      return;
    }
    setSelected(current => {
      const next = new Set(current);
      if (next.has(item.key)) next.delete(item.key);
      else next.add(item.key);
      return next;
    });
  };

  /** Deep links name an invoice or a transaction, never a row — so a row
   *  matches when any of its entries does. */
  const highlightClass = (item: MoneyItem) =>
    highlightId &&
    (item.key === highlightId ||
      item.entries.some(e => e.invoiceId === highlightId || e.transactionIds.includes(highlightId)))
      ? 'ring-2 ring-[#22C58B] rounded-lg'
      : '';


  /**
   * The actions the two old lists carried, restored onto the merged one.
   *
   * Losing them was the real cost of the merge: Send, Copy link, Resend, PDF,
   * View in Stripe, Void and Refund all lived on the invoice and transaction
   * lists, and a combined list without them is a report rather than a place to
   * work. Each reloads afterwards, because every one of these changes what the
   * row should say.
   */
  const handlers = useMemo(
    () =>
      buildEntryActions({
        // Post-action refresh: silent, for the same reason as the refund.
        refresh: () => load({ silent: true }),
        t,
        onRefund: (entry: MoneyEntry) => setRefundTarget(entry),
      }),
    [load, t]
  );

  /**
   * CSV of what is on screen.
   *
   * One line per money row rather than per invoice and per payment, so the
   * export adds up to the same figure the page shows. The two old exports could
   * not be combined without double-counting every settled invoice.
   */
  const exportCsv = () => {
    // Belt and braces for the button state below: a file containing nothing but
    // column headings is indistinguishable from a failed download.
    const chosen = selected.size > 0 ? items.filter(i => selected.has(i.key)) : items;
    if (chosen.length === 0) return;

    const rows = [
      [
        t('payments.export.item') || 'Item',
        t('payments.export.method') || 'How',
        t('payments.export.status') || 'Status',
        t('payments.export.amount') || 'Amount',
        t('payments.export.refunded_amount') || 'Refunded',
        t('payments.export.currency') || 'Currency',
        t('payments.export.date') || 'Date',
      ],
      // The picked rows, or all of them when nothing is picked. "Export"
      // meaning "export everything" stays true if you never enter select mode.
      ...chosen.map(item => [
        item.title,
        item.method,
        item.status,
        item.amount.toFixed(2),
        item.refunded ? item.refunded.toFixed(2) : '',
        item.currency,
        item.date,
      ]),
    ];

    const csv = rows
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `money-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };


  exportRef.current = exportCsv;

  useEffect(() => {
    /*
     * A stable wrapper: the page keeps one function, and it always calls the
     * latest closure rather than one captured on first render with an empty
     * list.
     *
     * Re-announced when the row count crosses in or out of zero — not on every
     * change — so the header's Export button can disable itself without this
     * firing on each keystroke of the search box.
     */
    onReady?.({
      exportCsv: () => exportRef.current(),
      hasRows: items.length > 0,
      knownEmpty: items.length === 0 && !searchQuery.trim() && filter === 'all',
    });
  }, [onReady, items.length > 0, searchQuery, filter]);

  return (
    <div dir={isRTL ? 'rtl' : 'ltr'}>
      {/* The summary strip. Every cell is a filter, and the active one clears
          when clicked again; the strip also renders the explicit way back.

          The totals cover the WHOLE filtered set, not the visible page: a
          number that changed as the reader paged would be worse than none.
          Note FILTERED, not entire — `filter` goes to the API, so once one is
          applied the other figures are 0 by construction. That is why the strip
          must not read a 0 as "nothing to filter by"; see its own comment. */}
      <MoneySummaryStrip
        totals={totals}
        money={money}
        activeFilter={filter}
        onFilter={next => setFilter(next as typeof filter)}
        orderCount={summaryCount}
      />

      {/*
        The toolbar: which SET of rows, then which view of them.
        ───────────────────────────────────────────────────────────────────────
        Orders and loose invoices were two labelled sections of one list, which
        meant scrolling past every order to reach the first invoice and a select
        -all that could not mean either one. They are different things — a
        booking CONTAINS its money, an invoice with no booking IS the money — so
        they are now two views, switched here.
      */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div
          className="flex gap-0.5 bg-[var(--v2-bg)] p-0.5"
          role="group"
          style={{ borderRadius: 'var(--v2-radius-button)' }}
        >
          {(['bookings', 'standalone'] as const).map(option => (
            <button
              key={option}
              type="button"
              onClick={() => {
                setKindView(option);
                // A selection made in one view cannot be exported from the
                // other, and silently carrying it across is how a reader
                // exports rows they can no longer see.
                setSelected(new Set());
              }}
              aria-pressed={kindView === option}
              className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                kindView === option
                  ? 'bg-[var(--v2-surface)] text-[var(--v2-text-primary)] shadow-sm'
                  : 'text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)]'
              }`}
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              {option === 'bookings'
                ? t('payments.view.orders') || 'Orders'
                : t('payments.view.standalone') || 'Invoices without an order'}
            </button>
          ))}
        </div>

        {/* Sorting vanished entirely in the merge. "Biggest first" and "who owes
            me" are how people actually read a money list, and neither was
            reachable. Server-side, so it orders everything rather than the
            twenty rows already fetched. */}
        <div className="ms-auto flex items-center gap-2">
          <Select value={sort} onValueChange={value => setSort(value as MoneySort)}>
            <SelectTrigger
              className="h-8 w-[170px] bg-[var(--v2-bg)] border-[var(--v2-border)] text-[var(--v2-text-primary)] text-xs focus:border-[#14B8A6] focus:ring-[#14B8A6]/20"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
              aria-label={t('payments.sort_by') || 'Sort by'}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-[var(--v2-surface)] border-[var(--v2-border)] p-1">
              {SORTS.map(option => (
                <SelectItem
                  key={option}
                  value={option}
                  className="text-[var(--v2-text-primary)] focus:bg-[#14B8A6]/10 focus:text-[#0D9488] py-2 px-3 cursor-pointer text-sm"
                >
                  {t(`payments.sort.${option}`) || option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* The cap was reached, so the totals above are partial. Silently showing
          a shorter list would make them look complete. */}
      {truncated && (
        <div className="mb-3 flex items-center gap-2 px-3 py-2 text-[11.5px] text-amber-700 bg-amber-50 dark:bg-amber-900/20" style={{ borderRadius: 'var(--v2-radius-button)' }}>
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {t('payments.truncated') || 'Showing the most recent records only — totals are partial.'}
        </div>
      )}

      {/* Selection is a MODE, entered deliberately — the alternative, a checkbox
          on every row always, puts a column of empty boxes in front of every
          reader to serve the occasional one who wants a partial export.

          The control used to float above the list on its own line, far from the
          rows it acts on and with nothing to select ALL of. It lives in the
          list's header now, in the column the checkboxes would occupy. */}
      {refundError && (
        <div
          className="mb-3 flex items-start gap-2 bg-red-500/10 px-3 py-2 text-[11.5px] text-red-600"
          style={{ borderRadius: 'var(--v2-radius-button)' }}
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">{refundError}</span>
          <button onClick={() => setRefundError(null)} className="shrink-0 underline">
            {t('common.dismiss') || 'Dismiss'}
          </button>
        </div>
      )}

      {error ? (
        <div className="py-8 text-center text-sm text-red-600">{error}</div>
      ) : loading ? (
        <div className="py-10 text-center text-[var(--v2-text-muted)]">
          <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin" />
          {t('common.loading') || 'Loading...'}
        </div>
      ) : items.length === 0 ? (
        <div className="py-10 text-center text-[var(--v2-text-muted)]">
          <Receipt className="mx-auto mb-2 h-10 w-10 opacity-20" />
          <p className="text-sm">{t('payments.no_money_yet') || 'Nothing billed yet'}</p>
        </div>
      ) : (
        /*
          ONE CARD, NOT A CARD PER ROW.
          ───────────────────────────────────────────────────────────────────
          Each row was its own bordered, rounded card with a gap beneath it, so
          a list of twenty orders was twenty objects. That is the treatment for
          things considered one at a time; a list is read DOWN, and the gaps
          broke every column the row works so hard to align.

          One container with hairline-divided rows says what is true: these are
          entries in a ledger, comparable line by line.
        */
        <div
          className="overflow-hidden border border-[var(--v2-border)] bg-[var(--v2-surface)]"
          style={{ borderRadius: 'var(--v2-radius-card)' }}
        >
          {/*
            The column headings.
            ─────────────────────────────────────────────────────────────────
            The list had none, so every reader worked out what the middle track
            was from its contents — which is readable on a row with a full bar
            and guesswork on a row with one segment. Four words remove that.

            Hidden where the columns are, on a narrow screen: a heading over a
            track that is not rendered is worse than no heading.
          */}
          {/*
            The header carries the selection controls, because the first column
            is where a checkbox belongs and "select all" has to sit at the top of
            the thing it selects.
          */}
          <div className="flex items-center gap-3 border-b border-[var(--v2-border)] bg-[var(--v2-bg)] px-3 py-1.5 text-[11px]">
            <button
              type="button"
              onClick={() => {
                setSelectMode(!selectMode);
                setSelected(new Set());
              }}
              className={`px-2 py-0.5 text-[11px] font-medium transition-colors ${
                selectMode
                  ? 'bg-[#22C58B]/10 text-[#22C58B]'
                  : 'text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)]'
              }`}
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              {selectMode
                ? t('payments.select.done') || 'Done selecting'
                : t('payments.select.start') || 'Select rows'}
            </button>

            {selectMode && (
              <>
                {/*
                  A TOGGLE, and it says which way it will go.
                  ─────────────────────────────────────────────────────────────
                  A checkbox here was both the wrong control and the wrong
                  grammar: every other control on this bar is a button, and a
                  box that is unticked with two of five rows chosen looks like
                  it is reporting "none selected" rather than offering "select
                  the rest".

                  Scoped to what the switch above is showing. A select-all that
                  reached the other view would export rows the reader never saw.
                */}
                <button
                  type="button"
                  disabled={visibleItems.length === 0}
                  onClick={() =>
                    setSelected(
                      allVisibleSelected ? new Set() : new Set(visibleItems.map(one => one.key))
                    )
                  }
                  aria-pressed={allVisibleSelected}
                  className={`px-2 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-40 ${
                    allVisibleSelected
                      ? 'bg-[#22C58B]/10 text-[#22C58B]'
                      : 'text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)]'
                  }`}
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  {allVisibleSelected
                    ? t('payments.select.none') || 'Clear selection'
                    : t('payments.select.all') || 'Select all'}
                </button>
                <span className="text-[var(--v2-text-muted)]">
                  {selected.size > 0
                    ? `${selected.size} ${t('payments.select.chosen') || 'selected'}`
                    : t('payments.select.hint') || 'Click rows to select them'}
                </span>
                {selected.size > 0 && (
                  <button
                    type="button"
                    onClick={exportCsv}
                    className="ms-auto flex items-center gap-1.5 px-2 py-0.5 text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)]"
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  >
                    <Download className="h-3.5 w-3.5" />
                    {t('payments.select.export') || 'Export selected'}
                  </button>
                )}
              </>
            )}
          </div>

          <div className="hidden grid-cols-[1.25rem_minmax(0,1.6fr)_minmax(0,1.1fr)_8.5rem_1.25rem] items-center gap-3 border-b border-[var(--v2-border)] bg-[var(--v2-bg)] px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--v2-text-muted)] sm:grid">
            <span aria-hidden="true" />
            <span>{t('payments.col.client_order') || 'Client and order'}</span>
            <span>{t('payments.col.cashflow') || 'Cashflow'}</span>
            <span className="text-end">{t('payments.col.amount') || 'Amount'}</span>
            <span aria-hidden="true" />
          </div>

          {visibleItems.length === 0 ? (
            <div className="px-3 py-8 text-center text-[12px] text-[var(--v2-text-muted)]">
              {kindView === 'bookings'
                ? t('payments.view.no_orders') || 'No orders in this view'
                : t('payments.view.no_standalone') || 'No invoices without an order'}
            </div>
          ) : (
            visibleItems.map(item => (
              <div
                key={item.key}
                className={`border-b border-[var(--v2-border)] last:border-b-0 ${highlightClass(item)}`}
              >
                <MoneyRow
                  expanded={expandedKey === item.key}
                  onToggleExpand={() => setExpandedKey(expandedKey === item.key ? null : item.key)}
                  item={item}
                  t={t}
                  isRTL={isRTL}
                  formatCurrency={formatCurrency}
                  formatDate={formatDate}
                  onSelect={() => rowClicked(item)}
                  selected={selected.has(item.key)}
                  selectable={selectMode}
                />
              </div>
            ))
          )}
        </div>
      )}

      {/* Not inside the refund guard: the detail drawer is what a row click
          opens, and a refund is one of the things it offers. */}
      <MoneyDetailDrawer
        item={detail}
        onClose={() => setDetail(null)}
        t={t}
        isRTL={isRTL}
        formatCurrency={formatCurrency}
        formatDate={formatDate}
        onPlanCancelled={() => {
          setDetail(null);
          load({ silent: true });
        }}
        onActionError={message => setRefundError(message)}
        {...handlers}
      />

      {refundTarget && (
        <RefundModal
          isOpen={!!refundTarget}
          onClose={() => setRefundTarget(null)}
          invoiceId={refundTarget.invoiceId ?? undefined}
          transactionId={refundTarget.invoiceId ? undefined : refundTarget.transactionIds[0]}
          originalAmount={refundTarget.amount}
          currency={refundTarget.currency}
          alreadyRefunded={refundTarget.refunded}
          isRTL={isRTL}
          onSuccess={() => {
            setRefundTarget(null);
            // Silent, and the effect above re-points the open drawer at the
            // refreshed row so the refund shows without closing anything.
            load({ silent: true });
          }}
          // Without this a refused refund — 409 NOTHING_REMAINING,
          // ACCOUNT_UNRESOLVED, a 502 from the processor — left the dialog open
          // with the spinner off and nothing said, which reads as "nothing
          // happened" rather than "your money did not move".
          onError={message => setRefundError(message)}
        />
      )}

      {/*
        PAGINATION — the platform's, not this page's own.
        ───────────────────────────────────────────────────────────────────────
        This was two bare chevrons and an `xs` line, which is not what the rest
        of the platform does: `PaymentInvoiceList` and `PaymentTransactionList`
        both render a surfaced card with the `{from}-{to} of {total}` string,
        labelled Previous/Next buttons and up to five numbered pages. Same list,
        same page, two different pagers.

        So this is that pattern, including the five-page window, and it reads
        `payments.pagination.*` — the keys those two already use — rather than
        assembling the sentence from `reports.of`.

        ONE DELIBERATE DIFFERENCE: the chevrons flip under RTL. Neither sibling
        does that, so in Hebrew their "next" arrow points back the way the
        reader came. This page is read in Hebrew every day, so the bug is not
        worth copying for symmetry's sake; the siblings should be fixed to
        match, not this one broken to match them.
      */}
      {totalPages > 1 && (
        <div
          className="mt-3 flex items-center justify-between border border-[var(--v2-border)] bg-[var(--v2-surface)] p-4"
          style={{ borderRadius: 'var(--v2-radius-card)' }}
        >
          <div className="text-sm text-[var(--v2-text-muted)]">
            {t('payments.pagination.showing')
              ?.replace('{from}', String(page * PAGE_SIZE + 1))
              .replace('{to}', String(Math.min((page + 1) * PAGE_SIZE, total)))
              .replace('{total}', String(total)) ||
              `${page * PAGE_SIZE + 1}-${Math.min((page + 1) * PAGE_SIZE, total)} of ${total}`}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0 || loading}
              className="h-8 px-2"
            >
              <ChevronLeft className={`h-4 w-4 ${isRTL ? 'rotate-180' : ''}`} />
              <span className="ms-1 hidden sm:inline">
                {t('payments.pagination.prev') || 'Previous'}
              </span>
            </Button>

            <div className="hidden items-center gap-1 sm:flex">
              {(() => {
                /*
                 * A five-page window that keeps the current page in view:
                 * clamped to the start near the start, to the end near the end,
                 * centred in between. Copied from the siblings so the three
                 * pagers behave identically, not only look alike.
                 */
                const currentPage = page + 1;
                return Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum: number;
                  if (totalPages <= 5) pageNum = i + 1;
                  else if (currentPage <= 3) pageNum = i + 1;
                  else if (currentPage >= totalPages - 2) pageNum = totalPages - 4 + i;
                  else pageNum = currentPage - 2 + i;

                  return (
                    <Button
                      key={pageNum}
                      variant={currentPage === pageNum ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setPage(pageNum - 1)}
                      disabled={loading}
                      className={`h-8 w-8 p-0 ${
                        currentPage === pageNum
                          ? 'bg-[#22C58B] text-white hover:bg-[#1ea677]'
                          : ''
                      }`}
                    >
                      {pageNum}
                    </Button>
                  );
                });
              })()}
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => (p + 1 < totalPages ? p + 1 : p))}
              disabled={page + 1 >= totalPages || loading}
              className="h-8 px-2"
            >
              <span className="me-1 hidden sm:inline">
                {t('payments.pagination.next') || 'Next'}
              </span>
              <ChevronRight className={`h-4 w-4 ${isRTL ? 'rotate-180' : ''}`} />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
