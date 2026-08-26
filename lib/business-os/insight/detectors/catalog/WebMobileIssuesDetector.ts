/**
 * Web Mobile Issues Detector
 *
 * Detects when mobile visitors aren't converting compared to desktop.
 * Signals potential mobile layout/UX issues.
 *
 * @see docs/INSIGHT_SYSTEM_PLAN.md
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';

export class WebMobileIssuesDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'web_mobile_issues',
    name: 'Mobile Conversion Issues',
    category: 'acquisition',
    description: 'Detects poor mobile conversion compared to desktop',

    watchedMetrics: ['acquisition.mobile_conversion'],
    eventTypes: ['page.viewed', 'booking.created'],

    baselineWindow: 'month',
    thresholdType: 'percent_change',
    threshold: 50, // Mobile conversion < 50% of desktop
    direction: 'below',
    minSamples: 50, // Need at least 50 mobile visitors

    severityFn: (mobileTrafficPercent: number, conversionGap: number): InsightSeverity => {
      // Higher severity if lots of mobile traffic with big gap
      if (mobileTrafficPercent >= 60 && conversionGap >= 70) return 'critical';
      if (mobileTrafficPercent >= 50 || conversionGap >= 60) return 'high';
      if (mobileTrafficPercent >= 40 || conversionGap >= 50) return 'medium';
      return 'low';
    },

    pairedProcessId: 'mobile_optimization_review',
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

    // Get page views with device type
    const { data: pageViews, error: viewsError } = await this.supabase
      .from('website_page_views')
      .select('visitor_id, device_type')
      .eq('subdomain', website.subdomain)
      .gte('viewed_at', thirtyDaysAgo.toISOString());

    if (viewsError) {
      throw viewsError;
    }

    if (!pageViews || pageViews.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    // Count unique visitors by device type
    const mobileVisitors = new Set<string>();
    const desktopVisitors = new Set<string>();
    const tabletVisitors = new Set<string>();

    pageViews.forEach((view) => {
      const visitorId = view.visitor_id;
      if (!visitorId) return;

      const deviceType = (view.device_type || '').toLowerCase();
      if (deviceType === 'mobile' || deviceType.includes('phone')) {
        mobileVisitors.add(visitorId);
      } else if (deviceType === 'tablet' || deviceType.includes('ipad')) {
        tabletVisitors.add(visitorId);
      } else {
        desktopVisitors.add(visitorId);
      }
    });

    // Include tablet as mobile for this analysis
    mobileVisitors.forEach((v) => {
      desktopVisitors.delete(v); // Remove if also counted in desktop
    });
    tabletVisitors.forEach((v) => {
      mobileVisitors.add(v);
      desktopVisitors.delete(v);
    });

    const mobileCount = mobileVisitors.size;
    const desktopCount = desktopVisitors.size;
    const totalVisitors = mobileCount + desktopCount;

    // Need minimum mobile traffic
    if (mobileCount < this.definition.minSamples) {
      this.logDetection(userId, null);
      return null;
    }

    // Get bookings with user agent/device info
    const { data: bookings, error: bookingsError } = await this.supabase
      .from('scheduling_bookings')
      .select('id, metadata, client_email')
      .eq('user_id', userId)
      .gte('created_at', thirtyDaysAgo.toISOString())
      .in('status', ['confirmed', 'completed']);

    if (bookingsError) {
      throw bookingsError;
    }

    // Count conversions by device (based on metadata or estimate)
    let mobileConversions = 0;
    let desktopConversions = 0;

    bookings?.forEach((booking) => {
      const metadata = booking.metadata as Record<string, unknown> | null;
      const deviceType = (metadata?.device_type as string) || '';
      const userAgent = (metadata?.user_agent as string) || '';

      // Check metadata or user agent for mobile indicators
      const isMobile =
        deviceType.toLowerCase().includes('mobile') ||
        /mobile|android|iphone|ipad/i.test(userAgent);

      if (isMobile) {
        mobileConversions++;
      } else {
        desktopConversions++;
      }
    });

    // If no device info available, estimate based on traffic ratio
    if (bookings && bookings.length > 0 && mobileConversions === 0 && desktopConversions === 0) {
      // Assume desktop-biased conversion without data
      const mobileRatio = mobileCount / totalVisitors;
      mobileConversions = Math.round(bookings.length * mobileRatio * 0.5); // Mobile converts worse
      desktopConversions = bookings.length - mobileConversions;
    }

    // Calculate conversion rates
    const mobileConversionRate = mobileCount > 0 ? (mobileConversions / mobileCount) * 100 : 0;
    const desktopConversionRate =
      desktopCount > 0 ? (desktopConversions / desktopCount) * 100 : 0;

    // Skip if desktop rate is 0 (can't compare)
    if (desktopConversionRate === 0) {
      this.logDetection(userId, null);
      return null;
    }

    // Calculate gap
    const conversionGap = ((desktopConversionRate - mobileConversionRate) / desktopConversionRate) * 100;

    // Check threshold
    if (mobileConversionRate >= desktopConversionRate * (this.definition.threshold / 100)) {
      this.logDetection(userId, null);
      return null;
    }

    // Calculate severity
    const mobileTrafficPercent = (mobileCount / totalVisitors) * 100;
    const severity = this.definition.severityFn(mobileTrafficPercent, conversionGap);

    // Calculate missed revenue
    const expectedMobileConversions = (desktopConversionRate / 100) * mobileCount;
    const missedConversions = expectedMobileConversions - mobileConversions;

    // Get average booking value
    const { data: avgValue } = await this.supabase
      .from('scheduling_bookings')
      .select('price')
      .eq('user_id', userId)
      .gte('created_at', thirtyDaysAgo.toISOString())
      .limit(50);

    const avgBookingValue =
      avgValue && avgValue.length > 0
        ? avgValue.reduce((sum, b) => sum + parseFloat(b.price || '0'), 0) / avgValue.length
        : 100;

    const missedRevenue = missedConversions * avgBookingValue;

    const result = this.createDetectionResult({
      severity,
      metricKey: 'acquisition.mobile_conversion',
      currentValue: Math.round(mobileConversionRate * 100) / 100,
      baselineValue: Math.round(desktopConversionRate * 100) / 100,
      thresholdValue: Math.round((desktopConversionRate * this.definition.threshold) / 100 * 100) / 100,
      percentChange: -Math.round(conversionGap),
      direction: 'below',
      affectedEntityType: 'device_type',
      affectedEntityIds: ['mobile'],
      affectedCount: mobileCount,
      estimatedImpactUsd: Math.round(missedRevenue),
      impactDirection: 'loss',
      impactPeriod: 'monthly',
      processParameters: {
        mobile: {
          visitors: mobileCount,
          conversions: mobileConversions,
          conversion_rate: Math.round(mobileConversionRate * 100) / 100,
          traffic_percent: Math.round(mobileTrafficPercent),
        },
        desktop: {
          visitors: desktopCount,
          conversions: desktopConversions,
          conversion_rate: Math.round(desktopConversionRate * 100) / 100,
          traffic_percent: Math.round(100 - mobileTrafficPercent),
        },
        conversion_gap_percent: Math.round(conversionGap),
        missed_conversions: Math.round(missedConversions),
        avg_booking_value: Math.round(avgBookingValue),
      },
    });

    this.logDetection(userId, result);
    return result;
  }
}
