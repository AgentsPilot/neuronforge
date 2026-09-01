'use client';

/**
 * RefundModal
 *
 * Modal for processing full or partial refunds.
 * Optionally supports deleting the associated booking after refund (for CRM drawer).
 */

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { X, Loader2, AlertTriangle, RotateCcw, Trash2 } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';

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
  isRTL = false
}: RefundModalProps) {
  const { t, language } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [refundType, setRefundType] = useState<'full' | 'partial'>('full');
  const [partialAmount, setPartialAmount] = useState('');
  const [reason, setReason] = useState('');
  const [notifyContact, setNotifyContact] = useState(true);
  const [deleteBooking, setDeleteBooking] = useState(false);

  /**
   * One id per opening of this modal, so a double click, a retry after a
   * timeout, and React's development double-invoke all carry the SAME value and
   * produce one refund. A ref rather than state: regenerating it on re-render
   * would defeat the entire point.
   */
  const requestId = useRef<string>('');
  if (isOpen && !requestId.current) {
    requestId.current =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `refund-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  useEffect(() => {
    // A new intent next time this opens.
    if (!isOpen) requestId.current = '';
  }, [isOpen]);

  if (!isOpen) return null;

  const maxRefundable = originalAmount - alreadyRefunded;
  const refundAmount = refundType === 'full' ? maxRefundable : parseFloat(partialAmount) || 0;

  const formatCurrency = (amount: number) => {
    const locale = language === 'he' ? 'he-IL' : language === 'es' ? 'es-ES' : 'en-US';
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency
    }).format(amount);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (refundType === 'partial' && (refundAmount <= 0 || refundAmount > maxRefundable)) {
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
          amount: refundType === 'partial' ? refundAmount : undefined,
          reason: reason || undefined,
          client_request_id: requestId.current
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to process refund');
      }

      onSuccess?.(deleteBooking);
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to process refund';
      onError?.(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-0 sm:p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className="relative z-10 w-full sm:max-w-md h-full sm:h-auto max-h-full rounded-none sm:rounded-lg bg-[var(--v2-bg,#fff)] dark:bg-[var(--v2-bg,#1a1a1a)] px-4 sm:px-6 py-4 sm:py-6 shadow-xl overflow-y-auto"
        dir={isRTL ? 'rtl' : 'ltr'}
      >
        {/* Header */}
        <div className="mb-4 sm:mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <RotateCcw className="h-4 w-4 sm:h-5 sm:w-5 text-orange-500" />
            <h2 className="text-base sm:text-lg font-semibold">{t('payments.refund.title')}</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Transaction Info */}
        <div className="mb-4 sm:mb-6 rounded-lg bg-gray-50 p-3 sm:p-4 dark:bg-gray-800">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 text-xs sm:text-sm">
            <div>
              <span className="text-gray-500 dark:text-gray-400">{t('payments.refund.original_amount')}</span>
              <p className="font-semibold">{formatCurrency(originalAmount)}</p>
            </div>
            {alreadyRefunded > 0 && (
              <div>
                <span className="text-gray-500 dark:text-gray-400">{t('payments.refund.already_refunded')}</span>
                <p className="font-semibold text-orange-600">{formatCurrency(alreadyRefunded)}</p>
              </div>
            )}
            <div>
              <span className="text-gray-500 dark:text-gray-400">{t('payments.refund.refundable')}</span>
              <p className="font-semibold text-green-600">{formatCurrency(maxRefundable)}</p>
            </div>
            {contactName && (
              <div>
                <span className="text-gray-500 dark:text-gray-400">{t('payments.refund.contact')}</span>
                <p className="font-semibold">{contactName}</p>
              </div>
            )}
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-4">
          {/* Refund Type */}
          <div>
            <label className="mb-1.5 sm:mb-2 block text-xs sm:text-sm font-medium">{t('payments.refund.type_label')}</label>
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-4">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="refundType"
                  value="full"
                  checked={refundType === 'full'}
                  onChange={() => setRefundType('full')}
                  className="h-4 w-4 text-blue-600"
                />
                <span>{t('payments.refund.full_with_amount').replace('{amount}', formatCurrency(maxRefundable))}</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="refundType"
                  value="partial"
                  checked={refundType === 'partial'}
                  onChange={() => setRefundType('partial')}
                  className="h-4 w-4 text-blue-600"
                />
                <span>{t('payments.refund.partial')}</span>
              </label>
            </div>
          </div>

          {/* Partial Amount */}
          {refundType === 'partial' && (
            <div>
              <label className="mb-1 sm:mb-1.5 block text-xs sm:text-sm font-medium">{t('payments.refund.amount_label')}</label>
              <div className="flex items-center gap-2">
                <span className="text-gray-500">{currency}</span>
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={maxRefundable}
                  value={partialAmount}
                  onChange={(e) => setPartialAmount(e.target.value)}
                  placeholder={t('payments.refund.amount_placeholder')}
                  required
                />
              </div>
              <p className="mt-1 text-xs text-gray-500">
                {t('payments.refund.max_info').replace('{amount}', formatCurrency(maxRefundable))}
              </p>
            </div>
          )}

          {/* Reason */}
          <div>
            <label className="mb-1 sm:mb-1.5 block text-xs sm:text-sm font-medium">{t('payments.refund.reason_label')}</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('payments.refund.reason_placeholder')}
              className="w-full rounded-md border border-gray-300 p-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800"
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
                className="h-4 w-4 rounded text-blue-600"
              />
              <span className="text-sm">{t('payments.refund.notify_contact')}</span>
            </label>
          </div>

          {/* Delete Booking Toggle - only shown when called from CRM drawer */}
          {showDeleteBookingOption && refundType === 'full' && (
            <div className="flex items-center justify-between p-3 rounded-lg bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <Trash2 className="h-4 w-4 text-orange-500 flex-shrink-0" />
                <div className="min-w-0">
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {t('payments.refund.delete_booking_label')}
                  </span>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {t('payments.refund.delete_booking_desc')}
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
          <div className="flex items-start gap-2 rounded-lg bg-yellow-50 p-3 text-sm text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <p>
              {t('payments.refund.warning_full').replace('{amount}', formatCurrency(refundAmount))}
            </p>
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row justify-end gap-2 sm:gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={loading}
            >
              {t('payments.refund.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={loading || (refundType === 'partial' && refundAmount <= 0)}
              className="bg-orange-600 hover:bg-orange-700"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('payments.refund.processing')}
                </>
              ) : (
                <>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  {t('payments.refund.submit_button').replace('{amount}', formatCurrency(refundAmount))}
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
