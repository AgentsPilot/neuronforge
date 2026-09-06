/**
 * Correlation Patterns
 *
 * Defines the patterns that connect multiple detector signals
 * into unified, story-driven insights.
 *
 * These patterns create the "WOW" factor by showing business owners
 * how different issues are connected.
 */

import type { CorrelationPattern } from './types';

/**
 * All defined correlation patterns
 */
export const CORRELATION_PATTERNS: CorrelationPattern[] = [
  // Pattern 1: Acquisition Funnel Breakdown
  {
    id: 'funnel_breakdown',
    name: 'Acquisition Funnel Breakdown',
    category: 'funnel',
    requiredDetectors: ['acq_traffic_drop', 'acq_low_conversion'],
    optionalDetectors: ['crm_cold_leads', 'web_missing_cta', 'web_page_underperform'],
    minMatches: 2,
    storyTemplate:
      'Your acquisition funnel is broken at multiple points. ' +
      '{traffic_issue} and {conversion_issue}. ' +
      '{optional_context}' +
      'This combination is causing a significant lead generation problem.',
    actionTemplate:
      'Review your marketing channels and website conversion elements. ' +
      'Check that all pages have clear calls-to-action and that forms are working properly.',
    severityBoost: 1.5,
    priority: 100,
  },

  // Pattern 2: Revenue at Risk
  {
    id: 'revenue_at_risk',
    name: 'Revenue at Risk',
    category: 'revenue',
    requiredDetectors: ['cash_ar_overdue', 'cash_payment_issues'],
    optionalDetectors: ['ret_cancellation_spike', 'cash_ar_aging', 'cash_refund_pattern'],
    minMatches: 2,
    storyTemplate:
      'Revenue is at risk from multiple angles. ' +
      '{ar_issue} and {payment_issue}. ' +
      '{optional_context}' +
      'Total exposure: ${total_impact}.',
    actionTemplate:
      'Prioritize collection efforts and investigate the root causes of payment failures. ' +
      'Consider implementing automated payment reminders and retry logic.',
    severityBoost: 1.5,
    priority: 95,
  },

  // Pattern 3: Client Retention Crisis
  {
    id: 'retention_crisis',
    name: 'Client Retention Crisis',
    category: 'retention',
    requiredDetectors: ['crm_engagement_decay', 'ret_repeat_booking_low'],
    optionalDetectors: ['ret_cancellation_spike', 'ret_no_show_spike'],
    minMatches: 2,
    storyTemplate:
      'Your clients are disengaging. ' +
      '{engagement_issue} and {rebooking_issue}. ' +
      '{optional_context}' +
      'This signals a retention problem that needs immediate attention.',
    actionTemplate:
      'Launch a client re-engagement campaign. ' +
      'Consider reaching out personally to at-risk clients and gathering feedback on their experience.',
    severityBoost: 1.4,
    priority: 90,
  },

  // Pattern 4: Sales Pipeline Stall
  {
    id: 'pipeline_stall',
    name: 'Sales Pipeline Stall',
    category: 'pipeline',
    requiredDetectors: ['crm_cold_leads', 'conv_pipeline_stuck'],
    optionalDetectors: ['conv_followup_overdue', 'sales_stalled', 'sales_reply_slow'],
    minMatches: 2,
    storyTemplate:
      'Your sales pipeline is stalling. ' +
      '{cold_leads_issue} and {stuck_deals_issue}. ' +
      '{optional_context}' +
      'Estimated opportunity at risk: ${total_impact}.',
    actionTemplate:
      'Clear your follow-up backlog immediately. ' +
      'Move stuck deals forward with targeted outreach and consider re-qualifying cold leads.',
    severityBoost: 1.4,
    priority: 85,
  },

  // Pattern 5: Capacity Mismatch
  {
    id: 'capacity_mismatch',
    name: 'Capacity Mismatch',
    category: 'capacity',
    requiredDetectors: ['ops_utilization_low', 'acq_traffic_drop'],
    optionalDetectors: ['ops_peak_unutilized', 'web_missing_cta'],
    minMatches: 2,
    storyTemplate:
      'You have capacity but no demand. ' +
      '{utilization_issue} and {traffic_issue}. ' +
      '{optional_context}' +
      'You need to drive more bookings to fill available slots.',
    actionTemplate:
      'Consider launching a promotional campaign or sending an availability blast to recent clients. ' +
      'Review your marketing spend and website conversion rates.',
    severityBoost: 1.3,
    priority: 80,
  },

  // Pattern 6: Service Health Issue
  {
    id: 'service_health',
    name: 'Service Health Issue',
    category: 'service',
    requiredDetectors: ['ret_cancellation_spike', 'ops_last_minute_cancels'],
    optionalDetectors: ['ret_no_show_spike', 'cash_refund_pattern'],
    minMatches: 2,
    storyTemplate:
      "There's a service delivery issue. " +
      '{cancellation_issue} and {last_minute_issue}. ' +
      '{optional_context}' +
      'Investigate if there\'s a common cause.',
    actionTemplate:
      'Review recent cancellation reasons and client feedback. ' +
      'Check if issues are tied to specific services, times, or communication gaps.',
    severityBoost: 1.4,
    priority: 75,
  },

  // Pattern 7: Website Conversion Crisis
  {
    id: 'website_crisis',
    name: 'Website Conversion Crisis',
    category: 'funnel',
    requiredDetectors: ['web_missing_cta', 'web_page_underperform'],
    optionalDetectors: ['web_incomplete_content', 'web_mobile_issues', 'acq_low_conversion'],
    minMatches: 2,
    storyTemplate:
      'Your website is not converting visitors. ' +
      '{cta_issue} and {page_issue}. ' +
      '{optional_context}' +
      'Visitors are leaving without taking action.',
    actionTemplate:
      'Add clear calls-to-action to key pages. ' +
      'Ensure booking widgets are visible and forms are easy to complete.',
    severityBoost: 1.3,
    priority: 70,
  },

  // Pattern 8: Cash Flow Warning
  {
    id: 'cash_flow_warning',
    name: 'Cash Flow Warning',
    category: 'revenue',
    requiredDetectors: ['cash_ar_aging', 'cash_cards_expiring'],
    optionalDetectors: ['cash_payment_issues', 'cash_ar_overdue'],
    minMatches: 2,
    storyTemplate:
      'Cash flow problems are developing. ' +
      '{aging_issue} and {cards_issue}. ' +
      '{optional_context}' +
      'Take action now to prevent payment disruptions.',
    actionTemplate:
      'Send payment reminders to aging invoices. ' +
      'Notify clients with expiring cards to update their payment methods.',
    severityBoost: 1.3,
    priority: 65,
  },

  // Pattern 9: Pricing Strategy Issue
  {
    id: 'pricing_issue',
    name: 'Pricing Strategy Issue',
    category: 'revenue',
    requiredDetectors: ['pricing_discount_abuse', 'pricing_intro_offer_stuck'],
    optionalDetectors: ['cash_refund_pattern'],
    minMatches: 2,
    storyTemplate:
      'Your pricing strategy needs attention. ' +
      '{discount_issue} and {intro_issue}. ' +
      '{optional_context}' +
      'Revenue is being left on the table.',
    actionTemplate:
      'Review your discounting policies. ' +
      'Create a follow-up sequence for intro offer users to convert them to full price.',
    severityBoost: 1.2,
    priority: 60,
  },

  // Pattern 10: Operations Inefficiency
  {
    id: 'ops_inefficiency',
    name: 'Operations Inefficiency',
    category: 'capacity',
    requiredDetectors: ['ops_service_performance', 'ops_peak_unutilized'],
    optionalDetectors: ['ops_utilization_low'],
    minMatches: 2,
    storyTemplate:
      'Operations are running inefficiently. ' +
      '{service_issue} and {peak_issue}. ' +
      '{optional_context}' +
      'You\'re not maximizing your capacity.',
    actionTemplate:
      'Review underperforming services - consider promoting them or retiring them. ' +
      'Send availability reminders for peak times that are going unfilled.',
    severityBoost: 1.2,
    priority: 55,
  },
];

/**
 * Get a pattern by ID
 */
export function getPattern(patternId: string): CorrelationPattern | undefined {
  return CORRELATION_PATTERNS.find((p) => p.id === patternId);
}

/**
 * Get patterns by category
 */
export function getPatternsByCategory(
  category: CorrelationPattern['category']
): CorrelationPattern[] {
  return CORRELATION_PATTERNS.filter((p) => p.category === category);
}
