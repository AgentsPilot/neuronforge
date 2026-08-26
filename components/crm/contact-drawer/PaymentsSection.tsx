'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Receipt, CreditCard, Plus, DollarSign, Calendar, ExternalLink, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CollapsibleSection } from '../CollapsibleSection';

interface PaymentTransaction {
  id: string;
  amount: number;
  currency: string;
  status: 'pending' | 'completed' | 'failed' | 'refunded';
  payment_method: string;
  description: string;
  created_at: string;
  stripe_payment_intent_id?: string;
}

interface Invoice {
  id: string;
  invoice_number: string;
  amount: number;
  currency: string;
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';
  due_date?: string;
  created_at: string;
  line_items?: Array<{
    description: string;
    quantity: number;
    unit_price: number;
    total: number;
  }>;
}

interface PaymentsSectionProps {
  contactId: string;
  contactName: string;
  contactEmail?: string;
  t: (key: string) => string;
  isRTL: boolean;
  language?: string;
  isLoading?: boolean;
  isOpen?: boolean;
  onToggle?: (isOpen: boolean) => void;
  onCreateInvoice?: () => void;
  onInvoiceCreated?: () => void;
}

const INVOICE_STATUS_STYLES = {
  draft: { color: 'text-slate-500', bg: 'bg-slate-500/10' },
  sent: { color: 'text-blue-500', bg: 'bg-blue-500/10' },
  paid: { color: 'text-green-500', bg: 'bg-green-500/10' },
  overdue: { color: 'text-red-500', bg: 'bg-red-500/10' },
  cancelled: { color: 'text-gray-500', bg: 'bg-gray-500/10' }
};

const PAYMENT_STATUS_STYLES = {
  pending: { color: 'text-amber-500', bg: 'bg-amber-500/10' },
  completed: { color: 'text-green-500', bg: 'bg-green-500/10' },
  succeeded: { color: 'text-green-500', bg: 'bg-green-500/10' },
  failed: { color: 'text-red-500', bg: 'bg-red-500/10' },
  refunded: { color: 'text-gray-500', bg: 'bg-gray-500/10' }
};

export function PaymentsSection({
  contactId,
  contactName,
  contactEmail,
  t,
  isRTL,
  language,
  isLoading = false,
  isOpen,
  onToggle,
  onCreateInvoice,
  onInvoiceCreated
}: PaymentsSectionProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'invoices' | 'payments'>('invoices');
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<PaymentTransaction[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [loadingPayments, setLoadingPayments] = useState(false);

  // Fetch invoices
  const fetchInvoices = async () => {
    setLoadingInvoices(true);
    try {
      const response = await fetch(`/api/payments/invoices?contact_id=${contactId}`);
      const data = await response.json();
      if (data.success) {
        setInvoices(data.data || []);
      }
    } catch (error) {
      console.error('Failed to fetch invoices:', error);
    } finally {
      setLoadingInvoices(false);
    }
  };

  // Fetch payments
  const fetchPayments = async () => {
    setLoadingPayments(true);
    try {
      const response = await fetch(`/api/payments/transactions?contact_id=${contactId}`);
      const data = await response.json();
      if (data.success) {
        setPayments(data.data || []);
      }
    } catch (error) {
      console.error('Failed to fetch payments:', error);
    } finally {
      setLoadingPayments(false);
    }
  };

  // Load data when section opens or tab changes
  const handleToggle = (open: boolean) => {
    onToggle?.(open);
  };

  // Fetch data when section opens or active tab changes
  useEffect(() => {
    if (isOpen) {
      if (activeTab === 'invoices' && invoices.length === 0) {
        fetchInvoices();
      } else if (activeTab === 'payments' && payments.length === 0) {
        fetchPayments();
      }
    }
  }, [isOpen, activeTab]);

  // Refresh data when onInvoiceCreated is called
  useEffect(() => {
    if (onInvoiceCreated && isOpen) {
      fetchInvoices();
      fetchPayments();
    }
  }, [onInvoiceCreated]);

  const formatCurrency = (amount: number, currency: string = 'USD') => {
    return new Intl.NumberFormat(language || 'en', {
      style: 'currency',
      currency: currency.toUpperCase()
    }).format(amount);
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString(language || 'en', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const translatePaymentMethod = (method: string | null): string => {
    if (!method) return '-';

    // If already in Hebrew (contains Hebrew characters), return as-is
    const hebrewRegex = /[\u0590-\u05FF]/;
    if (hebrewRegex.test(method)) return method;

    // Translation map
    const translations: Record<string, Record<string, string>> = {
      he: {
        'card': 'כרטיס אשראי',
        'credit_card': 'כרטיס אשראי',
        'debit_card': 'כרטיס חיוב',
        'bank_transfer': 'העברה בנקאית',
        'wire_transfer': 'העברה בנקאית',
        'bit': 'ביט',
        'paypal': 'פייפאל',
        'cash': 'מזומן',
        'check': 'צ\'ק',
        'cheque': 'צ\'ק'
      },
      es: {
        'card': 'Tarjeta',
        'credit_card': 'Tarjeta de crédito',
        'debit_card': 'Tarjeta de débito',
        'bank_transfer': 'Transferencia bancaria',
        'wire_transfer': 'Transferencia bancaria',
        'bit': 'Bit',
        'paypal': 'PayPal',
        'cash': 'Efectivo',
        'check': 'Cheque',
        'cheque': 'Cheque'
      }
    };

    const methodLower = method.toLowerCase();
    const langTranslations = translations[language || 'en'];

    if (langTranslations && langTranslations[methodLower]) {
      return langTranslations[methodLower];
    }

    // Capitalize first letter if no translation found
    return method.charAt(0).toUpperCase() + method.slice(1);
  };

  return (
    <>
      <CollapsibleSection
        title={t('crm.drawer.payments') || 'Payments & Invoices'}
        icon={<Receipt className="h-4 w-4" />}
        count={invoices.length + payments.length}
        isOpen={isOpen}
        onToggle={handleToggle}
        isRTL={isRTL}
      >
        {/* Tabs */}
        <div className="flex items-center gap-2 mb-4 border-b border-[var(--v2-border)]" dir={isRTL ? 'rtl' : 'ltr'}>
          <button
            onClick={() => setActiveTab('invoices')}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
              activeTab === 'invoices'
                ? 'border-[#8B5CF6] text-[#8B5CF6]'
                : 'border-transparent text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]'
            }`}
          >
            <Receipt className="h-4 w-4 inline me-1.5" />
            {t('payments.invoices') || 'Invoices'} ({invoices.length})
          </button>
          <button
            onClick={() => setActiveTab('payments')}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
              activeTab === 'payments'
                ? 'border-[#8B5CF6] text-[#8B5CF6]'
                : 'border-transparent text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]'
            }`}
          >
            <CreditCard className="h-4 w-4 inline me-1.5" />
            {t('payments.transactions') || 'Payments'} ({payments.length})
          </button>
        </div>

        {/* Invoices Tab */}
        {activeTab === 'invoices' && (
          <div className="space-y-3" dir={isRTL ? 'rtl' : 'ltr'}>
            {/* Invoices List */}
            {loadingInvoices ? (
              <div className="text-center py-8 text-[var(--v2-text-muted)]">
                <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin mx-auto mb-2" style={{ borderColor: '#8B5CF6', borderTopColor: 'transparent' }}></div>
                {t('common.loading') || 'Loading...'}
              </div>
            ) : invoices.length === 0 ? (
              <div className="text-center py-8 text-[var(--v2-text-muted)]">
                <Receipt className="h-12 w-12 mx-auto mb-2 opacity-20" />
                <p className="text-sm">{t('payments.no_invoices') || 'No invoices yet'}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {invoices.map((invoice) => {
                  const statusStyle = INVOICE_STATUS_STYLES[invoice.status];
                  const isOverdue = invoice.status === 'sent' && invoice.due_date && new Date(invoice.due_date) < new Date();

                  return (
                    <div
                      key={invoice.id}
                      className="p-3 bg-[var(--v2-surface)] rounded-lg border border-[var(--v2-border)] hover:border-[#8B5CF6] transition-colors cursor-pointer"
                      onClick={() => router.push(`/business-os/reports?tab=invoices&invoice=${invoice.id}`)}
                    >
                      <div className={`flex items-center justify-between gap-3 ${isRTL ? 'flex-row-reverse' : ''}`}>
                        <div className={`flex-1 min-w-0 ${isRTL ? 'text-right' : 'text-left'}`}>
                          {/* Invoice number and status */}
                          <div className={`flex items-center gap-2 mb-2 ${isRTL ? 'flex-row-reverse justify-end' : ''}`}>
                            <FileText className="h-4 w-4 text-[var(--v2-text-muted)] flex-shrink-0" />
                            <span className="text-sm font-semibold text-[var(--v2-text-primary)]">
                              {invoice.invoice_number}
                            </span>
                            <Badge className={`${statusStyle.bg} ${statusStyle.color} border-0 text-xs`}>
                              {t(`payments.invoice.status_${invoice.status}`) || invoice.status}
                            </Badge>
                            {isOverdue && (
                              <Badge className="bg-red-500/10 text-red-500 border-0 text-xs">
                                {t('payments.invoice.overdue') || 'Overdue'}
                              </Badge>
                            )}
                          </div>
                          {/* Amount and due date */}
                          <div className={`flex items-center gap-4 text-sm ${isRTL ? 'flex-row-reverse' : ''}`}>
                            <span className={`flex items-center gap-1.5 font-semibold text-[var(--v2-text-primary)] ${isRTL ? 'flex-row-reverse' : ''}`}>
                              <DollarSign className="h-4 w-4" />
                              <bdi>{formatCurrency(invoice.amount, invoice.currency)}</bdi>
                            </span>
                            {invoice.due_date && (
                              <span className={`flex items-center gap-1.5 text-[var(--v2-text-muted)] ${isRTL ? 'flex-row-reverse' : ''}`}>
                                <Calendar className="h-4 w-4" />
                                <bdi>{formatDate(invoice.due_date)}</bdi>
                              </span>
                            )}
                          </div>
                        </div>
                        <ExternalLink className="h-4 w-4 text-[var(--v2-text-muted)] flex-shrink-0" />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Payments Tab */}
        {activeTab === 'payments' && (
          <div className="space-y-3" dir={isRTL ? 'rtl' : 'ltr'}>
            {loadingPayments ? (
              <div className="text-center py-8 text-[var(--v2-text-muted)]">
                <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin mx-auto mb-2" style={{ borderColor: '#8B5CF6', borderTopColor: 'transparent' }}></div>
                {t('common.loading') || 'Loading...'}
              </div>
            ) : payments.length === 0 ? (
              <div className="text-center py-8 text-[var(--v2-text-muted)]">
                <CreditCard className="h-12 w-12 mx-auto mb-2 opacity-20" />
                <p className="text-sm">{t('payments.no_transactions') || 'No payment transactions yet'}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {payments.map((payment) => {
                  const statusStyle = PAYMENT_STATUS_STYLES[payment.status] || PAYMENT_STATUS_STYLES.pending;

                  return (
                    <div
                      key={payment.id}
                      className="p-3 bg-[var(--v2-surface)] rounded-lg border border-[var(--v2-border)] hover:border-[#8B5CF6] transition-colors cursor-pointer"
                      onClick={() => router.push(`/business-os/reports?tab=transactions&transaction=${payment.id}`)}
                    >
                      <div className={`flex items-center justify-between gap-3 ${isRTL ? 'flex-row-reverse' : ''}`}>
                        <div className={`flex-1 min-w-0 ${isRTL ? 'text-right' : 'text-left'}`}>
                          {/* Description and status */}
                          <div className={`flex items-center gap-2 mb-2 ${isRTL ? 'flex-row-reverse justify-end' : ''}`}>
                            <CreditCard className="h-4 w-4 text-[var(--v2-text-muted)] flex-shrink-0" />
                            <span className="text-sm font-semibold text-[var(--v2-text-primary)] truncate">
                              {payment.description || t('payments.transaction') || 'Payment'}
                            </span>
                            <Badge className={`${statusStyle.bg} ${statusStyle.color} border-0 text-xs flex-shrink-0`}>
                              {t(`payments.status_${payment.status}`) || payment.status}
                            </Badge>
                          </div>
                          {/* Amount, method, and date */}
                          <div className={`flex items-center gap-3 text-sm ${isRTL ? 'flex-row-reverse' : ''}`}>
                            <span className={`flex items-center gap-1.5 font-semibold text-[var(--v2-text-primary)] ${isRTL ? 'flex-row-reverse' : ''}`}>
                              <DollarSign className="h-4 w-4" />
                              <bdi>{formatCurrency(payment.amount, payment.currency)}</bdi>
                            </span>
                            <span className="text-[var(--v2-text-muted)]">•</span>
                            <span className="text-[var(--v2-text-muted)]"><bdi>{translatePaymentMethod(payment.payment_method)}</bdi></span>
                            <span className="text-[var(--v2-text-muted)]">•</span>
                            <span className="text-[var(--v2-text-muted)]"><bdi>{formatDate(payment.created_at)}</bdi></span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </CollapsibleSection>
    </>
  );
}
