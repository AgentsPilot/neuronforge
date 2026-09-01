'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { MetricCard } from '@/components/business-os/reports/MetricCard';
import { RevenueSourcesSection } from '@/components/business-os/reports/RevenueSourcesSection';
import { FinancialHealthGrid } from '@/components/business-os/reports/FinancialHealthGrid';
import { RevenueByServicesSection } from '@/components/business-os/reports/RevenueByServicesSection';
import {
  ArrowLeft,
  BarChart3,
  LayoutDashboard,
  List,
  FileText,
  Search,
  Download,
  Plus,
  Banknote,
  TrendingUp,
  Clock,
  Receipt
} from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { PAGE_CONTAINER } from '@/lib/business-os/pageContainer';

import {
  PERFORMANCE_THRESHOLDS,
  REPORTS_COLORS
} from '@/lib/business-os/reports/constants';

/**
 * Money moved to /business-os/payments and this page is charts again.
 *
 * It used to carry both, switched by a `ViewMode`, which meant every toolbar
 * control was wrapped in `viewMode === 'money' &&` and neither half could be
 * linked to honestly. The old `?tab=invoices|transactions|money` links still
 * work — they redirect below — because one of them is built by the Stripe
 * Connect callback and is where somebody lands returning from onboarding.
 */

/** Reporting window, passed straight through to /api/business-os/stats. */
type ReportPeriod = 'week' | 'month' | 'year' | 'all';

const REPORT_PERIODS: { value: ReportPeriod; key: string; fallback: string }[] = [
  { value: 'week', key: 'reports.period_week', fallback: 'Week' },
  { value: 'month', key: 'reports.period_month', fallback: 'Month' },
  { value: 'year', key: 'reports.period_year', fallback: 'Year' },
  { value: 'all', key: 'reports.period_all', fallback: 'All time' }
];

export default function ReportsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t, language, formatCurrency } = useLanguage();

  const [loading, setLoading] = useState(true);
  // Reporting window. 'month' matches what this page showed before the filter existed.
  const [period, setPeriod] = useState<ReportPeriod>('month');
  // Switching period refetches in the background: the numbers on screen stay put
  // and fade slightly instead of the page collapsing into the full-page spinner.
  const [isRefreshing, setIsRefreshing] = useState(false);
  const hasLoadedOnceRef = useRef(false);

  // Stats from the API
  const [stats, setStats] = useState<{
    payments: {
      revenue_30d: number;
      revenue_paid_30d: number;
      revenue_owed_30d: number;
      pending_invoices: number;
      pending_invoices_amount: number;
      revenue_this_week: number;
      revenue_last_week: number;
      successful_transactions_30d: number;
      failed_transactions_30d: number;
      refunded_30d: number;
      invoices_sent_30d: number;
      invoices_paid_30d: number;
      invoices_overdue: number;
      invoices_overdue_amount: number;
      average_invoice_amount: number;
      transactions_revenue_30d: number;
      invoices_paid_amount_30d: number;
    };
    scheduling: {
      total_revenue_30d: number;
      completed_30d: number;
      service_revenue: Array<{
        service_id: string;
        service_name: string;
        revenue: number;
        count: number;
      }>;
    };
  } | null>(null);

  // Invoice modal state

  // Fetch stats on mount and whenever the reporting window changes.
  // Only the very first load blocks the page; period changes refresh silently.
  useEffect(() => {
    fetchStats({ silent: hasLoadedOnceRef.current });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  // Money asked for here now lives at /business-os/payments.
  //
  // Forwarded rather than dropped, with the parameters carried across: these
  // links are in the wild — in the CRM drawer, in chat replies, and in the URL
  // the Stripe Connect callback sends people back to. `replace` rather than
  // `push` so the back button does not bounce off this page.
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab !== 'invoices' && tab !== 'transactions' && tab !== 'money') return;

    const forwarded = new URLSearchParams();
    for (const key of ['invoice', 'transaction', 'filter', 'action']) {
      const value = searchParams.get(key);
      if (value) forwarded.set(key, value);
    }

    const query = forwarded.toString();
    router.replace(`/business-os/payments${query ? `?${query}` : ''}`);
  }, [searchParams, router]);

  const fetchStats = async ({ silent = false }: { silent?: boolean } = {}) => {
    try {
      if (silent) {
        setIsRefreshing(true);
      } else {
        setLoading(true);
      }
      const response = await fetch(`/api/business-os/stats?period=${period}`, { cache: 'no-store' });
      const data = await response.json();

      if (data.success && data.stats) {
        setStats({
          payments: {
            revenue_30d: data.stats.payments?.revenue_30d || 0,
            revenue_paid_30d: data.stats.payments?.revenue_paid_30d || 0,
            revenue_owed_30d: data.stats.payments?.revenue_owed_30d || 0,
            pending_invoices: data.stats.payments?.pending_invoices || 0,
            pending_invoices_amount: data.stats.payments?.pending_invoices_amount || 0,
            revenue_this_week: data.stats.payments?.revenue_this_week || 0,
            revenue_last_week: data.stats.payments?.revenue_last_week || 0,
            successful_transactions_30d: data.stats.payments?.successful_transactions_30d || 0,
            failed_transactions_30d: data.stats.payments?.failed_transactions_30d || 0,
            refunded_30d: data.stats.payments?.refunded_30d || 0,
            invoices_sent_30d: data.stats.payments?.invoices_sent_30d || 0,
            invoices_paid_30d: data.stats.payments?.invoices_paid_30d || 0,
            invoices_overdue: data.stats.payments?.invoices_overdue || 0,
            invoices_overdue_amount: data.stats.payments?.invoices_overdue_amount || 0,
            average_invoice_amount: data.stats.payments?.average_invoice_amount || 0,
            transactions_revenue_30d: data.stats.payments?.transactions_revenue_30d || 0,
            invoices_paid_amount_30d: data.stats.payments?.invoices_paid_amount_30d || 0
          },
          scheduling: {
            total_revenue_30d: data.stats.scheduling?.total_revenue_30d || 0,
            completed_30d: data.stats.scheduling?.completed_30d || 0,
            service_revenue: data.stats.scheduling?.service_revenue || []
          }
        });
      }
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    } finally {
      hasLoadedOnceRef.current = true;
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  // Export all transactions to CSV
  const handleExportAllTransactions = async () => {
    try {
      // Fetch all transactions (no pagination limit)
      const response = await fetch('/api/payments/transactions?limit=10000&offset=0');
      const result = await response.json();

      if (!result.success || !result.data || result.data.length === 0) {
        return;
      }

      const transactions = result.data;

      // Define CSV headers
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

      // Map transactions to CSV rows
      const rows = transactions.map((tx: {
        paid_at?: string | null;
        created_at: string;
        contact?: { first_name?: string | null; last_name?: string | null; email?: string | null } | null;
        amount: number;
        currency: string;
        status: string;
        payment_method?: string | null;
        description?: string | null;
        refund_status?: string | null;
        refunded_amount?: number | null;
        stripe_payment_intent_id?: string | null;
        stripe_charge_id?: string | null;
        id: string;
      }) => {
        const contactName = tx.contact
          ? `${tx.contact.first_name || ''} ${tx.contact.last_name || ''}`.trim()
          : '-';
        const hasRefund = tx.refund_status === 'partial' || tx.refund_status === 'full';
        return [
          tx.paid_at || tx.created_at ? new Date(tx.paid_at || tx.created_at).toLocaleDateString() : '',
          contactName,
          tx.contact?.email || '-',
          tx.amount.toFixed(2),
          tx.currency,
          t(`payments.status.${tx.status}`) || tx.status,
          tx.payment_method ? (t(`payments.payment_method.${tx.payment_method}`) || tx.payment_method) : '-',
          tx.description || '-',
          hasRefund ? (t(`payments.refund_status.${tx.refund_status}`) || tx.refund_status) : '-',
          tx.refunded_amount ? tx.refunded_amount.toFixed(2) : '-',
          tx.stripe_payment_intent_id || tx.stripe_charge_id || tx.id
        ];
      });

      // Create CSV content
      const csvContent = [
        headers.join(','),
        ...rows.map((row: string[]) => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      ].join('\n');

      // Create and trigger download
      const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `all_payments_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
    } catch (error) {
      console.error('Failed to export transactions:', error);
    }
  };

  const isRTL = language === 'he';

  return (
    <div className="min-h-screen bg-[var(--v2-bg)]" dir={isRTL ? 'rtl' : 'ltr'}>

      {/* Main Content */}
      <div className={`${PAGE_CONTAINER} py-4 sm:py-6 space-y-4`}>

        {/* Page Header - Compact */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: 'rgba(34, 197, 139, 0.2)' }}
            >
              <BarChart3 className="w-4 h-4 sm:w-5 sm:h-5" style={{ color: REPORTS_COLORS.PRIMARY }} />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-semibold text-[var(--v2-text-primary)] truncate">
                {t('reports.title') || 'Cash Flow & Financials'}
              </h1>
              <p className="text-xs text-[var(--v2-text-secondary)] hidden sm:block">
                {t('reports.subtitle') || 'Your business financial overview'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto">
            {/* Back to Dashboard */}
            <button
              onClick={() => router.push('/business-os')}
              className="p-2 text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] bg-[var(--v2-surface)] border border-[var(--v2-border)] transition-all hover:bg-[var(--v2-border)] flex-shrink-0"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
              title={t('reports.back_to_dashboard') || 'Back to dashboard'}
            >
              <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
            </button>

          </div>
        </div>

        {/* Loading state */}
        {loading ? (
          <div className="flex items-center justify-center min-h-[300px]">
            <div className="text-center space-y-3">
              <div
                className="w-12 h-12 border-3 border-t-transparent rounded-full animate-spin mx-auto"
                style={{ borderColor: REPORTS_COLORS.PRIMARY, borderTopColor: 'transparent' }}
              />
              <p className="text-sm text-[var(--v2-text-secondary)]">{t('reports.loading') || 'Loading...'}</p>
            </div>
          </div>
        ) : (
          /* Financial Dashboard */
          <div className="space-y-4 max-w-7xl mx-auto">
            {/* Reporting window */}
            <div
              className="inline-flex items-center gap-1 p-1 border border-[var(--v2-border)] bg-[var(--v2-surface)]"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
              role="group"
              aria-label={t('reports.period_label') || 'Reporting period'}
            >
              {REPORT_PERIODS.map(({ value, key, fallback }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setPeriod(value)}
                  disabled={isRefreshing && period !== value}
                  aria-pressed={period === value}
                  className={`px-3 py-1.5 text-sm font-medium transition-all border disabled:cursor-default ${
                    period === value
                      ? 'text-[#22C58B] border-[#22C58B] bg-[#22C58B]/10'
                      : 'text-[var(--v2-text-secondary)] border-transparent hover:text-[var(--v2-text-primary)]'
                  }`}
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  {t(key) || fallback}
                </button>
              ))}
            </div>

            {/* Numbers stay on screen while the new window loads, dimmed so it's
                clear they're the previous period's figures. */}
            <div
              className="space-y-4 transition-opacity duration-200"
              style={{ opacity: isRefreshing ? 0.45 : 1 }}
              aria-busy={isRefreshing}
            >

            {/* Key Financial Metrics - 4 Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Total Revenue (30d) */}
              <MetricCard
                icon={Banknote}
                iconColor={REPORTS_COLORS.PRIMARY}
                label={t('reports.total_revenue') || 'Total Revenue'}
                value={formatCurrency(stats?.payments.revenue_30d || 0, { showFree: false })}
                subtitle={(() => {
                  const paid = stats?.payments.revenue_paid_30d || 0;
                  const owed = stats?.payments.revenue_owed_30d || 0;

                  return `${t('reports.paid') || 'Paid'}: ${formatCurrency(paid, { showFree: false })} • ${t('reports.owed') || 'Owed'}: ${formatCurrency(owed, { showFree: false })}`;
                })()}
                // The money it is summarising now lives on its own page.
                onAction={() => router.push('/business-os/payments')}
                actionLabel={t('reports.view_money') || 'View money'}
              />

              {/* Revenue This Week */}
              <MetricCard
                icon={TrendingUp}
                iconColor={REPORTS_COLORS.PRIMARY}
                label={t('reports.this_week') || 'This Week'}
                value={formatCurrency(stats?.payments.revenue_this_week || 0, { showFree: false })}
                subtitle={t('reports.last_7_days') || 'Last 7 days'}
                trend={{
                  value: formatCurrency(Math.abs((stats?.payments.revenue_this_week || 0) - (stats?.payments.revenue_last_week || 0)), { showFree: false }),
                  isPositive: (stats?.payments.revenue_this_week || 0) >= (stats?.payments.revenue_last_week || 0),
                  text: t('reports.from_last_week') || 'from last week'
                }}
              />

              {/* Pending Invoices */}
              <MetricCard
                icon={Clock}
                iconColor={REPORTS_COLORS.WARNING}
                label={t('reports.pending_invoices') || 'Pending Invoices'}
                value={formatCurrency(stats?.payments.pending_invoices_amount || 0, { showFree: false })}
                subtitle={`${stats?.payments.pending_invoices || 0} ${t('reports.invoices') || 'invoices'} • ${stats?.payments.invoices_overdue || 0} ${t('reports.overdue') || 'overdue'}`}
                // The money it is summarising now lives on its own page.
                onAction={() => router.push('/business-os/payments')}
                actionLabel={t('reports.view_money') || 'View money'}
              />

              {/* Average Invoice */}
              <MetricCard
                icon={Receipt}
                iconColor={REPORTS_COLORS.ACCENT}
                label={t('reports.average_invoice') || 'Average Invoice'}
                value={formatCurrency(stats?.payments.average_invoice_amount || 0, { showFree: false })}
                subtitle={t('reports.per_paid_invoice') || 'Per paid invoice'}
              />
            </div>

            {/* Revenue Sources */}
            <RevenueSourcesSection
              payments={{
                type: 'payments',
                amount: stats?.payments.transactions_revenue_30d || 0,
                count: stats?.payments.successful_transactions_30d || 0
              }}
              invoices={{
                type: 'invoices',
                amount: (stats?.payments.invoices_paid_amount_30d || 0) + (stats?.payments.pending_invoices_amount || 0),
                count: (stats?.payments.invoices_paid_30d || 0) + (stats?.payments.pending_invoices || 0),
                paid: stats?.payments.invoices_paid_amount_30d || 0,
                outstanding: stats?.payments.pending_invoices_amount || 0
              }}
            />


            {/* Financial Health */}
            <FinancialHealthGrid
              successRate={{
                value: `${Math.round(((stats?.payments.successful_transactions_30d || 0) / Math.max((stats?.payments.successful_transactions_30d || 0) + (stats?.payments.failed_transactions_30d || 0), 1)) * 100)}%`,
                subtitle: language === 'he'
                  ? `${t('reports.transactions')} ${stats?.payments.successful_transactions_30d || 0} ${t('reports.of')} ${(stats?.payments.successful_transactions_30d || 0) + (stats?.payments.failed_transactions_30d || 0)}`
                  : `${stats?.payments.successful_transactions_30d || 0} ${t('reports.of')} ${(stats?.payments.successful_transactions_30d || 0) + (stats?.payments.failed_transactions_30d || 0)} ${t('reports.transactions')}`,
                status: ((stats?.payments.successful_transactions_30d || 0) / Math.max((stats?.payments.successful_transactions_30d || 0) + (stats?.payments.failed_transactions_30d || 0), 1)) >= PERFORMANCE_THRESHOLDS.SUCCESS_RATE_GOOD ? 'success' : 'warning'
              }}
              collectionRate={{
                value: `${Math.min(100, Math.round(((stats?.payments.invoices_paid_30d || 0) / Math.max(stats?.payments.invoices_sent_30d || 0, 1)) * 100))}%`,
                subtitle: language === 'he'
                  ? `${t('reports.invoices_paid')} ${stats?.payments.invoices_paid_30d || 0} ${t('reports.of')} ${stats?.payments.invoices_sent_30d || 0}`
                  : `${stats?.payments.invoices_paid_30d || 0} ${t('reports.of')} ${stats?.payments.invoices_sent_30d || 0} ${t('reports.invoices_paid')}`,
                status: ((stats?.payments.invoices_paid_30d || 0) / Math.max(stats?.payments.invoices_sent_30d || 0, 1)) >= PERFORMANCE_THRESHOLDS.COLLECTION_RATE_GOOD ? 'success' : 'warning'
              }}
              outstanding={{
                value: formatCurrency(stats?.payments.invoices_overdue_amount || 0, { showFree: false }),
                subtitle: `${stats?.payments.invoices_overdue || 0} ${t('reports.overdue_invoices')}`,
                status: (stats?.payments.invoices_overdue || 0) === PERFORMANCE_THRESHOLDS.OUTSTANDING_GOOD ? 'success' : (stats?.payments.invoices_overdue || 0) <= PERFORMANCE_THRESHOLDS.OUTSTANDING_WARNING ? 'warning' : 'danger'
              }}
              refundRate={{
                value: `${Math.round(((stats?.payments.refunded_30d || 0) / Math.max(stats?.payments.successful_transactions_30d || 0, 1)) * 100)}%`,
                subtitle: `${stats?.payments.refunded_30d || 0} ${t('reports.refunded')}`,
                status: ((stats?.payments.refunded_30d || 0) / Math.max(stats?.payments.successful_transactions_30d || 0, 1)) <= PERFORMANCE_THRESHOLDS.REFUND_RATE_GOOD ? 'success' : 'warning'
              }}
            />

              {/* Revenue by Services */}
              <RevenueByServicesSection
                services={stats?.scheduling.service_revenue || []}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
