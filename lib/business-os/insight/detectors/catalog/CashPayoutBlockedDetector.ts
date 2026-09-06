/**
 * Cash Payout Blocked Detector
 *
 * Detects when Stripe Connect payouts are blocked (CRITICAL).
 * Business cannot receive money until resolved.
 *
 * @see docs/INSIGHT_SYSTEM_PLAN.md
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';

export class CashPayoutBlockedDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'cash_payout_blocked',
    name: 'Payouts Blocked',
    category: 'cash_flow',
    description: 'Detects when Stripe payouts are disabled',

    watchedMetrics: ['cashflow.payout_status'],
    eventTypes: [],

    baselineWindow: 'week',
    thresholdType: 'absolute',
    threshold: 0, // Any blocking condition
    direction: 'above',
    minSamples: 1,

    severityFn: (): InsightSeverity => {
      // Always critical - can't receive money
      return 'critical';
    },

    pairedProcessId: 'complete_stripe_onboarding',
    consentTier: 'observe', // User must take action
    eligibleForAutomation: false,
    ownerParameters: [],
    guardrails: [],
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

    // Get Stripe Connect account status
    const { data: account, error } = await this.supabase
      .from('stripe_connect_accounts')
      .select('stripe_account_id, charges_enabled, payouts_enabled, details_submitted, onboarding_completed')
      .eq('user_id', userId)
      .single();

    if (error) {
      // No account = no payout issues (they haven't set up payments)
      this.logDetection(userId, null);
      return null;
    }

    if (!account) {
      this.logDetection(userId, null);
      return null;
    }

    // Check for blocking conditions
    const issues: string[] = [];

    if (!account.payouts_enabled) {
      issues.push('Payouts are disabled');
    }

    if (!account.charges_enabled) {
      issues.push('Cannot accept charges');
    }

    if (!account.details_submitted) {
      issues.push('Onboarding details not submitted');
    }

    if (!account.onboarding_completed) {
      issues.push('Onboarding not completed');
    }

    // No issues
    if (issues.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    // Get pending revenue that's stuck
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: pendingRevenue } = await this.supabase
      .from('payment_transactions')
      .select('amount')
      .eq('user_id', userId)
      .eq('status', 'succeeded')
      .gte('created_at', thirtyDaysAgo.toISOString());

    const totalPending = pendingRevenue?.reduce((sum, t) =>
      sum + parseFloat(t.amount || '0'), 0) || 0;

    const severity = this.definition.severityFn(0, 0);

    const result = this.createDetectionResult({
      severity,
      metricKey: 'cashflow.payout_status',
      currentValue: issues.length,
      baselineValue: 0,
      thresholdValue: 0,
      percentChange: 100,
      direction: 'above',
      affectedEntityType: 'stripe_account',
      affectedEntityIds: [account.stripe_account_id],
      affectedCount: 1,
      estimatedImpactUsd: totalPending,
      impactDirection: 'loss',
      impactPeriod: 'monthly',
      processParameters: {
        issues,
        stripe_account_id: account.stripe_account_id,
        payouts_enabled: account.payouts_enabled,
        charges_enabled: account.charges_enabled,
        details_submitted: account.details_submitted,
        onboarding_completed: account.onboarding_completed,
        pending_revenue: Math.round(totalPending),
      },
    });

    this.logDetection(userId, result);
    return result;
  }
}
