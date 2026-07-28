'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { createLogger } from '@/lib/logger';
import { InvoiceModal } from './InvoiceModal';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { FileText, Plus } from 'lucide-react';

const logger = createLogger({ module: 'PaymentInvoiceList' });

interface PaymentInvoice {
  id: string;
  invoice_number: string;
  amount: number;
  currency: string;
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';
  contact_id: string | null;
  due_date: string | null;
  paid_at: string | null;
  created_at: string;
}

interface PaymentInvoiceListProps {
  searchQuery?: string;
  onCreateInvoice?: () => void;
}

export function PaymentInvoiceList({ searchQuery = '', onCreateInvoice }: PaymentInvoiceListProps) {
  const { t, isRTL, language } = useLanguage();
  const [invoices, setInvoices] = useState<PaymentInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'draft' | 'sent' | 'paid' | 'overdue'>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);

  // External trigger for creating invoice (from parent's header button)
  const handleCreateInvoice = () => {
    if (onCreateInvoice) {
      onCreateInvoice();
    } else {
      setShowCreateModal(true);
    }
  };

  useEffect(() => {
    fetchInvoices();
  }, [filter]);

  // Filter invoices by search query
  const filteredInvoices = invoices.filter((invoice) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      invoice.invoice_number.toLowerCase().includes(query) ||
      invoice.amount.toString().includes(query) ||
      invoice.status.toLowerCase().includes(query)
    );
  });

  const fetchInvoices = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (filter !== 'all') params.set('status', filter);

      const response = await fetch(`/api/payments/invoices?${params}`);
      const result = await response.json();

      if (result.success) {
        setInvoices(result.data || []);
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch invoices');
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: PaymentInvoice['status']) => {
    const styles = {
      draft: 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-300 border-gray-200 dark:border-gray-700',
      sent: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-800',
      paid: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 border-green-200 dark:border-green-800',
      overdue: 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 border-red-200 dark:border-red-800',
      cancelled: 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700',
    };

    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${styles[status]}`}>
        {t(`payments.invoice_status.${status}`)}
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

  const formatDate = (dateString: string | null) => {
    if (!dateString) return t('payments.not_set');
    const locale = language === 'he' ? 'he-IL' : language === 'es' ? 'es-ES' : 'en-US';
    return new Date(dateString).toLocaleDateString(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
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
          {(['all', 'draft', 'sent', 'paid', 'overdue'] as const).map((filterOption) => (
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
              {t(`payments.invoice_filter.${filterOption}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Invoices List */}
      {filteredInvoices.length === 0 ? (
        <div className="text-center py-12">
          <FileText className="mx-auto h-12 w-12 text-[var(--v2-text-muted)]" />
          <h3 className="mt-2 text-sm font-medium text-[var(--v2-text-primary)]">{t('payments.no_invoices')}</h3>
          <p className="mt-1 text-sm text-[var(--v2-text-secondary)]">
            {filter === 'all' ? t('payments.no_invoices_desc') : t('payments.no_filtered_invoices').replace('{status}', t(`payments.invoice_filter.${filter}`))}
          </p>
          <div className="mt-6">
            <Button
              onClick={handleCreateInvoice}
              className="flex items-center gap-2 text-white"
              style={{ background: 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)' }}
            >
              <Plus className="h-4 w-4" />
              {t('payments.create_invoice')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredInvoices.map((invoice) => (
            <div
              key={invoice.id}
              className="border border-[var(--v2-border)] p-4 hover:border-[#F59E0B]/50 transition-colors bg-[var(--v2-surface)]"
              style={{ borderRadius: 'var(--v2-radius-card)' }}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">
                      {invoice.invoice_number}
                    </h3>
                    {getStatusBadge(invoice.status)}
                  </div>
                  <div className="mt-2 flex items-center gap-4 flex-wrap">
                    <span className="text-xl font-bold text-[var(--v2-text-primary)]">
                      {formatAmount(invoice.amount, invoice.currency)}
                    </span>
                    <span className="text-sm text-[var(--v2-text-secondary)]">
                      {t('payments.due')}: {formatDate(invoice.due_date)}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 mt-2 text-xs text-[var(--v2-text-muted)] flex-wrap">
                    <span>{t('payments.created')}: {formatDate(invoice.created_at)}</span>
                    {invoice.paid_at && (
                      <span className="text-green-600 dark:text-green-400 font-medium">
                        {t('payments.paid')}: {formatDate(invoice.paid_at)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm">
                    {t('payments.view')}
                  </Button>
                  {invoice.status === 'draft' && (
                    <Button
                      size="sm"
                      className="text-white"
                      style={{ background: 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)' }}
                    >
                      {t('payments.send')}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Invoice Modal */}
      {showCreateModal && (
        <InvoiceModal
          onClose={() => setShowCreateModal(false)}
          onSave={() => {
            setShowCreateModal(false);
            fetchInvoices();
          }}
        />
      )}
    </div>
  );
}
