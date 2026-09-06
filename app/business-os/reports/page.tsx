'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { MetricCard } from '@/components/business-os/reports/MetricCard';
import { RevenueSourcesSection } from '@/components/business-os/reports/RevenueSourcesSection';
import { FinancialHealthGrid } from '@/components/business-os/reports/FinancialHealthGrid';
import { RevenueByServicesSection } from '@/components/business-os/reports/RevenueByServicesSection';
import {
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
import { useLanguage, type CurrencyCode } from '@/lib/business-os/LanguageContext';
import { createLogger } from '@/lib/logger';
import { LedgerExportModal } from '@/components/payments/LedgerExportModal';
import { PAGE_CONTAINER } from '@/lib/business-os/pageContainer';

import {
  PERFORMANCE_THRESHOLDS,
  REPORTS_COLORS
} from '@/lib/business-os/reports/constants';

/**
 * Money moved to /business-os/orders and this page is charts again.
 *
 * It used to carry both, switched by a `ViewMode`, which meant every toolbar
 * control was wrapped in `viewMode === 'money' &&` and neither half could be
 * linked to honestly. The old `?tab=invoices|transactions|money` links still
 * work — they redirect below — because one of them is built by the Stripe
 * Connect callback and is where somebody lands returning from onboarding.
 */

/** Reporting window, passed straight through to /api/business-os/stats. */
type ReportPeriod = 'week' | 'month' | 'year' | 'all';

const logger = createLogger({ module: 'ReportsPage' });

/** What `formatCurrency` knows how to render; anything else uses the default. */
const SUPPORTED_CURRENCIES: CurrencyCode[] = ['USD', 'EUR', 'ILS', 'GBP'];

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
  const [showLedgerExport, setShowLedgerExport] = useState(false);
  // Switching period refetches in the background: the numbers on screen stay put
  // and fade slightly instead of the page collapsing into the full-page spinner.
  const [isRefreshing, setIsRefreshing] = useState(false);
  const hasLoadedOnceRef = useRef(false);

  // Stats from the API
  /*
   * Money is rendered in ITS OWN currency, never the reader's.
   *
   * `formatCurrency` from the language context defaults to a currency chosen
   * from the interface language — Hebrew means shekels. Every figure on this
   * page is a total the API computed from rows that carry their own currency,
   * and this account bills in dollars, so the page was printing ₪ over USD
   * amounts. At roughly 3.7 to 1 that is not a rounding difference, it is a
   * different number.
   *
   * `primary_currency` is what the API says those totals are in. The language
   * default survives only for the case where nothing was collected and there
   * is genuinely no currency to name.
   */
  const [stats, setStats] = useState<{
    payments: {
      revenue_30d: number;
      revenue_paid_30d: number;
      /** Refunds issued in the period, from the ledger. Net of nothing else. */
      refunds_amount_30d: number;
      /** Collected before refunds, so the card's figures add up. */
      gross_revenue_30d: number;
      /** What the processor kept out of the period's payments. */
      processor_fees_30d: number;
      /** Of those, the part spent collecting money that was later refunded. */
      refund_fees_kept_30d: number;
      /**
       * Gross, refunds and net per currency — the only figures that may
       * honestly be added. Every headline total on this page is a sum ACROSS
       * currencies, which is meaningful only while there is one.
       */
      revenue_by_currency: { currency: string; gross: number; net: number }[];
      /**
       * The currency the figures above are denominated in.
       *
       * Null when nothing was collected. Never inferred from the interface
       * language — that is how a business billing in dollars and reading in
       * Hebrew saw every amount stamped ₪.
       */
      primary_currency: string | null;
      revenue_owed_30d: number;
      pending_invoices: number;
      pending_invoices_amount: number;
      /** Unpaid plan installments — owed money that is not an invoice. */
      plan_owed_amount: number;
      plan_pending_count: number;
      /** Revenue by origin, each payment counted once; these sum to revenue_30d. */
      source_direct_amount: number;
      source_direct_count: number;
      source_invoices_paid: number;
      source_invoices_outstanding: number;
      source_plans_paid: number;
      source_plans_outstanding: number;
      revenue_this_week: number;
      revenue_last_week: number;
      successful_transactions_30d: number;
      failed_transactions_30d: number;
      /** Charges accepted, refunded ones included — the success rate's numerator. */
      charged_transactions_30d: number;
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

  /**
   * Every amount on this page, in the currency the money is actually in.
   *
   * Wrapped once rather than passed at each of the eleven call sites, so a new
   * figure added later cannot quietly fall back to the language default.
   */
  // Only currencies the app can actually render. An unrecognised one falls back
  // to the language default rather than being forced into the type.
  const moneyCurrency: CurrencyCode | undefined = SUPPORTED_CURRENCIES.includes(
    (stats?.payments.primary_currency ?? '') as CurrencyCode
  )
    ? (stats?.payments.primary_currency as CurrencyCode)
    : undefined;

  const money = (amount: number | null, options?: { showFree?: boolean }) =>
    formatCurrency(amount, { ...options, currencyOverride: moneyCurrency });

  // Invoice modal state

  // Fetch stats on mount and whenever the reporting window changes.
  // Only the very first load blocks the page; period changes refresh silently.
  useEffect(() => {
    fetchStats({ silent: hasLoadedOnceRef.current });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  // Money asked for here now lives at /business-os/orders.
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
    router.replace(`/business-os/orders${query ? `?${query}` : ''}`);
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
            refunds_amount_30d: data.stats.payments?.refunds_amount_30d || 0,
            gross_revenue_30d: data.stats.payments?.gross_revenue_30d || 0,
            processor_fees_30d: data.stats.payments?.processor_fees_30d || 0,
            refund_fees_kept_30d: data.stats.payments?.refund_fees_kept_30d || 0,
            revenue_by_currency: data.stats.payments?.revenue_by_currency || [],
            primary_currency: data.stats.payments?.primary_currency ?? null,
            revenue_owed_30d: data.stats.payments?.revenue_owed_30d || 0,
            pending_invoices: data.stats.payments?.pending_invoices || 0,
            pending_invoices_amount: data.stats.payments?.pending_invoices_amount || 0,
            plan_owed_amount: data.stats.payments?.plan_owed_amount || 0,
            plan_pending_count: data.stats.payments?.plan_pending_count || 0,
            source_direct_amount: data.stats.payments?.source_direct_amount || 0,
            source_direct_count: data.stats.payments?.source_direct_count || 0,
            source_invoices_paid: data.stats.payments?.source_invoices_paid || 0,
            source_invoices_outstanding: data.stats.payments?.source_invoices_outstanding || 0,
            source_plans_paid: data.stats.payments?.source_plans_paid || 0,
            source_plans_outstanding: data.stats.payments?.source_plans_outstanding || 0,
            revenue_this_week: data.stats.payments?.revenue_this_week || 0,
            revenue_last_week: data.stats.payments?.revenue_last_week || 0,
            successful_transactions_30d: data.stats.payments?.successful_transactions_30d || 0,
            charged_transactions_30d: data.stats.payments?.charged_transactions_30d ?? data.stats.payments?.successful_transactions_30d ?? 0,
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
      logger.error({ err: error, period }, 'Failed to fetch stats');
    } finally {
      hasLoadedOnceRef.current = true;
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  /*
   * The period the dialog opens on.
   *
   * Mirrors the stats API's rolling windows (7/30/365 days, "all" = no start),
   * so the file starts out matching the figures it was launched from. The user
   * can change it there — the dialog owns the period from that point on.
   */
  const ledgerDefaults = (): { from: string; to: string } => {
    const PERIOD_DAYS: Record<string, number> = { week: 7, month: 30, year: 365 };
    const iso = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const days = PERIOD_DAYS[period];
    return {
      from: days ? iso(new Date(Date.now() - days * 86400_000)) : '2000-01-01',
      to: iso(new Date()),
    };
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
      logger.error({ err: error }, 'Failed to export transactions');
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
            {/* Reporting window, and the file that window makes. */}
            <div className="flex flex-wrap items-center justify-between gap-2">
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

            {/* The accountant's copy of the window above.
                Server-side and unpaginated, and it lists refunds as their own
                dated rows — the one thing the on-screen export cannot do, since
                folding a refund into the sale's row dates it to the sale. */}
            <button
              type="button"
              onClick={() => setShowLedgerExport(true)}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium border border-[var(--v2-border)] bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] disabled:opacity-60"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              <Download className="w-4 h-4" />
              {t('reports.export_ledger')}
            </button>
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
                value={money(stats?.payments.revenue_30d || 0, { showFree: false })}
                subtitle={(() => {
                  /*
                   * Three figures that do not overlap, so the owner can check
                   * them: collected, minus refunded, is what was kept; owed is
                   * what has not arrived yet.
                   *
                   * GROSS here rather than `revenue_paid_30d`, which is already
                   * net — showing a net figure beside a refunds figure reads as
                   * though the refund is about to be taken off twice.
                   */
                  const collected = stats?.payments.gross_revenue_30d || 0;
                  const owed = stats?.payments.revenue_owed_30d || 0;
                  const refunded = stats?.payments.refunds_amount_30d || 0;
                  const fees = stats?.payments.processor_fees_30d || 0;

                  /*
                   * Refunds are shown, not just subtracted.
                   *
                   * A revenue figure that fell tells the owner nothing about
                   * WHY — selling less and refunding more are entirely
                   * different problems. Only when there were any: a business
                   * that has never refunded anything should not be shown a
                   * zero it has to interpret.
                   */
                  const parts = [
                    `${t('reports.collected') || 'Collected'}: ${money(collected, { showFree: false })}`,
                    `${t('reports.owed') || 'Owed'}: ${money(owed, { showFree: false })}`,
                  ];

                  if (refunded > 0) {
                    parts.push(
                      `${t('reports.refunded_amount') || 'Refunded'}: ${money(refunded, { showFree: false })}`
                    );
                  }

                  /*
                   * What Stripe kept.
                   *
                   * Collected minus refunded minus fees is what the bank
                   * balance actually moved by, and the fee line was the piece
                   * that had never appeared anywhere in this product. Only when
                   * it is known — a business mid-backfill should not be shown a
                   * zero that means "not fetched yet".
                   */
                  if (fees > 0) {
                    parts.push(
                      `${t('reports.fees') || 'Fees'}: ${money(fees, { showFree: false })}`
                    );
                  }

                  return parts.join(' • ');
                })()}
                // The money it is summarising now lives on its own page.
                onAction={() => router.push('/business-os/orders')}
                actionLabel={t('reports.view_money') || 'View orders'}
              />

              {/* Revenue This Week */}
              <MetricCard
                icon={TrendingUp}
                iconColor={REPORTS_COLORS.PRIMARY}
                label={t('reports.this_week') || 'This Week'}
                value={money(stats?.payments.revenue_this_week || 0, { showFree: false })}
                subtitle={t('reports.last_7_days') || 'Last 7 days'}
                trend={{
                  value: money(Math.abs((stats?.payments.revenue_this_week || 0) - (stats?.payments.revenue_last_week || 0)), { showFree: false }),
                  isPositive: (stats?.payments.revenue_this_week || 0) >= (stats?.payments.revenue_last_week || 0),
                  text: t('reports.from_last_week') || 'from last week'
                }}
              />

              {/* Everything still owed — invoices AND plan installments.
                  Named "Outstanding" with the same word the payments page uses,
                  because it is now the same figure: the card said "Pending
                  Invoices" and showed only invoices, so a business owed money on
                  a payment plan read zero here and a full total one page over. */}
              <MetricCard
                icon={Clock}
                iconColor={REPORTS_COLORS.WARNING}
                label={t('payments.outstanding') || 'Outstanding'}
                value={money(stats?.payments.revenue_owed_30d || 0, { showFree: false })}
                subtitle={[
                  `${stats?.payments.pending_invoices || 0} ${t('reports.invoices') || 'invoices'}`,
                  `${stats?.payments.invoices_overdue || 0} ${t('reports.overdue') || 'overdue'}`,
                  // Only when there is plan money, so a business without plans
                  // reads exactly as it did before.
                  ...((stats?.payments.plan_pending_count || 0) > 0
                    ? [`${stats?.payments.plan_pending_count} ${t('reports.installments') || 'installments'}`]
                    : []),
                ].join(' • ')}
                // The money it is summarising now lives on its own page.
                onAction={() => router.push('/business-os/orders')}
                actionLabel={t('reports.view_money') || 'View orders'}
              />

              {/* Average Invoice */}
              <MetricCard
                icon={Receipt}
                iconColor={REPORTS_COLORS.ACCENT}
                label={t('reports.average_invoice') || 'Average Invoice'}
                value={money(stats?.payments.average_invoice_amount || 0, { showFree: false })}
                subtitle={t('reports.per_paid_invoice') || 'Per paid invoice'}
              />
            </div>

            {/* Revenue Sources */}
            <RevenueSourcesSection
              payments={{
                type: 'payments',
                // Direct money only — not every succeeded payment. Invoice and
                // plan payments have their own rows now, and counting them here
                // too made the three bars sum to more than the revenue card.
                amount: stats?.payments.source_direct_amount || 0,
                count: stats?.payments.source_direct_count || 0
              }}
              invoices={{
                type: 'invoices',
                // What invoices actually brought in, including the ones settled
                // by card. The old figure subtracted those to avoid counting
                // them twice under "direct payments" — so an invoice paid by
                // card showed here as "1 invoice, 0.00" while its money sat in
                // the direct row. Each payment is now attributed once, upstream.
                amount: (stats?.payments.source_invoices_paid || 0) + (stats?.payments.source_invoices_outstanding || 0),
                count: (stats?.payments.invoices_paid_30d || 0) + (stats?.payments.pending_invoices || 0),
                paid: stats?.payments.source_invoices_paid || 0,
                outstanding: stats?.payments.source_invoices_outstanding || 0
              }}
              plans={{
                type: 'plans',
                amount: (stats?.payments.source_plans_paid || 0) + (stats?.payments.source_plans_outstanding || 0),
                count: stats?.payments.plan_pending_count || 0,
                paid: stats?.payments.source_plans_paid || 0,
                outstanding: stats?.payments.source_plans_outstanding || 0
              }}
              currency={moneyCurrency}
            />


            {/* Financial Health */}
            {/*
              * Say so when the totals are adding unlike things.
              *
              * Every headline figure on this page is summed across whatever
              * currencies the period contained, and the symbol beside it names
              * only the largest of them. With one currency that is exactly
              * right. With two it is dollars and shekels added together and
              * labelled with whichever there was more of — a number that is not
              * wrong by a rounding error but by an exchange rate.
              *
              * Not silently fixed by converting: this product holds no rate and
              * inventing one would replace a visible problem with an invisible
              * one. The breakdown is already computed per currency, so the
              * honest move is to name the currencies and point at it.
              */}
            {(stats?.payments.revenue_by_currency?.length ?? 0) > 1 && (
              <div
                className="mb-3 px-3 py-2 text-[12px] leading-relaxed"
                style={{
                  borderRadius: '10px',
                  background: 'rgba(217, 119, 6, 0.08)',
                  color: '#8A5B12',
                }}
              >
                {t('reports.mixed_currency') || 'Totals below add amounts in different currencies.'}
                {' '}
                {stats?.payments.revenue_by_currency
                  .map(row => `${row.currency} ${row.gross.toLocaleString()}`)
                  .join(' · ')}
              </div>
            )}

            <FinancialHealthGrid
              /*
               * Did the charge go through — nothing about what happened after.
               *
               * Built on `charged` (accepted, refunded ones included) rather
               * than on `succeeded`, which drops a sale the moment it is
               * refunded. That made refunds disappear from both sides of the
               * ratio: an account with two clean sales and two refunded ones
               * read "2 of 2" when four charges were accepted, and one with
               * failures alongside refunds got a rate that was plainly wrong.
               */
              successRate={(() => {
                const charged = stats?.payments.charged_transactions_30d || 0;
                const failed = stats?.payments.failed_transactions_30d || 0;
                const attempted = charged + failed;
                const rate = attempted > 0 ? charged / attempted : 0;

                return {
                  // Nobody tried to pay is not a 100% success rate.
                  value: attempted > 0 ? `${Math.round(rate * 100)}%` : '—',
                  subtitle: language === 'he'
                    ? `${t('reports.transactions')} ${charged} ${t('reports.of')} ${attempted}`
                    : `${charged} ${t('reports.of')} ${attempted} ${t('reports.transactions')}`,
                  status: rate >= PERFORMANCE_THRESHOLDS.SUCCESS_RATE_GOOD ? 'success' : 'warning',
                };
              })()}
              /*
               * Of everything billed, how much came back.
               *
               * The counts behind this are fixed in the stats route: an overdue
               * invoice used to be counted as neither sent nor paid, so it left
               * the denominator as it aged and the rate climbed toward 100%
               * precisely as collection got worse.
               */
              collectionRate={(() => {
                const paid = stats?.payments.invoices_paid_30d || 0;
                const sent = stats?.payments.invoices_sent_30d || 0;
                const rate = sent > 0 ? paid / sent : 0;

                return {
                  // No invoices sent is not perfect collection.
                  value: sent > 0 ? `${Math.min(100, Math.round(rate * 100))}%` : '—',
                  subtitle: language === 'he'
                    ? `${t('reports.invoices_paid')} ${paid} ${t('reports.of')} ${sent}`
                    : `${paid} ${t('reports.of')} ${sent} ${t('reports.invoices_paid')}`,
                  status: rate >= PERFORMANCE_THRESHOLDS.COLLECTION_RATE_GOOD ? 'success' : 'warning',
                };
              })()}
              outstanding={{
                value: money(stats?.payments.invoices_overdue_amount || 0, { showFree: false }),
                subtitle: `${stats?.payments.invoices_overdue || 0} ${t('reports.overdue_invoices')}`,
                status: (stats?.payments.invoices_overdue || 0) === PERFORMANCE_THRESHOLDS.OUTSTANDING_GOOD ? 'success' : (stats?.payments.invoices_overdue || 0) <= PERFORMANCE_THRESHOLDS.OUTSTANDING_WARNING ? 'warning' : 'danger'
              }}
              /*
               * Refunded money over money collected — not refund EVENTS over
               * surviving transactions, which is what this was and why it read
               * 350%.
               *
               * Two faults compounded. The numerator counted rows in the refund
               * ledger, so one sale refunded in three instalments counted three
               * times. The denominator counted transactions still sitting at
               * `succeeded` — and a fully refunded sale moves to `refunded`, so
               * it left the denominator while its refund stayed in the
               * numerator. Seven refund rows against two surviving sales is not
               * a percentage of anything.
               *
               * Both figures are money, from the same period, and gross is
               * collected BEFORE refunds — so the ratio cannot exceed 100% and
               * means what a business owner assumes it means.
               */
              refundRate={(() => {
                const refunded = stats?.payments.refunds_amount_30d || 0;
                const gross = stats?.payments.gross_revenue_30d || 0;
                const rate = gross > 0 ? refunded / gross : 0;

                /*
                 * The fee is part of what the refund cost.
                 *
                 * Stripe keeps its processing fee on a refunded payment, so a
                 * full refund leaves the business down the fee as well as the
                 * sale. Naming it here stops the card reading as though a
                 * refund merely returns things to where they were.
                 *
                 * Shown only when there is one: a business refunding money it
                 * collected outside Stripe pays no fee, and a zero would imply
                 * a fee that was returned rather than one never charged.
                 */
                const feesKept = stats?.payments.refund_fees_kept_30d || 0;

                return {
                  // No collections in the period is not a 0% refund rate — it
                  // is no rate at all, and a dash says so without implying a
                  // clean record the business has not earned.
                  value: gross > 0 ? `${Math.round(rate * 100)}%` : '—',
                  subtitle: feesKept > 0
                    ? `${money(refunded, { showFree: false })} ${t('reports.refunded')} · ${money(feesKept, { showFree: false })} ${t('reports.fees_kept') || 'in fees'}`
                    : `${money(refunded, { showFree: false })} ${t('reports.refunded')}`,
                  status: rate <= PERFORMANCE_THRESHOLDS.REFUND_RATE_GOOD ? 'success' : 'warning',
                };
              })()}
            />

              {/* Revenue by Services */}
              <RevenueByServicesSection
                services={stats?.scheduling.service_revenue || []}
                currency={moneyCurrency}
              />
            </div>
          </div>
        )}
      </div>
      <LedgerExportModal
        isOpen={showLedgerExport}
        onClose={() => setShowLedgerExport(false)}
        defaultFrom={ledgerDefaults().from}
        defaultTo={ledgerDefaults().to}
      />
    </div>
  );
}
