'use client';

/**
 * Everything waiting on the owner, and the one click that clears each of them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS FOR
 *
 * The work a small business loses is almost never work it decided against. It
 * is a form nobody answered, a quote nobody wrote, a quote written and never
 * sent, an intake form nobody chased, an invoice nobody followed up. Each one
 * was a single step away from done and each was invisible until somebody went
 * looking.
 *
 * ONE LIST, BECAUSE THEY ARE ONE PROBLEM
 *
 * They arrive from `findGaps`, which is also what the briefing reads — so the
 * card and the morning summary cannot disagree about what is outstanding. Every
 * row carries the action for its own kind, and the services behind all five
 * already existed: this card is wiring, not a new capability.
 *
 * NOTHING APPEARS HERE THAT THE OWNER CANNOT DO
 *
 * A quote sitting with a client who has not replied is genuinely outstanding
 * and genuinely not their move; it is reported in the briefing instead. A list
 * headed "needs you" that contains things you cannot act on is how somebody
 * learns to stop reading the list.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Send, Check, Clock, AlertCircle, FileText, Bell, Receipt, Undo2, CalendarX } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import type { CurrencyCode } from '@/lib/business-os/LanguageContext';
// One definition, in the registry that owns the vocabulary. Declared here too,
// the two would drift the first time an action was added.
import type { GapAction } from '@/lib/business-os/gaps/types';
import { RefundModal } from '@/components/payments/RefundModal';
import { mostUrgent, tasksOf } from '@/lib/business-os/gaps/mostUrgent';

export interface GapItemView {
  contactId: string;
  name: string;
  note: string | null;
  since: string;
  entityId: string | null;
  /**
   * The booking to open, where `entityId` is not itself one.
   *
   * See `GapItem.bookingId`: `entityId` is whatever the action POSTS to, which
   * for `bill_stage` is a payment stage. Only the navigating actions read this.
   */
  bookingId?: string | null;
  /** Which session of a package. See `GapItem.sessionNumber`. */
  sessionNumber?: number | null;
  /**
   * A clock closed this hour, not a person. See `GapItem.autoHeld`.
   *
   * Changes two things on the row: it earns a sentence saying why it is here,
   * and its button becomes a confirmation rather than a charge.
   */
  autoHeld?: boolean | null;
  /** Which channel brought the lead. See `GapItem.via`. */
  via?: string | null;
  /** And which mailbox, where one was recorded. */
  viaProvider?: string | null;
  /**
   * What is held on it, where money is involved.
   *
   * Decides the row's action for `booking_cancelled`, where one gap has two
   * moves: money on it is owed back, nothing on it is an hour to refill.
   */
  value?: number | null;
  currency?: string | null;
  /**
   * A payment plan still charging this client for a cancelled booking.
   *
   * The row's real urgency, and why it is never allowed to expire: until the
   * owner decides otherwise the card is debited again next period. Cancelling
   * an appointment deliberately does not end a payment arrangement.
   */
  planLive?: boolean | null;
  /** Only an enquiry can have an automatic reply queued. */
  queued?: {
    label: string | null;
    chosenBy: string | null;
    dueAt: string | null;
  } | null;
  /**
   * When `auto_complete_meetings` will answer this row itself.
   *
   * Present only on an unmarked meeting, and only while the automation is on
   * and the work is still queued. A TIME and nothing else — there is no button,
   * because the seven-day triage row already lets the owner correct an
   * auto-completed meeting and a Cancel here would buy ten hours of prevention
   * on top of a week of cure.
   *
   * What it fixes is silence: the card claimed the meeting two hours after it
   * ended and the automation answered at twelve, so for ten hours the row asked
   * the owner to do something the platform was about to do, said nothing about
   * it, and then disappeared.
   */
  closingAt?: string | null;
  /**
   * When this one's own moment is: a quote's deadline, an appointment's start.
   *
   * What `mostUrgent` promotes on — a decision about to be taken away outranks
   * one that is merely old. Absent on most gaps, where `since` is the whole
   * story.
   */
  eventAt?: string | null;
}

export interface GapView {
  id: string;
  action: GapAction;
  count: number;
  items: GapItemView[];
}

interface NeedsYouCardProps {
  gaps: GapView[];
  /**
   * Fill the height it is given rather than stopping at its content.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * For the dashboard's top row, where this card shares a stretched grid track
   * with the usage dial. Both tracks are as tall as the taller card, and a
   * card that sizes to its own content leaves a gap under itself inside its
   * own track — which reads as one of the pair having failed to load rather
   * than as two cards of different lengths.
   *
   * The row's other two cards already do this; the comment on
   * `usage-readiness-row` records why. Off by default, because in its original
   * full-width position there is no track to fill and nothing to match.
   * ───────────────────────────────────────────────────────────────────────────
   */
  fill?: boolean;
  /** Refetch, so a cleared row leaves the list. */
  onChanged?: () => void;
}

type RowState =
  | { kind: 'idle' }
  /**
   * Asked, not yet done — the second tap is the real one.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Six of this card's actions used to fire on a single tap with nothing in
   * between: four of them put an email in a client's inbox, and one cancelled
   * a booking and told them about it. None could be taken back, and none of
   * the labels hinted at it — "Send it" and "Follow up" look exactly like
   * "Say what happened", which merely opens a screen.
   *
   * The inconsistency was the clearest sign something was wrong: refunding
   * money opened a confirmation, while mailing a client did not. The less
   * exposed action was the guarded one.
   *
   * Confirmed INLINE rather than in a dialog. The card holds several rows and
   * a modal per row would bury the list the owner came to read; the row simply
   * says what is about to leave and offers to go ahead.
   * ───────────────────────────────────────────────────────────────────────────
   */
  | { kind: 'confirming' }
  | { kind: 'working' }
  | { kind: 'done' }
  | { kind: 'refused'; message: string };

/**
 * Actions that change something outside this screen the moment they run.
 *
 * Four put an email in a client's inbox; `cancel_booking` calls off a booking
 * and tells them. Everything NOT listed here either opens a screen
 * (`write_quote`, `bill_stage`, `mark_meeting`) or raises its own dialog
 * (`refund`), and asking twice for those would be a click with nothing behind
 * it.
 */
/**
 * Actions that take the owner somewhere rather than doing anything.
 *
 * They open the contact drawer at the booking in question, and the work
 * happens there. Visually identical to the sending actions until now — the
 * same filled button in the same place — so nothing distinguished "this writes
 * an email to your client" from "this scrolls you to a form". Marked with a
 * chevron, which is the one convention a reader does not have to be taught.
 */
const OPENS_A_SCREEN = new Set<string>([
  'write_quote',
  'bill_stage',
  'mark_meeting',
  /* Raising an invoice decides an amount, a due date and tax; confirming a
     handover decides that work left the owner's hands. Neither is a thing a
     dashboard button should settle on their behalf. */
  'send_invoice',
  'mark_delivered',
]);

const LEAVES_THE_BUILDING = new Set<string>([
  'send_booking_link',
  'send_quote',
  'chase_quote',
  'chase_intake',
  'chase_payment',
  'cancel_booking',
]);

/** What `formatCurrency` can render. Anything else is shown as a bare figure. */
const SUPPORTED_CURRENCIES: CurrencyCode[] = ['USD', 'EUR', 'ILS', 'GBP'];

/** The icon says what KIND of work this is before the label is read. */
const ACTION_ICON: Record<string, typeof Send> = {
  send_booking_link: Send,
  write_quote: FileText,
  send_quote: Send,
  chase_intake: Bell,
  chase_payment: Receipt,
  refund: Undo2,
  bill_stage: Receipt,
  cancel_booking: CalendarX,
};

/**
 * The move for ONE row, which is not always the move for its gap.
 *
 * Every other gap has a single answer, so the action lives on the gap. A
 * cancelled booking does not: if the client paid, the business is holding money
 * for an appointment that is not happening and owes it back; if they did not,
 * nothing is owed and what is left is an hour somebody else could have. Showing
 * "Refund" on a booking nobody paid for would be a button that cannot work, and
 * showing "Send booking link" on one where money is held hides the debt.
 */
function actionFor(gap: GapView, item: GapItemView): GapAction {
  if (gap.id !== 'booking_cancelled') return gap.action;
  /*
   * A live plan takes precedence over an empty balance. Offering "send booking
   * link" on a booking whose client is still being charged answers the wrong
   * question entirely — the money is what needs a decision.
   */
  return moneyHeld(item) || item.planLive ? 'refund' : 'send_booking_link';
}

function moneyHeld(item: GapItemView): boolean {
  return typeof item.value === 'number' && item.value > 0;
}

/**
 * What the figure on a row MEANS, which is not the same on every gap.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `value` is one field carrying five different facts, and every row was
 * labelled "holding" — the one reading that is true of exactly ONE of them.
 *
 *   booking_cancelled          money actually taken and not refunded   HELD
 *   stage_awaiting_completion  work done that nobody has billed        NOT held
 *   invoice_unpaid             what the client owes                    NOT held
 *   quote_unsent               what the quote comes to                 NOT held
 *   quote_awaiting_client      what the quote comes to                 NOT held
 *
 * So a phase waiting to be billed read "holding ₪705" — the exact opposite of
 * what it is. The owner is holding nothing; the client has not been charged,
 * and the button beside it says "mark done and bill".
 *
 * Defaults to `held`, because the default row IS the cancelled booking: a gap
 * added later with a value that is genuinely held needs no entry here, and one
 * that is not needs a deliberate line.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const VALUE_LABEL: Record<string, string> = {
  /* What the work came to, and nobody has asked for it. Not held: the client
     has not been charged at all. */
  booking_unbilled: 'gaps.value.to_bill',
  stage_awaiting_completion: 'gaps.value.to_bill',
  invoice_unpaid: 'gaps.value.owed',
  quote_unsent: 'gaps.value.quoted',
  quote_awaiting_client: 'gaps.value.quoted',
  quote_deadline_unanswered: 'gaps.value.quoted',
};

/**
 * The lead task, said as a sentence rather than labelled as a category.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The grouped list had to be terse: a heading, a name, a clock. Showing ONE
 * task buys room for the half that was always missing — not "Phase ready to
 * bill" but "Ofir's phase B is done and nobody has billed it".
 *
 * Built from the copy keys rather than composed here, so the three languages
 * stay in the dictionaries with every other string. `{name}` and `{what}` are
 * substituted; a gap with no sentence of its own falls back to its existing
 * `gaps.kind.*` label, which is what the card said before and is never wrong.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function leadSentence(
  gapId: string,
  item: GapItemView,
  t: (key: string) => string,
  money: (amount: number, currency?: string | null) => string
): string {
  const key = `gaps.lead.say.${gapId}`;
  const say = t(key);
  /* `t` returns the key itself when there is none. */
  const template = say === key ? t(`gaps.kind.${gapId}`) : say;

  /*
   * `{what}` IS NOT SUBSTITUTED, AND THAT IS THE POINT.
   *
   * `note` is a service name or a proposal title — arbitrary text the owner
   * typed. The first version of these sentences slotted it in as a grammatical
   * object ("{name} cancelled {what}"), which produced
   *
   *     "דויד המלך ביטל את הצעת מחיר לשיפוץ"
   *
   * on an account whose SERVICE is called "הצעת מחיר לשיפוץ" — read as a
   * cancelled proposal rather than a cancelled appointment for a service with
   * that name. Hebrew made it worse: the templates carried prefixes like
   * `ל{what}`, which assume whatever follows takes that preposition.
   *
   * So the sentence says what the gap IS, in words this module controls, and
   * the owner's own text is rendered beside it as a detail. A name the platform
   * did not write never has to be grammatical.
   */
  return template
    .replace('{name}', item.name)
    .replace('{amount}', moneyHeld(item) ? money(item.value as number, item.currency) : '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * The second line: the consequence of leaving it, where there is one.
 *
 * Deliberately separate from the sentence above. "Her card is still being
 * charged" is not a description of the task, it is the reason it leads the
 * card — and an owner who has read it once does not need it restated inside
 * the sentence every time.
 *
 * Absent for most gaps, and then nothing is rendered rather than a blank line.
 */
/**
 * Does this gap's sentence already name the money?
 *
 * Only `booking_cancelled` does — "…and you are holding {amount}" — and where
 * it does, the row must not ALSO print the figure in its own column: one row
 * stating one sum twice reads as two sums. The column keeps every other row,
 * which is what makes the money a column at all.
 *
 * Asked of the template rather than hardcoded to a gap id, so a sentence that
 * grows an amount later takes care of itself.
 */
function sentenceCarriesAmount(gapId: string, t: (key: string) => string): boolean {
  const key = `gaps.lead.say.${gapId}`;
  const say = t(key);
  return say !== key && say.includes('{amount}');
}

function leadQualifier(gapId: string, item: GapItemView, t: (key: string) => string): string | null {
  if (item.planLive) return t('gaps.lead.why.plan_live');

  if (gapId === 'meeting_unmarked' && item.closingAt) {
    return t('gaps.lead.why.closing').replace(
      '{time}',
      new Date(item.closingAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    );
  }

  const key = `gaps.lead.why.${gapId}`;
  const why = t(key);
  return why === key ? null : why;
}

/**
 * Identifies ONE row, for React and for the working/done/refused state.
 *
 * The contact alone is not enough. A person can have two unpaid invoices or
 * cancel two appointments, and those rows then shared a key: React warned about
 * the duplicate, and pressing the button on one of them showed "Done" on both
 * while only one had actually been sent. The entity is what makes them two.
 */
function rowKey(gap: GapView, item: GapItemView): string {
  return `${gap.id}:${item.contactId}:${item.entityId ?? ''}`;
}

export function NeedsYouCard({ gaps, onChanged, fill = false }: NeedsYouCardProps) {
  const { t, isRTL, formatCurrency } = useLanguage();

  /**
   * The amount in the currency THE CLIENT WAS CHARGED.
   *
   * `formatCurrency` otherwise falls back to the device's remembered display
   * currency, which is a per-browser preference and not what the invoice says.
   * A business in Israel can bill a US client in dollars, and telling the owner
   * they owe ₪400 when they are holding $400 is a wrong number on a refund
   * button.
   */
  const money = (amount: number, currency?: string | null) => {
    const code = (currency || '').toUpperCase();
    // Only the four it knows. An unrecognised code would render as a symbol
    // for a currency nobody was charged, so fall back to the plain figure.
    return SUPPORTED_CURRENCIES.includes(code as CurrencyCode)
      ? formatCurrency(amount, { currencyOverride: code as CurrencyCode })
      : `${amount.toLocaleString()}${code ? ` ${code}` : ''}`;
  };
  const router = useRouter();
  const [rows, setRows] = useState<Record<string, RowState>>({});
  /*
   * The card leads with ONE task and keeps the rest behind a line.
   *
   * Eight tasks used to cost a heading, three lines and a button each, so a
   * quiet day read as a wall and the owner picked by position rather than by
   * importance. Showing one makes the ORDER the product — see `mostUrgent`,
   * which is why that lives in its own tested module rather than in a sort
   * here.
   *
   * The full list is not replaced, it is folded: opening this renders exactly
   * what the card rendered before, so nothing an owner could do yesterday is
   * gone.
   */
  const [expanded, setExpanded] = useState(false);
  /** The booking whose refund dialog is open, if any. */
  const [refunding, setRefunding] = useState<{
    bookingId: string;
    amount: number;
    currency: string;
    name: string;
  } | null>(null);

  const setRow = (key: string, state: RowState) => setRows(prev => ({ ...prev, [key]: state }));

  /**
   * Where each action goes.
   *
   * Every one of these endpoints already existed and is already used elsewhere
   * — the contact drawer sends intake forms and resends invoices through the
   * same two. Nothing new is being asked of the server.
   */
  const endpointFor = (action: GapAction, item: GapItemView): string | null => {
    switch (action) {
      case 'send_booking_link':
        return `/api/crm/contacts/${item.contactId}/send-booking-link`;
      case 'send_quote':
        return item.entityId ? `/api/business-os/proposals/${item.entityId}/send` : null;
      case 'chase_intake':
        return item.entityId ? `/api/scheduling/bookings/${item.entityId}/intake` : null;
      case 'chase_payment':
        return item.entityId ? `/api/payments/invoices/${item.entityId}/send` : null;
      /*
       * The same reminder the automation sends, sent now because the owner
       * pressed it rather than because three days passed. One endpoint for
       * both, so a quote cannot be followed up in two different voices.
       */
      case 'chase_quote':
        return item.entityId ? `/api/business-os/proposals/${item.entityId}/remind` : null;
      case 'cancel_booking':
        return item.entityId ? `/api/scheduling/bookings/${item.entityId}/cancel` : null;
      /*
       * No `refund` case on purpose: `act` opens `RefundModal` before reaching
       * here, because refunding needs answers a fire-and-forget POST cannot
       * give — stop the plan, tell the client, was this even a Stripe payment.
       */
      default:
        return null;
    }
  };

  /**
   * Stop or hurry a reply that is queued but has not gone yet.
   *
   * The fifteen-minute window only means something if there is something to
   * press inside it — a card that announces "sending in 12 minutes" and offers
   * no way to intervene is worse than one that says nothing, because it shows
   * the owner a decision being taken without them.
   */
  const control = async (item: GapItemView, action: 'cancel' | 'send_now') => {
    const key = `queued:${item.contactId}`;
    setRow(key, { kind: 'working' });

    try {
      const response = await fetch(`/api/business-os/leads/${item.contactId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, kind: 'invite' }),
      });
      const data = await response.json();

      if (data?.success) {
        setRow(key, { kind: 'idle' });
        onChanged?.();
        return;
      }

      // Losing the race with the runner is the honest answer, not an error.
      setRow(key, { kind: 'refused', message: translateReason(t, data?.reason) });
    } catch {
      setRow(key, { kind: 'refused', message: t('gaps.refused.generic') });
    }
  };

  /**
   * The other answer to a refunded booking: leave it in the diary.
   *
   * A refund is not a cancellation — money goes back as goodwill while the
   * session still happens — so this row has two answers and neither is a
   * default. Saying "keep it" also lets the client's reminder resume, which is
   * held while the question is open.
   */
  /**
   * "I am keeping this." The answer the refund row never had.
   *
   * A deposit forfeited inside its own cancellation window is ordinary and
   * agreed in advance, but the gap's rule is "money owed stays until it is
   * given back" — so an owner who decided to keep it was asked again the next
   * day, and the day after. The one row on this card that could not be
   * dismissed was the one about money.
   *
   * Records the decision and touches nothing else: the payment stays where it
   * already was. Same shape as `keepAfterRefund`, which answers the opposite
   * question, and the two sit together on the client's timeline.
   */
  const keepThePayment = async (gap: GapView, item: GapItemView) => {
    const key = rowKey(gap, item);
    if (!item.entityId) return;

    setRow(key, { kind: 'working' });
    try {
      const response = await fetch(`/api/scheduling/bookings/${item.entityId}/keep-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await response.json();

      if (data?.success) {
        setRow(key, { kind: 'done' });
        setTimeout(() => onChanged?.(), 1200);
        return;
      }
      setRow(key, { kind: 'refused', message: translateReason(t, data?.reason || data?.code) });
    } catch {
      setRow(key, { kind: 'refused', message: t('gaps.refused.generic') });
    }
  };

  const keepAfterRefund = async (gap: GapView, item: GapItemView) => {
    const key = rowKey(gap, item);
    if (!item.entityId) return;

    setRow(key, { kind: 'working' });
    try {
      const response = await fetch(
        `/api/scheduling/bookings/${item.entityId}/keep-after-refund`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }
      );
      const data = await response.json();

      if (data?.success) {
        setRow(key, { kind: 'done' });
        setTimeout(() => onChanged?.(), 1200);
        return;
      }
      setRow(key, { kind: 'refused', message: translateReason(t, data?.reason || data?.code) });
    } catch {
      setRow(key, { kind: 'refused', message: t('gaps.refused.generic') });
    }
  };

  /**
   * Open the booking this row is about, expanded.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * `entityId` is the booking the gap was raised from — the consultation
   * awaiting a quote, the phase to be billed, the meeting with no outcome
   * recorded. The card has always known it and has never passed it on, so every
   * one of these buttons landed the owner on a LIST of that contact's bookings
   * and left them to work out which one the card meant. On a contact with one
   * booking that is invisible; on a regular client it is the whole problem.
   *
   * This is the third attempt at the same target. It first sent `&action=quote`,
   * which nothing on the CRM page read, so the drawer opened on `details`. Then
   * `bill_stage` sent `section=payments`, which is the wrong tab — the "mark
   * done and bill" control is a prop of `BookingsTab`, not the payments
   * section. Each round got nearer the row without reaching it.
   *
   * `&booking=` is read by the CRM page and threaded to `BookingsTab`, which
   * opens that row expanded. Omitted when the gap carries no entity, so the
   * link degrades to what it did before rather than naming a booking that does
   * not exist.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const openBooking = (item: GapItemView) => {
    /*
     * `bookingId` first, because `entityId` is not always a booking.
     *
     * It is whatever the gap's action POSTS to — a proposal, an invoice, a
     * payment stage — and only some of those are the thing to open. Passing a
     * stage id as `&booking=` matched no row and expanded nothing, which looks
     * exactly like passing no id at all: the owner lands on the list either
     * way, so the fault never announced itself.
     */
    const bookingId = item.bookingId ?? item.entityId;
    const target = bookingId ? `&booking=${encodeURIComponent(bookingId)}` : '';
    router.push(`/business-os/crm?contact=${item.contactId}&section=bookings${target}`);
  };

  const act = async (gap: GapView, item: GapItemView) => {
    const key = rowKey(gap, item);
    const action = actionFor(gap, item);

    /*
     * Writing a quote is the one that is not a send.
     *
     * It needs the owner to decide what the work costs, so it opens the builder
     * they already use rather than pretending a button can answer it.
     */
    if (action === 'write_quote') {
      openBooking(item);
      return;
    }

    /*
     * Billing a phase is the other one that is not a send.
     *
     * The owner has to decide the work actually happened before the client is
     * asked for money, so this opens the phase rather than billing it. A
     * one-click button here would be making that judgement on their behalf.
     *
     * `&section=bookings`, the same target as the quote above. This used to say
     * `payments`, which is the wrong tab: `onCompleteStage` — the prop that
     * raises the "mark done and bill" confirmation — is a prop of `BookingsTab`,
     * and the payments section has never had that control. The button landed the
     * owner on a tab where the thing they came to do does not exist.
     */
    if (action === 'bill_stage') {
      openBooking(item);
      return;
    }

    /*
     * Saying what happened to a meeting is the third that is not a send — and
     * the clearest case for it: the answer is one of THREE (it was held, they
     * did not turn up, it was called off), and a single button cannot offer
     * three answers.
     *
     * Same target as the two above, because the three marks already live on the
     * booking row in the drawer's bookings section. Nothing new to build there;
     * this is the route to it for an owner who has not opened the contact.
     */
    if (action === 'mark_meeting') {
      openBooking(item);
      return;
    }
    /* Both navigate — see `OPENS_A_SCREEN`. The booking is where the amount
       and the handover both live. */
    if (action === 'send_invoice' || action === 'mark_delivered') {
      openBooking(item);
      return;
    }

    /*
     * Refunding opens the dialog rather than posting.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * A direct POST was wrong in three separate ways, all of which `RefundModal`
     * already answers: it never asked to stop a payment plan, so a client kept
     * being charged; it never asked to tell the client, because that route
     * defaults to silence; and it cannot refund a payment taken outside Stripe
     * at all — a business that settles invoices by bank transfer got a button
     * that always failed.
     *
     * Rather than teach a second refund path those three lessons, the row opens
     * the one every other surface uses. It also lets the owner choose a partial
     * amount, and stop the plan, neither of which a one-tap full refund can.
     * ─────────────────────────────────────────────────────────────────────────
     */
    if (action === 'refund') {
      if (!item.entityId) {
        setRow(key, { kind: 'refused', message: t('gaps.refused.generic') });
        return;
      }
      setRefunding({
        bookingId: item.entityId,
        amount: typeof item.value === 'number' ? item.value : 0,
        currency: item.currency || '',
        name: item.name,
      });
      return;
    }

    const endpoint = endpointFor(action, item);
    if (!endpoint) {
      setRow(key, { kind: 'refused', message: t('gaps.refused.generic') });
      return;
    }

    /*
     * ASK ONCE, FOR THE THINGS THAT CANNOT BE TAKEN BACK.
     *
     * Reached on the FIRST tap only: the row goes to `confirming`, and the
     * control the owner then presses calls straight back in with the row
     * already in that state, which falls through to the send below.
     *
     * The check reads the ROW rather than taking a flag from the caller. A
     * second entry point that forgot to pass the flag would silently skip the
     * question, and the question is the whole point.
     */
    if (LEAVES_THE_BUILDING.has(action) && rows[key]?.kind !== 'confirming') {
      setRow(key, { kind: 'confirming' });
      return;
    }

    setRow(key, { kind: 'working' });
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        /*
         * Every remaining action is identified by its path and takes no body —
         * except cancelling, which now requires a reason like every other
         * cancellation surface.
         *
         * `refunded` is honest here and is the reason this card can stay ONE
         * CLICK: the `booking_refunded` gap finds a booking that was fully
         * refunded and is still on the books, so the owner pressing "cancel it"
         * is confirming exactly that. Any other one-click cancel would have to
         * invent a reason, which is why the calendar and the booking modal ask
         * instead.
         */
        body: JSON.stringify(action === 'cancel_booking' ? { reason_code: 'refunded' } : {}),
      });
      const data = await response.json();

      if (data?.success) {
        setRow(key, { kind: 'done' });
        setTimeout(() => onChanged?.(), 1200);
        return;
      }

      // A refusal is a next step, not an error — show what the server said.
      setRow(key, {
        kind: 'refused',
        message: data?.detail || translateReason(t, data?.reason || data?.code),
      });
    } catch {
      setRow(key, { kind: 'refused', message: t('gaps.refused.generic') });
    }
  };

  if (gaps.length === 0) return null;

  const total = gaps.reduce((sum, gap) => sum + gap.count, 0);

  /*
   * The one task the card leads with.
   *
   * Ranked in `mostUrgent`, not here: the ordering is the whole product once
   * only one task is visible, and it needs to be pure and tested rather than a
   * comparator inside a component that also does fetches and modals.
   */
  /*
   * A task the platform is already answering does not lead.
   *
   * `queued` means an automatic reply is pending on this row, with its own
   * "send now / cancel" strip inside the list. Leading with one would put the
   * owner's attention on the one thing nobody needs to do — and the lead block
   * has no room for that strip, so the Cancel control would vanish for as long
   * as the task happened to rank first.
   *
   * They stay in the list, with the strip, exactly as before. They simply do
   * not get the headline.
   */
  const leadCandidates = gaps.map(g => ({
    id: g.id as never,
    items: g.items.filter(item => !item.queued) as never,
  }));
  const lead = mostUrgent(tasksOf(leadCandidates));
  const leadGap = lead ? gaps.find(g => g.id === lead.gapId) ?? null : null;
  /* Amber for the one thing that is worse tomorrow than today. */
  const leadUrgent = Boolean(lead?.item.planLive);

  const openContact = (contactId: string) =>
    router.push(`/business-os/crm?contact=${contactId}`);

  return (
    <div
      style={{
        direction: isRTL ? 'rtl' : 'ltr',
        background: 'var(--v2-surface)',
        border: '1px solid var(--v2-border)',
        borderRadius: '18px',
        padding: '17px 18px',
        boxShadow: '0 6px 20px -10px rgba(16,22,42,0.25)',
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        /* See `fill`: matches the dial beside it in the dashboard's top row. */
        height: fill ? '100%' : undefined,
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-[var(--v2-text-primary)]">
          {t('gaps.card_title')}
        </h3>
        {/*
          NEUTRAL, not primary. Filling this pill with `--v2-primary` put the
          card's heaviest colour on a number nobody can act on, in the same
          colour as the action buttons that ARE meant to be pressed.

          A primary TINT with primary text fixes the competition and breaks
          something worse: `--v2-primary` is #6366F1 in both theme blocks — it
          is not redefined for dark — so indigo text on the dark card lands near
          3:1, below the solid pill it replaced. The count is metadata, so the
          neutral pair is both quieter and legible on either ground.
        */}
        <span
          className="text-[11px] font-semibold px-2 py-0.5 rounded-full tabular-nums"
          style={{
            background: 'var(--v2-bg)',
            color: 'var(--v2-text-secondary)',
          }}
        >
          {total}
        </span>
      </div>

      {/*
        ─────────────────────────────────────────────────────────────────────
        THE ONE THING, AND THE LINE THAT HOLDS THE REST.

        `lead` is whatever `mostUrgent` ranks first across every gap: money
        still leaving an account, then a decision about to expire, then
        somebody waiting, then work that can sit. The sentence beside it says
        what it IS rather than labelling a category, which is what the card
        has room for now that it shows one.

        Opening the fold renders the original grouped list underneath,
        untouched. Nothing an owner could do yesterday is gone; it is one tap
        further away, and the tap is the point.
        ─────────────────────────────────────────────────────────────────────
      */}
      {lead && !expanded && (
        <div className="mb-1">
          <p className="text-[11px] font-semibold mb-2" style={{ color: leadUrgent ? 'var(--v2-warning)' : 'var(--v2-primary)' }}>
            {leadUrgent ? t('gaps.lead.urgent') : t('gaps.lead.next')}
          </p>

          <p className="text-[15px] leading-relaxed font-medium text-[var(--v2-text-primary)] mb-1">
            {leadSentence(lead.gapId, lead.item, t, money)}
          </p>

          {/*
            The owner's own words for the thing — a service name, a quote title.
            Its own line, never inside the sentence: see `leadSentence`.
          */}
          {lead.item.note && (
            <p className="text-[12.5px] text-[var(--v2-text-secondary)] mb-1 truncate">
              {lead.item.note}
            </p>
          )}

          {leadQualifier(lead.gapId, lead.item, t) && (
            <p className="text-[12.5px] text-[var(--v2-text-muted)] mb-3">
              {leadQualifier(lead.gapId, lead.item, t)}
            </p>
          )}

          <div className="flex gap-2 flex-wrap">
            {/*
              THE PROMOTED ROW CONFIRMS TOO, AND HAD TO BE SAID SEPARATELY.

              This button has its own render and reads none of the row state
              the list below tracks — no working, no done. So the moment the
              irreversible actions started asking first, its first tap set the
              row to `confirming` and NOTHING on screen changed: the label
              stayed put, and a reader who assumed nothing had happened tapped
              again and sent it. A confirmation that is invisible is worse than
              none, because it trains the second tap.
            */}
            {(() => {
              const leadKey = rowKey(leadGap!, lead.item as GapItemView);
              const leadAction = actionFor(leadGap!, lead.item as GapItemView);
              const asking = rows[leadKey]?.kind === 'confirming';
              return (
                <>
                  <button
                    type="button"
                    onClick={() => act(leadGap!, lead.item as GapItemView)}
                    /*
                     * ─────────────────────────────────────────────────────────
                     * THE SAME BUTTON AS EVERY ROW IN THE LIST BELOW.
                     *
                     * The lead row was built first and kept its own metrics —
                     * 13px text in `px-4 py-2`, no lift, no hover, no press —
                     * while the rows underneath are `text-xs` in `px-3 py-1.5`
                     * with `ap-primary-lift`, a brightness hover and a scale on
                     * press. One card, two buttons, and the bigger flatter one
                     * sat directly above the smaller lively ones.
                     *
                     * `ap-primary-lift` is a class rather than an inline
                     * shadow for the reason `globals.css` records: the shadow
                     * is a colour-mix of the primary and cannot be expressed
                     * inline without losing its dark-mode form.
                     * ─────────────────────────────────────────────────────────
                     */
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg ap-primary-lift transition-all hover:brightness-110 active:scale-[0.97]"
                    style={{ background: 'var(--v2-primary)', color: '#fff' }}
                  >
                    {asking
                      ? (leadAction === 'cancel_booking'
                          ? t('gaps.confirm.cancel_booking') || 'Cancel and tell {name}'
                          : t('gaps.confirm.email') || 'Email {name} now'
                        ).replace('{name}', lead.item.name)
                      : t(`gaps.action.${leadAction}`)}
                  </button>
                  {asking && (
                    <button
                      type="button"
                      onClick={() => setRow(leadKey, { kind: 'idle' })}
                      /* Sized to the button it sits beside, like the list's. */
                      className="px-2.5 py-1.5 text-xs font-semibold rounded-lg text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] transition-colors"
                    >
                      {t('common.cancel') || 'Cancel'}
                    </button>
                  )}
                </>
              );
            })()}
            <button
              type="button"
              onClick={() => openContact(lead.item.contactId)}
              /* Sized to the row button it stands beside. It kept the lead
                 row's original `text-[13px] px-4 py-2`, so once the primary
                 next to it became the list's button this one was visibly
                 taller than the thing it is paired with. */
              className="inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors hover:border-[var(--v2-text-muted)]"
              style={{
                background: 'transparent',
                color: 'var(--v2-text-secondary)',
                border: '1px solid var(--v2-border)',
              }}
            >
              {t('gaps.lead.open_contact')}
            </button>
          </div>
        </div>
      )}

      {/*
        The fold. Hidden entirely when this is the only task, because "and 0
        more" is a control that does nothing.
      */}
      {/*
        Only where there is a headline to fold BACK to. With no lead — every
        task already being answered automatically — the list is the card, and a
        control offering to hide it would leave the card blank.
      */}
      {lead && total > 1 && (
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="w-full flex items-center justify-between text-[13px] mt-3 pt-3"
          style={{
            borderTop: '1px solid color-mix(in srgb, var(--v2-border) 50%, transparent)',
            color: 'var(--v2-text-secondary)',
            background: 'transparent',
          }}
        >
          <span>
            {expanded
              ? t('gaps.lead.collapse')
              : t('gaps.lead.more').replace('{n}', String(total - 1))}
          </span>
          <span aria-hidden="true" className="text-[var(--v2-text-muted)]">
            {expanded ? '×' : (isRTL ? '←' : '→')}
          </span>
        </button>
      )}

      {/*
        Shown when the owner opens it, and ALWAYS when there is no lead: a card
        that has tasks must never render nothing.
      */}
      <div className="flex flex-col gap-3" hidden={Boolean(lead) && !expanded}>
        {gaps.map(gap => (
          <div key={gap.id}>
            {/*
              The kind, said once, rather than repeated on every row.

              Set in sentence case rather than `uppercase tracking-wide` at
              11px. This card carries one of these above every group, so that
              treatment put the heaviest emphasis in each block on the one line
              the owner cannot act on. The names under it are the content; this
              only has to label them.
            */}
            {/*
              A LABEL NOW, NOT A HEADLINE.

              It was the heaviest line in each block, which was right while the
              rows beneath it were bare names: the heading was the only thing
              saying what kind of trouble they were in. Every row now carries
              its own sentence, so the heading repeats what is directly under
              it — "the client cancelled" above "{name} cancelled the
              appointment, and you are holding ₪250".

              Kept, because it still groups rows of one kind and carries the
              overflow count. Demoted, because emphasis belongs on the line the
              owner can act on.
            */}
            <p className="text-[11px] font-medium text-[var(--v2-text-muted)] mb-1.5">
              {t(`gaps.kind.${gap.id}`)}
              {gap.count > gap.items.length && (
                <span className="font-normal text-[var(--v2-text-muted)]"> · {gap.count}</span>
              )}
            </p>

            <div className="flex flex-col gap-2">
              {gap.items.map(item => {
                const key = rowKey(gap, item);
                const state = rows[key] ?? { kind: 'idle' };
                // The queued strip's own request (Send now / Cancel) lives on its own key.
                const isQueuedWorking = rows[`queued:${item.contactId}`]?.kind === 'working';
                const action = actionFor(gap, item);
                const Icon = ACTION_ICON[action || ''] || Send;
                /*
                 * The same action, asked as a different question.
                 *
                 * `bill_stage` ordinarily reads "mark done and bill", which is
                 * the right words over work a person has already said was
                 * done. Over an hour only a clock vouched for it is the wrong
                 * request: it tells the owner to charge when what they have to
                 * do first is decide whether there is anything to charge for.
                 *
                 * Same button, same endpoint — the stage is billed either way.
                 * Only the sentence changes, so the one row that needs a
                 * judgement asks for one.
                 */
                const actionKey =
                  item.autoHeld && action === 'bill_stage' ? 'bill_stage_auto_held' : action;

                return (
                  <div
                    key={key}
                    /*
                      A rail instead of a box, and a fill only on hover.
                      ─────────────────────────────────────────────────────────
                      Each row used to be an outlined, filled card inside an
                      outlined, filled card, so the list read as a grid of equal
                      cells with no front to it. Removing the row's border and
                      its resting fill leaves a 2px rail on the start edge to
                      give the list a spine, and frees the fill to mean
                      something: it now appears under the pointer.

                      `border-s-2` / `ps-3` are LOGICAL, so the spine sits on
                      the right in Hebrew without a second rule. The hover fill
                      is `--v2-bg`, the token one step from the card's own
                      `--v2-surface`, which lifts in light mode and deepens in
                      dark from the same single declaration.

                      The rail carries the one signal this card already treats
                      as loudest: amber when a payment plan is still charging
                      for an appointment that is not happening, because that row
                      is money leaving an account while it waits.
                    */
                    className="p-2.5 ps-3 rounded-xl border-s-2 transition-colors hover:bg-[var(--v2-bg)]"
                    style={{
                      /*
                        `--v2-warning` is #F59E0B in BOTH theme blocks, which is
                        the same amber the plan-still-charging sentence beside it
                        reaches for through Tailwind, so the rail and the text it
                        marks cannot drift apart.

                        `color-mix` degrades safely HERE but would not as a
                        Tailwind class: compiling `hover:bg-[color-mix(...)]`
                        emits bare `background-color: var(--v2-primary)` as its
                        pre-`@supports` fallback, which paints the whole row
                        solid indigo on anything lacking color-mix. An
                        unsupported INLINE declaration is simply dropped, and
                        the border falls back to currentColor.
                      */
                      borderInlineStartColor: item.planLive
                        ? 'var(--v2-warning)'
                        : 'color-mix(in srgb, var(--v2-primary) 50%, transparent)',
                    }}
                  >
                    {/*
                      ON A PHONE THE BUTTON TAKES ITS OWN LINE.

                      Side by side, the action is `shrink-0` and the subject is
                      `truncate`, so every pixel the button needs comes out of
                      the text — and the button's label is a whole phrase
                      ("כתיבת הצעה", "Write a quote"). At phone width that left
                      the row reading "אופיר עומר · הצעת מחיר לש…", which cuts
                      off exactly the half that says WHICH job is waiting. The
                      name survives and the subject does not, which is the wrong
                      way round: the owner knows their clients and is looking
                      for the thing.

                      A column below `sm`, the same row above it. Stacking is
                      done on the CONTAINER rather than by giving the subject a
                      full basis: `flex-1` already sets `flex-basis: 0%`, and
                      which of the two wins is decided by their order in the
                      stylesheet rather than in the class list, so it is not a
                      thing to rely on. A column stretches its children by
                      default, so the subject gets the full width with no
                      second rule at all.
                    */}
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                      <div className="min-w-0 flex-1">
                        {/*
                          * WHO, and WHICH THING OF THEIRS, on one line.
                          *
                          * The note was its own row — so a phase waiting to be
                          * billed cost three stacked lines (name, "באמצע",
                          * then the clock) for two facts. They belong together:
                          * "אופיר עומר · באמצע" is one thought, and reads as
                          * one.
                          */}
                        <p className="text-sm text-[var(--v2-text-primary)] flex items-baseline gap-2">
                          {/*
                            CLAMPED TO TWO LINES, NOT TRUNCATED TO ONE.

                            `truncate` was right for "{name} · {service}":
                            a name that does not fit is still recognisable from
                            its first half. A sentence cut mid-clause is not —
                            "this phase of Dana's job is finished as far as…"
                            states a client and then stops before the point,
                            which is worse than the bare name it replaced.

                            Two lines holds every sentence in the set at this
                            column width, and `min-w-0` is what lets it shrink
                            inside the flex row instead of pushing the money
                            and the button off the end.
                          */}
                          <span className="line-clamp-2 min-w-0">
                            {/*
                              * THE SENTENCE, ON EVERY ROW — NOT ONLY THE LEAD.
                              *
                              * These rows used to read "{name} · {service}"
                              * under a heading that stated a STATUS: "the
                              * client cancelled", "waiting for an answer". A
                              * status plus a name is a record, not a task, and
                              * the owner had to infer the job from the button.
                              *
                              * The sentence that does say it already existed
                              * and was already translated — `leadSentence` —
                              * but only the single promoted row was given it.
                              * So the card explained itself least at the exact
                              * moment it had most to explain: opening it to
                              * see all the work replaced the one sentence with
                              * a list of names.
                              *
                              * Same function the lead uses, so the two can
                              * never describe one row differently.
                              */}
                            <span className="font-medium">
                              {/*
                                No full stop, because something always follows
                                it here: the channel chip, the session number,
                                the amount. "…and nobody has replied. · from
                                the form" collides two fragments; without the
                                stop the chips read as the continuation they
                                are. The lead keeps its stop — nothing follows
                                it there, and it is a sentence on its own.
                              */}
                              {leadSentence(gap.id, item, t, money).replace(/[.。]\s*$/, '')}
                            </span>
                            {/*
                              * WHICH session, where the row is one of several.
                              *
                              * A package bills per meeting, so its stages share
                              * a client, a job and an amount — five rows
                              * identical to the character, with nothing saying
                              * which one had just been billed.
                              *
                              * Said HERE rather than folded into `note` because
                              * the gaps run server-side with no language
                              * resolved: the number travels, the sentence is
                              * built in the reader's own words.
                              */}
                            {/*
                              * WHERE IT CAME FROM, where that is not obvious.
                              *
                              * A lead an agent read out of the mailbox is
                              * stored with the same `source` as one typed into
                              * the website form — deliberately, so the
                              * unanswered-enquiry chase sees both. The result
                              * was a row reading "Website contact · just now"
                              * for an email the owner had never seen, with
                              * nothing saying an agent had found and filed it.
                              *
                              * Only the inbox is named: a form submission IS
                              * the ordinary case, and labelling every row with
                              * its channel would be noise on all but a few.
                              */}
                            {item.via === 'inbox_channel' && (
                              <span className="text-[var(--v2-text-muted)]">
                                {' · '}
                                {(() => {
                                  /*
                                   * NAME THE AGENT AND THE MAILBOX.
                                   *
                                   * "Found in your inbox" said where it was
                                   * without saying what did the finding, and
                                   * the distinction is the whole point of the
                                   * row: this enquiry reached the CRM because
                                   * an agent read the owner's mail, not
                                   * because anybody opened it. An owner who
                                   * does not know that cannot tell a working
                                   * agent from a lucky coincidence.
                                   *
                                   * The provider is absent on leads filed
                                   * before it was recorded, so the generic
                                   * sentence stays as the fallback rather
                                   * than leaving a blank where a mailbox
                                   * should be.
                                   */
                                  const key =
                                    item.viaProvider === 'google-mail'
                                      ? 'gaps.via.agent_gmail'
                                      : item.viaProvider === 'outlook'
                                        ? 'gaps.via.agent_outlook'
                                        : 'gaps.via.agent';
                                  return t(key) === key ? t('gaps.via.agent') : t(key);
                                })()}
                              </span>
                            )}
                            {typeof item.sessionNumber === 'number' && (
                              <span className="text-[var(--v2-text-muted)]">
                                {' · '}
                                {(t('gaps.session_number') || 'Session {n}').replace(
                                  '{n}',
                                  String(item.sessionNumber)
                                )}
                              </span>
                            )}
                          </span>
                          {/*
                            * The amount, said as what it IS on this gap, on the
                            * subject's line rather than after the clock.
                            *
                            * It used to sit mid-sentence beside the days, so the
                            * figures wandered left and right down the list and
                            * could not be compared without reading every row.
                            * `ms-auto` lands every one of them on the same edge,
                            * which turns a list of rows into a column of money —
                            * and the money is what decides which row is dealt
                            * with first. See `VALUE_LABEL` for why the WORD in
                            * front of it changes per gap.
                            */}
                          {moneyHeld(item) && !sentenceCarriesAmount(gap.id, t) && (
                            <span className="ms-auto shrink-0 text-[11px]">
                              <span className="text-[var(--v2-text-muted)]">
                                {t(VALUE_LABEL[gap.id] ?? 'gaps.held')}{' '}
                              </span>
                              <span className="font-semibold tabular-nums">
                                {money(item.value as number, item.currency)}
                              </span>
                            </span>
                          )}
                        </p>

                        <p className="text-[11px] text-[var(--v2-text-muted)] mt-1 flex items-center gap-1">
                          {/*
                            THE JOB, DOWN HERE WITH THE REST OF THE CONTEXT.

                            It used to sit on the line above as "{name} ·
                            {service}", which worked while that line was a
                            name. It is a sentence now, and a sentence ends in
                            a full stop — "…and you are holding ₪250. · Payment
                            review" reads as two fragments collided.

                            It belongs here anyway: which service they bought
                            is the same KIND of fact as when it happened and
                            which session it was, and those were already here.
                          */}
                          {item.note && (
                            <>
                              <span className="truncate">{item.note}</span>
                              <span aria-hidden="true">·</span>
                            </>
                          )}
                          <Clock className="w-3 h-3 shrink-0" />
                          {/*
                            * "17 days" alone is a measurement, not a fact.
                            *
                            * Seventeen days of WHAT — the owner asked exactly
                            * that. Every gap starts its clock on a different
                            * event: a phase counts from the day the client
                            * accepted the quote, an invoice from the day it
                            * fell due, an enquiry from the day they wrote in.
                            * The row now names that event, and the exact date
                            * stays in the tooltip rather than spending width on
                            * a line that has to stay short.
                            *
                            * `gaps.waiting` is the fallback, for a gap added
                            * later with no phrase of its own yet.
                            */}
                          <span title={startedOn(item.since)} className="truncate">
                            {(() => {
                              /*
                               * WHAT THE CLOCK IS COUNTING FROM, which is not
                               * the same for every row of one gap.
                               *
                               * `stage_awaiting_completion` says "since they
                               * approved the quote", and that was true while a
                               * stage had no date of its own. A package stage
                               * now dates itself by the SESSION it bills, so
                               * the same sentence would read "4 days since they
                               * approved" over a figure counted from a meeting
                               * held yesterday — the phrase contradicting the
                               * number beside it.
                               *
                               * The session number is what distinguishes them:
                               * present only where `since` is a session.
                               */
                              const key =
                                typeof item.sessionNumber === 'number'
                                  ? `gaps.since.${gap.id}_session`
                                  : `gaps.since.${gap.id}`;
                              const phrase = t(key) === key ? null : t(key);
                              const fallback =
                                t(`gaps.since.${gap.id}`) === `gaps.since.${gap.id}`
                                  ? t('gaps.waiting')
                                  : t(`gaps.since.${gap.id}`);

                              return (phrase ?? fallback).replace('{t}', waitedFor(item.since, t));
                            })()}
                          </span>

                          {/* The date itself, because the figure beside it is
                              relative and nothing else on this row can be
                              matched against the diary or the drawer. */}
                          {onDay(item.since) && (
                            <span className="shrink-0 text-[var(--v2-text-muted)]">
                              {' · '}
                              <bdi>{onDay(item.since)}</bdi>
                            </span>
                          )}
                          {/*
                            * When the platform will answer this itself.
                            *
                            * Only an unmarked meeting carries it, and only
                            * while `auto_complete_meetings` is on. Without it
                            * the row asked the owner to decide, said nothing
                            * about the automation due in ten hours, and then
                            * vanished when it ran — a task disappearing with
                            * no explanation is how somebody stops trusting
                            * the list.
                            *
                            * A sentence, not a control: the seven-day triage
                            * row already lets them correct it afterwards.
                            */}
                          {item.closingAt && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-[var(--v2-text-muted)] truncate">
                                {t('gaps.closing_at').replace(
                                  '{time}',
                                  new Date(item.closingAt).toLocaleTimeString(undefined, {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })
                                )}
                              </span>
                            </>
                          )}
                          {/*
                            * Said even when nothing is held, because this is
                            * not a detail about the row — it is money STILL
                            * LEAVING the client's account for an appointment
                            * that is not happening, and it continues until
                            * somebody decides otherwise.
                            */}
                          {item.planLive && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-medium text-amber-600 dark:text-amber-400 truncate">
                                {t('gaps.plan_still_charging')}
                              </span>
                            </>
                          )}
                          {/*
                            * WHY THIS ROW DESERVES A SECOND LOOK BEFORE IT IS
                            * BILLED.
                            *
                            * Every other row here says a person decided
                            * something and the money follows. This one says a
                            * clock did: `auto_complete_meetings` marked the
                            * meeting held because its date went by, which is
                            * the only answer it has — and a date passing is
                            * not evidence anyone attended.
                            *
                            * Without the sentence the row is indistinguishable
                            * from one the owner closed themselves, and the
                            * button beside it charges a client for an hour
                            * nobody has vouched for. Amber for the same reason
                            * the plan warning is: not an error, a thing to
                            * check before acting.
                            *
                            * `truncate` is deliberately NOT used — this one has
                            * to be readable, and it is the last thing on the
                            * line.
                            */}
                          {item.autoHeld && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-medium text-amber-600 dark:text-amber-400">
                                {t('gaps.auto_held_check') ||
                                  'Marked automatically because the date passed, worth checking it happened'}
                              </span>
                            </>
                          )}
                          {/*
                            * WHY A SECOND LINK IS WORTH SENDING.
                            *
                            * The cancellation email already carried a booking
                            * button: the path a client cancels through does
                            * not suppress it. So on its face this row asks the
                            * owner to send something the client has had since
                            * the moment they cancelled, and read that way it
                            * is noise.
                            *
                            * What makes it a task is the part the row never
                            * said: they have not come back. That is now a
                            * CHECKED fact rather than an assumption — a
                            * contact with any future hour is filtered out of
                            * this gap entirely — so the sentence states
                            * exactly what the data behind it means, and the
                            * owner can tell a personal nudge from a duplicate.
                            *
                            * Only on the empty-slot case. Where money is held
                            * the row is about the refund, and the client's
                            * diary is beside the point.
                            */}
                          {gap.id === 'booking_cancelled' && action === 'send_booking_link' && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-[var(--v2-text-muted)]">
                                {t('gaps.cancelled_not_rebooked') ||
                                  'has not booked again since'}
                              </span>
                            </>
                          )}
                        </p>
                      </div>

                      {/*
                        THE SECOND TAP, FOR WHAT CANNOT BE UNDONE.

                        Replaces the button in place rather than opening a
                        dialog: the owner is looking at a list, and a modal per
                        row would cover the thing they came to read. The row
                        itself asks, and the answer is one control away in
                        either direction.

                        The confirm NAMES THE CONSEQUENCE — "Email Dana now",
                        "Cancel and tell Dana" — because the original label was
                        the problem. "Send it" and "Follow up" gave no sign
                        that a real message reaches a real client the instant
                        they are pressed.
                      */}
                      {action && state.kind === 'confirming' && (
                        <span className="shrink-0 self-start inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => act(gap, item)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg ap-primary-lift transition-all hover:brightness-110 active:scale-[0.97]"
                            style={{ background: 'var(--v2-primary)', color: '#fff' }}
                          >
                            {(action === 'cancel_booking'
                              ? t('gaps.confirm.cancel_booking') ||
                                'Cancel and tell {name}'
                              : t('gaps.confirm.email') || 'Email {name} now'
                            ).replace('{name}', item.name)}
                          </button>
                          {/* The way out. Quiet, because backing out of
                              something irreversible should not need deciding
                              between two loud buttons. */}
                          <button
                            type="button"
                            onClick={() => setRow(key, { kind: 'idle' })}
                            aria-label={t('common.cancel') || 'Cancel'}
                            title={t('common.cancel') || 'Cancel'}
                            className="px-2 py-1.5 text-xs rounded-lg text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] transition-colors"
                          >
                            ✕
                          </button>
                        </span>
                      )}

                      {action && state.kind !== 'confirming' && (
                        <button
                          type="button"
                          onClick={() => act(gap, item)}
                          disabled={state.kind === 'working' || state.kind === 'done'}
                          /*
                            The one thing on the row meant to be pressed, so it
                            is allowed to look like it: a little more padding, a
                            lift in its own colour, and a press state. It was a
                            flat rectangle that read as a label.

                            Once DONE it stops asking. Keeping the solid fill on
                            a finished action left the loudest element on the row
                            pointing at the one thing already handled, and it is
                            `disabled` by then — so it goes to a quiet success
                            tint and drops the lift, while `opacity` stays for
                            `working`, which is still in flight.
                          */
                          /* `self-start`: the row above is a COLUMN on a phone,
                             which stretches its children, and a button stretched
                             to the full width of the card reads as the card's
                             action rather than this row's. */
                          /* `ap-primary-lift` only while it is the primary
                             button: the done state is a tinted chip and wants
                             no shadow at all. See the rule in `globals.css`
                             for why the lift cannot stay inline. */
                          className={`shrink-0 self-start inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all hover:brightness-110 active:scale-[0.97] disabled:active:scale-100 disabled:hover:brightness-100${
                            state.kind === 'done' ? '' : ' ap-primary-lift'
                          }`}
                          style={
                            state.kind === 'done'
                              ? {
                                  background:
                                    'color-mix(in srgb, var(--v2-success) 14%, transparent)',
                                  color: 'var(--v2-success)',
                                }
                              : {
                                  background: 'var(--v2-primary)',
                                  color: '#fff',
                                  opacity: state.kind === 'working' ? 0.6 : undefined,
                                }
                          }
                        >
                          {state.kind === 'done' ? (
                            <>
                              <Check className="w-3.5 h-3.5" />
                              {t('gaps.done')}
                            </>
                          ) : (
                            <>
                              <Icon className="w-3.5 h-3.5" />
                              {state.kind === 'working'
                                ? t('gaps.working')
                                : t(`gaps.action.${actionKey}`)}
                              {/* See `OPENS_A_SCREEN`: this one goes somewhere
                                  rather than doing something. Mirrored, because
                                  it points the way the reader is going. */}
                              {state.kind === 'idle' && OPENS_A_SCREEN.has(action) && (
                                <span aria-hidden="true" className="opacity-70">
                                  {isRTL ? '‹' : '›'}
                                </span>
                              )}
                            </>
                          )}
                        </button>
                      )}
                    </div>

                    {item.queued && state.kind === 'idle' && (
                      <div
                        className="mt-2 pt-2 border-t flex items-center justify-between gap-2"
                        style={{ borderColor: 'var(--v2-border)' }}
                      >
                        <p className="text-[11px] text-[var(--v2-text-muted)] min-w-0">
                          {t('gaps.will_send')} {item.queued.label}
                          {item.queued.dueAt && <> · {dueIn(item.queued.dueAt, t)}</>}
                        </p>
                        {/*
                          "Send now" waits for the send (BL-7a part 2), so say so
                          and take both buttons away: no second click while it runs.
                        */}
                        {isQueuedWorking ? (
                          <span className="text-[11px] text-[var(--v2-text-muted)]" aria-live="polite">{t('gaps.working')}</span>
                        ) : (
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => control(item, 'send_now')}
                              className="text-[11px] font-medium text-[var(--v2-primary)] hover:opacity-70"
                            >
                              {t('gaps.send_now')}
                            </button>
                            <span className="text-[var(--v2-border)]">·</span>
                            <button
                              type="button"
                              onClick={() => control(item, 'cancel')}
                              className="text-[11px] font-medium text-[var(--v2-text-muted)] hover:opacity-70"
                            >
                              {t('gaps.cancel')}
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/*
                      The second answer, in the shape the queued reply above
                      already uses: a quiet text control rather than a second
                      loud button. "Cancel it" is the likelier move and keeps
                      the primary button; this is the one that says the session
                      is still happening — and lets the client's reminder,
                      held while the question is open, resume.
                    */}
                    {gap.id === 'booking_refunded' && state.kind === 'idle' && (
                      <div
                        className="mt-2 pt-2 border-t flex items-center justify-between gap-2"
                        style={{ borderColor: 'var(--v2-border)' }}
                      >
                        <p className="text-[11px] text-[var(--v2-text-muted)] min-w-0">
                          {t('gaps.refunded_hint')}
                        </p>
                        <button
                          type="button"
                          onClick={() => keepAfterRefund(gap, item)}
                          className="text-[11px] font-medium text-[var(--v2-primary)] hover:opacity-70 shrink-0"
                        >
                          {t('gaps.action.keep_booking')}
                        </button>
                      </div>
                    )}

                    {/*
                      THE OTHER ANSWER TO A CANCELLED BOOKING.

                      Refunding is the likelier move and keeps the primary
                      button. This is the one that says the money stays — a
                      deposit forfeited inside its cancellation window, which
                      is ordinary, agreed in advance, and was impossible to
                      record. The gap holds a row for as long as money is
                      unreturned, so without this the owner was asked the same
                      question every day and had no way to answer it.

                      Only where money is actually held: with nothing to keep
                      the offer is meaningless, and the row is then about
                      refilling the hour rather than about the money.

                      Quiet text, not a second loud button — the same treatment
                      its mirror above uses, and for the same reason: backing a
                      decision out of a list should not look like the headline
                      act.
                    */}
                    {gap.id === 'booking_cancelled' &&
                      moneyHeld(item) &&
                      state.kind === 'idle' && (
                        <div
                          className="mt-2 pt-2 border-t flex items-center justify-between gap-2"
                          style={{ borderColor: 'var(--v2-border)' }}
                        >
                          <p className="text-[11px] text-[var(--v2-text-muted)] min-w-0">
                            {t('gaps.kept_payment_hint') ||
                              'Keeping it? We will stop asking about this one.'}
                          </p>
                          <button
                            type="button"
                            onClick={() => keepThePayment(gap, item)}
                            className="text-[11px] font-medium text-[var(--v2-primary)] hover:opacity-70 shrink-0"
                          >
                            {t('gaps.action.keep_payment') || 'Keep it'}
                          </button>
                        </div>
                      )}

                    {rows[`queued:${item.contactId}`]?.kind === 'refused' && (
                      <p className="mt-2 text-[11px] flex items-start gap-1.5 text-[var(--v2-text-muted)]">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
                        <span>{(rows[`queued:${item.contactId}`] as { message: string }).message}</span>
                      </p>
                    )}

                    {state.kind === 'refused' && (
                      <p className="mt-2 text-[11px] flex items-start gap-1.5 text-[var(--v2-text-muted)]">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
                        <span>{state.message}</span>
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/*
        The one refund dialog, opened from the dashboard.

        It knows things a POST from here cannot: what is actually left to refund
        (it re-reads the server figure rather than trusting the amount passed
        in), whether a payment plan is still running, and whether the money came
        through Stripe at all. Rendered inside the card because it portals out
        of it anyway.
      */}
      {refunding && (
        <RefundModal
          isOpen
          onClose={() => setRefunding(null)}
          bookingId={refunding.bookingId}
          originalAmount={refunding.amount}
          currency={refunding.currency}
          contactName={refunding.name}
          isRTL={isRTL}
          onSuccess={() => {
            setRefunding(null);
            // The row has changed — refetch so a settled one leaves the card.
            onChanged?.();
          }}
          /*
           * REQUIRED, not optional. The dialog renders no error of its own —
           * every failure is handed to this callback — so leaving it off would
           * make a refused refund look like nothing happened at all, on the one
           * action here that moves real money.
           */
          onError={message => toast.error(message)}
        />
      )}
    </div>
  );
}

/**
 * How long it has been stuck, in the units a person would say out loud.
 *
 * Deliberately coarse: nobody acts differently on four hours versus five, and
 * "3 days" is the number that decides whether this is now urgent.
 */
function waitedFor(since: string, t: (key: string) => string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 60000));
  if (minutes < 60) return t('gaps.just_now');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}${t('gaps.hours_short')}`;
  return `${Math.floor(hours / 24)}${t('gaps.days_short')}`;
}

/**
 * The date the clock started, for the tooltip beside it.
 *
 * "17 days" answers how long; this answers since when, which is the question
 * an owner asks next and the one the row has no width to answer inline.
 */
/**
 * The same instant, short enough to sit on the row itself.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `startedOn` is the long form and lives in the row's `title`, which is a
 * tooltip: it needs a mouse, and the owner reading this card is as likely to
 * be on a phone. So the only date they could actually see was a relative one —
 * "4 days since" — and a relative figure cannot be matched against anything.
 * The drawer lists sessions by DATE, the diary is by date, and the owner was
 * being asked to find "the one from four days ago" by counting backwards.
 *
 * No year: every row on this card is recent by construction, and a year on
 * each one costs width that the note needs more.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function onDay(since: string): string {
  const date = new Date(since);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function startedOn(since: string): string {
  const date = new Date(since);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Floored at a minute: "in 0 minutes" reads as already gone. */
function dueIn(dueAt: string, t: (key: string) => string): string {
  const minutes = Math.ceil((new Date(dueAt).getTime() - Date.now()) / 60000);
  if (minutes <= 1) return t('gaps.due_now');
  return t('gaps.due_in').replace('{n}', String(minutes));
}

/**
 * A refusal reason, in words.
 *
 * `t()` answers with the KEY when it does not know one, which is truthy — so a
 * `t(key) || t(fallback)` chain never reaches its fallback and an unmapped
 * reason renders as the literal string `gaps.refused.invoice_gone` on a
 * customer's dashboard. Deciding on the key list here is what stops that.
 */
const KNOWN_REASONS = new Set([
  'no_contact_email',
  'no_booking_url',
  'journey_not_ready',
  'not_found',
  'send_failed',
  'already_sending',
  'already_settled',
  'already_returned',
  'appointment_passed',
  'not_approved',
  /*
   * The refund route's own refusals, which arrive as `code` rather than
   * `reason` and in upper case. Both are normalised below: a refusal the owner
   * cannot read is a dead end on the one action that moves real money.
   */
  'ambiguous_target',
  'not_positive',
]);

function translateReason(t: (key: string) => string, reason?: string): string {
  const key = reason?.toLowerCase();
  return key && KNOWN_REASONS.has(key)
    ? t(`gaps.refused.${key}`)
    : t('gaps.refused.generic');
}
