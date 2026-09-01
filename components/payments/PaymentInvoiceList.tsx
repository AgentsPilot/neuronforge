'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { createLogger } from '@/lib/logger';
import { InvoiceModal } from './InvoiceModal';
import { RefundModal } from './RefundModal';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import {
  FileText,
  Plus,
  Send,
  Download,
  Link2,
  X,
  AlertTriangle,
  Loader2,
  Check,
  ExternalLink,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Mail,
  CreditCard,
  RotateCcw,
} from 'lucide-react';

const logger = createLogger({ module: 'PaymentInvoiceList' });

const PAGE_SIZE = 10;

interface InvoiceLineItem {
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
}

interface PaymentInvoice {
  id: string;
  invoice_number: string;
  amount: number;
  currency: string;
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled' | 'refunded' | 'partially_refunded';
  /** Derived from the invoice's payments by trigger — never written directly. */
  refunded_amount?: number | null;
  refund_status?: 'none' | 'partial' | 'full' | null;
  contact_id: string | null;
  client_name: string | null;
  client_email: string | null;
  due_date: string | null;
  paid_at: string | null;
  sent_at: string | null;
  created_at: string;
  stripe_invoice_id: string | null;
  stripe_hosted_invoice_url: string | null;
  stripe_invoice_pdf: string | null;
  line_items?: InvoiceLineItem[];
  payment_terms?: string;
}

interface InvoiceStats {
  draft: { count: number; total: number };
  sent: { count: number; total: number };
  paid: { count: number; total: number };
  overdue: { count: number; total: number };
  cancelled: { count: number; total: number };
  all: { count: number; total: number };
}

interface PaymentInvoiceListProps {
  searchQuery?: string;
  onCreateInvoice?: () => void;
  highlightId?: string | null;
}

/**
 * Column tracks for the invoice table, defined once.
 *
 * The header and each row are SEPARATE grids — the header is a sibling of the
 * rows, not their parent — so every one of them resolves its own tracks. The
 * last track was `auto`, which measures whatever that grid contains: five
 * action buttons on an overdue invoice, two on a paid one, and the words
 * "Actions" in the header. Each grid therefore had a different last column, the
 * `1fr` columns absorbed the difference by different amounts, and the headers
 * ended up standing over the wrong data — a column apparently without a header.
 *
 * Every track is now fixed or fractional, so all of them resolve identically.
 * 208px fits the widest action set: five 36px buttons with four 6px gaps.
 */
const INVOICE_GRID = 'grid-cols-[120px_1fr_1fr_85px_85px_95px_80px_208px]';

export function PaymentInvoiceList({ searchQuery = '', onCreateInvoice, highlightId }: PaymentInvoiceListProps) {
  const { t, isRTL, language } = useLanguage();
  const [invoices, setInvoices] = useState<PaymentInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled'>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showSendModal, setShowSendModal] = useState<PaymentInvoice | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const [stats, setStats] = useState<InvoiceStats | null>(null);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [hasStripeConnect, setHasStripeConnect] = useState<boolean | null>(null);
  /**
   * The invoice the user is being asked to confirm voiding, and anything that
   * went wrong while acting on the list.
   *
   * Both used to be browser popups — a confirm() to void and eight alert()s for
   * failures — which sit outside the page, cannot be styled or translated in
   * place, and read as a browser error rather than the product answering.
   */
  const [refundTarget, setRefundTarget] = useState<PaymentInvoice | null>(null);
  const [voidTarget, setVoidTarget] = useState<PaymentInvoice | null>(null);
  const [voidError, setVoidError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const handleCreateInvoice = () => {
    if (onCreateInvoice) {
      onCreateInvoice();
    } else {
      setShowCreateModal(true);
    }
  };

  useEffect(() => {
    setPage(0);
    // Stats travel with every fetch, not just the first.
    //
    // They were requested only while `stats` was still null, so the cards kept
    // the numbers from the moment the page loaded: sending, cancelling or
    // paying an invoice — or the server moving one to overdue — changed the
    // list underneath cards that never moved. The extra query reads one row per
    // invoice and is answered alongside the list.
    fetchInvoices(0);
  }, [filter]);

  // Check if Stripe Connect is configured.
  //
  // This asked `/stripe-connect/refresh-status`, which only accepts POST — so
  // every mount got a 405, the catch swallowed it, and hasStripeConnect was
  // permanently false, hiding the payment-link button on every invoice. It also
  // would have called out to Stripe on each page view; reading the stored
  // account is what this needs, and `/stripe-connect` GET returns exactly that.
  useEffect(() => {
    const checkStripeConnect = async () => {
      try {
        const response = await fetch('/api/payments/stripe-connect');
        const result = await response.json();
        setHasStripeConnect(result.success && result.data?.charges_enabled === true);
      } catch {
        setHasStripeConnect(false);
      }
    };
    checkStripeConnect();
  }, []);

  useEffect(() => {
    if (highlightId && !loading && invoices.length > 0) {
      // Small delay to ensure DOM is fully rendered
      const timer = setTimeout(() => {
        const element = document.getElementById(`invoice-${highlightId}`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [highlightId, loading, invoices]);

  const filteredInvoices = invoices.filter((invoice) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      invoice.invoice_number.toLowerCase().includes(query) ||
      invoice.amount.toString().includes(query) ||
      invoice.status.toLowerCase().includes(query) ||
      invoice.client_name?.toLowerCase().includes(query) ||
      invoice.client_email?.toLowerCase().includes(query)
    );
  });

  const fetchInvoices = async (pageNum: number = 0, fetchStats: boolean = true) => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      // Sent means every issued invoice, late ones included — an overdue
      // invoice is still one the client was asked to pay. Overdue stays a
      // narrower view of the same set.
      if (filter === 'sent') {
        params.set('status', 'sent,pending,overdue');
      } else if (filter === 'paid') {
        // A refunded invoice was paid. Narrowing to status='paid' alone would
        // make it vanish from this tab the moment it was refunded, which reads
        // as the record having been deleted.
        params.set('status', 'paid,refunded,partially_refunded');
      } else if (filter !== 'all') {
        params.set('status', filter);
      }
      if (fetchStats) params.set('include_stats', 'true');
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(pageNum * PAGE_SIZE));

      const response = await fetch(`/api/payments/invoices?${params}`);
      const result = await response.json();

      if (result.success) {
        const newData = result.data || [];
        setInvoices(newData);
        setHasMore(newData.length === PAGE_SIZE);
        if (result.total !== undefined) {
          setTotalCount(result.total);
        }
        if (result.stats) {
          setStats(result.stats);
        }
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch invoices');
    } finally {
      setLoading(false);
    }
  };

  // Open send modal to let user choose method
  const handleSendInvoiceClick = (invoice: PaymentInvoice) => {
    setShowSendModal(invoice);
  };

  // Send invoice with chosen method
  const handleSendInvoice = async (invoiceId: string, useStripe: boolean) => {
    try {
      setActionLoading(invoiceId);
      setShowSendModal(null);
      const response = await fetch(`/api/payments/invoices/${invoiceId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ use_stripe: useStripe }),
      });
      const result = await response.json();

      if (result.success) {
        fetchInvoices(); // Refresh list
      } else {
        setListError(result.error || t('payments.send_failed'));
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to send invoice');
      setListError(t('payments.send_failed'));
    } finally {
      setActionLoading(null);
    }
  };

  // Download PDF
  const handleDownloadPDF = async (invoice: PaymentInvoice) => {
    try {
      setActionLoading(invoice.id);

      // Always ask our endpoint, even when Stripe has a PDF of its own.
      // Stripe's copy is always English, in Stripe's layout, with none of the
      // business's logo, colours or fonts — which is why a downloaded invoice
      // looked nothing like the one that arrives by email. The endpoint falls
      // back to Stripe (as a redirect) only if our own generation fails.
      const response = await fetch(`/api/payments/invoices/${invoice.id}/pdf`);

      if (response.redirected) {
        // Our generation failed and the endpoint handed back Stripe's copy.
        window.open(response.url, '_blank');
      } else if (response.ok) {
        // Custom PDF blob
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${invoice.invoice_number}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const result = await response.json();
        setListError(result.error || t('payments.pdf_failed'));
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to download PDF');
      setListError(t('payments.pdf_failed'));
    } finally {
      setActionLoading(null);
    }
  };

  // Copy payment link
  const handleCopyPaymentLink = async (invoice: PaymentInvoice) => {
    try {
      setActionLoading(invoice.id);

      // If we have a hosted URL, copy it directly
      if (invoice.stripe_hosted_invoice_url) {
        await navigator.clipboard.writeText(invoice.stripe_hosted_invoice_url);
        setCopiedLink(invoice.id);
        setTimeout(() => setCopiedLink(null), 2000);
        return;
      }

      // Otherwise, fetch from our endpoint
      const response = await fetch(`/api/payments/invoices/${invoice.id}/payment-link`);
      const result = await response.json();

      if (result.success && result.data?.payment_url) {
        await navigator.clipboard.writeText(result.data.payment_url);
        setCopiedLink(invoice.id);
        setTimeout(() => setCopiedLink(null), 2000);
      } else {
        setListError(result.error || t('payments.link_failed'));
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to copy payment link');
      setListError(t('payments.link_failed'));
    } finally {
      setActionLoading(null);
    }
  };

  /**
   * Void the invoice the confirmation dialog is holding.
   *
   * Sent as PUT. This used to be PATCH, which no handler on the route exports,
   * so every void since this list shipped returned 405 and died in an alert
   * saying "Failed to void invoice" — the action had never once worked.
   */
  const handleVoidInvoice = async () => {
    if (!voidTarget) return;
    const invoiceId = voidTarget.id;

    try {
      setActionLoading(invoiceId);
      setVoidError(null);
      const response = await fetch(`/api/payments/invoices/${invoiceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      });
      const result = await response.json().catch(() => null);

      if (result?.success) {
        setVoidTarget(null);
        fetchInvoices();
        return;
      }

      // The server refuses to void money that has already arrived. Say what to
      // do about it rather than repeating its sentence.
      setVoidError(
        result?.code === 'INVOICE_PAID'
          ? t('payments.void_blocked_paid')
          : result?.error || t('payments.void_failed')
      );
    } catch (error) {
      logger.error({ err: error, invoiceId }, 'Failed to void invoice');
      setVoidError(t('payments.void_failed'));
    } finally {
      setActionLoading(null);
    }
  };

  // View invoice in Stripe
  const handleViewInStripe = (invoice: PaymentInvoice) => {
    if (invoice.stripe_hosted_invoice_url) {
      window.open(invoice.stripe_hosted_invoice_url, '_blank');
    }
  };

  const getStatusConfig = (status: PaymentInvoice['status']) => {
    const configs = {
      draft: {
        bg: 'bg-gray-100 dark:bg-gray-800/50',
        text: 'text-gray-700 dark:text-gray-300',
        border: 'border-gray-200 dark:border-gray-700',
        dot: 'bg-gray-400',
        accent: 'gray'
      },
      sent: {
        bg: 'bg-blue-50 dark:bg-blue-900/20',
        text: 'text-blue-700 dark:text-blue-300',
        border: 'border-blue-200 dark:border-blue-800',
        dot: 'bg-blue-500',
        accent: 'blue'
      },
      paid: {
        bg: 'bg-emerald-50 dark:bg-emerald-900/20',
        text: 'text-emerald-700 dark:text-emerald-300',
        border: 'border-emerald-200 dark:border-emerald-800',
        dot: 'bg-emerald-500',
        accent: 'emerald'
      },
      overdue: {
        bg: 'bg-red-50 dark:bg-red-900/20',
        text: 'text-red-700 dark:text-red-300',
        border: 'border-red-200 dark:border-red-800',
        dot: 'bg-red-500 animate-pulse',
        accent: 'red'
      },
      cancelled: {
        bg: 'bg-slate-100 dark:bg-slate-800/50',
        text: 'text-slate-600 dark:text-slate-400',
        border: 'border-slate-200 dark:border-slate-700',
        dot: 'bg-slate-400',
        accent: 'slate'
      },
      // Money went back. Orange rather than red: a refund is a completed,
      // deliberate act, not a failure like an overdue invoice.
      refunded: {
        bg: 'bg-orange-50 dark:bg-orange-900/20',
        text: 'text-orange-700 dark:text-orange-300',
        border: 'border-orange-200 dark:border-orange-800',
        dot: 'bg-orange-500',
        accent: 'orange'
      },
      partially_refunded: {
        bg: 'bg-amber-50 dark:bg-amber-900/20',
        text: 'text-amber-700 dark:text-amber-300',
        border: 'border-amber-200 dark:border-amber-800',
        dot: 'bg-amber-500',
        accent: 'amber'
      },
    };
    // Falls back rather than returning undefined. The caller dereferences
    // `config.bg` immediately, so an unrecognised status used to crash the whole
    // list — which is what a widened status union did until this was added.
    return configs[status] ?? configs.draft;
  };

  const getStatusBadge = (status: PaymentInvoice['status']) => {
    const config = getStatusConfig(status);
    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${config.bg} ${config.text}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
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

  /**
   * Is this invoice past its due date?
   *
   * Judged from the date rather than from `status`, because the status only
   * becomes 'overdue' when something writes it — a row can be late for a week
   * while still saying 'sent'. Compared date-to-date so an invoice due today is
   * never late because of the time of day.
   */
  const isOverdue = (invoice: PaymentInvoice): boolean => {
    if (!invoice.due_date) return false;
    // A refunded invoice was paid — the money arrived and then went back — so
    // it can never be late. Without these two it would start showing as overdue
    // the moment its due date passed, chasing a client who already paid.
    if (['paid', 'cancelled', 'draft', 'refunded', 'partially_refunded'].includes(invoice.status)) {
      return false;
    }

    const due = new Date(invoice.due_date);
    const dueMidnight = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    return todayMidnight > dueMidnight;
  };

  const translatePaymentTerms = (terms: string | null | undefined): string => {
    if (!terms) return '-';

    // Try to match common payment term patterns
    const termsLower = terms.toLowerCase();

    // Check for exact matches with translation keys
    const termMappings: Record<string, string> = {
      'due on receipt': 'due_on_receipt',
      'receipt': 'due_on_receipt',
      'net 7': 'net_7',
      'net 7 days': 'net_7',
      'net 15': 'net_15',
      'net 15 days': 'net_15',
      'net 30': 'net_30',
      'net 30 days': 'net_30',
      'net 60': 'net_60',
      'net 60 days': 'net_60',
      'net 90': 'net_90',
      'net 90 days': 'net_90',
      'net7': 'net_7',
      'net15': 'net_15',
      'net30': 'net_30',
      'net60': 'net_60',
      'net90': 'net_90',
      'net_7': 'net_7',
      'net_15': 'net_15',
      'net_30': 'net_30',
      'net_60': 'net_60',
      'net_90': 'net_90',
      'due_on_receipt': 'due_on_receipt',
      'custom': 'custom'
    };

    const mappedKey = termMappings[termsLower];
    if (mappedKey) {
      return t(`invoice.payment_terms_values.${mappedKey}`) || terms;
    }

    // Return original if no translation found
    return terms;
  };

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
      {/* Stats Summary Bar - Modern Design */}
      {/* Where the failures that used to be browser alerts land. Dismissible,
          because it reports the last action rather than the state of the list. */}
      {listError && (
        <div
          className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20"
          style={{ borderRadius: 'var(--v2-radius-card)' }}
        >
          <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          <p className="text-sm text-red-600 dark:text-red-400 flex-1 leading-relaxed">{listError}</p>
          <button
            onClick={() => setListError(null)}
            className="text-red-500 hover:text-red-700 shrink-0"
            aria-label={t('button.cancel')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {/* Draft */}
          <button
            onClick={() => setFilter(filter === 'draft' ? 'all' : 'draft')}
            className={`relative p-4 bg-[var(--v2-surface)] border-2 transition-all duration-200 text-start group overflow-hidden ${
              filter === 'draft'
                ? 'border-gray-400 dark:border-gray-500 shadow-md'
                : 'border-transparent hover:border-gray-300 dark:hover:border-gray-600'
            }`}
            style={{ borderRadius: 'var(--v2-radius-card)' }}
          >
            <div className="absolute top-0 start-0 w-1 h-full bg-gray-400" />
            <div className="flex items-center gap-2 mb-2">
              <div className="w-2 h-2 rounded-full bg-gray-400" />
              <span className={`text-xs font-semibold text-gray-500 dark:text-gray-400 ${isRTL ? '' : 'uppercase tracking-wider'}`}>
                {t('payments.invoice_status.draft') || 'Draft'}
              </span>
            </div>
            <div className="text-2xl font-bold text-[var(--v2-text-primary)] mb-0.5">
              {formatStatAmount(stats.draft.total)}
            </div>
            <div className="text-xs text-[var(--v2-text-muted)]">
              {stats.draft.count} {stats.draft.count === 1 ? t('payments.invoice_singular') || 'invoice' : t('payments.invoice_plural') || 'invoices'}
            </div>
          </button>

          {/* Sent */}
          <button
            onClick={() => setFilter(filter === 'sent' ? 'all' : 'sent')}
            className={`relative p-4 bg-[var(--v2-surface)] border-2 transition-all duration-200 text-start group overflow-hidden ${
              filter === 'sent'
                ? 'border-blue-400 dark:border-blue-500 shadow-md'
                : 'border-transparent hover:border-blue-300 dark:hover:border-blue-600'
            }`}
            style={{ borderRadius: 'var(--v2-radius-card)' }}
          >
            <div className="absolute top-0 start-0 w-1 h-full bg-blue-500" />
            <div className="flex items-center gap-2 mb-2">
              <div className="w-2 h-2 rounded-full bg-blue-500" />
              <span className={`text-xs font-semibold text-blue-600 dark:text-blue-400 ${isRTL ? '' : 'uppercase tracking-wider'}`}>
                {t('payments.invoice_status.sent') || 'Sent'}
              </span>
            </div>
            <div className="text-2xl font-bold text-[var(--v2-text-primary)] mb-0.5">
              {formatStatAmount(stats.sent.total)}
            </div>
            <div className="text-xs text-[var(--v2-text-muted)]">
              {stats.sent.count} {stats.sent.count === 1 ? t('payments.invoice_singular') || 'invoice' : t('payments.invoice_plural') || 'invoices'}
            </div>
          </button>

          {/* Paid */}
          <button
            onClick={() => setFilter(filter === 'paid' ? 'all' : 'paid')}
            className={`relative p-4 bg-[var(--v2-surface)] border-2 transition-all duration-200 text-start group overflow-hidden ${
              filter === 'paid'
                ? 'border-emerald-400 dark:border-emerald-500 shadow-md'
                : 'border-transparent hover:border-emerald-300 dark:hover:border-emerald-600'
            }`}
            style={{ borderRadius: 'var(--v2-radius-card)' }}
          >
            <div className="absolute top-0 start-0 w-1 h-full bg-emerald-500" />
            <div className="flex items-center gap-2 mb-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className={`text-xs font-semibold text-emerald-600 dark:text-emerald-400 ${isRTL ? '' : 'uppercase tracking-wider'}`}>
                {t('payments.invoice_status.paid') || 'Paid'}
              </span>
            </div>
            <div className="text-2xl font-bold text-[var(--v2-text-primary)] mb-0.5">
              {formatStatAmount(stats.paid.total)}
            </div>
            <div className="text-xs text-[var(--v2-text-muted)]">
              {stats.paid.count} {stats.paid.count === 1 ? t('payments.invoice_singular') || 'invoice' : t('payments.invoice_plural') || 'invoices'}
            </div>
          </button>

          {/* Overdue */}
          <button
            onClick={() => setFilter(filter === 'overdue' ? 'all' : 'overdue')}
            className={`relative p-4 bg-[var(--v2-surface)] border-2 transition-all duration-200 text-start group overflow-hidden ${
              filter === 'overdue'
                ? 'border-red-400 dark:border-red-500 shadow-md'
                : 'border-transparent hover:border-red-300 dark:hover:border-red-600'
            }`}
            style={{ borderRadius: 'var(--v2-radius-card)' }}
          >
            <div className="absolute top-0 start-0 w-1 h-full bg-red-500" />
            <div className="flex items-center gap-2 mb-2">
              <div className={`w-2 h-2 rounded-full bg-red-500 ${stats.overdue.count > 0 ? 'animate-pulse' : ''}`} />
              <span className={`text-xs font-semibold text-red-600 dark:text-red-400 ${isRTL ? '' : 'uppercase tracking-wider'}`}>
                {t('payments.invoice_status.overdue') || 'Overdue'}
              </span>
            </div>
            <div className="text-2xl font-bold text-[var(--v2-text-primary)] mb-0.5">
              {formatStatAmount(stats.overdue.total)}
            </div>
            <div className="text-xs text-[var(--v2-text-muted)]">
              {stats.overdue.count} {stats.overdue.count === 1 ? t('payments.invoice_singular') || 'invoice' : t('payments.invoice_plural') || 'invoices'}
            </div>
          </button>

          {/* Cancelled — money that was invoiced and then written off. Kept
              visible rather than hidden: an invoice cancelled by mistake is
              otherwise unreachable, and the total is worth knowing. */}
          <button
            onClick={() => setFilter(filter === 'cancelled' ? 'all' : 'cancelled')}
            className={`relative p-4 bg-[var(--v2-surface)] border-2 transition-all duration-200 text-start group overflow-hidden ${
              filter === 'cancelled'
                ? 'border-slate-400 dark:border-slate-500 shadow-md'
                : 'border-transparent hover:border-slate-300 dark:hover:border-slate-600'
            }`}
            style={{ borderRadius: 'var(--v2-radius-card)' }}
          >
            <div className="absolute top-0 start-0 w-1 h-full bg-slate-400" />
            <div className="flex items-center gap-2 mb-2">
              <div className="w-2 h-2 rounded-full bg-slate-400" />
              <span className={`text-xs font-semibold text-slate-500 dark:text-slate-400 ${isRTL ? '' : 'uppercase tracking-wider'}`}>
                {t('payments.invoice_status.cancelled') || 'Cancelled'}
              </span>
            </div>
            <div className="text-2xl font-bold text-[var(--v2-text-muted)] mb-0.5 line-through decoration-1">
              {formatStatAmount(stats.cancelled.total)}
            </div>
            <div className="text-xs text-[var(--v2-text-muted)]">
              {stats.cancelled.count} {stats.cancelled.count === 1 ? t('payments.invoice_singular') || 'invoice' : t('payments.invoice_plural') || 'invoices'}
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
            {t(`payments.invoice_status.${filter}`)}
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Invoices List */}
      {filteredInvoices.length === 0 ? (
        <div className="text-center py-12 bg-[var(--v2-surface)] border border-dashed border-[var(--v2-border)]" style={{ borderRadius: 'var(--v2-radius-card)' }}>
          <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-[var(--v2-bg)] flex items-center justify-center">
            <FileText className="h-6 w-6 text-[var(--v2-text-muted)]" />
          </div>
          <h3 className="text-sm font-medium text-[var(--v2-text-primary)]">{t('payments.no_invoices')}</h3>
          <p className="mt-1 text-xs text-[var(--v2-text-muted)] max-w-xs mx-auto">
            {filter === 'all' ? t('payments.no_invoices_desc') : t('payments.no_filtered_invoices').replace('{status}', t(`payments.invoice_filter.${filter}`))}
          </p>
        </div>
      ) : (
        <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] overflow-hidden" style={{ borderRadius: 'var(--v2-radius-card)' }}>
          {/* Table Header */}
          <div className={`hidden md:grid ${INVOICE_GRID} gap-3 px-4 py-2.5 bg-[var(--v2-bg)] border-b border-[var(--v2-border)] text-[10px] font-semibold text-[var(--v2-text-muted)] ${isRTL ? '' : 'uppercase tracking-wider'}`}>
            <div className="text-start">{t('payments.invoice') || 'Invoice'}</div>
            <div className="text-start">{t('payments.client') || 'Client'}</div>
            <div className="text-start">{t('payments.service') || 'Service'}</div>
            <div className={isRTL ? 'text-start' : 'text-end'}>{t('payments.due') || 'Due'}</div>
            <div className={isRTL ? 'text-start' : 'text-end'}>{t('payments.paid') || 'Paid'}</div>
            <div className={isRTL ? 'text-start' : 'text-end'}>{t('payments.amount') || 'Amount'}</div>
            <div className="text-center">{t('payments.status') || 'Status'}</div>
            <div className={isRTL ? 'text-start' : 'text-end'}>{t('payments.actions') || 'Actions'}</div>
          </div>

          {/* Table Body */}
          {filteredInvoices.map((invoice, index) => {
            const isHighlighted = highlightId === invoice.id;

            return (
              <div
                key={invoice.id}
                id={`invoice-${invoice.id}`}
                className={`group ${index !== 0 ? 'border-t border-[var(--v2-border)]' : ''} ${
                  isHighlighted ? 'bg-amber-50 dark:bg-amber-900/10' : 'hover:bg-[var(--v2-bg)]'
                } transition-colors`}
              >
                {/* Desktop row */}
                <div className={`hidden md:grid ${INVOICE_GRID} gap-3 px-4 py-3 items-center`}>
                  {/* Invoice # */}
                  <div className="min-w-0 text-start">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-[var(--v2-text-primary)]">
                        {invoice.invoice_number}
                      </span>
                      {invoice.stripe_invoice_id && (
                        <span className="px-1 py-0.5 rounded text-[8px] font-semibold bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400">
                          Stripe
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Client */}
                  <div className="min-w-0 text-start">
                    <p className="text-sm text-[var(--v2-text-primary)] truncate">
                      {invoice.client_name || '-'}
                    </p>
                    {invoice.client_email && invoice.client_name && (
                      <p className="text-[11px] text-[var(--v2-text-muted)] truncate">
                        {invoice.client_email}
                      </p>
                    )}
                  </div>

                  {/* Service */}
                  <div className="min-w-0 text-start">
                    <p className="text-sm text-[var(--v2-text-primary)] truncate">
                      {invoice.line_items && invoice.line_items.length > 0
                        ? invoice.line_items[0].description
                        : '-'}
                    </p>
                    {invoice.line_items && invoice.line_items.length > 1 && (
                      <p className="text-[11px] text-[var(--v2-text-muted)]">
                        +{invoice.line_items.length - 1} {t('payments.more_items') || 'more'}
                      </p>
                    )}
                  </div>

                  {/* Due Date — late is judged by the date, so an invoice reads
                      as overdue the day it passes rather than whenever a job
                      last rewrote its status. */}
                  <div className={`${isRTL ? 'text-start' : 'text-end'} text-sm whitespace-nowrap ${isOverdue(invoice) ? 'text-red-600 dark:text-red-400 font-medium' : 'text-[var(--v2-text-primary)]'}`}>
                    {formatDate(invoice.due_date)}
                  </div>

                  {/* Paid Date */}
                  <div className={`${isRTL ? 'text-start' : 'text-end'} text-sm whitespace-nowrap ${invoice.paid_at ? 'text-emerald-600 dark:text-emerald-400' : 'text-[var(--v2-text-muted)]'}`}>
                    {invoice.paid_at ? formatDate(invoice.paid_at) : '-'}
                  </div>

                  {/* Amount */}
                  <div className={`${isRTL ? 'text-start' : 'text-end'} text-sm font-semibold text-[var(--v2-text-primary)] whitespace-nowrap`}>
                    <bdi>{formatAmount(invoice.amount, invoice.currency)}</bdi>
                  </div>

                  {/* Status */}
                  <div className="text-center whitespace-nowrap">
                    {getStatusBadge(invoice.status)}
                  </div>

                  {/* Actions */}
                  <div className={`flex items-center ${isRTL ? 'justify-start' : 'justify-end'} gap-1.5 flex-shrink-0`}>
                    {/* Refund. Paid invoices previously offered only a PDF and a
                        link to Stripe — there was no way to return a client's
                        money from this screen at all. Shown while any of the
                        payment remains: a partially refunded invoice can still
                        give back the rest. */}
                    {(invoice.status === 'paid' || invoice.status === 'partially_refunded') &&
                      invoice.amount - (invoice.refunded_amount || 0) > 0 && (
                      <button
                        onClick={() => setRefundTarget(invoice)}
                        className="flex items-center justify-center w-9 h-9 bg-[var(--v2-surface)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] transition-colors"
                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                        title={t('payments.refund') || 'Refund'}
                      >
                        <RotateCcw className="w-5 h-5 text-orange-500" />
                      </button>
                    )}
                    {invoice.status === 'draft' && (
                      <button
                        onClick={() => handleSendInvoiceClick(invoice)}
                        disabled={actionLoading === invoice.id}
                        className="flex items-center justify-center w-9 h-9 bg-[var(--v2-surface)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] disabled:opacity-50 transition-colors"
                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                        title={t('payments.send') || 'Send'}
                      >
                        {actionLoading === invoice.id ? <Loader2 className="w-5 h-5 text-amber-500 animate-spin" /> : <Send className="w-5 h-5 text-amber-500" />}
                      </button>
                    )}
                    {(invoice.status === 'sent' || invoice.status === 'overdue') && (hasStripeConnect || invoice.stripe_invoice_id) && (
                      <button
                        onClick={() => handleCopyPaymentLink(invoice)}
                        disabled={actionLoading === invoice.id}
                        className="flex items-center justify-center w-9 h-9 bg-[var(--v2-surface)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] disabled:opacity-50 transition-colors"
                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                        title={t('payments.copy_payment_link') || 'Copy payment link'}
                      >
                        {copiedLink === invoice.id ? <Check className="w-5 h-5 text-emerald-500" /> : actionLoading === invoice.id ? <Loader2 className="w-5 h-5 text-blue-500 animate-spin" /> : <Link2 className="w-5 h-5 text-blue-500" />}
                      </button>
                    )}
                    {(invoice.status === 'sent' || invoice.status === 'overdue') && (
                      <button
                        onClick={() => handleSendInvoiceClick(invoice)}
                        disabled={actionLoading === invoice.id}
                        className="flex items-center justify-center w-9 h-9 bg-[var(--v2-surface)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] disabled:opacity-50 transition-colors"
                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                        title={t('payments.resend') || 'Resend'}
                      >
                        <Mail className="w-5 h-5 text-emerald-500" />
                      </button>
                    )}
                    <button
                      onClick={() => handleDownloadPDF(invoice)}
                      disabled={actionLoading === invoice.id}
                      className="flex items-center justify-center w-9 h-9 bg-[var(--v2-surface)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] disabled:opacity-50 transition-colors"
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                      title={t('payments.download_pdf') || 'Download PDF'}
                    >
                      <Download className="w-5 h-5 text-[var(--v2-text-secondary)]" />
                    </button>
                    {invoice.stripe_hosted_invoice_url && (
                      <button
                        onClick={() => handleViewInStripe(invoice)}
                        className="flex items-center justify-center w-9 h-9 bg-[var(--v2-surface)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] transition-colors"
                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                        title={t('payments.view_in_stripe') || 'View in Stripe'}
                      >
                        <ExternalLink className="w-5 h-5 text-violet-500" />
                      </button>
                    )}
                    {['draft', 'sent', 'overdue'].includes(invoice.status) && (
                      <button
                        onClick={() => { setVoidError(null); setVoidTarget(invoice); }}
                        disabled={actionLoading === invoice.id}
                        className="flex items-center justify-center w-9 h-9 bg-[var(--v2-surface)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] disabled:opacity-50 transition-colors"
                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                        title={t('payments.void_invoice') || 'Void Invoice'}
                      >
                        <X className="w-5 h-5 text-red-500" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Mobile row */}
                <div className="md:hidden p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-semibold text-[var(--v2-text-primary)]">{invoice.invoice_number}</span>
                      {getStatusBadge(invoice.status)}
                    </div>
                    <span className="text-sm font-bold text-[var(--v2-text-primary)]">
                      <bdi>{formatAmount(invoice.amount, invoice.currency)}</bdi>
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-[var(--v2-text-muted)]">
                    <span className="truncate">{invoice.client_name || invoice.client_email || t('payments.unknown_client')}</span>
                    <span className={invoice.status === 'overdue' ? 'text-red-600' : ''}>{formatDate(invoice.due_date)}</span>
                  </div>
                  <div className="flex items-center gap-1.5 pt-1">
                    {invoice.status === 'draft' && (
                      <Button size="sm" onClick={() => handleSendInvoiceClick(invoice)} disabled={actionLoading === invoice.id} className="h-7 px-2.5 text-xs text-white flex-1" style={{ background: 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)' }}>
                        <Send className="h-3.5 w-3.5 me-1" />{t('payments.send')}
                      </Button>
                    )}
                    {(invoice.status === 'sent' || invoice.status === 'overdue') && (hasStripeConnect || invoice.stripe_invoice_id) && (
                      <Button size="sm" onClick={() => handleCopyPaymentLink(invoice)} disabled={actionLoading === invoice.id} className="h-7 px-2.5 text-xs bg-blue-600 hover:bg-blue-700 text-white flex-1">
                        <Link2 className="h-3.5 w-3.5 me-1" />{t('payments.copy_link')}
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => handleDownloadPDF(invoice)} className="h-7 px-2.5 text-xs">
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                    {['draft', 'sent', 'overdue'].includes(invoice.status) && (
                      <Button variant="outline" size="sm" onClick={() => { setVoidError(null); setVoidTarget(invoice); }} className="h-7 px-2.5 text-xs text-red-600 border-red-200">
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination Controls */}
      {totalCount > PAGE_SIZE && (
        <div className="flex items-center justify-between p-4 bg-[var(--v2-surface)] border border-[var(--v2-border)]" style={{ borderRadius: 'var(--v2-radius-card)' }}>
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
                    fetchInvoices(prevPage);
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
                            fetchInvoices(pageNum - 1);
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
                    fetchInvoices(nextPage);
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

      {/* Create Invoice Modal */}
      {showCreateModal && (
        <InvoiceModal
          // Required by the modal and never passed; the `showCreateModal &&`
          // above is what actually gated it, so `isOpen` arrived undefined.
          isOpen
          onClose={() => setShowCreateModal(false)}
          onSave={() => {
            setShowCreateModal(false);
            fetchInvoices();
          }}
        />
      )}

      {/* Refund Modal — a SIBLING of the create modal, not a child of it.
          Refunding an invoice has nothing to do with creating one, so gating it
          on showCreateModal would have meant it could only ever open while the
          create dialog was already up. */}
      {refundTarget && (
        <RefundModal
          isOpen={!!refundTarget}
          onClose={() => setRefundTarget(null)}
          /* The invoice is named, not a transaction: the server resolves which
             payment sits behind it, so this list never has to know. */
          invoiceId={refundTarget.id}
          originalAmount={refundTarget.amount}
          currency={refundTarget.currency}
          alreadyRefunded={refundTarget.refunded_amount || 0}
          contactName={refundTarget.client_name || undefined}
          isRTL={isRTL}
          onSuccess={() => { setRefundTarget(null); fetchInvoices(); }}
          onError={(message) => logger.error({ message }, 'Refund failed')}
        />
      )}

      {/* Send Method Selection Modal */}
      {showSendModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setShowSendModal(null)}
          />

          {/* Modal */}
          <div
            className="relative bg-[var(--v2-surface)] border border-[var(--v2-border)] shadow-2xl w-full max-w-md"
            style={{ borderRadius: 'var(--v2-radius-card)' }}
            dir={isRTL ? 'rtl' : 'ltr'}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-[var(--v2-border)]">
              <div>
                <h2 className="text-lg font-bold text-[var(--v2-text-primary)]">
                  {t('payments.send_method.title') || 'Send Invoice'}
                </h2>
                <p className="text-sm text-[var(--v2-text-muted)] mt-0.5">
                  {showSendModal.invoice_number} • {formatAmount(showSendModal.amount, showSendModal.currency)}
                </p>
              </div>
              <button
                onClick={() => setShowSendModal(null)}
                className="p-2 rounded-full hover:bg-[var(--v2-bg)] transition-colors"
              >
                <X className="h-5 w-5 text-[var(--v2-text-muted)]" />
              </button>
            </div>

            {/* Options */}
            <div className="p-5 space-y-3">
              <p className="text-sm text-[var(--v2-text-muted)] mb-4">
                {t('payments.send_method.description') || 'Choose how to send this invoice:'}
              </p>

              {/* Email with PDF option */}
              <button
                onClick={() => handleSendInvoice(showSendModal.id, false)}
                className="w-full p-4 text-start bg-[var(--v2-bg)] border-2 border-[var(--v2-border)] hover:border-blue-400 hover:bg-blue-50/50 dark:hover:bg-blue-900/10 transition-all group"
                style={{ borderRadius: 'var(--v2-radius-card)' }}
              >
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0 group-hover:bg-blue-200 dark:group-hover:bg-blue-800/40 transition-colors">
                    <Mail className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-[var(--v2-text-primary)] group-hover:text-blue-700 dark:group-hover:text-blue-300 transition-colors">
                      {t('payments.send_method.email_title') || 'Email with PDF'}
                    </h3>
                    <p className="text-sm text-[var(--v2-text-muted)] mt-1">
                      {t('payments.send_method.email_description') || 'Send an email with the invoice PDF attached. Client can pay via the payment link in the email.'}
                    </p>
                    <span className="inline-flex items-center gap-1.5 mt-2 text-xs font-medium text-blue-600 dark:text-blue-400">
                      <Check className="h-3.5 w-3.5" />
                      {t('payments.send_method.recommended') || 'Recommended'}
                    </span>
                  </div>
                </div>
              </button>

              {/* Stripe option */}
              <button
                onClick={() => handleSendInvoice(showSendModal.id, true)}
                className="w-full p-4 text-start bg-[var(--v2-bg)] border-2 border-[var(--v2-border)] hover:border-violet-400 hover:bg-violet-50/50 dark:hover:bg-violet-900/10 transition-all group"
                style={{ borderRadius: 'var(--v2-radius-card)' }}
              >
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center flex-shrink-0 group-hover:bg-violet-200 dark:group-hover:bg-violet-800/40 transition-colors">
                    <CreditCard className="h-6 w-6 text-violet-600 dark:text-violet-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-[var(--v2-text-primary)] group-hover:text-violet-700 dark:group-hover:text-violet-300 transition-colors flex items-center gap-2">
                      {t('payments.send_method.stripe_title') || 'Stripe Invoice'}
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-100 dark:bg-violet-900/50 text-violet-700 dark:text-violet-300 uppercase">
                        Stripe
                      </span>
                    </h3>
                    <p className="text-sm text-[var(--v2-text-muted)] mt-1">
                      {t('payments.send_method.stripe_description') || 'Create a Stripe invoice with professional payment page. Stripe will send the email and handle payment tracking.'}
                    </p>
                  </div>
                </div>
              </button>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-[var(--v2-border)] bg-[var(--v2-bg)]" style={{ borderRadius: '0 0 var(--v2-radius-card) var(--v2-radius-card)' }}>
              <p className="text-xs text-[var(--v2-text-muted)] text-center">
                {t('payments.send_method.client_info') || 'Invoice will be sent to'}: <span className="font-medium text-[var(--v2-text-primary)]">{showSendModal.client_email}</span>
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Void confirmation. The platform dialog rather than a browser confirm:
          it can name the invoice, say what voiding actually does to a document
          the client may already be holding, and show the server's refusal in
          place instead of a second popup. */}
      <Dialog
        open={!!voidTarget}
        onOpenChange={open => {
          if (!open) {
            setVoidTarget(null);
            setVoidError(null);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
              {t('payments.void_title')}
            </DialogTitle>
          </DialogHeader>

          {voidTarget && (
            <div className="space-y-3">
              <div
                className="flex items-center justify-between gap-3 p-3 bg-[var(--v2-bg)] border border-[var(--v2-border)]"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[var(--v2-text-primary)]">
                    {voidTarget.invoice_number}
                  </p>
                  <p className="text-xs text-[var(--v2-text-muted)] truncate">
                    {voidTarget.client_name || voidTarget.client_email || t('payments.unknown_client')}
                  </p>
                </div>
                <span className="text-sm font-bold text-[var(--v2-text-primary)] shrink-0">
                  <bdi>{formatAmount(voidTarget.amount, voidTarget.currency)}</bdi>
                </span>
              </div>

              {/* A draft was never sent, so voiding it costs the client nothing.
                  One the client has already received is a document they hold,
                  and voiding it is a statement to them — worth saying so. */}
              <p className="text-sm text-[var(--v2-text-secondary)] leading-relaxed">
                {voidTarget.status === 'draft'
                  ? t('payments.void_body_draft')
                  : t('payments.void_body_sent')}
              </p>

              {voidError && (
                <p
                  className="text-sm text-red-600 dark:text-red-400 p-3 bg-red-500/10 border border-red-500/20 leading-relaxed"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  {voidError}
                </p>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <Button
                  variant="outline"
                  onClick={() => {
                    setVoidTarget(null);
                    setVoidError(null);
                  }}
                  disabled={actionLoading === voidTarget.id}
                >
                  {t('button.cancel')}
                </Button>
                <Button
                  onClick={handleVoidInvoice}
                  disabled={actionLoading === voidTarget.id}
                  className="bg-red-600 hover:bg-red-700 text-white"
                >
                  {actionLoading === voidTarget.id && (
                    <Loader2 className="w-4 h-4 me-2 animate-spin" />
                  )}
                  {t('payments.void_confirm')}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
