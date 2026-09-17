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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  CreditCard, Check, RotateCcw, Loader2, AlertTriangle,
  CheckCircle2, Clock, XCircle, DollarSign, User, ArrowLeft, Trash2
} from 'lucide-react';
import { createLogger } from '@/lib/logger';
import type { SessionCardData } from './types';
import { PaymentPlanTotals } from '@/components/payments/PaymentPlanTotals';
import { useBusinessTimezone } from '@/lib/business-os/LanguageContext';

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
  /** Start directly in refund view (skip details) */
  startInRefundView?: boolean;
}

type ModalView = 'details' | 'refund';

export function PaymentManagementModal({
  isOpen,
  onClose,
  booking,
  contactName,
  onPaymentUpdated,
  onBookingDeleted,
  t,
  isRTL = false,
  startInRefundView = false
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

  // Check if refund is possible (payment status is 'paid')
  // Note: refund works with or without payment.id - manual payments can be "refunded" by updating status
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

  /** Money is still to be collected on this booking. */
  const hasOutstanding = Boolean(outstandingStage) || Boolean(paymentData?.outstandingInvoiceId);

  /**
   * The invoice a manual payment would actually settle.
   *
   * A stage only has one once it has been BILLED. A milestone waiting on the
   * owner to say the work happened has no invoice yet, and there is nothing to
   * mark paid — the next step there is to raise it, not to record money against
   * it.
   */
  const settleableInvoiceId = outstandingStage?.invoiceId ?? paymentData?.outstandingInvoiceId ?? null;

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
   * Refund is still REACHABLE when something is outstanding — money has changed
   * hands and giving it back is legitimate — but it is not what the owner came
   * for. Collecting is. The refund button in the details view covers the rest.
   */
  useEffect(() => {
    if (!isOpen) return;
    setView(canRefund && !hasOutstanding ? 'refund' : 'details');
  }, [isOpen, canRefund, hasOutstanding]);

  if (!booking || !paymentData) return null;

  const payment = paymentData;
  const paymentStatus = payment.status;
  const isPaid = paymentStatus === 'paid';
  const isPending = paymentStatus === 'pending';
  const isFree = paymentStatus === 'free';

  const maxRefundable = payment.amount;
  const refundAmount = refundType === 'full' ? maxRefundable : parseFloat(partialAmount) || 0;

  /**
   * A stage's date, short.
   *
   * On the BUSINESS's clock, like every other time this drawer shows: a payment
   * recorded at 11pm in New York is not the next day because the owner happens
   * to be reading from Tel Aviv.
   */
  const stageDate = (value: string) =>
    new Date(value).toLocaleDateString(
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
   * `bank_transfer` is the route's own default and the right one here: anything
   * marked by hand did not come through a processor, so it is not a card.
   */
  const handleMarkAsPaid = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = settleableInvoiceId
        ? await fetch(`/api/payments/invoices/${settleableInvoiceId}/mark-paid`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ payment_method: 'bank_transfer' })
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
        // `SessionPayment` carries no refunded figure — only `refundedAt`. The
        // modal asks the server for the true remaining amount anyway, which is
        // what makes that omission safe rather than another over-offer.
        alreadyRefunded={0}
        contactName={contactName}
        isRTL={isRTL}
        // This modal is opened from a booking, so deleting it afterwards is a
        // real option here in a way it is not on the payments tab.
        showDeleteBookingOption
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
        className="w-full sm:max-w-md h-[100vh] sm:h-auto sm:max-h-[90dvh] flex flex-col bg-[var(--v2-bg)] p-0 overflow-hidden"
        dir={isRTL ? 'rtl' : 'ltr'}
      >
        {/* Sticky Header */}
        <div className="flex-shrink-0 border-b border-[var(--v2-border)] px-4 sm:px-6 py-4 sm:py-6 bg-[var(--v2-bg)]">
          <DialogHeader className="rtl:text-right">
            <DialogTitle className="flex items-center gap-2 text-lg sm:text-xl font-semibold text-[var(--v2-text-primary)]">
              {view === 'refund' ? (
                <>
                  <button
                    onClick={() => { setView('details'); setError(null); }}
                    className="p-1 -ms-1 rounded-full hover:bg-[var(--v2-surface)] transition-colors"
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </button>
                  <RotateCcw className="h-5 w-5 text-orange-500" />
                  {t('crm.payment.refund') || 'Process Refund'}
                </>
              ) : (
                <>
                  <CreditCard className="h-5 w-5 text-[#8B5CF6]" />
                  {t('crm.payment.manage') || 'Manage Payment'}
                </>
              )}
            </DialogTitle>
          </DialogHeader>
          {booking.booking.service?.service_name && (
            <p className="text-sm text-[var(--v2-text-muted)] mt-1">
              {booking.booking.service.service_name}
            </p>
          )}
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
                    labels={{
                      total: t('crm.payment.total') || 'Total',
                      collected: t('crm.payment.collected') || 'Collected',
                      outstanding: t('crm.payment.outstanding') || 'Outstanding',
                    }}
                  />

                  {/* Every stage, in order. The one that is owed is the only
                      one drawn with emphasis — it is the one the action acts on. */}
                  <div className="overflow-hidden rounded-xl border border-[var(--v2-border)]">
                    {stages.map((stage, index) => {
                      const settled = stage.status === 'paid';
                      const isTarget = outstandingStage?.id === stage.id;

                      return (
                        <div
                          key={stage.id}
                          className={`flex items-center justify-between gap-3 px-4 py-3 ${
                            index > 0 ? 'border-t border-[var(--v2-border)]' : ''
                          } ${isTarget ? 'bg-[#8B5CF6]/5' : 'bg-[var(--v2-bg)]'}`}
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium text-[var(--v2-text-primary)]">
                                {stage.label || `${t('crm.payment.installment') || 'Payment'} ${index + 1}`}
                              </span>
                              {isTarget && (
                                <span className="flex-shrink-0 rounded-full bg-[#8B5CF6] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                                  {t('crm.payment.due_now') || 'Due now'}
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
                              {settled
                                ? stage.paidAt
                                  ? `${t('crm.payment.status_paid')} · ${stageDate(stage.paidAt)}`
                                  : t('crm.payment.status_paid')
                                : stage.invoiceId
                                  ? stage.dueDate
                                    ? `${t('crm.payment.status_invoiced')} · ${t('crm.payment.due')} ${stageDate(stage.dueDate)}`
                                    : t('crm.payment.status_invoiced')
                                  : t('crm.payment.status_not_billed')}
                            </div>
                          </div>

                          <div className="flex flex-shrink-0 items-center gap-2">
                            <span className={`text-sm font-semibold tabular-nums ${
                              settled ? 'text-[var(--v2-text-muted)] line-through' : 'text-[var(--v2-text-primary)]'
                            }`}>
                              {formatCurrency(stage.amount, payment.currency)}
                            </span>
                            {settled ? (
                              <CheckCircle2 className="h-4 w-4 text-green-500" />
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
                  {canMarkPaid && (
                    <Button
                      type="button"
                      onClick={handleMarkAsPaid}
                      disabled={loading}
                      className="w-full text-white"
                      style={{ background: 'linear-gradient(135deg, #22C55E 0%, #16A34A 100%)' }}
                    >
                      {loading ? (
                        <Loader2 className="h-4 w-4 me-2 animate-spin" />
                      ) : (
                        <Check className="h-4 w-4 me-2" />
                      )}
                      {outstandingStage
                        ? `${t('crm.payment.record_payment') || 'Record payment'} · ${formatCurrency(outstandingStage.amount, payment.currency)}`
                        : t('crm.payment.mark_paid') || 'Mark as Paid'}
                    </Button>
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

                  {/* Manual payment note - no actual money refund */}
                  {isPaid && !payment.id && (
                    <div className="flex items-start gap-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 p-3 text-sm text-blue-800 dark:text-blue-200">
                      <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                      <div>
                        <span className="font-medium">
                          {t('crm.payment.manual_payment') || 'Manual Payment'}
                        </span>
                        <p className="text-xs mt-0.5 opacity-80">
                          {t('crm.payment.manual_refund_note') || 'This was marked as paid manually. Refund will only update the status.'}
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
          <div className="flex-shrink-0 flex justify-end gap-3 p-6 border-t border-[var(--v2-border)] bg-[var(--v2-bg)] [dir=rtl]:flex-row-reverse">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              className="px-6 border-[var(--v2-border)] text-[var(--v2-text-primary)] hover:bg-[var(--v2-surface)]"
            >
              {t('button.close') || 'Close'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
