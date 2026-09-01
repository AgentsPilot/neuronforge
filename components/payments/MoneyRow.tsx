'use client';

import { FileText, CreditCard, CalendarClock } from 'lucide-react';
import { outstandingOf, type MoneyItem, type MoneyStatus } from '@/lib/payments/moneyItems';

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

const STATUS_STYLE: Record<MoneyStatus, { text: string; dot: string }> = {
  paid: { text: 'text-emerald-600', dot: 'bg-emerald-500' },
  // Orange, not red: a refund is a completed deliberate act, not a failure.
  partially_refunded: { text: 'text-amber-600', dot: 'bg-amber-500' },
  refunded: { text: 'text-orange-600', dot: 'bg-orange-500' },
  awaiting_payment: { text: 'text-blue-600', dot: 'bg-blue-500' },
  overdue: { text: 'text-red-600', dot: 'bg-red-500' },
  failed: { text: 'text-red-600', dot: 'bg-red-500' },
  draft: { text: 'text-slate-500', dot: 'bg-slate-400' },
  cancelled: { text: 'text-slate-500', dot: 'bg-slate-400' },
};

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
}: MoneyRowProps) {
  const style = STATUS_STYLE[item.status];
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
      return `${item.plan.periodsPaid}/${item.plan.installmentCount} ${t('payments.paid_lower') || 'paid'}`;
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

  /**
   * Which paper this is, under the client's name.
   *
   * One reference, not a run-on line: the client column has room for a name and
   * one identifier, and the state counts that used to share that line now have a
   * column of their own.
   */
  const reference =
    item.method === 'plan' && item.plan
      ? `${t('payments.method.plan') || 'Plan'} · ${item.plan.installmentCount} ${t('payments.payments_lower') || 'payments'}`
      : item.entries.length === 1 && lead?.invoiceNumber !== item.title
        ? lead?.invoiceNumber
        : lead?.paymentMethod && item.method === 'direct'
          ? t(`payments.payment_method.${lead.paymentMethod}`) || lead.paymentMethod
          : null;

  return (
    <div
      // A booking is a container and looks like one; loose money is a plainer
      // row. Tellable apart before a word is read.
      className={`rounded-lg border transition-colors ${
        // Selection is shown by the row itself rather than a checkbox: the row
        // IS the control, so it is the thing that should look chosen.
        selected
          ? 'border-[#22C58B] bg-[#22C58B]/5 ring-1 ring-[#22C58B]'
          : item.kind === 'booking'
            ? 'border-[var(--v2-border)] border-s-2 border-s-[#8B5CF6] bg-[var(--v2-surface)]'
            : 'border-dashed border-[var(--v2-border)] bg-[var(--v2-surface)]'
      }`}
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      {/* The whole row is the target. There is no chevron to aim at any more —
          the row has one meaning now, and the drawer holds what expanding used
          to show. */}
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
        className={`flex items-stretch p-3 ${
          onSelect ? 'cursor-pointer hover:bg-[var(--v2-surface-hover)]' : ''
        }`}
      >
        <MethodIcon className="h-4 w-4 shrink-0 self-center text-[var(--v2-text-muted)]" />

        {/* Four columns, divided, each holding one KIND of fact.

            Grouped this way the row can be read down a column — every client in
            one place, every state in another — instead of parsed left to right
            one row at a time. The dividers are `border-s`, a logical property,
            so they land on the correct side in Hebrew without a second rule.

            The client column is the one that hides on a narrow screen: the
            drawer names them, and losing WHAT and HOW MUCH would be worse. */}

        {/* WHAT was sold, and when. */}
        <div className="min-w-0 flex-1 px-3">
          <div className="truncate text-[13px] font-medium text-[var(--v2-text-primary)]">
            {item.title}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-[var(--v2-text-muted)]">
            {item.date ? formatDate(item.date) : t(`payments.method.${item.method}`) || item.method}
          </div>
        </div>

        {/* WHO it is for, and which paper it is. */}
        <div className="hidden min-w-0 flex-1 border-s border-[var(--v2-border)] px-3 sm:block">
          <div className="truncate text-[12px] text-[var(--v2-text-primary)]">
            {item.contactName ?? '—'}
          </div>
          {reference && (
            <div className="mt-0.5 truncate text-[11px] text-[var(--v2-text-muted)]">
              {reference}
            </div>
          )}
        </div>

        {/* WHERE IT STANDS. */}
        <div className="shrink-0 border-s border-[var(--v2-border)] px-3">
          <div className={`flex items-center gap-1.5 text-[11px] ${style.text}`}>
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`} />
            <bdi className="whitespace-nowrap">{statusLabel}</bdi>
          </div>
          {stateCounts.length > 0 && (
            <div className="mt-0.5 whitespace-nowrap text-[11px] text-[var(--v2-text-muted)]">
              {stateCounts.join(' · ')}
            </div>
          )}
        </div>

        {/* HOW MUCH. Last, right-aligned, so the figures form a column of their
            own that can be scanned down without reading anything else. */}
        <div className="shrink-0 border-s border-[var(--v2-border)] ps-3 text-end">
          <div className="whitespace-nowrap text-[13px] font-semibold tabular-nums text-[var(--v2-text-primary)]">
            {formatCurrency(item.amount, item.currency)}
          </div>

          {/* Still owed, under the total it is part of. Suppressed when the two
              are the same number: on a single unpaid invoice the status column
              already says it is unpaid. */}
          {outstanding > 0 && outstanding !== item.amount && (
            <div className="mt-0.5 whitespace-nowrap text-[11px] font-medium tabular-nums text-amber-600">
              {formatCurrency(outstanding, item.currency)} {t('payments.due_lower') || 'due'}
            </div>
          )}

          {/* A row reading "paid" with money returned is the misleading case. */}
          {item.refunded > 0 && (
            <div className="mt-0.5 whitespace-nowrap text-[11px] tabular-nums text-orange-600">
              −{formatCurrency(item.refunded, item.currency)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
