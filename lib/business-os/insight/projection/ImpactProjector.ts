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

export interface ImpactProjection {
  /** What happens if user does nothing */
  doNothing: {
    summary: string;
    details: string;
    projectedLoss?: number;
    projectedEffort?: string;
  };

  /** What happens if they let the system handle it */
  letMeHandleIt: {
    summary: string;
    details: string;
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

export class ImpactProjector {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /**
   * Generate impact projection for an insight
   */
  async project(insight: Insight): Promise<ImpactProjection> {
    const rates = await this.getHistoricalRates(insight.user_id);

    switch (insight.detector_id) {
      case 'cash_ar_overdue':
        return this.projectCashArOverdue(insight, rates);

      case 'ret_no_show_spike':
        return this.projectNoShowSpike(insight, rates);

      case 'sales_stalled':
        return this.projectSalesStalled(insight, rates);

      case 'sales_reply_slow':
        return this.projectSalesReplySlow(insight);

      case 'ops_utilization_low':
        return this.projectOpsUtilizationLow(insight);

      default:
        return this.projectGeneric(insight);
    }
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
  private projectCashArOverdue(insight: Insight, rates: HistoricalRates): ImpactProjection {
    const arAmount = insight.current_value || 0;
    const invoiceCount = insight.affected_count || 0;
    const expectedRecovery = arAmount * rates.collectionRate;
    const manualTimeMinutes = invoiceCount * 15; // 15 min per invoice

    return {
      doNothing: {
        summary: `~$${arAmount.toLocaleString()} stays unpaid`,
        details: `${invoiceCount} invoice${invoiceCount !== 1 ? 's' : ''} remain${invoiceCount === 1 ? 's' : ''} overdue, requiring ~${Math.round(manualTimeMinutes / 60)} hour${manualTimeMinutes >= 120 ? 's' : ''} of manual follow-up`,
        projectedLoss: arAmount,
        projectedEffort: `${Math.round(manualTimeMinutes / 60)} hours of manual chasing`,
      },
      letMeHandleIt: {
        summary: `I chase all ${invoiceCount} today`,
        details: `And anything ${insight.process_parameters?.days_threshold || 7}+ days late from now on — you do nothing`,
        projectedOutcome: {
          cashRecovered: expectedRecovery,
          timeSaved: manualTimeMinutes,
        },
      },
      confidence: rates.collectionRate === DEFAULT_RATES.collectionRate ? 'medium' : 'high',
      basis: `Based on ${invoiceCount} eligible invoices and ${Math.round(rates.collectionRate * 100)}% historical collection rate`,
    };
  }

  /**
   * Project for no-show spike
   */
  private projectNoShowSpike(insight: Insight, rates: HistoricalRates): ImpactProjection {
    const noShowRate = insight.current_value || 0;
    const estimatedLoss = insight.estimated_impact_usd || 0;
    const expectedReduction = estimatedLoss * rates.noShowReduction;

    return {
      doNothing: {
        summary: `${noShowRate.toFixed(1)}% no-show rate continues`,
        details: `Potential loss of ~$${estimatedLoss.toLocaleString()} per week in missed appointments`,
        projectedLoss: estimatedLoss,
      },
      letMeHandleIt: {
        summary: `I send reminders 24h before each booking`,
        details: `Typically reduces no-shows by ${Math.round(rates.noShowReduction * 100)}%`,
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
  private projectSalesStalled(insight: Insight, rates: HistoricalRates): ImpactProjection {
    const stalledCount = insight.affected_count || 0;
    const avgDealValue = 500;
    const potentialValue = stalledCount * avgDealValue * 0.2; // 20% conversion
    const expectedResponses = Math.round(stalledCount * rates.responseRate);
    const manualTimeMinutes = stalledCount * 10;

    return {
      doNothing: {
        summary: `${stalledCount} lead${stalledCount !== 1 ? 's' : ''} go cold`,
        details: `Potential loss of ~$${potentialValue.toLocaleString()} in deals, plus ~${manualTimeMinutes} minutes of manual follow-up`,
        projectedLoss: potentialValue,
        projectedEffort: `${manualTimeMinutes} minutes of follow-up`,
      },
      letMeHandleIt: {
        summary: `I follow up with all ${stalledCount} today`,
        details: `Typically gets ${Math.round(rates.responseRate * 100)}% response rate`,
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
        details: `${currentReplyTime.toFixed(1)}h average vs your baseline of ${baselineReplyTime.toFixed(1)}h — may impact conversion rates`,
      },
      letMeHandleIt: {
        summary: `I can draft reply templates`,
        details: `Pre-written templates for common enquiries can speed up responses`,
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
  private projectOpsUtilizationLow(insight: Insight): ImpactProjection {
    const utilization = insight.current_value || 0;
    const unfilledHours = insight.affected_count || 0;
    const avgBookingValue = 75;
    const potentialRevenue = unfilledHours * avgBookingValue;

    return {
      doNothing: {
        summary: `${(100 - utilization).toFixed(0)}% of your time stays empty`,
        details: `~${unfilledHours} hours available this week, potential revenue of ~$${potentialRevenue.toLocaleString()}`,
        projectedLoss: potentialRevenue,
      },
      letMeHandleIt: {
        summary: `Consider promoting available slots`,
        details: `Run a special offer or reach out to past clients to fill your calendar`,
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
        details: insight.description || 'This pattern will continue without intervention',
      },
      letMeHandleIt: {
        summary: 'Take recommended action',
        details: insight.recommendation || 'Review and address this insight',
        projectedOutcome: {},
      },
      confidence: 'low',
      basis: 'Generic projection — specific impact unknown',
    };
  }
}
