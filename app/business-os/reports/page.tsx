'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Band } from '@/components/business-os/reports/Band';
import { VerdictLine } from '@/components/business-os/reports/VerdictLine';
import { MoneyFigures } from '@/components/business-os/reports/MoneyFigures';
import { FinancialDetail } from '@/components/business-os/reports/FinancialDetail';
import { HealthRows } from '@/components/business-os/reports/HealthRows';
import { ChannelTable } from '@/components/business-os/reports/ChannelTable';
import { ServiceTable, type ServiceRow } from '@/components/business-os/reports/ServiceTable';
import { ClientCounts } from '@/components/business-os/reports/ClientCounts';
import { CHANNEL_LABELS, type ChannelRow } from '@/components/business-os/insight/ChannelSourcesSection';
import { BarChart3, Download, ChevronRight } from 'lucide-react';
import { useLanguage, type CurrencyCode } from '@/lib/business-os/LanguageContext';
import { createLogger } from '@/lib/logger';
import { LedgerExportModal } from '@/components/payments/LedgerExportModal';
import { PAGE_CONTAINER } from '@/lib/business-os/pageContainer';
import { REPORTS_COLORS } from '@/lib/business-os/reports/constants';
import type { HealthMeasures } from '@/hooks/useInsights';

/**
 * An overview of the business, not a ledger.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PAGE USED TO BE
 *
 * Titled "Cash Flow & Financials", and it meant it: eleven tiles, every one of
 * them money. Revenue, collected, owed, refunded, processor fees, fees kept on
 * refunds, average invoice, collection rate, success rate, refund rate, lost
 * potential. A good accounting page.
 *
 * It never said whether people were finding the business, whether enquiries got
 * answered, whether clients came back, or whether the calendar was filling. An
 * owner reading it learned what happened to the money and nothing about what
 * produced it — while the platform computed all of that nightly and showed it
 * nowhere.
 *
 * SIX BANDS, EACH ONE QUESTION
 *
 *   1. the verdict      how did it go              (stored narrative)
 *   2. money            did I get paid             (3 figures, detail folded)
 *   3. health           how is the business doing   (6 rates vs last period)
 *   4. channels         who sent the clients
 *   5. clients          where those people are now (right now, no period)
 *   6. services         what people buy
 *
 * Money is still here and still first after the verdict. It is three figures
 * instead of eleven tiles, with the other eight one click away — the bookkeeper
 * loses nothing, the owner stops having to read a ledger to learn how the month
 * went.
 *
 * ONE VISUAL LANGUAGE, WHICH COST FOUR COMPONENTS
 *
 * The first attempt reused `MetricCard`, `RevenueSourcesSection`,
 * `FinancialHealthGrid` and `RevenueByServicesSection`. Each was correct and
 * each brought its own look — bar charts, five colour-coded tiles, a table with
 * its own header style — so the page read as three products stacked up. They are
 * gone; every band now wears `Band` and supplies only rows. `ChannelSourcesSection`
 * survives because the DASHBOARD uses it, and that surface wants the two extra
 * columns ("Saw you", "Billed") that this page deliberately drops.
 *
 * NO TABS, deliberately. The whole point is that one scroll answers "how is my
 * business doing", and a tab is a place for an answer to hide.
 *
 * FIVE MONEY BASES ON ONE PAGE, AND EACH ONE SAYS WHICH IT IS
 *
 * They cannot be reconciled by arithmetic and must never be presented as if
 * they could. Verified against the routes, 2026-10-08:
 *
 *   band 2  money that ARRIVED in the period, every source.
 *           `gross_revenue_30d`, and `banked_revenue_30d` for what was kept.
 *
 *   band 4  money that ARRIVED in the period, attributed to the channel that
 *           brought the client whenever they first arrived. `leads` alone keeps
 *           the acquisition window. This was a cohort figure — all-time money
 *           from contacts acquired in the period — which reported an entire
 *           revenue column of zeros on week and month, because nobody pays the
 *           week they arrive. Changed 2026-10-09.
 *
 *   band 6  collected PLUS still owed, in the period, service-attributable only.
 *           `serviceRevenueMap` adds transactions AND every unsettled invoice.
 *
 *   detail  QUOTED and undecided (`open_proposals_amount`) — proposals sent or
 *           viewed, all time, drafts excluded because nobody saw them.
 *
 *   detail  ORDERED in the period (`booked_value_period`) — bookings created in
 *           the window at the service's list price, paid or not. The only
 *           measure here on an order basis rather than a payment one.
 *
 * Bands 4 and 6 each carry a caption naming their basis, and the two detail
 * tiles carry theirs in their notes. Band 2 is the
 * plain one and needs none. Deleting those captions reintroduces the confusion
 * an owner reported: three figures that look like they should add up.
 *
 * THREE FETCHES, NO NEW ENDPOINTS. Bands 2 and 5 come from the stats route this
 * page already used; 1 and 3 from the insights route, asked for lean; 4 from
 * channel insights, which is slow and therefore never allowed to block the rest.
 *
 * The old `?tab=invoices|transactions|money` links still work — they redirect
 * below — because one of them is built by the Stripe Connect callback and is
 * where somebody lands returning from onboarding.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Reporting window, passed straight through to the routes that take one. */
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

/** Bands 1 and 3, as little of the insights payload as the route will return. */
interface HealthState {
  measures: HealthMeasures | null;
  narrative: string | null;
}

/** Band 4. */
/**
 * Band 6. Every one of these is a "right now" count with no date filter, so
 * none of them move when the period selector does — which is why the band says
 * so rather than leaving four static figures looking broken.
 */
interface CrmState {
  activeClients: number;
  activeLeads: number;
  wentQuiet: number;
  totalContacts: number;
}

interface ChannelState {
  rows: ChannelRow[];
  totals: { leads: number };
  untracked: { leads: number; bookings: number; revenue: number };
}

interface PaymentStats {
  gross_revenue_30d: number;
  refunds_amount_30d: number;
  processor_fees_30d: number;
  /**
   * How many of the period's payments have no known fee.
   *
   * Fees are backfilled from Stripe, so above zero the fee total is incomplete
   * and `banked_revenue_30d` is an over-estimate. The money band says so.
   */
  processor_fees_unknown: number;
  /** gross − refunds − fees, computed server-side. What the bank actually saw. */
  banked_revenue_30d: number;
  refund_fees_kept_30d: number;
  revenue_owed_30d: number;
  /** Quoted and undecided: proposals sent or viewed, never drafts. All time. */
  open_proposals_amount: number;
  open_proposals_count: number;
  /** Ordered in the period at list price, paid or not. Follows the selector. */
  booked_value_period: number;
  pending_invoices: number;
  invoices_overdue: number;
  invoices_overdue_amount: number;
  /**
   * Of `invoices_overdue`: how many are invoices and how many are plan stages.
   *
   * On the wire already — `/api/business-os/stats` declares and returns both —
   * and only this local copy of the shape was missing them. So they arrived
   * `undefined`, `FinancialDetail`'s `overduePlanCount ? …` was always falsy,
   * and the owner never saw the breakdown the component exists to show.
   *
   * The same omission as `meeting_status` on `toAppointment` and `booking_id`
   * on `EmailRecord`: a column the API sends and a local type does not name is
   * silently dropped, with no error anywhere.
   */
  invoices_overdue_invoice_count: number;
  invoices_overdue_plan_count: number;
  plan_pending_count: number;
  lost_potential_amount: number;
  lost_potential_count: number;
  charged_transactions_30d: number;
  failed_transactions_30d: number;
  invoices_paid_30d: number;
  invoices_sent_30d: number;
  average_invoice_amount: number;
  source_plans_paid: number;
  source_plans_outstanding: number;
  /**
   * Gross and net per currency — the only figures that may honestly be added.
   * Every headline total here is a sum ACROSS currencies, which is meaningful
   * only while there is one.
   */
  revenue_by_currency: { currency: string; gross: number; net: number }[];
  /**
   * The currency the figures above are denominated in.
   *
   * Null when nothing was collected. Never inferred from the interface
   * language — that is how a business billing in dollars and reading in Hebrew
   * saw every amount stamped ₪.
   */
  primary_currency: string | null;
}

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
  /*
   * The eight money figures that are not one of the three headline ones.
   *
   * Collapsed by default and remembered for the session only. An owner who
   * opens it once is usually reconciling, which is a sitting, not a preference.
   */
  const [showDetail, setShowDetail] = useState(false);

  const [payments, setPayments] = useState<PaymentStats | null>(null);
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [health, setHealth] = useState<HealthState>({ measures: null, narrative: null });
  const [crm, setCrm] = useState<CrmState | null>(null);
  const [channels, setChannels] = useState<ChannelState | null>(null);

  /**
   * Every amount on this page, in the currency the money is actually in.
   *
   * Wrapped once and passed down, so a new figure added later cannot quietly
   * fall back to the language default. `formatCurrency` picks its symbol from
   * the interface LANGUAGE when not told otherwise — Hebrew means shekels — and
   * this account bills in dollars, so the page was printing ₪ over USD amounts.
   * At roughly 3.7 to 1 that is not a rounding difference, it is a different
   * number.
   */
  const moneyCurrency: CurrencyCode | undefined = SUPPORTED_CURRENCIES.includes(
    (payments?.primary_currency ?? '') as CurrencyCode
  )
    ? (payments?.primary_currency as CurrencyCode)
    : undefined;

  const money = useCallback(
    (amount: number) =>
      formatCurrency(amount, { showFree: false, currencyOverride: moneyCurrency }),
    [formatCurrency, moneyCurrency]
  );

  /*
   * Bands 1 and 3.
   *
   * The insights route defaults to returning correlated insights, vector
   * maturity and a page of insight rows, none of which this page shows. Turned
   * off explicitly and `limit=1`, because the payload is the cost, not the call.
   */
  const fetchHealth = useCallback(async () => {
    try {
      const response = await fetch(
        '/api/business-os/insights?limit=1&includeCorrelated=false&includeVectorMaturity=false&includeProjection=false',
        { cache: 'no-store' }
      );
      const data = await response.json();
      const summary = data?.data?.healthSummary;

      setHealth({
        /*
         * Null on summaries written before 2026-09-23 and on any account whose
         * nightly run has not happened. Null rather than an empty array: bands 1
         * and 3 hide themselves on null, and six rows of dashes would imply the
         * figures are on their way.
         */
        measures: summary?.health_measures ?? null,
        narrative: summary?.summary_narrative ?? null,
      });
    } catch (error) {
      // A missing verdict costs its own two bands and nothing else.
      logger.error({ err: error }, 'Failed to fetch business health');
      setHealth({ measures: null, narrative: null });
    }
  }, []);

  /*
   * Band 4, on its own and never awaited with the rest.
   *
   * This route was measured at 25s and 53s in development. Some of that is this
   * machine's cold compile, but not all of it, and the question it answers is
   * the least urgent on the page. Bands 1 to 3 must not wait behind it.
   */
  const fetchChannels = useCallback(async (forPeriod: ReportPeriod) => {
    try {
      const response = await fetch(`/api/business-os/channel-insights?period=${forPeriod}`, {
        cache: 'no-store',
      });
      const data = await response.json();
      if (!data?.success || !data?.data) {
        setChannels(null);
        return;
      }
      setChannels({
        rows: data.data.rows ?? [],
        totals: data.data.totals ?? { leads: 0 },
        untracked: data.data.untracked ?? { leads: 0, bookings: 0, revenue: 0 },
      });
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch channel insights');
      setChannels(null);
    }
  }, []);

  const fetchStats = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    try {
      if (silent) setIsRefreshing(true);
      else setLoading(true);

      const response = await fetch(`/api/business-os/stats?period=${period}`, { cache: 'no-store' });
      const data = await response.json();

      if (data.success && data.stats) {
        const p = data.stats.payments ?? {};
        setPayments({
          gross_revenue_30d: p.gross_revenue_30d || 0,
          refunds_amount_30d: p.refunds_amount_30d || 0,
          processor_fees_30d: p.processor_fees_30d || 0,
          processor_fees_unknown: p.processor_fees_unknown || 0,
          /*
           * Taken, never recomputed. Subtracting the three figures client-side
           * drifts by cents (they arrive already rounded) and forks a definition
           * the stats route owns.
           */
          banked_revenue_30d: p.banked_revenue_30d || 0,
          refund_fees_kept_30d: p.refund_fees_kept_30d || 0,
          revenue_owed_30d: p.revenue_owed_30d || 0,
          open_proposals_amount: p.open_proposals_amount || 0,
          open_proposals_count: p.open_proposals_count || 0,
          booked_value_period: data.stats.scheduling?.booked_value_period || 0,
          pending_invoices: p.pending_invoices || 0,
          invoices_overdue: p.invoices_overdue || 0,
          invoices_overdue_amount: p.invoices_overdue_amount || 0,
          /* The breakdown `FinancialDetail` splits the overdue total with. The
             API has always sent both; this mapping was dropping them, so the
             component's `overduePlanCount ? …` never fired. */
          invoices_overdue_invoice_count: p.invoices_overdue_invoice_count || 0,
          invoices_overdue_plan_count: p.invoices_overdue_plan_count || 0,
          plan_pending_count: p.plan_pending_count || 0,
          lost_potential_amount: p.lost_potential_amount || 0,
          lost_potential_count: p.lost_potential_count || 0,
          /*
           * Charges ACCEPTED, refunded ones included. Built on `charged` rather
           * than `succeeded`, which drops a sale the moment it is refunded —
           * that made refunds disappear from both sides of the success ratio.
           */
          charged_transactions_30d:
            p.charged_transactions_30d ?? p.successful_transactions_30d ?? 0,
          failed_transactions_30d: p.failed_transactions_30d || 0,
          invoices_paid_30d: p.invoices_paid_30d || 0,
          invoices_sent_30d: p.invoices_sent_30d || 0,
          average_invoice_amount: p.average_invoice_amount || 0,
          source_plans_paid: p.source_plans_paid || 0,
          source_plans_outstanding: p.source_plans_outstanding || 0,
          revenue_by_currency: p.revenue_by_currency || [],
          primary_currency: p.primary_currency ?? null,
        });
        setServices(data.stats.scheduling?.service_revenue || []);

        /*
         * `new_this_week` and `became_clients_this_week` are deliberately not
         * read. Both are hardcoded to seven days in the stats route, so on a
         * page set to Year they would report a week beside figures that honour
         * the selector. See the note in ClientCounts.
         */
        const c = data.stats.crm ?? {};
        setCrm({
          activeClients: c.active_clients || 0,
          activeLeads: c.active_leads || 0,
          wentQuiet: c.went_quiet || 0,
          totalContacts: c.total_contacts || 0,
        });
      }
    } catch (error) {
      logger.error({ err: error, period }, 'Failed to fetch stats');
    } finally {
      hasLoadedOnceRef.current = true;
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [period]);

  /*
   * Money and channels follow the period; health does not.
   *
   * The nightly summary covers whatever window it covers, so refetching it on
   * every period change would return the same row three more times.
   */
  useEffect(() => {
    fetchStats({ silent: hasLoadedOnceRef.current });
    fetchChannels(period);
  }, [period, fetchStats, fetchChannels]);

  useEffect(() => {
    fetchHealth();
  }, [fetchHealth]);

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

  /*
   * The period the ledger dialog opens on.
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

  const isRTL = language === 'he';

  /*
   * What the "Direct / unknown" row means, named rather than left to inference.
   *
   * `untracked` from the API is the SAME bucket as that row (it is literally
   * `buckets.get('direct')`), so it is used only to write this sentence — never
   * rendered as a row of its own. Doing both printed the same leads and money
   * twice, which is what an owner spotted on the live page.
   */
  const channelCaption =
    channels && channels.untracked.leads > 0
      ? t('reports.arrived_caption')
          .replace('{leads}', String(channels.totals.leads))
          .replace('{untracked}', String(channels.untracked.leads))
          .replace(
            '{direct}',
            CHANNEL_LABELS.direct?.[language] || CHANNEL_LABELS.direct?.en || 'Direct / unknown'
          )
      : undefined;

  return (
    <div className="min-h-full bg-[var(--v2-bg)]" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className={`${PAGE_CONTAINER} py-4 sm:py-6`}>

        {/* Page head */}
        <div className="flex items-center gap-3 mb-4">
          <div
            className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: 'rgba(34, 197, 139, 0.2)' }}
          >
            <BarChart3 className="w-4 h-4 sm:w-5 sm:h-5" style={{ color: REPORTS_COLORS.PRIMARY }} />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-semibold text-[var(--v2-text-primary)] truncate">
              {t('reports.overview_title')}
            </h1>
            <p className="text-xs text-[var(--v2-text-secondary)]">
              {t('reports.overview_subtitle')}
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center min-h-[300px]">
            <div className="text-center space-y-3">
              <div
                className="w-12 h-12 border-[3px] border-t-transparent rounded-full animate-spin mx-auto"
                style={{ borderColor: REPORTS_COLORS.PRIMARY, borderTopColor: 'transparent' }}
              />
              <p className="text-sm text-[var(--v2-text-secondary)]">{t('reports.loading') || 'Loading...'}</p>
            </div>
          </div>
        ) : (
          <div className="max-w-7xl mx-auto flex flex-col gap-4">

            {/* Reporting window, and the file that window makes. */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div
                className="inline-flex items-center gap-0.5 p-1 border border-[var(--v2-border)] bg-[var(--v2-surface)]"
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
                  dated rows — the one thing an on-screen export cannot do, since
                  folding a refund into the sale's row dates it to the sale. */}
              <button
                type="button"
                onClick={() => setShowLedgerExport(true)}
                className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium border border-[var(--v2-border)] bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)]"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                <Download className="w-4 h-4" />
                {t('reports.export_ledger')}
              </button>
            </div>

            {/* Figures stay on screen while the new window loads, dimmed so it's
                clear they're the previous period's. */}
            <div
              className="flex flex-col gap-4 transition-opacity duration-200"
              style={{ opacity: isRefreshing ? 0.45 : 1 }}
              aria-busy={isRefreshing}
            >

              {/* ── BAND 1 · the verdict ──────────────────────────────────
                  No band header: a one-line answer does not need a label
                  telling the reader it is the answer.

                  Always rendered. With no stored summary it holds its place and
                  says when it will fill, rather than leaving a gap that reads as
                  an unfinished page. */}
              <VerdictLine
                narrative={health.narrative}
                improved={health.measures?.improved ?? 0}
                declined={health.measures?.declined ?? 0}
                steady={health.measures?.steady ?? 0}
                unavailable={health.measures?.unavailable ?? 0}
              />

              {/* ── BAND 2 · money ─────────────────────────────────────── */}
              {payments && (
                <Band name={t('reports.band_money')} question={t('reports.q_money')}>
                  <MoneyFigures
                    collected={payments.gross_revenue_30d}
                    refunded={payments.refunds_amount_30d}
                    fees={payments.processor_fees_30d}
                    banked={payments.banked_revenue_30d}
                    feesUnknown={payments.processor_fees_unknown}
                    owed={payments.revenue_owed_30d}
                    pendingInvoices={payments.pending_invoices}
                    overdueInvoices={payments.invoices_overdue}
                    pendingInstallments={payments.plan_pending_count}
                    writtenOff={payments.lost_potential_amount}
                    writtenOffCount={payments.lost_potential_count}
                    money={money}
                    onOpenOrders={() => router.push('/business-os/orders')}
                  />

                  <button
                    type="button"
                    onClick={() => setShowDetail(v => !v)}
                    aria-expanded={showDetail}
                    aria-controls="reports-financial-detail"
                    className="w-full flex items-center gap-1.5 px-[18px] py-3 text-sm font-semibold text-start bg-[var(--v2-bg)] border-t border-[var(--v2-border)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)]"
                  >
                    <ChevronRight
                      className={`w-3.5 h-3.5 transition-transform ${showDetail ? 'rotate-90' : ''}`}
                    />
                    {t('reports.financial_detail')}
                  </button>

                  {showDetail && (
                    <div id="reports-financial-detail">
                      <FinancialDetail
                        charged={payments.charged_transactions_30d}
                        failed={payments.failed_transactions_30d}
                        invoicesPaid={payments.invoices_paid_30d}
                        invoicesSent={payments.invoices_sent_30d}
                        overdueAmount={payments.invoices_overdue_amount}
                        overdueCount={payments.invoices_overdue}
                        overdueInvoiceCount={payments.invoices_overdue_invoice_count}
                        overduePlanCount={payments.invoices_overdue_plan_count}
                        refunded={payments.refunds_amount_30d}
                        gross={payments.gross_revenue_30d}
                        refundFeesKept={payments.refund_fees_kept_30d}
                        averageInvoice={payments.average_invoice_amount}
                        plansPaid={payments.source_plans_paid}
                        plansOutstanding={payments.source_plans_outstanding}
                        quoted={payments.open_proposals_amount}
                        quotedCount={payments.open_proposals_count}
                        ordered={payments.booked_value_period}
                        money={money}
                      />
                    </div>
                  )}
                </Band>
              )}

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
              {(payments?.revenue_by_currency.length ?? 0) > 1 && (
                <div
                  className="px-3 py-2 text-xs leading-relaxed tabular-nums"
                  style={{
                    borderRadius: '10px',
                    background: 'rgba(217, 119, 6, 0.08)',
                    color: '#8A5B12',
                  }}
                >
                  {t('reports.mixed_currency') || 'Totals above add amounts in different currencies.'}
                  {' '}
                  {payments?.revenue_by_currency
                    .map(row => `${row.currency} ${row.gross.toLocaleString()}`)
                    .join(' · ')}
                </div>
              )}

              {/* ── BAND 3 · how the business is doing ────────────────────
                  Always rendered, all six rows, with the value slot empty where
                  there is no figure. A measured zero still shows as 0% — that is
                  an answer, and the most actionable one on the page. */}
              <Band name={t('reports.band_health')} question={t('reports.q_health')}>
                <HealthRows categories={health.measures?.categories ?? null} />
              </Band>

              {/* ── BAND 4 · where clients came from ─────────────────────
                  Arrives on its own schedule; absent until it does. */}
              {channels && (channels.rows.length > 0 || channels.untracked.leads > 0) && (
                <Band
                  name={t('reports.band_channels')}
                  question={t('reports.q_channels')}
                  caption={channelCaption}
                >
                  <ChannelTable rows={channels.rows} money={money} />
                </Band>
              )}

              {/* ── BAND 5 · clients ─────────────────────────────────────
                  Beside the channels band on purpose: that one says where
                  people came from, this one says where they are now. Both are
                  about people, and splitting them with a money band would read
                  as two unrelated sections. */}
              {crm && (
                <Band name={t('reports.band_clients')} question={t('reports.q_clients')}>
                  <ClientCounts
                    activeClients={crm.activeClients}
                    activeLeads={crm.activeLeads}
                    wentQuiet={crm.wentQuiet}
                    totalContacts={crm.totalContacts}
                  />
                </Band>
              )}

              {/* ── BAND 6 · what people buy ────────────────────────────
                  The caption is not decoration: these figures are on a
                  DIFFERENT BASIS from band 2's, and without saying so the two
                  cannot be reconciled by anyone reading them.

                  Band 2 counts money that ARRIVED, from every source.
                  `service_revenue` sums transactions AND every invoice not yet
                  settled by one (stats/route.ts, `serviceRevenueMap`), so it is
                  received PLUS owed, and only the part tied to a service. An
                  owner comparing ₪3,800 here with ₪15,145 above has no way to
                  know either of those things, and the honest fix is to state
                  them rather than to quietly align two different questions. */}
              {services.length > 0 && (
                <Band
                  name={t('reports.band_services')}
                  question={t('reports.q_services')}
                  caption={t('reports.services_caption')}
                >
                  <ServiceTable services={services} money={money} />
                </Band>
              )}
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
