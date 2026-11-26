'use client';

import { useState, useEffect, useMemo, Fragment, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Receipt, CreditCard, Plus, DollarSign, Calendar, ExternalLink, FileText, RotateCcw } from 'lucide-react';
import { RefundModal } from '@/components/payments/RefundModal';
import { createLogger } from '@/lib/logger';
import { buildMoneyItems, cancelledPlanMoneyOf, itemFlow, outstandingOf, totalMoney, unpaidPeriods, type MoneyEntry, type MoneyItem, type MoneyPlan } from '@/lib/payments/moneyItems';
import { fetchContactMoney } from '@/lib/payments/fetchContactMoney';
import { buildEntryActions } from '@/lib/payments/entryActions';
/* The money page's drawer, not the orders page's.
   One design for one record: this tab and the money page open the same order
   and were showing it two different ways. */
import { MoneyOrderDrawer } from '@/components/business-os/money/MoneyOrderDrawer';
import { MoneyRow } from '@/components/payments/MoneyRow';
import { REPORTS_COLORS } from '@/lib/business-os/reports/constants';
import { STATUS_TONE, scheduleTone } from '@/lib/payments/moneyStatusTone';
import type { SessionCardData } from './types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CollapsibleSection } from '../CollapsibleSection';
import { useBusinessTimezone } from '@/lib/business-os/LanguageContext';

interface PaymentTransaction {
  id: string;
  amount: number;
  currency: string;
  status: 'pending' | 'completed' | 'failed' | 'refunded';
  payment_method: string;
  description: string;
  created_at: string;
  stripe_payment_intent_id?: string;
  /** Carries a plan period's numbers, so the label can be localised here. */
  metadata?: Record<string, unknown> | null;
}

interface Invoice {
  id: string;
  invoice_number: string;
  amount: number;
  currency: string;
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled' | 'refunded' | 'partially_refunded';
  /** Derived from the invoice's payments by trigger. */
  refunded_amount?: number | null;
  due_date?: string;
  created_at: string;
  line_items?: Array<{
    description: string;
    quantity: number;
    unit_price: number;
    total: number;
  }>;
}

interface PaymentsSectionProps {
  contactId: string;
  contactName: string;
  contactEmail?: string;
  /**
   * The contact's bookings, so each money row can be headed by the session it
   * paid for. Already loaded by the drawer — passed in rather than refetched.
   */
  sessions?: SessionCardData[];
  t: (key: string) => string;
  isRTL: boolean;
  language?: string;
  isLoading?: boolean;
  isOpen?: boolean;
  onToggle?: (isOpen: boolean) => void;
  onCreateInvoice?: () => void;
  onInvoiceCreated?: () => void;
  /**
   * Money moved — a refund, a void, an invoice marked paid.
   *
   * This section owns the money lists and refreshes those itself, but the same
   * facts are drawn again in the journey above it, from data the drawer holds.
   * Without this the owner refunded a payment, watched the money list update,
   * and saw the timeline still showing the full amount until they closed the
   * drawer and opened it again.
   */
  onMoneyChanged?: () => void;
}

const INVOICE_STATUS_STYLES: Record<string, { color: string; bg: string }> = {
  draft: { color: 'text-slate-500', bg: 'bg-slate-500/10' },
  sent: { color: 'text-blue-500', bg: 'bg-blue-500/10' },
  paid: { color: 'text-green-500', bg: 'bg-green-500/10' },
  overdue: { color: 'text-red-500', bg: 'bg-red-500/10' },
  cancelled: { color: 'text-gray-500', bg: 'bg-gray-500/10' },
  refunded: { color: 'text-orange-500', bg: 'bg-orange-500/10' },
  partially_refunded: { color: 'text-amber-500', bg: 'bg-amber-500/10' }
};

const PAYMENT_STATUS_STYLES = {
  pending: { color: 'text-amber-500', bg: 'bg-amber-500/10' },
  completed: { color: 'text-green-500', bg: 'bg-green-500/10' },
  succeeded: { color: 'text-green-500', bg: 'bg-green-500/10' },
  failed: { color: 'text-red-500', bg: 'bg-red-500/10' },
  refunded: { color: 'text-gray-500', bg: 'bg-gray-500/10' }
};

const logger = createLogger({ module: 'PaymentsSection' });

export function PaymentsSection({
  contactId,
  contactName,
  contactEmail,
  sessions = [],
  t,
  isRTL,
  language,
  isLoading = false,
  isOpen,
  onToggle,
  onCreateInvoice,
  onMoneyChanged,
  onInvoiceCreated
}: PaymentsSectionProps) {
  // The business's clock, so a payment date reads the same here, on the
  // invoice and in the client's receipt email.
  const { timeZoneOptions } = useBusinessTimezone();
  const router = useRouter();

  /**
   * The invoice being refunded. This section was entirely read-only — every row
   * navigated away to the reports page — so a refund could only be reached from
   * a booking, and an invoice with no booking could not be refunded from the
   * drawer at all.
   */
  /**
   * The money row being refunded.
   *
   * Was an `Invoice`, which is why a standalone payment could not be refunded
   * from here at all. A `MoneyEntry` covers both: it carries the invoice id when
   * there is one and the transaction ids when there is not.
   */
  const [refundEntry, setRefundEntry] = useState<MoneyEntry | null>(null);

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * WHAT THE CLIENT ASKED FOR, which the money rows cannot say.
   *
   * A row can show that ₪20 went back. It cannot show that ₪300 was asked for,
   * that the client said they were ill and never came, or that the owner
   * returned part of it and closed the matter. The card that carried all of
   * that disappears the moment the request is settled — correctly, because a
   * settled request is not work — and the asking disappeared with it.
   *
   * So a partial refund read as a decision nobody explained, to the person who
   * made it, three weeks later. This is that missing half, sitting with the
   * payment it is about.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const [refundAsks, setRefundAsks] = useState<
    Array<{
      id: string;
      booking_id: string | null;
      amount_requested: number;
      currency: string;
      reason: string | null;
      note: string | null;
      status: string;
      created_at: string;
      /* What the agent concluded, and when. All null on a request nothing has
         looked at — the owner answered it before the agent got to it, or the
         agent is paused. The story then simply has no middle step, which is
         itself worth seeing. */
      recommendation: string | null;
      recommended_amount: number | null;
      reasoning: string | null;
      assessed_at: string | null;
      /* When the owner answered. Null while it is still open. */
      decided_at: string | null;
      source: string | null;
    }>
  >([]);

  useEffect(() => {
    if (!contactId) return;
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(
          `/api/business-os/refund-requests?contact_id=${contactId}`,
          { credentials: 'include' }
        );
        if (!response.ok) return;
        const payload = await response.json();
        if (!cancelled && payload?.success) setRefundAsks(payload.data ?? []);
      } catch {
        /* The money rows are the point of this section and render without
           this. A failed read leaves them alone rather than blanking them. */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [contactId]);

  /* By booking, which is how a request names what it is about — the client
     thinks "the session I missed", never a transaction id. */
  const asksByBooking = useMemo(() => {
    const map = new Map<string, (typeof refundAsks)[number]>();
    for (const ask of refundAsks) if (ask.booking_id) map.set(ask.booking_id, ask);
    return map;
  }, [refundAsks]);
  /** The money row whose full detail is open. */
  const [detail, setDetail] = useState<MoneyItem | null>(null);
  /** A refund the processor or the ledger refused. */
  const [refundError, setRefundError] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  /**
   * The projected periods of any payment plan, keyed by booking.
   *
   * Without these `item.plan` is undefined, so a plan showed ONLY the period
   * that had been collected — one ₪333 row — and the two still to come were
   * invisible. The reader saw a paid booking rather than a plan two thirds
   * outstanding.
   */
  const [plansByBookingId, setPlansByBookingId] = useState<Record<string, MoneyPlan>>({});
  /**
   * Bookings that carry money but are not among `sessions`.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * THE PACKAGE THAT PAID FOR ITSELF SOMEWHERE ELSE.
   *
   * `sessions` is the JOURNEY's array, and the journey deliberately ABSORBS a
   * package container into the booking whose quote sold it — see
   * `foldPackageMeetings`, where `absorbed` filters the container out. That is
   * right for a timeline: the sessions belong beside the quote that produced
   * them, not on a row of their own.
   *
   * It is wrong for the money, because the money is keyed on the CONTAINER.
   * Its payment plan carries `booking_id` of the container, so a plan arrived
   * here for a booking `buildMoneyItems` had never been given — and a plan
   * whose booking is absent is silently dropped, along with everything it was
   * owed.
   *
   * Measured on the reporting account, 2026-11-24: the money page read
   * $407.04 outstanding and this section read $185.00. Received ($417.01) and
   * returned ($240.00) agreed to the cent — only the owed figure was short,
   * by $222.04, which is exactly the pay-as-you-go package's two unbilled
   * sessions. The drawer was reporting a client as owing less than half of
   * what they owe.
   *
   * So any booking the money endpoint names and this drawer has not got is
   * added to the list. It renders as its own order, which is how the money
   * page shows it too — one more surface agreeing rather than one more
   * arrangement to maintain.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const [moneyOnlyBookings, setMoneyOnlyBookings] = useState<
    { id: string; title: string; startTime: string | null }[]
  >([]);
  const [payments, setPayments] = useState<PaymentTransaction[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [loadingPayments, setLoadingPayments] = useState(false);

  /**
   * One list, grouped by booking.
   *
   * This had Invoices and Payments as separate sub-tabs, which showed a paid
   * invoice twice — once as an invoice and again as the payment that settled it
   * — and asked the reader to work out they were the same ₪200. It also posed a
   * question nobody has: the owner wants to know whether Sarah's session has
   * been paid for, not whether that is a transaction or an invoice.
   *
   * `buildMoneyItems` does the grouping and is unit-tested, including the case
   * this merge could get badly wrong: counting the same money twice.
   */
  const moneyItems = useMemo(
    () =>
      buildMoneyItems({
        invoices,
        transactions: payments as unknown as Parameters<typeof buildMoneyItems>[0]['transactions'],
        bookings: [
          ...sessions.map(session => ({
          id: session.booking.id,
          // Products have no time slot, so they fall back to their order date.
          title: session.booking.service?.service_name || t('crm.session') || 'Session',
          startTime: session.booking.start_time ?? session.booking.created_at ?? null,
          contactId,
          /*
           * No `clientName` here, deliberately.
           *
           * `scheduling_bookings.client_first_name` was dropped by
           * `20260810_remove_client_fields_and_total_amount.sql`, so reading it
           * yields undefined — a fallback that can never fire. This drawer is
           * scoped to one contact anyway: the name is in its header, and the
           * orders list supplies it from `crm_contacts` where it is needed.
           */
          })),
          /*
           * And the bookings the money endpoint named that the journey does
           * not hold — see `moneyOnlyBookings`. Appended rather than merged:
           * `buildMoneyItems` keys on the booking id, so a duplicate would be
           * two rows for one order.
           */
          ...moneyOnlyBookings
            .filter(booking => !sessions.some(session => session.booking.id === booking.id))
            .map(booking => ({
              id: booking.id,
              title: booking.title,
              startTime: booking.startTime,
              contactId,
            })),
        ],
        plansByBookingId,
        standaloneLabel: t('payments.payment') || 'Payment',
        /*
         * A plan period, phrased here rather than read from the database.
         *
         * The stored description is written in English by the webhook, so a
         * Hebrew reader saw "Payment 1 of 3" in the middle of a Hebrew drawer.
         * The numbers come through metadata; the words come from `t`.
         */
        installmentLabel: (number, count) =>
          (t('payments.installment_payment') || 'Payment {n} of {count}')
            .replace('{n}', String(number))
            .replace('{count}', String(count)),
      }),
    [invoices, payments, sessions, contactId, plansByBookingId, moneyOnlyBookings, t]
  );

  const totals = useMemo(() => totalMoney(moneyItems), [moneyItems]);

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * A FILTER AND A PAGE, BECAUSE THE LIST HAS NO CEILING.
   *
   * This rendered every row a client had — 40 on the account that raised it,
   * and nothing stops that growing. In a 576px drawer the thing somebody came
   * to find was below several screens of scrolling, and there was no way to
   * ask for "the unpaid ones".
   *
   * The chips are built from what is ACTUALLY PRESENT, with counts, rather
   * than from the eight statuses that exist: a chip reading "failed · 0" is a
   * question the reader has to dismiss. One client's money usually has two or
   * three states, so the row stays short.
   *
   * `totals` deliberately keeps reading `moneyItems`, not the filtered list.
   * The header says what this client owes and has paid IN TOTAL, and a figure
   * that moved when somebody pressed a filter chip would be a different claim
   * about the same business.
   * ───────────────────────────────────────────────────────────────────────────
   */
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * FOUR GROUPS, NOT SEVEN STATUSES.
   *
   * The person reading this is good at therapy and running a business is the
   * part they like least. `זוכה`, `זוכה חלקית`, `ממתין לתשלום`, `באיחור`,
   * `טיוטה` are bookkeeping words: seven chips are seven questions before any
   * answer arrives.
   *
   * What actually differs to them is far smaller:
   *
   *   WAITING    somebody owes money. This is the only group that needs them.
   *   RETURNED   money went back out. Done, but worth being able to explain.
   *   PAID       settled. One line, because there is nothing to do.
   *   CANCELLED  NOT MONEY AT ALL — never collected and never will be.
   *
   * Lateness is a MARK INSIDE the first group, not a group of its own: it is
   * the same money, late. Splitting it hid "they owe you" behind two chips
   * that had to be added up by eye.
   * ───────────────────────────────────────────────────────────────────────────
   */
  type MoneyGroup = 'waiting' | 'refunded' | 'paid' | 'cancelled';

  /**
   * Marks the PAID half of an order that is still partly owed.
   *
   * A suffix rather than a flag on the item, because these rows travel through
   * `MoneyItem[]` and a field the type does not have would need a cast at every
   * stop. The suffix is stripped by `orderFor` so the drawer still opens the
   * whole order, not the half-row that was clicked.
   */
  const SETTLED_SUFFIX = '::collected';

  /** And the mirror: the OWED half of an order that is not itself waiting. */
  const OWED_SUFFIX = '::owed';
  /** Marks the called-off half of an order that is not itself cancelled. */
  const VOIDED_SUFFIX = '::cancelled';

  const groupOf = (status: string): MoneyGroup => {
    switch (status) {
      case 'refunded':
      case 'partially_refunded':
        return 'refunded';
      case 'paid':
        return 'paid';
      case 'cancelled':
        return 'cancelled';
      /* `draft` and `failed` land in WAITING on purpose: from the reader's side
         both mean "this money has not arrived and something has to happen". */
      default:
        return 'waiting';
    }
  };

  const grouped = useMemo(() => {
    const out: Record<MoneyGroup, MoneyItem[]> = {
      waiting: [],
      refunded: [],
      paid: [],
      cancelled: [],
    };
    for (const item of moneyItems) out[groupOf(String(item.status))].push(item);

    /*
     * ───────────────────────────────────────────────────────────────────────
     * MONEY THAT ARRIVED IS LISTED UNDER PAID, EVEN ON AN ORDER STILL OWED.
     *
     * The groups are per ORDER and an order has one status, so a plan with one
     * period paid and one owed is not `paid` and lands wholly in WAITING. Its
     * collected half then appeared in no list while still counting toward "you
     * have received" — a contact read "received $873" above two paid rows of
     * $500 and $333, and the missing $40 was the paid period of a $40 + $40
     * plan sitting in Waiting.
     *
     * So the collected entries are listed as their own row. They ARE separate
     * invoices — INV-00014 paid and INV-00015 owed, in that live case — so this
     * is not the same money twice; it is the two halves each shown where it
     * belongs. The waiting row keeps the outstanding figure, which is what the
     * owner is actually owed.
     *
     * `itemFlow` decides what counts as collected, entry by entry, rather than
     * a status list copied here. The row and the totals above it therefore
     * cannot disagree about what "received" means.
     *
     * `plan` is dropped and the date is the latest payment: this row is the
     * money, not the agreement, and `paid {date}` has to name the day it
     * actually arrived.
     * ───────────────────────────────────────────────────────────────────────
     */
    /*
     * ── AND FROM AN ORDER THAT ENDED IN A REFUND, OR WAS CALLED OFF ────────
     *
     * This read `out.waiting` alone, on the reasoning that a part-paid order
     * is the case where money arrives on something not marked paid. It is not
     * the only one. An order's status is its LAST event, so a job that was
     * part-paid and then part-refunded reads `partially_refunded` and lands
     * under "Money you returned" — taking its collected half out of every
     * list on the tab while it still counts toward the Collected tile.
     *
     * Measured on this contact: the Collected tile read $467.01 over rows
     * totalling $397.01. The missing $70.00 was three part-refunded orders —
     * $35.00, $25.00 and $10.00 — each of which really did take money.
     * ──────────────────────────────────────────────────────────────────────
     */
    for (const item of [...out.waiting, ...out.refunded, ...out.cancelled]) {
      const collectedEntries = item.entries.filter(
        entry => itemFlow({ ...item, plan: undefined, entries: [entry] }).collected > 0
      );

      if (!collectedEntries.length) continue;

      const paidOn = collectedEntries
        .map(entry => String(entry.date))
        .sort()
        .pop();

      out.paid.push({
        ...item,
        plan: undefined,
        entries: collectedEntries,
        /* Suffixed so React keys stay unique and `orderFor` can find its way
           back to the whole order when the row is opened. */
        key: `${item.key}${SETTLED_SUFFIX}`,
        date: paidOn ?? item.date,
        status: 'paid',
      } as MoneyItem);
    }

    /*
     * ───────────────────────────────────────────────────────────────────────
     * AND THE MIRROR: MONEY STILL OWED ON AN ORDER THAT IS NOT WAITING.
     *
     * An order's one status is the state of its LAST event, so a plan whose
     * first period was refunded reads `refunded` and lands under "Money you
     * returned" — while a later period of it is still live, still due, and
     * still counted in "waiting".
     *
     * Seen live: a contact's Waiting tile read $170 over six rows totalling
     * $140. The missing $30 was booking 620f1457, refunded on 11 Nov with its
     * second period left running. Not a refund bug: the two sibling orders
     * that DID stop carry `cancel_reason: client_unresponsive` and
     * `client_not_paying`, so an owner stopped those deliberately and nobody
     * stopped this one. The money is genuinely owed; it was simply invisible.
     *
     * Debt that nobody can see is the worst thing for this panel to hide,
     * because the whole group is headed "needs you".
     *
     * `plan` is KEPT here, unlike the settled row above: the outstanding
     * figure usually comes from an unpaid PERIOD rather than from an entry,
     * and dropping the plan would make the row report zero.
     * ───────────────────────────────────────────────────────────────────────
     */
    for (const group of ['paid', 'refunded', 'cancelled'] as MoneyGroup[]) {
      for (const item of [...out[group]]) {
        const flow = itemFlow(item);
        if (flow.outstanding <= 0) continue;

        /* The soonest thing still to be paid, so `due {date}` names the next
           deadline rather than the order's own date, which has passed. */
        const nextDue = unpaidPeriods(item)
          .map(period => String(period.dueDate ?? ''))
          .filter(Boolean)
          .sort()[0];

        out.waiting.push({
          ...item,
          entries: item.entries.filter(
            entry => itemFlow({ ...item, plan: undefined, entries: [entry] }).outstanding > 0
          ),
          key: `${item.key}${OWED_SUFFIX}`,
          date: nextDue || item.date,
          /* `overdue` earns the chasing colour and the "late by n days" line;
             anything else is merely waiting. `totals.overdue` decided this,
             not a second comparison of dates here. */
          status: flow.overdue > 0 ? 'overdue' : 'awaiting_payment',
        } as MoneyItem);
      }
    }

    /*
     * ───────────────────────────────────────────────────────────────────────
     * CALLED-OFF MONEY, WHICH HAD NO ROWS AT ALL.
     *
     * The cancelled group took orders whose OWN status is `cancelled`, and
     * most called-off money is not shaped like that. A plan period that is
     * called off leaves the order itself alive — `itemFlow` counts it through
     * `cancelledPlanMoneyOf`, and the order goes on reading `paid` or
     * `awaiting_payment` because of everything else on it.
     *
     * So on this contact the tab reported $403.03 cancelled above a group
     * holding ZERO rows. The figure was right and nothing on the page
     * accounted for it — the precise complaint that "the numbers don't make
     * sense with the list".
     *
     * Same shape as the two splits above: the called-off part becomes its own
     * row, under the heading that explains it, while the order keeps its
     * place wherever its live money put it.
     * ───────────────────────────────────────────────────────────────────────
     */
    for (const group of ['waiting', 'refunded', 'paid'] as MoneyGroup[]) {
      for (const item of [...out[group]]) {
        /* A half-row never spawns another: the collected and owed rows above
           are slices of an order already accounted for. */
        if (String(item.key).includes('::')) continue;
        if (itemFlow(item).cancelled <= 0) continue;

        out.cancelled.push({
          ...item,
          entries: item.entries.filter(
            entry => itemFlow({ ...item, plan: undefined, entries: [entry] }).cancelled > 0
          ),
          key: `${item.key}${VOIDED_SUFFIX}`,
          status: 'cancelled',
        } as MoneyItem);
      }
    }

    /* Inside WAITING: late first, then by due date. The oldest debt is the one
       they should be chasing, and it should not be below a bill due next month. */
    out.waiting.sort((a, b) => {
      const lateA = String(a.status) === 'overdue' ? 0 : 1;
      const lateB = String(b.status) === 'overdue' ? 0 : 1;
      if (lateA !== lateB) return lateA - lateB;
      return String(a.date).localeCompare(String(b.date));
    });
    /* The others newest first: recent history is what gets looked up. */
    for (const key of ['refunded', 'paid', 'cancelled'] as MoneyGroup[]) {
      out[key].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    }
    return out;
  }, [moneyItems]);

  /*
   * THE LATE FIGURE COMES FROM `totalMoney`, NEVER FROM A SECOND SUM.
   *
   * This was computed here, over `grouped.waiting` where `status === 'overdue'`
   * — and reported MORE late money than there was outstanding, which is
   * impossible and said so on screen: "owes you ₪6,374.99, of which ₪6,700.00
   * is already late".
   *
   * Two reasons, both avoidable by not having written it:
   *   · it summed `amount - refunded`, a different basis from the one
   *     `totalMoney` uses for `outstanding`;
   *   · it only saw items whose own status is `overdue`, while `totalMoney`
   *     also counts a plan period whose due date has passed — "a period is
   *     never given that status, so without the second half a plan could be
   *     months late and report nothing".
   *
   * `totals.overdue` is documented as a SUBSET of `outstanding`, computed in
   * the same pass by the same rules, so the sentence can never contradict
   * itself again.
   */

  /** The whole order behind a row, which for a half-row is not itself. */
  const orderFor = (row: MoneyItem): MoneyItem => {
    const key = String(row.key);
    const suffix = [SETTLED_SUFFIX, OWED_SUFFIX, VOIDED_SUFFIX].find(s => key.endsWith(s));
    if (!suffix) return row;

    const base = key.slice(0, -suffix.length);
    return moneyItems.find(item => String(item.key) === base) ?? row;
  };

  /** The order a row belongs to, by key: the row's own key minus any half-row suffix. */
  const baseKeyOf = (row: MoneyItem): string => {
    const key = String(row.key);
    const suffix = [SETTLED_SUFFIX, OWED_SUFFIX, VOIDED_SUFFIX].find(s => key.endsWith(s));
    return suffix ? key.slice(0, -suffix.length) : key;
  };

  /**
   * The figure a row states in its group — ONE function, used by the row
   * itself and by "also listed under" on its siblings, so the two can never
   * name different amounts for the same slice of an order.
   */
  const rowAmount = (group: MoneyGroup, item: MoneyItem): number => {
    const flow = itemFlow(item);
    if (group === 'refunded') return flow.refunded || flow.collected;
    if (group === 'paid') return flow.collected;
    if (group === 'cancelled') return flow.cancelled || Number(item.amount) || 0;
    return flow.outstanding;
  };

  /**
   * Where a payment plan stands, for a row waiting on it: "Payment 2 of 2 still
   * to come", or "2 plan payments still to come · 3 paid · 3 called off".
   *
   * Read from the WHOLE order's plan (a half-row may carry a slice), so the
   * three counts describe the agreement the owner made. Null for a row with no
   * plan, which keeps its due-date line.
   */
  const planLine = (row: MoneyItem): string | null => {
    const periods = (row.plan ?? orderFor(row).plan)?.periods ?? [];
    if (periods.length === 0) return null;

    const left = unpaidPeriods({ ...orderFor(row), plan: row.plan ?? orderFor(row).plan });
    const paid = periods.filter(period => period.status === 'paid').length;
    const calledOff = periods.filter(period => period.status === 'cancelled').length;
    if (left.length === 0) return null;

    if (left.length === 1 && calledOff === 0) {
      const count = (row.plan ?? orderFor(row).plan)?.installmentCount || periods.length;
      return t('payments.plan.one_left')
        .replace('{n}', String(left[0].installmentNumber))
        .replace('{count}', String(count));
    }

    return [
      left.length === 1
        ? t('payments.plan.left_one')
        : t('payments.plan.left').replace('{n}', String(left.length)),
      paid > 0 ? t('payments.plan.paid').replace('{n}', String(paid)) : null,
      calledOff > 0 ? t('payments.plan.called_off').replace('{n}', String(calledOff)) : null,
    ]
      .filter(Boolean)
      .join(' · ');
  };

  /*
   * ── WHERE ELSE THIS ORDER APPEARS ──────────────────────────────────────────
   *
   * One order can sit in up to three groups: its received part under Paid,
   * its refund under Money you returned, its unpaid plan payments under
   * Waiting. Each slice is right, but nothing on the row said so, and testers
   * read the group counts as double counting. Each row now names its siblings
   * and their amounts.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const slicesByOrder = useMemo(() => {
    const map = new Map<string, Array<{ key: string; group: MoneyGroup; amount: number }>>();
    for (const group of ['waiting', 'refunded', 'paid', 'cancelled'] as MoneyGroup[]) {
      for (const row of grouped[group]) {
        const base = baseKeyOf(row);
        const list = map.get(base) ?? [];
        list.push({ key: String(row.key), group, amount: rowAmount(group, row) });
        map.set(base, list);
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- helpers are pure and declared in render
  }, [grouped]);

  /* How many rows each group shows before "show more". WAITING starts open
     because it is the work; the rest start closed because they are history. */
  /**
   * Which figure the reader has narrowed to, or null for all of them.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * The tiles state four amounts and the lists beneath hold the rows behind
   * them, and nothing joined the two: reading "$467.01 collected" and wanting
   * to know WHICH payments meant scrolling four groups and adding up by eye.
   *
   * A tile is the natural control for that — it already names the figure — so
   * it selects its own group. Three rules keep it from becoming a mode somebody
   * gets stuck in: the total clears it, pressing the active tile clears it, and
   * a bar names the filter with a way out beside it.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const [focus, setFocus] = useState<MoneyGroup | null>(null);

  /**
   * The list each tile is made of. `total` is all of them, so it clears.
   *
   * Declared once rather than decided at the click: a tile that filtered to a
   * group whose rows do not add up to it would be worse than no filter at all.
   */
  const TILE_GROUP: Record<string, MoneyGroup | null> = {
    /* Received is Paid AND Refunded together, so like a total it clears. */
    received: null,
    kept: 'paid',
    returned: 'refunded',
    waiting: 'waiting',
  };

  const FIRST_PAGE = 3;
  const [shown, setShown] = useState<Record<MoneyGroup, number>>({
    waiting: FIRST_PAGE,
    /* Closed like Paid: refunds are history, and its one sentence states the
       same figure as its header until somebody asks for the rows. */
    refunded: 0,
    paid: 0,
    cancelled: 0,
  });

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE REMINDER HAS TO SHOW THAT IT WENT.
   *
   * The button called `onResend` and rendered nothing: no pending state, no
   * confirmation, no error. The email went out and the screen was identical
   * before and after, so the only way to find out whether it had worked was to
   * press it again — which sends a second one to the client.
   *
   * `MoneyEntryActions` has exactly this (a `busy` key, a failure line); the
   * raw button here had none because it is not that component.
   *
   * `sent` is not cleared on a timer. The row stays late until the client
   * actually pays, so a confirmation that faded after three seconds would
   * leave the button looking untouched and invite the second send all over
   * again. It stands until the drawer is closed.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const [reminding, setReminding] = useState<string | null>(null);
  const [reminded, setReminded] = useState<Set<string>>(new Set());
  /*
   * WHY NOTHING WENT, ON THE ROW SOMEBODY PRESSED.
   *
   * A chase can legitimately not send: the client already paid, the invoice is
   * not due, there is no address on it. The server returns those as `skipped`,
   * which is the guard working and sometimes good news.
   *
   * In a red banner they read as failures; reported nowhere at all they read
   * as "the email went out". Neither is true, so the sentence sits on the row,
   * in the owner's language, in a tone that matches what happened.
   */
  const [remindOutcome, setRemindOutcome] = useState<
    Record<string, { kind: 'sent' | 'skipped'; message: string }>
  >({});

  const remind = async (item: MoneyItem) => {
    /*
     * THE CHASE, NOT A SECOND COPY OF THE INVOICE.
     *
     * This called `onResend`, which posts to `/invoices/[id]/send` — invoice
     * delivery. A button labelled "send a reminder" therefore sent the client
     * the ORIGINAL invoice again, with no mention that it was late, because
     * the invoice template has no reminder variant.
     *
     * `/chase` is the endpoint the `chase_overdue_invoices` agent's email goes
     * through, so a late invoice now says the same thing whoever sent it.
     */
    const invoiceId = item.entries.find(e => e.invoiceId)?.invoiceId;
    if (!invoiceId) return;

    setReminding(item.key);
    try {
      const response = await fetch(`/api/payments/invoices/${invoiceId}/chase`, {
        method: 'POST',
        credentials: 'include',
      });
      const payload = await response.json();

      if (!payload?.success) {
        /*
         * A SKIP IS NOT A FAILURE. The route classifies it into a code, so
         * this reads the code rather than matching on an English sentence
         * written for a log line. A real failure still goes to the banner,
         * which is where errors live.
         */
        if (payload?.skipped) {
          setRemindOutcome(prev => ({
            ...prev,
            [item.key]: {
              kind: 'skipped',
              message: t('payments.chase.' + (payload.code ?? 'other')),
            },
          }));
          /* Most often the client has paid since this list was drawn, so
             refresh and let the row move to its real group. */
          onMoneyChanged?.();
          return;
        }
        setRefundError(String(payload?.error || t('payments.remind_failed')));
        return;
      }

      setReminded(prev => new Set(prev).add(item.key));
      setRemindOutcome(prev => ({
        ...prev,
        [item.key]: { kind: 'sent', message: t('payments.remind_sent') },
      }));
      /* The invoice's `last_chased` moved; the list should say so. */
      onMoneyChanged?.();
    } catch {
      /* The shared banner above the list, which is already the place this
         section reports a failed action. */
      setRefundError(t('payments.remind_failed'));
    } finally {
      setReminding(null);
    }
  };

  /*
   * Titles that more than one row shares, so the rows that need a tie-breaker
   * can ask for one and the rest stay clean.
   */
  const ambiguousTitles = useMemo(() => {
    const seen = new Map<string, number>();
    for (const item of moneyItems) {
      seen.set(item.title, (seen.get(item.title) ?? 0) + 1);
    }
    return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([title]) => title));
  }, [moneyItems]);

  const daysLate = (due: string | null | undefined): number => {
    if (!due) return 0;
    const ms = Date.now() - new Date(due).getTime();
    return ms > 0 ? Math.floor(ms / 86_400_000) : 0;
  };

  /*
   * `silent` skips the loading state, for a refresh after an action.
   *
   * A refund used to blank this list back to skeletons and rebuild it, which
   * reads as the section reloading rather than a number changing — and on a
   * slow request the row the owner was looking at simply vanished for a moment.
   * The first load still shows the loading state; a refresh just swaps the
   * figures underneath.
   */
  const fetchInvoices = async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!silent) setLoadingInvoices(true);
    try {
      /*
       * `no-store`, and this is the whole reason the refund did not appear.
       *
       * The refetch goes to the same URL that was just fetched, so without this
       * it is answered from cache — the request completes, the state is set to
       * exactly what it already held, and the list shows the refund has not
       * happened. The money HAD moved; only this view disagreed.
       */
      const response = await fetch(`/api/payments/invoices?contact_id=${contactId}`, {
        cache: 'no-store',
      });
      const data = await response.json();
      if (data.success) {
        setInvoices(data.data || []);
      }
    } catch (error) {
      logger.error({ err: error, contactId }, 'Failed to fetch invoices');
    } finally {
      if (!silent) setLoadingInvoices(false);
    }
  };

  const fetchPayments = async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!silent) setLoadingPayments(true);
    try {
      const response = await fetch(`/api/payments/transactions?contact_id=${contactId}`, {
        cache: 'no-store',
      });
      const data = await response.json();
      if (data.success) {
        setPayments(data.data || []);
      }
    } catch (error) {
      logger.error({ err: error, contactId }, 'Failed to fetch payments');
    } finally {
      if (!silent) setLoadingPayments(false);
    }
  };

  /*
   * Plan periods come from the money endpoint, which already assembles them.
   *
   * Re-querying `payment_plan_installments` here would be a second copy of that
   * logic, and the two would drift — which is exactly how this surface ended up
   * without plans while the payments page had them. Only the plan data is taken;
   * the rows themselves are still grouped client-side, because the labels have
   * to be phrased in the reader's language and the server does not know it.
   */
  const fetchPlans = async () => {
    try {
      // The drawer above asks for this too; both get one request.
      const data = await fetchContactMoney(contactId);
      if (!data.success) return;

      const byBooking: Record<string, MoneyPlan> = {};
      /* The booking each plan belongs to, taken in the same pass. See
         `moneyOnlyBookings`: without the booking, the plan is dropped. */
      const carriers: { id: string; title: string; startTime: string | null }[] = [];

      for (const item of data.data?.items ?? []) {
        if (!item.bookingId || !item.plan) continue;

        byBooking[item.bookingId] = item.plan;
        carriers.push({
          id: item.bookingId,
          /* The endpoint's own title — the service name it grouped under. The
             fallback is never reached in current data and keeps a row from
             rendering nameless if it ever is. */
          title: typeof item.title === 'string' && item.title
            ? item.title
            : t('crm.session') || 'Session',
          startTime: typeof item.date === 'string' ? item.date : null,
        });
      }

      setPlansByBookingId(byBooking);
      setMoneyOnlyBookings(carriers);
    } catch (error) {
      // Not fatal: the list still shows what was collected, just without the
      // schedule beside it.
      logger.error({ err: error, contactId }, 'Failed to fetch payment plans');
    }
  };

  // Load data when section opens or tab changes
  const handleToggle = (open: boolean) => {
    onToggle?.(open);
  };

  // Fetch data when section opens or active tab changes
  // Both sources, because the list is one list. Fetching per tab is what made
  // the totals unaddable before — each half only knew about itself.
  useEffect(() => {
    if (!isOpen) return;
    if (invoices.length === 0) fetchInvoices();
    if (payments.length === 0) fetchPayments();
    if (Object.keys(plansByBookingId).length === 0) fetchPlans();
  }, [isOpen]);

  // Refresh data when onInvoiceCreated is called
  useEffect(() => {
    if (onInvoiceCreated && isOpen) {
      fetchInvoices({ silent: true });
      fetchPayments({ silent: true });
    }
  }, [onInvoiceCreated]);


  /**
   * The same actions as the reports list. Duplicating the CALLBACKS but not the
   * behaviour: both call the same endpoints, so an invoice sent from the drawer
   * and one sent from reports do exactly the same thing.
   */
  const entryHandlers = buildEntryActions({
    // Silent for the same reason as the refund: these run AFTER an action —
    // sending, voiding, marking paid — and blanking the list to skeletons makes
    // a successful action look like the section fell over.
    refresh: async () => {
      await fetchInvoices({ silent: true });
      await fetchPayments({ silent: true });
      onMoneyChanged?.();
    },
    t,
    onRefund: (entry: MoneyEntry) => {
      /*
       * The ENTRY, not an invoice looked up from it.
       *
       * This did `invoices.find(i => i.id === entry.invoiceId)` and opened the
       * modal only `if (target)`. A standalone payment carries
       * `invoiceId: null`, so for every payment-without-an-invoice row the
       * lookup found nothing, no modal opened, and nothing was said — the menu
       * offered Refund and the click went nowhere.
       */
      setRefundEntry(entry);
    },
  });

  const formatCurrency = (amount: number, currency: string = 'USD') => {
    return new Intl.NumberFormat(language || 'en', {
      style: 'currency',
      currency: currency.toUpperCase()
    }).format(amount);
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString(language || 'en', timeZoneOptions({
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    }));
  };

  const translatePaymentMethod = (method: string | null): string => {
    if (!method) return '-';

    // If already in Hebrew (contains Hebrew characters), return as-is
    const hebrewRegex = /[\u0590-\u05FF]/;
    if (hebrewRegex.test(method)) return method;

    // Translation map
    const translations: Record<string, Record<string, string>> = {
      he: {
        'card': 'כרטיס אשראי',
        'credit_card': 'כרטיס אשראי',
        'debit_card': 'כרטיס חיוב',
        'bank_transfer': 'העברה בנקאית',
        'wire_transfer': 'העברה בנקאית',
        'bit': 'ביט',
        'paypal': 'פייפאל',
        'cash': 'מזומן',
        'check': 'צ\'ק',
        'cheque': 'צ\'ק'
      },
      es: {
        'card': 'Tarjeta',
        'credit_card': 'Tarjeta de crédito',
        'debit_card': 'Tarjeta de débito',
        'bank_transfer': 'Transferencia bancaria',
        'wire_transfer': 'Transferencia bancaria',
        'bit': 'Bit',
        'paypal': 'PayPal',
        'cash': 'Efectivo',
        'check': 'Cheque',
        'cheque': 'Cheque'
      }
    };

    const methodLower = method.toLowerCase();
    const langTranslations = translations[language || 'en'];

    if (langTranslations && langTranslations[methodLower]) {
      return langTranslations[methodLower];
    }

    // Capitalize first letter if no translation found
    return method.charAt(0).toUpperCase() + method.slice(1);
  };

  return (
    <>
      {/* `count` was passed here before and is not a prop this component has,
          so it was silently ignored. `badge` is — and it can say something worth
          reading: what is still owed is the reason to open this section. */}
      <CollapsibleSection
        title={t('crm.drawer.payments') || 'Payments & Invoices'}
        icon={<Receipt className="h-4 w-4" />}
        badge={
          moneyItems.length > 0 && (
            <span className="text-xs text-[var(--v2-text-muted)]">
              {totals.outstanding > 0 ? (
                <span className="text-amber-500">
                  {/* The same words as the tile it summarises. */}
                  {t('payments.badge.still_to_collect').replace(
                    '{amount}',
                    formatCurrency(totals.outstanding, moneyItems[0].currency)
                  )}
                </span>
              ) : (
                <span>{formatCurrency(totals.collected, moneyItems[0].currency)}</span>
              )}
            </span>
          )
        }
        isOpen={isOpen}
        onToggle={handleToggle}
        isRTL={isRTL}
      >
        {/* Tabs */}
        {/* ONE list, grouped by booking.
            Invoices and Payments were separate sub-tabs, which showed a paid
            invoice twice — once as the invoice and again as the payment that
            settled it — and left the reader to work out they were the same
            money. The grouping is in buildMoneyItems, where it is tested. */}
        <div className="space-y-2" dir={isRTL ? 'rtl' : 'ltr'}>
          {loadingInvoices || loadingPayments ? (
            <div className="text-center py-8 text-[var(--v2-text-muted)]">
              <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin mx-auto mb-2" style={{ borderColor: '#8B5CF6', borderTopColor: 'transparent' }}></div>
              {t('common.loading') || 'Loading...'}
            </div>
          ) : moneyItems.length === 0 ? (
            <div className="text-center py-8 text-[var(--v2-text-muted)]">
              <Receipt className="h-12 w-12 mx-auto mb-2 opacity-20" />
              <p className="text-sm">{t('payments.no_money_yet') || 'Nothing billed yet'}</p>
            </div>
          ) : (
            <>
              {/* What the list adds up to. Summed over entries, never rows, so a
                  booking with two invoices is not counted twice. */}
              {/*
                ───────────────────────────────────────────────────────────────
                ONE SENTENCE, BEFORE ANY LIST.

                This was four figures in a row — collected, outstanding,
                refunded, cancelled — with no indication which of them was a
                problem. The reader had to add two of them up by eye to answer
                the only question they came with: does this client owe me
                anything, and is any of it late.

                So the answer is written out. If they read nothing else on this
                tab, they know whether today needs them.

                CANCELLED IS NOT IN IT. `totals.cancelled` has always been its
                own number; printing it beside `collected` invited the reader to
                add them, and a cancelled invoice is not money — not collected,
                not owed, never will be. It has its own group below, which says
                so in as many words.
                ───────────────────────────────────────────────────────────────
              */}
              {/*
                ───────────────────────────────────────────────────────────────
                A TOTAL, AND WHERE IT WENT.

                This opened with the DEBT — "Tal Omer owes you $407.04" — and
                then named the takings, so the reader met the parts before the
                whole and had to add them up to find out how much this client
                was worth at all. The figure they actually start from, what the
                client has bought, was never on the screen.

                So the sentence now states the total first and then accounts
                for it, in the order an owner checks: what has arrived, what
                went back, what is still to come. The three add up to the total
                exactly, which is what makes it checkable at a glance.

                Each clause is a WHOLE SENTENCE with one amount in it, and is
                dropped when its figure is zero. Two reasons, both learned the
                hard way: a clause ending in a comma leaves "You have collected
                $120.00," hanging when the client has no refunds and owes
                nothing, and clauses that join with "and" force every language
                into English word order. The alternative — one string per
                combination of "are there refunds" and "is anything owed" — is
                four near-identical sentences in each of three languages.

                CANCELLED IS STILL NOT IN IT. A called-off order is not a sale:
                not collected, not owed, never will be. It keeps its own group
                below, which says so in as many words.
                ───────────────────────────────────────────────────────────────
              */}
              <p className="m-0 px-1 text-[15px] font-semibold leading-relaxed text-[var(--v2-text-primary)]">
                {(() => {
                  const currency = moneyItems[0].currency;
                  const money = (value: number) => formatCurrency(value, currency);
                  const clause = (key: string, value: number, colour?: string) => (
                    <Fragment key={key}>
                      {t(`payments.answer.${key}`)
                        .split('{amount}')
                        .flatMap((part, i) =>
                          i === 0
                            ? [part]
                            : [
                                <span key="a" style={colour ? { color: colour } : undefined}>
                                  {money(value)}
                                </span>,
                                part,
                              ]
                        )}
                      {' '}
                    </Fragment>
                  );

                  /*
                   * ── RECEIVED, REFUNDED, KEPT ─────────────────────────────
                   *
                   * This opened "{name} has bought {total}", where the total
                   * included money already refunded, then "You have collected"
                   * a figure taken AFTER refunds. Neither matched what the
                   * owner sees in Stripe, so testers could not reproduce either.
                   *
                   * Now it follows the money in the order it moved: what came
                   * in (gross, the processor's figure), what went back, and so
                   * what was kept. Received − refunded = kept, exactly, and the
                   * tiles below repeat those same three figures.
                   */
                  const received = totals.collected + totals.refunded;
                  /* A template with several `{placeholders}`, each filled
                     with a coloured figure, in whatever order the language
                     puts them. */
                  const fill = (key: string, values: Record<string, ReactNode>) =>
                    t(key)
                      .split(/(\{[a-z_]+\})/)
                      .map((part, i) => {
                        const name = part.match(/^\{([a-z_]+)\}$/)?.[1];
                        return name && name in values ? (
                          <Fragment key={i}>{values[name]}</Fragment>
                        ) : (
                          part
                        );
                      });

                  return (
                    <>
                      {received > 0 && (
                        <>
                          {fill('payments.answer.paid_you', {
                            name: contactName,
                            amount: <span>{money(received)}</span>,
                          })}{' '}
                        </>
                      )}
                      {totals.refunded > 0 && (
                        <>
                          {fill('payments.answer.refunded_kept', {
                            refunded: (
                              <span style={{ color: STATUS_TONE.refunded }}>
                                {money(totals.refunded)}
                              </span>
                            ),
                            kept: (
                              <span style={{ color: STATUS_TONE.paid }}>
                                {money(totals.collected)}
                              </span>
                            ),
                          })}{' '}
                        </>
                      )}
                      {totals.outstanding > 0 &&
                        clause('still_owed', totals.outstanding, STATUS_TONE.awaiting_payment)}
                      {/* Late money is a different problem from owed money, and
                          the only one with a deadline behind it. */}
                      {totals.overdue > 0 && (
                        <span style={{ color: STATUS_TONE.overdue }}>
                          {t('payments.answer.of_which_late_plain').replace(
                            '{amount}',
                            money(totals.overdue)
                          )}
                        </span>
                      )}
                    </>
                  );
                })()}
              </p>

              {/* The three figures that are actually money, each labelled in
                  the reader's own words rather than an accounting term.

                  `pt-3`, not `pt-1`: the sentence above states the same two
                  figures these tiles repeat, and with a single step between
                  them the tiles read as a continuation of the sentence rather
                  than as a summary of it. */}
              {/* ONE ROW, never wrapping: the four read as a sum left to right
                  (Received − Refunded = Kept, then what is owed), and a tile
                  pushed onto a second line breaks the sentence they make. */}
              <div className="flex gap-2 px-1 pt-3">
                {(
                  [
                    /* The same three colours the bar and the chips use, so a
                       figure here and a dot below cannot describe one state
                       two ways. */
                    /*
                     * ── A TOTAL, THEN THE THREE PARTS OF IT ─────────────────
                     *
                     * The tiles were Waiting · Received · Returned · Yours, and
                     * two of those four are the same money seen twice:
                     * `Received` was the gross and `Yours` the same figure with
                     * the refunds taken off. Four tiles, three facts, and the
                     * one an owner starts from — what this client has bought at
                     * all — was not among them.
                     *
                     * Now the first tile is the whole and the rest are its
                     * parts, in the order the money moves:
                     *
                     *     total  =  collected  +  returned  +  still owed
                     *
                     * They add up exactly, so the row can be checked at a
                     * glance rather than believed.
                     *
                     * Cancelled is deliberately outside all four: a called-off
                     * order was never a sale. It has its own group below.
                     * ────────────────────────────────────────────────────────
                     */
                    /*
                     * ── RECEIVED − REFUNDED = KEPT, THEN WHAT IS STILL OWED ──
                     *
                     * Replaced Total sales · Collected · Refunded · Still to
                     * collect. "Total sales" counted refunded money as sold,
                     * and "Collected" was net of refunds while reading like
                     * the gross, so neither matched the processor. Received
                     * is the gross (what Stripe shows), Kept is what stayed.
                     */
                    [
                      'received',
                      totals.collected + totals.refunded,
                      'var(--v2-text-primary)',
                    ],
                    ['returned', totals.refunded, STATUS_TONE.refunded],
                    ['kept', totals.collected, STATUS_TONE.paid],
                    ['waiting', totals.outstanding, STATUS_TONE.awaiting_payment],
                  ] as Array<[string, number, string]>
                )
                  .filter(([, value]) => value > 0)
                  .map(([key, value, colour]) => {
                    /* Which list this figure is made of. The total is not one
                       group but all of them, so it clears the filter. */
                    const group = TILE_GROUP[key];
                    const active = group !== null && focus === group;

                    return (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setFocus(active || group === null ? null : group)}
                      className="flex-1 cursor-pointer rounded-xl border px-2.5 py-2 text-start transition-colors"
                      style={{
                        /* 0, not a floor: a floor is what wrapped the fourth
                           tile in a drawer-width column. */
                        minWidth: 0,
                        /*
                         * THE ONE THAT NEEDS THEM IS TINTED, and the two that
                         * do not are plain.
                         *
                         * Three identically-framed figures ask the reader to
                         * work out which is a problem. Money owed is the only
                         * one that can be acted on, so it carries the warning
                         * colour in its border and a wash of it behind — the
                         * same amber the late rows use, so the eye connects
                         * the figure to the rows that make it up.
                         */
                        /* A selected tile is outlined in its own colour, so
                           the row above and the list below are visibly the
                           same thing rather than two that happen to agree. */
                        /* Kept and Still to collect are the two figures an
                           owner acts on, so both carry their own tint. */
                        borderColor: active
                          ? colour
                          : key === 'waiting' || key === 'kept'
                            ? `color-mix(in srgb, ${colour} 45%, var(--v2-border))`
                            : 'var(--v2-border)',
                        background: active
                          ? `color-mix(in srgb, ${colour} 10%, transparent)`
                          : key === 'waiting' || key === 'kept'
                            ? `color-mix(in srgb, ${colour} 8%, transparent)`
                            : 'transparent',
                      }}
                    >
                      <p className="m-0 text-[11.5px] text-[var(--v2-text-secondary)]">
                        {t(`payments.stat.${key}`)}
                      </p>
                      <p
                        className="m-0 truncate text-[16px] font-bold"
                        style={{ color: colour, fontVariantNumeric: 'tabular-nums' }}
                      >
                        {/* A minus on Refunded, so the row reads as the sum it is. */}
                        {key === 'returned' ? '−' : ''}
                        {formatCurrency(value, moneyItems[0].currency)}
                      </p>
                    </button>
                    );
                  })}
              </div>

              {/* HOW THE TILES RELATE, said once in words, so nobody has to
                  infer the arithmetic or check it against Stripe by hand. */}
              <p
                className="mx-1 mt-2 mb-0 flex items-start gap-2 rounded-lg px-2.5 py-2 text-[12px]"
                style={{
                  color: STATUS_TONE.paid,
                  background: `color-mix(in srgb, ${STATUS_TONE.paid} 8%, transparent)`,
                }}
              >
                <span className="font-bold">{t('payments.tiles_note.label')}</span>
                <span>{t('payments.tiles_note.body')}</span>
              </p>

              {/*
                ── CALLED OFF, BESIDE THE TOTAL RATHER THAN INSIDE IT ─────────

                A third of this contact's activity was cancelled, and both
                obvious placements are wrong. In the row above it invites
                adding, and "total sales" then exceeds anything that could ever
                reach the bank. Left out entirely it has no figure anywhere near
                the summary — which is the state that was reported, a number the
                page stated and nothing accounted for.

                So: past a dashed rule, in its own words, and still a tile —
                which is what makes it selectable like the rest.
              */}
              {totals.cancelled > 0 && (
                <div
                  /* The note and its figure side by side, so the reason sits
                     next to the money it explains. */
                  className="mx-1 mt-2 flex items-center gap-3 border-t border-dashed pt-2.5"
                  style={{ borderColor: 'var(--v2-border)' }}
                >
                  <p className="m-0 flex-1 text-[11.5px] text-[var(--v2-text-muted)]">
                    {t('payments.stat.cancelled_note')}
                  </p>
                  <button
                    type="button"
                    aria-pressed={focus === 'cancelled'}
                    onClick={() => setFocus(focus === 'cancelled' ? null : 'cancelled')}
                    className="cursor-pointer rounded-xl border px-3 py-2 text-start transition-colors"
                    style={{
                      minWidth: '120px',
                      borderColor:
                        focus === 'cancelled' ? STATUS_TONE.cancelled : 'var(--v2-border)',
                      background:
                        focus === 'cancelled'
                          ? `color-mix(in srgb, ${STATUS_TONE.cancelled} 10%, transparent)`
                          : 'transparent',
                    }}
                  >
                    <p className="m-0 text-[11.5px] text-[var(--v2-text-secondary)]">
                      {t('payments.stat.cancelled')}
                    </p>
                    <p
                      className="m-0 text-[17px] font-bold"
                      style={{ color: STATUS_TONE.cancelled, fontVariantNumeric: 'tabular-nums' }}
                    >
                      {formatCurrency(totals.cancelled, moneyItems[0].currency)}
                    </p>
                  </button>
                </div>
              )}

              {/* What is being shown, and the way back. Only while narrowed:
                  a bar that is always there is furniture. */}
              {focus && (
                <div
                  className="mx-1 mt-3 flex items-center gap-2 rounded-lg border border-dashed px-3 py-1.5 text-[12.5px] text-[var(--v2-text-muted)]"
                  style={{ borderColor: 'var(--v2-border)' }}
                >
                  <span>
                    {t('payments.filter.showing').replace('{group}', t(`payments.group.${focus}`))}
                  </span>
                  <button
                    type="button"
                    onClick={() => setFocus(null)}
                    className="ms-auto cursor-pointer rounded-full border px-2.5 py-0.5 text-[11px] font-semibold text-[var(--v2-text-primary)]"
                    style={{ borderColor: 'var(--v2-border)' }}
                  >
                    {t('payments.filter.show_all')}
                  </button>
                </div>
              )}

              {/*
                ───────────────────────────────────────────────────────────────
                FOUR GROUPS, EACH WRITTEN AS A SENTENCE.

                The old list sorted by bookings-then-other and printed a status
                chip on every row. Both are facts ABOUT the record rather than
                about the money: "is this attached to a booking" is not a
                question anybody asks, and the status was already said by the
                amount's colour and the line beneath it.
                ───────────────────────────────────────────────────────────────
              */}
              {(
                [
                  ['waiting', 'd-warn'],
                  ['refunded', 'd-mute'],
                  ['paid', 'd-good'],
                  ['cancelled', 'd-mute'],
                ] as Array<[MoneyGroup, string]>
              ).map(([group]) => {
                const rows = grouped[group];
                if (rows.length === 0) return null;
                /* Narrowed to another figure: this group is not what was asked
                   for. The rows are untouched, only hidden. */
                if (focus && focus !== group) return null;

                /*
                 * ── EACH LIST STATES THE FIGURE IT IS MADE OF ───────────────
                 *
                 * The tiles above and these rows are the same money counted
                 * twice, and nothing said so — which is how a tile reading
                 * $467.01 sat above rows totalling $397.01 without anybody
                 * noticing for weeks. Printed here, the two are checkable at a
                 * glance, and from the SAME function the tile uses rather than
                 * a sum written out a second time.
                 */
                const groupTotal = rows.reduce((sum, item) => {
                  const flow = itemFlow(item);
                  if (group === 'paid') return sum + flow.collected;
                  if (group === 'refunded') return sum + flow.refunded;
                  if (group === 'cancelled') return sum + flow.cancelled;
                  return sum + outstandingOf(item);
                }, 0);

                const limit = shown[group];
                const visibleRows = rows.slice(0, limit);
                const rest = rows.length - visibleRows.length;

                /* PAID, REFUNDED and CANCELLED collapse to one sentence until
                   asked for. Six settled payments are six rows of nothing to do. */
                const quiet = group === 'paid' || group === 'refunded' || group === 'cancelled';
                /*
                 * The collapsed sentence states `groupTotal`, the header's own
                 * figure. It summed `amount - refunded`, which on a part-paid
                 * plan is the WHOLE agreement: Tal's Paid section read "$1,363.10
                 * received" under a $713.03 header, $650.07 of it plan payments
                 * that were called off or not yet made.
                 */
                /* Distinct orders, not rows: a half-row is a slice of one. */
                const orderCount = new Set(rows.map(baseKeyOf)).size;
                /* What was called off, piece by piece: each invoice voided and
                   each plan payment stopped before it was invoiced. */
                const calledOffCount =
                  group === 'cancelled'
                    ? rows.reduce(
                        (sum, item) =>
                          sum +
                          item.entries.filter(
                            entry =>
                              itemFlow({ ...item, plan: undefined, entries: [entry] }).cancelled > 0
                          ).length +
                          (item.plan?.periods ?? []).filter(
                            period => cancelledPlanMoneyOf(period) > 0
                          ).length,
                        0
                      )
                    : 0;

                return (
                  <div key={group} className="mt-4">
                    <div className="mb-1.5 flex items-center gap-2">
                      <h4 className="m-0 text-[13.5px] font-bold text-[var(--v2-text-primary)]">
                        {t(`payments.group.${group}`)}
                      </h4>
                      <span
                        className="rounded-full border px-2 py-px text-[11px] font-bold text-[var(--v2-text-secondary)]"
                        style={{ borderColor: 'var(--v2-border)', fontVariantNumeric: 'tabular-nums' }}
                      >
                        {t(orderCount === 1 ? 'payments.group.orders_one' : 'payments.group.orders').replace(
                          '{n}',
                          String(orderCount)
                        )}
                      </span>
                      <span
                        className="ms-auto text-[13px] font-bold"
                        style={{
                          color:
                            group === 'paid'
                              ? STATUS_TONE.paid
                              : group === 'refunded'
                                ? STATUS_TONE.refunded
                                : group === 'cancelled'
                                  ? STATUS_TONE.cancelled
                                  : STATUS_TONE.awaiting_payment,
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {formatCurrency(groupTotal, rows[0].currency)}
                      </span>
                    </div>

                    <p className="m-0 mb-1 text-[11px] text-[var(--v2-text-muted)]">
                      {t(`payments.group.${group}_why`)}
                    </p>

                    {quiet && limit === 0 ? (
                      <div
                        className="flex items-center gap-2 rounded-xl border border-dashed px-3 py-2.5 text-[12.5px] text-[var(--v2-text-muted)]"
                        style={{ borderColor: 'var(--v2-border)' }}
                      >
                        <span className="flex-1">
                          {group === 'paid'
                            ? t('payments.quiet.paid')
                                .replace('{amount}', formatCurrency(groupTotal, rows[0].currency))
                                .replace('{n}', String(orderCount))
                            : group === 'refunded'
                              ? t('payments.quiet.refunded')
                                  .replace('{amount}', formatCurrency(groupTotal, rows[0].currency))
                                  .replace('{n}', String(orderCount))
                              : (
                              /*
                               * THE CANCELLED FIGURE, AND WHY IT IS HERE.
                               *
                               * It used to sit in the summary strip beside
                               * `collected`, which invited the reader to add
                               * them — and cancelled money is not money: never
                               * collected, never owed, never will be.
                               *
                               * Dropping it entirely was worse, and
                               * `paymentsSummaryShowsEveryBucket` says why: it
                               * is `totalMoney`'s own bucket, counted in no
                               * other, so omitting it makes a client who called
                               * off half their work read as one who was never
                               * billed for it.
                               *
                               * So the figure stays, in the one group that
                               * cannot be mistaken for spendable money, under a
                               * heading that says it counts towards nothing
                               * above. It is the header's figure now, like
                               * every other group; this line says what it is
                               * made of. It said "N cancelled invoices" while
                               * the money was plan payments stopped before any
                               * invoice existed, so it counts the pieces called
                               * off and calls them payments, which covers both.
                               */
                              <>
                                {t(
                                  calledOffCount === 1
                                    ? 'payments.quiet.cancelled_one'
                                    : 'payments.quiet.cancelled'
                                )
                                  .replace('{count}', String(calledOffCount))
                                  .replace('{n}', String(orderCount))}
                              </>
                            )}
                        </span>
                        <button
                          type="button"
                          onClick={() => setShown(s => ({ ...s, [group]: FIRST_PAGE }))}
                          className="shrink-0 rounded-lg border px-2.5 py-1 text-[11.5px] font-semibold"
                          style={{ borderColor: 'var(--v2-border)', color: 'var(--v2-text-secondary)' }}
                        >
                          {t('payments.show')}
                        </button>
                      </div>
                    ) : (
                      <>
                        {visibleRows.map(item => {
                          const late = String(item.status) === 'overdue';
                          const n = late ? daysLate(item.date) : 0;
                          /*
                           * WHAT IS STILL OWED, NOT THE GROSS.
                           *
                           * This read `amount - refunded`, which on a payment
                           * PLAN is the whole agreement: a ₪1,200 plan with
                           * ₪400 already collected sat in "waiting for money"
                           * saying ₪1,200. The owner is owed ₪800, and the
                           * drawer one click away said so.
                           *
                           * `itemFlow` is the function that works this out,
                           * entry by entry, and the drawer's own bar already
                           * reads it. A second subtraction here could only
                           * ever be a different answer to the same question.
                           * It now lives in `rowAmount`, which every group's
                           * row figure and "also listed under" both read.
                           */

                          return (
                            <div
                              key={item.key}
                              /* A CARD PER ROW, as the agreed mockup draws it:
                                 the title leads, the figure sits at the end in
                                 its status colour. The status dot is gone;
                                 the figure carries that colour instead, from
                                 the same `scheduleTone`. */
                              className="mt-2 flex items-start gap-2.5 rounded-xl border px-3 py-2.5"
                              style={{ borderColor: 'var(--v2-border)' }}
                            >
                              <div className="min-w-0 flex-1">
                                {/* THE AMOUNT AND WHAT IT IS FOR, first and in
                                    that order — how the reader holds it in
                                    their head. The invoice number moved into
                                    the drawer, where somebody has already
                                    asked about this one. */}
                                <p className="m-0 flex items-baseline gap-x-2 text-[13.5px] font-semibold">
                                  <span
                                    className="min-w-0 truncate text-[var(--v2-text-primary)]"
                                    style={{ unicodeBidi: 'plaintext' }}
                                  >
                                    {item.title}
                                  </span>
                                  {/*
                                    THE INVOICE NUMBER, ONLY WHERE THE TITLE
                                    DOES NOT TELL THEM APART.

                                    Numbers were deliberately moved into the
                                    drawer: a reader scanning their money does
                                    not think in `INV-00059`. But two bookings
                                    of the same service, due the same day, for
                                    the same amount produce two rows that are
                                    identical in every visible character — and
                                    then the owner cannot tell which one they
                                    just reminded somebody about.

                                    So it appears exactly when it is the only
                                    thing that differs, and stays out of the
                                    way the rest of the time. Quiet and small:
                                    it is a tie-breaker, not a heading.
                                  */}
                                  {ambiguousTitles.has(item.title) &&
                                    item.entries.find(e => e.invoiceNumber)?.invoiceNumber && (
                                      <span className="text-[11px] text-[var(--v2-text-muted)]">
                                        {item.entries.find(e => e.invoiceNumber)?.invoiceNumber}
                                      </span>
                                    )}
                                  {/*
                                    THE FIGURE, AT THE END, IN ITS STATUS COLOUR.

                                    Always an explicit colour, never inherited:
                                    an inherited one once rendered black on a
                                    dark surface. `scheduleTone` is the shared
                                    palette the removed dot used, so late reads
                                    red, waiting amber, paid green.
                                  */}
                                  <span
                                    className="ms-auto shrink-0 font-bold"
                                    style={{
                                      color: scheduleTone(String(item.status)),
                                      fontVariantNumeric: 'tabular-nums',
                                    }}
                                  >
                                    {formatCurrency(rowAmount(group, item), item.currency)}
                                  </span>
                                </p>

                                {/* ONE LINE SAYING WHERE IT STANDS, in time
                                    rather than in vocabulary. */}
                                <p className="m-0 mt-0.5 text-[12px] text-[var(--v2-text-secondary)]">
                                  {late ? (
                                    <span
                                      className="font-semibold"
                                      /* DANGER, the colour the drawer gives
                                         money being chased — distinct from
                                         WARNING, which merely waits. */
                                      style={{ color: STATUS_TONE.overdue }}
                                    >
                                      {n === 1
                                        ? t('payments.late_day')
                                        : t('payments.late_days').replace('{n}', String(n))}
                                    </span>
                                  ) : group === 'waiting' && planLine(item) ? (
                                    /* A plan says where the agreement stands,
                                       which is what the owner needs; a plain
                                       invoice keeps its due date below. */
                                    planLine(item)
                                  ) : group === 'waiting' ? (
                                    <>
                                      {t('payments.due_on').replace('{date}', formatDate(item.date))}
                                      {/* "not due yet" is the reassurance that
                                          stops an unpaid row reading as a
                                          problem. Only where the date really
                                          is ahead — otherwise it would argue
                                          with the amber above it. */}
                                      {new Date(item.date).getTime() > Date.now() && (
                                        <span className="opacity-70"> · {t('payments.due_soon')}</span>
                                      )}
                                      {/*
                                        NO "already paid" NOTE HERE, AND THAT
                                        WAS LEARNED THE HARD WAY.
                                        ───────────────────────────────────────
                                        A part-paid order's collected money was
                                        first reported on this line, as
                                        "· $25.00 already paid". On a two-period
                                        plan the halves are usually EQUAL, so
                                        the row read:

                                          $25.00  …  due Nov 10 · $25.00 already paid

                                        Two identical figures, one owed and one
                                        received, with nothing to say which was
                                        which. The owner has to read the line
                                        twice and still guess.

                                        The collected half is a row of its own
                                        under Paid now, which is where money
                                        that arrived belongs. This line stays
                                        about one thing: when the rest is due.
                                      */}
                                    </>
                                  ) : group === 'refunded' ? (
                                    t('payments.returned_on').replace('{date}', formatDate(item.date))
                                  ) : (
                                    t('payments.paid_on').replace('{date}', formatDate(item.date))
                                  )}
                                </p>

                                {/* THE SAME ORDER'S OTHER SLICES, with their
                                    amounts. See `slicesByOrder`. */}
                                {(() => {
                                  const siblings = (slicesByOrder.get(baseKeyOf(item)) ?? []).filter(
                                    slice => slice.key !== String(item.key)
                                  );
                                  if (siblings.length === 0) return null;
                                  const listed = new Intl.ListFormat(language || 'en', {
                                    type: 'conjunction',
                                  }).format(
                                    siblings.map(
                                      slice =>
                                        `${t(`payments.group_short.${slice.group}`)} (${formatCurrency(slice.amount, item.currency)})`
                                    )
                                  );
                                  return (
                                    <p
                                      className="m-0 mt-0.5 text-[11.5px]"
                                      style={{ color: STATUS_TONE.refunded }}
                                    >
                                      {t('payments.also_listed').replace('{groups}', listed)}
                                    </p>
                                  );
                                })()}

                                {/* WHAT HAPPENED, kept apart from what can
                                    happen next. It stands until the drawer is
                                    closed — the row stays late until the client
                                    actually pays, so a note that faded would
                                    leave no trace that anything was sent. */}
                                {remindOutcome[item.key] && (
                                  <p
                                    className="m-0 mt-0.5 text-[11.5px] font-semibold"
                                    style={{
                                      /* Sent is good news and wears the
                                         collected colour. A skip is neither
                                         good nor bad and stays neutral: red
                                         would make "they already paid" look
                                         like something went wrong. */
                                      color:
                                        remindOutcome[item.key].kind === 'sent'
                                          ? STATUS_TONE.paid
                                          : 'var(--v2-text-secondary)',
                                    }}
                                  >
                                    {remindOutcome[item.key].message}
                                  </p>
                                )}
                              </div>

                              {/*
                                A LATE BILL OFFERS THE THING TO DO ABOUT IT.

                                Only on late rows: offering it on a bill due
                                next month is nagging a client who has done
                                nothing wrong.

                                AND ONLY WHERE THE CHASE CAN ACTUALLY GO.
                                ─────────────────────────────────────────────
                                This gate read `entryHandlers.onResend &&
                                item.entries[0]`, from when the button posted
                                to `/invoices/[id]/send`. Both halves were
                                wrong by the time `remind` moved to `/chase`:

                                  · `buildEntryActions` always returns an
                                    `onResend`, so that conjunct was
                                    statically true (ts 2774) and tested
                                    nothing;
                                  · `remind` needs an INVOICE id, and
                                    `entries[0]` only says the row has an
                                    entry. A late standalone payment carries
                                    `invoiceId: null`, so the button drew,
                                    and `remind` returned at its own guard
                                    without a word — a control that cannot
                                    work, which is the one thing a row must
                                    never show.

                                So the gate now asks the question `remind`
                                asks, in the same words.
                              */}
                              {late && item.entries.some(e => e.invoiceId) && (
                                <button
                                  type="button"
                                  onClick={() => void remind(item)}
                                  /*
                                   * DISABLED ONLY WHILE IT IS IN FLIGHT.
                                   *
                                   * It used to stay disabled after a success,
                                   * so a client who ignored the first reminder
                                   * could not be sent a second without
                                   * reloading the drawer. The confirmation
                                   * belongs to what HAPPENED; the button is
                                   * what can happen next, and those are not the
                                   * same thing.
                                   *
                                   * Once sent it goes quiet — outlined rather
                                   * than filled — so the row stops shouting at
                                   * somebody who has already acted, while
                                   * staying available to anyone who means it.
                                   */
                                  disabled={reminding === item.key}
                                  /*
                                   * AND IT PRESSES LIKE EVERY OTHER PRIMARY.
                                   *
                                   * The fill was already the token, but the
                                   * other half was missing: without
                                   * `ap-primary-lift` nothing deepens the fill
                                   * in dark mode, so a white label sat on the
                                   * bare brand orange at about 2.26:1 and read
                                   * as a glow rather than as letters. That is
                                   * the whole reason the class exists and
                                   * cannot be an inline shadow — it answers
                                   * `.dark`. See `app/globals.css`.
                                   *
                                   * The lift is on the FILLED state only. Once
                                   * sent, the button is outlined on
                                   * `transparent`, and a lift under nothing is
                                   * a shadow with no object: the same rule
                                   * <NeedsYouCard> applies to its own settled
                                   * rows.
                                   */
                                  className={
                                    'shrink-0 self-center rounded-lg px-2.5 py-1.5 text-[12px] font-bold transition-all hover:brightness-110 active:scale-[0.97] disabled:opacity-60 disabled:active:scale-100' +
                                    (reminded.has(item.key) ? '' : ' ap-primary-lift')
                                  }
                                  style={
                                    reminded.has(item.key)
                                      ? {
                                          background: 'transparent',
                                          border: '1px solid var(--v2-border)',
                                          color: 'var(--v2-text-secondary)',
                                        }
                                      : { background: 'var(--v2-primary)', color: '#fff' }
                                  }
                                >
                                  {reminding === item.key
                                    ? t('payments.remind_sending')
                                    : t('payments.remind')}
                                </button>
                              )}

                              {/* The SAME drawer as before. The list changed;
                                  what opens from it did not.

                                  `orderFor`, because a settled-half row is one
                                  side of an order and the drawer is about the
                                  order: opening it on the half would hide the
                                  period still owed, which is the thing the
                                  owner most likely opened it to see. */}
                              <button
                                type="button"
                                onClick={() => setDetail(orderFor(item))}
                                className="shrink-0 self-center rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold"
                                style={{
                                  borderColor: 'var(--v2-border)',
                                  color: 'var(--v2-text-secondary)',
                                }}
                              >
                                {t('payments.open')}
                              </button>
                            </div>
                          );
                        })}

                        {rest > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              setShown(s => ({ ...s, [group]: rows.length }))
                            }
                            className="mt-1.5 w-full rounded-lg border border-dashed py-1.5 text-[12px] font-semibold text-[var(--v2-text-secondary)]"
                            style={{ borderColor: 'var(--v2-border)' }}
                          >
                            {t('payments.more_n').replace('{n}', String(rest))}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      </CollapsibleSection>

      {refundError && (
        <div className="mb-2 flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-[11.5px] text-red-600">
          <span className="flex-1">{refundError}</span>
          <button onClick={() => setRefundError(null)} className="shrink-0 underline">
            {t('common.dismiss') || 'Dismiss'}
          </button>
        </div>
      )}

      <MoneyOrderDrawer
        item={detail}
        /* The client's refund request behind this booking, where there is one.
           Looked up by booking because that is how a request names what it is
           about — a client thinks "the session I missed", never a payment id. */
        refundAsk={detail?.bookingId ? (asksByBooking.get(detail.bookingId) ?? null) : null}
        onClose={() => setDetail(null)}
        /*
          No `onOpenBooking` and no `onOpenContact`, so the footer carries
          neither button. Both are money-page destinations: the reader here is
          already inside the client's record, and offering to take them to the
          client's card is a button that leads to the page they are on.
        */
        t={t}
        isRTL={isRTL}
        formatCurrency={formatCurrency}
        formatDate={formatDate}
        /* The drawer's Stop-plan button was rendering here already — this is
           the same component the orders page uses — but with nothing wired to
           it the plan stayed reading "active" after being stopped, which looks
           exactly like the button not working. */
        onPlanCancelled={() => {
          setDetail(null);
          fetchPlans();
          fetchPayments({ silent: true });
          fetchInvoices({ silent: true });
          onMoneyChanged?.();
        }}
        onActionError={message => setRefundError(message)}
        {...entryHandlers}
      />

      {refundEntry && (
        <RefundModal
          isOpen={!!refundEntry}
          onClose={() => setRefundEntry(null)}
          /* An invoice when there is one — the server resolves which payment
             sits behind it — otherwise the payment itself. */
          invoiceId={refundEntry.invoiceId ?? undefined}
          transactionId={refundEntry.invoiceId ? undefined : refundEntry.transactionIds[0]}
          originalAmount={refundEntry.amount}
          currency={refundEntry.currency}
          alreadyRefunded={refundEntry.refunded}
          isRTL={isRTL}
          onSuccess={() => {
            setRefundEntry(null);
            /*
             * BOTH halves, silently. Refreshing only the invoices left the
             * payments side of this merged list showing the refund had not
             * happened; showing skeletons while it reloads makes a refund look
             * like the section broke.
             */
            fetchInvoices({ silent: true });
            fetchPayments({ silent: true });
            // And the plans: a refund can now stop the payment plan behind the
            // booking, which changes the schedule shown beside it.
            fetchPlans();
            // And the journey, which draws the same figures a section above.
            onMoneyChanged?.();
          }}
          // Without this a refused refund — 409 NOTHING_REMAINING,
          // ACCOUNT_UNRESOLVED, a 502 from the processor — left the dialog open
          // with the spinner off and nothing said, which reads as "nothing
          // happened" rather than "your money did not move".
          onError={message => setRefundError(message)}
        />
      )}
    </>
  );
}
