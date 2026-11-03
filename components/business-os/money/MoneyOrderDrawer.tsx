'use client';

/**
 * One order, opened.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT `MoneyDetailDrawer`
 *
 * That drawer answers "tell me everything about this record": a stack of
 * collapsible sections, a chip per state, a panel per concern. It is thorough,
 * and it is a filing cabinet — the reader opens it knowing what they want and
 * goes to find it.
 *
 * This page asks a different question, and so does this drawer: WHAT HAPPENED
 * TO THIS MONEY. So it is a single column read top to bottom, in the page's own
 * four tones, with no section to open and nothing folded away:
 *
 *   who and what      ·  the one line that identifies the order
 *   the figure        ·  and the same nested bar the list draws
 *   the timeline      ·  every payment in order, each on its own tone
 *   the facts         ·  how it is collected, and what to quote to support
 *   where to go next  ·  the order, the client, the bill itself
 *
 * The timeline is the point. The list row shows the same payments as a flat
 * list because a row has no height to spare; given a whole panel, they become a
 * sequence with the dates between them visible, which is how an owner actually
 * reads a plan that is half paid.
 *
 * NOTHING IS RECOMPUTED HERE. The schedule comes from `scheduleOf`, the split
 * from `itemFlow` — the same functions the row uses. A drawer that disagreed
 * with the row it opened from would be worse than no drawer.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useEffect } from 'react';
import { X, ExternalLink } from 'lucide-react';

import { itemFlow, type MoneyEntry, type MoneyItem } from '@/lib/payments/moneyItems';
/*
  THE ORDERS PAGE'S OWN ACTIONS, NOT A NEW SET.

  Send, resend, copy the payment link, the PDF, view in Stripe, void, mark paid,
  refund. `MoneyEntryActions` already has an `inline` mode written for a drawer
  — "a drawer has room, and hiding the actions there costs a click to answer a
  question the screen should already be answering: what can I do with this?" —
  and `buildEntryActions` is where what they DO lives, defined once because two
  surfaces having their own copies is how one of them stayed broken.
*/
import { MoneyEntryActions, type EntryActionHandlers } from '@/components/payments/MoneyEntryActions';

/** The same four tones the page uses everywhere, so nothing changes colour. */
const TONE = {
  in: '#2DD4A7',
  wait: '#F0B429',
  late: '#F0654F',
  lost: '#5B6880',
} as const;

const toneFor = (status: string) => {
  if (status === 'paid' || status === 'partially_refunded') return TONE.in;
  if (status === 'overdue' || status === 'failed') return TONE.late;
  if (status === 'cancelled' || status === 'refunded') return TONE.lost;
  return TONE.wait;
};

interface ScheduleRow {
  key: string;
  label: string;
  date: string | null;
  dateKind: string;
  status: string;
  amount: number;
  currency: string;
}

export function MoneyOrderDrawer({
  item,
  schedule,
  onClose,
  formatCurrency,
  t,
  isRTL = false,
  ...actions
}: {
  item: MoneyItem | null;
  /** Built by the page with `scheduleOf`, so it is the row's own list. */
  schedule: ScheduleRow[];
  onClose: () => void;
  formatCurrency: (amount: number, currency: string) => string;
  t: (key: string) => string;
  isRTL?: boolean;
} & EntryActionHandlers) {
  // Escape closes it. A panel that can only be dismissed by aiming at a small
  // × is a panel people leave open and then scroll the page behind.
  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, onClose]);

  if (!item) return null;

  const flow = itemFlow(item);
  const waiting = Math.max(0, flow.outstanding - flow.overdue);
  const whole = flow.collected + flow.outstanding + flow.cancelled;

  /* The facts a support conversation needs, and only the ones this row has. */
  const lead = item.entries[0];
  const facts: { label: string; value: string }[] = [];
  if (lead?.invoiceNumber) {
    facts.push({ label: t('payments.invoice') || 'Invoice', value: lead.invoiceNumber });
  }
  facts.push({
    label: t('payments.filter.method.label') || 'Collected by',
    value: t(`payments.method.${item.method}`) || item.method,
  });
  if (lead?.paymentMethod) {
    facts.push({ label: t('payments.method_label') || 'Paid with', value: lead.paymentMethod });
  }
  if (lead?.processorRef) {
    facts.push({ label: t('payments.reference') || 'Reference', value: lead.processorRef });
  }

  return (
    <>
      {/* The page behind stays visible and dimmed: this is one row of it, not
          a different screen. */}
      <div
        className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label={item.contactName || item.title}
        /*
          RIGHT, PHYSICALLY, IN EVERY LANGUAGE.

          This was `inset-inline-end`, which mirrors with the text direction and
          so opened on the LEFT in Hebrew. The content inside still mirrors —
          that is what `dir` is for — but the panel itself is furniture, and
          furniture does not move: a drawer that comes from a different edge
          depending on the reader's language is a different drawer to learn.
        */
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[520px] flex-col bg-[var(--v2-surface)] shadow-2xl"
      >
        {/* ── who and what ─────────────────────────────────────────────── */}
        <header className="flex items-start gap-3 border-b border-[var(--v2-border)] p-5">
          <div className="min-w-0 flex-1">
            <p className="m-0 text-[19px] font-extrabold tracking-tight text-[var(--v2-text-primary)]">
              {item.contactName || item.title}
            </p>
            {item.contactName && (
              <p className="m-0 mt-0.5 text-[13px] text-[var(--v2-text-muted)]">{item.title}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close') || 'Close'}
            className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-[var(--v2-surface-hover)] text-[var(--v2-text-muted)] transition-colors hover:text-[var(--v2-text-primary)]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {/* ── the figure, and the same bar the list draws ─────────────── */}
          <p className="m-0 text-[38px] font-extrabold leading-none tracking-tight text-[var(--v2-text-primary)]">
            {formatCurrency(item.amount, item.currency)}
          </p>

          {whole > 0 && (
            <>
              <div className="mt-4 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-[var(--v2-border)]">
                {flow.collected > 0 && <i style={{ flex: flow.collected, background: TONE.in }} />}
                {flow.overdue > 0 && <i style={{ flex: flow.overdue, background: TONE.late }} />}
                {waiting > 0 && <i style={{ flex: waiting, background: TONE.wait }} />}
                {flow.cancelled > 0 && <i style={{ flex: flow.cancelled, background: TONE.lost }} />}
              </div>

              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[12.5px] text-[var(--v2-text-muted)]">
                {flow.collected > 0 && (
                  <Figure
                    tone={TONE.in}
                    label={t('payments.collected') || 'Collected'}
                    value={formatCurrency(flow.collected, item.currency)}
                  />
                )}
                {flow.overdue > 0 && (
                  <Figure
                    tone={TONE.late}
                    label={t('payments.overdue_total') || 'Overdue'}
                    value={formatCurrency(flow.overdue, item.currency)}
                  />
                )}
                {waiting > 0 && (
                  <Figure
                    tone={TONE.wait}
                    label={t('payments.outstanding') || 'Still owed'}
                    value={formatCurrency(waiting, item.currency)}
                  />
                )}
                {flow.cancelled > 0 && (
                  <Figure
                    tone={TONE.lost}
                    label={t('payments.cancelled_total') || 'Cancelled'}
                    value={formatCurrency(flow.cancelled, item.currency)}
                  />
                )}
              </div>
            </>
          )}

          {/* ── the timeline ───────────────────────────────────────────── */}
          <h3 className="mb-3 mt-7 text-[12px] font-semibold uppercase tracking-wider text-[var(--v2-text-muted)]">
            {t('money.entries_title') || 'The payments in this order'}
          </h3>

          <ol className="m-0 list-none p-0">
            {schedule.map((row, index) => {
              const tone = toneFor(row.status);
              const last = index === schedule.length - 1;

              return (
                <li key={row.key} className="flex gap-3.5">
                  {/*
                    The spine. A dot per payment and a line between them, so a
                    plan reads as a sequence rather than four rows that happen
                    to be stacked — which is the whole reason this has a panel
                    to itself rather than staying the list's flat strip.
                  */}
                  <div className="flex flex-none flex-col items-center">
                    <span
                      className="mt-1.5 h-2.5 w-2.5 flex-none rounded-full"
                      style={{ background: tone }}
                    />
                    {!last && <span className="w-px flex-1 bg-[var(--v2-border)]" />}
                  </div>

                  <div className={`min-w-0 flex-1 ${last ? '' : 'pb-5'}`}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-[14px] font-semibold text-[var(--v2-text-primary)]">
                        {row.label}
                      </span>
                      <span className="text-[14px] font-bold text-[var(--v2-text-primary)]">
                        {formatCurrency(row.amount, row.currency)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[12.5px] text-[var(--v2-text-muted)]">
                      <span style={{ color: tone }}>
                        {t(`payments.money_status.${row.status}`) || row.status}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {t(`payments.date_${row.dateKind}`) || row.dateKind}{' '}
                        {row.date ? new Date(row.date).toLocaleDateString() : '—'}
                      </span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>

          {/*
            ── what you can do ──────────────────────────────────────────

            Per ENTRY, not per timeline row, because that is what the actions
            act on: an invoice can be sent, voided, marked paid; a plan PERIOD
            is a line in a schedule and has none of those. For a plan the
            entries are the bills raised so far, which is exactly the set an
            owner can still do something about.
          */}
          {item.entries.length > 0 && (
            <>
              <h3 className="mb-2.5 mt-7 text-[12px] font-semibold uppercase tracking-wider text-[var(--v2-text-muted)]">
                {t('money.actions_title') || 'What you can do'}
              </h3>

              <div className="flex flex-col gap-2.5">
                {item.entries.map(entry => (
                  <div
                    key={entry.key}
                    className="rounded-xl border border-[var(--v2-border)] bg-[var(--v2-surface-hover)] p-3"
                  >
                    {/* Named, because with two or more entries a bare row of
                        buttons does not say which money it would act on. */}
                    {item.entries.length > 1 && (
                      <p className="m-0 mb-2 text-[12.5px] font-semibold text-[var(--v2-text-primary)]">
                        {entry.invoiceNumber ?? entry.serviceLabel ?? item.title}
                      </p>
                    )}
                    <MoneyEntryActions entry={entry} t={t} isRTL={isRTL} inline {...actions} />
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ── the facts ──────────────────────────────────────────────── */}
          {facts.length > 0 && (
            <>
              <h3 className="mb-2.5 mt-7 text-[12px] font-semibold uppercase tracking-wider text-[var(--v2-text-muted)]">
                {t('money.facts_title') || 'The details'}
              </h3>
              <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-[13px]">
                {facts.map(fact => (
                  <div key={fact.label} className="contents">
                    <dt className="text-[var(--v2-text-muted)]">{fact.label}</dt>
                    <dd className="m-0 break-all text-end text-[var(--v2-text-primary)]">
                      {fact.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </>
          )}
        </div>

        {/* ── where to go next ─────────────────────────────────────────── */}
        <footer className="flex flex-wrap gap-2 border-t border-[var(--v2-border)] p-4">
          {item.bookingId && (
            <a
              href={`/business-os/orders?booking=${item.bookingId}`}
              className="rounded-[9px] border border-[var(--v2-border)] bg-[var(--v2-surface-hover)] px-3.5 py-2 text-[13px] font-semibold text-[var(--v2-text-primary)]"
            >
              {t('money.open_order') || 'Open the order'}
            </a>
          )}
          {item.contactId && (
            <a
              href={`/business-os/crm?contact=${item.contactId}`}
              className="rounded-[9px] border border-[var(--v2-border)] bg-[var(--v2-surface-hover)] px-3.5 py-2 text-[13px] font-semibold text-[var(--v2-text-primary)]"
            >
              {t('money.open_client') || "The client's card"}
            </a>
          )}
          {lead?.stripeHostedUrl && (
            <a
              href={lead.stripeHostedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-[9px] border border-[#2DD4A7] bg-[rgba(45,212,167,.12)] px-3.5 py-2 text-[13px] font-semibold text-[#2DD4A7]"
            >
              {t('money.open_bill') || 'The bill itself'}
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          )}
        </footer>
      </aside>
    </>
  );
}

/** One figure in the bar's key. */
function Figure({ tone, label, value }: { tone: string; label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <i className="h-2 w-2 flex-none rounded-sm" style={{ background: tone }} />
      {label}
      <b className="font-bold text-[var(--v2-text-primary)]">{value}</b>
    </span>
  );
}
