/**
 * Cash Refund Pattern Detector
 *
 * Detects high refund rates or frequent refunds that signal service issues.
 *
 * @see docs/INSIGHT_SYSTEM_PLAN.md
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';

export class CashRefundPatternDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'cash_refund_pattern',
    name: 'Refund Pattern Alert',
    category: 'cash_flow',
    description: 'Detects high refund rate (>5%) or frequent refunds',

    watchedMetrics: ['cashflow.refund_rate'],
    eventTypes: ['refund.completed'],

    baselineWindow: 'month',
    thresholdType: 'absolute',
    threshold: 5, // 5% refund rate or 3+ refunds
    direction: 'above',
    minSamples: 10, // Need at least 10 transactions

    severityFn: (refundRate: number, refundCount: number): InsightSeverity => {
      if (refundRate >= 15 || refundCount >= 8) return 'critical';
      if (refundRate >= 10 || refundCount >= 5) return 'high';
      if (refundRate >= 5 || refundCount >= 3) return 'medium';
      return 'low';
    },

    pairedProcessId: 'refund_analysis_report',
    consentTier: 'suggest',
    eligibleForAutomation: false,
    ownerParameters: [],
    guardrails: [],
    cooldownHours: 168, // 1 week
  };

  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async evaluate(userId: string): Promise<DetectionResult | null> {
    // Check cooldown
    if (await this.isOnCooldown(userId)) {
      this.logDetection(userId, null);
      return null;
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Get all transactions in last 30 days
    const { data: transactions, error } = await this.supabase
      .from('payment_transactions')
      .select('id, amount, status, refund_status, refunded_amount, refund_reason, contact_id, created_at')
      .eq('user_id', userId)
      .gte('created_at', thirtyDaysAgo.toISOString());

    if (error) {
      throw error;
    }

    if (!transactions || transactions.length < this.definition.minSamples) {
      this.logDetection(userId, null);
      return null;
    }

    // Calculate metrics
    const succeededTransactions = transactions.filter((t) => t.status === 'succeeded');
    const refundedTransactions = transactions.filter((t) =>
      t.refund_status === 'full' || t.refund_status === 'partial'
    );

    if (succeededTransactions.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    const refundCount = refundedTransactions.length;
    const totalTransactions = succeededTransactions.length + refundedTransactions.length;
    const refundRate = (refundCount / totalTransactions) * 100;

    // Check thresholds
    if (refundRate < this.definition.threshold && refundCount < 3) {
      this.logDetection(userId, null);
      return null;
    }

    // Calculate total refunded amount
    const totalRefunded = refundedTransactions.reduce((sum, t) =>
      sum + parseFloat(t.refunded_amount || t.amount || '0'), 0);

    // Analyze refund reasons
    const reasons = refundedTransactions.reduce((acc, t) => {
      const reason = t.refund_reason || 'No reason provided';
      acc[reason] = (acc[reason] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Calculate severity
    const severity = this.definition.severityFn(refundRate, refundCount);

    // Get contact info
    const contactIds = [...new Set(refundedTransactions.map((t) => t.contact_id).filter(Boolean))];
    let contactNames: Record<string, string> = {};

    if (contactIds.length > 0) {
      const { data: contacts } = await this.supabase
        .from('crm_contacts')
        .select('id, first_name, last_name, email')
        .in('id', contactIds);

      if (contacts) {
        contactNames = contacts.reduce((acc, c) => {
          acc[c.id] = `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.email;
          return acc;
        }, {} as Record<string, string>);
      }
    }

    const result = this.createDetectionResult({
      severity,
      metricKey: 'cashflow.refund_rate',
      currentValue: Math.round(refundRate * 10) / 10,
      baselineValue: this.definition.threshold,
      thresholdValue: this.definition.threshold,
      percentChange: Math.round(((refundRate - this.definition.threshold) / this.definition.threshold) * 100),
      direction: 'above',
      affectedEntityType: 'transaction',
      affectedEntityIds: refundedTransactions.map((t) => t.id),
      affectedCount: refundCount,
      estimatedImpactUsd: totalRefunded,
      impactDirection: 'loss',
      impactPeriod: 'monthly',
      processParameters: {
        refund_rate: Math.round(refundRate * 10) / 10,
        refund_count: refundCount,
        total_transactions: totalTransactions,
        total_refunded: Math.round(totalRefunded),
        refund_reasons: reasons,
        refunds: refundedTransactions.slice(0, 10).map((t) => ({
          id: t.id,
          amount: parseFloat(t.refunded_amount || t.amount || '0'),
          reason: t.refund_reason,
          date: t.created_at,
          contact_name: t.contact_id ? contactNames[t.contact_id] : null,
        })),
      },
    });

    this.logDetection(userId, result);
    return result;
  }
}
