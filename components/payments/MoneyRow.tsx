'use client';

import { FileText, CreditCard, CalendarClock, ChevronDown } from 'lucide-react';
import { itemFlow, outstandingOf, type MoneyItem } from '@/lib/payments/moneyItems';
import { planPeriodText } from './MoneyDetailDrawer';
import { REPORTS_COLORS } from '@/lib/business-os/reports/constants';
import { STATUS_INK, STATUS_TONE, statusChipStyle } from '@/lib/payments/moneyStatusTone';
import { moneyRowReference } from '@/lib/payments/moneyRowReference';

/**
 * One row of the money list.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A SUMMARY, and nothing else. Two lines: the first is the answer, the second is
 * the evidence.
 *
 *   🗓 │ הדרכה אישית │ Sarah Cohen │ ● 2 of 3 paid      │     ₪600
 *      │ 12 Sep      │ INV-00012   │ 2 paid · 1 overdue │  ₪200 due
 *
 * Four columns, one kind of fact each: what was sold, who it is for, where it
 * stands, how much. Read down a column and you get every client, or every state,
 * without parsing a row at a time.
 *
 * The title is WHAT WAS SOLD, not a reference number — "ייעוץ אישי" identifies a
 * row and "INV-00012" does not. The number moves to the second line beside the
 * client, where it belongs as a reference.
 *
 * The detail, the child invoices and every action now live in the drawer this
 * row opens. They were here as well, which meant a booking's invoices could be
 * read in two places that could disagree, and an action could be fired from a
 * row too small to say what it was about to act on. One place, with room.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/*
 * The status colours live in `lib/payments/moneyStatusTone`, with every surface
 * that shows a money state reading the same map — this row's chip, the schedule
 * under it, the cashflow bar beside it, the summary strip above it and the
 * detail drawer it opens. Four of those used to disagree; the module's own note
 * has the detail.
 */

const METHOD_ICON = {
  direct: CreditCard,
  invoice: FileText,
  plan: CalendarClock,
  mixed: CreditCard,
} as const;

interface MoneyRowProps {
  item: MoneyItem;
  t: (key: string) => string;
  isRTL: boolean;
  formatCurrency: (amount: number, currency: string) => string;
  formatDate: (date: string) => string;
  /** Clicking the row: opens the detail drawer, or picks the row while the
   *  list is in select mode. The list decides which. */
  onSelect?: () => void;
  /** Picked for export. */
  selected?: boolean;
  /** The list is picking rows, so the row reads as selectable. */
  selectable?: boolean;
  /** The ledger beneath this row is open. */
  expanded?: boolean;
  /**
   * Opens or closes it. Omitted where there is nothing to drill into, and the
   * caret track then renders empty rather than offering a control that does
   * nothing.
   */
  onToggleExpand?: () => void;
}

export function MoneyRow({
  item,
  t,
  isRTL,
  formatCurrency,
  formatDate,
  onSelect,
  selected = false,
  selectable = false,
  expanded = false,
  onToggleExpand,
}: MoneyRowProps) {
  const tone = STATUS_TONE[item.status] ?? REPORTS_COLORS.UNATTRIBUTED;
  const chip = statusChipStyle(item.status);
  const MethodIcon = METHOD_ICON[item.method];
  const lead = item.entries[0];

  /**
   * The status, with its date attached and labelled.
   *
   * "3 Oct" alone says nothing about whether that has happened or is coming.
   * `dateKind` is carried precisely so the row can say which.
   */
  const statusLabel = (() => {
    const base = t(`payments.money_status.${item.status}`) || item.status;

    if (item.method === 'plan' && item.plan) {
      const progress = `${item.plan.periodsPaid}/${item.plan.installmentCount} ${t('payments.paid_lower') || 'paid'}`;

      // A stopped plan still read "2/12 paid", which describes a plan that is
      // going to reach twelve. The status is only shown when it is not the
      // ordinary one — a running plan needs no label.
      return item.plan.status && item.plan.status !== 'active'
        ? `${progress} · ${t(`payments.plan.status.${item.plan.status}`)}`
        : progress;
    }
    if (item.status === 'overdue' && lead?.dueDate) {
      // How late, not when it was due. "overdue since 3 Oct" makes the reader do
      // the subtraction, and the answer is the thing that decides whether to
      // chase it today.
      const days = Math.floor((Date.now() - new Date(lead.dueDate).getTime()) / 86_400_000);
      if (days >= 1) {
        return (t('payments.overdue_days') || 'overdue {n} days').replace('{n}', String(days));
      }
      return `${t('payments.overdue_since') || 'overdue since'} ${formatDate(lead.dueDate)}`;
    }
    if (item.status === 'awaiting_payment' && lead?.dueDate) {
      return `${t('payments.due') || 'due'} ${formatDate(lead.dueDate)}`;
    }
    if (item.status === 'paid' && lead?.paidAt) {
      return `${base} ${formatDate(lead.paidAt)}`;
    }
    return base;
  })();

  /**
   * What the row contains, now that it no longer expands to show it.
   *
   * Counts rather than names: "2 paid · 1 overdue" holds at any size, whereas
   * listing INV-00011/12/13 stops fitting at four and truncates at five. The
   * names are one click away in the drawer.
   */
  const stateCounts =
    item.entries.length > 1
      ? ([
          ['paid', item.entries.filter(e => ['paid', 'partially_refunded', 'refunded'].includes(e.status)).length],
          ['overdue', item.entries.filter(e => e.status === 'overdue').length],
          ['awaiting', item.entries.filter(e => e.status === 'awaiting_payment').length],
          ['failed', item.entries.filter(e => e.status === 'failed').length],
        ] as const)
          .filter(([, count]) => count > 0)
          .map(([state, count]) => `${count} ${t(`payments.count.${state}`) || state}`)
      : [];

  /** Still owed on this row. */
  const outstanding = outstandingOf(item);

  /*
   * The strip at the foot of the row.
   *
   * `itemFlow` is `totalMoney` for one item, so every segment here is part of a
   * figure in the summary above the list. Waiting has the late part taken off,
   * because `overdue` is a subset of `outstanding` and drawing both at face
   * value would make the bar wider than the money.
   *
   * Colours are the reports palette, not new ones: the same green means
   * collected on this bar, in the figures, and on the plan schedule in the
   * drawer.
   */
  const flow = itemFlow(item);
  const waiting = Math.max(0, flow.outstanding - flow.overdue);

  const segments = [
    { label: t('payments.collected') || 'Collected', value: flow.collected, color: REPORTS_COLORS.PRIMARY },
    { label: t('payments.due_lower') || 'due', value: waiting, color: REPORTS_COLORS.WARNING },
    { label: t('payments.overdue_total') || 'Overdue', value: flow.overdue, color: REPORTS_COLORS.DANGER },
    { label: t('payments.cancelled_total') || 'Cancelled', value: flow.cancelled, color: REPORTS_COLORS.LOST },
    { label: t('payments.refunded') || 'Refunded', value: flow.refunded, color: REPORTS_COLORS.UNATTRIBUTED },
  ].filter(segment => segment.value > 0);

  const flowTotal = segments.reduce((sum, segment) => sum + segment.value, 0) || 1;

  /**
   * What the drill-down lists.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * A PLAN shows its schedule, because that is the thing the bar summarised and
   * the question it raises is "which period, and when". Everything else shows
   * the invoices and payments behind the row, which for a single invoice is one
   * line — and one line is still worth showing, because it carries the document
   * number the row only had room to abbreviate.
   *
   * Periods come first and in order; a schedule read out of sequence is not a
   * schedule.
   */
  const ledgerLines = (
    item.plan?.periods?.length
      ? [...item.plan.periods]
          .sort((a, b) => a.installmentNumber - b.installmentNumber)
          .map(period => {
            const settled = period.status === 'paid';
            const stopped = period.status === 'cancelled';
            /*
             * FOUR STATES, NOT THREE.
             *
             * ─────────────────────────────────────────────────────────────────
             * A period is `pending`, `billed`, `paid` or `cancelled`, and this
             * called everything that was not paid or cancelled "unpaid". That
             * put one word on two different situations:
             *
             *   pending   no invoice raised — nobody has been asked for anything
             *   billed    an invoice is with the client, waiting to be paid
             *
             * The difference is the whole question an owner has about an open
             * period: is the ball with me or with them. Saying "unpaid" of a
             * period nobody has invoiced reads as a client who has not paid.
             *
             * Every label already existed; none needed inventing.
             * ─────────────────────────────────────────────────────────────────
             */
            const billed = period.status === 'billed';
            return {
              key: period.id,
              what: `${t('payments.period') || 'Payment'} ${period.installmentNumber}`,
              when: period.dueDate ? formatDate(period.dueDate) : '—',
              state: settled
                ? t('payments.paid_lower') || 'paid'
                : stopped
                  ? t('payments.period_cancelled') || 'cancelled'
                  : billed
                    ? t('payments.money_status.awaiting_payment') || 'awaiting payment'
                    : t('crm.payment.status_not_billed') || 'not billed yet',
              // The same palette the chip above and the bar beside it use, so a
              // period does not change colour on its way from the row into the
              // schedule under it.
              tone: settled
                ? STATUS_TONE.paid
                : stopped
                  ? 'var(--v2-text-muted)'
                  : billed
                    ? STATUS_TONE.awaiting_payment
                    : // Nothing has been asked for, so nothing is late. A warning
                      // colour here would mark the owner's own unraised invoice
                      // as a problem with the client.
                      'var(--v2-text-muted)',
              amount: period.amount,
              struck: stopped,
            };
          })
      : item.entries.map(one => ({
          key: one.key,
          /*
             NOT `description`, which is English and stored.
             ─────────────────────────────────────────────────────────────────
             The webhook writes it — "Payment 1 of 3", "Booking: קורס קשב" —
             and `moneyItems` warns about exactly this: the server builds these
             rows with no reader and no language, so `description` is whatever
             the processor happened to say. Rendering it put an English sentence
             in a Hebrew table.

             `planPeriodText` is the drawer's own phrasing, exported for this,
             and it reads `planPeriod` — the raw numbers carried so the browser
             can say "תשלום 1 מתוך 3" in the reader's language.
          */
          what:
            one.invoiceNumber ??
            planPeriodText(one, t) ??
            one.serviceLabel ??
            t(`payments.method.${one.method}`) ??
            one.method,
          when: one.date ? formatDate(one.date) : '—',
          /*
             `payments.money_status.*`, which is the namespace this file already
             resolves a row's status through. I reached for `payments.status.*`,
             which exists but describes a PROCESSOR result — succeeded, pending,
             failed — so three of the eight money states had no key there and
             rendered as the raw string.
          */
          state: t(`payments.money_status.${one.status}`) || one.status,
          tone: STATUS_INK[one.status] ?? STATUS_TONE[one.status] ?? 'var(--v2-text-muted)',
          amount: one.amount,
          struck: one.status === 'cancelled',
        }))
  );

  /**
   * Which paper this is, under the client's name.
   *
   * One reference, not a run-on line: the client column has room for a name and
   * one identifier, and the state counts that used to share that line now have a
   * column of their own.
   */
  const reference = moneyRowReference(item, t);

  return (
    <div
      /*
        NO CARD. The list is the card.
        ─────────────────────────────────────────────────────────────────────
        Every row carried its own border and radius, which made twenty orders
        twenty objects and broke the column alignment the grid exists for. The
        container owns the frame now and rows are divided by a hairline.

        The start accent survives, because it is the one thing the chrome
        carried that the content does not: a booking CONTAINS its money, a
        loose invoice IS the money, and that is worth telling apart before a
        word is read.
      */
      className={`transition-colors ${
        // Selection is shown by the row itself rather than a checkbox: the row
        // IS the control, so it is the thing that should look chosen.
        selected
          ? 'bg-[#22C58B]/5 ring-1 ring-inset ring-[#22C58B]'
          : item.kind === 'booking'
            ? 'border-s-2 border-s-[#8B5CF6]'
            : 'border-s-2 border-s-transparent'
      }`}
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      {/* The whole row is the target. There is no chevron to aim at any more —
          the row has one meaning now, and the drawer holds what expanding used
          to show. */}
      {/* A GRID with fixed tracks, not a flex row.

          As flex, the last two columns were `shrink-0` — sized by their own
          content — so "זוכה" and "1/3 שולמו · נעצרה" produced different widths,
          and the two `flex-1` columns then divided whatever was left over.
          Every row ended up with its columns in a different place, which is the
          one thing a list of rows must not do: the whole reason to put money in
          a column is that it can be read DOWN without reading across.

          The tracks are declared once, so a long status or a long title changes
          what that cell shows and never where any other cell sits.

          Two templates, because the client column is dropped on a narrow screen
          — the drawer names them, and losing WHAT or HOW MUCH would be worse.
          `hidden` takes it out of the grid entirely, so the four-track template
          matches. */}
      <div
        role={onSelect ? 'button' : undefined}
        tabIndex={onSelect ? 0 : undefined}
        aria-pressed={selectable ? selected : undefined}
        onClick={() => onSelect?.()}
        onKeyDown={event => {
          if (!onSelect) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onSelect();
          }
        }}
        className={`grid grid-cols-[1.25rem_minmax(0,1fr)_7rem_1.25rem] items-center gap-3 p-3 sm:grid-cols-[1.25rem_minmax(0,1.6fr)_minmax(0,1.1fr)_8.5rem_1.25rem] ${
          onSelect ? 'cursor-pointer hover:bg-[var(--v2-surface-hover)]' : ''
        }`}
      >
        <MethodIcon className="h-4 w-4 shrink-0 self-center text-[var(--v2-text-muted)]" />

        {/*
          WHO AND WHAT, as one block.
          ─────────────────────────────────────────────────────────────────────
          These were two columns — the service in one, the client in the next —
          which put a divider between a sale and the person who made it and gave
          each half a column's width to fill. One block instead, ordered the way
          the question is asked: whose order, then what it was for, then when.

          The client leads because that is the thing being looked up. A list of
          service names with the buyer in the next column is a catalogue.
        */}
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-[var(--v2-text-primary)]">
            {item.contactName ?? item.title}
          </div>
          <div className="truncate text-[11.5px] text-[var(--v2-text-secondary)]">
            {item.contactName ? item.title : '\u00A0'}
            {reference && <span className="text-[var(--v2-text-muted)]"> · {reference}</span>}
          </div>
          <div className="truncate text-[11px] tabular-nums text-[var(--v2-text-muted)]">
            {item.date ? formatDate(item.date) : t(`payments.method.${item.method}`) || item.method}
          </div>
        </div>

        {/*
          THE CASHFLOW, in a column of its own.
          ─────────────────────────────────────────────────────────────────────
          Its own track rather than tucked under the state, because these are
          read as a COLUMN: the eye runs down looking for the order that is
          mostly amber. Sharing a cell with the status text, each bar started
          wherever that row's text happened to end.

          Hidden on a narrow screen, where there is no room for a bar AND the
          figures — and where a list is scrolled rather than scanned.
        */}
        <div className="hidden min-w-0 sm:block">
          {segments.length > 0 ? (
            <>
              <div
                className="flex h-1.5 overflow-hidden rounded-full bg-[var(--v2-border)]"
                role="img"
                aria-label={segments
                  .map(segment => `${segment.label} ${formatCurrency(segment.value, item.currency)}`)
                  .join(', ')}
              >
                {segments.map(segment => (
                  <span
                    key={segment.label}
                    style={{
                      width: `${(segment.value / flowTotal) * 100}%`,
                      background: segment.color,
                    }}
                  />
                ))}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-[var(--v2-text-muted)]">
                {segments.map(segment => (
                  <span key={segment.label} className="inline-flex items-center gap-1">
                    <span
                      className="inline-block h-1.5 w-1.5 shrink-0 rounded-[2px]"
                      style={{ background: segment.color }}
                      aria-hidden="true"
                    />
                    <bdi className="truncate">{segment.label}</bdi>
                    {/* The figure only where it adds something: on a single-state
                        row the bar IS the amount in the column beside it. */}
                    {segments.length > 1 && (
                      <b className="font-semibold tabular-nums">
                        {formatCurrency(segment.value, item.currency)}
                      </b>
                    )}
                  </span>
                ))}
              </div>
              {stateCounts.length > 0 && (
                <div className="mt-0.5 truncate text-[10px] text-[var(--v2-text-muted)]">
                  {stateCounts.join(' · ')}
                </div>
              )}
            </>
          ) : (
            <span className="text-[11px] text-[var(--v2-text-muted)]">
              {/* The key already existed — "Nothing billed yet" — and says
                  exactly this. A second one would have been a duplicate. */}
              {t('payments.no_money_yet') || '—'}
            </span>
          )}
        </div>

        {/*
          HOW MUCH, and what state it is in — together, because the state is a
          fact ABOUT the figure. It had a column of its own between the client
          and the money, which put the two halves of one answer on either side
          of a divider.
        */}
        <div className="min-w-0 text-end">
          <div className="whitespace-nowrap text-[14px] font-bold tabular-nums text-[var(--v2-text-primary)]">
            {formatCurrency(item.amount, item.currency)}
          </div>
          <div
            className="mt-1 inline-flex max-w-full items-center gap-1 rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold"
            style={chip}
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: tone }} />
            <bdi className="truncate">{statusLabel}</bdi>
          </div>

          {/* A row reading "paid" with money returned is the misleading case. */}
          {item.refunded > 0 && (
            <div
              className="mt-0.5 whitespace-nowrap text-[11px] tabular-nums"
              style={{ color: STATUS_TONE.refunded }}
            >
              −{formatCurrency(item.refunded, item.currency)}
            </div>
          )}
        </div>

        {/*
          THE DRILL-DOWN.
          ─────────────────────────────────────────────────────────────────────
          Its own control, not the row. Clicking the row opens the drawer, which
          holds the client, the method, the processor reference and the actions —
          more than a list row should ever try to hold. This opens the one thing
          a reader wants WITHOUT leaving the list: the schedule behind the bar
          they were just scanning.

          `stopPropagation`, or the row's own handler fires too and the reader
          gets a drawer over the thing they just expanded.
        */}
        {onToggleExpand ? (
          <button
            type="button"
            onClick={event => {
              event.stopPropagation();
              onToggleExpand();
            }}
            aria-expanded={expanded}
            aria-label={t('payments.toggle_detail') || 'Show the breakdown'}
            className="flex h-5 w-5 items-center justify-center rounded text-[var(--v2-text-muted)] transition-colors hover:bg-[var(--v2-surface-hover)] hover:text-[var(--v2-text-primary)]"
          >
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
        ) : (
          <span aria-hidden="true" />
        )}
      </div>

      {/*
        THE LEDGER, inline.
        ───────────────────────────────────────────────────────────────────────
        The periods behind the bar, in the order they fall due. A plan shows its
        schedule; anything else shows the invoices and payments that make it up.
        Sunk ground, so an open row reads as a drawer pulled out of the list
        rather than as three more rows.
      */}
      {expanded && (
        <div className="border-t border-[var(--v2-border)] bg-[var(--v2-bg)] px-3 py-2.5">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="text-[10px] font-semibold uppercase tracking-wide text-[var(--v2-text-muted)]">
                  <th className="py-1 text-start font-semibold">
                    {t('payments.ledger.what') || 'Item'}
                  </th>
                  <th className="py-1 text-start font-semibold">
                    {t('payments.ledger.when') || 'Date'}
                  </th>
                  <th className="py-1 text-start font-semibold">
                    {t('payments.ledger.state') || 'State'}
                  </th>
                  <th className="py-1 text-end font-semibold">
                    {t('payments.ledger.amount') || 'Amount'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {ledgerLines.map(line => (
                  <tr key={line.key} className="border-t border-[var(--v2-border)]">
                    <td className="py-1.5 pe-2 text-[var(--v2-text-primary)]">
                      <bdi>{line.what}</bdi>
                    </td>
                    <td className="py-1.5 pe-2 tabular-nums text-[var(--v2-text-muted)]">
                      {line.when}
                    </td>
                    <td className="py-1.5 pe-2">
                      <span className="text-[11px] font-semibold" style={{ color: line.tone }}>
                        {line.state}
                      </span>
                    </td>
                    <td
                      className={`py-1.5 text-end font-semibold tabular-nums ${
                        line.struck
                          ? 'text-[var(--v2-text-muted)] line-through'
                          : 'text-[var(--v2-text-primary)]'
                      }`}
                    >
                      {formatCurrency(line.amount, item.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
