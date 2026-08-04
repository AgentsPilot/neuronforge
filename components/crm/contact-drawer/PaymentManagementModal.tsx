'use client';

/**
 * PaymentManagementModal
 *
 * Modal for managing booking payments - mark as paid, process refunds (Stripe),
 * and optionally delete booking on full refund.
 *
 * Uses the standard platform dialog pattern with DialogHeader/DialogTitle.
 */

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  CreditCard, Check, RotateCcw, Loader2, AlertTriangle,
  CheckCircle2, Clock, XCircle, DollarSign, User, Trash2
} from 'lucide-react';
import { RefundModal } from '@/components/payments/RefundModal';
import type { SessionCardData } from './types';

interface PaymentManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  booking: SessionCardData | null;
  contactName: string;
  onPaymentUpdated: () => void;
  onBookingDeleted?: (bookingId: string) => void;
  t: (key: string) => string;
  isRTL?: boolean;
}

export function PaymentManagementModal({
  isOpen,
  onClose,
  booking,
  contactName,
  onPaymentUpdated,
  onBookingDeleted,
  t,
  isRTL = false
}: PaymentManagementModalProps) {
  const [loading, setLoading] = useState(false);
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [deleteAfterRefund, setDeleteAfterRefund] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (!booking || !booking.payment) return null;

  const { payment } = booking;
  const paymentStatus = payment.status;
  const isPaid = paymentStatus === 'paid';
  const isPending = paymentStatus === 'pending';
  const isFree = paymentStatus === 'free';

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency
    }).format(amount);
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
        onClose();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update payment');
    } finally {
      setLoading(false);
    }
  };

  const handleRefundSuccess = async () => {
    setShowRefundModal(false);
    setSuccess(t('crm.payment.refund_success') || 'Refund processed successfully');

    // If user checked "delete booking" option
    if (deleteAfterRefund && onBookingDeleted) {
      try {
        const response = await fetch(`/api/scheduling/bookings/${booking.booking.id}`, {
          method: 'DELETE'
        });

        if (response.ok) {
          onBookingDeleted(booking.booking.id);
        }
      } catch {
        // Log error but don't block the flow
      }
    }

    onPaymentUpdated();

    setTimeout(() => {
      setSuccess(null);
      setDeleteAfterRefund(false);
      onClose();
    }, 1500);
  };

  const handleRefundError = (errorMsg: string) => {
    setError(errorMsg);
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

  return (
    <>
      <Dialog open={isOpen && !showRefundModal} onOpenChange={(open) => !open && onClose()}>
        <DialogContent
          className="w-full sm:max-w-md h-[100vh] sm:h-auto sm:max-h-[90vh] flex flex-col bg-[var(--v2-bg)] p-0 overflow-hidden"
          dir={isRTL ? 'rtl' : 'ltr'}
        >
          {/* Sticky Header */}
          <div className="flex-shrink-0 border-b border-[var(--v2-border)] px-4 sm:px-6 py-4 sm:py-6 bg-[var(--v2-bg)]">
            <DialogHeader className="rtl:text-right">
              <DialogTitle className="flex items-center gap-2 text-lg sm:text-xl font-semibold text-[var(--v2-text-primary)]">
                <CreditCard className="h-5 w-5 text-[#8B5CF6]" />
                {t('crm.payment.manage') || 'Manage Payment'}
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

                {/* Refund - only for paid (with Stripe payment_id) */}
                {isPaid && payment.id && (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setShowRefundModal(true)}
                      disabled={loading}
                      className="w-full border-orange-500 text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-950/20"
                    >
                      <RotateCcw className="h-4 w-4 me-2" />
                      {t('crm.payment.refund') || 'Refund Payment'}
                    </Button>

                    {/* Delete booking option */}
                    <label className="flex items-start gap-3 p-4 rounded-lg bg-[var(--v2-surface)] border border-[var(--v2-border)] cursor-pointer hover:border-[#8B5CF6]/50 transition-all">
                      <input
                        type="checkbox"
                        checked={deleteAfterRefund}
                        onChange={(e) => setDeleteAfterRefund(e.target.checked)}
                        className="h-4 w-4 rounded text-orange-600 border-gray-300 focus:ring-orange-500 mt-0.5"
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <Trash2 className="h-4 w-4 text-orange-500" />
                          <span className="text-sm font-medium text-[var(--v2-text-primary)]">
                            {t('crm.payment.delete_booking_question') || 'Also delete this booking?'}
                          </span>
                        </div>
                        <p className="text-xs text-[var(--v2-text-muted)] mt-1">
                          {t('crm.payment.delete_booking_warning') || 'This will permanently delete the booking record'}
                        </p>
                      </div>
                    </label>
                  </>
                )}

                {/* No refund available - payment has no ID */}
                {isPaid && !payment.id && (
                  <div className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-800 dark:text-amber-200">
                    <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <div>
                      <span className="font-medium">
                        {t('crm.payment.no_refund_available') || 'Refund not available'}
                      </span>
                      <p className="text-xs mt-0.5 opacity-80">
                        {t('crm.payment.no_transaction_found') || 'No payment transaction found for this booking'}
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
          </div>

          {/* Sticky Footer */}
          <div className="flex-shrink-0 flex justify-end gap-3 p-6 border-t border-[var(--v2-border)] bg-[var(--v2-bg)] [dir=rtl]:flex-row-reverse">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="px-6 border-[var(--v2-border)] text-[var(--v2-text-primary)] hover:bg-[var(--v2-surface)]"
            >
              {t('button.close') || 'Close'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Refund Modal */}
      {showRefundModal && payment.id && (
        <RefundModal
          isOpen={showRefundModal}
          onClose={() => setShowRefundModal(false)}
          transactionId={payment.id}
          originalAmount={payment.amount}
          currency={payment.currency}
          contactName={contactName}
          onSuccess={handleRefundSuccess}
          onError={handleRefundError}
        />
      )}
    </>
  );
}
