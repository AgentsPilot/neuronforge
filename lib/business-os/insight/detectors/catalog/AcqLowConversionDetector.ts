/**
 * Acquisition Low Conversion Detector
 *
 * Detects when website form conversion rate is below benchmark (2%).
 * Compares form submissions to unique visitors.
 *
 * @see docs/INSIGHT_SYSTEM_PLAN.md
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';

export class AcqLowConversionDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'acq_low_conversion',
    name: 'Low Form Conversion',
    category: 'acquisition',
    description: 'Detects when form conversion rate is below 2%',

    watchedMetrics: ['acquisition.form_conversion_rate'],
    eventTypes: ['form.submitted', 'page.viewed'],

    baselineWindow: 'week',
    thresholdType: 'absolute',
    threshold: 2, // 2% conversion rate benchmark
    direction: 'below',
    minSamples: 50, // Need at least 50 visitors for meaningful data

    severityFn: (conversionRate: number, visitorCount: number): InsightSeverity => {
      // More visitors + lower conversion = higher severity
      if (visitorCount >= 200 && conversionRate < 1) return 'critical';
      if (visitorCount >= 100 && conversionRate < 1.5) return 'high';
      if (visitorCount >= 50 && conversionRate < 2) return 'medium';
      return 'low';
    },

    pairedProcessId: 'review_website_forms',
    consentTier: 'suggest',
    eligibleForAutomation: false,
    ownerParameters: [
      {
        id: 'benchmark_rate',
        label: 'Benchmark Rate (%)',
        type: 'number',
        default: 2,
        min: 1,
        max: 10,
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

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Get user's subdomain
    const { data: pages } = await this.supabase
      .from('website_pages')
      .select('subdomain')
      .eq('user_id', userId)
      .limit(1)
      .single();

    if (!pages?.subdomain) {
      this.logDetection(userId, null);
      return null;
    }

    const subdomain = pages.subdomain;

    // Get unique visitors in last 30 days
    const { data: pageViews, error: viewsError } = await this.supabase
      .from('website_page_views')
      .select('ip_hash')
      .eq('subdomain', subdomain)
      .gte('viewed_at', thirtyDaysAgo.toISOString());

    if (viewsError) {
      throw viewsError;
    }

    const uniqueVisitors = new Set(pageViews?.map((v) => v.ip_hash) || []).size;

    // Need minimum visitors for meaningful analysis
    if (uniqueVisitors < this.definition.minSamples) {
      this.logDetection(userId, null);
      return null;
    }

    // Get form submissions (contacts from website_form source) in last 30 days
    const { data: formContacts, error: contactsError } = await this.supabase
      .from('crm_contacts')
      .select('id')
      .eq('user_id', userId)
      .eq('source', 'website_form')
      .gte('created_at', thirtyDaysAgo.toISOString());

    if (contactsError) {
      throw contactsError;
    }

    const formSubmissions = formContacts?.length || 0;

    // Calculate conversion rate
    const conversionRate = (formSubmissions / uniqueVisitors) * 100;

    // Only fire if below benchmark
    if (conversionRate >= this.definition.threshold) {
      this.logDetection(userId, null);
      return null;
    }

    // Calculate severity
    const severity = this.definition.severityFn(conversionRate, uniqueVisitors);

    // Estimate missed opportunities
    const expectedSubmissions = Math.floor(uniqueVisitors * (this.definition.threshold / 100));
    const missedSubmissions = expectedSubmissions - formSubmissions;
    const avgDealValue = 300;
    const conversionToClient = 0.15;
    const estimatedLoss = missedSubmissions * avgDealValue * conversionToClient;

    const result = this.createDetectionResult({
      severity,
      metricKey: 'acquisition.form_conversion_rate',
      currentValue: Math.round(conversionRate * 100) / 100, // Round to 2 decimals
      baselineValue: this.definition.threshold,
      thresholdValue: this.definition.threshold,
      percentChange: Math.round(((conversionRate - this.definition.threshold) / this.definition.threshold) * 100),
      direction: 'below',
      affectedEntityType: 'session',
      affectedEntityIds: [],
      affectedCount: missedSubmissions,
      estimatedImpactUsd: estimatedLoss,
      impactDirection: 'opportunity',
      impactPeriod: 'monthly',
      processParameters: {
        conversion_rate: Math.round(conversionRate * 100) / 100,
        benchmark_rate: this.definition.threshold,
        unique_visitors: uniqueVisitors,
        form_submissions: formSubmissions,
        missed_submissions: missedSubmissions,
      },
    });

    this.logDetection(userId, result);
    return result;
  }
}
