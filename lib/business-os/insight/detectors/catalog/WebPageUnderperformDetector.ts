/**
 * Web Page Underperform Detector
 *
 * Detects high-traffic pages with zero conversions (bookings/form submissions).
 * Signals potential page optimization issues.
 *
 * @see docs/INSIGHT_SYSTEM_PLAN.md
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';

interface PagePerformance {
  pageId: string;
  pagePath: string;
  pageTitle: string;
  views: number;
  uniqueVisitors: number;
  conversions: number;
  conversionRate: number;
}

export class WebPageUnderperformDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'web_page_underperform',
    name: 'Page Underperforming',
    category: 'acquisition',
    description: 'Detects high-traffic pages with zero conversions',

    watchedMetrics: ['acquisition.page_conversion'],
    eventTypes: ['page.viewed', 'form.submitted', 'booking.created'],

    baselineWindow: 'week',
    thresholdType: 'absolute',
    threshold: 50, // >50 views with 0 conversions
    direction: 'above',
    minSamples: 50,

    severityFn: (views: number, pagesAffected: number): InsightSeverity => {
      if (views >= 200 || pagesAffected >= 3) return 'critical';
      if (views >= 100 || pagesAffected >= 2) return 'high';
      if (views >= 50) return 'medium';
      return 'low';
    },

    pairedProcessId: 'page_optimization_review',
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

    // Get user's website subdomain
    const { data: website, error: websiteError } = await this.supabase
      .from('websites')
      .select('id, subdomain')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();

    if (websiteError || !website) {
      this.logDetection(userId, null);
      return null;
    }

    // Get page views grouped by page
    const { data: pageViews, error: viewsError } = await this.supabase
      .from('website_page_views')
      .select('page_path, visitor_id')
      .eq('subdomain', website.subdomain)
      .gte('viewed_at', thirtyDaysAgo.toISOString());

    if (viewsError) {
      throw viewsError;
    }

    if (!pageViews || pageViews.length < this.definition.minSamples) {
      this.logDetection(userId, null);
      return null;
    }

    // Count views and unique visitors per page
    const pageStats: Record<string, { views: number; visitors: Set<string> }> = {};

    pageViews.forEach((view) => {
      const path = view.page_path || '/';
      if (!pageStats[path]) {
        pageStats[path] = { views: 0, visitors: new Set() };
      }
      pageStats[path].views++;
      if (view.visitor_id) {
        pageStats[path].visitors.add(view.visitor_id);
      }
    });

    // Get booking sources to identify conversions
    const { data: bookings } = await this.supabase
      .from('scheduling_bookings')
      .select('source_url, client_email')
      .eq('user_id', userId)
      .gte('created_at', thirtyDaysAgo.toISOString());

    // Get form submissions (contacts from website)
    const { data: formSubmissions } = await this.supabase
      .from('crm_contacts')
      .select('id, source')
      .eq('user_id', userId)
      .gte('created_at', thirtyDaysAgo.toISOString())
      .or('source.ilike.%website%,source.ilike.%form%');

    // Count conversions per page (simplified - based on source URLs)
    const pageConversions: Record<string, number> = {};

    bookings?.forEach((booking) => {
      if (booking.source_url) {
        try {
          const url = new URL(booking.source_url);
          const path = url.pathname || '/';
          pageConversions[path] = (pageConversions[path] || 0) + 1;
        } catch {
          // Invalid URL, skip
        }
      }
    });

    // Get page titles
    const { data: pages } = await this.supabase
      .from('website_pages')
      .select('id, path, title')
      .eq('website_id', website.id);

    const pageTitles: Record<string, { id: string; title: string }> = {};
    pages?.forEach((p) => {
      pageTitles[p.path] = { id: p.id, title: p.title };
    });

    // Build performance data
    const performances: PagePerformance[] = Object.entries(pageStats)
      .filter(([, stats]) => stats.views >= this.definition.threshold)
      .map(([path, stats]) => ({
        pageId: pageTitles[path]?.id || path,
        pagePath: path,
        pageTitle: pageTitles[path]?.title || path,
        views: stats.views,
        uniqueVisitors: stats.visitors.size,
        conversions: pageConversions[path] || 0,
        conversionRate:
          stats.visitors.size > 0 ? ((pageConversions[path] || 0) / stats.visitors.size) * 100 : 0,
      }));

    // Find underperforming pages (high views, zero conversions)
    const underperformers = performances.filter((p) => p.conversions === 0);

    if (underperformers.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    // Sort by views descending
    underperformers.sort((a, b) => b.views - a.views);

    // Calculate severity
    const totalViews = underperformers.reduce((sum, p) => sum + p.views, 0);
    const severity = this.definition.severityFn(totalViews, underperformers.length);

    // Calculate missed opportunities
    // Assuming a 2% conversion rate is achievable
    const expectedConversionRate = 0.02;
    const missedLeads = Math.round(
      underperformers.reduce((sum, p) => sum + p.uniqueVisitors * expectedConversionRate, 0)
    );
    const avgLeadValue = 300;
    const missedRevenue = missedLeads * avgLeadValue;

    const result = this.createDetectionResult({
      severity,
      metricKey: 'acquisition.page_conversion',
      currentValue: 0,
      baselineValue: 2, // 2% expected
      thresholdValue: 0,
      percentChange: -100,
      direction: 'below',
      affectedEntityType: 'page',
      affectedEntityIds: underperformers.map((p) => p.pageId),
      affectedCount: underperformers.length,
      estimatedImpactUsd: missedRevenue,
      impactDirection: 'loss',
      impactPeriod: 'monthly',
      processParameters: {
        underperforming_pages: underperformers.slice(0, 10).map((p) => ({
          path: p.pagePath,
          title: p.pageTitle,
          views: p.views,
          unique_visitors: p.uniqueVisitors,
          conversions: p.conversions,
        })),
        total_underperforming_pages: underperformers.length,
        total_wasted_views: totalViews,
        missed_leads: missedLeads,
        expected_conversion_rate: 2,
      },
    });

    this.logDetection(userId, result);
    return result;
  }
}
