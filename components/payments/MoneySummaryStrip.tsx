'use client';

/**
 * The orders summary: one strip, one cell per state of the money.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A STRIP AND NOT CARDS.
 *
 * These figures are read as a SET — collected, waiting, late, written off — and
 * the reader's question is how they sit against each other. Six separate cards
 * gave each one an icon tile, a `text-4xl` figure and its own border, which is
 * the treatment for a headline number that stands alone. Six headlines is no
 * headline, and at that size they wrapped onto two rows, where the one below
 * read as a different kind of thing from the five above it.
 *
 * Hairline-divided cells in a single container say what is true: these are
 * parts of one total, comparable at a glance.
 *
 * EVERY CELL IS A FILTER, and the figures stay put when one is applied — they
 * are summed over the unfiltered set, so the strip is the frame you filter
 * WITHIN rather than something that re-derives from its own selection. The cell
 * currently filtering is marked, and clicking it again clears.
 *
 * `overdue` is a SUBSET of `outstanding`, and is shown as one: the outstanding
 * cell carries everything owed, and the overdue cell says how much of that is
 * late. They deliberately do NOT sum — one contains the other, and a strip that
 * made them add up printed "nothing outstanding" beside ₪300 late.
 *
 * The row's BAR does subtract, and correctly: a bar is a partition of one
 * amount, so overlapping segments would draw wider than the money. A figure is
 * a total, and a total that excluded part of itself would be a different fact.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useLanguage } from '@/lib/business-os/LanguageContext';
import { REPORTS_COLORS } from '@/lib/business-os/reports/constants';
import type { MoneyCurrencyTotals, MoneyTotals } from '@/lib/payments/moneyItems';

export interface MoneySummaryCell {
  key: string;
  label: string;
  /** Already formatted, and already per-currency. */
  value: string;
  subtitle: string;
  color: string;
  /**
   * Omitted when there is nothing of this kind to look at. Safe to test
   * directly now that the figures ignore the filter: a 0 is a fact about the
   * business rather than an artefact of what is currently selected.
   */
  onSelect?: () => void;
  active: boolean;
}

interface Props {
  totals: MoneyTotals;
  /** Formats one figure across every currency present, never summing them. */
  money: (pick: (c: MoneyCurrencyTotals) => number) => string;
  activeFilter: string;
  onFilter: (filter: string) => void;
  /** How many orders the collected figure came from. */
  orderCount: number;
}

export function MoneySummaryStrip({ totals, money, activeFilter, onFilter, orderCount }: Props) {
  const { t } = useLanguage();

  const waiting = Math.max(0, totals.outstanding - totals.overdue);

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THESE FIGURES DO NOT MOVE WHEN YOU FILTER.
   *
   * `totals` now come from the search-narrowed but UNFILTERED set (see the
   * route). They used to describe whatever the filter had left, so clicking
   * Collected rewrote the strip to four zeroes and one figure: every click
   * reset the numbers being compared.
   *
   * Because they are stable, `totals.x > 0` is an honest test again — a zero
   * means the business has none of that, not that the current filter excluded
   * it — so a cell with nothing behind it is correctly left unclickable.
   *
   * Clicking the cell that is already filtering clears back to 'all'. With the
   * explanatory banner gone this is the way back, and the cells carry
   * `aria-pressed`, which says so to a screen reader.
   * ───────────────────────────────────────────────────────────────────────────
   */

  /** Clicking the active cell clears the filter; any other cell applies it. */
  const select = (key: string, hasValue: boolean) =>
    hasValue ? () => onFilter(activeFilter === key ? 'all' : key) : undefined;

  const cells: MoneySummaryCell[] = [
    {
      key: 'paid',
      label: t('payments.collected') || 'Collected',
      value: money(c => c.collected),
      subtitle: `${orderCount} ${
        orderCount === 1 ? t('payments.item') || 'order' : t('payments.entries') || 'orders'
      }`,
      color: REPORTS_COLORS.PRIMARY,
      onSelect: select('paid', totals.collected > 0),
      active: activeFilter === 'paid',
    },
    {
      key: 'unpaid',
      label: t('payments.outstanding') || 'Outstanding',
      /*
       * EVERYTHING OWED, INCLUDING THE LATE PART.
       *
       * ───────────────────────────────────────────────────────────────────────
       * This showed `outstanding - overdue`, so the two cells would sum to the
       * whole. Precise, and it produced a strip that read:
       *
       *     Outstanding ₪0.00 · Nothing outstanding
       *     Overdue     ₪300  · Past its due date
       *
       * Money that is late is money that is owed. An owner reading "nothing
       * outstanding" beside ₪300 late is being told two contradictory things,
       * and the one they will believe is the headline figure.
       *
       * So this is the full amount owed, and `overdue` below is labelled as a
       * PART of it rather than a sibling. The two no longer add up, which is
       * correct — one contains the other.
       * ───────────────────────────────────────────────────────────────────────
       */
      value: money(c => c.outstanding),
      subtitle:
        totals.outstanding <= 0
          ? t('payments.all_collected') || 'Nothing outstanding'
          : waiting > 0
            ? t('payments.awaiting_collection') || 'Still to collect'
            : // Owed in full and every bit of it late — saying "still to
              // collect" here would hide the only fact that matters.
              t('payments.all_of_it_late') || 'All of it is late',
      color: REPORTS_COLORS.WARNING,
      onSelect: select('unpaid', totals.outstanding > 0),
      active: activeFilter === 'unpaid',
    },
    {
      key: 'overdue',
      label: t('payments.overdue_total') || 'Overdue',
      value: money(c => c.overdue),
      subtitle:
        totals.overdue > 0
          ? t('payments.overdue_subtitle') || 'Past its due date'
          : t('payments.nothing_overdue') || 'Nothing late',
      color: REPORTS_COLORS.DANGER,
      onSelect: select('overdue', totals.overdue > 0),
      active: activeFilter === 'overdue',
    },
  ];

  /*
   * Shown only when there is some. A permanent zero beside four live figures
   * reads as a fifth problem the business does not have — and most businesses
   * never stop a plan at all.
   */
  if (totals.cancelled > 0 || activeFilter === 'cancelled') {
    cells.push({
      key: 'cancelled',
      label: t('payments.cancelled_total') || 'Cancelled',
      value: money(c => c.cancelled),
      subtitle: t('payments.cancelled_subtitle') || 'Asked for, never arriving',
      color: REPORTS_COLORS.LOST,
      onSelect: select('cancelled', true),
      active: activeFilter === 'cancelled',
    });
  }

  if (totals.refunded > 0 || activeFilter === 'refunded') {
    cells.push({
      key: 'refunded',
      label: t('payments.refunded') || 'Refunded',
      value: money(c => c.refunded),
      subtitle: t('payments.returned_to_clients') || 'Returned to clients',
      color: REPORTS_COLORS.UNATTRIBUTED,
      onSelect: select('refunded', true),
      active: activeFilter === 'refunded',
    });
  }

  /*
   * The book of business, split the way the cells above split it.
   *
   * `total` is `collected + outstanding` — what these orders are worth. Refunds
   * and cancellations are deliberately outside it: one left again, the other
   * never arrived, and neither is part of the value of the orders on this page.
   */
  const total = totals.collected + totals.outstanding;

  const bookSegments = [
    {
      label: t('payments.collected') || 'Collected',
      value: totals.collected,
      formatted: money(c => c.collected),
      color: REPORTS_COLORS.PRIMARY,
    },
    {
      label: t('payments.awaiting_collection') || 'Still to collect',
      value: waiting,
      formatted: money(c => Math.max(0, c.outstanding - c.overdue)),
      color: REPORTS_COLORS.WARNING,
    },
    {
      label: t('payments.overdue_total') || 'Overdue',
      value: totals.overdue,
      formatted: money(c => c.overdue),
      color: REPORTS_COLORS.DANGER,
    },
  ].filter(segment => segment.value > 0);

  return (
    <div className="mb-3">
      <div
        className="grid grid-cols-2 gap-px overflow-hidden border border-[var(--v2-border)] bg-[var(--v2-border)] sm:grid-cols-3 lg:grid-cols-5"
        style={{ borderRadius: 'var(--v2-radius-card)' }}
      >
        {cells.map(cell => {
          const Tag = cell.onSelect ? 'button' : 'div';
          return (
            <Tag
              key={cell.key}
              {...(cell.onSelect
                ? { type: 'button' as const, onClick: cell.onSelect, 'aria-pressed': cell.active }
                : {})}
              /*
               * The selected frame is SQUARE — except where the strip is not.
               *
               * ─────────────────────────────────────────────────────────────
               * The grid is `overflow-hidden` with a 16px radius, so it clips
               * its own corners. A fully square `ring-inset` on a cell sitting
               * in one of those corners had its corner sliced off by that arc,
               * so the frame drew open on the outer edge.
               *
               * The first fix rounded EVERY active cell. That closed the
               * corner and was wrong: a cell in the middle of the strip is a
               * rectangle, and drawing a 14px frame inside it made it read as
               * a pill floating in a row of squares.
               *
               * A cell only needs a curve on the side where the CONTAINER has
               * one, which is its outer edge — and only the first and last
               * cells have an outer edge. `first:`/`last:` says exactly that
               * and needs no knowledge of the column count, so it survives the
               * responsive jumps (2 / sm:3 / lg:5) that no static index could.
               *
               * `rounded-s`/`rounded-e` are LOGICAL, so the curve follows the
               * reading direction: in Hebrew the first cell is on the right and
               * is rounded there, which is where the container is round too.
               *
               * `z-[1]` keeps the ring above the 1px divider it shares with the
               * next cell, which would otherwise overdraw its edge.
               * ─────────────────────────────────────────────────────────────
               */
              className={`bg-[var(--v2-surface)] px-4 py-3 text-start transition-colors ${
                cell.onSelect ? 'cursor-pointer hover:bg-[var(--v2-surface-hover)]' : ''
              } ${
                cell.active
                  ? 'relative z-[1] ring-2 ring-inset ring-[var(--v2-primary)] first:rounded-s-[14px] last:rounded-e-[14px]'
                  : ''
              }`}
            >
              <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--v2-text-secondary)]">
                <span
                  className="h-2 w-2 shrink-0 rounded-[2px]"
                  style={{ background: cell.color }}
                  aria-hidden="true"
                />
                <bdi className="truncate">{cell.label}</bdi>
              </span>
              <span
                className="mt-0.5 block text-[19px] font-bold tabular-nums tracking-tight text-[var(--v2-text-primary)]"
                style={cell.key === 'overdue' && totals.overdue > 0 ? { color: cell.color } : undefined}
              >
                {cell.value}
              </span>
              <span className="block truncate text-[11px] text-[var(--v2-text-muted)]">
                {cell.subtitle}
              </span>
            </Tag>
          );
        })}
      </div>

      {/*
        THE WHOLE BOOK, AS ONE BAR.
        ───────────────────────────────────────────────────────────────────────
        This was a sentence: "Value of these orders ₪3,895 · what has been
        collected plus what is still owed". Accurate, and it asked the reader to
        hold two figures in their head to picture a ratio the page can simply
        draw.

        So it is the same bar the rows carry, for every order at once — and its
        segments are the cells directly above it, in the same colours. A reader
        who has learnt the bar on one row can read the business from this one.

        Collected, waiting and late only. Refunded money left again and
        cancelled money never arrived; neither is part of what these orders are
        worth, which is why the figure is `collected + outstanding`.
      */}
      {total > 0 && (
        <div className="mt-2 rounded-[10px] border border-[var(--v2-border)] bg-[var(--v2-surface)] px-3 py-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[11px] font-semibold text-[var(--v2-text-secondary)]">
              {t('payments.orders_value') || 'Value of these orders'}
            </span>
            <span className="text-[15px] font-bold tabular-nums tracking-tight text-[var(--v2-text-primary)]">
              {money(c => c.collected + c.outstanding)}
            </span>
          </div>

          <div
            className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-[var(--v2-border)]"
            role="img"
            aria-label={bookSegments
              .map(segment => `${segment.label} ${segment.formatted}`)
              .join(', ')}
          >
            {bookSegments.map(segment => (
              <span
                key={segment.label}
                style={{ width: `${(segment.value / total) * 100}%`, background: segment.color }}
              />
            ))}
          </div>

          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--v2-text-secondary)]">
            {bookSegments.map(segment => (
              <span key={segment.label} className="inline-flex items-center gap-1.5">
                <span
                  className="h-2 w-2 shrink-0 rounded-[2px]"
                  style={{ background: segment.color }}
                  aria-hidden="true"
                />
                <bdi>{segment.label}</bdi>
                <b className="font-semibold tabular-nums text-[var(--v2-text-primary)]">
                  {segment.formatted}
                </b>
                <span className="text-[var(--v2-text-muted)] tabular-nums">
                  {Math.round((segment.value / total) * 100)}%
                </span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
