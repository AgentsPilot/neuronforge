'use client';

/**
 * ManualPaymentModal
 *
 * Modal for recording manual payments (cash, bank transfer, check, etc.)
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X, Loader2, Banknote, CreditCard, Building2, HelpCircle } from 'lucide-react';

interface ManualPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoiceId?: string;
  bookingId?: string;
  installmentId?: string;
  contactId?: string;
  defaultAmount?: number;
  defaultCurrency?: string;
  onSuccess?: () => void;
  onError?: (error: string) => void;
}

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash', icon: Banknote },
  { value: 'bank_transfer', label: 'Bank Transfer', icon: Building2 },
  { value: 'check', label: 'Check', icon: CreditCard },
  { value: 'other', label: 'Other', icon: HelpCircle }
];

const CURRENCIES = ['USD', 'EUR', 'GBP', 'ILS', 'CAD', 'AUD'];

export function ManualPaymentModal({
  isOpen,
  onClose,
  invoiceId,
  bookingId,
  installmentId,
  contactId,
  defaultAmount,
  defaultCurrency = 'USD',
  onSuccess,
  onError
}: ManualPaymentModalProps) {
  const [loading, setLoading] = useState(false);
  const [amount, setAmount] = useState(defaultAmount?.toString() || '');
  const [currency, setCurrency] = useState(defaultCurrency);
  const [method, setMethod] = useState<string>('cash');
  const [notes, setNotes] = useState('');
  const [receivedAt, setReceivedAt] = useState(new Date().toISOString().split('T')[0]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!amount || parseFloat(amount) <= 0) {
      onError?.('Please enter a valid amount');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('/api/payments/blocks/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          block_id: 'record_manual_payment',
          parameters: {
            invoice_id: invoiceId,
            booking_id: bookingId,
            installment_id: installmentId,
            contact_id: contactId,
            amount: parseFloat(amount),
            currency,
            method,
            notes: notes || undefined,
            received_at: receivedAt ? new Date(receivedAt).toISOString() : undefined
          }
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to record payment');
      }

      onSuccess?.();
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to record payment';
      onError?.(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative z-10 w-full sm:max-w-md h-full sm:h-auto rounded-none sm:rounded-lg bg-white px-4 sm:px-6 py-4 sm:py-6 shadow-xl dark:bg-gray-900 overflow-y-auto">
        {/* Header */}
        <div className="mb-4 sm:mb-6 flex items-center justify-between">
          <h2 className="text-base sm:text-lg font-semibold">Record Manual Payment</h2>
          <button
            onClick={onClose}
            className="rounded-full p-1 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-4">
          {/* Amount and Currency */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <label className="mb-1 sm:mb-1.5 block text-xs sm:text-sm font-medium">Amount</label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                required
              />
            </div>
            <div className="w-full sm:w-28">
              <label className="mb-1 sm:mb-1.5 block text-xs sm:text-sm font-medium">Currency</label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((curr) => (
                    <SelectItem key={curr} value={curr}>
                      {curr}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Payment Method */}
          <div>
            <label className="mb-1 sm:mb-1.5 block text-xs sm:text-sm font-medium">Payment Method</label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((pm) => {
                  const Icon = pm.icon;
                  return (
                    <SelectItem key={pm.value} value={pm.value}>
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4" />
                        {pm.label}
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {/* Received Date */}
          <div>
            <label className="mb-1 sm:mb-1.5 block text-xs sm:text-sm font-medium">Date Received</label>
            <Input
              type="date"
              value={receivedAt}
              onChange={(e) => setReceivedAt(e.target.value)}
            />
          </div>

          {/* Notes */}
          <div>
            <label className="mb-1 sm:mb-1.5 block text-xs sm:text-sm font-medium">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any notes about this payment..."
              className="w-full rounded-md border border-gray-300 p-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800"
              rows={3}
            />
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row justify-end gap-2 sm:gap-3 pt-2 sm:pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Recording...
                </>
              ) : (
                'Record Payment'
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
