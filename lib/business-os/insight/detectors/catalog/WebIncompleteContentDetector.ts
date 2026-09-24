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

    watchedMetrics: ['acquisition.incomplete_content'],
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

    /*

     * Advisory: nothing can run this yet.

     *

     * It used to name `content_completion_wizard`, a process that was never built — so the card

     * offered "handle it for me", the server answered 404 on the process, and the

     * insight was never marked acted. Whatever fixes this is a different KIND of

     * action from the four that exist, which all send a message.

     *

     * Declaring nothing is honest: the card shows the finding without a button

     * that cannot work.

     */
    /*
     * Runs even while this category's vector is dark, because unfinished copy is true whether or not anybody has read it, and the `conv`
     * vector gates on visitors — so the page would be fixed only after the
     * traffic it was costing had already arrived and left.
     */
    ignoresVectorMaturity: true,

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
      metricKey: 'acquisition.incomplete_content',
      currentValue: issues.length,
      baselineValue: 0,
      thresholdValue: 0,
      /*
       * Nothing changed by a hundred per cent.
       *
       * This detector counts: there is no baseline to have moved from, and a
       * hardcoded 100 reached the narrator as a real measurement. It produced
       * sentences like "a 100% increase in risk compared to your usual client
       * retention" and "a 100% increase in your expected cash flow" — arithmetic
       * presented as a trend, about a base of zero.
       *
       * `hasRealBaseline` now keeps the figure out of the prompt, but that guard
       * reads `baselineValue`, so it is the second line of defence. This is the
       * first: a count reports no change, because none was measured.
       */
      percentChange: 0,
      direction: 'above',
      affectedEntityType: 'page',
      affectedEntityIds: [...new Set(issues.map((i) => i.pageId))],
      affectedCount: issues.length,
      /*
       * No money. This was `critical * 100 + high * 50`, described in its own
       * comment as a "rough impact estimate" — two invented prices per page
       * problem, summed and shown as the owner's currency. An unfinished page
       * is worth saying on its own; nothing here measures what it costs.
       */
      estimatedImpactUsd: undefined,
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
