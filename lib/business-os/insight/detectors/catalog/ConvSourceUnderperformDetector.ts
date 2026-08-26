/**
 * Conversion Source Underperform Detector
 *
 * Detects lead sources with conversion rates significantly below average.
 * Helps optimize marketing spend by identifying underperforming channels.
 *
 * @see docs/INSIGHT_SYSTEM_PLAN.md
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';
import { buildClientStageFilter } from '@/lib/crm/StageTypeUtils';

interface SourceStats {
  source: string;
  totalLeads: number;
  convertedLeads: number;
  conversionRate: number;
}

export class ConvSourceUnderperformDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'conv_source_underperform',
    name: 'Lead Source Underperforming',
    category: 'conversion',
    description: 'Detects lead sources with below-average conversion rates',

    watchedMetrics: ['conversion.source_performance'],
    eventTypes: ['contact.created', 'contact.stage_changed'],

    baselineWindow: 'month',
    thresholdType: 'percent_change',
    threshold: 50, // Source conversion < 50% of average
    direction: 'below',
    minSamples: 5, // Need at least 5 leads from a source

    severityFn: (deviationPercent: number, leadCount: number): InsightSeverity => {
      if (deviationPercent >= 70 && leadCount >= 10) return 'critical';
      if (deviationPercent >= 50 || leadCount >= 15) return 'high';
      if (deviationPercent >= 30) return 'medium';
      return 'low';
    },

    pairedProcessId: undefined, // Advisory only
    consentTier: 'observe',
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

    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    // Get all contacts with source info from last 60 days
    const { data: contacts, error } = await this.supabase
      .from('crm_contacts')
      .select('id, source, stage, created_at')
      .eq('user_id', userId)
      .gte('created_at', sixtyDaysAgo.toISOString());

    if (error) {
      throw error;
    }

    if (!contacts || contacts.length < 10) {
      // Need at least 10 contacts total
      this.logDetection(userId, null);
      return null;
    }

    // Get client stages for this user (uses stage_type with fallback)
    const clientStages = await buildClientStageFilter(this.supabase, userId);
    // Convert to lowercase for case-insensitive comparison
    const clientStagesLower = clientStages.map(s => s.toLowerCase());

    // Group by source and calculate conversion rates
    const sourceStats: Record<string, SourceStats> = {};

    contacts.forEach((contact) => {
      const source = contact.source || 'unknown';

      if (!sourceStats[source]) {
        sourceStats[source] = {
          source,
          totalLeads: 0,
          convertedLeads: 0,
          conversionRate: 0,
        };
      }

      sourceStats[source].totalLeads++;
      if (clientStagesLower.includes(contact.stage?.toLowerCase())) {
        sourceStats[source].convertedLeads++;
      }
    });

    // Calculate conversion rates
    Object.values(sourceStats).forEach((stats) => {
      stats.conversionRate =
        stats.totalLeads > 0 ? (stats.convertedLeads / stats.totalLeads) * 100 : 0;
    });

    // Filter sources with minimum samples
    const validSources = Object.values(sourceStats).filter(
      (s) => s.totalLeads >= this.definition.minSamples
    );

    if (validSources.length < 2) {
      // Need at least 2 sources to compare
      this.logDetection(userId, null);
      return null;
    }

    // Calculate average conversion rate
    const totalLeads = validSources.reduce((sum, s) => sum + s.totalLeads, 0);
    const totalConverted = validSources.reduce((sum, s) => sum + s.convertedLeads, 0);
    const avgConversionRate = (totalConverted / totalLeads) * 100;

    // Find underperforming sources (<50% of average)
    const thresholdRate = avgConversionRate * (this.definition.threshold / 100);
    const underperformers = validSources.filter((s) => s.conversionRate < thresholdRate);

    if (underperformers.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    // Calculate severity based on deviation and volume
    const avgDeviation =
      underperformers.reduce((sum, s) => {
        return sum + ((avgConversionRate - s.conversionRate) / avgConversionRate) * 100;
      }, 0) / underperformers.length;

    const totalUnderperformingLeads = underperformers.reduce((sum, s) => sum + s.totalLeads, 0);

    const severity = this.definition.severityFn(avgDeviation, totalUnderperformingLeads);

    // Calculate opportunity cost (leads that could have converted at avg rate)
    const avgDealValue = 300; // Estimated average deal value
    const expectedConversions = underperformers.reduce(
      (sum, s) => sum + s.totalLeads * (avgConversionRate / 100),
      0
    );
    const actualConversions = underperformers.reduce((sum, s) => sum + s.convertedLeads, 0);
    const missedConversions = Math.max(0, expectedConversions - actualConversions);
    const opportunityCost = missedConversions * avgDealValue;

    // Find best performing source for comparison
    const bestSource = validSources.reduce((best, s) =>
      s.conversionRate > best.conversionRate ? s : best
    );

    const result = this.createDetectionResult({
      severity,
      metricKey: 'conversion.source_performance',
      currentValue: Math.round(
        underperformers.reduce((sum, s) => sum + s.conversionRate, 0) / underperformers.length
      ),
      baselineValue: Math.round(avgConversionRate),
      thresholdValue: Math.round(thresholdRate),
      percentChange: -Math.round(avgDeviation),
      direction: 'below',
      affectedEntityType: 'lead_source',
      affectedEntityIds: underperformers.map((s) => s.source),
      affectedCount: totalUnderperformingLeads,
      estimatedImpactUsd: Math.round(opportunityCost),
      impactDirection: 'loss',
      impactPeriod: 'monthly',
      processParameters: {
        avg_conversion_rate: Math.round(avgConversionRate * 10) / 10,
        threshold_rate: Math.round(thresholdRate * 10) / 10,
        best_source: {
          name: bestSource.source,
          conversion_rate: Math.round(bestSource.conversionRate * 10) / 10,
          leads: bestSource.totalLeads,
        },
        underperforming_sources: underperformers
          .sort((a, b) => a.conversionRate - b.conversionRate)
          .map((s) => ({
            source: s.source,
            total_leads: s.totalLeads,
            converted: s.convertedLeads,
            conversion_rate: Math.round(s.conversionRate * 10) / 10,
            deviation: Math.round(((avgConversionRate - s.conversionRate) / avgConversionRate) * 100),
          })),
        all_sources: validSources
          .sort((a, b) => b.conversionRate - a.conversionRate)
          .map((s) => ({
            source: s.source,
            leads: s.totalLeads,
            converted: s.convertedLeads,
            rate: Math.round(s.conversionRate * 10) / 10,
          })),
        missed_conversions: Math.round(missedConversions),
      },
    });

    this.logDetection(userId, result);
    return result;
  }
}
