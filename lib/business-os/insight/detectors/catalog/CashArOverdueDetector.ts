/**
 * Cash AR Overdue Detector
 *
 * Detects when accounts receivable is overdue (7+ days).
 * This is an absolute threshold detector - no baseline needed.
 *
 * @see docs/INSIGHT_SYSTEM_PLAN.md Section 3
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';
import { COMMON_GUARDRAILS } from '../types';

export class CashArOverdueDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'cash_ar_overdue',
    name: 'Overdue Invoices',
    category: 'cash_flow',
    description: 'Detects invoices that are 7+ days overdue',

    watchedMetrics: ['cashflow.ar_overdue_usd'],
    eventTypes: ['invoice.overdue'],

    baselineWindow: 'week', // Not used for absolute threshold
    thresholdType: 'absolute',
    threshold: 0, // Any AR > 0 with 7+ days
    direction: 'above',
    minSamples: 1, // Can fire immediately

    severityFn: (arAmount: number): InsightSeverity => {
      if (arAmount >= 5000) return 'critical';
      if (arAmount >= 2000) return 'high';
      if (arAmount >= 500) return 'medium';
      return 'low';
    },

    pairedProcessId: 'chase_overdue_invoices',
    consentTier: 'automate',
    eligibleForAutomation: true,
    ownerParameters: [
      {
        id: 'days_threshold',
        label: 'Days Overdue',
        type: 'number',
        default: 7,
        min: 1,
        max: 90,
      },
      {
        id: 'tone',
        label: 'Tone',
        type: 'select',
        default: 'professional',
        options: [
          { value: 'friendly', label: 'Friendly' },
          { value: 'professional', label: 'Professional' },
          { value: 'firm', label: 'Firm' },
        ],
      },
    ],
    guardrails: [
      COMMON_GUARDRAILS.max_1_per_invoice_per_7d,
      COMMON_GUARDRAILS.max_20_per_run,
      COMMON_GUARDRAILS.quiet_hours,
    ],
    cooldownHours: 24,
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

    // Get overdue invoices directly from payment_invoices table
    const daysThreshold = 7;
    const overdueDate = new Date();
    overdueDate.setDate(overdueDate.getDate() - daysThreshold);

    const { data: overdueInvoices, error } = await this.supabase
      .from('payment_invoices')
      .select('id, amount, due_date')
      .eq('user_id', userId)
      .in('status', ['pending', 'sent', 'overdue']) // Unpaid statuses
      .lt('due_date', overdueDate.toISOString())
      .gt('amount', 0);

    if (error) {
      throw error;
    }

    // No overdue invoices
    if (!overdueInvoices || overdueInvoices.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    // Calculate total AR
    const totalArOverdue = overdueInvoices.reduce(
      (sum, inv) => sum + parseFloat(inv.amount || '0'),
      0
    );

    // No significant AR
    if (totalArOverdue <= 0) {
      this.logDetection(userId, null);
      return null;
    }

    // Calculate severity
    const severity = this.definition.severityFn(totalArOverdue, 0);

    const result = this.createDetectionResult({
      severity,
      metricKey: 'cashflow.ar_overdue_usd',
      currentValue: totalArOverdue,
      baselineValue: 0, // No baseline for absolute threshold
      thresholdValue: this.definition.threshold,
      percentChange: 100, // 100% above baseline of 0
      direction: 'above',
      affectedEntityType: 'invoice',
      affectedEntityIds: overdueInvoices.map((inv) => inv.id),
      affectedCount: overdueInvoices.length,
      estimatedImpactUsd: totalArOverdue,
      impactDirection: 'loss',
      impactPeriod: 'monthly',
      processParameters: {
        days_threshold: daysThreshold,
        tone: 'professional',
        invoice_ids: overdueInvoices.map((inv) => inv.id),
      },
    });

    this.logDetection(userId, result);
    return result;
  }
}
