'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { createLogger } from '@/lib/logger';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { RefundModal } from './RefundModal';
import {
  Loader2, RotateCcw, Copy, Check, Wallet, Search, ChevronDown, ChevronRight,
  ArrowUpDown, ArrowUp, ArrowDown, Download, X, ChevronLeft
} from 'lucide-react';

const logger = createLogger({ module: 'PaymentTransactionList' });

interface ContactInfo {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}

interface PaymentTransaction {
  id: string;
  contact_id: string | null;
  contact?: ContactInfo | null;
  amount: number;
  currency: string;
  status: 'pending' | 'succeeded' | 'failed' | 'refunded';
  payment_method: string | null;
  description: string | null;
  paid_at: string | null;
  created_at: string;
  stripe_payment_intent_id?: string | null;
  stripe_charge_id?: string | null;
  metadata?: Record<string, unknown>;
  // Refund fields
  refund_status?: 'none' | 'partial' | 'full' | null;
  refunded_amount?: number;
  refunded_at?: string | null;
  refund_reason?: string | null;
  // Service information (enriched from metadata)
  service_id?: string;
  service_name?: string;
  // Payment plan installment information (enriched from payment_plan_installments)
  installment_number?: number;
  installment_total?: number;
  payment_plan_name?: string;
}

interface TransactionStats {
  succeeded: { count: number; total: number };
  pending: { count: number; total: number };
  failed: { count: number; total: number };
  refunded: { count: number; total: number };
  all: { count: number; total: number };
}

interface PaymentTransactionListProps {
  searchQuery?: string;
  hideInternalSearch?: boolean;
  highlightId?: string | null;
}

const PAGE_SIZE = 10;

const STATUS_COLORS: Record<string, string> = {
  succeeded: 'bg-green-500/20 text-green-600 dark:text-green-400',
  pending: 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400',
  failed: 'bg-red-500/20 text-red-600 dark:text-red-400',
  refunded: 'bg-gray-500/20 text-gray-600 dark:text-gray-400',
  partial_refund: 'bg-orange-500/20 text-orange-600 dark:text-orange-400'
};

export function PaymentTransactionList({ searchQuery: externalSearchQuery = '', hideInternalSearch = false, highlightId }: PaymentTransactionListProps) {
  const { t, isRTL, language } = useLanguage();
  const [transactions, setTransactions] = useState<PaymentTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'succeeded' | 'pending' | 'failed' | 'refunded'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [stats, setStats] = useState<TransactionStats | null>(null);

  // Sorting state
  type SortField = 'amount' | 'status' | 'date' | 'client';
  type SortDirection = 'asc' | 'desc';
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Refund modal state
  const [refundModalOpen, setRefundModalOpen] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<PaymentTransaction | null>(null);

  // Multi-select state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const fetchTransactions = useCallback(async (pageNum: number, fetchStats: boolean = false) => {
    try {
      setLoading(true);

      const params = new URLSearchParams();
      if (filter !== 'all') params.set('status', filter);
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(pageNum * PAGE_SIZE));
      if (fetchStats) params.set('include_stats', 'true');

      const response = await fetch(`/api/payments/transactions?${params}`);
      const result = await response.json();

      if (result.success) {
        const newData = result.data || [];
        setTransactions(newData);
        setHasMore(newData.length === PAGE_SIZE);
        if (result.total !== undefined) {
          setTotalCount(result.total);
        }
        if (result.stats) {
          setStats(result.stats);
        }
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch transactions');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    setPage(0);
    // Fetch stats on initial load
    fetchTransactions(0, !stats);
  }, [filter, fetchTransactions]);

  // Scroll to highlighted transaction
  useEffect(() => {
    if (highlightId && !loading) {
      const element = document.getElementById(`transaction-${highlightId}`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [highlightId, loading, transactions]);

  // Get contact display name
  const getContactName = (contact: ContactInfo | null | undefined): string => {
    if (!contact) return '';
    const firstName = contact.first_name || '';
    const lastName = contact.last_name || '';
    return `${firstName} ${lastName}`.trim();
  };

  // Combine external and internal search
  const effectiveSearchQuery = externalSearchQuery || searchQuery;

  // Filter transactions by search query (client-side for already loaded)
  const filteredTransactions = transactions.filter((transaction) => {
    if (!effectiveSearchQuery) return true;
    const query = effectiveSearchQuery.toLowerCase();
    const contactName = getContactName(transaction.contact)?.toLowerCase() || '';
    return (
      transaction.description?.toLowerCase().includes(query) ||
      transaction.amount.toString().includes(query) ||
      transaction.status.toLowerCase().includes(query) ||
      contactName.includes(query) ||
      transaction.contact?.email?.toLowerCase().includes(query)
    );
  });

  // Sort transactions
  const sortedTransactions = [...filteredTransactions].sort((a, b) => {
    let comparison = 0;

    switch (sortField) {
      case 'amount':
        comparison = a.amount - b.amount;
        break;
      case 'status':
        comparison = a.status.localeCompare(b.status);
        break;
      case 'date':
        const dateA = new Date(a.paid_at || a.created_at).getTime();
        const dateB = new Date(b.paid_at || b.created_at).getTime();
        comparison = dateA - dateB;
        break;
      case 'client':
        const nameA = getContactName(a.contact) || '';
        const nameB = getContactName(b.contact) || '';
        comparison = nameA.localeCompare(nameB);
        break;
    }

    return sortDirection === 'asc' ? comparison : -comparison;
  });

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="h-3 w-3 ms-1 opacity-50" />;
    }
    return sortDirection === 'asc'
      ? <ArrowUp className="h-3 w-3 ms-1" />
      : <ArrowDown className="h-3 w-3 ms-1" />;
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
    });
  };

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      logger.error({ err }, 'Failed to copy to clipboard');
    }
  };

  const handleRefundClick = (transaction: PaymentTransaction, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedTransaction(transaction);
    setRefundModalOpen(true);
  };

  const handleRefundSuccess = () => {
    setPage(0);
    fetchTransactions(0);
  };

  const handleRefundError = (error: string) => {
    logger.error({ error }, 'Refund failed');
  };

  const toggleRowExpanded = (id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Multi-select functions
  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === sortedTransactions.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sortedTransactions.map(t => t.id)));
    }
  };

  const handleExportToExcel = () => {
    const selectedTransactions = sortedTransactions.filter(t => selectedIds.has(t.id));
    if (selectedTransactions.length === 0) return;

    const headers = [
      t('payments.export.date') || 'Date',
      t('payments.export.client') || 'Client',
      t('payments.export.email') || 'Email',
      t('payments.export.amount') || 'Amount',
      t('payments.export.currency') || 'Currency',
      t('payments.export.status') || 'Status',
      t('payments.export.payment_method') || 'Payment Method',
      t('payments.export.description') || 'Description',
      t('payments.export.refund_status') || 'Refund Status',
      t('payments.export.refunded_amount') || 'Refunded Amount',
      t('payments.export.transaction_id') || 'Transaction ID'
    ];

    const rows = selectedTransactions.map(transaction => {
      const hasRefund = transaction.refund_status === 'partial' || transaction.refund_status === 'full';
      return [
        transaction.paid_at || transaction.created_at ? new Date(transaction.paid_at || transaction.created_at).toLocaleDateString() : '',
        getContactName(transaction.contact) || '-',
        transaction.contact?.email || '-',
        transaction.amount.toFixed(2),
        transaction.currency,
        t(`payments.status.${transaction.status}`) || transaction.status,
        transaction.payment_method ? (t(`payments.payment_method.${transaction.payment_method}`) || transaction.payment_method) : '-',
        transaction.description || '-',
        hasRefund ? (t(`payments.refund_status.${transaction.refund_status}`) || transaction.refund_status) : '-',
        transaction.refunded_amount ? transaction.refunded_amount.toFixed(2) : '-',
        transaction.stripe_payment_intent_id || transaction.stripe_charge_id || transaction.id
      ];
    });

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    // Add BOM for Excel UTF-8 compatibility
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `payments_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);

    setSelectedIds(new Set());
  };

  const selectedCount = selectedIds.size;

  const formatDateTime = (dateString: string) => {
    const locale = language === 'he' ? 'he-IL' : language === 'es' ? 'es-ES' : 'en-US';
    return new Date(dateString).toLocaleString(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Translate description - handles "Booking: ServiceName" pattern
  const translateDescription = (description: string | null): string | null => {
    if (!description) return null;

    const bookingMatch = description.match(/^Booking: (.+)$/);
    if (bookingMatch) {
      const bookingTranslated = t('crm.activity.title.booking');
      if (bookingTranslated !== 'crm.activity.title.booking') {
        return `${bookingTranslated}: ${bookingMatch[1]}`;
      }
    }

    return description;
  };

  // Loading skeleton for table
  const TableSkeleton = () => (
    <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] overflow-hidden animate-pulse" style={{ borderRadius: 'var(--v2-radius-card)' }}>
      <div className="h-12 bg-[var(--v2-bg)] border-b border-[var(--v2-border)]" />
      {[1, 2, 3, 4, 5].map(i => (
        <div key={i} className="h-16 border-b border-[var(--v2-border)] flex items-center px-4 gap-4">
          <div className="h-4 bg-[var(--v2-border)] rounded w-24" />
          <div className="h-4 bg-[var(--v2-border)] rounded w-32" />
          <div className="h-6 bg-[var(--v2-border)] rounded-full w-20" />
          <div className="h-4 bg-[var(--v2-border)] rounded w-28" />
          <div className="h-4 bg-[var(--v2-border)] rounded w-20 ms-auto" />
        </div>
      ))}
    </div>
  );

  if (loading) {
    return (
      <div className="space-y-4" dir={isRTL ? 'rtl' : 'ltr'}>
        {/* Search & Filter skeleton */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="h-10 bg-[var(--v2-border)] rounded w-64 animate-pulse" />
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="h-8 bg-[var(--v2-border)] rounded w-20 animate-pulse" />
            ))}
          </div>
        </div>
        <TableSkeleton />
      </div>
    );
  }

  // Hide internal search when parent provides search in page header
  const showInternalSearch = !hideInternalSearch;

  // Format currency for stats
  const formatStatAmount = (amount: number) => {
    const locale = language === 'he' ? 'he-IL' : language === 'es' ? 'es-ES' : 'en-US';
    // Default to ILS for Hebrew, USD otherwise
    const currency = language === 'he' ? 'ILS' : 'USD';
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <div className="space-y-4" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Stats Summary Bar - Modern Design */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Succeeded */}
          <button
            onClick={() => setFilter(filter === 'succeeded' ? 'all' : 'succeeded')}
            className={`relative p-4 bg-[var(--v2-surface)] border-2 transition-all duration-200 text-start group overflow-hidden ${
              filter === 'succeeded'
                ? 'border-emerald-400 dark:border-emerald-500 shadow-md'
                : 'border-transparent hover:border-emerald-300 dark:hover:border-emerald-600'
            }`}
            style={{ borderRadius: 'var(--v2-radius-card)' }}
          >
            <div className="absolute top-0 start-0 w-1 h-full bg-emerald-500" />
            <div className="flex items-center gap-2 mb-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
                {t('payments.status.succeeded') || 'Succeeded'}
              </span>
            </div>
            <div className="text-2xl font-bold text-[var(--v2-text-primary)] mb-0.5">
              {formatStatAmount(stats.succeeded.total)}
            </div>
            <div className="text-xs text-[var(--v2-text-muted)]">
              {stats.succeeded.count} {stats.succeeded.count === 1 ? t('payments.transaction_singular') || 'transaction' : t('payments.transaction_plural') || 'transactions'}
            </div>
          </button>

          {/* Pending */}
          <button
            onClick={() => setFilter(filter === 'pending' ? 'all' : 'pending')}
            className={`relative p-4 bg-[var(--v2-surface)] border-2 transition-all duration-200 text-start group overflow-hidden ${
              filter === 'pending'
                ? 'border-yellow-400 dark:border-yellow-500 shadow-md'
                : 'border-transparent hover:border-yellow-300 dark:hover:border-yellow-600'
            }`}
            style={{ borderRadius: 'var(--v2-radius-card)' }}
          >
            <div className="absolute top-0 start-0 w-1 h-full bg-yellow-500" />
            <div className="flex items-center gap-2 mb-2">
              <div className="w-2 h-2 rounded-full bg-yellow-500" />
              <span className="text-xs font-semibold text-yellow-600 dark:text-yellow-400 uppercase tracking-wider">
                {t('payments.status.pending') || 'Pending'}
              </span>
            </div>
            <div className="text-2xl font-bold text-[var(--v2-text-primary)] mb-0.5">
              {formatStatAmount(stats.pending.total)}
            </div>
            <div className="text-xs text-[var(--v2-text-muted)]">
              {stats.pending.count} {stats.pending.count === 1 ? t('payments.transaction_singular') || 'transaction' : t('payments.transaction_plural') || 'transactions'}
            </div>
          </button>

          {/* Failed */}
          <button
            onClick={() => setFilter(filter === 'failed' ? 'all' : 'failed')}
            className={`relative p-4 bg-[var(--v2-surface)] border-2 transition-all duration-200 text-start group overflow-hidden ${
              filter === 'failed'
                ? 'border-red-400 dark:border-red-500 shadow-md'
                : 'border-transparent hover:border-red-300 dark:hover:border-red-600'
            }`}
            style={{ borderRadius: 'var(--v2-radius-card)' }}
          >
            <div className="absolute top-0 start-0 w-1 h-full bg-red-500" />
            <div className="flex items-center gap-2 mb-2">
              <div className={`w-2 h-2 rounded-full bg-red-500 ${stats.failed.count > 0 ? 'animate-pulse' : ''}`} />
              <span className="text-xs font-semibold text-red-600 dark:text-red-400 uppercase tracking-wider">
                {t('payments.status.failed') || 'Failed'}
              </span>
            </div>
            <div className="text-2xl font-bold text-[var(--v2-text-primary)] mb-0.5">
              {formatStatAmount(stats.failed.total)}
            </div>
            <div className="text-xs text-[var(--v2-text-muted)]">
              {stats.failed.count} {stats.failed.count === 1 ? t('payments.transaction_singular') || 'transaction' : t('payments.transaction_plural') || 'transactions'}
            </div>
          </button>

          {/* Refunded */}
          <button
            onClick={() => setFilter(filter === 'refunded' ? 'all' : 'refunded')}
            className={`relative p-4 bg-[var(--v2-surface)] border-2 transition-all duration-200 text-start group overflow-hidden ${
              filter === 'refunded'
                ? 'border-orange-400 dark:border-orange-500 shadow-md'
                : 'border-transparent hover:border-orange-300 dark:hover:border-orange-600'
            }`}
            style={{ borderRadius: 'var(--v2-radius-card)' }}
          >
            <div className="absolute top-0 start-0 w-1 h-full bg-orange-500" />
            <div className="flex items-center gap-2 mb-2">
              <div className="w-2 h-2 rounded-full bg-orange-500" />
              <span className="text-xs font-semibold text-orange-600 dark:text-orange-400 uppercase tracking-wider">
                {t('payments.status.refunded') || 'Refunded'}
              </span>
            </div>
            <div className="text-2xl font-bold text-[var(--v2-text-primary)] mb-0.5">
              {formatStatAmount(stats.refunded.total)}
            </div>
            <div className="text-xs text-[var(--v2-text-muted)]">
              {stats.refunded.count} {stats.refunded.count === 1 ? t('payments.transaction_singular') || 'transaction' : t('payments.transaction_plural') || 'transactions'}
            </div>
          </button>
        </div>
      )}

      {/* Active Filter Indicator */}
      {filter !== 'all' && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-[var(--v2-text-muted)]">{t('payments.showing') || 'Showing'}:</span>
          <button
            onClick={() => setFilter('all')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-[var(--v2-bg)] text-[var(--v2-text-primary)] rounded-full border border-[var(--v2-border)] hover:bg-[var(--v2-border)] transition-colors"
          >
            {t(`payments.status.${filter}`)}
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Mobile Search Bar - Only visible on mobile when no external search */}
      {showInternalSearch && (
        <div className="md:hidden relative">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--v2-text-muted)]" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('payments.search_placeholder') || 'Search transactions...'}
            className="ps-9 w-full bg-[var(--v2-surface)] border-[var(--v2-border)] focus:border-[#22C58B] focus:ring-[#22C58B]/20"
          />
        </div>
      )}

      {/* Transactions Table */}
      {sortedTransactions.length === 0 ? (
        <div className="text-center py-12 bg-[var(--v2-surface)] border border-[var(--v2-border)]" style={{ borderRadius: 'var(--v2-radius-card)' }}>
          <Wallet className="mx-auto h-12 w-12 text-[var(--v2-text-muted)]" />
          <h3 className="mt-2 text-sm font-medium text-[var(--v2-text-primary)]">{t('payments.no_transactions')}</h3>
          <p className="mt-1 text-sm text-[var(--v2-text-secondary)]">
            {filter === 'all' ? t('payments.no_transactions_desc') : t('payments.no_filtered_transactions').replace('{status}', t(`payments.filter.${filter}`))}
          </p>
        </div>
      ) : (
        <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] overflow-hidden" style={{ borderRadius: 'var(--v2-radius-card)' }}>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-[var(--v2-bg)] border-b border-[var(--v2-border)]">
                <tr>
                  <th className="px-4 py-3 text-start">
                    <input
                      type="checkbox"
                      checked={sortedTransactions.length > 0 && selectedIds.size === sortedTransactions.length}
                      onChange={toggleSelectAll}
                      className="rounded border-[var(--v2-border)] text-[#22C58B] focus:ring-[#22C58B]"
                    />
                  </th>
                  <th className="w-10 px-2 py-3"></th>
                  <th
                    className="px-4 py-3 text-start text-xs font-medium text-[var(--v2-text-muted)] uppercase tracking-wider cursor-pointer hover:text-[var(--v2-text-primary)] transition-colors"
                    onClick={() => handleSort('amount')}
                  >
                    <div className="flex items-center">
                      {t('payments.table.amount') || 'Amount'}
                      {getSortIcon('amount')}
                    </div>
                  </th>
                  <th
                    className="px-4 py-3 text-start text-xs font-medium text-[var(--v2-text-muted)] uppercase tracking-wider cursor-pointer hover:text-[var(--v2-text-primary)] transition-colors"
                    onClick={() => handleSort('status')}
                  >
                    <div className="flex items-center">
                      {t('payments.table.status') || 'Status'}
                      {getSortIcon('status')}
                    </div>
                  </th>
                  <th
                    className="px-4 py-3 text-start text-xs font-medium text-[var(--v2-text-muted)] uppercase tracking-wider cursor-pointer hover:text-[var(--v2-text-primary)] transition-colors"
                    onClick={() => handleSort('client')}
                  >
                    <div className="flex items-center">
                      {t('payments.client') || 'Client'}
                      {getSortIcon('client')}
                    </div>
                  </th>
                  <th className="px-4 py-3 text-start text-xs font-medium text-[var(--v2-text-muted)] uppercase tracking-wider">
                    {t('payments.table.description') || 'Description'}
                  </th>
                  <th
                    className="px-4 py-3 text-start text-xs font-medium text-[var(--v2-text-muted)] uppercase tracking-wider cursor-pointer hover:text-[var(--v2-text-primary)] transition-colors"
                    onClick={() => handleSort('date')}
                  >
                    <div className="flex items-center">
                      {t('payments.table.date') || 'Date'}
                      {getSortIcon('date')}
                    </div>
                  </th>
                  <th className="px-4 py-3 text-end text-xs font-medium text-[var(--v2-text-muted)] uppercase tracking-wider">
                    {t('payments.table.actions') || 'Actions'}
                  </th>
                </tr>
              </thead>
              <tbody className="bg-[var(--v2-surface)] divide-y divide-[var(--v2-border)]">
                {sortedTransactions.map((transaction) => {
                  const transactionRef = transaction.stripe_payment_intent_id || transaction.stripe_charge_id || transaction.id;
                  const contactName = getContactName(transaction.contact);
                  const isRefunded = transaction.status === 'refunded' || transaction.refund_status === 'full';
                  const isPartialRefund = transaction.refund_status === 'partial';
                  const hasRefund = isRefunded || isPartialRefund;
                  const isExpanded = expandedRows.has(transaction.id);

                  // Determine status display
                  const getStatusDisplay = () => {
                    if (isRefunded) {
                      return {
                        colorKey: 'refunded',
                        label: t('payments.refund_status.full') || 'Full Refund'
                      };
                    }
                    if (isPartialRefund) {
                      return {
                        colorKey: 'partial_refund',
                        label: t('payments.refund_status.partial') || 'Partial Refund'
                      };
                    }
                    return {
                      colorKey: transaction.status,
                      label: t(`payments.status.${transaction.status}`)
                    };
                  };

                  const statusDisplay = getStatusDisplay();
                  const isHighlighted = highlightId === transaction.id;

                  return (
                    <React.Fragment key={transaction.id}>
                      <tr
                        id={`transaction-${transaction.id}`}
                        className={`transition-colors cursor-pointer ${
                          isHighlighted
                            ? 'bg-[#F59E0B]/10 ring-2 ring-[#F59E0B]/30 hover:bg-[#F59E0B]/15'
                            : 'hover:bg-[var(--v2-surface-hover)]'
                        }`}
                        onClick={() => toggleRowExpanded(transaction.id)}
                      >
                        {/* Checkbox */}
                        <td className="px-4 py-4" onClick={(e) => toggleSelect(transaction.id, e)}>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(transaction.id)}
                            onChange={() => {}}
                            className="rounded border-[var(--v2-border)] text-[#22C58B] focus:ring-[#22C58B]"
                          />
                        </td>

                        {/* Expand toggle */}
                        <td className="px-2 py-4 whitespace-nowrap">
                          <button
                            className="p-1 rounded hover:bg-[var(--v2-border)] transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleRowExpanded(transaction.id);
                            }}
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4 text-[var(--v2-text-muted)]" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-[var(--v2-text-muted)] rtl:rotate-180" />
                            )}
                          </button>
                        </td>

                        {/* Amount */}
                        <td className="px-4 py-4 whitespace-nowrap">
                          <div>
                            <span className={`text-sm font-semibold ${hasRefund ? 'text-[var(--v2-text-muted)] line-through' : 'text-[var(--v2-text-primary)]'}`}>
                              {formatAmount(transaction.amount, transaction.currency)}
                            </span>
                            {hasRefund && transaction.refunded_amount && (
                              <div className="text-xs text-orange-600 dark:text-orange-400 mt-0.5">
                                -{formatAmount(transaction.refunded_amount, transaction.currency)} {t('payments.refunded_label') || 'refunded'}
                              </div>
                            )}
                          </div>
                        </td>

                        {/* Status */}
                        <td className="px-4 py-4 whitespace-nowrap">
                          <Badge className={`text-sm ${STATUS_COLORS[statusDisplay.colorKey]}`}>
                            {statusDisplay.label}
                          </Badge>
                        </td>

                        {/* Client */}
                        <td className="px-4 py-4 whitespace-nowrap">
                          {contactName ? (
                            <div>
                              <div className="text-sm font-medium text-[var(--v2-text-primary)]">{contactName}</div>
                              {transaction.contact?.email && (
                                <div className="text-xs text-[var(--v2-text-muted)]">{transaction.contact.email}</div>
                              )}
                            </div>
                          ) : (
                            <span className="text-sm text-[var(--v2-text-muted)]">-</span>
                          )}
                        </td>

                        {/* Description */}
                        <td className="px-4 py-4">
                          <div className="max-w-[200px]">
                            {transaction.service_name && (
                              <div className="text-sm font-medium text-[var(--v2-text-primary)] mb-0.5 truncate">
                                {transaction.service_name}
                              </div>
                            )}
                            {transaction.installment_number && transaction.installment_total && (
                              <div className="text-xs font-medium text-[#8B5CF6] mb-0.5 flex items-center gap-1">
                                <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#8B5CF6]"></span>
                                {t('payments.installment_badge')
                                  ?.replace('{current}', String(transaction.installment_number))
                                  .replace('{total}', String(transaction.installment_total)) ||
                                  `Payment ${transaction.installment_number} of ${transaction.installment_total}`}
                              </div>
                            )}
                            <div className="text-sm text-[var(--v2-text-secondary)] truncate">
                              {translateDescription(transaction.description) || '-'}
                            </div>
                          </div>
                        </td>

                        {/* Date */}
                        <td className="px-4 py-4 whitespace-nowrap">
                          {hasRefund && transaction.refunded_at ? (
                            <>
                              <div className="text-sm text-[var(--v2-text-secondary)]">
                                {formatDate(transaction.refunded_at)}
                              </div>
                              <div className="text-xs text-orange-600 dark:text-orange-400">
                                {t('payments.refunded_on') || 'Refunded'}
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="text-sm text-[var(--v2-text-secondary)]">
                                {formatDate(transaction.paid_at || transaction.created_at)}
                              </div>
                              <div className="text-xs text-[var(--v2-text-muted)]">
                                {transaction.paid_at ? t('payments.paid') : t('payments.created')}
                              </div>
                            </>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-4 whitespace-nowrap text-end">
                          {transaction.status === 'succeeded' && !hasRefund && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => handleRefundClick(transaction, e)}
                              className="h-8 gap-1.5 text-orange-600 hover:text-orange-700 hover:bg-orange-50 dark:text-orange-400 dark:hover:bg-orange-900/20"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                              {t('payments.refund') || 'Refund'}
                            </Button>
                          )}
                        </td>
                      </tr>

                      {/* Expanded Details Row */}
                      {isExpanded && (
                        <tr className="bg-[var(--v2-bg)]">
                          <td colSpan={8} className="px-4 py-4">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 ps-8">
                              {/* Payment Method */}
                              <div className="text-start">
                                <div className="text-xs text-[var(--v2-text-muted)] uppercase tracking-wider mb-1">
                                  {t('payments.details.payment_method') || 'Payment Method'}
                                </div>
                                <div className="text-sm text-[var(--v2-text-primary)]">
                                  {transaction.payment_method
                                    ? (t(`payments.payment_method.${transaction.payment_method}`) || transaction.payment_method)
                                    : '-'}
                                </div>
                              </div>

                              {/* Service (if available) */}
                              {transaction.service_name && (
                                <div className="text-start">
                                  <div className="text-xs text-[var(--v2-text-muted)] uppercase tracking-wider mb-1">
                                    {t('payments.details.service') || 'Service'}
                                  </div>
                                  <div className="text-sm text-[var(--v2-text-primary)]">
                                    {transaction.service_name}
                                  </div>
                                </div>
                              )}

                              {/* Payment Plan Installment (if available) */}
                              {transaction.installment_number && transaction.installment_total && (
                                <div className="text-start">
                                  <div className="text-xs text-[var(--v2-text-muted)] uppercase tracking-wider mb-1">
                                    {t('payments.details.installment') || 'Installment'}
                                  </div>
                                  <div className="text-sm text-[var(--v2-text-primary)]">
                                    {t('payments.installment_of')
                                      ?.replace('{current}', String(transaction.installment_number))
                                      .replace('{total}', String(transaction.installment_total)) ||
                                      `${transaction.installment_number} of ${transaction.installment_total}`}
                                  </div>
                                  {transaction.payment_plan_name && (
                                    <div className="text-xs text-[var(--v2-text-muted)] mt-0.5">
                                      {transaction.payment_plan_name}
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Transaction ID */}
                              <div className="text-start">
                                <div className="text-xs text-[var(--v2-text-muted)] uppercase tracking-wider mb-1">
                                  {t('payments.details.transaction_id') || 'Transaction ID'}
                                </div>
                                <div className="flex items-center gap-1">
                                  <code className="text-xs bg-[var(--v2-surface)] border border-[var(--v2-border)] px-1.5 py-0.5 rounded font-mono" dir="ltr">
                                    {transactionRef}
                                  </code>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      copyToClipboard(transactionRef, `${transaction.id}-expanded`);
                                    }}
                                    className="p-1 rounded hover:bg-[var(--v2-border)] transition-colors"
                                    title={t('common.copy') || 'Copy'}
                                  >
                                    {copiedId === `${transaction.id}-expanded` ? (
                                      <Check className="h-3.5 w-3.5 text-green-500" />
                                    ) : (
                                      <Copy className="h-3.5 w-3.5 text-[var(--v2-text-muted)]" />
                                    )}
                                  </button>
                                </div>
                              </div>

                              {/* Created At */}
                              <div className="text-start">
                                <div className="text-xs text-[var(--v2-text-muted)] uppercase tracking-wider mb-1">
                                  {t('payments.details.created_at') || 'Created'}
                                </div>
                                <div className="text-sm text-[var(--v2-text-primary)]">
                                  {formatDateTime(transaction.created_at)}
                                </div>
                              </div>

                              {/* Paid At */}
                              {transaction.paid_at && (
                                <div className="text-start">
                                  <div className="text-xs text-[var(--v2-text-muted)] uppercase tracking-wider mb-1">
                                    {t('payments.details.paid_at') || 'Paid'}
                                  </div>
                                  <div className="text-sm text-[var(--v2-text-primary)]">
                                    {formatDateTime(transaction.paid_at)}
                                  </div>
                                </div>
                              )}

                              {/* Refund Details (if refunded) */}
                              {hasRefund && (
                                <>
                                  <div className="text-start">
                                    <div className="text-xs text-[var(--v2-text-muted)] uppercase tracking-wider mb-1">
                                      {t('payments.details.refunded_at') || 'Refunded At'}
                                    </div>
                                    <div className="text-sm text-orange-600 dark:text-orange-400">
                                      {formatDateTime(transaction.refunded_at || transaction.created_at)}
                                    </div>
                                  </div>

                                  {transaction.refund_reason && (
                                    <div className="col-span-2 text-start">
                                      <div className="text-xs text-[var(--v2-text-muted)] uppercase tracking-wider mb-1">
                                        {t('payments.details.refund_reason') || 'Refund Reason'}
                                      </div>
                                      <div className="text-sm text-[var(--v2-text-primary)]">
                                        {transaction.refund_reason}
                                      </div>
                                    </div>
                                  )}

                                  {transaction.refunded_amount && (
                                    <div className="text-start">
                                      <div className="text-xs text-[var(--v2-text-muted)] uppercase tracking-wider mb-1">
                                        {t('payments.details.refunded_amount') || 'Refunded Amount'}
                                      </div>
                                      <div className="text-sm font-semibold text-orange-600 dark:text-orange-400">
                                        {formatAmount(transaction.refunded_amount, transaction.currency)}
                                        {isPartialRefund && (
                                          <span className="text-xs font-normal text-[var(--v2-text-muted)] ms-1">
                                            ({Math.round((transaction.refunded_amount / transaction.amount) * 100)}%)
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </>
                              )}

                              {/* Source (if from website booking) */}
                              {transaction.metadata?.source === 'website_booking' && (
                                <div className="text-start">
                                  <div className="text-xs text-[var(--v2-text-muted)] uppercase tracking-wider mb-1">
                                    {t('payments.details.source') || 'Source'}
                                  </div>
                                  <div className="text-sm text-[var(--v2-text-primary)]">
                                    {t('payments.details.source_website_booking') || 'Website Booking'}
                                  </div>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>

            {/* Pagination Controls */}
            {totalCount > PAGE_SIZE && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--v2-border)]">
                <div className="text-sm text-[var(--v2-text-muted)]">
                  {t('payments.pagination.showing')?.replace('{from}', String(page * PAGE_SIZE + 1)).replace('{to}', String(Math.min((page + 1) * PAGE_SIZE, totalCount))).replace('{total}', String(totalCount)) ||
                    `${page * PAGE_SIZE + 1}-${Math.min((page + 1) * PAGE_SIZE, totalCount)} of ${totalCount}`}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const prevPage = page - 1;
                      setPage(prevPage);
                      fetchTransactions(prevPage);
                      setSelectedIds(new Set());
                    }}
                    disabled={page === 0 || loading}
                    className="h-8 px-2"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    <span className="hidden sm:inline ms-1">{t('payments.pagination.prev') || 'Previous'}</span>
                  </Button>
                  <div className="hidden sm:flex items-center gap-1">
                    {(() => {
                      const totalPages = Math.ceil(totalCount / PAGE_SIZE);
                      const currentPage = page + 1;
                      return Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                        let pageNum: number;
                        if (totalPages <= 5) {
                          pageNum = i + 1;
                        } else if (currentPage <= 3) {
                          pageNum = i + 1;
                        } else if (currentPage >= totalPages - 2) {
                          pageNum = totalPages - 4 + i;
                        } else {
                          pageNum = currentPage - 2 + i;
                        }
                        return (
                          <Button
                            key={pageNum}
                            variant={currentPage === pageNum ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => {
                              setPage(pageNum - 1);
                              fetchTransactions(pageNum - 1);
                              setSelectedIds(new Set());
                            }}
                            disabled={loading}
                            className={`h-8 w-8 p-0 ${currentPage === pageNum ? 'bg-[#22C58B] hover:bg-[#1ea677] text-white' : ''}`}
                          >
                            {pageNum}
                          </Button>
                        );
                      });
                    })()}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const nextPage = page + 1;
                      setPage(nextPage);
                      fetchTransactions(nextPage);
                      setSelectedIds(new Set());
                    }}
                    disabled={!hasMore || loading}
                    className="h-8 px-2"
                  >
                    <span className="hidden sm:inline me-1">{t('payments.pagination.next') || 'Next'}</span>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Refund Modal */}
      {selectedTransaction && (
        <RefundModal
          isOpen={refundModalOpen}
          onClose={() => {
            setRefundModalOpen(false);
            setSelectedTransaction(null);
          }}
          transactionId={selectedTransaction.stripe_payment_intent_id || selectedTransaction.id}
          originalAmount={selectedTransaction.amount}
          currency={selectedTransaction.currency}
          onSuccess={handleRefundSuccess}
          onError={handleRefundError}
          isRTL={isRTL}
        />
      )}

      {/* Floating Bulk Actions Bar */}
      {selectedCount > 0 && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-6 py-3 bg-[var(--v2-surface)] border border-[var(--v2-border)] shadow-xl"
          style={{ borderRadius: 'var(--v2-radius-card)' }}
        >
          <span className="text-sm font-medium text-[var(--v2-text-primary)]">
            {t('payments.bulk.selected')?.replace('{count}', String(selectedCount)) || `${selectedCount} selected`}
          </span>

          <div className="w-px h-6 bg-[var(--v2-border)]" />

          <Button
            size="sm"
            variant="ghost"
            onClick={handleExportToExcel}
            className="h-8 gap-1.5 text-[#22C58B] hover:bg-[#22C58B]/10"
          >
            <Download className="h-4 w-4" />
            {t('payments.bulk.export') || 'Export'}
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSelectedIds(new Set())}
            className="h-8 px-2 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
