/**
 * Metrics Types
 *
 * Type definitions for the Business OS Insight System metrics layer.
 */

import { BusinessEventCategory, BusinessEventType } from '../events/types';

// ==================== PERIOD TYPES ====================

export type PeriodType = 'daily' | 'weekly' | 'monthly';

export type MetricUnit = 'count' | 'usd' | 'percentage' | 'seconds' | 'days' | 'hours';

// ==================== METRIC KEYS ====================

// Acquisition metrics
export type AcquisitionMetricKey =
  | 'acquisition.page_views'
  | 'acquisition.unique_visitors'
  | 'acquisition.form_submissions'
  | 'acquisition.form_conversion_rate'
  | 'acquisition.traffic_change'
  | 'acquisition.page_conversion'
  | 'acquisition.mobile_conversion'
  | 'acquisition.missing_ctas'
  | 'acquisition.incomplete_content'
  /** Desktop conversion rate minus mobile, in percentage points. */
  | 'acquisition.mobile_conversion_gap'
  /** Enquiries per unique visitor, for one page. */
  | 'acquisition.page_conversion_rate'
  /**
   * Bookings or enquiries per click, for one smart link.
   *
   * Distinct from `page_conversion_rate` in what it can claim: a page view and
   * a contact are two events joined by a URL match, while a click and the
   * booking behind it share a session id. This one is measured.
   */
  | 'acquisition.link_conversion_rate'
  /** Active shared links whose destination cannot open on anyone else's device. */
  | 'acquisition.broken_link_destinations';

// Conversion metrics
export type ConversionMetricKey =
  | 'conversion.new_contacts'
  | 'conversion.lead_to_client_rate'
  | 'conversion.stage_progression_rate'
  | 'conversion.cold_leads_count'
  | 'conversion.pipeline_velocity'
  | 'conversion.overdue_tasks'
  | 'conversion.source_performance'
  /** Why declined quotes were declined, grouped by the reason the client gave. */
  | 'conversion.decline_reason'
  /** Share of ANSWERED quotes that were accepted. */
  | 'conversion.quote_acceptance_rate';

// Sales metrics
export type SalesMetricKey =
  | 'sales.enquiries_received'
  | 'sales.enquiries_replied'
  | 'sales.avg_reply_time_hours'
  | 'sales.stalled_enquiries'
  | 'sales.proposal_acceptance_rate'
  /**
   * The same question asked of the assistant again and again.
   *
   * A question an owner repeats weekly is a report they do not have, or an
   * automation nobody offered them. It is the loudest behavioural signal on the
   * reporting account: 294 chat queries in 30 days, half of everything they did.
   */
  | 'sales.repeated_questions';

// Cash flow metrics
export type CashFlowMetricKey =
  | 'cashflow.revenue_mtd'
  | 'cashflow.revenue_wtd'
  | 'cashflow.ar_total'
  | 'cashflow.ar_overdue_usd'
  | 'cashflow.avg_days_to_pay'
  | 'cashflow.payment_success_rate'
  | 'cashflow.failed_payments'
  | 'cashflow.pending_payments'
  | 'cashflow.refunded_payments'
  | 'cashflow.ar_aging'
  | 'cashflow.expiring_cards'
  | 'cashflow.refund_rate'
  | 'cashflow.payout_status'
  /** Completed work with no invoice and no payment against it. */
  | 'cashflow.unbilled_work'
  /** Money that actually arrived in a period, net of refunds. */
  | 'cashflow.income_received'
  /** The largest single client's share of everything received. */
  | 'cashflow.client_concentration'
  /**
   * Money taken for an appointment that was then cancelled, and never returned.
   *
   * A liability rather than income: the business holds it, and may or may not
   * owe it back depending on a cancellation policy no column records.
   */
  | 'cashflow.held_on_cancelled';

// Retention metrics
export type RetentionMetricKey =
  | 'retention.bookings_completed'
  | 'retention.no_show_count'
  | 'retention.no_show_rate'
  | 'retention.cancellation_rate'
  | 'retention.cancellation_spike'
  | 'retention.rebooking_rate'
  | 'retention.repeat_booking_rate'
  | 'retention.clients_at_risk'
  /**
   * Why bookings get called off, across a quarter rather than a spike week.
   *
   * Distinct from `cancellation_spike`, which is a rate that moved. A business
   * losing one booking a week to the same cause never spikes and is never told.
   */
  | 'retention.cancel_reason';

// Operations metrics
export type OperationsMetricKey =
  | 'operations.calendar_utilization'
  | 'operations.available_hours'
  | 'operations.booked_hours'
  | 'operations.active_services'
  | 'operations.last_minute_cancels'
  | 'operations.service_performance'
  | 'operations.peak_utilization'
  /**
   * The share of bookings the OWNER typed in, rather than a client making them.
   *
   * The first metric about how the owner WORKS rather than how the business
   * performs. A booking page exists to take this job; a high share means it is
   * not doing it, and that is work the platform promised to remove.
   */
  | 'operations.manual_booking_share'
  /**
   * Edits to one settings entity inside a short window.
   *
   * Repeatedly changing the same setting is not productive work, it is someone
   * failing to get the result they want.
   */
  | 'operations.settings_churn';

// Pricing metrics
export type PricingMetricKey =
  | 'pricing.avg_service_price'
  | 'pricing.avg_discount_percent'
  | 'pricing.intro_offer_conversion_rate'
  | 'pricing.discount_rate'
  | 'pricing.intro_conversion';

// Union of all metric keys
export type MetricKey =
  | AcquisitionMetricKey
  | ConversionMetricKey
  | SalesMetricKey
  | CashFlowMetricKey
  | RetentionMetricKey
  | OperationsMetricKey
  | PricingMetricKey;

// ==================== INTERFACES ====================

export interface DerivedMetric {
  id: string;
  user_id: string;
  metric_key: MetricKey;
  period_type: PeriodType;
  period_start: string;
  period_end: string;
  value: number;
  unit: MetricUnit;
  baseline_value?: number | null;
  baseline_period?: string | null;
  percent_change?: number | null;
  sample_size: number;
  std_deviation?: number | null;
  breakdown?: Record<string, number> | null;
  computed_at: string;
}

export interface ComputeMetricParams {
  metricKey: MetricKey;
  periodType: PeriodType;
  periodStart: Date;
  periodEnd: Date;
}

export interface MetricDefinition {
  key: MetricKey;
  name: string;
  description: string;
  category: BusinessEventCategory;
  unit: MetricUnit;
  periodTypes: PeriodType[];
  eventTypes: BusinessEventType[];
  aggregation: 'count' | 'sum' | 'avg' | 'rate' | 'snapshot';
  minSamplesForBaseline: number;
}

export interface BaselineResult {
  mean: number;
  stdDev: number;
  threshold: number; // 2 * stdDev from mean
  sampleSize: number;
  isSignificant: boolean; // sampleSize >= minSamples
}

export interface MetricsServiceResult<T> {
  data: T | null;
  error: Error | null;
}

// ==================== METRIC DEFINITIONS ====================

export const METRIC_DEFINITIONS: MetricDefinition[] = [
  // Acquisition
  {
    key: 'acquisition.page_views',
    name: 'Page Views',
    description: 'Total page views',
    category: 'acquisition',
    unit: 'count',
    periodTypes: ['daily', 'weekly', 'monthly'],
    eventTypes: ['page.viewed'],
    aggregation: 'count',
    minSamplesForBaseline: 7,
  },
  {
    key: 'acquisition.form_submissions',
    name: 'Form Submissions',
    description: 'Total form submissions',
    category: 'acquisition',
    unit: 'count',
    periodTypes: ['daily', 'weekly', 'monthly'],
    eventTypes: ['form.submitted'],
    aggregation: 'count',
    minSamplesForBaseline: 7,
  },

  // Conversion
  {
    key: 'conversion.new_contacts',
    name: 'New Contacts',
    description: 'New contacts created',
    category: 'conversion',
    unit: 'count',
    periodTypes: ['daily', 'weekly', 'monthly'],
    eventTypes: ['contact.created'],
    aggregation: 'count',
    minSamplesForBaseline: 7,
  },

  // Sales
  {
    key: 'sales.enquiries_received',
    name: 'Enquiries Received',
    description: 'Total enquiries received',
    category: 'sales',
    unit: 'count',
    periodTypes: ['daily', 'weekly'],
    eventTypes: ['enquiry.received'],
    aggregation: 'count',
    minSamplesForBaseline: 7,
  },
  {
    key: 'sales.stalled_enquiries',
    name: 'Stalled Enquiries',
    description: 'Enquiries without reply for 48+ hours',
    category: 'sales',
    unit: 'count',
    periodTypes: ['daily'],
    eventTypes: ['enquiry.stalled'],
    aggregation: 'count',
    minSamplesForBaseline: 7,
  },
  {
    key: 'sales.avg_reply_time_hours',
    name: 'Avg Reply Time',
    description: 'Average time to reply to enquiries',
    category: 'sales',
    unit: 'hours',
    periodTypes: ['daily', 'weekly'],
    eventTypes: ['enquiry.replied'],
    aggregation: 'avg',
    minSamplesForBaseline: 14,
  },

  // Cash Flow
  {
    key: 'cashflow.revenue_mtd',
    name: 'Revenue MTD',
    description: 'Month-to-date revenue',
    category: 'cash_flow',
    unit: 'usd',
    periodTypes: ['daily'],
    eventTypes: ['payment.completed'],
    aggregation: 'sum',
    minSamplesForBaseline: 30,
  },
  {
    key: 'cashflow.ar_overdue_usd',
    name: 'AR Overdue',
    description: 'Accounts receivable overdue amount',
    category: 'cash_flow',
    unit: 'usd',
    periodTypes: ['daily'],
    eventTypes: ['invoice.overdue'],
    aggregation: 'snapshot',
    minSamplesForBaseline: 7,
  },
  {
    /*
     * The series behind `cash_refund_pattern`, which had none.
     *
     * That detector is the one that showed an owner a 275% refund rate, and
     * part of why it could is that nothing ever recorded what the rate
     * actually was over time — there was no history to compare against, so a
     * configured threshold got pressed into service as a baseline.
     *
     * Counts of events, never sums of money: a refund RATE is refunds over
     * payments, and counting rows sidesteps the rule that money from
     * different currencies must never be added. `payment.completed` and
     * `refund.completed` are both emitted live and were backfilled, so the
     * series starts with history rather than from today.
     */
    /*
     * Money still owed, as a series rather than a figure on a card.
     *
     * `cash_ar_overdue` is the one detector on this account that has been
     * acted on, and until now its metric had no history — so the measurement
     * sweep could compare its "before" and "after" only by luck.
     *
     * The reader REFUSES to sum across currencies and returns null, which the
     * sweep stores as `unmeasurable`. See `snapshots.ts`: there is no FX rate
     * anywhere in the platform, and the sibling `cashflow.ar_overdue_usd`
     * quietly breaks that rule already.
     */
    key: 'cashflow.ar_total',
    name: 'Money Owed',
    description: 'Unpaid invoice value, net of refunds, in the business’s own currency',
    category: 'cash_flow',
    unit: 'usd',
    periodTypes: ['daily'],
    // A state, not an event: nothing is counted. The reader queries invoices.
    eventTypes: [],
    aggregation: 'snapshot',
    minSamplesForBaseline: 7,
  },
  {
    /*
     * Active links that cannot open for anybody but the owner, judged from
     * the address with no network call. Shares `deadReason` with the detector
     * so the series and the card cannot disagree about what "broken" means.
     */
    key: 'acquisition.broken_link_destinations',
    name: 'Broken Link Destinations',
    description: 'Active smart links whose destination cannot resolve for a visitor',
    category: 'acquisition',
    unit: 'count',
    periodTypes: ['daily'],
    eventTypes: [],
    aggregation: 'snapshot',
    minSamplesForBaseline: 7,
  },
  {
    /*
     * The series `computeRateMetric` has always been able to compute and
     * nobody ever asked it for.
     *
     * Its branch has existed since the file was written, keyed on
     * `retention.cancellation_rate`, and `METRIC_DEFINITIONS` never declared
     * the key — so the code read as working coverage and was unreachable
     * (hazard H22). Both events are emitted live, so declaring it costs one
     * entry and turns dead code into a series.
     */
    key: 'retention.cancellation_rate',
    name: 'Cancellation Rate',
    description: 'Share of created bookings that were later cancelled',
    category: 'retention',
    unit: 'percentage',
    periodTypes: ['daily', 'weekly', 'monthly'],
    eventTypes: ['booking.cancelled', 'booking.created'],
    aggregation: 'rate',
    minSamplesForBaseline: 7,
  },
  {
    /*
     * Clients who have gone quiet, as a series.
     *
     * ⚠️ Three detectors write this key meaning three different things. The
     * SERIES has one definition and it is the narrowest of them: no activity
     * and no booking for 30 days, relationship at least that old. Decided
     * 2026-10-07; see `snapshots.ts` for why, and for the stage-resolution
     * trap (`lifecycle_stage` does not exist).
     */
    key: 'retention.clients_at_risk',
    name: 'Clients At Risk',
    description: 'Clients with no activity and no booking for 30 days',
    category: 'retention',
    unit: 'count',
    periodTypes: ['daily'],
    // A state, not an event: the reader queries contacts, activities, bookings.
    eventTypes: [],
    aggregation: 'snapshot',
    minSamplesForBaseline: 7,
  },
  {
    key: 'cashflow.refund_rate',
    name: 'Refund Rate',
    description: 'Share of completed payments that were later refunded',
    category: 'cash_flow',
    unit: 'percentage',
    periodTypes: ['daily', 'weekly', 'monthly'],
    // Numerator first — see the generic branch of `computeRateMetric`, though
    // this key has its own case so the denominator is payments, not the sum.
    eventTypes: ['refund.completed', 'payment.completed'],
    aggregation: 'rate',
    minSamplesForBaseline: 7,
  },

  // Retention
  {
    key: 'retention.bookings_completed',
    name: 'Bookings Completed',
    description: 'Total bookings completed',
    category: 'retention',
    unit: 'count',
    periodTypes: ['daily', 'weekly'],
    eventTypes: ['booking.completed'],
    aggregation: 'count',
    minSamplesForBaseline: 7,
  },
  {
    key: 'retention.no_show_rate',
    name: 'No-Show Rate',
    description: 'Percentage of no-shows',
    category: 'retention',
    unit: 'percentage',
    periodTypes: ['weekly', 'monthly'],
    eventTypes: ['booking.no_show', 'booking.completed'],
    aggregation: 'rate',
    minSamplesForBaseline: 28,
  },
  {
    key: 'retention.rebooking_rate',
    name: 'Rebooking Rate',
    description: 'Percentage of clients who rebook',
    category: 'retention',
    unit: 'percentage',
    periodTypes: ['monthly'],
    eventTypes: ['booking.completed'],
    aggregation: 'rate',
    minSamplesForBaseline: 90,
  },

  // Operations
  {
    key: 'operations.calendar_utilization',
    name: 'Calendar Utilization',
    description: 'Percentage of available hours booked',
    category: 'operations',
    unit: 'percentage',
    periodTypes: ['weekly', 'monthly'],
    eventTypes: ['calendar.slot_filled'],
    aggregation: 'rate',
    minSamplesForBaseline: 28,
  },
];

/**
 * Get metric definition by key
 */
export function getMetricDefinition(key: MetricKey): MetricDefinition | undefined {
  return METRIC_DEFINITIONS.find((m) => m.key === key);
}

/**
 * Get all metric definitions for a category
 */
export function getMetricsForCategory(category: BusinessEventCategory): MetricDefinition[] {
  return METRIC_DEFINITIONS.filter((m) => m.category === category);
}
