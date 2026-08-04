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
  | 'acquisition.form_conversion_rate';

// Conversion metrics
export type ConversionMetricKey =
  | 'conversion.new_contacts'
  | 'conversion.lead_to_client_rate'
  | 'conversion.stage_progression_rate';

// Sales metrics
export type SalesMetricKey =
  | 'sales.enquiries_received'
  | 'sales.enquiries_replied'
  | 'sales.avg_reply_time_hours'
  | 'sales.stalled_enquiries'
  | 'sales.proposal_acceptance_rate';

// Cash flow metrics
export type CashFlowMetricKey =
  | 'cashflow.revenue_mtd'
  | 'cashflow.revenue_wtd'
  | 'cashflow.ar_total'
  | 'cashflow.ar_overdue_usd'
  | 'cashflow.avg_days_to_pay'
  | 'cashflow.payment_success_rate';

// Retention metrics
export type RetentionMetricKey =
  | 'retention.bookings_completed'
  | 'retention.no_show_count'
  | 'retention.no_show_rate'
  | 'retention.cancellation_rate'
  | 'retention.rebooking_rate'
  | 'retention.clients_at_risk';

// Operations metrics
export type OperationsMetricKey =
  | 'operations.calendar_utilization'
  | 'operations.available_hours'
  | 'operations.booked_hours'
  | 'operations.active_services';

// Pricing metrics
export type PricingMetricKey =
  | 'pricing.avg_service_price'
  | 'pricing.avg_discount_percent'
  | 'pricing.intro_offer_conversion_rate';

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
