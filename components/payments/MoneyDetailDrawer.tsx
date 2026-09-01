'use client';

import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { CollapsibleSection } from '@/components/crm/CollapsibleSection';
import { X, FileText, CreditCard, CalendarClock, Receipt } from 'lucide-react';
import type { MoneyEntry, MoneyItem, MoneyStatus } from '@/lib/payments/moneyItems';
import { MoneyEntryActions, type EntryActionHandlers } from './MoneyEntryActions';

/**
 * Everything about one piece of money, and everything that can be done to it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Built to the contact drawer's pattern, because it opens the same way, over the
 * same records, for the same people: the same Sheet shell, the same header
 * layout, the same tab strip, the same CollapsibleSection cards.
 *
 * WHERE THE ACTION BUTTONS LIVE, AND WHY NOT IN A FOOTER.
 *
 * Actions belong to ONE invoice — "send the booking" is not a thing; sending an
 * invoice is. A pinned footer was tried and abandoned: over a booking holding
 * three invoices it can only ever say which one it means, and a label is a weak
 * defence when the button underneath it is Void or Refund. Tabs plus a naming
 * line made it more explicit without making it unambiguous.
 *
 * So the buttons sit INSIDE the invoice they act on, at the bottom of its card.
 * There is nothing to read and nothing to remember: the Refund button under
 * INV-00012 refunds INV-00012 because there is no other invoice it could mean.
 *
 * The plan schedule stays at the top and carries no buttons — nothing can be
 * done to a schedule, only to the payments in it. There is no booking section:
 * the header already states the service, the client and the date, and repeating
 * them below is two places that can disagree about one booking.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const STATUS_STYLE: Record<MoneyStatus, string> = {
  paid: 'text-emerald-600 bg-emerald-500/10',
  partially_refunded: 'text-amber-600 bg-amber-500/10',
  refunded: 'text-orange-600 bg-orange-500/10',
  awaiting_payment: 'text-blue-600 bg-blue-500/10',
  overdue: 'text-red-600 bg-red-500/10',
  failed: 'text-red-600 bg-red-500/10',
  draft: 'text-slate-500 bg-slate-500/10',
  cancelled: 'text-slate-500 bg-slate-500/10',
};

const METHOD_ICON = {
  direct: CreditCard,
  invoice: FileText,
  plan: CalendarClock,
  mixed: CreditCard,
} as const;

interface MoneyDetailDrawerProps extends EntryActionHandlers {
  item: MoneyItem | null;
  onClose: () => void;
  t: (key: string) => string;
  isRTL: boolean;
  formatCurrency: (amount: number, currency: string) => string;
  formatDate: (date: string) => string;
}

/** A labelled fact. Rendered only when there is a fact — an empty row of dashes
 *  tells the reader nothing except that the screen has gaps in it. */
function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="shrink-0 text-[11px] uppercase tracking-wide text-[var(--v2-text-muted)]">
        {label}
      </span>
      <bdi className="min-w-0 truncate text-end text-[13px] text-[var(--v2-text-primary)]">
        {value}
      </bdi>
    </div>
  );
}

/** What to call one invoice or payment, in as few words as a tab can hold. */
function entryLabel(entry: MoneyEntry, t: (key: string) => string) {
  return (
    entry.invoiceNumber ??
    entry.serviceLabel ??
    entry.description ??
    t('payments.payment') ??
    'Payment'
  );
}

export function MoneyDetailDrawer({
  item,
  onClose,
  t,
  isRTL,
  formatCurrency,
  formatDate,
  ...actions
}: MoneyDetailDrawerProps) {
  if (!item) return null;

  const MethodIcon = METHOD_ICON[item.method];
  const entries = item.entries;

  return (
    <Sheet open={!!item} onOpenChange={open => !open && onClose()}>
      {/* The contact drawer's shell, class for class. Two drawers in the same
          product that open at different widths and pad differently read as two
          products. */}
      <SheetContent
        side={isRTL ? 'left' : 'right'}
        className="w-full sm:max-w-xl p-0 bg-[var(--v2-bg)] border-[var(--v2-border)] overflow-hidden flex flex-col [&>button]:hidden"
        dir={isRTL ? 'rtl' : 'ltr'}
      >
        {/* Header, laid out like the contact drawer's: badge-coloured mark,
            title, a meta line, close at the far end. The headline figure takes
            the place the contact's stage badge holds — it is the thing the
            drawer was opened to see, and it should not need scrolling to. */}
        <div className="flex-shrink-0 border-b border-[var(--v2-border)] p-6">
          <div className="flex items-center gap-4" dir={isRTL ? 'rtl' : 'ltr'}>
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center text-white flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%)' }}
            >
              <MethodIcon className="h-5 w-5" />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <SheetTitle className="text-lg font-semibold text-[var(--v2-text-primary)] truncate text-start">
                  {item.title}
                </SheetTitle>
                <span className={`text-xs font-bold px-3 py-1 rounded-full ${STATUS_STYLE[item.status]}`}>
                  {t(`payments.money_status.${item.status}`) || item.status}
                </span>
              </div>

              <div className="flex items-center gap-3 mt-1.5 text-xs text-[var(--v2-text-muted)] flex-wrap">
                <span className="text-base font-semibold tabular-nums text-[var(--v2-text-primary)]">
                  {formatCurrency(item.amount, item.currency)}
                </span>
                {item.contactName && (
                  <>
                    <span>•</span>
                    <bdi>{item.contactName}</bdi>
                  </>
                )}
                {/* The one fact the booking section carried that the header did
                    not already state. The rest of it — service, client, item
                    count — was the title, this line, and the cards below. */}
                {item.date && (
                  <>
                    <span>•</span>
                    <bdi>{formatDate(item.date)}</bdi>
                  </>
                )}
                {item.refunded > 0 && (
                  <>
                    <span>•</span>
                    <span className="text-orange-600">
                      {formatCurrency(item.refunded, item.currency)}{' '}
                      {t('payments.refunded_suffix') || 'refunded'}
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="p-2 rounded-lg text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-surface)] transition-colors"
                aria-label={t('common.close') || 'Close'}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6 space-y-3">
            {/* The plan's schedule in full. The row can only say "2 of 3", and
                the schedule belongs to the booking rather than to any single
                payment inside it. Carries no buttons: nothing can be done to a
                schedule, only to the payments in it. */}
            {item.plan && (
              <CollapsibleSection
                title={t('payments.plan_schedule') || 'Payment schedule'}
                icon={<CalendarClock className="h-4 w-4" />}
                badge={
                  <span className="text-xs text-[var(--v2-text-muted)]">
                    {item.plan.periodsPaid}/{item.plan.installmentCount}{' '}
                    {t('payments.paid_lower') || 'paid'}
                  </span>
                }
                defaultOpen
                isRTL={isRTL}
              >
                {item.plan.periods.map(period => (
                  <div
                    key={period.id}
                    className="flex items-center gap-2 border-t border-[var(--v2-border)] py-1.5 text-[12px] first:border-t-0"
                  >
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        period.status === 'paid'
                          ? 'bg-emerald-500'
                          : period.status === 'overdue'
                            ? 'bg-red-500'
                            : 'bg-slate-300'
                      }`}
                    />
                    <span className="text-[var(--v2-text-muted)]">
                      {t('payments.period') || 'Payment'} {period.installmentNumber}
                    </span>
                    <bdi className="text-[var(--v2-text-muted)]">
                      {period.dueDate ? formatDate(period.dueDate) : ''}
                    </bdi>
                    <span className="ms-auto tabular-nums text-[var(--v2-text-primary)]">
                      {formatCurrency(period.amount, item.currency)}
                    </span>
                  </div>
                ))}
              </CollapsibleSection>
            )}

            {/* One panel per invoice or payment. Only the active one renders, so
                the footer below can only be read as acting on this. */}
            {entries.map(entry => (
              <div key={entry.key}>
                <CollapsibleSection
                  title={entryLabel(entry, t)}
                  icon={<Receipt className="h-4 w-4" />}
                  badge={
                    <span className="text-xs font-medium tabular-nums text-[var(--v2-text-primary)]">
                      {formatCurrency(entry.amount, entry.currency)}
                    </span>
                  }
                  defaultOpen
                  isRTL={isRTL}
                >
                  <div className="divide-y divide-[var(--v2-border)]">
                    <Fact
                      label={t('payments.status') || 'Status'}
                      value={t(`payments.money_status.${entry.status}`) || entry.status}
                    />
                    {/* Only when they differ from the header. Repeating the
                        client and the service under every invoice is the same
                        duplication the booking section was, one level down —
                        and it still leaves two places that can disagree. Shown
                        when they DO differ, because an invoice addressed to
                        someone other than the row's contact is worth seeing. */}
                    <Fact
                      label={t('payments.client') || 'Client'}
                      value={entry.contactName === item.contactName ? null : entry.contactName}
                    />
                    <Fact label={t('payments.email') || 'Email'} value={entry.contactEmail} />
                    <Fact
                      label={t('payments.service') || 'Service'}
                      value={entry.serviceLabel === item.title ? null : entry.serviceLabel}
                    />
                    <Fact
                      label={t('payments.due_date') || 'Due'}
                      value={entry.dueDate ? formatDate(entry.dueDate) : null}
                    />
                    <Fact
                      label={t('payments.paid_date') || 'Paid'}
                      value={entry.paidAt ? formatDate(entry.paidAt) : null}
                    />
                    <Fact
                      label={t('payments.method_label') || 'Method'}
                      value={
                        entry.paymentMethod
                          ? t(`payments.payment_method.${entry.paymentMethod}`) || entry.paymentMethod
                          : null
                      }
                    />
                    <Fact
                      label={t('payments.refunded') || 'Refunded'}
                      value={entry.refunded > 0 ? formatCurrency(entry.refunded, entry.currency) : null}
                    />
                    {/* The processor reference. Support conversations are
                        impossible without it, and it was nowhere on the list. */}
                    <Fact label={t('payments.reference') || 'Reference'} value={entry.processorRef} />
                  </div>

                  {/* This invoice's actions, under this invoice. Visible
                      buttons rather than a ⋯ menu: the drawer has the room, and
                      hiding them costs a click to answer a question the screen
                      should already be answering. */}
                  {/* One row of buttons. The "Open invoice" link that used to
                      sit beside them opened `stripeHostedUrl` — exactly what the
                      View-in-Stripe action already does, so it was the same
                      button twice with two different names. */}
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--v2-border)] pt-3">
                    <MoneyEntryActions entry={entry} t={t} isRTL={isRTL} inline {...actions} />
                  </div>
                </CollapsibleSection>
              </div>
            ))}
          </div>
        </div>

      </SheetContent>
    </Sheet>
  );
}

export type { MoneyEntry };
