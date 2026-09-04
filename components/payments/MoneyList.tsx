'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Download, Receipt, ChevronLeft, ChevronRight, Loader2, AlertTriangle, Wallet, Clock, RotateCcw, TrendingUp } from 'lucide-react';
import { MetricCard } from '@/components/business-os/reports/MetricCard';
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

const PAGE_SIZE = 20;

type MoneyFilter = 'all' | 'unpaid' | 'paid' | 'refunded' | 'plans' | 'draft' | 'cancelled';

// Draft and cancelled were unreachable: the API had no such filter and the bar
// had no chip, so an unsent draft could not be found from this list at all.
const FILTERS: MoneyFilter[] = ['all', 'unpaid', 'paid', 'refunded', 'plans', 'draft', 'cancelled'];

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
  onReady?: (api: { exportCsv: () => void }) => void;
}

export function MoneyList({
  searchQuery = '',
  highlightId,
  refreshKey,
  onReady,
}: MoneyListProps) {
  const { t, language, isRTL } = useLanguage();

  const [items, setItems] = useState<MoneyItem[]>([]);
  const [totals, setTotals] = useState<MoneyTotals>({
    collected: 0,
    outstanding: 0,
    refunded: 0,
    byCurrency: {},
  });
  const [total, setTotal] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<MoneyFilter>('all');
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
        { year: 'numeric', month: 'short', day: 'numeric' }
      ),
    [language]
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
      ...(selected.size > 0 ? items.filter(i => selected.has(i.key)) : items).map(item => [
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
    // A stable wrapper: the page keeps one function, and it always calls the
    // latest closure rather than one captured on first render with an empty list.
    onReady?.({ exportCsv: () => exportRef.current() });
  }, [onReady]);

  return (
    <div dir={isRTL ? 'rtl' : 'ltr'}>
      {/* KPI cards, using the same MetricCard the reports overview uses — a
          second card style for the same kind of figure would read as a
          different kind of figure.

          The totals cover the WHOLE filtered set, not the visible page: a
          number that changed as the reader paged would be worse than none. */}
      <div className="mb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* The whole book of business: what arrived plus what is still coming.

            Refunds are NOT subtracted here, because they are already gone from
            `collected` — the totals net each entry as `amount - refunded`. Taking
            the refund off again would remove it twice and understate the figure
            by exactly the amount returned. */}
        <MetricCard
          icon={TrendingUp}
          iconColor={REPORTS_COLORS.ACCENT}
          label={t('payments.total_revenue') || 'Total revenue'}
          value={money(c => c.collected + c.outstanding)}
          subtitle={t('payments.paid_and_pending') || 'Paid and pending, after refunds'}
        />
        <MetricCard
          icon={Wallet}
          iconColor={REPORTS_COLORS.PRIMARY}
          label={t('payments.collected') || 'Collected'}
          value={money(c => c.collected)}
          subtitle={`${total} ${total === 1 ? t('payments.item') || 'order' : t('payments.entries') || 'orders'}`}
        />
        <MetricCard
          icon={Clock}
          iconColor={REPORTS_COLORS.WARNING}
          label={t('payments.outstanding') || 'Outstanding'}
          value={money(c => c.outstanding)}
          subtitle={
            totals.outstanding > 0
              ? t('payments.awaiting_collection') || 'Still to collect'
              : t('payments.all_collected') || 'Nothing outstanding'
          }
          onAction={totals.outstanding > 0 ? () => setFilter('unpaid') : undefined}
          actionLabel={t('payments.filter.unpaid') || 'Unpaid'}
        />
        <MetricCard
          icon={RotateCcw}
          iconColor={REPORTS_COLORS.UNATTRIBUTED}
          label={t('payments.refunded') || 'Refunded'}
          value={money(c => c.refunded)}
          subtitle={
            totals.refunded <= 0
              ? t('payments.no_refunds') || 'No refunds'
              : refundCount === null
                ? t('payments.returned_to_clients') || 'Returned to clients'
                : `${refundCount} ${
                    refundCount === 1
                      ? t('payments.refund_singular')
                      : t('payments.refund_plural')
                  }`
          }
          onAction={totals.refunded > 0 ? () => setFilter('refunded') : undefined}
          actionLabel={t('payments.filter.refunded') || 'Refunded'}
        />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {FILTERS.map(option => (
          <button
            key={option}
            onClick={() => setFilter(option)}
            className={`px-2.5 py-1 text-xs transition-colors border ${
              filter === option
                ? 'text-[#22C58B] border-[#22C58B] bg-[#22C58B]/10'
                : 'text-[var(--v2-text-secondary)] border-[var(--v2-border)] hover:text-[var(--v2-text-primary)]'
            }`}
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            {t(`payments.filter.${option}`) || option}
          </button>
        ))}

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

      {/* Selection is a MODE, entered deliberately. The alternative — a checkbox
          on every row, always — puts a column of empty boxes in front of every
          reader to serve the occasional one who wants a partial export. */}
      <div className="mb-2 flex items-center gap-2 text-[11.5px]">
        <button
          onClick={() => {
            setSelectMode(!selectMode);
            setSelected(new Set());
          }}
          className={`px-2.5 py-1 border transition-colors ${
            selectMode
              ? 'text-[#22C58B] border-[#22C58B] bg-[#22C58B]/10'
              : 'text-[var(--v2-text-secondary)] border-[var(--v2-border)] hover:text-[var(--v2-text-primary)]'
          }`}
          style={{ borderRadius: 'var(--v2-radius-button)' }}
        >
          {selectMode
            ? t('payments.select.done') || 'Done selecting'
            : t('payments.select.start') || 'Select rows'}
        </button>

        {selectMode && (
          <>
            <span className="text-[var(--v2-text-muted)]">
              {selected.size > 0
                ? `${selected.size} ${t('payments.select.chosen') || 'selected'}`
                : t('payments.select.hint') || 'Click rows to select them'}
            </span>
            {selected.size > 0 && (
              <button
                onClick={exportCsv}
                className="ms-auto flex items-center gap-1.5 px-2.5 py-1 border border-[var(--v2-border)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)]"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                <Download className="h-3.5 w-3.5" />
                {t('payments.select.export') || 'Export selected'}
              </button>
            )}
          </>
        )}
      </div>

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
        <div className="space-y-2">
          {/* Split, because a booking row and a loose invoice are different
              kinds of thing and mixing them reads as "invoices floating around
              unattached". A booking CONTAINS its money; an invoice with no
              booking IS the money. Saying which is which is the difference
              between a hierarchy and a jumble. */}
          {bookingItems.length > 0 && otherItems.length > 0 && (
            <div className="pt-1 text-[11px] font-medium uppercase tracking-wide text-[var(--v2-text-muted)]">
              {t('payments.section.bookings') || 'Bookings'}
            </div>
          )}
          {bookingItems.map(item => (
            <div key={item.key} className={highlightClass(item)}>
              <MoneyRow
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
          ))}

          {otherItems.length > 0 && (
            <>
              {bookingItems.length > 0 && (
                <div className="pt-3 text-[11px] font-medium uppercase tracking-wide text-[var(--v2-text-muted)]">
                  {t('payments.section.other') || 'Not linked to a booking'}
                </div>
              )}
              {otherItems.map(item => (
                <div key={item.key} className={highlightClass(item)}>
                  <MoneyRow
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
              ))}
            </>
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

      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between text-xs text-[var(--v2-text-muted)]">
          <span>
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} {t('reports.of') || 'of'} {total}
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="p-1 disabled:opacity-30"
            >
              <ChevronLeft className={`h-4 w-4 ${isRTL ? 'rotate-180' : ''}`} />
            </button>
            <button
              onClick={() => setPage(p => (p + 1 < totalPages ? p + 1 : p))}
              disabled={page + 1 >= totalPages}
              className="p-1 disabled:opacity-30"
            >
              <ChevronRight className={`h-4 w-4 ${isRTL ? 'rotate-180' : ''}`} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
