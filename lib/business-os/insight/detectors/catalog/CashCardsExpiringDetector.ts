/**
 * Cash Cards Expiring Detector
 *
 * Detects customer payment cards expiring within 30 days.
 * Proactive alert to prevent future failed charges.
 *
 * @see docs/INSIGHT_SYSTEM_PLAN.md
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';

export class CashCardsExpiringDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'cash_cards_expiring',
    name: 'Cards Expiring Soon',
    category: 'cash_flow',
    description: 'Detects customer cards expiring within 30 days',

    watchedMetrics: ['cashflow.expiring_cards'],
    eventTypes: [],

    baselineWindow: 'month',
    thresholdType: 'absolute',
    threshold: 0, // Any expiring card
    direction: 'above',
    minSamples: 1,

    // severityFn receives: count as delta, hasRecurring as baseline (1=true, 0=false)
    severityFn: (count: number, hasRecurring: number): InsightSeverity => {
      if (hasRecurring && count >= 3) return 'critical';
      if (count >= 5 || hasRecurring) return 'high';
      if (count >= 2) return 'medium';
      return 'low';
    },

    pairedProcessId: 'update_payment_method_request',
    consentTier: 'automate',
    eligibleForAutomation: true,
    ownerParameters: [
      {
        id: 'days_before',
        label: 'Days Before Expiry',
        type: 'number',
        default: 30,
        min: 14,
        max: 60,
      },
    ],
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

    const now = new Date();
    const currentMonth = now.getMonth() + 1; // 1-12
    const currentYear = now.getFullYear();

    // Calculate expiry window (next 30 days)
    const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const expiryMonth = thirtyDaysLater.getMonth() + 1;
    const expiryYear = thirtyDaysLater.getFullYear();

    // Get saved payment methods expiring soon
    const { data: expiringMethods, error } = await this.supabase
      .from('saved_payment_methods')
      .select('id, contact_id, method_type, brand, last_four, expiry_month, expiry_year, is_valid')
      .eq('user_id', userId)
      .eq('is_valid', true)
      .eq('method_type', 'card');

    if (error) {
      throw error;
    }

    if (!expiringMethods || expiringMethods.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    // Filter to cards expiring within 30 days
    const expiringSoon = expiringMethods.filter((method) => {
      const expMonth = method.expiry_month;
      const expYear = method.expiry_year;

      // Already expired
      if (expYear < currentYear || (expYear === currentYear && expMonth < currentMonth)) {
        return true; // Include already expired
      }

      // Expiring within window
      if (expYear === currentYear && expMonth <= expiryMonth) {
        return true;
      }
      if (expYear === expiryYear && expMonth <= expiryMonth) {
        return true;
      }

      return false;
    });

    if (expiringSoon.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    // Get contact info for affected cards
    const contactIds = [...new Set(expiringSoon.map((m) => m.contact_id).filter(Boolean))];
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

    // Check if any have recurring payments (payment plans)
    const { data: activePlans } = await this.supabase
      .from('payment_plan_installments')
      .select('contact_id')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .in('contact_id', contactIds);

    const hasRecurring = activePlans && activePlans.length > 0;

    // Calculate severity (pass hasRecurring as 1 or 0 to match number signature)
    const severity = this.definition.severityFn(expiringSoon.length, hasRecurring ? 1 : 0);

    // Estimate at-risk revenue
    const avgRecurringValue = 150;
    const atRiskRevenue = expiringSoon.length * avgRecurringValue;

    // Group by expiry month
    const expiryBreakdown = expiringSoon.reduce((acc, m) => {
      const key = `${m.expiry_month}/${m.expiry_year}`;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const result = this.createDetectionResult({
      severity,
      metricKey: 'cashflow.expiring_cards',
      currentValue: expiringSoon.length,
      baselineValue: 0,
      thresholdValue: 0,
      percentChange: 100,
      direction: 'above',
      affectedEntityType: 'payment_method',
      affectedEntityIds: expiringSoon.map((m) => m.id),
      affectedCount: expiringSoon.length,
      estimatedImpactUsd: atRiskRevenue,
      impactDirection: 'loss',
      impactPeriod: 'monthly',
      processParameters: {
        days_before: 30,
        expiring_count: expiringSoon.length,
        has_recurring: hasRecurring,
        expiry_breakdown: expiryBreakdown,
        cards: expiringSoon.map((m) => ({
          id: m.id,
          brand: m.brand,
          last_four: m.last_four,
          expiry: `${m.expiry_month}/${m.expiry_year}`,
          contact_name: m.contact_id ? contactNames[m.contact_id] : null,
        })),
      },
    });

    this.logDetection(userId, result);
    return result;
  }
}
