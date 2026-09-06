/**
 * One list of money, grouped by the thing that was sold.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SHAPE
 *
 *   Booking  ─ "Sarah's session, 12 Sep, ₪600, plan 2 of 3, payment failed"
 *     ├ ✓ 1 Sep  ₪200  paid
 *     ├ ✓ 1 Oct  ₪200  paid
 *     └ ⚠ 1 Nov  ₪200  card declined
 *
 * The BOOKING is the container. An invoice, a payment and a plan are not three
 * subjects — they are three facts about one session, and a business owner asks
 * "have I been paid for Sarah's session?", never "is that a transaction or an
 * invoice?".
 *
 * WHY THIS REPLACED TWO TABS
 *
 * Invoices and Payments were separate lists, so a paid invoice appeared in BOTH:
 * the same ₪200 as an invoice row and again as a payment row, with the reader
 * left to work out they were one event. Totals across the two could not be
 * added, and nothing said so.
 *
 * Two levels of collapsing happen here, in order:
 *   1. an invoice and the payments that settled it become one ENTRY
 *   2. every entry for a booking sits under one ITEM
 *
 * Money with no booking is still money: an ad-hoc invoice, or a website purchase
 * that never became an appointment, stands as its own item. The booking is the
 * container where one exists, not a requirement.
 *
 * Pure — no I/O, no formatting, no React. Deliberately: the one catastrophic
 * failure when merging two lists is counting the same money twice, and a total
 * that silently doubles is worse than the tabs it replaces, because those were
 * at least visibly separate. Purity is what lets that be proven.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/payments
 */

/** How money was collected. A property of the event, not a tab it lives in. */
export type CollectionMethod = 'direct' | 'invoice' | 'plan';

export type MoneyStatus =
  | 'paid'
  | 'partially_refunded'
  | 'refunded'
  | 'awaiting_payment'
  | 'overdue'
  | 'failed'
  | 'draft'
  | 'cancelled';

export interface MoneyInvoice {
  id: string;
  invoice_number?: string | null;
  amount: number;
  currency: string;
  status: string;
  due_date?: string | null;
  paid_at?: string | null;
  created_at: string;
  contact_id?: string | null;
  booking_id?: string | null;
  refunded_amount?: number | null;
  refund_status?: string | null;
  /**
   * Denormalised on the invoice itself. There is no crm_contacts join on this
   * path, and an invoice records who it was addressed to at the time — which is
   * the right answer even if the contact has since been renamed or deleted.
   */
  client_name?: string | null;
  client_email?: string | null;
  /** First line item names what was sold, which is a better row title than a number. */
  line_items?: Array<{ description?: string | null }> | null;
  stripe_invoice_id?: string | null;
  stripe_hosted_invoice_url?: string | null;
}

export interface MoneyTransaction {
  id: string;
  amount: number;
  currency: string;
  status: string;
  description?: string | null;
  invoice_id?: string | null;
  booking_id?: string | null;
  service_id?: string | null;
  contact_id?: string | null;
  paid_at?: string | null;
  created_at: string;
  refunded_amount?: number | null;
  refund_status?: string | null;
  payment_method?: string | null;
  refunded_at?: string | null;
  refund_reason?: string | null;
  stripe_payment_intent_id?: string | null;
  stripe_charge_id?: string | null;
  /** 'stripe' | 'manual' | … — who took the money, if anyone did. */
  processor_type?: string | null;
  /**
   * A plan period's own numbers, written by the webhook.
   *
   * The stored `description` says "Payment 1 of 3" in ENGLISH — it is written
   * once, in the database, and read by every language. Carrying the numbers
   * instead lets the caller phrase it in the reader's language.
   */
  metadata?: Record<string, unknown> | null;
  /** Joined, as the transactions list already does. */
  contact?: { first_name?: string | null; last_name?: string | null; email?: string | null } | null;
}

/** What the caller knows about a booking, for the row's heading. */
export interface MoneyBooking {
  id: string;
  title: string;
  startTime?: string | null;
  contactId?: string | null;
}

export interface MoneyPeriod {
  id: string;
  installmentNumber: number;
  amount: number;
  /**
   * The installment's own currency.
   *
   * Carried because a plan is not obliged to bill in the currency of the row it
   * is grouped under, and the totals card keeps its buckets apart. Optional
   * only so a caller that has not been updated still type-checks; it falls back
   * to the item's currency.
   */
  currency?: string;
  dueDate: string | null;
  status: string;
  paidAt: string | null;
  transactionId: string | null;
}

export interface MoneyPlan {
  id: string;
  installmentCount: number;
  periodsPaid: number;
  /**
   * The plan's real state: `active`, `past_due`, `cancelled`, `completed`.
   *
   * Was hardcoded to `active` because nothing read
   * `payment_plan_subscriptions` — so a stopped plan still showed as running.
   */
  status: string;
  /**
   * The `payment_plan_subscriptions` row, when this sale was bound to Stripe.
   *
   * Distinct from `id`, which is the plan OFFER the sale was made under. This
   * is the handle for stopping it — the offer cannot be cancelled, a sale can.
   * Null for a plan projected locally and never bound.
   */
  subscriptionId?: string | null;
  periods: MoneyPeriod[];
}

/** One money event: an invoice with the payments that settled it, or a lone payment. */
export interface MoneyEntry {
  key: string;
  method: CollectionMethod;
  status: MoneyStatus;
  amount: number;
  refunded: number;
  currency: string;
  /** Whichever date matters most for this state — see `dateKind`. */
  date: string;
  /**
   * WHICH date `date` is. One unlabelled date that silently means due-or-paid-
   * or-created is worse than none: a row reading "3 Oct" tells the reader
   * nothing about whether that has happened or is going to.
   */
  dateKind: 'paid' | 'due' | 'created' | 'refunded';
  invoiceId: string | null;
  invoiceNumber: string | null;
  transactionIds: string[];
  description: string | null;

  /** Who the money is from. The thing people scan a money list for. */
  contactName: string | null;
  contactEmail: string | null;
  /** What was sold — the first line item, or the payment's description. */
  serviceLabel: string | null;
  /**
   * True when this entry is one period of a payment plan.
   *
   * The detail drawer labelled `serviceLabel` "Service" for every entry, so a
   * plan period read "שירות: תשלום 1 מתוך 3" — naming the instalment as though
   * it were the thing being sold.
   */
  isPlanPeriod?: boolean;
  /**
   * Which period of how many, for a caller that can phrase it.
   *
   * `installmentLabel` lets a caller holding `t` name the period at build time,
   * and the CRM drawer uses it — but `/api/payments/money` builds these on the
   * server, where there is no reader and no language, so it passed nothing and
   * every entry fell back to the English `description` the webhook stored.
   * Carrying the raw numbers lets the payments page phrase it in the browser,
   * from the same `payments.installment_payment` string the CRM drawer uses,
   * instead of translating the same sentence a second time on the server.
   */
  planPeriod?: { number: number; count: number };
  dueDate: string | null;
  paidAt: string | null;
  paymentMethod: string | null;
  stripeInvoiceId: string | null;
  /** Stripe's own hosted page, for "view in Stripe" and as a fast copy-link path. */
  stripeHostedUrl: string | null;
  /** The payment intent or charge, for support and reconciliation. */
  processorRef: string | null;
  /**
   * Who took the money — 'stripe', 'manual', or unknown.
   *
   * Distinct from `processorRef` being null, and the distinction decides
   * whether a refund can be offered. No reference on a Stripe payment means the
   * platform cannot return it; no reference on MANUAL money means there was
   * never anything to reference, and the business returns it by hand and
   * records that here.
   */
  processorType: string | null;
}

/** A row in the list: a booking and everything financial about it, or lone money. */
export interface MoneyItem {
  key: string;
  /** `booking` when a booking groups this; `standalone` for money with none. */
  kind: 'booking' | 'standalone';
  title: string;
  status: MoneyStatus;
  /** `mixed` when a booking's entries were collected in more than one way. */
  method: CollectionMethod | 'mixed';

  amount: number;
  refunded: number;
  currency: string;
  date: string;

  bookingId: string | null;
  contactId: string | null;
  /** Taken from the row's entries, so a booking row names its client too. */
  contactName: string | null;
  entries: MoneyEntry[];
  plan?: MoneyPlan;

  /**
   * True when this row IS the money, so there is nothing to nest under it.
   *
   * Only standalone rows — an ad-hoc invoice, a website purchase — are flat. A
   * BOOKING always collapses, even when it holds a single invoice: the booking
   * is the container, and hiding that hierarchy whenever it happens to hold one
   * thing means the common case never shows the shape at all.
   */
  simple: boolean;
}

/**
 * What an entry says at a glance.
 *
 * Refund state wins over paid state: "paid" on money that went back is the more
 * misleading of the two. Partial stays distinct from full — the business kept
 * something, and collapsing them would misstate revenue on screen.
 */
function entryStatus(
  invoice: MoneyInvoice | null,
  transactions: MoneyTransaction[],
  refunded: number,
  amount: number
): MoneyStatus {
  if (refunded > 0) return refunded >= amount ? 'refunded' : 'partially_refunded';

  if (transactions.some(t => ['succeeded', 'refunded'].includes(t.status))) return 'paid';

  // Attempted and did not arrive. "Awaiting payment" would flatten that away.
  if (transactions.length > 0 && transactions.every(t => t.status === 'failed')) return 'failed';

  if (!invoice) return 'awaiting_payment';

  switch (invoice.status) {
    case 'draft':
      return 'draft';
    case 'cancelled':
      return 'cancelled';
    case 'overdue':
      return 'overdue';
    case 'paid':
    case 'refunded':
    case 'partially_refunded':
      // The invoice claims paid but no payment backs it — the exact state the
      // money-correctness work exists to prevent. Reported as awaiting rather
      // than repeating the claim, because this list is where it would be caught.
      return 'awaiting_payment';
    default:
      return 'awaiting_payment';
  }
}

/** The worst thing true of a booking is what its row should say. */
const STATUS_SEVERITY: MoneyStatus[] = [
  'failed',
  'overdue',
  'awaiting_payment',
  'partially_refunded',
  'refunded',
  'paid',
  'draft',
  'cancelled',
];

function rollUpStatus(entries: MoneyEntry[]): MoneyStatus {
  for (const status of STATUS_SEVERITY) {
    if (entries.some(e => e.status === status)) return status;
  }
  return 'awaiting_payment';
}

export interface BuildMoneyItemsInput {
  invoices?: MoneyInvoice[];
  transactions?: MoneyTransaction[];
  /** Titles and dates for the booking rows. Money whose booking is absent stands alone. */
  bookings?: MoneyBooking[];
  /** Keyed by booking id — a plan belongs to the booking, not to one invoice. */
  plansByBookingId?: Record<string, MoneyPlan>;
  /** Heading for money with no booking. */
  standaloneLabel?: string;
  /**
   * How to name one period of a payment plan, in the reader's language.
   *
   * Supplied by the caller because translations live in the UI layer; without
   * it the stored English description is used, which is what the drawer showed
   * a Hebrew reader.
   */
  installmentLabel?: (installmentNumber: number, installmentCount: number) => string;
}

/**
 * A plan period named in the reader's language, or null if this is not one.
 *
 * The webhook stores `description: "Payment 1 of 3"` — English, in the
 * database, read by every locale. The numbers travel in metadata beside it so
 * the phrasing can be chosen here instead of frozen at write time.
 */
/** Whether a transaction is one period of a payment plan. */
function isPlanPeriod(t: MoneyTransaction): boolean {
  return t.metadata?.source === 'payment_plan';
}

/**
 * Which period of how many, or null if this is not a plan payment.
 *
 * The one place the metadata is read and validated, so the label and the raw
 * numbers cannot disagree about whether an entry is a period.
 */
function planPeriodNumbers(t: MoneyTransaction): { number: number; count: number } | undefined {
  const meta = t.metadata;
  if (!meta || meta.source !== 'payment_plan') return undefined;

  const number = Number(meta.installment_number);
  const count = Number(meta.installment_count);
  if (!Number.isFinite(number) || !Number.isFinite(count) || count < 1) return undefined;

  return { number, count };
}

function planPeriodLabel(
  t: MoneyTransaction,
  installmentLabel?: (installmentNumber: number, installmentCount: number) => string
): string | null {
  if (!installmentLabel) return null;

  const numbers = planPeriodNumbers(t);
  if (!numbers) return null;

  return installmentLabel(numbers.number, numbers.count);
}

/** Step 1: collapse invoices and their payments into entries. */
function buildEntries(
  invoices: MoneyInvoice[],
  transactions: MoneyTransaction[],
  installmentLabel?: (installmentNumber: number, installmentCount: number) => string
): MoneyEntry[] {
  const byInvoice = new Map<string, MoneyTransaction[]>();
  const loose: MoneyTransaction[] = [];

  for (const t of transactions) {
    if (t.invoice_id) byInvoice.set(t.invoice_id, [...(byInvoice.get(t.invoice_id) ?? []), t]);
    else loose.push(t);
  }

  const entries: MoneyEntry[] = invoices.map(invoice => {
    const settling = byInvoice.get(invoice.id) ?? [];

    // From the invoice, which the trigger keeps as the sum over its payments.
    // Adding the transactions' figures here would double-count an invoice
    // settled by two of them.
    const refunded = Number(invoice.refunded_amount ?? 0);

    const settlement = settling.find(t => t.paid_at);

    return {
      key: invoice.id,
      method: 'invoice' as const,
      status: entryStatus(invoice, settling, refunded, Number(invoice.amount)),
      amount: Number(invoice.amount),
      refunded,
      currency: invoice.currency,
      // Paid beats due beats raised: the most recent thing that actually
      // happened, and `dateKind` says which it is.
      date: invoice.paid_at ?? invoice.due_date ?? invoice.created_at,
      dateKind: invoice.paid_at ? 'paid' : invoice.due_date ? 'due' : 'created',
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoice_number ?? null,
      transactionIds: settling.map(t => t.id),
      description: settling.find(t => t.description)?.description ?? null,

      // The invoice's own record of who it was addressed to — right even if the
      // contact has since been renamed or removed.
      contactName: invoice.client_name ?? null,
      contactEmail: invoice.client_email ?? null,
      serviceLabel: invoice.line_items?.[0]?.description ?? null,
      dueDate: invoice.due_date ?? null,
      paidAt: invoice.paid_at ?? null,
      paymentMethod: settlement?.payment_method ?? null,
      stripeInvoiceId: invoice.stripe_invoice_id ?? null,
      stripeHostedUrl: invoice.stripe_hosted_invoice_url ?? null,
      processorRef:
        settlement?.stripe_payment_intent_id ?? settlement?.stripe_charge_id ?? null,
      processorType: settlement?.processor_type ?? null,
    };
  });

  for (const t of loose) {
    const refunded = Number(t.refunded_amount ?? 0);

    const contactName = [t.contact?.first_name, t.contact?.last_name]
      .filter(Boolean)
      .join(' ')
      .trim();

    entries.push({
      key: t.id,
      method: 'direct',
      status: entryStatus(null, [t], refunded, Number(t.amount)),
      amount: Number(t.amount),
      refunded,
      currency: t.currency,
      // A refunded payment is best dated by when the money went BACK — that is
      // the event the reader is looking for.
      date: t.refunded_at ?? t.paid_at ?? t.created_at,
      dateKind: t.refunded_at ? 'refunded' : t.paid_at ? 'paid' : 'created',
      invoiceId: null,
      invoiceNumber: null,
      transactionIds: [t.id],
      description: planPeriodLabel(t, installmentLabel) ?? t.description ?? null,

      contactName: contactName || null,
      contactEmail: t.contact?.email ?? null,
      serviceLabel: planPeriodLabel(t, installmentLabel) ?? t.description ?? null,
      isPlanPeriod: isPlanPeriod(t),
      planPeriod: planPeriodNumbers(t),
      dueDate: null,
      paidAt: t.paid_at ?? null,
      paymentMethod: t.payment_method ?? null,
      stripeInvoiceId: null,
      stripeHostedUrl: null,
      processorRef: t.stripe_payment_intent_id ?? t.stripe_charge_id ?? null,
      processorType: t.processor_type ?? null,
    });
  }

  return entries;
}

/**
 * The list: one row per booking, plus a row for each piece of money that has no
 * booking behind it. Newest first.
 */
export function buildMoneyItems(input: BuildMoneyItemsInput): MoneyItem[] {
  const invoices = input.invoices ?? [];
  const transactions = input.transactions ?? [];
  const bookings = input.bookings ?? [];
  const plans = input.plansByBookingId ?? {};

  const bookingById = new Map(bookings.map(b => [b.id, b]));

  // Which booking each entry belongs to — taken from the invoice or from any of
  // its payments, since either may carry it.
  const bookingOfInvoice = new Map<string, string>();
  for (const invoice of invoices) {
    if (invoice.booking_id) bookingOfInvoice.set(invoice.id, invoice.booking_id);
  }
  for (const t of transactions) {
    if (t.booking_id && t.invoice_id && !bookingOfInvoice.has(t.invoice_id)) {
      bookingOfInvoice.set(t.invoice_id, t.booking_id);
    }
  }

  const entries = buildEntries(invoices, transactions, input.installmentLabel);
  const contactOfInvoice = new Map(invoices.map(i => [i.id, i.contact_id ?? null]));
  const bookingOfTransaction = new Map(transactions.map(t => [t.id, t.booking_id ?? null]));
  const contactOfTransaction = new Map(transactions.map(t => [t.id, t.contact_id ?? null]));

  const grouped = new Map<string, MoneyEntry[]>();
  const standalone: MoneyEntry[] = [];

  for (const entry of entries) {
    const bookingId = entry.invoiceId
      ? bookingOfInvoice.get(entry.invoiceId)
      : bookingOfTransaction.get(entry.transactionIds[0]) ?? null;

    // A booking id we were given no booking for cannot head a row — there would
    // be nothing to call it. Better standalone than a row titled with a uuid.
    if (bookingId && bookingById.has(bookingId)) {
      grouped.set(bookingId, [...(grouped.get(bookingId) ?? []), entry]);
    } else {
      standalone.push(entry);
    }
  }

  const items: MoneyItem[] = [];

  for (const [bookingId, bookingEntries] of grouped) {
    const booking = bookingById.get(bookingId)!;
    const plan = plans[bookingId];
    const methods = new Set(bookingEntries.map(e => e.method));

    items.push({
      key: bookingId,
      kind: 'booking',
      title: booking.title,
      status: rollUpStatus(bookingEntries),
      method: plan ? 'plan' : methods.size > 1 ? 'mixed' : [...methods][0],
      amount: bookingEntries.reduce((sum, e) => sum + e.amount, 0),
      refunded: bookingEntries.reduce((sum, e) => sum + e.refunded, 0),
      currency: bookingEntries[0].currency,
      date: booking.startTime ?? bookingEntries[0].date,
      bookingId,
      contactId:
        booking.contactId ??
        contactOfInvoice.get(bookingEntries[0].invoiceId ?? '') ??
        null,
      // From whichever entry knows it. A booking's own record has only an id.
      contactName: bookingEntries.find(e => e.contactName)?.contactName ?? null,
      entries: bookingEntries,
      ...(plan ? { plan } : {}),
      // A booking is always a container, whatever it holds.
      simple: false,
    });
  }

  for (const entry of standalone) {
    items.push({
      key: entry.key,
      kind: 'standalone',
      // What was SOLD leads: "ייעוץ אישי" identifies a row, "INV-00012" does
      // not. The number moves to the second line as a reference.
      //
      // A payment's own description is usually derived from the invoice
      // ("Payment for invoice INV-00001"), so it ranks below the line item and
      // above the bare number.
      title:
        entry.serviceLabel ??
        entry.invoiceNumber ??
        entry.description ??
        input.standaloneLabel ??
        'Payment',
      status: entry.status,
      method: entry.method,
      amount: entry.amount,
      refunded: entry.refunded,
      currency: entry.currency,
      date: entry.date,
      bookingId: null,
      contactId:
        contactOfInvoice.get(entry.invoiceId ?? '') ??
        contactOfTransaction.get(entry.transactionIds[0]) ??
        null,
      contactName: entry.contactName,
      entries: [entry],
      simple: true,
    });
  }

  return items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export interface MoneyCurrencyTotals {
  /** Arrived and stayed. */
  collected: number;
  /** Asked for and not yet settled. */
  outstanding: number;
  refunded: number;
}

export interface MoneyTotals extends MoneyCurrencyTotals {
  /**
   * The same figures, kept apart by currency.
   *
   * A business that has taken ₪600 and $40 has not taken 640 of anything, and a
   * single card labelled with `items[0].currency` states exactly that. The flat
   * fields above remain for the single-currency case — which is nearly every
   * business — but a caller showing money to a person should read this.
   */
  byCurrency: Record<string, MoneyCurrencyTotals>;
}

/**
 * Totals over the list.
 *
 * Summed over ENTRIES rather than items, because a booking's row amount is
 * already the sum of its entries — adding both would double every grouped
 * booking. Each entry is counted exactly once, which is the property the whole
 * merge stands or falls on.
 *
 * A draft or cancelled invoice contributes to neither total: nobody has been
 * asked to pay it, so counting it as owed would overstate what is coming.
 */
/** Settled: the money arrived, whatever happened to it afterwards. */
const COLLECTED_STATUSES: MoneyStatus[] = ['paid', 'partially_refunded', 'refunded'];

/**
 * Asked for and not yet settled.
 *
 * Draft and cancelled are in neither list on purpose: nobody has been asked to
 * pay them, so counting them as owed would overstate what is coming.
 */
const OUTSTANDING_STATUSES: MoneyStatus[] = ['awaiting_payment', 'overdue', 'failed'];

/**
 * A plan period nobody has to pay.
 *
 * `paid` is settled; `cancelled` was called off. The other two — `pending` and
 * `overdue` — are money the business is still waiting for. Testing for "not
 * paid" counted a cancelled installment as owed, which overstated the debt of
 * every plan somebody had stopped.
 */
const SETTLED_PERIOD_STATUSES = ['paid', 'cancelled'];

/**
 * Unpaid plan periods, one currency at a time.
 *
 * The single definition of "a plan still owes this", used by both the per-row
 * figure and the totals card. It was written twice before, and the second copy
 * — the one in `totalMoney` — did not exist at all: the card summed entries and
 * ignored plans entirely, so a business eleven months into a twelve-month plan
 * saw a row reading "$666.67 due" above a card reading zero.
 */
function unpaidPeriods(item: MoneyItem): MoneyPeriod[] {
  return (item.plan?.periods ?? []).filter(
    period => !SETTLED_PERIOD_STATUSES.includes(period.status)
  );
}

/**
 * What is still owed on one row.
 *
 * Shares its rule with `totalMoney` rather than restating it, so a row reading
 * "₪200 due" and the Outstanding card above the list cannot disagree about what
 * counts as owed — which they would, the first time either definition moved.
 */
export function outstandingOf(item: MoneyItem): number {
  const fromEntries = item.entries
    .filter(entry => OUTSTANDING_STATUSES.includes(entry.status))
    .reduce((sum, entry) => sum + entry.amount, 0);

  /**
   * A payment plan's unpaid periods are owed money too.
   *
   * They are not entries — an entry is an invoice or a payment, and a period is
   * neither until it is charged — so summing entries alone reported a client
   * eleven months into a twelve-month plan as owing nothing. Every AR figure,
   * every "outstanding" card and every overdue metric was blind to plan money.
   *
   * Counted from the periods rather than from `installmentCount - periodsPaid`
   * so an uneven split is exact: the final period carries the remainder, and
   * multiplying an average would be a different number.
   */
  const fromPlan = unpaidPeriods(item).reduce((sum, period) => sum + period.amount, 0);

  return fromEntries + fromPlan;
}

export function totalMoney(items: MoneyItem[]): MoneyTotals {
  let collected = 0;
  let outstanding = 0;
  let refunded = 0;
  const byCurrency: Record<string, MoneyCurrencyTotals> = {};

  const bucketFor = (currency: string) =>
    (byCurrency[currency] ??= { collected: 0, outstanding: 0, refunded: 0 });

  for (const entry of items.flatMap(item => item.entries)) {
    const bucket = bucketFor(entry.currency);

    refunded += entry.refunded;
    bucket.refunded += entry.refunded;

    if (COLLECTED_STATUSES.includes(entry.status)) {
      collected += entry.amount - entry.refunded;
      bucket.collected += entry.amount - entry.refunded;
    } else if (OUTSTANDING_STATUSES.includes(entry.status)) {
      outstanding += entry.amount;
      bucket.outstanding += entry.amount;
    }
  }

  /**
   * Plan money, counted separately because it is not an entry.
   *
   * An installment becomes an entry only once it is charged, so a schedule of
   * future periods appears nowhere in the loop above. The card summed entries
   * alone and reported zero outstanding to a business with a live plan running
   * — while the row for that same plan, using `outstandingOf`, said what was
   * really due. This is that same rule, applied to the totals.
   *
   * Iterated over items rather than a flattened list of periods so each period
   * keeps its own currency: an installment carries one, and a plan billed in
   * dollars must not land in the shekel bucket because the row happened to be
   * grouped under a shekel booking.
   */
  for (const item of items) {
    for (const period of unpaidPeriods(item)) {
      const currency = period.currency || item.currency;
      outstanding += period.amount;
      bucketFor(currency).outstanding += period.amount;
    }
  }

  return { collected, outstanding, refunded, byCurrency };
}
