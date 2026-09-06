/**
 * Impact Projector
 *
 * Generates before/after projections for insights.
 * Shows what happens if user does nothing vs. lets the system handle it.
 *
 * @see docs/INSIGHT_SYSTEM_PLAN.md Section 5
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';
import type { Insight } from '../repository/InsightRepository';
import { TRIGGERABLE_PROCESSES } from '../kernel/TriggerableProcesses';

const logger = createLogger({ module: 'ImpactProjector' });

// ===========================
// Types
// ===========================

/**
 * A line of projection copy, in the reader's language.
 *
 * The projector runs on the server and has no access to the interface language,
 * so it names a dictionary key and the numbers that fill it rather than writing
 * the sentence itself. `text` stays as the English rendering: it is what older
 * callers read, and what the UI falls back to if a key is ever missing.
 *
 * The alternative — giving the projector its own Hebrew and Spanish strings —
 * would put a second translation store on the server, to be kept in step with
 * the one the interface already has. That is how "Issue persists" ended up
 * sitting under a Hebrew heading.
 */
export interface ProjectionLine {
  /** English rendering. Fallback only. */
  text: string;
  /** Dictionary key the UI should translate, e.g. `insight.generic.do_nothing`. */
  key?: string;
  /** Values for the {placeholders} in that key. */
  params?: Record<string, string | number>;
}

export interface ImpactProjection {
  /** What happens if user does nothing */
  doNothing: {
    summary: string;
    details: string;
    /** Translatable forms of the two strings above. */
    summaryLine?: ProjectionLine;
    detailsLine?: ProjectionLine;
    projectedLoss?: number;
    projectedEffort?: string;
  };

  /** What happens if they let the system handle it */
  letMeHandleIt: {
    summary: string;
    details: string;
    summaryLine?: ProjectionLine;
    detailsLine?: ProjectionLine;
    projectedOutcome: {
      cashRecovered?: number;
      timeSaved?: number; // minutes
      leadsContacted?: number;
      remindersSet?: number;
    };
  };

  /** Confidence in the projection */
  confidence: 'low' | 'medium' | 'high';

  /** Explanation of confidence */
  basis: string;
}

// ===========================
// Historical Collection Rates
// ===========================

interface HistoricalRates {
  collectionRate: number; // % of chased invoices that get paid
  responseRate: number;   // % of follow-ups that get responses
  noShowReduction: number; // % reduction in no-shows with reminders
}

const DEFAULT_RATES: HistoricalRates = {
  collectionRate: 0.30,    // 30% collection rate
  responseRate: 0.25,      // 25% response rate
  noShowReduction: 0.40,   // 40% reduction in no-shows
};

// ===========================
// ImpactProjector
// ===========================

/**
 * Amounts here are the business's own money. The column they come from is
 * called `estimated_impact_usd`, but detectors store raw amounts in whatever
 * the business charges, so nothing may assume dollars.
 */
const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  ILS: '₪',
  EUR: '€',
  GBP: '£',
};

function formatMoney(amount: number | null | undefined, currency: string): string {
  const value = Number(amount) || 0;
  const symbol = CURRENCY_SYMBOLS[currency?.toUpperCase()];
  return symbol ? `${symbol}${value.toLocaleString()}` : `${value.toLocaleString()} ${currency?.toUpperCase() || ''}`.trim();
}

export class ImpactProjector {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /**
   * Generate impact projection for an insight
   */
  async project(insight: Insight): Promise<ImpactProjection> {
    const [rates, currency] = await Promise.all([
      this.getHistoricalRates(insight.user_id),
      this.getUserCurrency(insight.user_id),
    ]);

    switch (insight.detector_id) {
      case 'cash_ar_overdue':
        return this.projectCashArOverdue(insight, rates, currency);

      case 'ret_no_show_spike':
        return this.projectNoShowSpike(insight, rates, currency);

      case 'sales_stalled':
        return this.projectSalesStalled(insight, rates, currency);

      case 'sales_reply_slow':
        return this.projectSalesReplySlow(insight);

      case 'ops_utilization_low':
        return this.projectOpsUtilizationLow(insight, currency);

      default:
        return this.projectGeneric(insight);
    }
  }

  /**
   * What this business charges in, read from what it bills. USD is the last
   * resort, and a guess when it happens.
   */
  private async getUserCurrency(userId: string): Promise<string> {
    const { data: service } = await this.supabase
      .from('scheduling_services')
      .select('currency')
      .eq('user_id', userId)
      .not('currency', 'is', null)
      .limit(1)
      .maybeSingle();

    if (service?.currency) return service.currency;

    const { data: invoice } = await this.supabase
      .from('payment_invoices')
      .select('currency')
      .eq('user_id', userId)
      .not('currency', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    return invoice?.currency || 'USD';
  }

  /**
   * Get historical rates for a user (or use defaults)
   */
  private async getHistoricalRates(userId: string): Promise<HistoricalRates> {
    try {
      // Try to calculate from historical data
      const { data: executions } = await this.supabase
        .from('kernel_action_log')
        .select('process_id, items_processed, items_succeeded, value_impact')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (!executions || executions.length < 5) {
        return DEFAULT_RATES;
      }

      // Calculate actual rates from history
      const chaseExecutions = executions.filter((e) => e.process_id === 'chase_overdue_invoices');
      const followupExecutions = executions.filter((e) => e.process_id === 'send_followup_nudge');

      let collectionRate = DEFAULT_RATES.collectionRate;
      let responseRate = DEFAULT_RATES.responseRate;

      if (chaseExecutions.length >= 3) {
        const totalChased = chaseExecutions.reduce((sum, e) => sum + (e.items_processed || 0), 0);
        const totalCollected = chaseExecutions.reduce((sum, e) => sum + (e.items_succeeded || 0), 0);
        if (totalChased > 0) {
          collectionRate = totalCollected / totalChased;
        }
      }

      if (followupExecutions.length >= 3) {
        const totalFollowed = followupExecutions.reduce((sum, e) => sum + (e.items_processed || 0), 0);
        const totalResponded = followupExecutions.reduce((sum, e) => sum + (e.items_succeeded || 0), 0);
        if (totalFollowed > 0) {
          responseRate = totalResponded / totalFollowed;
        }
      }

      return {
        collectionRate,
        responseRate,
        noShowReduction: DEFAULT_RATES.noShowReduction,
      };

    } catch (error) {
      logger.warn({ err: error }, 'Failed to get historical rates');
      return DEFAULT_RATES;
    }
  }

  /**
   * Project for overdue invoices
   */
  private projectCashArOverdue(insight: Insight, rates: HistoricalRates, currency: string): ImpactProjection {
    const arAmount = insight.current_value || 0;
    const invoiceCount = insight.affected_count || 0;
    const expectedRecovery = arAmount * rates.collectionRate;
    const manualTimeMinutes = invoiceCount * 15; // 15 min per invoice

    const usingDefaultRate = rates.collectionRate === DEFAULT_RATES.collectionRate;

    return {
      doNothing: {
        summary: `~${formatMoney(arAmount, currency)} stays unpaid`,
        summaryLine: {
          text: `~${formatMoney(arAmount, currency)} stays unpaid`,
          key: 'insight.cash_ar_overdue.do_nothing',
          params: { amount: formatMoney(arAmount, currency) },
        },
        details: `${invoiceCount} invoice${invoiceCount !== 1 ? 's' : ''} remain${invoiceCount === 1 ? 's' : ''} overdue, requiring ~${Math.round(manualTimeMinutes / 60)} hour${manualTimeMinutes >= 120 ? 's' : ''} of manual follow-up`,
        detailsLine: {
          text: `${invoiceCount} invoices remain overdue, requiring ~${Math.round(manualTimeMinutes / 60)} hours of manual follow-up`,
          key: 'insight.cash_ar_overdue.do_nothing_detail',
          params: { hours: Math.round(manualTimeMinutes / 60) },
        },
        projectedLoss: arAmount,
        projectedEffort: `${Math.round(manualTimeMinutes / 60)} hours of manual chasing`,
      },
      letMeHandleIt: {
        summary: `I chase all ${invoiceCount} today`,
        summaryLine: {
          text: `I chase all ${invoiceCount} today`,
          key: 'insight.cash_ar_overdue.handle_it',
          params: { count: invoiceCount },
        },
        details: `And anything ${insight.process_parameters?.days_threshold || 7}+ days late from now on — you do nothing`,
        detailsLine: {
          text: `And anything ${insight.process_parameters?.days_threshold || 7}+ days late from now on — you do nothing`,
          key: 'insight.cash_ar_overdue.handle_it_detail',
          params: { days: Number(insight.process_parameters?.days_threshold) || 7 },
        },
        projectedOutcome: {
          cashRecovered: expectedRecovery,
          timeSaved: manualTimeMinutes,
        },
      },
      // Say WHICH rate this is. The wording claimed "historical" even when the
      // number was the hardcoded default — the confidence flag hedged, but the
      // sentence the user reads did not. A projection is fine; describing an
      // assumption as measured history is not.
      confidence: usingDefaultRate ? 'medium' : 'high',
      basis: usingDefaultRate
        ? `Based on ${invoiceCount} eligible invoices and an assumed ` +
          `${Math.round(rates.collectionRate * 100)}% collection rate — not enough of your own ` +
          `history yet to measure it`
        : `Based on ${invoiceCount} eligible invoices and your own ` +
          `${Math.round(rates.collectionRate * 100)}% collection rate`,
    };
  }

  /**
   * Project for no-show spike
   */
  private projectNoShowSpike(insight: Insight, rates: HistoricalRates, currency: string): ImpactProjection {
    const noShowRate = insight.current_value || 0;
    const estimatedLoss = insight.estimated_impact_usd || 0;
    const expectedReduction = estimatedLoss * rates.noShowReduction;

    return {
      doNothing: {
        summary: `${noShowRate.toFixed(1)}% no-show rate continues`,
        summaryLine: {
          text: `${noShowRate.toFixed(1)}% no-show rate continues`,
          key: 'insight.ret_no_show_spike.do_nothing',
          params: { percent: noShowRate.toFixed(1) },
        },
        details: `Potential loss of ~${formatMoney(estimatedLoss, currency)} per week in missed appointments`,
        detailsLine: {
          text: `Potential loss of ~${formatMoney(estimatedLoss, currency)} per week in missed appointments`,
          key: 'insight.ret_no_show_spike.do_nothing_detail',
          params: { amount: formatMoney(estimatedLoss, currency) },
        },
        projectedLoss: estimatedLoss,
      },
      letMeHandleIt: {
        summary: `I send reminders 24h before each booking`,
        summaryLine: {
          text: `I send reminders 24h before each booking`,
          key: 'insight.ret_no_show_spike.handle_it',
        },
        details: `Typically reduces no-shows by ${Math.round(rates.noShowReduction * 100)}%`,
        detailsLine: {
          text: `Typically reduces no-shows by ${Math.round(rates.noShowReduction * 100)}%`,
          key: 'insight.ret_no_show_spike.handle_it_detail',
          params: { percent: Math.round(rates.noShowReduction * 100) },
        },
        projectedOutcome: {
          cashRecovered: expectedReduction,
          remindersSet: insight.affected_count || 0,
        },
      },
      confidence: 'medium',
      basis: `Based on ${Math.round(rates.noShowReduction * 100)}% typical no-show reduction with reminders`,
    };
  }

  /**
   * Project for stalled sales
   */
  private projectSalesStalled(insight: Insight, rates: HistoricalRates, currency: string): ImpactProjection {
    const stalledCount = insight.affected_count || 0;
    const avgDealValue = 500;
    const potentialValue = stalledCount * avgDealValue * 0.2; // 20% conversion
    const expectedResponses = Math.round(stalledCount * rates.responseRate);
    const manualTimeMinutes = stalledCount * 10;

    return {
      doNothing: {
        summary: `${stalledCount} lead${stalledCount !== 1 ? 's' : ''} go cold`,
        summaryLine: {
          text: `${stalledCount} leads go cold`,
          key: 'insight.sales_stalled.do_nothing',
          params: { count: stalledCount },
        },
        details: `Potential loss of ~${formatMoney(potentialValue, currency)} in deals, plus ~${manualTimeMinutes} minutes of manual follow-up`,
        detailsLine: {
          text: `Potential loss of ~${formatMoney(potentialValue, currency)} in deals, plus ~${manualTimeMinutes} minutes of manual follow-up`,
          key: 'insight.sales_stalled.do_nothing_detail',
          params: { amount: formatMoney(potentialValue, currency), minutes: manualTimeMinutes },
        },
        projectedLoss: potentialValue,
        projectedEffort: `${manualTimeMinutes} minutes of follow-up`,
      },
      letMeHandleIt: {
        summary: `I follow up with all ${stalledCount} today`,
        summaryLine: {
          text: `I follow up with all ${stalledCount} today`,
          key: 'insight.sales_stalled.handle_it',
          params: { count: stalledCount },
        },
        details: `Typically gets ${Math.round(rates.responseRate * 100)}% response rate`,
        detailsLine: {
          text: `Typically gets ${Math.round(rates.responseRate * 100)}% response rate`,
          key: 'insight.sales_stalled.handle_it_detail',
          params: { percent: Math.round(rates.responseRate * 100) },
        },
        projectedOutcome: {
          leadsContacted: stalledCount,
          timeSaved: manualTimeMinutes,
        },
      },
      confidence: rates.responseRate === DEFAULT_RATES.responseRate ? 'medium' : 'high',
      basis: `Based on ${stalledCount} stalled enquiries and ${Math.round(rates.responseRate * 100)}% historical response rate`,
    };
  }

  /**
   * Project for slow reply times (advisory only)
   */
  private projectSalesReplySlow(insight: Insight): ImpactProjection {
    const currentReplyTime = insight.current_value || 0;
    const baselineReplyTime = insight.baseline_value || 0;
    const percentSlower = insight.percent_change || 0;

    return {
      doNothing: {
        summary: `Reply time stays ${Math.abs(percentSlower).toFixed(0)}% slower`,
        summaryLine: {
          text: `Reply time stays ${Math.abs(percentSlower).toFixed(0)}% slower`,
          key: 'insight.sales_reply_slow.do_nothing',
          params: { percent: Math.abs(percentSlower).toFixed(0) },
        },
        details: `${currentReplyTime.toFixed(1)}h average vs your baseline of ${baselineReplyTime.toFixed(1)}h — may impact conversion rates`,
        detailsLine: {
          text: `${currentReplyTime.toFixed(1)}h average vs your baseline of ${baselineReplyTime.toFixed(1)}h — may impact conversion rates`,
          key: 'insight.sales_reply_slow.do_nothing_detail',
          params: { current: currentReplyTime.toFixed(1), baseline: baselineReplyTime.toFixed(1) },
        },
      },
      letMeHandleIt: {
        summary: `I can draft reply templates`,
        summaryLine: { text: `I can draft reply templates`, key: 'insight.sales_reply_slow.handle_it' },
        details: `Pre-written templates for common enquiries can speed up responses`,
        detailsLine: {
          text: `Pre-written templates for common enquiries can speed up responses`,
          key: 'insight.sales_reply_slow.handle_it_detail',
        },
        projectedOutcome: {
          timeSaved: 30, // 30 minutes saved with templates
        },
      },
      confidence: 'low',
      basis: 'Advisory insight — no direct action available',
    };
  }

  /**
   * Project for low utilization (advisory only)
   */
  private projectOpsUtilizationLow(insight: Insight, currency: string): ImpactProjection {
    const utilization = insight.current_value || 0;
    const unfilledHours = insight.affected_count || 0;
    const avgBookingValue = 75;
    const potentialRevenue = unfilledHours * avgBookingValue;

    return {
      doNothing: {
        summary: `${(100 - utilization).toFixed(0)}% of your time stays empty`,
        summaryLine: {
          text: `${(100 - utilization).toFixed(0)}% of your time stays empty`,
          key: 'insight.ops_utilization_low.do_nothing',
          params: { percent: (100 - utilization).toFixed(0) },
        },
        details: `~${unfilledHours} hours available this week, potential revenue of ~${formatMoney(potentialRevenue, currency)}`,
        detailsLine: {
          text: `~${unfilledHours} hours available this week, potential revenue of ~${formatMoney(potentialRevenue, currency)}`,
          key: 'insight.ops_utilization_low.do_nothing_detail',
          params: { hours: unfilledHours, amount: formatMoney(potentialRevenue, currency) },
        },
        projectedLoss: potentialRevenue,
      },
      letMeHandleIt: {
        summary: `Consider promoting available slots`,
        summaryLine: { text: `Consider promoting available slots`, key: 'insight.ops_utilization_low.handle_it' },
        details: `Run a special offer or reach out to past clients to fill your calendar`,
        detailsLine: {
          text: `Run a special offer or reach out to past clients to fill your calendar`,
          key: 'insight.ops_utilization_low.handle_it_detail',
        },
        projectedOutcome: {},
      },
      confidence: 'low',
      basis: 'Advisory insight — consider promotional activities',
    };
  }

  /**
   * Generic projection for unknown detectors
   */
  private projectGeneric(insight: Insight): ImpactProjection {
    return {
      doNothing: {
        summary: 'Issue persists',
        summaryLine: { text: 'Issue persists', key: 'insight.generic.do_nothing' },
        // Deliberately NOT the insight's description: it is already displayed
        // in full directly above this panel, and repeating it verbatim as the
        // consequence of inaction said nothing the reader had not just read.
        details: 'This pattern will continue without intervention',
        detailsLine: {
          text: 'This pattern will continue without intervention',
          key: 'insight.generic.do_nothing_generic_detail',
        },
      },
      letMeHandleIt: {
        summary: 'Take recommended action',
        summaryLine: { text: 'Take recommended action', key: 'insight.generic.handle_it' },
        // The recommendation IS worth repeating here — it is the thing being
        // offered, and it is generated in the user's language.
        details: insight.recommendation || 'Review and address this insight',
        detailsLine: insight.recommendation
          ? { text: insight.recommendation }
          : { text: 'Review and address this insight', key: 'insight.generic.handle_it_detail' },
        projectedOutcome: {},
      },
      confidence: 'low',
      basis: 'Generic projection — specific impact unknown',
    };
  }
}
