'use client';

/**
 * RefundModal
 *
 * Modal for processing full or partial refunds
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { X, Loader2, AlertTriangle, RotateCcw } from 'lucide-react';

interface RefundModalProps {
  isOpen: boolean;
  onClose: () => void;
  transactionId: string;
  originalAmount: number;
  currency: string;
  alreadyRefunded?: number;
  contactName?: string;
  onSuccess?: () => void;
  onError?: (error: string) => void;
}

export function RefundModal({
  isOpen,
  onClose,
  transactionId,
  originalAmount,
  currency,
  alreadyRefunded = 0,
  contactName,
  onSuccess,
  onError
}: RefundModalProps) {
  const [loading, setLoading] = useState(false);
  const [refundType, setRefundType] = useState<'full' | 'partial'>('full');
  const [partialAmount, setPartialAmount] = useState('');
  const [reason, setReason] = useState('');
  const [notifyContact, setNotifyContact] = useState(true);

  if (!isOpen) return null;

  const maxRefundable = originalAmount - alreadyRefunded;
  const refundAmount = refundType === 'full' ? maxRefundable : parseFloat(partialAmount) || 0;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency
    }).format(amount);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (refundType === 'partial' && (refundAmount <= 0 || refundAmount > maxRefundable)) {
      onError?.(`Please enter a valid amount between 0 and ${formatCurrency(maxRefundable)}`);
      return;
    }

    setLoading(true);

    try {
      const blockId = refundType === 'full' ? 'refund_full' : 'refund_partial';
      const parameters: Record<string, unknown> = {
        transaction_id: transactionId,
        reason: reason || undefined,
        notify_contact: notifyContact
      };

      if (refundType === 'partial') {
        parameters.amount = refundAmount;
      }

      const response = await fetch('/api/payments/blocks/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          block_id: blockId,
          parameters
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to process refund');
      }

      onSuccess?.();
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to process refund';
      onError?.(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-gray-900">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <RotateCcw className="h-5 w-5 text-orange-500" />
            <h2 className="text-lg font-semibold">Process Refund</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Transaction Info */}
        <div className="mb-6 rounded-lg bg-gray-50 p-4 dark:bg-gray-800">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-500 dark:text-gray-400">Original Amount</span>
              <p className="font-semibold">{formatCurrency(originalAmount)}</p>
            </div>
            {alreadyRefunded > 0 && (
              <div>
                <span className="text-gray-500 dark:text-gray-400">Already Refunded</span>
                <p className="font-semibold text-orange-600">{formatCurrency(alreadyRefunded)}</p>
              </div>
            )}
            <div>
              <span className="text-gray-500 dark:text-gray-400">Refundable</span>
              <p className="font-semibold text-green-600">{formatCurrency(maxRefundable)}</p>
            </div>
            {contactName && (
              <div>
                <span className="text-gray-500 dark:text-gray-400">Contact</span>
                <p className="font-semibold">{contactName}</p>
              </div>
            )}
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Refund Type */}
          <div>
            <label className="mb-2 block text-sm font-medium">Refund Type</label>
            <div className="flex gap-4">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="refundType"
                  value="full"
                  checked={refundType === 'full'}
                  onChange={() => setRefundType('full')}
                  className="h-4 w-4 text-blue-600"
                />
                <span>Full Refund ({formatCurrency(maxRefundable)})</span>
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
                <span>Partial Refund</span>
              </label>
            </div>
          </div>

          {/* Partial Amount */}
          {refundType === 'partial' && (
            <div>
              <label className="mb-1 block text-sm font-medium">Refund Amount</label>
              <div className="flex items-center gap-2">
                <span className="text-gray-500">{currency}</span>
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={maxRefundable}
                  value={partialAmount}
                  onChange={(e) => setPartialAmount(e.target.value)}
                  placeholder="0.00"
                  required
                />
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Maximum: {formatCurrency(maxRefundable)}
              </p>
            </div>
          )}

          {/* Reason */}
          <div>
            <label className="mb-1 block text-sm font-medium">Reason (optional)</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason for refund..."
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
              <span className="text-sm">Send notification to contact</span>
            </label>
          </div>

          {/* Warning */}
          <div className="flex items-start gap-2 rounded-lg bg-yellow-50 p-3 text-sm text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <p>
              Refunds cannot be undone. The {formatCurrency(refundAmount)} will be returned to the original payment method.
            </p>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading || (refundType === 'partial' && refundAmount <= 0)}
              className="bg-orange-600 hover:bg-orange-700"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Refund {formatCurrency(refundAmount)}
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
