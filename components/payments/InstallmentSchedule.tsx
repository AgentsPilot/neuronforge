'use client';

/**
 * InstallmentSchedule
 *
 * Displays installment timeline with status badges and actions
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Check, Clock, AlertCircle, CreditCard, Loader2,
  Calendar, DollarSign, MoreVertical, RefreshCw
} from 'lucide-react';
import { ManualPaymentModal } from './ManualPaymentModal';
import { PaymentCheckoutButton } from './PaymentCheckoutButton';

interface Installment {
  id: string;
  installment_number: number;
  amount: number;
  currency: string;
  due_date: string;
  status: 'pending' | 'paid' | 'overdue' | 'cancelled';
  paid_at?: string | null;
  payment_method?: string | null;
  transaction_id?: string | null;
}

interface InstallmentScheduleProps {
  installments: Installment[];
  planName?: string;
  contactName?: string;
  onRefresh?: () => void;
  onPaymentSuccess?: () => void;
  readOnly?: boolean;
}

const STATUS_CONFIG = {
  pending: {
    icon: Clock,
    label: 'Pending',
    color: 'text-yellow-600 bg-yellow-50 dark:bg-yellow-900/20 dark:text-yellow-400'
  },
  paid: {
    icon: Check,
    label: 'Paid',
    color: 'text-green-600 bg-green-50 dark:bg-green-900/20 dark:text-green-400'
  },
  overdue: {
    icon: AlertCircle,
    label: 'Overdue',
    color: 'text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400'
  },
  cancelled: {
    icon: AlertCircle,
    label: 'Cancelled',
    color: 'text-gray-500 bg-gray-100 dark:bg-gray-800 dark:text-gray-400'
  }
};

export function InstallmentSchedule({
  installments,
  planName,
  contactName,
  onRefresh,
  onPaymentSuccess,
  readOnly = false
}: InstallmentScheduleProps) {
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [showManualPayment, setShowManualPayment] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency
    }).format(amount);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const isOverdue = (dueDate: string, status: string) => {
    if (status === 'paid' || status === 'cancelled') return false;
    return new Date(dueDate) < new Date();
  };

  const getDaysUntilDue = (dueDate: string) => {
    const due = new Date(dueDate);
    const now = new Date();
    const diffTime = due.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const handleMarkPaid = async (installmentId: string) => {
    setProcessingId(installmentId);
    setError(null);

    try {
      const response = await fetch(`/api/payments/installments/${installmentId}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_method: 'manual' })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to mark as paid');
      }

      onPaymentSuccess?.();
      onRefresh?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process');
    } finally {
      setProcessingId(null);
    }
  };

  // Calculate summary
  const totalAmount = installments.reduce((sum, i) => sum + i.amount, 0);
  const paidAmount = installments
    .filter(i => i.status === 'paid')
    .reduce((sum, i) => sum + i.amount, 0);
  const pendingCount = installments.filter(i => i.status === 'pending').length;
  const overdueCount = installments.filter(i => i.status === 'overdue' || isOverdue(i.due_date, i.status)).length;
  const currency = installments[0]?.currency || 'USD';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          {planName && (
            <h3 className="font-semibold">{planName}</h3>
          )}
          {contactName && (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Contact: {contactName}
            </p>
          )}
        </div>
        {onRefresh && (
          <Button variant="outline" size="sm" onClick={onRefresh}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        )}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-800">
          <div className="text-xs text-gray-500 dark:text-gray-400">Total</div>
          <div className="text-lg font-semibold">
            {formatCurrency(totalAmount, currency)}
          </div>
        </div>
        <div className="rounded-lg bg-green-50 p-3 dark:bg-green-900/20">
          <div className="text-xs text-green-600 dark:text-green-400">Paid</div>
          <div className="text-lg font-semibold text-green-700 dark:text-green-300">
            {formatCurrency(paidAmount, currency)}
          </div>
        </div>
        <div className={`rounded-lg p-3 ${overdueCount > 0 ? 'bg-red-50 dark:bg-red-900/20' : 'bg-blue-50 dark:bg-blue-900/20'}`}>
          <div className={`text-xs ${overdueCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400'}`}>
            {overdueCount > 0 ? 'Overdue' : 'Remaining'}
          </div>
          <div className={`text-lg font-semibold ${overdueCount > 0 ? 'text-red-700 dark:text-red-300' : 'text-blue-700 dark:text-blue-300'}`}>
            {formatCurrency(totalAmount - paidAmount, currency)}
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Timeline */}
      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-200 dark:bg-gray-700" />

        <div className="space-y-4">
          {installments.map((installment, index) => {
            const effectiveStatus = isOverdue(installment.due_date, installment.status)
              ? 'overdue'
              : installment.status;
            const config = STATUS_CONFIG[effectiveStatus];
            const StatusIcon = config.icon;
            const daysUntilDue = getDaysUntilDue(installment.due_date);

            return (
              <div key={installment.id} className="relative flex gap-4 pl-8">
                {/* Status dot */}
                <div className={`absolute left-2 flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full ${config.color}`}>
                  <StatusIcon className="h-3 w-3" />
                </div>

                {/* Content */}
                <div className={`flex-1 rounded-lg border p-4 ${
                  effectiveStatus === 'overdue'
                    ? 'border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-900/10'
                    : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'
                }`}>
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          Payment {installment.installment_number}
                        </span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${config.color}`}>
                          {config.label}
                        </span>
                      </div>

                      <div className="mt-1 flex flex-wrap gap-3 text-sm text-gray-500 dark:text-gray-400">
                        <span className="flex items-center gap-1">
                          <DollarSign className="h-3.5 w-3.5" />
                          {formatCurrency(installment.amount, installment.currency)}
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3.5 w-3.5" />
                          {installment.status === 'paid' && installment.paid_at
                            ? `Paid ${formatDate(installment.paid_at)}`
                            : `Due ${formatDate(installment.due_date)}`
                          }
                        </span>
                        {installment.status !== 'paid' && daysUntilDue >= 0 && daysUntilDue <= 7 && (
                          <span className="text-yellow-600 dark:text-yellow-400">
                            {daysUntilDue === 0 ? 'Due today' : `${daysUntilDue} days left`}
                          </span>
                        )}
                        {effectiveStatus === 'overdue' && (
                          <span className="text-red-600 dark:text-red-400">
                            {Math.abs(daysUntilDue)} days overdue
                          </span>
                        )}
                      </div>

                      {installment.payment_method && installment.status === 'paid' && (
                        <div className="mt-1 text-xs text-gray-400">
                          via {installment.payment_method}
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    {!readOnly && installment.status !== 'paid' && installment.status !== 'cancelled' && (
                      <div className="flex gap-2">
                        <PaymentCheckoutButton
                          installmentId={installment.id}
                          amount={installment.amount}
                          currency={installment.currency}
                          onSuccess={() => {
                            onPaymentSuccess?.();
                            onRefresh?.();
                          }}
                          onError={setError}
                          size="sm"
                          variant="default"
                        >
                          <CreditCard className="mr-1 h-3 w-3" />
                          Pay
                        </PaymentCheckoutButton>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setShowManualPayment(installment.id)}
                        >
                          Record Manual
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Manual Payment Modal */}
      {showManualPayment && (
        <ManualPaymentModal
          isOpen={true}
          onClose={() => setShowManualPayment(null)}
          installmentId={showManualPayment}
          defaultAmount={installments.find(i => i.id === showManualPayment)?.amount}
          defaultCurrency={installments.find(i => i.id === showManualPayment)?.currency}
          onSuccess={() => {
            setShowManualPayment(null);
            onPaymentSuccess?.();
            onRefresh?.();
          }}
          onError={setError}
        />
      )}
    </div>
  );
}
