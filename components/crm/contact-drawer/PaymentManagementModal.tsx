'use client';

/**
 * PaymentManagementModal
 *
 * Single modal for managing booking payments - view details, mark as paid,
 * process refunds (full/partial), and optionally delete booking on full refund.
 *
 * Uses the standard platform dialog pattern with DialogHeader/DialogTitle.
 */

import { useState, useEffect } from 'react';
import { RefundModal } from '@/components/payments/RefundModal';
import { CancelPlanModal } from '@/components/payments/CancelPlanModal';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  CreditCard, Check, RotateCcw, Loader2, AlertTriangle,
  CheckCircle2, Clock, XCircle, DollarSign, User, ArrowLeft, Trash2, Undo2, Ban, Wallet
} from 'lucide-react';
import { createLogger } from '@/lib/logger';
import type { SessionCardData } from './types';
import { PaymentPlanTotals } from '@/components/payments/PaymentPlanTotals';
import { useBusinessTimezone } from '@/lib/business-os/LanguageContext';
import { REFUND_CLASS, REFUND_HEX, refundExtent } from '@/components/payments/refundTone';

const logger = createLogger({ module: 'PaymentManagementModal' });

interface PaymentManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  booking: SessionCardData | null;
  contactName: string;
  onPaymentUpdated: () => void;
  onBookingDeleted?: (bookingId: string) => void;
  t: (key: string) => string;
  isRTL?: boolean;
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * `startInRefundView` WAS HERE, AND IS GONE.
   *
   * It said "start directly in refund view", the drawer passed `true`, and the
   * view effect overwrote it on open — so for its whole life it did nothing,
   * and nothing noticed.
   *
   * Honouring it broke the dialog rather than fixing it. There is exactly ONE
   * mount of this component, and it is the "Manage payment" button; a refund
   * started from the drawer opens `RefundModal` directly instead. So the flag
   * was hardcoded `true` on the MANAGE path, and the moment it was obeyed, any
   * job with money already collected opened straight into a refund form with
   * no route back — a plan with one stage paid and another still owed could no
   * longer be collected at all.
   *
   * Removed rather than defaulted, so a future caller has to think about which
   * dialog it actually wants.
   * ───────────────────────────────────────────────────────────────────────────
   */
}

type ModalView = 'details' | 'refund';

/**
 * The ways money arrives without a processor.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The values are the SERVER's enum, verbatim, from `MarkPaidSchema` — anything
 * else is rejected by Zod before it reaches the ledger.
 *
 * `cheque` carries its label key explicitly because the two halves disagree:
 * the API spells it `cheque` and the translation files spell it `check`, in all
 * three languages. Mapping it here is why that mismatch cannot become a blank
 * option in the dropdown — and why neither side has to be renamed, which would
 * mean either a migration of stored values or a sweep of translation keys.
 *
 * `card` is last and deliberately present: a card machine that is not ours
 * produces no event we ever see, so from here it is as manual as cash.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const MANUAL_METHODS = [
  { value: 'bank_transfer', labelKey: 'payments.payment_method.bank_transfer', fallback: 'Bank transfer' },
  { value: 'cash', labelKey: 'payments.payment_method.cash', fallback: 'Cash' },
  { value: 'cheque', labelKey: 'payments.payment_method.check', fallback: 'Cheque' },
  { value: 'card', labelKey: 'payments.payment_method.card', fallback: 'Card' },
  { value: 'other', labelKey: 'payments.payment_method.other', fallback: 'Other' },
] as const;

export function PaymentManagementModal({
  isOpen,
  onClose,
  booking,
  contactName,
  onPaymentUpdated,
  onBookingDeleted,
  t,
  isRTL = false,
}: PaymentManagementModalProps) {
  const { timeZoneOptions } = useBusinessTimezone();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Refund form state
  const [refundType, setRefundType] = useState<'full' | 'partial'>('full');
  const [partialAmount, setPartialAmount] = useState('');
  const [reason, setReason] = useState('');
  const [notifyContact, setNotifyContact] = useState(true);
  const [deleteBooking, setDeleteBooking] = useState(false);
  /** The stop-plan confirmation, which owns its own reason picker. */
  const [stopPlanOpen, setStopPlanOpen] = useState(false);
  /** Two presses, because cancelling tells the client the invoice no longer applies. */
  const [confirmingVoid, setConfirmingVoid] = useState(false);

  /**
   * How the money actually arrived.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * IT WAS HARDCODED TO `bank_transfer`.
   *
   * This dialog exists because a client can pay in ways no processor sees — cash
   * in hand, a cheque, a card machine that is not ours. The route has accepted
   * all of them from the start (`cash | bank_transfer | cheque | card | other`)
   * and this sent one value for every case, so a job settled in cash was
   * recorded, reported and receipted as a bank transfer. The owner was told
   * something untrue about their own books, and nothing in the UI could correct
   * it.
   *
   * `bank_transfer` stays the DEFAULT — it is the common case and the route's
   * own default, so the one-click path is unchanged.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const [paymentMethod, setPaymentMethod] =
    useState<'cash' | 'bank_transfer' | 'cheque' | 'card' | 'other'>('bank_transfer');

  // Check if refund is possible (payment status is 'paid')
  //
  // The note that stood here said a manual payment is "refunded by updating
  // status", with or without a `payment.id`. Neither half is true any more: a
  // refund needs a `payment_transactions` row, and a payment recorded by hand
  // has one, because `mark-paid` writes it with `processor_type: 'manual'`.
  // There is one refund path and it runs through `RefundService`.
  const paymentData = booking?.payment;

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE BOOKING'S STATUS IS NOT THE PLAN'S STATUS.
   *
   * `payment.status` is one field for the whole booking. On a plan — a quoted
   * job billed in stages, or an instalment sale — it flips to `paid` as soon as
   * the FIRST stage is collected, while the rest are still owed.
   *
   * Everything here keyed off that one field, so a plan behaved correctly
   * exactly once. The first stage opened the details view with "Mark as paid",
   * as it should. The moment it was paid, the second stage opened the REFUND
   * form instead, and the mark-paid button vanished with it — an owner with no
   * payment processor, whose only way to record money is to mark it by hand,
   * was offered a refund for the payment they were trying to collect.
   *
   * The stage list already carries what is actually owed, so the question is
   * asked of it rather than of the aggregate.
   */
  const stages = paymentData?.plan?.stages ?? [];
  const outstandingStage =
    stages.find(stage => stage.status !== 'paid' && stage.status !== 'cancelled') ?? null;


  /**
   * The invoice a manual payment would actually settle.
   *
   * A stage only has one once it has been BILLED. A milestone waiting on the
   * owner to say the work happened has no invoice yet, and there is nothing to
   * mark paid — the next step there is to raise it, not to record money against
   * it.
   */
  /*
   * A DATED PERIOD THAT HAS NOT BEEN BILLED IS NOT SETTLEABLE BY HAND.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * An instalment plan collects itself: `billDueDatedStages` raises each
   * period's invoice when its date arrives, and the client is sent it and pays
   * it. There is nothing for the owner to mark, and marking it would be a lie
   * about money that has not moved — the period would read paid while the
   * charge still fires on its date, collecting it a second time.
   *
   * The fallback below is what made that reachable. With no invoice of its own,
   * a future period fell through to `outstandingInvoiceId` — a DIFFERENT
   * invoice, quite possibly the one already paid — so "record payment" pointed
   * at the wrong document entirely.
   *
   * A MANUAL stage is the opposite case and keeps the fallback: it waits on the
   * owner by design, which is exactly what `trigger: 'manual'` means.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const awaitsItsOwnSchedule =
    Boolean(outstandingStage) && !outstandingStage!.invoiceId && outstandingStage!.trigger === 'date';

  /**
   * Every stage the owner could record money against right now.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * A STAGE IS COLLECTABLE ONCE IT HAS BEEN BILLED, NOT ONLY WHEN IT IS NEXT.
   *
   * The dialog settled `outstandingStage` — the FIRST unpaid period — and
   * nothing else. On a quote with both stages invoiced and sitting with the
   * client, that is half a feature: a client who pays the final milestone in
   * cash before the deposit cannot have it recorded at all, and the button
   * gave no clue which of the two it meant.
   *
   * Requires an invoice, because recording a payment settles a document. A
   * milestone nobody has billed has nothing to settle, and a dated period
   * bills itself when its date arrives.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const collectableStages = stages.filter(
    stage => stage.status !== 'paid' && stage.status !== 'cancelled' && Boolean(stage.invoiceId)
  );

  /** Which one the action acts on. The owner picks when there is a choice. */
  const [settleTargetId, setSettleTargetId] = useState<string | null>(null);

  const settleTarget =
    collectableStages.find(stage => stage.id === settleTargetId) ?? collectableStages[0] ?? null;

  const settleableInvoiceId = collectableStages.length
    ? settleTarget?.invoiceId ?? null
    : awaitsItsOwnSchedule
      ? null
      : outstandingStage?.invoiceId ?? paymentData?.outstandingInvoiceId ?? null;

  /**
   * Whether "Mark as paid" should be offered at all.
   *
   * On a PLAN it requires a real invoice to settle. Without that guard the
   * handler falls through to marking the whole BOOKING paid, which is the bug
   * this change exists to remove: it would settle every remaining stage at once
   * while their invoices stayed open.
   *
   * A single payment keeps its old behaviour, where the booking's own status is
   * the whole truth.
   */
  const isPlan = Boolean(paymentData?.plan);

  /*
   * The agreement's own arithmetic, summed from the stages.
   *
   * Not `payment.amount`, which is ONE period — the figure that made the old
   * header ambiguous. A reader needs to see that $1,000 was agreed, $500 has
   * landed and $500 is still out; any one of those alone invites the wrong
   * conclusion.
   *
   * `plan.totalAmount` is preferred where it exists because it is the agreed
   * figure, and a stage list can be edited after the fact.
   */
  // Derived by `PaymentPlanTotals`, which owns this arithmetic for every surface.
  /*
   * Read from `paymentData`, not from the `isPending` below it.
   *
   * These declarations sit ABOVE the `if (!booking || !paymentData) return null`
   * guard, because the hook beneath them must run on every render. `isPending`
   * is derived after that guard, so naming it here is a temporal dead zone —
   * `Cannot access 'isPending' before initialization`, thrown at render, which
   * a type check cannot see because the binding exists and only the ORDER is
   * wrong.
   */
  const canMarkPaid = isPlan ? Boolean(settleableInvoiceId) : paymentData?.status === 'pending';

  const canRefund = paymentData?.status === 'paid';
  const [view, setView] = useState<ModalView>('refund');

  /*
   * The default target is the earliest collectable stage — the one an owner
   * means nine times out of ten. Reset on open so a dialog reopened after a
   * payment does not still point at the stage that has just been settled.
   */
  useEffect(() => {
    if (!isOpen) return;
    setSettleTargetId(collectableStages[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, collectableStages.length]);

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * DETAILS WHENEVER THERE IS STILL MONEY TO COLLECT.
   *
   * Refund is REACHABLE when something is outstanding — money changed hands and
   * giving it back is legitimate — but it is not what the owner came for.
   * Collecting is, and the refund link in the details view covers the rest.
   *
   * It matters more than a preference, because the refund view REPLACES this
   * dialog: `view === 'refund'` returns `RefundModal`, which has no way back.
   * Opening there strands an owner who came to record a payment, and a plan
   * with one stage settled and another still owed is the ordinary case for it.
   *
   * ALWAYS details, including when everything has been collected.
   *
   * It used to open straight into the refund form once nothing was outstanding,
   * on the reasoning that returning money is then the only thing left to do.
   * That reasoning had the same flaw from the other side: an owner opening a
   * fully-paid job to check a date, read how a stage was paid or resend a
   * document landed in a refund form with no way back to the dialog they
   * asked for.
   *
   * One rule instead, and it is the one a person can predict: "Manage payment"
   * opens the payment. Refunding is a deliberate second step, from the link
   * that is already there.
   *
   * A `startInRefundView` prop used to be consulted here first. See the note on
   * the props above for why it is gone.
   * ───────────────────────────────────────────────────────────────────────────
   */
  useEffect(() => {
    if (!isOpen) return;
    setView('details');
  }, [isOpen]);

  if (!booking || !paymentData) return null;

  const payment = paymentData;
  const paymentStatus = payment.status;
  const isPaid = paymentStatus === 'paid';
  const isPending = paymentStatus === 'pending';
  const isFree = paymentStatus === 'free';
  /*
   * Money that arrived and went back.
   *
   * It had no branch in `getStatusConfig`, so it fell through to the catch-all
   * and was labelled FAILED — telling the owner a payment did not go through
   * when in fact it succeeded and was returned. `crm.payment.status.refunded`
   * already existed in all three languages and was simply never reached.
   */
  const isRefunded = paymentStatus === 'refunded';

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * NET OF WHAT ALREADY WENT BACK.
   *
   * This was `payment.amount` — the gross charge — so on money partly refunded
   * already it offered to return the whole of it a second time. The server's
   * over-refund guard rejected that, but only after the owner had been shown
   * the figure and pressed the button.
   *
   * The form below is NOT how a refund is taken any more: the early return
   * further down hands `view === 'refund'` to the shared `RefundModal`, which
   * asks the server what is actually left. Its condition (`canRefund`) is the
   * same expression as `isPaid`, which is the only thing that renders the
   * button that gets here, so this code is unreached.
   *
   * It is corrected rather than deleted because "unreached" rests on those two
   * conditions staying identical, and a wrong cap waiting behind an edit to
   * either of them is not worth keeping for the sake of a smaller diff.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const maxRefundable = Math.max(0, payment.amount - Number(payment.refundedAmount ?? 0));
  const refundAmount = refundType === 'full' ? maxRefundable : parseFloat(partialAmount) || 0;

  /**
   * A stage's date, short.
   *
   * On the BUSINESS's clock, like every other time this drawer shows: a payment
   * recorded at 11pm in New York is not the next day because the owner happens
   * to be reading from Tel Aviv.
   */
  /**
   * A stage date, which is one of two kinds of value.
   *
   * `paidAt` is an INSTANT and is resolved in the business's zone, because that
   * decides which day the money landed on. `dueDate` is a DATE with no time and
   * no zone — converting it moves it: midnight UTC renders as the previous day
   * anywhere west of UTC, which printed "due 29 Sept" on a period due the 30th.
   * So a date-only value is shown as the calendar date it is.
   * See `dateOnlyIsNotMidnightUTC.guard`.
   */
  const stageDate = (value: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T00:00:00Z`).toLocaleDateString(isRTL ? 'he-IL' : 'en-US', {
          timeZone: 'UTC',
          day: 'numeric',
          month: 'short',
        })
      : new Date(value).toLocaleDateString(
          isRTL ? 'he-IL' : 'en-US',
          timeZoneOptions({ day: 'numeric', month: 'short' })
        );

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency
    }).format(amount);
  };

  const handleClose = () => {
    // Reset form state when closing (view will be reset by useEffect on next open)
    setRefundType('full');
    setPartialAmount('');
    setReason('');
    setNotifyContact(true);
    setDeleteBooking(false);
    setError(null);
    setSuccess(null);
    onClose();
  };

  /**
   * Record money that arrived outside a processor.
   *
   * ─────────────────────────────────────────────────────────────────────────────
   * IT USED TO SETTLE THE WHOLE BOOKING, ALWAYS.
   *
   * The only thing this did was `PUT payment_status: 'paid'` on the booking.
   * For a single payment that is right. For a PLAN it is not: a quoted job
   * billed in two stages would have its booking marked fully paid while the
   * second invoice sat at `sent` — the money would read as collected and the
   * invoice would still be chaseable, which is a worse state than the one the
   * owner was trying to fix.
   *
   * A stage has its own invoice, and that invoice is what gets settled. The
   * booking's aggregate follows from the invoices rather than being asserted
   * over them.
   *
   * The method comes from the picker beside the button. `bank_transfer` is the
   * default — the route's own, and the common case — but cash and a cheque are
   * exactly why this dialog exists, and recording them as a transfer put a
   * figure in the owner's books that had never happened.
   */
  const handleMarkAsPaid = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = settleableInvoiceId
        ? await fetch(`/api/payments/invoices/${settleableInvoiceId}/mark-paid`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ payment_method: paymentMethod })
          })
        : await fetch(`/api/scheduling/bookings/${booking.booking.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ payment_status: 'paid' })
          });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to update payment status');
      }

      setSuccess(t('crm.payment.marked_paid_success') || 'Payment marked as paid');
      onPaymentUpdated();

      setTimeout(() => {
        setSuccess(null);
        handleClose();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update payment');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Money that is never going to arrive.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * A quote stopped before it was paid leaves its invoice behind. The quote
   * reads "Stopped" and the invoice still reads `sent`: owed, chased, and still
   * PAYABLE — the public payment page refuses only invoices already settled, so
   * a client could hand over the full amount for a job that was called off.
   * Two live invoices are in that state, one of them ₪5,000.
   *
   * Deliberately NOT automatic on stop. Stopping is not refunding: the owner
   * may well still want paying for what was done before the job ended, and
   * voiding the invoice for them would decide that nothing is owed. This is the
   * same line `cancelQuoteStages` draws, and it is why this is a button rather
   * than a side effect.
   *
   * Cancel, not delete: the client may already have the invoice in their inbox,
   * and one they can look up and see cancelled explains itself where a missing
   * one does not. `PUT { status: 'cancelled' }` refuses a paid invoice and
   * voids it at Stripe too, so a hosted payment page cannot outlive it.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const voidableInvoiceId = outstandingStage?.invoiceId ?? paymentData?.outstandingInvoiceId ?? null;

  const handleVoidInvoice = async () => {
    if (!voidableInvoiceId) return;
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/payments/invoices/${voidableInvoiceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to cancel the invoice');
      }

      setSuccess(t('crm.payment.cancel_invoice_done') || 'Payment cancelled');
      onPaymentUpdated();

      setTimeout(() => {
        setSuccess(null);
        handleClose();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel the invoice');
    } finally {
      setLoading(false);
      setConfirmingVoid(false);
    }
  };

  const handleRefund = async (e: React.FormEvent) => {
    e.preventDefault();

    if (refundType === 'partial' && (refundAmount <= 0 || refundAmount > maxRefundable)) {
      setError(`Please enter a valid amount between 0 and ${formatCurrency(maxRefundable, payment.currency)}`);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Use the booking refund endpoint which handles both:
      // - Stripe payments (looks up transaction by booking_id or payment_id)
      // - Manual payments (just updates status)
      const response = await fetch(`/api/scheduling/bookings/${booking.booking.id}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          refund_type: refundType,
          amount: refundType === 'partial' ? refundAmount : undefined,
          reason: reason || undefined,
          notify_contact: notifyContact
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to process refund');
      }

      setSuccess(t('crm.payment.refund_success') || 'Refund processed successfully');

      // If user enabled "delete booking" toggle (full refund only).
      // The refund itself already succeeded, so a failure here is reported but
      // does not undo it — the booking simply stays, with its money returned.
      if (deleteBooking && refundType === 'full' && onBookingDeleted) {
        try {
          const deleteResponse = await fetch(`/api/scheduling/bookings/${booking.booking.id}`, {
            method: 'DELETE'
          });

          if (deleteResponse.ok) {
            onBookingDeleted(booking.booking.id);
          } else {
            const deleteData = await deleteResponse.json().catch(() => null);
            setError(
              deleteData?.code === 'BOOKING_HAS_PAID_INVOICE'
                ? t('scheduling.booking.delete_blocked_paid')
                  || 'The refund went through, but this booking still has a paid invoice and cannot be deleted.'
                : t('crm.payment.refund_ok_delete_failed')
                  || 'The refund went through, but the booking could not be deleted.'
            );
          }
        } catch (err) {
          logger.error({ err, bookingId: booking.booking.id }, 'Failed to delete booking after refund');
          setError(
            t('crm.payment.refund_ok_delete_failed')
              || 'The refund went through, but the booking could not be deleted.'
          );
        }
      }

      onPaymentUpdated();

      setTimeout(() => {
        setSuccess(null);
        handleClose();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process refund');
    } finally {
      setLoading(false);
    }
  };

  const getStatusConfig = () => {
    if (isPaid) return {
      icon: CheckCircle2,
      label: t('crm.payment.status.paid') || 'Paid',
      color: 'text-green-600 dark:text-green-400',
      bg: 'bg-green-500/10',
      border: 'border-green-500/30'
    };
    if (isPending) return {
      icon: Clock,
      label: t('crm.payment.status.pending') || 'Pending',
      color: 'text-amber-600 dark:text-amber-400',
      bg: 'bg-amber-500/10',
      border: 'border-amber-500/30'
    };
    if (isFree) return {
      icon: Check,
      label: t('crm.payment.status.free') || 'Free',
      color: 'text-blue-600 dark:text-blue-400',
      bg: 'bg-blue-500/10',
      border: 'border-blue-500/30'
    };
    if (isRefunded) return {
      icon: Undo2,
      label: t('crm.payment.status.refunded') || 'Refunded',
      /*
       * From the shared tone. This said slate and argued for it while the
       * invoice list said orange and argued for that — the same refund, two
       * colours, one click apart.
       */
      color: REFUND_CLASS.full.text,
      bg: REFUND_CLASS.full.bg,
      border: 'border-red-500/30'
    };
    /*
     * The catch-all says FAILED, so it must only be reached by something that
     * actually failed.
     *
     * `refunded` used to land here, which is how a returned payment came to be
     * reported as a failed one. A status added without a branch above lands in
     * this one and asserts something false about the money — the same trap the
     * booking badge's catch-all carries, and worth the same care.
     */
    return {
      icon: XCircle,
      label: t('crm.payment.status.failed') || 'Failed',
      color: 'text-red-600 dark:text-red-400',
      bg: 'bg-red-500/10',
      border: 'border-red-500/30'
    };
  };

  const statusConfig = getStatusConfig();
  const StatusIcon = statusConfig.icon;

  /**
   * Refunding uses the shared dialog, not this one's own form.
   *
   * This modal carried a second refund form — its own radio buttons, its own
   * amount field, its own submit — and the two drifted: this one capped the
   * refund at the ORIGINAL amount, ignoring anything already returned, so it
   * offered a full refund on money that had been partly refunded already. The
   * over-refund guard rejected it, but only after the owner had been shown the
   * figure and pressed the button.
   *
   * `RefundModal` asks the server what is actually left, sends the notify flag,
   * and is the same dialog the money list and the payments tab open. One refund
   * dialog, wherever a refund starts.
   */
  if (view === 'refund' && canRefund) {
    return (
      <RefundModal
        isOpen={isOpen}
        onClose={handleClose}
        bookingId={booking.booking.id}
        originalAmount={payment.amount}
        currency={payment.currency}
        /*
         * WHAT HAS ALREADY GONE BACK.
         *
         * This passed a hard `0`, and the note here explained that
         * `SessionPayment` carries no refunded figure — only `refundedAt`. It
         * does carry one (`refundedAmount`, set from the booking's
         * `refunded_total`, which sums the invoice and every transaction), so
         * the reason had simply gone stale.
         *
         * The server still decides: it recomputes the remaining amount and
         * refuses an over-refund, which is what kept `0` safe. But safe is not
         * the same as honest — with `0` the form opened offering the GROSS
         * charge on a payment already partly returned, and the owner met the
         * correction only after asking for too much. ₪150 offered on a payment
         * with ₪75 left is the same over-offer this dialog's details rows now
         * exist to prevent.
         */
        alreadyRefunded={Number(payment.refundedAmount ?? 0)}
        contactName={contactName}
        isRTL={isRTL}
        // This modal is opened from a booking, so deleting it afterwards is a
        // real option here in a way it is not on the payments tab.
        showDeleteBookingOption
        /* No hour to free on a course or a training block, so the toggle's
           description must not say it frees one. */
        bookingUnscheduled={!booking.booking.start_time}
        /*
         * So a COMPLETED or no-show booking is not offered a cancellation. The
         * meeting happened; refunding afterwards does not un-happen it, and the
         * toggle emails the client that it was called off.
         */
        bookingStatus={booking.booking.status}
        /* The outcome, which is where "already settled" lives: completing a
           booking writes `meeting_status`, not `status`. */
        bookingMeetingStatus={booking.booking.meeting_status}
        onSuccess={shouldDeleteBooking => {
          onPaymentUpdated?.();
          if (shouldDeleteBooking) onBookingDeleted?.(booking.booking.id);
          handleClose();
        }}
        onError={message => setError(message)}
      />
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent
        className="w-full sm:max-w-lg h-[100dvh] sm:h-auto sm:max-h-[90dvh] flex flex-col bg-[var(--v2-bg)] p-0 overflow-hidden sm:rounded-2xl"
        dir={isRTL ? 'rtl' : 'ltr'}
      >
        {/*
          Sticky header.
          ─────────────────────────────────────────────────────────────────────
          The glyph sits in a tinted tile rather than loose beside the words, and
          the service name is part of the heading block instead of a stray line
          under it — so the dialog opens with one object at the top saying what
          this is and which job it belongs to.
        */}
        <div className="flex-shrink-0 border-b border-[var(--v2-border)] px-4 sm:px-6 py-4 sm:py-5 bg-[var(--v2-bg)]">
          <DialogHeader className="rtl:text-right">
            <DialogTitle className="flex items-center gap-3 text-base sm:text-lg font-semibold text-[var(--v2-text-primary)]">
              {view === 'refund' ? (
                <>
                  <button
                    onClick={() => { setView('details'); setError(null); }}
                    className="p-1 -ms-1 rounded-full hover:bg-[var(--v2-surface)] transition-colors"
                    aria-label={t('common.back') || 'Back'}
                  >
                    <ArrowLeft className="h-5 w-5 rtl:rotate-180" />
                  </button>
                  <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-orange-500/10">
                    <RotateCcw className="h-[18px] w-[18px] text-orange-500" />
                  </span>
                  {t('crm.payment.refund') || 'Process Refund'}
                </>
              ) : (
                <>
                  <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-[#8B5CF6]/10">
                    <CreditCard className="h-[18px] w-[18px] text-[#8B5CF6]" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate">{t('crm.payment.manage') || 'Manage Payment'}</span>
                    {booking.booking.service?.service_name && (
                      <span className="block truncate text-xs font-normal text-[var(--v2-text-muted)]">
                        {booking.booking.service.service_name}
                      </span>
                    )}
                  </span>
                </>
              )}
            </DialogTitle>
          </DialogHeader>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6">
          {/* Success Message */}
          {success && (
            <div className="p-4 bg-green-500/20 border border-green-500/40 text-green-600 dark:text-green-400 text-sm font-medium" style={{ borderRadius: 'var(--v2-radius-button)' }}>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                {success}
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="p-4 bg-red-500/20 border border-red-500/40 text-red-600 dark:text-red-400 text-sm font-medium" style={{ borderRadius: 'var(--v2-radius-button)' }}>
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                {error}
              </div>
            </div>
          )}

          {/* Details View */}
          {view === 'details' && (
            <>
              {/*
                ─────────────────────────────────────────────────────────────
                THE WHOLE AGREEMENT, NOT ONE FIGURE FROM IT.

                This showed a single Amount and a single Status. On a plan that
                is genuinely ambiguous: the $500 shown was the deposit ALREADY
                PAID, while the button underneath collected a different $500
                still owed. An owner reading "Amount $500 / Status Paid" above
                "Mark as Paid · $500" cannot tell which payment the dialog is
                about, because it is about two.

                A plan now shows its stages. Each line says what it is, what it
                costs and where it stands, so the figures on screen and the
                action beneath them refer to things the reader can tell apart.
              */}
              {isPlan ? (
                <div className="space-y-3">
                  {/* The agreement at a glance: what it is worth, what has
                      landed, what is still out. Shared with the booking journey
                      and the installment list, so the same money cannot be
                      described three different ways. */}
                  <PaymentPlanTotals
                    stages={stages}
                    currency={payment.currency}
                    totalAmount={paymentData?.plan?.totalAmount}
                    locale={isRTL ? 'he-IL' : 'en-US'}
                    /*
                      ─────────────────────────────────────────────────────────
                      WHAT CAME BACK, which this dialog did not mention at all.
                      
                      Without it the strip summed the stages and reported
                      "collected ₪2,000 · outstanding ₪0" on a job whose every
                      shekel had been returned — because a refund is recorded
                      against the INVOICE and the stage quite correctly still
                      reads `paid`.
                      
                      The component has rendered charged / returned / kept since
                      it was written, and the card behind this dialog already
                      passes these. Only the dialog did not, which is exactly why
                      the card was right and the dialog in front of it was wrong.
                      ─────────────────────────────────────────────────────────
                    */
                    refunded={Number(paymentData?.refundedAmount ?? 0)}
                    labels={{
                      total: t('crm.payment.total') || 'Total',
                      collected: t('crm.payment.collected') || 'Collected',
                      outstanding: t('crm.payment.outstanding') || 'Outstanding',
                      // Only rendered when a period has actually been called off.
                      cancelled: t('payments.plan.status.cancelled') || 'Stopped',
                      /* Both are required together: without the words for them
                         the component keeps the ordinary three cells rather
                         than putting an English fallback in a Hebrew strip. */
                      /* The SAME keys the card behind this dialog passes, so
                         one strip cannot be labelled two ways depending on
                         which surface drew it. */
                      refunded: t('crm.journey.returned') || 'Refunded',
                      kept: t('crm.journey.kept') || 'You keep',
                    }}
                  />

                  {/*
                    Every stage, in order.
                    ─────────────────────────────────────────────────────────
                    Separate cards rather than rows inside one box. A collectable
                    stage is a CHOICE here — the owner picks which money they are
                    recording — and a choice has to look pickable, which a divider
                    between flat rows never did.
                  */}
                  <div
                    className="space-y-2"
                    /* A radiogroup only when something in it is selectable:
                       announcing a group of radios with none inside is worse
                       for a screen reader than announcing nothing. */
                    role={collectableStages.length > 1 ? 'radiogroup' : undefined}
                    aria-label={
                      collectableStages.length > 1
                        ? t('crm.payment.recording_for') || 'Recording a payment for'
                        : undefined
                    }
                  >
                    {stages.map((stage, index) => {
                      const settled = stage.status === 'paid';
                      /*
                       * Stopped, and therefore neither owed nor collected.
                       * The chain below asked only whether a period was settled
                       * and whether it had an invoice, so a cancelled one read
                       * as "not billed yet" — an instruction to wait for money
                       * that will never be asked for.
                       */
                      const stopped = stage.status === 'cancelled';
                      const isTarget = outstandingStage?.id === stage.id;

                      /**
                       * What came back off THIS stage.
                       *
                       * ─────────────────────────────────────────────────────
                       * The row read `status` alone, and a refunded stage keeps
                       * `status: 'paid'` — the money did arrive, and the return
                       * is recorded against its invoice. So a line reading
                       * "Paid · 9 Oct" was the only thing said about money that
                       * had been given back the same afternoon.
                       *
                       * The figure is on the stage already; the row simply never
                       * looked at it. The card behind this dialog has shown it
                       * all along.
                       * ─────────────────────────────────────────────────────
                       */
                      const stageRefunded = Number(stage.refundedAmount ?? 0);
                      const fullyReturned =
                        stageRefunded > 0 && stageRefunded >= Number(stage.amount ?? 0);

                      /*
                       * "Due now" has to mean now.
                       *
                       * The badge marked whichever period was next, so an
                       * instalment due on the 7th was labelled "due now" on the
                       * 30th — beside a line correctly saying it had not been
                       * billed yet. The two read as a contradiction, and the
                       * owner is the one who has to resolve it.
                       *
                       * A DATED period is due when its date arrives. Anything
                       * else — a milestone waiting on the owner, a period
                       * already invoiced — is genuinely the one in hand.
                       * Compared as calendar days: `due_date` is a DATE, and
                       * `en-CA` renders both sides as sortable `YYYY-MM-DD`.
                       */
                      const notYetDue =
                        stage.trigger === 'date' &&
                        !stage.invoiceId &&
                        Boolean(stage.dueDate) &&
                        String(stage.dueDate).slice(0, 10) > new Date().toLocaleDateString('en-CA');

                      /*
                        Pickable only when there is something to pick.
                        ───────────────────────────────────────────────────────
                        A settled, stopped or unbilled stage is a statement; a
                        billed unpaid one is the thing the button below acts on.
                        Only the second kind becomes a control, so the card does
                        not invite a click that does nothing.
                      */
                      const collectable = collectableStages.some(s => s.id === stage.id);
                      const chosen = collectable && settleTarget?.id === stage.id;

                      return (
                        <div
                          key={stage.id}
                          role={collectable ? 'radio' : undefined}
                          aria-checked={collectable ? chosen : undefined}
                          tabIndex={collectable ? 0 : undefined}
                          onClick={collectable ? () => setSettleTargetId(stage.id) : undefined}
                          onKeyDown={
                            collectable
                              ? event => {
                                  if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault();
                                    setSettleTargetId(stage.id);
                                  }
                                }
                              : undefined
                          }
                          className={`flex items-center justify-between gap-3 rounded-xl border px-3.5 py-3 transition-all ${
                            chosen
                              ? 'border-[#8B5CF6] bg-[#8B5CF6]/[0.06] ring-1 ring-[#8B5CF6]/30'
                              : collectable
                                ? 'cursor-pointer border-[var(--v2-border)] bg-[var(--v2-bg)] hover:border-[#8B5CF6]/50 hover:bg-[var(--v2-surface)]'
                                : 'border-[var(--v2-border)] bg-[var(--v2-surface)]/40'
                          }`}
                        >
                          {/*
                            The chosen mark, and only on a stage that can be
                            chosen. A tick on every row would restate the status
                            column; this says "the button means THIS one".
                          */}
                          {collectable && (
                            <span
                              aria-hidden="true"
                              className={`mt-0.5 h-4 w-4 flex-shrink-0 rounded-full border-2 transition-colors ${
                                chosen
                                  ? 'border-[#8B5CF6] bg-[#8B5CF6] ring-2 ring-inset ring-[var(--v2-bg)]'
                                  : 'border-[var(--v2-border)]'
                              }`}
                            />
                          )}

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium text-[var(--v2-text-primary)]">
                                {stage.label || `${t('crm.payment.installment') || 'Payment'} ${index + 1}`}
                              </span>
                              {isTarget && !notYetDue && (
                                <span className="flex-shrink-0 rounded-full bg-[#8B5CF6] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                                  {t('crm.payment.due_now') || 'Due now'}
                                </span>
                              )}
                              {isTarget && notYetDue && (
                                <span className="flex-shrink-0 rounded-full border border-[var(--v2-border)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--v2-text-muted)]">
                                  {t('crm.payment.scheduled') || 'Scheduled'}
                                </span>
                              )}
                            </div>
                            {/*
                              The status AND its date.
                              ─────────────────────────────────────────────────
                              "Paid" with no date is the wrong half of the answer
                              for anyone reconciling a bank statement, and
                              "Invoiced" with none does not say whether it is
                              late. Both dates were on the row already; only the
                              status was being shown.
                            */}
                            <div className="mt-0.5 text-xs text-[var(--v2-text-muted)]">
                              {stopped
                                ? t('payments.plan.status.cancelled')
                                : settled
                                ? stage.paidAt
                                  ? `${t('crm.payment.status_paid')} · ${stageDate(stage.paidAt)}`
                                  : t('crm.payment.status_paid')
                                : stage.invoiceId
                                  ? stage.dueDate
                                    ? `${t('crm.payment.status_invoiced')} · ${t('crm.payment.due')} ${stageDate(stage.dueDate)}`
                                    : t('crm.payment.status_invoiced')
                                  : t('crm.payment.status_not_billed')}
                              {/*
                                Say where the answer is — and only when there is
                                something for the owner to DO.
                                ─────────────────────────────────────────────────
                                "Not billed" is accurate and was a dead end: this
                                modal has no way to raise it, and the next step
                                is to raise it rather than record money against
                                it. It never said WHERE. The control lives on the
                                booking's journey, in the drawer behind this.

                                But that instruction belongs to a MANUAL stage
                                only. An instalment period is `trigger: 'date'`
                                and bills ITSELF when its date arrives — nothing
                                is waiting on the owner. Telling them to "mark
                                the phase done to bill it" asked for an action
                                that does not exist on this kind of period, and
                                implied the money was stuck when it was merely
                                scheduled.
                              */}
                              {/*
                                And what became of it, when some of it went back.
                                The same sentence the card uses, in the same
                                words, so one event does not get two tellings.
                              */}
                              {stageRefunded > 0 && (
                                <span
                                  className={`mt-0.5 block text-[11px] tabular-nums ${
                                    fullyReturned
                                      ? 'text-red-600 dark:text-red-400'
                                      : 'text-orange-600 dark:text-orange-400'
                                  }`}
                                >
                                  <bdi>
                                    {(t('crm.stage.refund_breakdown') ||
                                      '{refunded} refunded · {kept} kept')
                                      .replace('{refunded}', formatCurrency(stageRefunded, payment.currency))
                                      .replace(
                                        '{kept}',
                                        formatCurrency(
                                          Math.max(Number(stage.amount ?? 0) - stageRefunded, 0),
                                          payment.currency
                                        )
                                      )}
                                  </bdi>
                                </span>
                              )}
                              {!stopped && !stage.invoiceId && stage.trigger !== 'date' && (
                                <span className="mt-0.5 block text-[11px] text-[var(--v2-text-muted)]">
                                  {t('crm.payment.bill_it_hint')}
                                </span>
                              )}
                              {!stopped && !stage.invoiceId && stage.trigger === 'date' && stage.dueDate && (
                                <span className="mt-0.5 block text-[11px] text-[var(--v2-text-muted)]">
                                  {t('crm.payment.bills_automatically')} {stageDate(stage.dueDate)}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex flex-shrink-0 items-center gap-2">
                            <span className={`text-sm font-semibold tabular-nums ${
                              settled || stopped
                                ? 'text-[var(--v2-text-muted)] line-through'
                                : 'text-[var(--v2-text-primary)]'
                            }`}>
                              {formatCurrency(stage.amount, payment.currency)}
                            </span>
                            {settled ? (
                              <CheckCircle2 className="h-4 w-4 text-green-500" />
                            ) : stopped ? (
                              // A clock says "waiting". Nothing is waiting on a
                              // period that was called off.
                              <XCircle className="h-4 w-4 text-amber-700" />
                            ) : (
                              <Clock className="h-4 w-4 text-amber-500" />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {contactName && (
                    <p className="text-xs text-[var(--v2-text-muted)]">
                      {t('crm.payment.contact') || 'Contact'}: {contactName}
                    </p>
                  )}
                </div>
              ) : (
                /* A single payment has one amount and one status, and the flat
                   card says that perfectly well. */
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-[var(--v2-text-primary)] uppercase tracking-wide">
                    {t('crm.payment.details') || 'Payment Details'}
                  </h3>

                  <div className="space-y-3 bg-[var(--v2-surface)] border border-[var(--v2-border)] p-4 rounded-lg">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm text-[var(--v2-text-secondary)]">
                        <DollarSign className="h-4 w-4" />
                        {t('crm.payment.amount') || 'Amount'}
                      </div>
                      <span className="text-lg font-bold text-[var(--v2-text-primary)]">
                        {formatCurrency(payment.amount, payment.currency)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm text-[var(--v2-text-secondary)]">
                        <StatusIcon className="h-4 w-4" />
                        {t('crm.payment.status') || 'Status'}
                      </div>
                      <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full ${statusConfig.bg} ${statusConfig.border} border`}>
                        <StatusIcon className={`h-3.5 w-3.5 ${statusConfig.color}`} />
                        <span className={`text-sm font-medium ${statusConfig.color}`}>
                          {statusConfig.label}
                        </span>
                      </div>
                    </div>

                    {/*
                      ── WHAT CAME BACK, AND WHAT IS STILL HERE ──────────────
                      This dialog showed the gross charge, a status word and the
                      client, and nothing else — so a payment partly returned
                      read "₪150 · Paid" with the refund invisible. Not merely
                      incomplete: `Paid` is the correct status for a partial
                      refund (the booking still holds money), so the one screen
                      an owner opens to see a payment's history actively
                      implied nothing had been returned.

                      Measured 2026-10-25: transaction 01957ad5, ₪150 charged,
                      ₪75 returned at 22:21, dialog showed "₪150 · שולם".

                      Two rows rather than one. "Refunded ₪75" alone still
                      leaves the owner subtracting to find what they keep, and
                      that figure is the one they are actually looking for —
                      the same pair, in the same words, the journey strip uses
                      (`Refunded · You keep`), so the card and this dialog
                      cannot describe one payment two ways.

                      Shown for a FULL refund too: "You keep ₪0" is a fact
                      worth stating plainly over money that has gone.
                    */}
                    {Number(payment.refundedAmount ?? 0) > 0 && (
                      <>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 text-sm text-[var(--v2-text-secondary)]">
                            <RotateCcw className="h-4 w-4" />
                            {t('crm.journey.returned') || 'Refunded'}
                            {payment.refundedAt && (
                              <span className="text-xs text-[var(--v2-text-muted)]">
                                · {stageDate(payment.refundedAt)}
                              </span>
                            )}
                          </div>
                          <span
                            className="text-sm font-semibold tabular-nums"
                            style={{
                              color:
                                REFUND_HEX[
                                  refundExtent(Number(payment.refundedAmount), payment.amount)
                                ],
                            }}
                          >
                            {formatCurrency(Number(payment.refundedAmount), payment.currency)}
                          </span>
                        </div>

                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 text-sm text-[var(--v2-text-secondary)]">
                            <Wallet className="h-4 w-4" />
                            {t('crm.journey.kept') || 'You keep'}
                          </div>
                          <span className="text-sm font-semibold tabular-nums text-[var(--v2-text-primary)]">
                            {formatCurrency(
                              Math.max(0, payment.amount - Number(payment.refundedAmount)),
                              payment.currency
                            )}
                          </span>
                        </div>
                      </>
                    )}

                    {contactName && (
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm text-[var(--v2-text-secondary)]">
                          <User className="h-4 w-4" />
                          {t('crm.payment.contact') || 'Contact'}
                        </div>
                        <span className="text-sm font-medium text-[var(--v2-text-primary)]">
                          {contactName}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="space-y-3 pt-4 border-t border-[var(--v2-border)]">
                <div className="space-y-3">
                  {/*
                    COLLECTING. The primary act, and on a plan it names the one
                    stage it settles — "Mark as Paid" alone does not say which
                    $500, and the two are collected weeks apart.
                  */}
                  {/*
                    HOW IT ARRIVED, asked before it is recorded.

                    Beside the action rather than in a second dialog: the answer
                    is one tap, it is needed every time money is recorded by
                    hand, and a confirmation step for a single field is how an
                    owner ends up leaving the default in place.
                  */}
                  {canMarkPaid && (
                    <div className="rounded-2xl border border-[var(--v2-border)] bg-[var(--v2-surface)]/60 p-4 space-y-3">
                      {/*
                        WHICH MONEY, IN WORDS, DIRECTLY ABOVE THE BUTTON.
                        ───────────────────────────────────────────────────────
                        With both stages invoiced and sitting with the client,
                        "Record payment · ₪400" was ambiguous twice over: two
                        stages cost ₪400 each, and the dialog silently meant the
                        earlier one. Naming it — and letting the owner pick the
                        other — is the whole point of the cards above.
                      */}
                      {settleTarget && (
                        <p className="text-xs text-[var(--v2-text-muted)]">
                          {t('crm.payment.recording_for') || 'Recording a payment for'}{' '}
                          <span className="font-semibold text-[var(--v2-text-primary)]">
                            {settleTarget.label || t('crm.payment.installment') || 'Payment'}
                          </span>
                        </p>
                      )}

                      {/*
                        CHIPS, NOT A DROPDOWN.
                        ───────────────────────────────────────────────────────
                        Five short, mutually exclusive options that an owner
                        picks every single time they record money by hand. A
                        select hides four of them behind a click and a native
                        menu that looks nothing like the rest of this dialog;
                        chips show the whole choice and take one tap.
                      */}
                      <div>
                        <span className="mb-2 block text-xs font-medium text-[var(--v2-text-muted)]">
                          {t('payments.payment_method') || 'Payment method'}
                        </span>
                        <div className="flex flex-wrap gap-1.5" role="radiogroup">
                          {MANUAL_METHODS.map(method => {
                            const picked = paymentMethod === method.value;

                            return (
                              <button
                                key={method.value}
                                type="button"
                                role="radio"
                                aria-checked={picked}
                                disabled={loading}
                                onClick={() => setPaymentMethod(method.value)}
                                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-all disabled:opacity-50 ${
                                  picked
                                    ? 'border-[#8B5CF6] bg-[#8B5CF6] text-white shadow-sm'
                                    : 'border-[var(--v2-border)] bg-[var(--v2-bg)] text-[var(--v2-text-secondary)] hover:border-[#8B5CF6]/50 hover:text-[var(--v2-text-primary)]'
                                }`}
                              >
                                {t(method.labelKey) || method.fallback}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <Button
                        type="button"
                        onClick={handleMarkAsPaid}
                        disabled={loading}
                        /* Flat, not a gradient. The gradient was the loudest
                           thing in the dialog and dated it on its own.

                           NO `py-5` EITHER. The four buttons in this dialog
                           each carried it — two and a half times the Button's
                           own `lg`, which is `py-3` — so a confirmation that
                           should sit quietly under the figures became the
                           tallest thing on the screen. They take the component's
                           default size now, like every other button in the
                           product. */
                        className="w-full rounded-xl bg-[#16A34A] text-white hover:bg-[#15803D]"
                      >
                        {loading ? (
                          <Loader2 className="h-4 w-4 me-2 animate-spin" />
                        ) : (
                          <Check className="h-4 w-4 me-2" />
                        )}
                        {settleTarget
                          ? `${t('crm.payment.record_payment') || 'Record payment'} · ${formatCurrency(settleTarget.amount, payment.currency)}`
                          : outstandingStage
                            ? `${t('crm.payment.record_payment') || 'Record payment'} · ${formatCurrency(outstandingStage.amount, payment.currency)}`
                            : t('crm.payment.mark_paid') || 'Mark as Paid'}
                      </Button>
                    </div>
                  )}

                  {/*
                    REFUNDING. Deliberately demoted: a rule above it, quiet
                    styling, and its own words. It sat as a second full-width
                    button directly beneath the collect action, in the same
                    visual weight, so the two read as a pair of equals — one
                    taking money in and one giving it back, a click apart.
                  */}
                  {isPaid && (
                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={() => setView('refund')}
                        disabled={loading}
                        className="inline-flex items-center gap-1.5 text-sm text-[var(--v2-text-muted)] underline-offset-4 hover:text-orange-600 hover:underline disabled:opacity-50 transition-colors"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        {isPlan
                          ? t('crm.payment.refund_collected') || 'Refund money already collected'
                          : t('crm.payment.refund') || 'Refund Payment'}
                      </button>
                    </div>
                  )}

                  {/*
                    CALLING THE MONEY OFF, for the job that is not happening.

                    Demoted exactly as the refund is, and for the same reason:
                    the collect action above is what an owner wants almost every
                    time, and a second full-width button beside it would read as
                    an equal choice. It is the quiet one, and it asks twice.
                  */}
                  {!isPaid && voidableInvoiceId && (
                    /*
                      A BUTTON, not a footnote.

                      This started as an underline link beside the refund one,
                      which is the right weight for refunding — a rare, late
                      action on money that has already arrived. It is the wrong
                      weight here: for a job that was called off, calling the
                      money off is the thing the owner came to do, and "Mark as
                      paid" is the one they will never press. It was reported as
                      invisible, which it was.

                      Bordered and full width so it reads as an action, in the
                      quiet red of a destructive one rather than the solid green
                      of the collect button above. Equal in presence, not in
                      pull.
                    */
                    <div className="pt-1">
                      {confirmingVoid ? (
                        <div className="rounded-2xl border border-red-300 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 p-4 space-y-3">
                          <p className="text-sm text-red-900 dark:text-red-200">
                            {t('crm.payment.cancel_invoice_confirm') ||
                              'Cancel this invoice? The client will no longer be able to pay it.'}
                          </p>
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              onClick={handleVoidInvoice}
                              disabled={loading}
                              className="flex-1 rounded-xl bg-red-600 text-white hover:bg-red-700"
                            >
                              {loading ? (
                                <Loader2 className="h-4 w-4 me-2 animate-spin" />
                              ) : (
                                <Ban className="h-4 w-4 me-2" />
                              )}
                              {t('crm.payment.cancel_invoice_yes') || 'Yes, cancel it'}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => setConfirmingVoid(false)}
                              disabled={loading}
                              className="rounded-xl"
                            >
                              {t('common.cancel') || 'Keep it'}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setConfirmingVoid(true)}
                          disabled={loading}
                          className="w-full rounded-xl border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-900/60 dark:hover:bg-red-950/30"
                        >
                          <Ban className="h-4 w-4 me-2" />
                          {t('crm.payment.cancel_invoice') || 'Cancel this payment'}
                        </Button>
                      )}
                    </div>
                  )}

                  {/*
                    * Money the owner recorded themselves, which a refund here
                    * cannot send back.
                    *
                    * The test used to be `!payment.id` — the absence of
                    * `scheduling_bookings.payment_id`, a legacy single-payment
                    * column that is null on 74 of this account's 81 paid
                    * bookings. So the warning appeared on card payments, which
                    * is every instalment sale, and the one place it was telling
                    * the truth was an accident.
                    *
                    * `isManual` asks the charges instead: settled, and every
                    * one of them `processor_type: 'manual'`.
                    */}
                  {isPaid && payment.isManual && (
                    <div className="flex items-start gap-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 p-3 text-sm text-blue-800 dark:text-blue-200">
                      <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                      <div>
                        <span className="font-medium">
                          {t('crm.payment.manual_payment') || 'Manual Payment'}
                        </span>
                        <p className="text-xs mt-0.5 opacity-80">
                          {t('crm.payment.manual_refund_note') || 'The money arrived outside the system, so a refund here only records it: returning the money to the client is something you do yourself.'}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Free service - no actions */}
                  {isFree && (
                    <div className="flex items-center gap-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 p-3 text-sm text-blue-800 dark:text-blue-200">
                      <Check className="h-4 w-4 flex-shrink-0" />
                      <span>
                        {t('crm.payment.free_service') || 'This is a free service - no payment required'}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* Refund View */}
          {view === 'refund' && (
            <form onSubmit={handleRefund} className="space-y-4">
              {/* Transaction Info */}
              <div className="rounded-lg bg-[var(--v2-surface)] border border-[var(--v2-border)] p-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-[var(--v2-text-muted)]">{t('crm.payment.original_amount') || 'Original Amount'}</span>
                    <p className="font-semibold text-[var(--v2-text-primary)]">{formatCurrency(payment.amount, payment.currency)}</p>
                  </div>
                  <div>
                    <span className="text-[var(--v2-text-muted)]">{t('crm.payment.refundable') || 'Refundable'}</span>
                    <p className="font-semibold text-green-600">{formatCurrency(maxRefundable, payment.currency)}</p>
                  </div>
                </div>
              </div>

              {/* Refund Type */}
              <div>
                <label className="mb-2 block text-sm font-medium text-[var(--v2-text-primary)]">
                  {t('crm.payment.refund_type') || 'Refund Type'}
                </label>
                <div className="flex flex-col sm:flex-row gap-3">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name="refundType"
                      value="full"
                      checked={refundType === 'full'}
                      onChange={() => setRefundType('full')}
                      className="h-4 w-4 text-orange-600"
                    />
                    <span className="text-sm text-[var(--v2-text-primary)]">
                      {t('crm.payment.full_refund') || 'Full Refund'} ({formatCurrency(maxRefundable, payment.currency)})
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name="refundType"
                      value="partial"
                      checked={refundType === 'partial'}
                      onChange={() => setRefundType('partial')}
                      className="h-4 w-4 text-orange-600"
                    />
                    <span className="text-sm text-[var(--v2-text-primary)]">
                      {t('crm.payment.partial_refund') || 'Partial Refund'}
                    </span>
                  </label>
                </div>
              </div>

              {/* Partial Amount */}
              {refundType === 'partial' && (
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[var(--v2-text-primary)]">
                    {t('crm.payment.refund_amount') || 'Refund Amount'}
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-[var(--v2-text-muted)]">{payment.currency}</span>
                    <Input
                      type="number"
                      step="0.01"
                      min="0.01"
                      max={maxRefundable}
                      value={partialAmount}
                      onChange={(e) => setPartialAmount(e.target.value)}
                      placeholder="0.00"
                      required
                      className="flex-1"
                    />
                  </div>
                  <p className="mt-1 text-xs text-[var(--v2-text-muted)]">
                    {t('crm.payment.maximum') || 'Maximum'}: {formatCurrency(maxRefundable, payment.currency)}
                  </p>
                </div>
              )}

              {/* Reason */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[var(--v2-text-primary)]">
                  {t('crm.payment.reason') || 'Reason'} ({t('common.optional') || 'optional'})
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={t('crm.payment.reason_placeholder') || 'Reason for refund...'}
                  className="w-full rounded-md border border-[var(--v2-border)] bg-[var(--v2-bg)] p-2 text-sm text-[var(--v2-text-primary)] placeholder:text-[var(--v2-text-muted)] focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
                  rows={2}
                />
              </div>

              {/* Notify Contact */}
              <div>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={notifyContact}
                    onChange={(e) => setNotifyContact(e.target.checked)}
                    className="h-4 w-4 rounded text-orange-600"
                  />
                  <span className="text-sm text-[var(--v2-text-primary)]">
                    {t('crm.payment.notify_contact') || 'Send notification to contact'}
                  </span>
                </label>
              </div>

              {/* Delete Booking Toggle - only for full refund */}
              {refundType === 'full' && (
                <div className="flex items-center justify-between p-3 rounded-lg bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <Trash2 className="h-4 w-4 text-orange-500 flex-shrink-0" />
                    <div className="min-w-0">
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        {t('crm.payment.delete_booking_after_refund') || 'Delete booking after refund'}
                      </span>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {t('crm.payment.delete_booking_warning') || 'Permanently remove the booking record'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={deleteBooking}
                    onClick={() => setDeleteBooking(!deleteBooking)}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 ms-3 ${
                      deleteBooking ? 'bg-orange-500' : 'bg-gray-200 dark:bg-gray-700'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        deleteBooking
                          ? (isRTL ? '-translate-x-5' : 'translate-x-5')
                          : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              )}

              {/* Warning */}
              <div className="flex items-start gap-2 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 p-3 text-sm text-yellow-800 dark:text-yellow-200 border border-yellow-200 dark:border-yellow-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <p>
                  {t('crm.payment.refund_warning') || 'Refunds cannot be undone.'} {formatCurrency(refundAmount, payment.currency)} {t('crm.payment.will_be_returned') || 'will be returned to the original payment method.'}
                </p>
              </div>

              {/* Refund Button */}
              <Button
                type="submit"
                disabled={loading || (refundType === 'partial' && refundAmount <= 0)}
                className="w-full bg-orange-600 hover:bg-orange-700 text-white"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 me-2 animate-spin" />
                    {t('common.processing') || 'Processing...'}
                  </>
                ) : (
                  <>
                    <RotateCcw className="h-4 w-4 me-2" />
                    {t('crm.payment.refund') || 'Refund'} {formatCurrency(refundAmount, payment.currency)}
                  </>
                )}
              </Button>
            </form>
          )}
        </div>

        {/* Sticky Footer - only for details view */}
        {view === 'details' && (
          /*
            The two ways out, and they are not a pair.
            ───────────────────────────────────────────────────────────────────
            Stopping a plan calls off money that has not been asked for yet;
            closing does nothing at all. They sat side by side at equal weight
            in matching outlined boxes, so the destructive one was one slip away
            from the harmless one. Close is now the plain button on the right,
            stop is a quiet amber link on the left, and the gap between them is
            the point.
          */
          <div className="flex-shrink-0 flex items-center justify-between gap-3 px-4 sm:px-6 py-4 border-t border-[var(--v2-border)] bg-[var(--v2-bg)]">
            {/*
              STOPPING THE PLAN, WHERE THE PLAN IS.
              ─────────────────────────────────────────────────────────────────
              This existed only on the Money screen, against a
              `payment_plan_subscriptions` row — so a plan billed by invoice
              could not be stopped from anywhere, and the owner was looking for
              it here, beside the schedule it would stop.

              Shown only while something is still owed: a plan collected in full
              has nothing left to call off, and offering the button there reads
              as an undo.
            */}
            {isPlan && outstandingStage ? (
              <button
                type="button"
                onClick={() => setStopPlanOpen(true)}
                className="text-sm text-amber-600 underline-offset-4 transition-colors hover:text-amber-700 hover:underline dark:text-amber-400"
              >
                {t('payments.plan.stop') || 'Stop plan'}
              </button>
            ) : (
              <span />
            )}
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              className="rounded-xl px-6 border-[var(--v2-border)] text-[var(--v2-text-primary)] hover:bg-[var(--v2-surface)]"
            >
              {t('button.close') || 'Close'}
            </Button>
          </div>
        )}
      </DialogContent>

      {/*
        Stopping by BOOKING, not by subscription id.
        ───────────────────────────────────────────────────────────────────────
        The same modal the Money screen uses — same reasons, same confirmation
        — pointed at the booking route, which covers a plan of any shape. Its
        refund half hides itself there: returning collected money is the refund
        view behind this, against the ledger.
      */}
      {booking?.booking?.id && (
        <CancelPlanModal
          isOpen={stopPlanOpen}
          onClose={() => setStopPlanOpen(false)}
          planId=""
          bookingId={booking.booking.id}
          periodsRemaining={stages.filter(st => st.status !== 'paid' && st.status !== 'cancelled').length}
          collectedAmount={0}
          currency={paymentData?.currency ?? 'USD'}
          onSuccess={() => {
            setStopPlanOpen(false);
            onPaymentUpdated();
            onClose();
          }}
          onError={message => setError(message)}
        />
      )}
    </Dialog>
  );
}
