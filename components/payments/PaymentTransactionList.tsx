'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { createLogger } from '@/lib/logger';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { CreditCard } from 'lucide-react';

const logger = createLogger({ module: 'PaymentTransactionList' });

interface PaymentTransaction {
  id: string;
  contact_id: string | null;
  amount: number;
  currency: string;
  status: 'pending' | 'succeeded' | 'failed' | 'refunded';
  payment_method: string | null;
  description: string | null;
  paid_at: string | null;
  created_at: string;
}

interface PaymentTransactionListProps {
  searchQuery?: string;
}

export function PaymentTransactionList({ searchQuery = '' }: PaymentTransactionListProps) {
  const { t, isRTL, language, formatCurrency } = useLanguage();
  const [transactions, setTransactions] = useState<PaymentTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'succeeded' | 'pending' | 'failed'>('all');

  useEffect(() => {
    fetchTransactions();
  }, [filter]);

  // Filter transactions by search query
  const filteredTransactions = transactions.filter((transaction) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      transaction.description?.toLowerCase().includes(query) ||
      transaction.amount.toString().includes(query) ||
      transaction.status.toLowerCase().includes(query)
    );
  });

  const fetchTransactions = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (filter !== 'all') params.set('status', filter);

      const response = await fetch(`/api/payments/transactions?${params}`);
      const result = await response.json();

      if (result.success) {
        setTransactions(result.data || []);
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch transactions');
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: PaymentTransaction['status']) => {
    const styles = {
      succeeded: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 border-green-200 dark:border-green-800',
      pending: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800',
      failed: 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 border-red-200 dark:border-red-800',
      refunded: 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-300 border-gray-200 dark:border-gray-700',
    };

    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${styles[status]}`}>
        {t(`payments.status.${status}`)}
      </span>
    );
  };

  const formatAmount = (amount: number, currency: string) => {
    const locale = language === 'he' ? 'he-IL' : language === 'es' ? 'es-ES' : 'en-US';
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency || 'USD',
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    const locale = language === 'he' ? 'he-IL' : language === 'es' ? 'es-ES' : 'en-US';
    return new Date(dateString).toLocaleDateString(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="border border-[var(--v2-border)] p-4 animate-pulse" style={{ borderRadius: 'var(--v2-radius-card)' }}>
            <div className="h-6 bg-[var(--v2-border)] rounded w-1/4 mb-2"></div>
            <div className="h-4 bg-[var(--v2-border)] rounded w-1/2"></div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Filter Buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium text-[var(--v2-text-secondary)]">{t('payments.filter')}:</span>
        <div className="flex gap-2 flex-wrap">
          {(['all', 'succeeded', 'pending', 'failed'] as const).map((filterOption) => (
            <button
              key={filterOption}
              onClick={() => setFilter(filterOption)}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                filter === filterOption
                  ? 'bg-[#F59E0B]/20 text-[#D97706] dark:text-[#F59E0B] border border-[#F59E0B]/30'
                  : 'bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] border border-[var(--v2-border)] hover:bg-[var(--v2-border)]'
              }`}
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              {t(`payments.filter.${filterOption}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Transactions List */}
      {filteredTransactions.length === 0 ? (
        <div className="text-center py-12">
          <CreditCard className="mx-auto h-12 w-12 text-[var(--v2-text-muted)]" />
          <h3 className="mt-2 text-sm font-medium text-[var(--v2-text-primary)]">{t('payments.no_transactions')}</h3>
          <p className="mt-1 text-sm text-[var(--v2-text-secondary)]">
            {filter === 'all' ? t('payments.no_transactions_desc') : t('payments.no_filtered_transactions').replace('{status}', t(`payments.filter.${filter}`))}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredTransactions.map((transaction) => (
            <div
              key={transaction.id}
              className="border border-[var(--v2-border)] p-4 hover:border-[#F59E0B]/50 transition-colors bg-[var(--v2-surface)]"
              style={{ borderRadius: 'var(--v2-radius-card)' }}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">
                      {formatAmount(transaction.amount, transaction.currency)}
                    </h3>
                    {getStatusBadge(transaction.status)}
                  </div>
                  {transaction.description && (
                    <p className="text-sm text-[var(--v2-text-secondary)] mt-1">{transaction.description}</p>
                  )}
                  <div className="flex items-center gap-4 mt-2 text-xs text-[var(--v2-text-muted)] flex-wrap">
                    <span>{t('payments.created')}: {formatDate(transaction.created_at)}</span>
                    {transaction.paid_at && (
                      <span>{t('payments.paid')}: {formatDate(transaction.paid_at)}</span>
                    )}
                    {transaction.payment_method && (
                      <span className="capitalize">{transaction.payment_method}</span>
                    )}
                  </div>
                </div>
                <Button variant="outline" size="sm">
                  {t('payments.view_details')}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
