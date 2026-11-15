'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Receipt, CreditCard, Plus, DollarSign, Calendar, ExternalLink, FileText, RotateCcw } from 'lucide-react';
import { RefundModal } from '@/components/payments/RefundModal';
import { createLogger } from '@/lib/logger';
import { buildMoneyItems, itemFlow, totalMoney, type MoneyEntry, type MoneyItem, type MoneyPlan } from '@/lib/payments/moneyItems';
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
        bookings: sessions.map(session => ({
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
    [invoices, payments, sessions, contactId, plansByBookingId, t]
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

  /* How many rows each group shows before "show more". WAITING starts open
     because it is the work; the rest start closed because they are history. */
  const FIRST_PAGE = 3;
  const [shown, setShown] = useState<Record<MoneyGroup, number>>({
    waiting: FIRST_PAGE,
    refunded: FIRST_PAGE,
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
      for (const item of data.data?.items ?? []) {
        if (item.bookingId && item.plan) byBooking[item.bookingId] = item.plan;
      }
      setPlansByBookingId(byBooking);
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
                  {formatCurrency(totals.outstanding, moneyItems[0].currency)}{' '}
                  {t('payments.outstanding') || 'outstanding'}
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
              <p className="m-0 px-1 text-[15px] font-semibold leading-relaxed text-[var(--v2-text-primary)]">
                {totals.outstanding > 0 ? (
                  <>
                    {t('payments.answer.owes')
                      .replace('{name}', contactName)
                      .replace(
                        '{amount}',
                        formatCurrency(totals.outstanding, moneyItems[0].currency)
                      )}
                    {totals.overdue > 0 && (
                      <span style={{ color: STATUS_TONE.overdue }}>
                        {t('payments.answer.of_which_late').replace(
                          '{amount}',
                          formatCurrency(totals.overdue, moneyItems[0].currency)
                        )}
                      </span>
                    )}
                    {'. '}
                  </>
                ) : (
                  <>{t('payments.answer.nothing_owed').replace('{name}', contactName)} </>
                )}
                {/* Green, because it is the one figure that is good news.
                    The sentence carries three amounts and they were all the
                    same colour, so the reader had to parse the words to tell
                    the debt from the takings. */}
                {totals.collected > 0 && (
                  <>
                    {t('payments.answer.received')
                      .split('{amount}')
                      .flatMap((part, i) =>
                        i === 0
                          ? [part]
                          : [
                              <span key="amt" style={{ color: STATUS_TONE.paid }}>
                                {formatCurrency(totals.collected, moneyItems[0].currency)}
                              </span>,
                              part,
                            ]
                      )}
                  </>
                )}
              </p>

              {/* The three figures that are actually money, each labelled in
                  the reader's own words rather than an accounting term. */}
              <div className="flex flex-wrap gap-2 px-1 pt-1">
                {(
                  [
                    /* The same three colours the bar and the chips use, so a
                       figure here and a dot below cannot describe one state
                       two ways. */
                    ['waiting', totals.outstanding, STATUS_TONE.awaiting_payment],
                    ['received', totals.collected, STATUS_TONE.paid],
                    ['refunded', totals.refunded, STATUS_TONE.refunded],
                  ] as Array<[string, number, string]>
                )
                  .filter(([, value]) => value > 0)
                  .map(([key, value, colour]) => (
                    <div
                      key={key}
                      className="flex-1 rounded-xl border px-3 py-2"
                      style={{
                        minWidth: '120px',
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
                        borderColor:
                          key === 'waiting'
                            ? `color-mix(in srgb, ${STATUS_TONE.awaiting_payment} 45%, var(--v2-border))`
                            : 'var(--v2-border)',
                        background:
                          key === 'waiting'
                            ? `color-mix(in srgb, ${STATUS_TONE.awaiting_payment} 8%, transparent)`
                            : 'transparent',
                      }}
                    >
                      <p className="m-0 text-[11.5px] text-[var(--v2-text-secondary)]">
                        {t(`payments.stat.${key}`)}
                      </p>
                      <p
                        className="m-0 text-[17px] font-bold"
                        style={{ color: colour, fontVariantNumeric: 'tabular-nums' }}
                      >
                        {formatCurrency(value, moneyItems[0].currency)}
                      </p>
                    </div>
                  ))}
              </div>

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

                const limit = shown[group];
                const visibleRows = rows.slice(0, limit);
                const rest = rows.length - visibleRows.length;

                /* PAID and CANCELLED collapse to one sentence until asked for.
                   Six settled payments are six rows of nothing to do. */
                const quiet = group === 'paid' || group === 'cancelled';
                const total = rows.reduce(
                  (sum, i) => sum + (Number(i.amount) || 0) - (Number(i.refunded) || 0),
                  0
                );

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
                        {rows.length}
                      </span>
                      <span className="ms-auto text-[11px] text-[var(--v2-text-muted)]">
                        {t(`payments.group.${group}_why`)}
                      </span>
                    </div>

                    {quiet && limit === 0 ? (
                      <div
                        className="flex items-center gap-2 rounded-xl border border-dashed px-3 py-2.5 text-[12.5px] text-[var(--v2-text-muted)]"
                        style={{ borderColor: 'var(--v2-border)' }}
                      >
                        <span className="flex-1">
                          {group === 'paid'
                            ? t('payments.quiet.paid')
                                .replace('{amount}', formatCurrency(total, rows[0].currency))
                                .replace('{n}', String(rows.length))
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
                               * above.
                               */
                              <>
                                {totals.cancelled > 0 && (
                                  <span>
                                    {t('payments.cancelled_total')}:{' '}
                                    {formatCurrency(totals.cancelled, moneyItems[0].currency)} ·{' '}
                                  </span>
                                )}
                                {t('payments.quiet.cancelled').replace('{n}', String(rows.length))}
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
                           */
                          const flow = itemFlow(item);
                          const owed = flow.outstanding;

                          return (
                            <div
                              key={item.key}
                              className="flex items-start gap-2.5 border-t py-2.5 first:border-t-0"
                              style={{ borderColor: 'var(--v2-border)' }}
                            >
                              <span
                                className="mt-2 h-2 w-2 shrink-0 rounded-full"
                                style={{
                                  /*
                                   * THE SHARED PALETTE, NOT A FIFTH ONE.
                                   *
                                   * These dots were amber for late, a literal
                                   * blue for waiting, `--v2-success` for paid
                                   * and `--v2-text-muted` for everything
                                   * closed — five states, five disagreements
                                   * with the drawer this list opens.
                                   *
                                   * `moneyStatusTone` exists for exactly that
                                   * and says so: "FOUR PALETTES DESCRIBED THE
                                   * SAME FACT, AND THEY DISAGREED... the
                                   * colour of a money state is decided here,
                                   * once, and every surface reads it." This
                                   * was the fifth.
                                   *
                                   * `scheduleTone` is the right reader: this
                                   * is a list of payments, which is the shape
                                   * it is written for — a partly refunded one
                                   * still counts as collected here, as it does
                                   * in the drawer's schedule.
                                   */
                                  background: scheduleTone(String(item.status)),
                                }}
                              />

                              <div className="min-w-0 flex-1">
                                {/* THE AMOUNT AND WHAT IT IS FOR, first and in
                                    that order — how the reader holds it in
                                    their head. The invoice number moved into
                                    the drawer, where somebody has already
                                    asked about this one. */}
                                <p className="m-0 flex flex-wrap items-baseline gap-x-2 text-[13.5px] font-semibold">
                                  {/*
                                    AN EXPLICIT COLOUR, NEVER INHERITED.

                                    This span had none, so the figure took
                                    whatever colour the surrounding text
                                    happened to be — black on a dark surface,
                                    which is the one element on the row that
                                    must always be readable.

                                    The token, not a literal: `--v2-text-primary`
                                    has a light and a dark value, and a hex here
                                    would be right in exactly one theme.
                                  */}
                                  <span
                                    style={{
                                      color: 'var(--v2-text-primary)',
                                      fontVariantNumeric: 'tabular-nums',
                                    }}
                                  >
                                    {formatCurrency(
                                      group === 'refunded'
                                        ? flow.refunded || flow.collected
                                        : group === 'paid'
                                          ? flow.collected
                                          : group === 'cancelled'
                                            ? flow.cancelled || Number(item.amount) || 0
                                            : owed,
                                      item.currency
                                    )}
                                  </span>
                                  <span
                                    className="truncate font-medium text-[var(--v2-text-secondary)]"
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
                                    </>
                                  ) : group === 'refunded' ? (
                                    t('payments.returned_on').replace('{date}', formatDate(item.date))
                                  ) : (
                                    t('payments.paid_on').replace('{date}', formatDate(item.date))
                                  )}
                                </p>

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
                                  what opens from it did not. */}
                              <button
                                type="button"
                                onClick={() => setDetail(item)}
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
