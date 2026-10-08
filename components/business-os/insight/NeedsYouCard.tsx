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

export interface GapItemView {
  contactId: string;
  name: string;
  note: string | null;
  since: string;
  entityId: string | null;
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
}

export interface GapView {
  id: string;
  action: GapAction;
  count: number;
  items: GapItemView[];
}

interface NeedsYouCardProps {
  gaps: GapView[];
  /** Refetch, so a cleared row leaves the list. */
  onChanged?: () => void;
}

type RowState =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'done' }
  | { kind: 'refused'; message: string };

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
  stage_awaiting_completion: 'gaps.value.to_bill',
  invoice_unpaid: 'gaps.value.owed',
  quote_unsent: 'gaps.value.quoted',
  quote_awaiting_client: 'gaps.value.quoted',
};

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

export function NeedsYouCard({ gaps, onChanged }: NeedsYouCardProps) {
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
    const target = item.entityId
      ? `&booking=${encodeURIComponent(item.entityId)}`
      : '';
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

      <div className="flex flex-col gap-3">
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
            <p className="text-[12px] font-semibold text-[var(--v2-text-secondary)] mb-1.5">
              {t(`gaps.kind.${gap.id}`)}
              {gap.count > gap.items.length && (
                <span className="font-normal text-[var(--v2-text-muted)]"> · {gap.count}</span>
              )}
            </p>

            <div className="flex flex-col gap-2">
              {gap.items.map(item => {
                const key = rowKey(gap, item);
                const state = rows[key] ?? { kind: 'idle' };
                const action = actionFor(gap, item);
                const Icon = ACTION_ICON[action || ''] || Send;

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
                    <div className="flex items-start justify-between gap-3">
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
                          <span className="truncate">
                            <span className="font-medium">{item.name}</span>
                            {item.note && (
                              <span className="text-[var(--v2-text-muted)]"> · {item.note}</span>
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
                          {moneyHeld(item) && (
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
                            {(t(`gaps.since.${gap.id}`) === `gaps.since.${gap.id}`
                              ? t('gaps.waiting')
                              : t(`gaps.since.${gap.id}`)
                            ).replace('{t}', waitedFor(item.since, t))}
                          </span>
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
                        </p>
                      </div>

                      {action && (
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
                          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all hover:brightness-110 active:scale-[0.97] disabled:active:scale-100 disabled:hover:brightness-100"
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
                                  boxShadow:
                                    '0 2px 8px -2px color-mix(in srgb, var(--v2-primary) 55%, transparent)',
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
                                : t(`gaps.action.${action}`)}
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
