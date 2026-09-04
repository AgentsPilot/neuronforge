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
  const canRefund = paymentData?.status === 'paid';
  const [view, setView] = useState<ModalView>('refund');

  // Always start in refund view when modal opens (if payment is paid)
  useEffect(() => {
    if (isOpen && canRefund) {
      setView('refund');
    } else if (isOpen) {
      setView('details');
    }
  }, [isOpen, canRefund]);

  if (!booking || !paymentData) return null;

  const payment = paymentData;
  const paymentStatus = payment.status;
  const isPaid = paymentStatus === 'paid';
  const isPending = paymentStatus === 'pending';
  const isFree = paymentStatus === 'free';

  const maxRefundable = payment.amount;
  const refundAmount = refundType === 'full' ? maxRefundable : parseFloat(partialAmount) || 0;

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

  const handleMarkAsPaid = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/scheduling/bookings/${booking.booking.id}`, {
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
        className="w-full sm:max-w-md h-[100vh] sm:h-auto sm:max-h-[90vh] flex flex-col bg-[var(--v2-bg)] p-0 overflow-hidden"
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
              {/* Payment Details Section */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-[var(--v2-text-primary)] uppercase tracking-wide">
                  {t('crm.payment.details') || 'Payment Details'}
                </h3>

                <div className="space-y-3 bg-[var(--v2-surface)] border border-[var(--v2-border)] p-4 rounded-lg">
                  {/* Amount */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm text-[var(--v2-text-secondary)]">
                      <DollarSign className="h-4 w-4" />
                      {t('crm.payment.amount') || 'Amount'}
                    </div>
                    <span className="text-lg font-bold text-[var(--v2-text-primary)]">
                      {formatCurrency(payment.amount, payment.currency)}
                    </span>
                  </div>

                  {/* Status */}
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

                  {/* Contact */}
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

              {/* Actions Section */}
              <div className="space-y-4 pt-4 border-t border-[var(--v2-border)]">
                <h3 className="text-sm font-semibold text-[var(--v2-text-primary)] uppercase tracking-wide">
                  {t('crm.payment.actions') || 'Actions'}
                </h3>

                <div className="space-y-3">
                  {/* Mark as Paid - only for pending */}
                  {isPending && (
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
                      {t('crm.payment.mark_paid') || 'Mark as Paid'}
                    </Button>
                  )}

                  {/* Refund - for any paid booking (with or without payment_id) */}
                  {isPaid && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setView('refund')}
                      disabled={loading}
                      className="w-full border-orange-500 text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-950/20"
                    >
                      <RotateCcw className="h-4 w-4 me-2" />
                      {t('crm.payment.refund') || 'Refund Payment'}
                    </Button>
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
