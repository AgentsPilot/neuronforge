'use client';

/**
 * RefundModal
 *
 * Modal for processing full or partial refunds.
 * Optionally supports deleting the associated booking after refund (for CRM drawer).
 */

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { SwitchRow } from './SwitchRow';
import { REFUND_REASON_KEYS } from '@/lib/payments/refundReasons';
import { CancelPlanModal } from './CancelPlanModal';
import { Input } from '@/components/ui/input';
import { Ban, Banknote, Loader2, AlertTriangle, RotateCcw, Trash2 } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { STOP_REASONS, cancelReasonKey, type StopReason } from '@/lib/business-os/cancellationReasons';

interface RefundModalProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * What is being refunded. Exactly one is needed — the server resolves the
   * payment behind an invoice or a booking, so a caller that only knows an
   * invoice does not have to go looking for its transaction first.
   */
  transactionId?: string;
  invoiceId?: string;
  originalAmount: number;
  currency: string;
  alreadyRefunded?: number;
  contactName?: string;
  onSuccess?: (deleteBooking?: boolean) => void;
  onError?: (error: string) => void;
  // Optional: for CRM drawer integration - show delete booking toggle
  bookingId?: string;
  showDeleteBookingOption?: boolean;
  /**
   * The booking's current status, so a terminal one is not offered a cancellation.
   *
   * Absent means unknown, which keeps the old behaviour for any caller not yet
   * updated — the option shows. Better than hiding a control somebody needs
   * because a prop was not threaded.
   */
  bookingStatus?: string;
  isRTL?: boolean;
}

export function RefundModal({
  isOpen,
  onClose,
  transactionId,
  invoiceId,
  originalAmount,
  currency,
  alreadyRefunded = 0,
  contactName,
  onSuccess,
  onError,
  bookingId,
  showDeleteBookingOption = false,
  bookingStatus,
  isRTL = false
}: RefundModalProps) {
  const { t, language } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [refundType, setRefundType] = useState<'full' | 'partial'>('full');
  const [partialAmount, setPartialAmount] = useState('');
  /*
   * The chip and the free text are two different things.
   *
   * They used to be one `reason` string: clicking "Client did not show up" put
   * the literal `no_show` into the textarea below it, because the STORED value
   * is the canonical key and the textarea was bound to the stored value. The
   * owner saw an English identifier appear in a box meant for their own words.
   *
   * The key still has to be what is stored — that is what lets every reader
   * render it in their own language, and what stops "no show" / "noshow" /
   * "didn't turn up" being three different reasons in a report. So the key is
   * held separately from anything typed, and only one of them is ever sent.
   */
  const [reasonKey, setReasonKey] = useState<string | null>(null);
  const [reasonText, setReasonText] = useState('');

  /*
   * BOTH are sent now, and both are required.
   *
   * This was `reasonKey ?? reasonText.trim()` — one or the other, never both —
   * so a refund was either countable or explained. A ledger row reading
   * `no_show` could not say the client rang ahead and was refunded anyway; one
   * reading "client called, family emergency" could not be grouped with the
   * other forty no-shows.
   */
  const reason = reasonKey ?? '';
  const reasonNote = reasonText.trim();
  const [notifyContact, setNotifyContact] = useState(true);
  const [deleteBooking, setDeleteBooking] = useState(false);

  /**
   * One id per opening of this modal, so a double click, a retry after a
   * timeout, and React's development double-invoke all carry the SAME value and
   * produce one refund. A ref rather than state: regenerating it on re-render
   * would defeat the entire point.
   */
  /** The server's answer, once it arrives. Null until then. */
  const [serverRemaining, setServerRemaining] = useState<number | null>(null);
  /** Why the server says this cannot be refunded at all. */
  const [serverBlock, setServerBlock] = useState<string | null>(null);
  /**
   * How many settled payments answer to what this dialog was opened on.
   *
   * More than one is ordinary — a deposit and a balance, or a payment plan's
   * periods — and it changes what "full refund" can honestly mean. Before this,
   * the server picked the newest of them and the dialog said "full refund" over
   * one twelfth of a plan.
   */
  const [paymentCount, setPaymentCount] = useState(1);
  /**
   * The processing fee Stripe keeps even when the payment is refunded.
   *
   * Null while unknown, and unknown is not zero: a payment whose fee has not
   * been fetched must say nothing rather than imply the refund is free.
   */
  const [processorFee, setProcessorFee] = useState<{ amount: number; currency: string } | null>(null);
  /**
   * The payment plan still billing this booking, if there is one.
   *
   * Refunding a plan payment does NOT stop the plan — the client is charged
   * again next period. The orders page grew a Stop button and the contact
   * drawer did not, so the same money behaved differently depending on where
   * the owner opened it. The choice lives here instead, in the one dialog all
   * three surfaces share.
   */
  const [livePlan, setLivePlan] = useState<{
    id: string;
    periodsRemaining: number;
    periodsPaid: number;
    installmentCount: number;
  } | null>(null);
  const [stopPlan, setStopPlan] = useState(false);
  /*
   * Why the arrangement is over. Required only when one of the two toggles below
   * is on — a plain refund is not a cancellation, and the appointment may well
   * still be happening.
   *
   * ONE code for both toggles, in this dialog rather than a new one: stopping the
   * plan and cancelling the booking are one decision, and asking twice of
   * somebody who already answered is how a required field becomes noise.
   */
  const [cancelReason, setCancelReason] = useState<StopReason | ''>('');
  /** The stop-plan dialog, opened when the money itself cannot come back. */
  const [showStopPlan, setShowStopPlan] = useState(false);
  /**
   * How the money arrived, when the server says it cannot be refunded.
   *
   * `MISSING_REFERENCE` covers two opposite situations — money that never went
   * through Stripe, and money that did but whose reference was never recorded —
   * and they need opposite advice.
   */
  /*
   * The money never went through a processor, so there is nothing to call — but
   * the business can still return it by hand and tell us. That is a different
   * situation from "blocked", and showing the same dead end for both is what
   * left transfer-based businesses unable to record a refund at all.
   */
  const [recordable, setRecordable] = useState(false);
  const [blockedProcessor, setBlockedProcessor] = useState<string | null>(null);

  const requestId = useRef<string>('');
  if (isOpen && !requestId.current) {
    requestId.current =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `refund-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  // A choice made about one refund must not persist into the next.
  useEffect(() => {
    if (!isOpen) {
      setStopPlan(false);
      setLivePlan(null);
      setShowStopPlan(false);
      setBlockedProcessor(null);
      // `deleteBooking` was missing here, and it is the one flag in this list
      // that DELETES A CUSTOMER'S BOOKING. It was survivable only because every
      // caller unmounts this component on close, destroying the state — but a
      // closed render is now a supported state (see the hoisted effects below),
      // and in that world arming "delete booking", closing, and reopening on a
      // different payment would carry the armed switch across. The effect below
      // only disarms it when the option is not offered; if the next refund also
      // offers it, it would stay on.
      setDeleteBooking(false);
    }
  }, [isOpen]);

  useEffect(() => {
    // A new intent next time this opens.
    if (!isOpen) requestId.current = '';
  }, [isOpen]);

  /**
   * What is really left, according to the server.
   *
   * Three surfaces computed this themselves and two got it wrong — the
   * transaction list passed no `alreadyRefunded` at all and the CRM payment
   * modal used the original amount, so both offered a full refund on money that
   * had already been partly returned. The over-refund guard rejected it, but
   * only after the owner had been shown a figure and pressed the button.
   *
   * `GET /api/payments/refunds?transaction_id=` was written to answer exactly
   * this and had no callers. The prop stays as the fallback for the invoice and
   * booking cases, which the endpoint cannot yet resolve.
   */
  useEffect(() => {
    if (!isOpen) return;

    // Whichever handle this surface holds. The endpoint resolves all three
    // through the same resolver the refund itself uses, so the invoice list and
    // the booking modal get a real answer instead of no answer.
    const query = transactionId
      ? `transaction_id=${transactionId}`
      : invoiceId
        ? `invoice_id=${invoiceId}`
        : bookingId
          ? `booking_id=${bookingId}`
          : null;

    if (!query) return;

    let cancelled = false;

    fetch(`/api/payments/refunds?${query}`)
      .then(response => (response.ok ? response.json() : null))
      .then(body => {
        // The payload is `{ success, data: { refundable, remaining, reason } }`.
        // Reading the outer object gave `undefined` for every field, so this
        // check silently did nothing at all.
        const data = body?.data;
        if (cancelled || !body?.success || !data) return;
        if (typeof data.remaining === 'number') setServerRemaining(data.remaining);
        if (data.refundable === false && data.reason) setServerBlock(data.reason as string);
        if (typeof data.processorType === 'string') setBlockedProcessor(data.processorType);
        // Not refundable by us, but the business can record one it made itself.
        if (data.recordable === true) setRecordable(true);
        if (typeof data.payment_count === 'number') setPaymentCount(data.payment_count);
        if (data.plan?.id) {
          setLivePlan({
            id: data.plan.id,
            periodsRemaining: data.plan.periods_remaining ?? 0,
            periodsPaid: data.plan.periods_paid ?? 0,
            installmentCount: data.plan.installment_count ?? 0,
          });
        }
        if (typeof data.processor_fee === 'number' && data.processor_fee > 0) {
          setProcessorFee({
            amount: data.processor_fee,
            // The fee's OWN currency: Stripe charges it in the settlement
            // currency, which is not always the currency of the payment.
            currency: data.fee_currency || currency,
          });
        }
      })
      .catch(() => {
        // Fall back to the caller's figure rather than blocking the refund.
      });

    return () => { cancelled = true; };
  }, [isOpen, transactionId, invoiceId, bookingId]);

  /*
   * ⚠️ EVERY HOOK MUST STAY ABOVE THE `if (!isOpen) return null` BELOW.
   *
   * The two effects that follow used to sit after it, among the derived consts.
   * That made the hook count 18 when closed and 20 when open, so any render of
   * a still-MOUNTED component with `isOpen` false would throw "Rendered fewer
   * hooks than expected". It never fired only because all five call sites
   * happen to unmount this dialog rather than render it closed — an invariant
   * nobody wrote down and one `setState` split away from a white screen on the
   * payments UI. Do not move them back down.
   *
   * `canOfferDelete` is hoisted with them because they depend on it; it is a
   * plain prop alias, so reading it earlier changes nothing.
   */

  /*
   * Offered for BOTH partial and full refunds, by product decision.
   *
   * Note what it means on a partial: the booking record goes, while the money
   * not returned stays on the ledger — so the payment outlives the appointment
   * it belonged to, and the drawer will no longer show what it was for. The
   * refund and the transaction still carry the history; only the booking's own
   * row is removed.
   *
   * A live payment plan does not withdraw the option — it forces the plan to
   * stop alongside it, below.
   */
  /*
   * Only a booking there is still something to call off.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * A COMPLETED appointment happened. The client came, the work was done, and
   * the money is being returned after the fact — which is a refund, not a
   * cancellation. Offering to cancel it invited the owner to erase the record of
   * delivered work, and worse: the toggle posts `cancel_booking`, which emails
   * the client that their appointment is cancelled. Somebody who attended and
   * paid would have been told their session was called off.
   *
   * `no_show` and `cancelled` are terminal for the same reason — one is over,
   * the other is already done.
   *
   * Unknown status still offers it: a caller that has not been updated should
   * keep what it had rather than silently lose a control.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const CANCELLABLE_BOOKING_STATUSES = ['pending', 'confirmed'];
  const canOfferDelete =
    showDeleteBookingOption &&
    (bookingStatus === undefined || CANCELLABLE_BOOKING_STATUSES.includes(bookingStatus));

  /*
   * A hidden switch must not still be armed.
   *
   * `deleteBooking` kept its value when the refund changed from full to partial:
   * the control disappeared while the flag was still submitted, so a partial
   * refund could delete the booking. State that is no longer offered has to be
   * cleared, not merely hidden.
   *
   * No `if (!isOpen) return` guard: disarming a switch the user cannot see is
   * exactly this effect's job, so skipping it while closed would defeat it.
   */
  useEffect(() => {
    if (!canOfferDelete && deleteBooking) setDeleteBooking(false);
  }, [canOfferDelete, deleteBooking]);

  /*
   * Deleting a booking that still has a live plan MUST stop the plan.
   *
   * Otherwise the schedule keeps charging the client for an appointment that no
   * longer exists, and there is no booking left to reach it from. Forced rather
   * than merely warned about: this is not a combination anyone means to choose.
   *
   * Inert on a closed render because its deps are unchanged by the close itself,
   * and the reset effect above has by then cleared `livePlan`/`stopPlan`/
   * `deleteBooking` — so the guard is false on the following commit too.
   */
  useEffect(() => {
    if (deleteBooking && livePlan && !stopPlan) setStopPlan(true);
  }, [deleteBooking, livePlan, stopPlan]);

  if (!isOpen) return null;

  /*
   * The server answers with a CODE — `MISSING_REFERENCE`, `ACCOUNT_UNRESOLVED`.
   * Rendering that raw would put an identifier in front of a business owner, in
   * English, in a Hebrew interface. Mapped here, with a general sentence for a
   * code this build does not know: new codes are added server-side, and the
   * fallback must be a sentence rather than the code leaking through.
   */
  const BLOCK_MESSAGES: Record<string, string> = {
    // A Stripe payment we simply have no reference for is NOT a payment that
    // bypassed Stripe, and telling the owner it was sends them looking for a
    // cash payment that does not exist.
    MISSING_REFERENCE:
      blockedProcessor === 'manual'
        ? t('payments.refund.blocked_missing_reference')
        : t('payments.refund.blocked_unlinked_stripe'),
    ACCOUNT_UNRESOLVED: t('payments.refund.blocked_account_unresolved'),
    NOT_REFUNDABLE: t('payments.refund.blocked_not_refundable'),
    NOTHING_REMAINING: t('payments.refund.blocked_nothing_remaining'),
    // Both were falling through to the general sentence, which tells the owner
    // nothing they can act on. NOT_FOUND in particular was what an invoice-paid
    // booking produced, and "cannot be refunded right now" reads as a fault
    // rather than as "look on the payments list".
    NOT_FOUND: t('payments.refund.blocked_not_found'),
    AMBIGUOUS_TARGET: t('payments.refund.blocked_ambiguous'),
  };
  /*
   * Recordable is not blocked.
   *
   * `MISSING_REFERENCE` on manual money used to render as a dead end — the
   * dialog explained that the refund had to be made by hand and then offered no
   * way to say it had been. The controls stay live; only what the button DOES
   * changes, and the notice below explains it.
   */
  const blockMessage =
    serverBlock && !recordable
      ? BLOCK_MESSAGES[serverBlock] ?? t('payments.refund.blocked_generic')
      : null;

  /*
   * Several payments behind one booking.
   *
   * "Full" then means all of them, and a partial amount stops being meaningful:
   * there is no honest way to split £120 across twelve periods that the client's
   * card statement would agree with. So the group case offers everything, and
   * the owner refunds a specific period from the payments list instead.
   */
  const isGroup = paymentCount > 1;

  const maxRefundable = serverRemaining ?? originalAmount - alreadyRefunded;
  const effectiveType = isGroup ? 'full' : refundType;

  const refundAmount = effectiveType === 'full' ? maxRefundable : parseFloat(partialAmount) || 0;


  /**
   * Money, without the crash.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * `Intl.NumberFormat` THROWS on an empty or malformed currency code —
   * `RangeError: Invalid currency code` — during RENDER. A caller that opened
   * this dialog without knowing the currency did not get an ugly number, it took
   * the whole page down.
   *
   * A refund dialog is the last place that should do that: it is open because
   * somebody is trying to give money back. So a bad code degrades to the plain
   * amount, and the caller's bug shows as a missing symbol rather than a white
   * screen.
   *
   * Every currency in this file goes through here — the dialog's own and the
   * processor fee's, which is a different code from a different source.
   * ─────────────────────────────────────────────────────────────────────────
   */
  const formatMoney = (amount: number, code: string) => {
    const locale = language === 'he' ? 'he-IL' : language === 'es' ? 'es-ES' : 'en-US';
    try {
      return new Intl.NumberFormat(locale, { style: 'currency', currency: code }).format(amount);
    } catch {
      return new Intl.NumberFormat(locale).format(amount);
    }
  };

  const formatCurrency = (amount: number) => {
    return formatMoney(amount, currency);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (effectiveType === 'partial' && (refundAmount <= 0 || refundAmount > maxRefundable)) {
      onError?.(t('payments.refund.invalid_amount').replace('{amount}', formatCurrency(maxRefundable)));
      return;
    }

    setLoading(true);

    try {
      // One endpoint for every surface. This used to post a `refund_full` /
      // `refund_partial` block to /api/payments/blocks/execute, which threw on a
      // processor registry that is never populated — so this button has never
      // actually issued a refund.
      //
      // A full refund sends NO amount, meaning "everything still remaining".
      // Sending the original amount, as the block did, asks for more than is
      // left once a partial refund has happened.
      const response = await fetch('/api/payments/refunds', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          // Whichever the caller has. The invoices tab knows an invoice, the
          // payments tab a transaction, the CRM drawer a booking.
          transaction_id: transactionId,
          invoice_id: invoiceId,
          booking_id: transactionId || invoiceId ? undefined : bookingId,
          amount: effectiveType === 'partial' ? refundAmount : undefined,
          // Said explicitly, never inferred by the server. Without it a target
          // with several payments is refused rather than guessed at.
          scope: isGroup ? 'all' : 'payment',
          reason,
          reason_note: reasonNote,
          // Collected on every surface since this modal was written, and never
          // transmitted — the field did not exist on the route to receive it.
          notify_contact: notifyContact,
          // Never inferred server-side: stopping and refunding are separate
          // decisions with different right answers.
          stop_plan: stopPlan || undefined,
          /*
           * The switch that did nothing until now.
           *
           * It was held in state and handed to `onSuccess(deleteBooking)`, and
           * every caller is written `onSuccess={() => ...}` — so it was passed to
           * a function that discarded it. Sent to the server instead, beside
           * `stop_plan`, which is the same kind of decision and already works
           * that way: one place to get right rather than four, and the refund and
           * the cancellation come back as one reported outcome.
           */
          cancel_booking: deleteBooking || undefined,
          // Sent only when something is actually being called off; the route
          // requires it exactly then.
          cancel_reason: stopPlan || deleteBooking ? cancelReason : undefined,
          // The business asserting it returned the money itself. The server
          // still checks the payment really had no processor before it believes
          // this — the flag alone cannot close an invoice on a live card charge.
          manual: recordable || undefined,
          client_request_id: requestId.current
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to process refund');
      }

      /*
       * The refund worked; stopping the plan did not.
       *
       * Reported rather than swallowed. The money HAS gone back, so this is not
       * a failed refund — but closing quietly would leave the owner believing
       * the plan stopped while the client goes on being charged, which is the
       * exact situation this switch exists to prevent.
       */
      const planStop = data.data?.plan_stopped;
      if (planStop && planStop.stopped === false) {
        onError?.(
          `${t('payments.refund.plan_not_stopped')}${planStop.error ? ` ${planStop.error}` : ''}`
        );
      }

      /*
       * The refund worked; the cancellation did not.
       *
       * Same treatment as the plan above, and for the same reason: closing
       * quietly would leave the owner believing the slot was freed while the
       * booking still holds it and the client still has a confirmation.
       */
      const cancelled = data.data?.booking_cancelled;
      if (cancelled && cancelled.cancelled === false) {
        onError?.(
          `${t('payments.refund.booking_not_cancelled')}${cancelled.error ? ` ${cancelled.error}` : ''}`
        );
      }

      /*
       * The flag is still passed, and callers still ignore it. That is now
       * correct rather than a bug: the server does the cancelling, and what the
       * callers need from this argument is nothing — they refresh either way.
       */
      onSuccess?.(deleteBooking);
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to process refund';
      onError?.(message);
    } finally {
      setLoading(false);
    }
  };

  /*
   * A real Radix dialog, not a hand-rolled `fixed inset-0`.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * The hand-rolled version worked on the payments page and broke everywhere it
   * was opened from a drawer, because a bare fixed div is rendered INSIDE
   * whatever it is written in:
   *
   *   · The CRM contact drawer is a Sheet at `z-50` that establishes its own
   *     stacking context, so a child at `z-[60]` cannot paint above the SECOND
   *     sheet (the money detail drawer) — the refund dialog opened behind it.
   *   · Clicking anything in it — a radio, a field — was a pointerdown OUTSIDE
   *     the money drawer's portaled content, so Radix dismissed that drawer, and
   *     the cascade took the contact drawer with it. Choosing "partial refund"
   *     closed everything and dropped the owner back on the CRM page.
   *
   * `Dialog` portals to the body and joins Radix's dismissable-layer stack, so
   * it paints above both sheets and — because only the TOPMOST layer handles
   * outside-pointerdown — a click inside it no longer dismisses anything
   * underneath.
   * ───────────────────────────────────────────────────────────────────────────
   */
  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <DialogContent
        className="flex w-full sm:max-w-md h-[100vh] sm:h-auto max-h-[100dvh] sm:max-h-[90dvh] flex-col rounded-none sm:rounded-lg p-0 overflow-hidden"
        dir={isRTL ? 'rtl' : 'ltr'}
      >
      {/* ── Header ────────────────────────────────────────────────────────
          A hero figure rather than a form heading. The number being returned
          is the decision; everything below it is detail. The old dialog led
          with four grey facts of equal weight and the amount had to be worked
          out from them. */}
      <div className="flex-shrink-0 border-b border-[var(--v2-border)] px-5 py-5">
        <div className="flex items-center gap-2.5">
          <span
            className="flex h-8 w-8 items-center justify-center bg-orange-500/10"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            <RotateCcw className="h-4 w-4 text-orange-500" />
          </span>
          <div className="min-w-0">
            <DialogTitle className="text-[15px] font-semibold text-[var(--v2-text-primary)]">
              {t('payments.refund.title')}
            </DialogTitle>
            {contactName && (
              <bdi className="block truncate text-[12px] text-[var(--v2-text-muted)]">
                {contactName}
              </bdi>
            )}
          </div>
        </div>

        <div className="mt-4">
          <div className="text-[28px] font-semibold leading-none tabular-nums text-[var(--v2-text-primary)]">
            {formatCurrency(refundAmount)}
          </div>
          <p className="mt-1.5 text-[12px] text-[var(--v2-text-muted)]">
            {t('payments.refund.max_info').replace('{amount}', formatCurrency(maxRefundable))}
            {alreadyRefunded > 0 && (
              <>
                {' · '}
                {t('payments.refund.already_refunded')}{' '}
                <span className="tabular-nums">{formatCurrency(alreadyRefunded)}</span>
              </>
            )}
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <form id="refund-form" onSubmit={handleSubmit} className="space-y-4">
          {/* The server says this cannot be refunded.
              Shown before the form rather than after a failed submit — a payment
              with no Stripe reference, or on an unresolved account, can never be
              refunded, and letting the owner fill in an amount first only
              wastes their time and hides the reason. */}
          {/* Not an error — an explanation of what the button will do. The
              money is returned by the business, by whatever route it arrived;
              this records that it happened so the invoice closes, the reports
              net it out and the ledger export shows it on its own date. */}
          {recordable && (
            <div
              className="flex items-start gap-2.5 border border-[var(--v2-border)] bg-[var(--v2-surface-hover)] px-3 py-2.5 text-[12.5px] text-[var(--v2-text-secondary)]"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              <Banknote className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--v2-text-muted)]" />
              {/*
                Two different reasons to be recording rather than refunding, and
                only one of them is "this never went through a card".

                The other is card money with no account left to send it back
                through, where the standing sentence — "this payment did not go
                through a processor" — is simply untrue, and would send an owner
                looking for a cash payment that never existed.
              */}
              <span>
                {serverBlock === 'ACCOUNT_GONE'
                  ? t('payments.refund.no_processor_notice')
                  : t('payments.refund.manual_notice')}
              </span>
            </div>
          )}

          {blockMessage && (
            <div
              className="flex items-start gap-2 bg-amber-500/10 px-3 py-2.5 text-[12.5px] text-amber-700 dark:text-amber-400"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
              role="alert"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{blockMessage}</span>
            </div>
          )}

          {/* ── The arrangement this money belongs to ──────────────────────
              Opened from a booking, this dialog said nothing about the plan
              behind the payment, while the money drawer showed the whole
              schedule. Refunding one period of three without knowing it is one
              of three is exactly the mistake the schedule prevents. */}
          {livePlan && livePlan.installmentCount > 0 && (
            <div
              className="flex items-baseline justify-between gap-3 bg-[var(--v2-surface-hover)] px-3 py-2.5 text-[12.5px]"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              <span className="text-[var(--v2-text-secondary)]">
                {t('payments.refund.plan_context')
                  .replace('{paid}', String(livePlan.periodsPaid))
                  .replace('{count}', String(livePlan.installmentCount))}
              </span>
              <span className="text-[var(--v2-text-muted)] whitespace-nowrap">
                {t('payments.refund.plan_remaining').replace(
                  '{count}',
                  String(livePlan.periodsRemaining)
                )}
              </span>
            </div>
          )}

          {/* Several payments, so there is no choice to offer — it is all of
              them or nothing. Stated rather than presented as a decision, and
              with the count, so "full refund" is not read as one payment. */}
          {isGroup && (
            <div
              className="bg-[var(--v2-surface-hover)] px-3 py-2.5 text-[12.5px] text-[var(--v2-text-secondary)]"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              {t('payments.refund.group_notice')
                .replace('{count}', String(paymentCount))
                .replace('{amount}', formatCurrency(maxRefundable))}
            </div>
          )}

          {/* ── Full or partial ────────────────────────────────────────────
              A segmented control, not two radio buttons. Two mutually exclusive
              options that fit on one line read as one control; radios read as a
              list that happens to have two items, and the platform uses
              segments for this everywhere else. */}
          {!isGroup && (
            <div>
              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-[var(--v2-text-muted)]">
                {t('payments.refund.type_label')}
              </label>
              <div
                className="flex gap-1 bg-[var(--v2-surface-hover)] p-1"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
                role="radiogroup"
              >
                {(['full', 'partial'] as const).map(option => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={refundType === option}
                    onClick={() => setRefundType(option)}
                    className={`flex-1 px-3 py-1.5 text-[12.5px] transition-colors ${
                      refundType === option
                        ? 'bg-[var(--v2-bg)] font-medium text-[var(--v2-text-primary)] shadow-sm'
                        : 'text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]'
                    }`}
                    style={{ borderRadius: 'calc(var(--v2-radius-button) - 2px)' }}
                  >
                    {option === 'full'
                      ? t('payments.refund.full_with_amount').replace(
                          '{amount}',
                          formatCurrency(maxRefundable)
                        )
                      : t('payments.refund.partial')}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── How much ───────────────────────────────────────────────────
              The currency sits INSIDE the field rather than beside it, and the
              quick fractions are there because a partial refund is nearly
              always half or a quarter — typing 66.67 to refund two thirds of
              ₪200 is arithmetic the screen can do. */}
          {effectiveType === 'partial' && (
            <div>
              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-[var(--v2-text-muted)]">
                {t('payments.refund.amount_label')}
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-[13px] text-[var(--v2-text-muted)]">
                  {currency}
                </span>
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={maxRefundable}
                  value={partialAmount}
                  onChange={e => setPartialAmount(e.target.value)}
                  placeholder={t('payments.refund.amount_placeholder')}
                  className="ps-12 tabular-nums"
                  required
                />
              </div>

              <div className="mt-2 flex gap-1.5">
                {[0.25, 0.5, 0.75].map(fraction => (
                  <button
                    key={fraction}
                    type="button"
                    onClick={() =>
                      setPartialAmount((Math.round(maxRefundable * fraction * 100) / 100).toFixed(2))
                    }
                    className="border border-[var(--v2-border)] px-2.5 py-1 text-[11.5px] text-[var(--v2-text-secondary)] transition-colors hover:border-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]"
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  >
                    {Math.round(fraction * 100)}%
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Why ────────────────────────────────────────────────────────
              Worth asking properly: this reaches the ledger, the transaction,
              the refund-pattern detector and the CSV export. */}
          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-[var(--v2-text-muted)]">
              {t('payments.refund.reason_label')}
              <span className="text-[#B42318]"> *</span>
            </label>
            {/* The usual reasons, as choices.
                Typed free-hand, the same reason arrives as "no show", "noshow"
                and "didn't turn up" — untranslatable in the drawer and useless
                to the refund-pattern detector. Picking one stores a stable key
                that renders in the reader's language; the box below still takes
                anything these do not cover. */}
            <div className="mb-2 flex flex-wrap gap-1.5">
              {REFUND_REASON_KEYS.map(key => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    /*
                     * The chip fills the box with the TRANSLATED wording, while
                     * what gets stored stays the key.
                     *
                     * Those are different strings on purpose. The box is where
                     * the owner reads and edits the reason, so it has to be in
                     * their language; the stored value has to be stable, or
                     * "no show", "noshow" and "didn't turn up" become three
                     * different reasons in the same report.
                     */
                    if (reasonKey === key) {
                      setReasonKey(null);
                      setReasonText('');
                      return;
                    }
                    setReasonKey(key);
                    setReasonText(t(`payments.refund.reason.${key}`));
                  }}
                  className={`px-2.5 py-1 text-[11.5px] transition-colors ${
                    reasonKey === key
                      ? 'bg-[var(--v2-text-primary)] text-[var(--v2-bg)]'
                      : 'border border-[var(--v2-border)] text-[var(--v2-text-secondary)] hover:border-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]'
                  }`}
                  style={{ borderRadius: '999px' }}
                >
                  {t(`payments.refund.reason.${key}`)}
                </button>
              ))}
            </div>

            <textarea
              value={reasonText}
              onChange={e => {
                const next = e.target.value;
                setReasonText(next);
                /*
                 * Edited away from the chip's own wording, so it is the owner's
                 * sentence now and gets stored as written. Left exactly as the
                 * chip filled it, the key still stands — which is what keeps a
                 * reason chosen and not retyped translatable for every reader.
                 */
                if (reasonKey && next !== t(`payments.refund.reason.${reasonKey}`)) {
                  setReasonKey(null);
                }
              }}
              placeholder={t('payments.refund.reason_placeholder')}
              rows={2}
              className="w-full resize-none border border-[var(--v2-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--v2-text-primary)] outline-none transition-colors placeholder:text-[var(--v2-text-muted)] focus:border-[var(--v2-text-muted)]"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            />
          </div>

          {/* ── Switches ───────────────────────────────────────────────────
              Both options are the same kind of thing — something that will
              happen as well as the refund — so they are the same control,
              stacked. The checkbox and the toggle used to sit one above the
              other looking like two unrelated widgets. */}
          <div
            className="divide-y divide-[var(--v2-border)] border border-[var(--v2-border)]"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            <SwitchRow
              checked={notifyContact}
              onChange={setNotifyContact}
              isRTL={isRTL}
              label={t('payments.refund.notify_contact')}
            />

            {/* The plan behind this booking, wherever the refund was started
                from. Default OFF — a client who cancels one session has not
                cancelled the arrangement — but the description says plainly
                what happens if it is left off, which is the part that used to
                be invisible. */}
            {livePlan && !blockMessage && (
              <SwitchRow
                checked={stopPlan}
                onChange={setStopPlan}
                isRTL={isRTL}
                danger
                icon={<Ban className="h-3.5 w-3.5 text-orange-500" />}
                label={t('payments.refund.stop_plan_label')}
                description={
                  stopPlan
                    ? t('payments.refund.stop_plan_on').replace(
                        '{count}',
                        String(livePlan.periodsRemaining)
                      )
                    : t('payments.refund.stop_plan_off').replace(
                        '{count}',
                        String(livePlan.periodsRemaining)
                      )
                }
              />
            )}

            {canOfferDelete && (
              <SwitchRow
                checked={deleteBooking}
                onChange={setDeleteBooking}
                isRTL={isRTL}
                danger
                icon={<Trash2 className="h-3.5 w-3.5 text-orange-500" />}
                label={t('payments.refund.delete_booking_label')}
                description={
                  livePlan
                    ? t('payments.refund.delete_stops_plan')
                    : t('payments.refund.delete_booking_desc')
                }
              />
            )}

            {/* The reason, only once something is being called off.
                Appears in place rather than as a second dialog: this one already
                holds the decision and the button. */}
            {(stopPlan || deleteBooking) && (
              <div className="pt-1">
                <label className="block text-[12.5px] font-medium text-[var(--v2-text-secondary)] mb-1.5 rtl:text-right">
                  {t('payments.refund.cancel_reason_label') || 'Why is it being called off?'}
                  <span className="text-[#B42318]"> *</span>
                </label>
                <Select
                  value={cancelReason}
                  onValueChange={value => setCancelReason(value as StopReason)}
                >
                  <SelectTrigger className="w-full bg-[var(--v2-surface)] border-[var(--v2-border)] text-[var(--v2-text-primary)]">
                    <SelectValue
                      placeholder={t('cancel.choose_reason') || 'Choose a reason'}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {STOP_REASONS.map(code => (
                      <SelectItem key={code} value={code}>
                        {t(cancelReasonKey(code)) || code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* ── What this costs ────────────────────────────────────────────
              Refunds cannot be undone, and Stripe keeps the processing fee —
              two facts an owner should meet before the button, not after. */}
          <div
            className="bg-amber-500/10 px-3 py-2.5 text-[12.5px] text-amber-700 dark:text-amber-400"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="space-y-1">
                <p>
                  {t('payments.refund.warning_full').replace(
                    '{amount}',
                    formatCurrency(refundAmount)
                  )}
                </p>
                {processorFee && (
                  <p>
                    {t('payments.refund.fee_kept').replaceAll(
                      '{fee}',
                      formatMoney(processorFee.amount, processorFee.currency)
                    )}
                  </p>
                )}
              </div>
            </div>
          </div>
        </form>
      </div>

      {/* ── Footer ────────────────────────────────────────────────────────
          Pinned, so the action is reachable without scrolling past the warning
          on a phone — the same pattern the booking and payment dialogs use. */}
      <div className="flex-shrink-0 flex items-center justify-end gap-2 border-t border-[var(--v2-border)] px-5 py-4">
        <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
          {t('payments.refund.cancel')}
        </Button>
        {/* The money cannot come back, but the plan can still be stopped.
            Without this the only route to stopping a plan ran THROUGH a refund,
            so a plan whose payments have no Stripe reference — every plan
            collected before the reference was recorded — could not be stopped
            from this screen at all. The client went on being charged. */}
        {blockMessage && livePlan && (
          <Button
            type="button"
            onClick={() => setShowStopPlan(true)}
            className="bg-red-600 hover:bg-red-700"
          >
            <Ban className="me-2 h-4 w-4" />
            {t('payments.plan.stop')}
          </Button>
        )}

        {!(blockMessage && livePlan) && (
        <Button
          type="submit"
          form="refund-form"
          // Blocked means blocked. Leaving it live let the owner submit a
          // refund the server had already told this dialog it would refuse.
          /*
           * Also gated on the reason, but only when a toggle is on. A plain
           * refund must stay one click away.
           */
          /*
           * Both halves of the reason, as well as the money checks.
           *
           * Unreachable without them rather than rejected after the press: the
           * route requires both, and letting the owner submit into a 400 on a
           * money dialog is the worst place to discover a missing field.
           */
          disabled={
            loading ||
            !!blockMessage ||
            (effectiveType === 'partial' && refundAmount <= 0) ||
            !reason ||
            !reasonNote ||
            ((stopPlan || deleteBooking) && !cancelReason)
          }
          className="bg-orange-600 hover:bg-orange-700"
        >
          {loading ? (
            <>
              <Loader2 className="me-2 h-4 w-4 animate-spin" />
              {recordable ? t('payments.refund.recording') : t('payments.refund.processing')}
            </>
          ) : (
            <>
              {recordable ? (
                <Banknote className="me-2 h-4 w-4" />
              ) : (
                <RotateCcw className="me-2 h-4 w-4" />
              )}
              {(recordable
                ? t('payments.refund.record_button')
                : t('payments.refund.submit_button')
              ).replace('{amount}', formatCurrency(refundAmount))}
            </>
          )}
        </Button>
        )}
      </div>
      </DialogContent>

      {/* The proper dialog for the job, rather than a second job bolted onto
          this one. Radix nests dialogs, so it opens above this without either
          dismissing the other. */}
      {livePlan && (
        <CancelPlanModal
          isOpen={showStopPlan}
          onClose={() => setShowStopPlan(false)}
          planId={livePlan.id}
          periodsRemaining={livePlan.periodsRemaining}
          // What is still held, not what was originally charged: money already
          // returned cannot be returned again.
          collectedAmount={maxRefundable}
          currency={currency}
          onSuccess={() => {
            setShowStopPlan(false);
            onSuccess?.(false);
            onClose();
          }}
          onError={message => onError?.(message)}
        />
      )}
    </Dialog>
  );
}
