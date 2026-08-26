/**
 * Payment Issues Detector
 *
 * Detects payment-related issues that need attention:
 * - Failed payments that need retry/follow-up
 * - Pending payments awaiting confirmation
 *
 * NOTE: Refunds are handled separately by CashRefundPatternDetector.
 * This detector focuses on actual payment failures (money not collected).
 *
 * Returns the highest priority issue found.
 *
 * @see docs/INSIGHT_SYSTEM_PLAN.md Section 3
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';
import type { CashFlowMetricKey } from '../../metrics/types';
import { COMMON_GUARDRAILS } from '../types';

interface PaymentIssue {
  type: 'failed' | 'pending';
  transactions: Array<{ id: string; amount: string; contact_id?: string }>;
  totalAmount: number;
  severity: InsightSeverity;
  priority: number; // Higher = more urgent
}

export class PaymentIssuesDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'cash_payment_issues',
    name: 'Payment Issues',
    category: 'cash_flow',
    description: 'Detects failed payments, pending transactions, and refunds',

    watchedMetrics: ['cashflow.failed_payments', 'cashflow.pending_payments'],
    eventTypes: ['payment.failed', 'payment.pending'],

    baselineWindow: 'week',
    thresholdType: 'absolute',
    threshold: 0,
    direction: 'above',
    minSamples: 1,

    severityFn: (totalAmount: number, count: number): InsightSeverity => {
      if (totalAmount >= 3000 || count >= 5) return 'high';
      if (totalAmount >= 1000 || count >= 3) return 'medium';
      return 'low';
    },

    pairedProcessId: 'review_payment_issues',
    consentTier: 'suggest',
    eligibleForAutomation: false,
    ownerParameters: [
      {
        id: 'days_lookback',
        label: 'Days Lookback',
        type: 'number',
        default: 14,
        min: 1,
        max: 30,
      },
    ],
    guardrails: [COMMON_GUARDRAILS.max_20_per_run],
    cooldownHours: 24,
  };

  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  private getSeverity(type: 'failed' | 'pending', amount: number, count: number): InsightSeverity {
    // Failed payments are most urgent
    if (type === 'failed') {
      if (amount >= 2000 || count >= 4) return 'high';
      if (amount >= 500 || count >= 2) return 'medium';
      return 'low';
    }
    // Pending payments need attention
    if (amount >= 3000 || count >= 5) return 'high';
    if (amount >= 1000 || count >= 3) return 'medium';
    return 'low';
  }

  private getPriority(type: 'failed' | 'pending'): number {
    switch (type) {
      case 'failed': return 2;    // Highest - money not collected
      case 'pending': return 1;   // Medium - money delayed
    }
  }

  async evaluate(userId: string): Promise<DetectionResult | null> {
    // Check cooldown
    if (await this.isOnCooldown(userId)) {
      this.logDetection(userId, null);
      return null;
    }

    const daysLookback = 14;
    const lookbackDate = new Date();
    lookbackDate.setDate(lookbackDate.getDate() - daysLookback);

    // Query payment issues in parallel (refunds handled by CashRefundPatternDetector)
    const [failedResult, pendingResult] = await Promise.all([
      // Failed payments (last 14 days)
      this.supabase
        .from('payment_transactions')
        .select('id, amount, contact_id')
        .eq('user_id', userId)
        .eq('status', 'failed')
        .gte('created_at', lookbackDate.toISOString())
        .gt('amount', 0),

      // Pending payments (older than 2 days)
      this.supabase
        .from('payment_transactions')
        .select('id, amount, contact_id')
        .eq('user_id', userId)
        .eq('status', 'pending')
        .lt('created_at', new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString())
        .gt('amount', 0),
    ]);

    // Process each type
    const issues: PaymentIssue[] = [];

    const processTransactions = (
      data: Array<{ id: string; amount: string; contact_id?: string }> | null,
      type: 'failed' | 'pending'
    ) => {
      if (!data || data.length === 0) return;
      const totalAmount = data.reduce((sum, t) => sum + parseFloat(t.amount || '0'), 0);
      if (totalAmount > 0) {
        issues.push({
          type,
          transactions: data,
          totalAmount,
          severity: this.getSeverity(type, totalAmount, data.length),
          priority: this.getPriority(type),
        });
      }
    };

    processTransactions(failedResult.data, 'failed');
    processTransactions(pendingResult.data, 'pending');

    // No issues found
    if (issues.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    // Sort by priority and severity, take the highest
    issues.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      // Same priority, use severity
      const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      return severityOrder[b.severity] - severityOrder[a.severity];
    });

    const topIssue = issues[0];
    const otherIssuesCount = issues.slice(1).reduce((sum, i) => sum + i.transactions.length, 0);

    const metricKey = `cashflow.${topIssue.type}_payments` as CashFlowMetricKey;
    const entityType = topIssue.type === 'failed' ? 'failed_payment' :
                       topIssue.type === 'pending' ? 'pending_payment' : 'refund';

    const result = this.createDetectionResult({
      severity: topIssue.severity,
      metricKey,
      currentValue: topIssue.totalAmount,
      baselineValue: 0,
      thresholdValue: 0,
      percentChange: 100,
      direction: 'above',
      affectedEntityType: entityType,
      affectedEntityIds: topIssue.transactions.map((t) => t.id),
      affectedCount: topIssue.transactions.length,
      estimatedImpactUsd: topIssue.totalAmount,
      impactDirection: topIssue.type === 'failed' ? 'loss' : 'opportunity',
      impactPeriod: 'monthly',
      processParameters: {
        issue_type: topIssue.type,
        days_lookback: daysLookback,
        payment_ids: topIssue.transactions.map((t) => t.id),
        contact_ids: [...new Set(topIssue.transactions.map((t) => t.contact_id).filter(Boolean))],
        other_issues_count: otherIssuesCount,
        all_issues: issues.map((i) => ({
          type: i.type,
          count: i.transactions.length,
          amount: i.totalAmount,
        })),
      },
    });

    this.logDetection(userId, result);
    return result;
  }
}
