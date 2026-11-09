'use client';

/**
 * The money page: one story, told once, in the order an owner asks it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS BESIDE THE ORDERS PAGE RATHER THAN INSIDE IT
 *
 * The orders page answers "show me every order and let me filter them". This
 * answers "how is my money doing" — a different question, and the reason the
 * first one felt overwhelming is that it was being asked to answer both.
 *
 * `/business-os/orders` is untouched. Nothing here imports from it, so the two
 * can run side by side while this is judged.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONE IDEA: MONEY NESTS, SO DRAW IT NESTING
 *
 * Five figures in a row look like they should add up. They do not — what is
 * late is PART of what is owed — and when they fail to, the reader concludes
 * one of them is wrong. Sentences explaining that were tried and did not take.
 *
 * So the late amount is drawn INSIDE the owed amount, and the question cannot
 * arise. The same bar appears again at row scale: one order splits the way the
 * whole month splits, in the same colours, so the device is learnt once.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PERIOD GOVERNS THE WHOLE SUMMARY
 *
 * Every figure in the four cards describes the window chosen above them —
 * collected, owed, late, not yet due, and written off alike.
 *
 * This was once split: events followed the period and debts did not, on the
 * reasoning that "₪3,600 is owed to you" does not become less true because the
 * reader picked October. That reasoning holds for the SENTENCE, and it lost the
 * argument against the SCREEN: four cards side by side, describing four
 * different spans of time, with only a line of small print to say so. Read
 * together — which is the only way they are read — they have to mean one thing.
 *
 * So the window filters the rows and `totalMoney` produces the figures, the
 * same function the all-time summary uses. The two differ in window and in
 * nothing else.
 *
 * WHAT TO WATCH: "all time" is the honest answer to "what am I owed in total",
 * and it is one click away. Nothing here converts between currencies — the
 * figures bucket by currency exactly as the orders strip does.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronLeft, ChevronRight, FileSpreadsheet, Download, Plus, Receipt } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { PAGE_CONTAINER } from '@/lib/business-os/pageContainer';
/* The money icon and its green, from where every money surface reads them. */
import { REPORTS_COLORS } from '@/lib/business-os/reports/constants';
import { businessDayFor } from '@/lib/business-os/businessDay';
import { itemFlow, type MoneyEntry, type MoneyItem, type MoneyTotals } from '@/lib/payments/moneyItems';
/*
  REUSED FROM THE ORDERS PAGE, NOT REBUILT.

  This page is that page's new design, so every one of these is the same
  component or function doing the same job: the search box with its operators,
  the invoice composer, the accountant's export, and the one serialiser both
  exports write their file through. A second implementation of any of them is a
  second answer to a question the owner asks once.
*/
import { MoneySearchField } from '@/components/payments/MoneySearchField';
import { InvoiceModal } from '@/components/payments/InvoiceModal';
import { LedgerExportModal } from '@/components/payments/LedgerExportModal';
import { downloadMoneyCsv } from '@/lib/payments/moneyCsv';
/*
  What the row actions DO, defined once in `lib/payments/entryActions` because
  the orders list and the CRM drawer each having their own copy is how one of
  them stayed broken through two fixes. Refunds never fire from a menu — they
  open the same dialog the orders page opens.
*/
import { buildEntryActions } from '@/lib/payments/entryActions';
import { RefundModal } from '@/components/payments/RefundModal';
/*
  The drawer's own phrasing for "payment 2 of 3", exported for exactly this and
  already used by MoneyRow. `item.title` and `entry.description` are built on
  the server with no reader and no language, so for a plan instalment they hold
  the English sentence the Stripe webhook stored. `planPeriod` carries the raw
  numbers precisely so the browser can say it in the reader's language.
*/
import { planPeriodText } from '@/components/payments/MoneyDetailDrawer';
import { STATUS_INK, STATUS_TONE, chipGround, scheduleTone } from '@/lib/payments/moneyStatusTone';
/* `scheduleOf` lives with the drawer, which is the other surface that draws
   it. The contact record needs it too and must not import a whole page to
   get it. */
import { MoneyOrderDrawer, scheduleOf } from './MoneyOrderDrawer';

/** The four states money can be in, and the one colour each gets everywhere. */
/**
 * One colour per money state, read from the one place that decides it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS FILE USED TO PICK ITS OWN, AND THAT IS A SOLVED PROBLEM.
 *
 * `lib/payments/moneyStatusTone` exists because FOUR palettes once described
 * the same fact and disagreed — its own header records the damage, including
 * the part that matters most here: "the strip is also the filter: clicking its
 * orange 'due' cell returned rows badged blue, which defeats the one thing a
 * coloured filter is for."
 *
 * This page then added a fifth. Every value drifted (#2DD4A7 against the
 * canonical #22C58B, and so on), but one was not a shade apart, it was a
 * different meaning: REFUNDED was drawn as a DRAINED GREEN, on the reasoning
 * that it should stay "recognisably the same family" as collected. At the
 * strip's 40px that nuance is legible. In a 6px row bar it is simply green,
 * and green on this page means money you kept — so a cancelled order whose $89
 * had been returned in full drew a solid green bar, and the Refunded filter
 * chip was green beside the Collected one.
 *
 * The canonical answer was already there and is the opposite: returned money
 * takes the SAME GREY the strip's "returned to clients" cell uses, because it
 * is neither earned nor chased.
 *
 * So the five names below stay — the layout code reads `TONE.in`, not a status
 * string — but every value now comes from the shared map. A chip, a bar
 * segment, a state dot and a breakdown row showing one state cannot disagree
 * again, which is the whole point of the module.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const TONE = {
  in: STATUS_TONE.paid,
  wait: STATUS_TONE.awaiting_payment,
  late: STATUS_TONE.overdue,
  /** Came in and went back: neither earned nor lost, and never the green of
      money that stayed. */
  back: STATUS_TONE.refunded,
  /** Deliberately quiet. Lost money must not shout louder than earned money. */
  lost: STATUS_TONE.cancelled,
} as const;

/**
 * The same states as WORDS. See `STATUS_INK`: several fills above are picked to
 * be distinguishable as areas and are too light to read as text.
 */
const INK = {
  lost: STATUS_INK.cancelled ?? STATUS_TONE.cancelled,
} as const;

type PeriodKey = 'week' | 'month' | 'year' | 'all';

/**
 * How many rows an export may carry.
 *
 * The same ceiling the route applies to its own reads, so asking for more
 * cannot quietly return less. The orders page uses the same number for the
 * same reason.
 */
const EXPORT_CAP = 2000;

/**
 * Rows per page.
 *
 * Ten, because the list lives behind a door and a door that opens onto fifty
 * cards is the scroll this page was built to end.
 */
const PAGE_SIZE = 10;

/*
  The period figures are the SAME SHAPE as the all-time ones, because they come
  from the same function over a windowed copy of the rows. There is no second
  definition of collected, owed or written off, and no second answer about
  which currency a figure is in.
*/
type PeriodTotals = MoneyTotals;

/** `YYYY-MM-DD` for a date, in the reader's own calendar. */
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * The window a period means.
 *
 * `to` is EXCLUSIVE and set to tomorrow, so today's payments are inside it —
 * an owner checking at four in the afternoon should see the money that arrived
 * at noon.
 */
function windowFor(period: PeriodKey): { from?: string; to?: string } {
  if (period === 'all') return {};

  const now = new Date();
  const to = new Date(now);
  to.setDate(to.getDate() + 1);

  const from = new Date(now);
  if (period === 'week') from.setDate(from.getDate() - 7);
  if (period === 'month') from.setDate(from.getDate() - 30);
  if (period === 'year') from.setFullYear(from.getFullYear() - 1);

  return { from: dayKey(from), to: dayKey(to) };
}

export function MoneyFlowPage({
  /** `?action=create` — open the invoice composer on arrival. */
  openCreate = false,
}: {
  openCreate?: boolean;
} = {}) {
  const { t, language, isRTL, timeZoneOptions } = useLanguage();
  const router = useRouter();

  /*
    WHERE "OPEN THE ORDER" GOES: the CRM drawer, on the booking, expanded.

    ───────────────────────────────────────────────────────────────────────────
    Not the orders page, which is the page this one replaces. `section=bookings`
    plus `booking=<id>` is what `BookingsTab` reads as `focusBookingId`: it adds
    the id to its OPEN set and scrolls the card into view, so the booking lands
    unfolded rather than as one collapsed row among the client's others.

    Owned by the page and handed down, which is how the orders page does it —
    `PaymentsView` builds this route and `MoneyRow` takes `onOpenBooking`. The
    row and the drawer therefore cannot send the reader to different places,
    and the drawer does not have to import from the page that renders it.

    A contact is required, not optional: the drawer IS a contact's record, so
    without one there is nothing to open. The caller hides the button instead.
  */
  const openBooking = useCallback(
    (item: MoneyItem) => {
      if (!item.bookingId || !item.contactId) return;

      const params = new URLSearchParams({
        contact: item.contactId,
        section: 'bookings',
        booking: item.bookingId,
      });
      router.push(`/business-os/crm?${params.toString()}`);
    },
    [router]
  );

  /** The client's record, opened on their money. From this page that is
      somewhere else to go; from inside the contact drawer it would be the
      page the reader is already on, which is why the drawer takes it as a
      prop rather than building it. */
  const openContact = useCallback(
    (item: MoneyItem) => {
      if (!item.contactId) return;

      const params = new URLSearchParams({ contact: item.contactId, section: 'payments' });
      router.push(`/business-os/crm?${params.toString()}`);
    },
    [router]
  );

  /*
   * A row's currency varies per item, which the context's `formatCurrency`
   * cannot express — it formats in the reader's chosen display currency. So the
   * amount is formatted in the currency it IS, the same way `MoneyList` does
   * it, rather than converted into one the money was never in.
   */
  const formatCurrency = useCallback(
    (amount: number, currency: string) =>
      new Intl.NumberFormat(language === 'he' ? 'he-IL' : language === 'es' ? 'es-ES' : 'en-US', {
        style: 'currency',
        currency: currency || 'ILS',
      }).format(amount),
    [language]
  );

  const [period, setPeriod] = useState<PeriodKey>('month');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<
    'all' | 'paid' | 'unpaid' | 'overdue' | 'refunded' | 'cancelled'
  >('all');
  const [items, setItems] = useState<MoneyItem[]>([]);
  const [totals, setTotals] = useState<MoneyTotals | null>(null);
  /*
   * The route's own alarm, which this page was throwing away.
   *
   * `/api/payments/money` counts its reads against `GROUPING_CAP` and sets
   * this when it had to stop short — its comment says why in one line: "a
   * silently truncated money report is a wrong money report." It then logs a
   * warning the owner never sees and returns the flag, and nothing here read
   * it. The one safeguard against a partial report existed only in the server
   * log.
   *
   * At 4% of the cap today it will stay false. That is exactly when to wire
   * it: the alternative is discovering it is unwired on the day the figures
   * are first wrong.
   */
  const [truncated, setTruncated] = useState(false);
  const [periodTotals, setPeriodTotals] = useState<PeriodTotals | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  /** Rows picked by hand, for an export of exactly those. */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /**
   * Which list is open, or neither.
   *
   * Neither, to begin with: the summary is what this page is for, and a list
   * under it turned the page into a scroll with the answer at the top and
   * everything else below. Both are one click from the same place.
   */
  const [listOpen, setListOpen] = useState<'orders' | 'loose' | null>(null);
  /** Which page of the open list, zero-based. */
  const [page, setPage] = useState(0);
  /** How many rows each door holds under the current filter, from the route. */
  const [kindCounts, setKindCounts] = useState<{ booking: number; standalone: number }>({
    booking: 0,
    standalone: 0,
  });
  /** Rows matching the filter within the OPEN kind — what paginates. */
  const [total, setTotal] = useState(0);
  /** The row opened in the drawer, which is a different gesture from expanding
      it in place: the strip in the list answers "how far along is this", the
      drawer answers "what happened to it". */
  const [detail, setDetail] = useState<MoneyItem | null>(null);
  /** The entry being refunded. Refunds open a dialog rather than firing. */
  const [refundTarget, setRefundTarget] = useState<MoneyEntry | null>(null);
  const [showInvoice, setShowInvoice] = useState(openCreate);
  const [showLedgerExport, setShowLedgerExport] = useState(false);
  /* The export is a round trip. A button that appears to do nothing is clicked
     again, and then twice more. */
  const [exporting, setExporting] = useState(false);

  /** The business's own day, which is what the search operators parse against. */
  const today = businessDayFor(
    new Date(),
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  ).date;

  /*
    THE BUSINESS'S CLOCK, NOT THE READER'S LAPTOP.

    `timeZoneOptions` is why every other money surface takes a `formatDate`
    rather than calling `toLocaleDateString` where it renders: without it a
    date is drawn in whatever zone the browser happens to sit in, so an owner
    in Israel reading on a laptop still set to US time sees the day before on
    every row. Same formatter the orders list builds.
  */
  const formatDate = useCallback(
    (date: string) =>
      new Date(date).toLocaleDateString(
        language === 'he' ? 'he-IL' : language === 'es' ? 'es-ES' : 'en-US',
        timeZoneOptions({ year: 'numeric', month: 'short', day: 'numeric' })
      ),
    [language, timeZoneOptions]
  );

  /*
    ONE QUERY BUILDER, AND THE PAGE WINDOW IS ITS ONLY ARGUMENT.

    The list and the export ask the same question of the same route; only how
    many rows they want differs. Two assemblies is how an export comes to
    disagree with the screen it was taken from — the orders page learned that
    with a file that silently held ten rows of seventy-three.
  */
  const queryFor = useCallback(
    (window: { limit: number; offset: number }) => {
      const { from, to } = windowFor(period);
      const params = new URLSearchParams({
        limit: String(window.limit),
        offset: String(window.offset),
        filter,
        sort: 'date',
        /*
          THE PAGE WINDOW IS CUT PER KIND, OR THE VIEW LIES.

          The route's own warning: with 19 bookings and 3 loose invoices, a
          mixed page 2 holds ten bookings and nothing else, so "invoices
          without an order" renders empty while the pager still offers three
          pages. Asking for the kind that is OPEN is the only arrangement where
          the count, the pages and the rows agree.

          `all` while both doors are shut, which costs nothing: the summary
          figures ignore this parameter by design, and no list is being drawn.
        */
        kind: listOpen === 'orders' ? 'booking' : listOpen === 'loose' ? 'standalone' : 'all',
      });
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (search.trim()) params.set('search', search.trim());
      return params;
    },
    [period, filter, search, listOpen]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const params = queryFor({ limit: PAGE_SIZE, offset: page * PAGE_SIZE });

      const response = await fetch(`/api/payments/money?${params}`, { cache: 'no-store' });
      const body = await response.json();

      if (!body?.success) {
        setFailed(true);
        return;
      }

      setItems(body.data.items ?? []);
      setTotal(body.data.total ?? 0);
      /* Both doors state a count while only ONE list is loaded, so the route
         reports each kind beside the page it was asked for. */
      setKindCounts(body.data.kindCounts ?? { booking: 0, standalone: 0 });
      setTotals(body.data.totals ?? null);
      setTruncated(Boolean(body.data.truncated));
      setPeriodTotals(body.data.periodTotals ?? null);
    } catch {
      /* Soft: a page that shows nothing and says why beats one that throws. */
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [queryFor, page]);

  /*
    The row actions, built from the shared definitions. `refresh` is this
    page's own loader — which is why the builder takes it rather than owning
    one: what needs reloading after a void differs between a page and a drawer.
  */
  /* Through a ref: `load` is rebuilt whenever the query changes, and an action
     set that closed over the first one would refresh the page the reader was
     looking at ten filters ago. */
  const loadRef = useRef(load);
  loadRef.current = load;

  const entryActions = useMemo(
    () => buildEntryActions({ refresh: () => loadRef.current(), t, onRefund: setRefundTarget }),
    [t]
  );

  /* The flag can arrive AFTER mount — the assistant pushes this route with it
     set — so the composer follows the prop rather than only seeding from it.
     The same reason the orders page has this effect. */
  useEffect(() => {
    if (openCreate) setShowInvoice(true);
  }, [openCreate]);

  /* A pick made under one filter cannot be exported from another: carrying it
     across silently is how a reader exports rows they can no longer see. */
  useEffect(() => {
    setSelected(new Set());
  }, [period, filter, search]);

  /* Back to page one whenever the question changes — including which door is
     open. Page 3 of the orders is not page 3 of the loose invoices, and a
     result set that now has one page shows nothing at an offset of twenty. */
  useEffect(() => {
    setPage(0);
  }, [period, filter, search, listOpen]);

  /*
   * ── AND WHEN THE ANSWER SHRINKS UNDER A PAGE THAT IS STILL OPEN ──────────
   *
   * The reset above covers the question CHANGING. It does not cover the result
   * set getting shorter while the question stays the same, and that happens
   * routinely: a refund or a void removes rows and the page reloads itself; an
   * order stops matching the active filter; the data simply moves on.
   *
   * The route slices `sorted.slice(offset, offset + limit)`, so an offset past
   * the end returns an empty array — a perfectly successful response with no
   * rows. The list then empties with nothing to explain it, `failed` is false
   * because nothing failed, and the only way back is a hard reload, because
   * that is the one thing that resets `page`.
   *
   * Reported exactly that way, 2026-11-08: "something is refreshing silently
   * and removes all data, only hard refresh fixes it."
   *
   * Clamping to the last page that exists fixes every cause at once, including
   * the ones nobody has thought of, because it asks about the answer rather
   * than about what might have changed it.
   */
  useEffect(() => {
    const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
    if (page > lastPage) setPage(lastPage);
  }, [total, page]);

  /**
   * EVERY ROW THE FILTER MATCHES, not the thirty on screen.
   *
   * The route already holds the whole filtered set — it slices a page out of
   * it — so this re-asks the same question without the page window. A PICKED
   * set is different and exported as picked: those rows were chosen by hand.
   */
  const exportCsv = useCallback(async () => {
    let chosen: MoneyItem[];

    if (selected.size > 0) {
      chosen = items.filter(i => selected.has(i.key));
    } else {
      setExporting(true);
      try {
        const params = queryFor({ limit: EXPORT_CAP, offset: 0 });
        const response = await fetch(`/api/payments/money?${params}`, { cache: 'no-store' });
        const body = await response.json();
        if (!body?.success) throw new Error(body?.error || 'Failed to load');
        chosen = body.data.items as MoneyItem[];
      } catch {
        /* Said out loud: a download that silently does not happen reads as a
           broken button. */
        setFailed(true);
        return;
      } finally {
        setExporting(false);
      }
    }

    // A file of nothing but column headings is indistinguishable from a failure.
    if (chosen.length === 0) return;

    downloadMoneyCsv(chosen, t, formatDate);
  }, [selected, items, queryFor, t, formatDate]);

  useEffect(() => {
    const id = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(id);
  }, [load, search]);

  /**
   * One formatter, every currency present, never summed.
   *
   * The same rule the orders strip follows and the same reason: no rate in this
   * platform may convert money, so two currencies are two figures.
   */
  /*
    EVERY FIGURE ON THIS PAGE READS FROM ONE SET.

    The period used to move the headline alone, so "collected this month" sat
    beside "cancelled, ever" and the four cards described four different spans
    of time without saying so. They are one summary and they move together.

    `periodTotals` is the same shape as `totals` — the same function over a
    windowed copy of the rows — so this is a swap, not a second code path. Null
    when no window was asked for, which is "all time".
  */
  const shown = periodTotals ?? totals;

  /**
   * One formatter, every currency present, never summed.
   *
   * The same rule the orders strip follows and the same reason: no rate in this
   * platform may convert money, so two currencies are two figures.
   */
  const money = useCallback(
    (pick: (c: { collected: number; outstanding: number; refunded: number; cancelled: number; overdue: number }) => number) => {
      if (!shown) return formatCurrency(0, 'ILS');
      const codes = Object.keys(shown.byCurrency);
      if (codes.length === 0) return formatCurrency(0, 'ILS');
      return codes.map(code => formatCurrency(pick(shown.byCurrency[code]), code)).join('  ·  ');
    },
    [shown, formatCurrency]
  );

  /** The primary currency, for the figures drawn as a single number. */
  const primary = useMemo(() => Object.keys(shown?.byCurrency ?? {})[0] ?? 'ILS', [shown]);
  const asMoney = useCallback((n: number) => formatCurrency(n, primary), [formatCurrency, primary]);

  const collected = shown?.collected ?? 0;
  const outstanding = shown?.outstanding ?? 0;
  const overdue = shown?.overdue ?? 0;
  const notYetDue = Math.max(0, outstanding - overdue);

  /*
   * ── THE FIGURES ARE THE WAY INTO THE ROWS ───────────────────────────────
   *
   * Reading "₪4,500 cancelled" provokes exactly one question — WHICH orders? —
   * and the only way to ask it was to notice the matching chip further down
   * and trust that it meant the same thing. So the bar and its key now select
   * that state directly.
   *
   * The list is OPENED if both doors are shut, because filtering something the
   * reader cannot see does nothing and looks broken: the chips are explicitly
   * scoped "to the list below only", and below there was nothing.
   *
   * `setPage(0)` is not needed here — the effect watching `filter` already
   * does it, which is the same reset that stops a stranded offset showing an
   * empty page.
   */
  const pickState = useCallback(
    (next: typeof filter) => {
      setFilter(next);
      setListOpen(open => open ?? 'orders');
    },
    []
  );
  const refunded = shown?.refunded ?? 0;
  const cancelled = shown?.cancelled ?? 0;

  /*
    THE WHOLE BOOK: every amount that was ever asked for.

    Four states, exhaustive and mutually exclusive, so each one is a quarter of
    this and nothing is counted twice:

      collected   came in and stayed   (already NET of refunds)
      refunded    came in and went back
      outstanding still coming
      cancelled   never coming

    `collected` being net is exactly why `refunded` can be added beside it
    rather than double-counting: the two together are the gross that arrived.

    NOT called revenue. On one real account this is 45,720 of which 17,675 was
    cancelled and 2,925 went back — a business half this size would be claimed
    by that word.
  */
  const everything = collected + refunded + outstanding + cancelled;

  /** What the pager counts. The same expression the three sibling lists use,
      so the four cannot disagree about where the last page is. */
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const periods: { key: PeriodKey; label: string }[] = [
    { key: 'week', label: t('reports.period_week') || 'Week' },
    { key: 'month', label: t('reports.period_month') || 'Month' },
    { key: 'year', label: t('reports.period_year') || 'Year' },
    { key: 'all', label: t('reports.period_all') || 'All time' },
  ];

  /*
    The rows, read in two passes rather than regrouped.

    `kind` is the route's own word for the distinction and the grouping already
    decided it: `booking` is work sold, `standalone` is money with no booking
    behind it. Nothing here re-derives that — a second opinion about what an
    order is would be exactly the drift this page must not introduce.
  */
  /*
    NO CLIENT-SIDE SPLIT ANY MORE.

    This used to filter one mixed response into two lists, which works only
    while every row fits in one response. With a page window it is exactly the
    bug the route warns about — a page of ten bookings leaves the other door's
    list empty while its pager still offers pages. The route is asked for the
    open kind instead, so `items` IS that list, and each door's count comes
    from `kindCounts`, which the route computes before the kind is chosen.
  */

  const chips: { key: typeof filter; label: string; tone?: string }[] = [
    { key: 'all', label: t('money.filter_all') || 'All' },
    { key: 'paid', label: t('payments.collected') || 'Collected', tone: TONE.in },
    { key: 'unpaid', label: t('payments.outstanding') || 'Outstanding', tone: TONE.wait },
    { key: 'overdue', label: t('payments.overdue_total') || 'Overdue', tone: TONE.late },
    /* The route has always answered `filter: 'refunded'` (`item.refunded > 0`);
       nothing here ever asked. So the one state an owner most often wants to
       review was the one state with no way to reach it. */
    { key: 'refunded', label: t('payments.refunded') || 'Refunded', tone: TONE.back },
    { key: 'cancelled', label: t('payments.cancelled_total') || 'Cancelled', tone: TONE.lost },
  ];

  return (
    /*
      `PAGE_CONTAINER` rather than a width of its own: the header and the tab bar
      above this body use the same string, and a page that picks its own number
      makes their edges miss each other. See lib/business-os/pageContainer.ts.
    */
    <div className={`${PAGE_CONTAINER} w-full pb-20 pt-8`}>
      {/* ── the one control that governs the page ───────────────────── */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-4">
        {/*
          The icon and the green the orders page has always used, from the same
          constant, because this page IS that page — a reader who knows where
          their money lives should not have to learn a new mark for it.
        */}
        {/* The title gives up size before the actions beside it give up room:
            at 26px with a 40px mark it took most of a 360px line on its own. */}
        <h1 className="m-0 flex items-center gap-2.5 text-[21px] font-extrabold tracking-tight text-[var(--v2-text-primary)] sm:gap-3 sm:text-[26px]">
          <span
            className="grid h-9 w-9 flex-none place-items-center rounded-lg sm:h-10 sm:w-10"
            style={{ backgroundColor: 'rgba(34, 197, 139, 0.2)' }}
          >
            <Receipt
              className="h-4 w-4 sm:h-5 sm:w-5"
              style={{ color: REPORTS_COLORS.PRIMARY }}
              aria-hidden="true"
            />
          </span>
          {t('money.title') || 'Your money'}
        </h1>

        {/*
          The page's own actions. The PERIOD is no longer here: it governs the
          summary and nothing else on the page, so it now sits on the summary,
          where what it moves is visible as it is moved.
        */}
        <div className="flex flex-wrap items-center gap-2">
        {/*
          The actions, in the order an owner reaches for them: take the money
          out, then put a new bill in.

          Two exports because they answer different questions. This one saves
          WHAT IS ON SCREEN, so an empty view is an empty file. The ledger spans
          its own date range and ignores this page's period, search and filter,
          so it stays available whenever the business has any money at all.
        */}
          <button
            type="button"
            onClick={exportCsv}
            disabled={items.length === 0 || exporting}
            title={items.length === 0 ? t('payments.export.nothing') : undefined}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--v2-border)] bg-[var(--v2-surface)] px-3 py-2 text-[13px] font-semibold text-[var(--v2-text-secondary)] transition-colors hover:text-[var(--v2-text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            {exporting
              ? t('payments.export.working') || 'Working…'
              : selected.size > 0
                ? t('payments.select.export') || 'Export selected'
                : t('payments.export') || 'Export'}
          </button>

          <button
            type="button"
            onClick={() => setShowLedgerExport(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--v2-border)] bg-[var(--v2-surface)] px-3 py-2 text-[13px] font-semibold text-[var(--v2-text-secondary)] transition-colors hover:text-[var(--v2-text-primary)]"
            title={t('ledger.export_title')}
          >
            <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
            <span className="hidden lg:inline">{t('ledger.export_title')}</span>
          </button>

          <button
            type="button"
            onClick={() => setShowInvoice(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[#2DD4A7] bg-[rgba(45,212,167,.12)] px-3.5 py-2 text-[13px] font-semibold text-[#2DD4A7] transition-colors hover:bg-[rgba(45,212,167,.2)]"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('payments.create_invoice')}
          </button>
        </div>
      </div>

      <p className="mb-7 text-[13.5px] leading-relaxed text-[var(--v2-text-muted)]">
        {t('money.scope') ||
          'The figures below describe the selected period. What is owed to you is always as of today.'}
      </p>

      {failed && (
        <div className="mb-4 rounded-2xl border border-[var(--v2-border)] bg-[var(--v2-surface)] p-6 text-[14px] text-[var(--v2-text-secondary)]">
          {t('money.failed') || 'Could not load your money right now. Please try again.'}
        </div>
      )}

      {/*
        ── THE SUMMARY, IN ONE FRAME ────────────────────────────────────

        The four cards are one statement about one window, so they are drawn
        inside one card. Loose on the page they read as four separate facts
        that happen to be adjacent, and the period control had nowhere to
        belong: up in the header it governed something a screen away.

        Here it sits on the frame it governs, at its top outer corner — left in
        Hebrew, right in English — so what it moves is under it as it moves.
      */}
      <section className="mb-4 rounded-[22px] border border-[var(--v2-border)] bg-[var(--v2-bg)] p-3 sm:p-4">
        {/*
          Four windows in a pill. On a 360px screen "All time" spelled out in
          any language pushed the group past the width, so the buttons give up
          padding first and the group scrolls as a last resort rather than
          stretching the card it sits on.
        */}
        <div className="mb-3 flex items-center justify-end px-1">
          <div
            role="group"
            aria-label={t('reports.period_label') || 'Reporting period'}
            className="flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full border border-[var(--v2-border)] bg-[var(--v2-surface)] p-1"
          >
            {periods.map(p => (
              <button
                key={p.key}
                type="button"
                aria-pressed={period === p.key}
                onClick={() => setPeriod(p.key)}
                className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition-colors sm:px-4 sm:text-[13px] ${
                  period === p.key
                    ? 'bg-[var(--v2-surface-hover)] text-[var(--v2-text-primary)]'
                    : 'text-[var(--v2-text-muted)] hover:text-[var(--v2-text-secondary)]'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

      {/*
        ── THE FIGURES BELOW ARE INCOMPLETE, AND SAY SO ──────────────────────

        Above the first figure, not beside the list: what a short read breaks
        is the TOTALS. A reader who scrolls to the rows has already believed
        the number at the top.

        Loud on purpose. Every other empty or partial state on this page is
        phrased gently because it is ordinary — a filter matching nothing, a
        quiet month. This one is not ordinary: it means the sums are wrong, and
        the owner cannot tell by looking.
      */}
      {truncated && (
        <div
          role="alert"
          className="mb-3.5 rounded-[14px] border px-4 py-3 text-[13px] leading-relaxed"
          style={{ borderColor: `${TONE.late}66`, background: chipGround(TONE.late) }}
        >
          <b className="font-bold text-[var(--v2-text-primary)]">
            {t('money.partial_title') || 'These figures are incomplete'}
          </b>{' '}
          <span className="text-[var(--v2-text-muted)]">
            {t('money.partial_note') ||
              'There is more money in this period than this page can read at once, so every total below is lower than the truth. Narrow the period to see a complete picture of a smaller span.'}
          </span>
        </div>
      )}

      {/* ── act 1: what is actually yours ───────────────────────────── */}
      <section className="mb-3.5 rounded-[20px] border border-[var(--v2-border)] bg-[var(--v2-surface)] p-5 sm:p-7">
        <p className="m-0 mb-1.5 text-[13px] text-[var(--v2-text-muted)]">
          {t('money.came_in') || 'Actually came in'}
        </p>
        <p className="m-0 text-[52px] font-extrabold leading-none tracking-tight text-[var(--v2-text-primary)] max-sm:text-[40px]">
          {loading ? '—' : asMoney(collected)}
        </p>
        {/*
          AGAINST THE SAME TOTAL THE BAR DRAWS.

          This read "out of {collected + owed}", which was a THIRD total on a
          card that now states one: with the bar spanning the whole book, the
          sentence said 21,520 out of 25,120 (86%) above a green band filling
          47% of the width. Two true figures that contradict each other on
          sight, which is worse than either being wrong.
        */}
        <p className="m-0 mt-2.5 text-[13.5px] leading-relaxed text-[var(--v2-text-muted)]">
          {(t('money.of_book') || 'out of {total} ever asked for').replace('{total}', asMoney(everything))}
        </p>

        {/*
          THE BAR, AND NOW THE WHOLE BOOK.

          ───────────────────────────────────────────────────────────────────
          It used to draw collected and owed only, and the two figures that
          fell out — refunded and cancelled — sat in a card below with nothing
          to measure them against. So the obvious question had no answer on
          screen: "are those part of the total, and WHICH total?"

          Every shekel is in exactly one of four states, and they are
          exhaustive, so drawing all four gives the page one total that
          everything belongs to:

            came in and stayed   ·  came in and went back
            still coming         ·  never coming

          The late part still sits INSIDE the owed part rather than beside it,
          so "do these add up" cannot be asked of that pair either.

          The key leads with the TOTAL, because that is the number the other
          four are answering a question about.
          ───────────────────────────────────────────────────────────────────
        */}
        {everything > 0 && (
          <>
            <div
              className="mt-5 flex h-10 gap-0.5 overflow-hidden rounded-[10px] bg-[var(--v2-border)]"
              role="group"
              aria-label={`${asMoney(everything)} ${t('money.everything') || 'billed in total'}: ${asMoney(collected)} ${t('payments.collected') || 'collected'}, ${asMoney(outstanding)} ${t('payments.outstanding') || 'outstanding'}, ${asMoney(refunded)} ${t('payments.refunded') || 'refunded'}, ${asMoney(cancelled)} ${t('payments.cancelled_total') || 'cancelled'}`}
            >
              {/*
                `minWidth` on every band, because a band that rounds to nothing
                is a lie by omission. ₪800 of ₪45,720 is 1.7% — four pixels on
                a phone, and less once four bands share the gaps. The figure is
                real and the key names it, so the bar must show SOMETHING for
                it. 3px distorts the proportions by less than a hair at this
                width and is the difference between "small" and "absent".
              */}
              {collected > 0 && (
                <Band
                  tone={TONE.in}
                  amount={collected}
                  title={`${asMoney(collected)} ${t('payments.collected') || 'Collected'}`}
                  onPick={() => pickState('paid')}
                />
              )}
              {outstanding > 0 && (
                <span className="flex min-w-0 gap-0.5" style={{ flex: outstanding }}>
                  {notYetDue > 0 && (
                    <Band
                      tone={TONE.wait}
                      amount={notYetDue}
                      title={`${asMoney(notYetDue)} ${t('payments.outstanding') || 'Outstanding'}`}
                      onPick={() => pickState('unpaid')}
                    />
                  )}
                  {overdue > 0 && (
                    <Band
                      tone={TONE.late}
                      amount={overdue}
                      title={`${asMoney(overdue)} ${t('payments.overdue_total') || 'Overdue'}`}
                      onPick={() => pickState('overdue')}
                    />
                  )}
                </span>
              )}
              {/* Money that came in and went back. Its own band rather than a
                  gap in the green, because it DID arrive and the business did
                  the work. */}
              {refunded > 0 && (
                <Band
                  tone={TONE.back}
                  amount={refunded}
                  title={`${asMoney(refunded)} ${t('payments.refunded') || 'Refunded'}`}
                  onPick={() => pickState('refunded')}
                />
              )}
              {cancelled > 0 && (
                <Band
                  tone={TONE.lost}
                  amount={cancelled}
                  title={`${asMoney(cancelled)} ${t('payments.cancelled_total') || 'Cancelled'}`}
                  onPick={() => pickState('cancelled')}
                />
              )}
            </div>

            <div className="mt-3.5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]">
              <span className="inline-flex items-center gap-2 text-[var(--v2-text-muted)]">
                {t('money.everything') || 'Billed in total'}
                <b className="font-extrabold text-[var(--v2-text-primary)]">{asMoney(everything)}</b>
              </span>
              {/* Separates the total from its parts. Hidden once the row wraps,
                  where a rule between lines 1 and 2 divides nothing. */}
              <span className="hidden h-3.5 w-px bg-[var(--v2-border)] sm:block" aria-hidden="true" />
              <Key
                tone={TONE.in}
                label={t('payments.collected') || 'Collected'}
                value={asMoney(collected)}
                onPick={() => pickState('paid')}
                picked={filter === 'paid'}
              />
              <Key
                tone={TONE.wait}
                label={t('payments.outstanding') || 'Still owed'}
                value={asMoney(outstanding)}
                onPick={() => pickState('unpaid')}
                picked={filter === 'unpaid'}
              />
              {overdue > 0 && (
                <Key
                  tone={TONE.late}
                  label={t('money.of_which_late') || 'of which late'}
                  value={asMoney(overdue)}
                  onPick={() => pickState('overdue')}
                  picked={filter === 'overdue'}
                />
              )}
              {refunded > 0 && (
                <Key
                  tone={TONE.back}
                  label={t('payments.refunded') || 'Refunded'}
                  value={asMoney(refunded)}
                  onPick={() => pickState('refunded')}
                  picked={filter === 'refunded'}
                />
              )}
              {cancelled > 0 && (
                <Key
                  tone={TONE.lost}
                  label={t('payments.cancelled_total') || 'Cancelled'}
                  value={asMoney(cancelled)}
                  onPick={() => pickState('cancelled')}
                  picked={filter === 'cancelled'}
                />
              )}
            </div>

            <p className="mt-3 border-t border-[var(--v2-border)] pt-3 text-[13px] leading-relaxed text-[var(--v2-text-muted)]">
              {t('money.whole_book_note') ||
                'Every amount you were ever owed is in one of these four, and in only one of them. The red sits inside the yellow because money that is late is money you are owed, counted once.'}
            </p>
          </>
        )}

        {/*
          The way from the figure to the rows behind it.

          On the headline card rather than only above the list, because this is
          where the reader is when the question occurs to them: they have just
          read what came in, and the next thing they want is what made it up.

          At the card's BOTTOM OUTER corner — left in Hebrew, right in English,
          which is the same edge stated twice: the end of the line. It reads
          after the figure and the bar, which is the order the question arrives
          in, and it is the last thing in the card so nothing follows it.
        */}
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={() => {
              setListOpen('orders');
              document.getElementById('money-lists')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--v2-border)] bg-[var(--v2-surface-hover)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--v2-text-primary)] transition-colors hover:border-[#2DD4A7]"
          >
            {t('money.see_orders') || 'See the orders behind this'}
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </section>

      {/* ── act 2: what is still coming ─────────────────────────────── */}
      <div className="mb-3.5 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        <section
          className="rounded-2xl border p-5"
          style={{
            /* Mixed from the state's own colour rather than from the page's
               retired private red, which these two kept long after the palette
               moved to the shared map. */
            borderColor: overdue > 0 ? `${TONE.late}73` : 'var(--v2-border)',
            background:
              overdue > 0
                ? `linear-gradient(180deg, ${TONE.late}14, transparent 70%)`
                : 'var(--v2-surface)',
          }}
        >
          <p className="m-0 mb-2 flex items-center gap-2 text-[13px] text-[var(--v2-text-muted)]">
            <i className="h-2.5 w-2.5 flex-none rounded-[3px]" style={{ background: TONE.late }} />
            {t('money.needs_you') || 'Needs chasing'}
          </p>
          <p
            className="m-0 text-[30px] font-extrabold tracking-tight"
            style={{ color: overdue > 0 ? TONE.late : 'var(--v2-text-primary)' }}
          >
            {asMoney(overdue)}
          </p>
          <p className="m-0 mt-2 text-[13px] leading-relaxed text-[var(--v2-text-muted)]">
            {t('money.late_note') || 'Past its due date. Already counted in what you are owed, above.'}
          </p>
        </section>

        <section className="rounded-2xl border border-[var(--v2-border)] bg-[var(--v2-surface)] p-5">
          <p className="m-0 mb-2 flex items-center gap-2 text-[13px] text-[var(--v2-text-muted)]">
            <i className="h-2.5 w-2.5 flex-none rounded-[3px]" style={{ background: TONE.wait }} />
            {t('money.not_due_yet') || 'Not due yet'}
          </p>
          <p className="m-0 text-[30px] font-extrabold tracking-tight text-[var(--v2-text-primary)]">
            {asMoney(notYetDue)}
          </p>
          <p className="m-0 mt-2 text-[13px] leading-relaxed text-[var(--v2-text-muted)]">
            {t('money.not_due_note') || 'Agreed, with the date still ahead. Nothing to do about it today.'}
          </p>
        </section>
      </div>

      {/* ── act 3: what fell through ────────────────────────────────── */}
      {(shown?.cancelled ?? 0) + (shown?.refunded ?? 0) > 0 && (
        <section className="mb-8 rounded-2xl border border-[var(--v2-border)] bg-[var(--v2-surface)] px-5 py-4">
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <h2 className="m-0 text-[15px] font-bold text-[var(--v2-text-primary)]">
              {t('money.fell_through') || 'What will not arrive'}
            </h2>
            {/* The INK for this state, not its fill. `TONE.lost` is a sand
                chosen to be told apart as a bar segment; as a bold figure on a
                pale surface it washes out. The dots in this card keep the
                fill. */}
            <span className="text-[14px] font-bold" style={{ color: INK.lost }}>
              {asMoney((shown?.cancelled ?? 0) + (shown?.refunded ?? 0))}
            </span>
          </div>
          {/*
            EACH FIGURE STATES ITS OWN RELATIONSHIP TO THE CARD ABOVE.

            "Is this part of the total, and which total?" is the question this
            card provokes, and the two halves have DIFFERENT answers — which is
            why one shared sentence underneath could never settle it:

              cancelled  is in none of the figures above. Not collected, not
                         owed, not the value of the work sold.
              refunded   is ALREADY SUBTRACTED from what came in. Taking it off
                         again deducts the same money twice.

            So each carries its own line, the same device the chasing card uses
            when it says "already counted in what you are owed, above".
          */}
          <div className="mt-3.5 flex flex-wrap gap-x-7 gap-y-4 text-[13.5px] text-[var(--v2-text-muted)]">
            <div className="max-w-[240px]">
              {t('payments.cancelled_total') || 'Cancelled'}
              <b className="mt-0.5 block text-[19px] font-extrabold text-[var(--v2-text-primary)]">
                {money(c => c.cancelled)}
              </b>
              <span className="mt-1 block text-[12px] leading-snug text-[var(--v2-text-muted)]">
                {t('money.cancelled_note') || 'In none of the figures above.'}
              </span>
            </div>
            <div className="max-w-[240px]">
              {t('payments.refunded') || 'Refunded'}
              <b className="mt-0.5 block text-[19px] font-extrabold text-[var(--v2-text-primary)]">
                {money(c => c.refunded)}
              </b>
              <span className="mt-1 block text-[12px] leading-snug text-[var(--v2-text-muted)]">
                {t('money.refunded_note') || 'Already taken off what came in.'}
              </span>
            </div>
          </div>
          <p className="m-0 mt-3.5 text-[12.5px] leading-relaxed text-[var(--v2-text-muted)]">
            {t('money.fell_through_note') ||
              'Neither is part of what your orders are worth: one never arrived, the other went back out.'}
          </p>
        </section>
      )}
      </section>

      {/*
        ── THE TWO LISTS, BEHIND TWO DOORS ──────────────────────────────

        The lists used to sit open, one under the other, and the page became a
        scroll with the story at the top and everything else below it. Two
        things went wrong with that. The summary — which is the point of the
        page — stopped being the whole screen. And the loose invoices, being
        second, were reachable only by scrolling past every order, so the
        shorter list was the harder one to find.

        So neither is open until it is asked for, and both are asked for from
        the same row, at the same distance from the top. A door states its
        count, so what is behind it is known before it is opened.
      */}
      <div id="money-lists" className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <ListDoor
          title={t('payments.view.orders') || 'Orders'}
          blurb={t('money.orders_door') || 'Work you sold, and the money against it'}
          count={kindCounts.booking}
          tone={TONE.in}
          open={listOpen === 'orders'}
          onToggle={() => setListOpen(listOpen === 'orders' ? null : 'orders')}
        />
        <ListDoor
          title={t('payments.view.standalone') || 'Invoices without an order'}
          blurb={
            t('money.loose_door') || 'Bills raised on their own, with no booking behind them'
          }
          count={kindCounts.standalone}
          tone={TONE.wait}
          open={listOpen === 'loose'}
          onToggle={() => setListOpen(listOpen === 'loose' ? null : 'loose')}
        />
      </div>

      {listOpen && (
        <div className="mt-4">
          {/*
            The search and the filter belong to the open list, so they appear
            with it — and they are ONE bar, because they narrow the same rows.
            On their own lines they read as two unrelated controls and the
            reader has to work out that both apply.

            The box takes the far edge (`ms-auto`): left in Hebrew, right in
            English, which is the same instruction written once.
          */}
          <div className="mb-1 flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--v2-border)] bg-[var(--v2-surface)] px-3.5 py-3">
            <span className="me-1 text-[12.5px] text-[var(--v2-text-muted)]">
              {t('money.chips_scope') || 'Filters the list below only:'}
            </span>
            {chips.map(chip => (
              <button
                key={chip.key}
                type="button"
                aria-pressed={filter === chip.key}
                onClick={() => setFilter(chip.key)}
                className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${
                  filter === chip.key
                    ? 'border-[#2DD4A7] bg-[rgba(45,212,167,.14)] text-[var(--v2-text-primary)]'
                    : 'border-transparent bg-[var(--v2-surface-hover)] text-[var(--v2-text-muted)]'
                }`}
              >
                {chip.tone && <i className="h-2 w-2 flex-none rounded-sm" style={{ background: chip.tone }} />}
                {chip.label}
              </button>
            ))}

            <div className="ms-auto min-w-[220px] max-w-[380px] flex-1">
              <MoneySearchField
                value={search}
                onChange={setSearch}
                today={today}
                language={language}
                t={t}
                placeholder={t('money.search_placeholder') || 'Search a client, invoice or amount'}
              />
            </div>
          </div>
          <p className="mb-5 text-[12.5px] leading-relaxed text-[var(--v2-text-muted)]">
            {t('money.chips_note') ||
              'The figures above do not move when you filter, so there is always something to compare against. Search does narrow them, because then you are asking about one client.'}
          </p>

          {loading ? (
            <div className="rounded-2xl border border-[var(--v2-border)] bg-[var(--v2-surface)] p-8 text-center text-[14px] text-[var(--v2-text-muted)]">
              {t('common.loading') || 'Loading…'}
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-2xl border border-[var(--v2-border)] bg-[var(--v2-surface)] p-8 text-center text-[14px] text-[var(--v2-text-muted)]">
              {t('money.nothing_here') || 'Nothing here for this period.'}
            </div>
          ) : (
            <Section
              items={items}
              note={
                listOpen === 'loose'
                  ? t('money.loose_note') ||
                    'Money with no booking behind it: a bill raised on its own, or a sale that never became an appointment. It is yours just the same.'
                  : undefined
              }
              open={open}
              setOpen={setOpen}
              selected={selected}
              setSelected={setSelected}
              onOpenDetail={setDetail}
              onOpenBooking={openBooking}
              formatCurrency={formatCurrency}
              formatDate={formatDate}
              t={t}
            />
          )}

          {/*
            THE PAGER, AND IT SAYS WHERE YOU ARE.

            "1-10 of 73" rather than bare arrows, because the count is the
            answer to a question the door already raised: the door says 73 and
            this says which ten of them are on screen. Hidden when everything
            fits, where a pager is furniture that teaches nothing.

            The window is cut per kind by the route, so these numbers describe
            the open list and nothing else.
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
                     * clamped to the start near the start, to the end near the
                     * end, centred in between. Copied from the siblings so the
                     * four pagers behave identically, not only look alike.
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

          <p className="mt-5 text-[12.5px] leading-relaxed text-[var(--v2-text-muted)]">
            {t('money.row_key') ||
              'Each row is one piece of work and all the money attached to it. A package of three sessions is one row that opens to three payments, not three rows.'}
          </p>
        </div>
      )}

      <MoneyOrderDrawer
        item={detail}
        onClose={() => setDetail(null)}
        onOpenBooking={openBooking}
        onOpenContact={openContact}
        formatCurrency={formatCurrency}
        formatDate={formatDate}
        t={t}
        isRTL={isRTL}
        {...entryActions}
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
            /* The figures above move with it: a refund changes what came in,
               and leaving the summary stale would have the page disagree with
               its own list. */
            void load();
          }}
          onError={() => setFailed(true)}
        />
      )}

      <LedgerExportModal isOpen={showLedgerExport} onClose={() => setShowLedgerExport(false)} />
      <InvoiceModal
        isOpen={showInvoice}
        onClose={() => setShowInvoice(false)}
        onSave={() => {
          setShowInvoice(false);
          /* The new bill is money on this page, so the figures above must move
             with it rather than wait for a reload. */
          void load();
        }}
      />
    </div>
  );
}

/**
 * A closed list, stating what is behind it.
 *
 * The count and the tone bar do the work: a reader deciding whether to open
 * this should not have to open it to find out whether it is worth opening.
 */
function ListDoor({
  title,
  blurb,
  count,
  tone,
  open,
  onToggle,
}: {
  title: string;
  blurb: string;
  count: number;
  tone: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      // Empty is not disabled: "0 invoices without an order" is an answer, and
      // a door that cannot be opened leaves the reader wondering what is in it.
      className="flex w-full items-center gap-3.5 rounded-2xl border bg-[var(--v2-surface)] p-4 text-start transition-colors hover:bg-[rgba(255,255,255,.025)]"
      style={{ borderColor: open ? '#3B4A63' : 'var(--v2-border)' }}
    >
      <span className="h-9 w-1 flex-none rounded-full" style={{ background: tone }} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <b className="text-[15px] font-bold text-[var(--v2-text-primary)]">{title}</b>
          <span className="rounded-full bg-[var(--v2-surface-hover)] px-2 py-0.5 text-[12px] font-semibold text-[var(--v2-text-muted)]">
            {count}
          </span>
        </span>
        <span className="mt-0.5 block text-[12.5px] text-[var(--v2-text-muted)]">{blurb}</span>
      </span>
      <ChevronDown
        className={`h-4 w-4 flex-none text-[var(--v2-text-muted)] transition-transform ${open ? 'rotate-180' : ''}`}
        aria-hidden="true"
      />
    </button>
  );
}

/**
 * One headed run of rows.
 *
 * A component rather than a repeated block, so the two sections cannot drift
 * into rendering a row differently from each other.
 */
function Section({
  title,
  note,
  count,
  items,
  open,
  setOpen,
  selected,
  setSelected,
  onOpenDetail,
  onOpenBooking,
  formatCurrency,
  formatDate,
  t,
  setApart = false,
}: {
  /** Optional: the door above the list already names it and counts it. */
  title?: string;
  note?: string;
  count?: number;
  items: MoneyItem[];
  open: string | null;
  setOpen: (key: string | null) => void;
  selected: Set<string>;
  setSelected: (next: Set<string>) => void;
  /** Hand a row up to the page, which owns the drawer. */
  onOpenDetail: (item: MoneyItem) => void;
  /** Hand a row up to the page, which owns the route to the booking. */
  onOpenBooking: (item: MoneyItem) => void;
  formatCurrency: (amount: number, currency: string) => string;
  /** The business's clock, built once by the page. See its definition. */
  formatDate: (date: string) => string;
  t: (key: string) => string;
  setApart?: boolean;
}) {
  const allPicked = items.every(i => selected.has(i.key));

  /** Pick or drop this whole section, which is the only bulk gesture here. */
  const toggleAll = () => {
    const next = new Set(selected);
    for (const item of items) {
      if (allPicked) next.delete(item.key);
      else next.add(item.key);
    }
    setSelected(next);
  };

  return (
    <section className={setApart ? 'mt-9 border-t border-[var(--v2-border)] pt-7' : ''}>
      {/*
        The pick control leads the row — the inline-START edge, so right in
        Hebrew and left in English. It is a mode the reader turns on before
        working down the list, so it belongs where the list begins rather than
        across the gutter from it.
      */}
      <div className="mb-2 flex flex-wrap items-baseline gap-3">
        <button
          type="button"
          onClick={toggleAll}
          className="bg-transparent text-[12.5px] font-semibold text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]"
        >
          {allPicked
            ? t('payments.select.none') || 'Clear selection'
            : t('money.select_many') || 'Select several'}
        </button>
        {title && (
          <h3 className="m-0 ms-auto flex items-baseline gap-2 text-[15px] font-bold text-[var(--v2-text-primary)]">
            {title}
            <span className="rounded-full bg-[var(--v2-surface-hover)] px-2 py-0.5 text-[12px] font-semibold text-[var(--v2-text-muted)]">
              {count}
            </span>
          </h3>
        )}
      </div>

      {note && (
        <p className="mb-3 text-[12.5px] leading-relaxed text-[var(--v2-text-muted)]">{note}</p>
      )}

      <ul
        className={`m-0 flex list-none flex-col gap-2 p-0 ${
          setApart
            ? 'rounded-2xl border border-dashed border-[var(--v2-border)] bg-[var(--v2-bg)] p-3'
            : ''
        }`}
      >
        {items.map(item => (
          <OrderCard
            key={item.key}
            item={item}
            open={open === item.key}
            onToggle={() => setOpen(open === item.key ? null : item.key)}
            onOpenDetail={() => onOpenDetail(item)}
            onOpenBooking={() => onOpenBooking(item)}
            picked={selected.has(item.key)}
            onPick={() => {
              const next = new Set(selected);
              if (next.has(item.key)) next.delete(item.key);
              else next.add(item.key);
              setSelected(next);
            }}
            formatCurrency={formatCurrency}
            formatDate={formatDate}
            t={t}
          />
        ))}
      </ul>
    </section>
  );
}

/** One figure in the bar's key. */
/**
 * One state in the key, and the way into the rows behind it.
 *
 * A legend entry names a figure the reader has just been told is part of a
 * total; the next question is always which orders make it up. Given `onPick`
 * it becomes the control that answers, and without one it stays a label — the
 * strip is drawn in places that have no list to filter.
 */
function Key({
  tone,
  label,
  value,
  onPick,
  picked,
}: {
  tone: string;
  label: string;
  value: string;
  onPick?: () => void;
  picked?: boolean;
}) {
  const body = (
    <>
      <i className="h-2.5 w-2.5 flex-none rounded-[3px]" style={{ background: tone }} />
      {label}
      <b className="font-bold text-[var(--v2-text-primary)]">{value}</b>
    </>
  );

  if (!onPick) {
    return (
      <span className="inline-flex items-center gap-2 text-[var(--v2-text-muted)]">{body}</span>
    );
  }

  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={picked}
      className={`inline-flex items-center gap-2 rounded-full px-2 py-1 transition-colors ${
        picked ? 'text-[var(--v2-text-primary)]' : 'text-[var(--v2-text-muted)]'
      } hover:bg-[var(--v2-surface-hover)]`}
      style={picked ? { background: chipGround(tone) } : undefined}
    >
      {body}
    </button>
  );
}

/**
 * One band of the bar, as the way into the orders it is made of.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The bar states a proportion, and the question it provokes is "which orders
 * are that?" — so each band answers it rather than leaving the reader to find
 * the matching chip and trust that it means the same thing.
 *
 * `moneyStatusTone`'s own header records what makes this dangerous when the
 * two disagree: "the strip is also the filter: clicking its orange 'due' cell
 * returned rows badged blue, which defeats the one thing a coloured filter is
 * for." Both ends now read the same map, so a band and the chip it selects are
 * the same colour by construction.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function Band({
  tone,
  amount,
  title,
  onPick,
}: {
  tone: string;
  amount: number;
  title: string;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      title={title}
      aria-label={title}
      className="group relative min-w-[3px] cursor-pointer border-0 p-0 transition-opacity hover:opacity-80"
      style={{ flex: amount, background: tone }}
    />
  );
}

/**
 * One order, closed to four facts and opened to the money inside it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE CONTROL, NOT THREE.
 *
 * The orders row offers a caret for the breakdown, the client's NAME for the
 * CRM, and the row itself for a drawer — three affordances an owner has to
 * learn by accident, and its own comment admits the row holds "more than a list
 * row should ever try to hold".
 *
 * Here the whole head is the control, and the two destinations become labelled
 * buttons inside, where they can say what they do. The drawer is not replaced:
 * the payments were the reason to open it and they are here, so what remains
 * behind "open the order" is the processor reference and the full history.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function OrderCard({
  item,
  open,
  onToggle,
  onOpenDetail,
  onOpenBooking,
  picked,
  onPick,
  formatCurrency,
  formatDate,
  t,
}: {
  item: MoneyItem;
  open: boolean;
  onToggle: () => void;
  /** Open this row in the drawer. */
  onOpenDetail: () => void;
  /** Open the booking in the CRM drawer, expanded. */
  onOpenBooking: () => void;
  /** Chosen for an export of exactly the picked rows. */
  picked: boolean;
  onPick: () => void;
  formatCurrency: (amount: number, currency: string) => string;
  formatDate: (date: string) => string;
  t: (key: string) => string;
}) {
  const flow = itemFlow(item);
  const waiting = Math.max(0, flow.outstanding - flow.overdue);
  /*
   * REFUNDED IS PART OF THE WHOLE, AND LEAVING IT OUT BROKE THE BAR.
   *
   * `flow.collected` is NET of refunds, so money that came in and went back out
   * is in none of the other three. The bar therefore spanned less than the
   * figure printed above it: a $444.02 order drew a bar worth $333.03 and said
   * nothing about the $110.99 that moved. The summary strip has always summed
   * all four (`everything`); the row summed three.
   *
   * With refunded included this equals `item.amount` again, which is the
   * property the headline and the bar have to share to be read together.
   */
  const whole = flow.collected + flow.refunded + flow.outstanding + flow.cancelled;

  const amount = formatCurrency(item.amount, item.currency);

  /**
   * What this row is, in one line a reader can act on.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * ORDERED BY WHAT IS STILL OWED, NOT BY WHAT WENT WRONG.
   *
   * This asked `cancelled > 0 && collected === 0` SECOND, before it ever looked
   * at what was outstanding, and both halves were satisfied by accident:
   *
   *   `cancelled > 0`     is true if ANY ONE period is cancelled, so a single
   *                       dead milestone spoke for the whole order.
   *   `collected === 0`   was the safeguard, meant to say "nothing ever came
   *                       in". But `collected` is NET of refunds, so money that
   *                       came in and went back produces the same zero. The one
   *                       guard against this mistake is what let it through.
   *
   * Live case 2026-11-08, booking da424f7c: a CONFIRMED booking on an ACCEPTED
   * $333 quote, one of four milestones cancelled and the first refunded, read
   * "Cancelled" with $222.01 still to collect. Nothing on that order was
   * cancelled above the line, and the page said the job was dead while its own
   * Collected filter still listed it (`item.status` is `refunded`).
   *
   * So: anything still owed outranks anything already finished, and `refunded`
   * gets its own answer instead of impersonating "nothing arrived".
   *
   * Each line now carries ITS OWN FIGURE. The amount on the right stays the
   * order's face value — it has to, or the header stops matching the rows
   * beneath it and the number moves every time a filter is clicked — so this is
   * where a reader is told how much is actually collected, owed or returned.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const state = (() => {
    const money = (value: number) => formatCurrency(value, item.currency);

    /*
     * ───────────────────────────────────────────────────────────────────────
     * THE FIGURE ON THE CARD IS THE ORDER'S FACE VALUE, AND THIS LINE IS WHAT
     * EXPLAINS IT.
     *
     * The amount on the right is everything this order was ever billed for. It
     * is deliberately NOT "what you collected": it must not move when a filter
     * is clicked, or the header stops matching the rows beneath it and the
     * number changes meaning depending on where you came from.
     *
     * But a bare total answers nothing on its own. "$60.00" over a plan that
     * took one payment and is late on the other says neither of those things,
     * and this line used to name just ONE part of it — "$30.00 Overdue" beside
     * a $60 figure, with the other $30 unexplained. Asked three times what the
     * number meant, 2026-11-08, which is the real answer: it was unexplainable.
     *
     * So every part that exists is named, and they ADD UP to the figure above:
     *
     *     overdue + waiting + collected + refunded + never collected
     *
     * `waiting` is outstanding MINUS overdue, because overdue is a subset of
     * outstanding rather than a rival to it — `MoneyCurrencyTotals.overdue`
     * documents exactly this, and adding both would double-count every late
     * payment and overshoot the total.
     *
     * Ordered by what the owner can act on: chase, then wait, then what is
     * already settled. The tone follows the leading part, so the dot still
     * says at a glance what this row most needs.
     * ───────────────────────────────────────────────────────────────────────
     */
    const waiting = Math.max(0, flow.outstanding - flow.overdue);

    const parts: Array<{ tone: string; amount: number; label: string }> = [
      { tone: TONE.late, amount: flow.overdue, label: t('payments.overdue_total') || 'Overdue' },
      { tone: TONE.wait, amount: waiting, label: t('payments.awaiting_collection') || 'Still to collect' },
      { tone: TONE.in, amount: flow.collected, label: t('payments.paid_one') || 'Paid' },
      { tone: TONE.back, amount: flow.refunded, label: t('payments.refunded') || 'Refunded' },
      { tone: TONE.lost, amount: flow.cancelled, label: t('money.never_collected') || 'never collected' },
    ].filter(part => part.amount > 0);

    /*
     * The job itself was called off, which no amount can say: a cancelled
     * booking whose payment settled and came back has its money in `refunded`,
     * never in `cancelled`. It leads, and the money still follows it.
     */
    const off = item.bookingCancelled ? (t('payments.cancelled_total') || 'Cancelled') : null;

    if (parts.length === 0) {
      return off
        ? { tone: TONE.lost, text: off }
        : { tone: TONE.in, text: t('payments.paid_one') || 'Paid' };
    }

    /* The first keeps its capital; the rest read as a list under it. */
    const said = parts
      .map((part, index) =>
        index === 0 && !off
          ? `${money(part.amount)} ${part.label}`
          : `${money(part.amount)} ${part.label.toLowerCase()}`
      )
      .join(' · ');

    return {
      tone: off ? TONE.lost : parts[0].tone,
      text: off ? `${off} · ${said}` : said,
    };
  })();

  /*
    WHAT THIS ROW IS CALLED, AND WHY IT IS NEVER SAID TWICE.

    The two lines in the header answer different questions: who this money is
    from, and what it was for. When a row has no contact — every plan
    instalment the processor wrote without one — both fell back to `item.title`
    and the card printed the same string twice, one bold and one grey.

    So the name leads when there is one, the description sits under it, and a
    row with only a description shows it once.
  */
  const lone = item.entries.length === 1 ? item.entries[0] : null;
  const described = (lone && planPeriodText(lone, t)) || item.title;
  const lead = item.contactName || described;
  const under = item.contactName ? described : null;

  /*
    WHAT NESTS INSIDE THE ROW.

    A plan's SCHEDULE, when there is one, not the entries. The two are not the
    same list: a three-instalment plan that has been paid once has three
    periods and one entry, so showing entries made a package of three look like
    a single payment and put the other two nowhere. The schedule is what the
    orders page and the drawer both show for the same reason.

    Entries otherwise — money that settled no plan is only ever itself.
  */
  const nested = scheduleOf(item, t);

  return (
    <li
      className="overflow-hidden rounded-2xl border bg-[var(--v2-surface)]"
      style={{
        borderColor: open ? '#3B4A63' : 'var(--v2-border)',
        /* Dimmed when the order is FINISHED, not when one period of it died.
           This shared the faulty test above, so the same refund that mislabelled
           a live order also greyed it out — it read as dead at a glance, before
           the words were even looked at. Anything still to collect is live. */
        opacity: flow.outstanding === 0 && flow.collected === 0 ? 0.72 : 1,
      }}
    >
      {/*
        The picker sits OUTSIDE the toggle, not inside it. A checkbox nested in
        a button is invalid markup and, worse, a click on it would open the row
        as well as pick it — so picking five rows for an export would leave five
        rows expanded.

        THE HOVER BELONGS TO THIS ROW, NOT TO THE BUTTON INSIDE IT.

        It used to sit on the toggle alone, and the checkbox is its sibling —
        so hovering lit the row everywhere except the strip under the checkbox,
        which stayed the base colour and read as a seam down the edge of every
        card. One element wraps both, so one tint covers both.
      */}
      <div className="flex items-start transition-colors hover:bg-[rgba(255,255,255,.025)]">
        <label className="flex cursor-pointer items-center self-stretch ps-4 pt-4">
          <input
            type="checkbox"
            checked={picked}
            onChange={onPick}
            aria-label={`${t('payments.select.chosen') || 'selected'}: ${item.contactName || item.title}`}
            className="h-4 w-4 cursor-pointer accent-[#2DD4A7]"
          />
        </label>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-start gap-3 bg-transparent p-4 text-start"
      >
        <ChevronDown
          className={`mt-0.5 h-4 w-4 flex-none text-[var(--v2-text-muted)] transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-start justify-between gap-3.5">
            <b className="text-[16px] font-bold text-[var(--v2-text-primary)]">{lead}</b>
            <span className="whitespace-nowrap text-end text-[16px] font-extrabold text-[var(--v2-text-primary)]">
              {amount}
              {/*
                WHAT THIS FIGURE IS, SAID ON THE CARD.

                It is the order's FACE VALUE: everything ever billed for this
                job. It deliberately does not follow the active filter, or the
                header stops matching the rows beneath it and the number means
                something different depending on where the reader arrived from.

                The cost of that stability is that a bare total answers nothing
                on its own — $50.00 over a booking refunded in full is a true
                figure and an unreadable one, and it was asked about four times
                in one sitting (2026-11-08). The line beneath now adds up to it,
                and this word says WHICH total it is, so the two together answer
                "what is this, and what became of it" without the number having
                to move.
              */}
              <span className="mt-0.5 block text-[11px] font-semibold uppercase tracking-wide text-[var(--v2-text-muted)]">
                {t('money.billed_label') || 'billed'}
              </span>
            </span>
          </span>
          {under && (
            <span className="mt-0.5 block text-[13px] text-[var(--v2-text-muted)]">{under}</span>
          )}

          {/* The hero's bar, at row scale. Same idea, same colours, and the
              same `minWidth`: this one is 1.5px tall inside a card that is
              half a phone wide, so a small share rounds away soonest here. */}
          {whole > 0 && (
            <span className="my-2.5 flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-[var(--v2-border)]">
              {flow.collected > 0 && (
                <i style={{ flex: flow.collected, minWidth: 3, background: TONE.in }} />
              )}
              {/* Next to collected, because it IS collected money that left
                  again — the same adjacency the summary strip uses. */}
              {flow.refunded > 0 && (
                <i style={{ flex: flow.refunded, minWidth: 3, background: TONE.back }} />
              )}
              {flow.overdue > 0 && (
                <i style={{ flex: flow.overdue, minWidth: 3, background: TONE.late }} />
              )}
              {waiting > 0 && <i style={{ flex: waiting, minWidth: 3, background: TONE.wait }} />}
              {flow.cancelled > 0 && (
                <i style={{ flex: flow.cancelled, minWidth: 3, background: TONE.lost }} />
              )}
            </span>
          )}

          <span className="flex flex-wrap items-center gap-2 text-[13px] text-[var(--v2-text-muted)]">
            <i className="h-2 w-2 flex-none rounded-sm" style={{ background: state.tone }} />
            <b className="font-bold text-[var(--v2-text-primary)]">{state.text}</b>
            {item.plan && (
              <>
                <span className="text-[var(--v2-text-muted)]">·</span>
                {`${item.plan.periodsPaid}/${item.plan.installmentCount} ${t('payments.paid_lower') || 'paid'}`}
              </>
            )}
          </span>
        </span>
      </button>
      </div>

      {open && (
        <div className="border-t border-[var(--v2-border)] px-4 pb-4 pt-4">
          <p className="m-0 mb-2.5 text-[12px] tracking-wide text-[var(--v2-text-muted)]">
            {t('money.entries_title') || 'The payments in this order'}
          </p>
          <ol className="m-0 flex list-none flex-col gap-0.5 p-0">
            {nested.map((row, index) => {
              /*
                EACH PAYMENT WEARS ITS OWN STATE'S COLOUR.
                ─────────────────────────────────────────────────────────────
                These rows carried none: the number badge and the status word
                were both `--v2-text-muted`, so a refunded payment and a
                cancelled one were the same grey — while the bar directly above
                them drew the two in different colours, and the drawer's copy of
                this very schedule coloured its dots correctly.

                The only tint here was a hand-mixed rgba for overdue, blended
                from the page's old private red and left behind when the
                palette moved to the shared map.

                `scheduleTone` is the same function the drawer calls, so the two
                renderings of one schedule cannot drift apart again.
              */
              const tone = scheduleTone(row.status);

              return (
              <li
                key={row.key}
                className="flex flex-wrap items-center gap-3 rounded-[9px] px-3 py-2.5 text-[13.5px]"
                style={{
                  /* EVERY row wears its own state, faintly — not just the one
                     that was overdue. The same ground the chips use, so a
                     payment and the chip that filtered to it are the same
                     colour. */
                  background: chipGround(tone),
                }}
              >
                <span
                  className="grid h-[21px] w-[21px] flex-none place-items-center rounded-full text-[11.5px] font-bold"
                  style={{ background: chipGround(tone), color: tone }}
                >
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[var(--v2-text-primary)]">{row.label}</span>
                  {/* `dateKind` says WHICH date this is — an unlabelled one is worse than none. */}
                  <em className="mt-px block text-[12px] not-italic text-[var(--v2-text-muted)]">
                    {t(`payments.date_${row.dateKind}`) || row.dateKind} ·{' '}
                    {row.date ? formatDate(row.date) : '—'}
                  </em>
                </span>
                <span className="whitespace-nowrap text-[12.5px]" style={{ color: tone }}>
                  {/*
                    `payments.money_status.*`, which is keyed by the same
                    `MoneyStatus` union the entries carry and is what MoneyRow
                    already uses. The older `payments.status_*` family is for
                    transaction statuses and does not cover these eight.
                  */}
                  {t(`payments.money_status.${row.status}`) || row.status}
                </span>
                {/*
                  MONEY THAT WILL NEVER ARRIVE IS STRUCK THROUGH.

                  The mockup's own device for a cancelled period, and it says
                  something no colour can: this figure is part of the total
                  above and none of it is coming. Without it a cancelled $38.50
                  sits in the same bold ink as a collected one, and the row
                  reads like a payment that simply has a different label.
                */}
                <span
                  className="min-w-[84px] whitespace-nowrap text-end font-bold"
                  style={
                    row.status === 'cancelled'
                      ? { textDecoration: 'line-through', color: 'var(--v2-text-muted)' }
                      : { color: 'var(--v2-text-primary)' }
                  }
                >
                  {formatCurrency(row.amount, row.currency)}
                </span>
              </li>
              );
            })}
          </ol>

          <div className="mt-3.5 flex flex-wrap gap-2">
            {/* Leads, because it is the one that stays on this page. */}
            <button
              type="button"
              onClick={onOpenDetail}
              className="rounded-[9px] border border-[#2DD4A7] bg-[rgba(45,212,167,.12)] px-3.5 py-2 text-[13px] font-semibold text-[#2DD4A7]"
            >
              {t('money.open_detail') || 'See the whole story'}
            </button>
            {item.bookingId && item.contactId && (
              <button
                type="button"
                onClick={onOpenBooking}
                className="rounded-[9px] border border-[var(--v2-border)] bg-[var(--v2-surface-hover)] px-3.5 py-2 text-[13px] font-semibold text-[var(--v2-text-primary)]"
              >
                {t('money.open_order') || 'Open the order'}
              </button>
            )}
            {item.contactId && (
              <a
                href={`/business-os/crm?contact=${item.contactId}`}
                className="rounded-[9px] border border-[var(--v2-border)] bg-[var(--v2-surface-hover)] px-3.5 py-2 text-[13px] font-semibold text-[var(--v2-text-primary)]"
              >
                {t('money.open_client') || "The client's card"}
              </a>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
