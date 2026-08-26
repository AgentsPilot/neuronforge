/**
 * Website Incomplete Content Detector
 *
 * Detects pages with empty or incomplete key sections.
 * Missing hero headlines, empty service lists, etc. hurt credibility.
 *
 * @see docs/INSIGHT_SYSTEM_PLAN.md
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';

interface ContentIssue {
  pageId: string;
  pageTitle: string;
  pageType: string;
  section: string;
  issue: string;
  importance: 'critical' | 'high' | 'medium';
}

export class WebIncompleteContentDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'web_incomplete_content',
    name: 'Incomplete Website Content',
    category: 'acquisition',
    description: 'Detects empty or incomplete key sections on live pages',

    watchedMetrics: ['acquisition.content_completeness'],
    eventTypes: [],

    baselineWindow: 'week',
    thresholdType: 'absolute',
    threshold: 0, // Any incomplete critical section
    direction: 'above',
    minSamples: 1,

    severityFn: (criticalCount: number, highCount: number): InsightSeverity => {
      if (criticalCount >= 2) return 'critical';
      if (criticalCount >= 1 || highCount >= 3) return 'high';
      if (highCount >= 1) return 'medium';
      return 'low';
    },

    pairedProcessId: 'content_completion_wizard',
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

    const issues: ContentIssue[] = [];

    // Check each page's blocks for content issues
    for (const page of pages) {
      const { data: blocks } = await this.supabase
        .from('website_blocks')
        .select('block_type, content, enabled')
        .eq('page_id', page.id)
        .eq('enabled', true);

      if (!blocks) continue;

      for (const block of blocks) {
        const content = block.content as Record<string, unknown> | null;

        // Check hero block
        if (block.block_type === 'hero') {
          if (!content?.headline || (content.headline as string).trim() === '') {
            issues.push({
              pageId: page.id,
              pageTitle: page.title || page.slug,
              pageType: page.page_type,
              section: 'Hero',
              issue: 'Missing headline',
              importance: 'critical',
            });
          }
        }

        // Check services block
        if (block.block_type === 'services') {
          const items = content?.items as unknown[] | undefined;
          if (!items || items.length === 0) {
            issues.push({
              pageId: page.id,
              pageTitle: page.title || page.slug,
              pageType: page.page_type,
              section: 'Services',
              issue: 'No services listed',
              importance: 'critical',
            });
          }
        }

        // Check testimonials block
        if (block.block_type === 'testimonials') {
          const items = content?.items as unknown[] | undefined;
          if (!items || items.length === 0) {
            issues.push({
              pageId: page.id,
              pageTitle: page.title || page.slug,
              pageType: page.page_type,
              section: 'Testimonials',
              issue: 'No testimonials added',
              importance: 'high',
            });
          } else if (items.length === 1) {
            issues.push({
              pageId: page.id,
              pageTitle: page.title || page.slug,
              pageType: page.page_type,
              section: 'Testimonials',
              issue: 'Only 1 testimonial (add more for credibility)',
              importance: 'medium',
            });
          }
        }

        // Check pricing block
        if (block.block_type === 'pricing') {
          const items = content?.items as unknown[] | undefined;
          if (!items || items.length === 0) {
            issues.push({
              pageId: page.id,
              pageTitle: page.title || page.slug,
              pageType: page.page_type,
              section: 'Pricing',
              issue: 'No pricing plans defined',
              importance: 'high',
            });
          }
        }

        // Check about block
        if (block.block_type === 'about') {
          if (!content?.text || (content.text as string).trim().length < 50) {
            issues.push({
              pageId: page.id,
              pageTitle: page.title || page.slug,
              pageType: page.page_type,
              section: 'About',
              issue: 'About section is too short or empty',
              importance: 'medium',
            });
          }
        }

        // Check CTA block
        if (block.block_type === 'cta') {
          if (!content?.title || !content?.buttonText) {
            issues.push({
              pageId: page.id,
              pageTitle: page.title || page.slug,
              pageType: page.page_type,
              section: 'CTA',
              issue: 'CTA missing title or button text',
              importance: 'high',
            });
          }
        }
      }
    }

    if (issues.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    // Count by importance
    const criticalCount = issues.filter((i) => i.importance === 'critical').length;
    const highCount = issues.filter((i) => i.importance === 'high').length;

    // Calculate severity
    const severity = this.definition.severityFn(criticalCount, highCount);

    // Group by page
    const issuesByPage = issues.reduce((acc, issue) => {
      if (!acc[issue.pageId]) {
        acc[issue.pageId] = {
          pageTitle: issue.pageTitle,
          pageType: issue.pageType,
          issues: [],
        };
      }
      acc[issue.pageId].issues.push({
        section: issue.section,
        issue: issue.issue,
        importance: issue.importance,
      });
      return acc;
    }, {} as Record<string, { pageTitle: string; pageType: string; issues: Array<{ section: string; issue: string; importance: string }> }>);

    const result = this.createDetectionResult({
      severity,
      metricKey: 'acquisition.content_completeness',
      currentValue: issues.length,
      baselineValue: 0,
      thresholdValue: 0,
      percentChange: 100,
      direction: 'above',
      affectedEntityType: 'page',
      affectedEntityIds: [...new Set(issues.map((i) => i.pageId))],
      affectedCount: issues.length,
      estimatedImpactUsd: criticalCount * 100 + highCount * 50, // Rough impact estimate
      impactDirection: 'opportunity',
      impactPeriod: 'monthly',
      processParameters: {
        total_issues: issues.length,
        critical_issues: criticalCount,
        high_issues: highCount,
        medium_issues: issues.filter((i) => i.importance === 'medium').length,
        issues_by_page: issuesByPage,
      },
    });

    this.logDetection(userId, result);
    return result;
  }
}
