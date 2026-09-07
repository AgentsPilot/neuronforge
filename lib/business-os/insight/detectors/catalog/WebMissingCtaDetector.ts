/**
 * Website Missing CTA Detector
 *
 * Detects live pages that lack clear calls-to-action.
 * Pages without booking widgets, CTAs, or contact forms lose conversions.
 *
 * @see docs/INSIGHT_SYSTEM_PLAN.md
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';

export class WebMissingCtaDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'web_missing_cta',
    name: 'Missing Call-to-Action',
    category: 'acquisition',
    description: 'Detects live pages without booking/contact/CTA blocks',

    watchedMetrics: ['acquisition.page_conversion'],
    eventTypes: ['page.viewed'],

    baselineWindow: 'week',
    thresholdType: 'absolute',
    threshold: 0, // Any page missing CTA
    direction: 'above',
    minSamples: 1,

    severityFn: (pageType: string): InsightSeverity => {
      // Homepage missing CTA is critical
      if (pageType === 'homepage') return 'critical';
      if (pageType === 'landing' || pageType === 'services') return 'high';
      return 'medium';
    },

    pairedProcessId: 'add_cta_block',
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

    // Get all live pages
    const { data: pages, error: pagesError } = await this.supabase
      .from('website_pages')
      .select('id, page_type, slug, title')
      .eq('user_id', userId)
      .eq('status', 'live');

    if (pagesError) {
      throw pagesError;
    }

    if (!pages || pages.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    // CTA-type blocks that count as conversion opportunities
    const ctaBlockTypes = ['booking_widget', 'cta', 'contact_form', 'payment_button'];

    // Check each page for CTA blocks
    const pagesWithoutCta: Array<{ id: string; page_type: string; slug: string; title: string }> = [];

    for (const page of pages) {
      const { data: blocks } = await this.supabase
        .from('website_blocks')
        .select('block_type, enabled')
        .eq('page_id', page.id)
        .eq('enabled', true)
        .in('block_type', ctaBlockTypes);

      // Check if any CTA-type block exists and is enabled
      const hasCta = blocks && blocks.length > 0;

      if (!hasCta) {
        pagesWithoutCta.push(page);
      }
    }

    if (pagesWithoutCta.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    // Calculate severity based on most important page type missing CTA
    const pageTypes = pagesWithoutCta.map((p) => p.page_type);
    let highestSeverityType = 'other';
    if (pageTypes.includes('homepage')) highestSeverityType = 'homepage';
    else if (pageTypes.includes('landing')) highestSeverityType = 'landing';
    else if (pageTypes.includes('services')) highestSeverityType = 'services';

    const severity = this.definition.severityFn(highestSeverityType);

    // Get page views for affected pages to estimate impact
    const pageIds = pagesWithoutCta.map((p) => p.id);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: pageViews } = await this.supabase
      .from('website_page_views')
      .select('page_id')
      .in('page_id', pageIds)
      .gte('viewed_at', thirtyDaysAgo.toISOString());

    const totalViews = pageViews?.length || 0;

    // Estimate lost conversions: views × expected conversion rate × avg deal value
    const expectedConversionRate = 0.02; // 2%
    const avgDealValue = 300;
    const missedConversions = Math.floor(totalViews * expectedConversionRate);
    const estimatedLoss = missedConversions * avgDealValue;

    // Group by page type
    const typeBreakdown = pagesWithoutCta.reduce((acc, p) => {
      acc[p.page_type] = (acc[p.page_type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const result = this.createDetectionResult({
      severity,
      metricKey: 'acquisition.page_conversion',
      currentValue: pagesWithoutCta.length,
      baselineValue: 0,
      thresholdValue: 0,
      percentChange: 100,
      direction: 'above',
      affectedEntityType: 'page',
      affectedEntityIds: pagesWithoutCta.map((p) => p.id),
      affectedCount: pagesWithoutCta.length,
      estimatedImpactUsd: estimatedLoss,
      impactDirection: 'opportunity',
      impactPeriod: 'monthly',
      processParameters: {
        pages_without_cta: pagesWithoutCta.length,
        page_type_breakdown: typeBreakdown,
        total_views_30d: totalViews,
        missed_conversions: missedConversions,
        pages: pagesWithoutCta.map((p) => ({
          id: p.id,
          type: p.page_type,
          slug: p.slug,
          title: p.title,
        })),
      },
    });

    this.logDetection(userId, result);
    return result;
  }
}
