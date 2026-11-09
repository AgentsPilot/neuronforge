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

import { useState } from 'react';
import { X, ExternalLink, Ban } from 'lucide-react';

import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
/* Stopping a plan is the one action that belongs to the ORDER rather than to
   any one payment in it, so it lives here beside the schedule and not in
   `MoneyEntryActions`. Carried over from `MoneyDetailDrawer` so the contact
   record keeps it when it moves to this design. */
import { CancelPlanModal } from '@/components/payments/CancelPlanModal';

import { itemFlow, type MoneyEntry, type MoneyItem, isLatePeriod } from '@/lib/payments/moneyItems';
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
/* The drawer's own phrasing for "payment 2 of 3", off the raw numbers the
   webhook carried. `serviceLabel` holds the ENGLISH sentence the processor
   wrote, so naming an entry by it puts English in a Hebrew panel. */
import { planPeriodText } from '@/components/payments/MoneyDetailDrawer';
import { STATUS_INK, STATUS_TONE, scheduleTone } from '@/lib/payments/moneyStatusTone';

/**
 * The same tones every money surface uses, from the one map that decides them.
 *
 * These were copied hexes, which is how this panel came to carry the page's
 * drift rather than the canonical palette — REFUNDED most of all, drawn as a
 * drained green when `moneyStatusTone` has always given returned money a grey.
 * See the note on `TONE` in `MoneyFlowPage` for what that cost.
 */
const TONE = {
  in: STATUS_TONE.paid,
  wait: STATUS_TONE.awaiting_payment,
  late: STATUS_TONE.overdue,
  back: STATUS_TONE.refunded,
  lost: STATUS_TONE.cancelled,
} as const;

const toneFor = (status: string) => {
  /*
   * Asked of the shared map, so a breakdown row cannot disagree with the chip
   * that filtered it to here or with the bar it sits under.
   *
   * Two states are decided here rather than there, and both are about THIS
   * list: a PARTLY refunded period is still a collection — the business kept
   * some of it and the figure beside it is real — so it reads as collected,
   * while the shared map greys it for a chip that answers "was any of this
   * returned". And `not_billed` is a period nobody has been asked for yet,
   * which is this panel's own state and not a money status at all.
   */
  return scheduleTone(status);
};

/**
 * The same state, as a WORD rather than an area.
 *
 * A fill is chosen to be told apart at a glance and is often too light to read
 * as text — `cancelled` is a sand, `awaiting_payment` an orange. `STATUS_INK`
 * carries the darker half of each of the mockup's pairs, so the status beside a
 * dot is legible while the dot itself keeps the colour the bar and chip use.
 *
 * Falls back to the fill for any state with no ink of its own, which is the
 * states already dark enough to be both.
 */
const inkFor = (status: string) => {
  const key = status as keyof typeof STATUS_INK;
  return STATUS_INK[key] ?? toneFor(status);
};

/**
 * WHAT NESTS INSIDE A ROW, for the card and the drawer alike.
 *
 * A plan's SCHEDULE when there is one, not its entries. The two are not the
 * same list: a three-instalment plan paid once has three periods and one entry,
 * so showing entries made a package of three look like a single payment and put
 * the other two nowhere. Entries otherwise — money that settled no plan is only
 * ever itself.
 *
 * Module-level because two surfaces now draw it. Inside the card it would have
 * to be copied into the drawer, and the two would answer "what is in this
 * order" differently the first time either changed.
 */
export function scheduleOf(item: MoneyItem, t: (key: string) => string): ScheduleRow[] {
  if (item.plan) {
    return item.plan.periods.map(period => ({
      key: period.id,
      label: `${t('payments.period') || 'Payment'} ${period.installmentNumber}`,
      /* Paid: the day it arrived. Not yet: the day it is due. */
      date: period.paidAt ?? period.dueDate ?? null,
      dateKind: period.paidAt ? 'paid' : 'due',
      /*
        A period's status is a narrower set than an entry's. `pending` has no
        `money_status` of its own and IS money awaiting payment, which is the
        one this page already names everywhere else.

        AND A RETURNED PERIOD STILL READS `paid`, because it was. The refund is
        a second event recorded against the invoice or the charge, and the route
        joins it onto the period as `refundedAmount` precisely so a schedule can
        say so. Without this, an order with ₪2,250 returned on one of its two
        ₪4,500 stages listed both as plainly "paid" — which is the same claim
        the bar used to make before it was given a refunded band.

        Fully back is `refunded`; partly back is `partially_refunded`. The same
        distinction `MoneyDetailDrawer` draws, for the same reason: a partial
        refund leaves the business holding some of it, so the period still
        stands as a collection.
      */
      status: (() => {
        const returned = Number(period.refundedAmount ?? 0);
        if (period.status === 'paid' && returned > 0) {
          return returned >= period.amount ? 'refunded' : 'partially_refunded';
        }
        if (
          period.status === 'paid' ||
          period.status === 'overdue' ||
          period.status === 'cancelled'
        ) {
          return period.status;
        }

        /*
         * ── LATE IS DECIDED BY THE DATE, EXACTLY AS THE BAR DECIDES IT ──────
         *
         * A period is NEVER given the status `overdue` — nothing writes it, as
         * `matchesFilter` already records ("periods never carry that status, so
         * a plan months behind would otherwise be invisible to this filter
         * while the overdue FIGURE counted it"). `itemFlow` therefore works
         * lateness out from the due date with `isLatePeriod`, and that is what
         * fills the bar's red band.
         *
         * This mapping did not, so the SAME money was drawn red in the bar and
         * orange in the row beneath it. Live case 2026-11-08: a $60 plan,
         * period 2 due 3 Nov, bar red and "$30.00 Overdue" in the state line,
         * while the payment row said "Awaiting payment" in orange.
         *
         * The same function, so the two cannot answer differently again.
         */
        if (isLatePeriod(period)) return 'overdue';

        /*
         * ── NOBODY HAS BEEN ASKED FOR THIS YET ────────────────────────────
         *
         * The note above is right that `pending` is money awaiting payment,
         * and for a DATED instalment it is: the date was fixed when the client
         * agreed, and the invoice goes out on it.
         *
         * A MILESTONE is a different promise. It has no due date and falls due
         * when the owner says the work happened, so until it is billed nobody
         * has been asked for anything. Calling that "Awaiting payment" claims
         * the client is late to act, and the row said so directly beneath its
         * own empty due date: "Awaiting payment · Due —".
         *
         * Reported 2026-11-08 on an accepted quote whose remaining milestones
         * read as unpaid bills that had never been raised.
         *
         * This is the distinction the page already draws for invoices, where
         * `OUTSTANDING_STATUSES` excludes `draft` for the same reason: "nobody
         * has been asked to pay them". It simply never reached the periods.
         *
         * The FIGURE is untouched — an unbilled phase is still money the owner
         * is owed, which `moneyItems` is explicit about ("this is the owner's
         * book of business"). Only the claim about the client changes.
         */
        if (!period.invoiceId && period.trigger === 'manual') return 'not_billed';

        return 'awaiting_payment';
      })(),
      amount: period.amount,
      /* `MoneyPeriod.currency` is optional and documents this exact fallback:
         a plan need not bill in the currency of the row it sits under, but
         when it says nothing it is billing in that one. */
      currency: period.currency ?? item.currency,
    }));
  }

  return item.entries.map(entry => ({
    key: entry.key,
    label: entry.invoiceNumber ?? planPeriodText(entry, t) ?? entry.serviceLabel ?? item.title,
    date: entry.date,
    dateKind: entry.dateKind,
    status: entry.status,
    amount: entry.amount,
    currency: entry.currency,
  }));
}

interface ScheduleRow {
  key: string;
  label: string;
  date: string | null;
  dateKind: string;
  status: string;
  amount: number;
  currency: string;
}

export interface ScheduleRow {
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
  onClose,
  onOpenBooking,
  onOpenContact,
  formatCurrency,
  formatDate,
  onActionError,
  onPlanCancelled,
  t,
  isRTL = false,
  ...actions
}: {
  item: MoneyItem | null;
  onClose: () => void;
  /**
   * WHERE THIS DRAWER CAN SEND THE READER, decided by whoever opened it.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Both are OPTIONAL, and absent means the button is not drawn. They are
   * money-page destinations: from there, "the booking" and "the client" are
   * somewhere else worth going.
   *
   * Opened from inside the CRM contact record they are nonsense — the reader
   * is already standing on the client's card, and offering to take them there
   * is a button that leads to the page they are on. So that caller passes
   * neither and the footer carries only the bill.
   *
   * Callbacks rather than hrefs because the page owns its routes: the row's
   * own button and this one then cannot send the reader to different places.
   * ───────────────────────────────────────────────────────────────────────────
   */
  onOpenBooking?: (item: MoneyItem) => void;
  onOpenContact?: (item: MoneyItem) => void;
  formatCurrency: (amount: number, currency: string) => string;
  /**
   * The business's own clock, built by the caller.
   *
   * A prop rather than a `toLocaleDateString` where it renders, which is what
   * this did: with no locale and no timezone, every date drew in whatever zone
   * the browser sat in, so an owner read on a laptop set to another country
   * saw the day before on every line. Every other money surface takes this for
   * exactly that reason.
   */
  formatDate: (date: string) => string;
  /**
   * Say a refused action out loud.
   *
   * A refund the processor declines, an account it cannot resolve, a 502: the
   * contact drawer surfaces these as a banner, and without a channel for them
   * a refusal is silent and reads as a button that did nothing.
   */
  onActionError?: (message: string) => void;
  /** Re-read the list after a plan is stopped, so the row stops saying "active". */
  onPlanCancelled?: () => void;
  t: (key: string) => string;
  isRTL?: boolean;
} & EntryActionHandlers) {
  const [cancellingPlan, setCancellingPlan] = useState(false);

  if (!item) return null;

  /* Built here rather than taken as a prop: every caller would otherwise pass
     the same call, and one of them would eventually pass something else. */
  const schedule = scheduleOf(item, t);

  const flow = itemFlow(item);
  const waiting = Math.max(0, flow.outstanding - flow.overdue);
  /*
    THE BAR SPANS THE GROSS, REFUND INCLUDED.

    ───────────────────────────────────────────────────────────────────────────
    This summed collected + owed + cancelled, and `collected` is NET of
    refunds — so a part-refunded order drew a bar that was 100% green beneath a
    headline naming the gross. Measured on one account: ₪9,000 of work, ₪2,250
    returned on INV-00028, and this panel said "₪9,000" over a full green bar
    with the ₪2,250 nowhere on it, above a schedule marking both payments paid.

    Refunded is the fourth state, exactly as the page's hero bar draws it.
    ───────────────────────────────────────────────────────────────────────────
  */
  const whole = flow.collected + flow.outstanding + flow.cancelled + flow.refunded;

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
    /*
      THE SHARED `Sheet`, NOT A HAND-ROLLED PANEL.

      ─────────────────────────────────────────────────────────────────────────
      This was `fixed inset-y-0 right-0 z-50` with its own backdrop and its own
      Escape listener. That is serviceable as a top-level panel on a page, and
      it breaks the moment the drawer is opened from INSIDE another drawer —
      the CRM contact record — where nothing guarantees it stacks above its
      host, and focus is left unmanaged behind it.

      `Sheet` portals, stacks, traps focus and closes on Escape and on the
      overlay. `MoneyDetailDrawer` is on it for the same reason, and the shell
      below is that drawer's class for class: two drawers in one product that
      open at different widths and pad differently read as two products.
      ─────────────────────────────────────────────────────────────────────────
    */
    <Sheet open={!!item} onOpenChange={open => !open && onClose()}>
      <SheetContent
        side={isRTL ? 'left' : 'right'}
        className="w-full sm:max-w-xl p-0 bg-[var(--v2-surface)] border-[var(--v2-border)] overflow-hidden flex flex-col [&>button]:hidden"
        dir={isRTL ? 'rtl' : 'ltr'}
      >
        {/* ── who and what ─────────────────────────────────────────────── */}
        <header className="flex items-start gap-3 border-b border-[var(--v2-border)] p-5">
          <div className="min-w-0 flex-1">
            {/* `SheetTitle` rather than a `<p>`: Radix names the dialog from it
                for screen readers, and warns when a content has none. */}
            <SheetTitle className="m-0 text-start text-[19px] font-extrabold tracking-tight text-[var(--v2-text-primary)]">
              {item.contactName || item.title}
            </SheetTitle>
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
              {/* `minWidth` for the same reason the page's bar carries it: a
                  band that rounds to nothing claims the money is not there,
                  and this bar is only 2.5px tall on a phone to begin with. */}
              <div className="mt-4 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-[var(--v2-border)]">
                {flow.collected > 0 && (
                  <i style={{ flex: flow.collected, minWidth: 3, background: TONE.in }} />
                )}
                {flow.overdue > 0 && (
                  <i style={{ flex: flow.overdue, minWidth: 3, background: TONE.late }} />
                )}
                {waiting > 0 && <i style={{ flex: waiting, minWidth: 3, background: TONE.wait }} />}
                {flow.refunded > 0 && (
                  <i style={{ flex: flow.refunded, minWidth: 3, background: TONE.back }} />
                )}
                {flow.cancelled > 0 && (
                  <i style={{ flex: flow.cancelled, minWidth: 3, background: TONE.lost }} />
                )}
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
                {/* Named, not just drawn: the schedule below marks a refunded
                    payment "paid", because it WAS, and this is the only line
                    that says some of it came back. */}
                {flow.refunded > 0 && (
                  <Figure
                    tone={TONE.back}
                    label={t('payments.refunded') || 'Refunded'}
                    value={formatCurrency(flow.refunded, item.currency)}
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
                      {/* The ink, not the fill: the dot beside it carries the
                          fill, and a sand or orange word is unreadable. */}
                      <span style={{ color: inkFor(row.status) }}>
                        {t(`payments.money_status.${row.status}`) || row.status}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {t(`payments.date_${row.dateKind}`) || row.dateKind}{' '}
                        {row.date ? formatDate(row.date) : '—'}
                      </span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>

          {/* Offered only while the plan can still charge the client, and only
              when it is bound to Stripe — there is nothing to stop otherwise.
              Beside the schedule because it acts on the whole plan, not on any
              one payment in it. */}
          {item.plan?.subscriptionId &&
            (item.plan.status === 'active' || item.plan.status === 'past_due') && (
              <button
                type="button"
                onClick={() => setCancellingPlan(true)}
                className="mt-3 flex items-center gap-1.5 text-[12.5px] text-red-500 hover:underline"
              >
                <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                {t('payments.plan.stop')}
              </button>
            )}

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
                        {entry.invoiceNumber ??
                          planPeriodText(entry, t) ??
                          entry.serviceLabel ??
                          item.title}
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
          {/* The CRM drawer on this booking, expanded — not the orders page.
              A contact is required because the drawer IS a contact's record. */}
          {onOpenBooking && item.bookingId && item.contactId && (
            <button
              type="button"
              onClick={() => onOpenBooking(item)}
              className="rounded-[9px] border border-[var(--v2-border)] bg-[var(--v2-surface-hover)] px-3.5 py-2 text-[13px] font-semibold text-[var(--v2-text-primary)]"
            >
              {t('money.open_order') || 'Open the order'}
            </button>
          )}
          {onOpenContact && item.contactId && (
            <button
              type="button"
              onClick={() => onOpenContact(item)}
              className="rounded-[9px] border border-[var(--v2-border)] bg-[var(--v2-surface-hover)] px-3.5 py-2 text-[13px] font-semibold text-[var(--v2-text-primary)]"
            >
              {t('money.open_client') || "The client's card"}
            </button>
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
      </SheetContent>

      {/* Inside the Sheet so it stacks ABOVE the drawer rather than behind it —
          the same z-order the refund dialog uses. */}
      {item.plan?.subscriptionId && (
        <CancelPlanModal
          isOpen={cancellingPlan}
          onClose={() => setCancellingPlan(false)}
          planId={item.plan.subscriptionId}
          periodsRemaining={Math.max(0, item.plan.installmentCount - item.plan.periodsPaid)}
          collectedAmount={item.entries.reduce(
            (sum, entry) => sum + (entry.status === 'paid' ? entry.amount - entry.refunded : 0),
            0
          )}
          currency={item.currency}
          onSuccess={() => onPlanCancelled?.()}
          onError={message => onActionError?.(message)}
        />
      )}
    </Sheet>
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
