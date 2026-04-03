/**
 * IssueGrouper - Group and prioritize collected issues
 *
 * This service takes a list of CollectedIssue objects and:
 * 1. Groups duplicate issues (same parameter failing in multiple steps)
 * 2. Prioritizes issues by severity and category
 * 3. Separates auto-repairable vs user-fixable issues
 *
 * Example: If "range" parameter fails in step 2 and step 10,
 * we group them into ONE issue that affects both steps.
 *
 * PRIVACY: No client data, only metadata and structure
 *
 * @module lib/pilot/shadow/IssueGrouper
 */

import type { CollectedIssue } from '../types';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'IssueGrouper', service: 'shadow-agent' });

export interface IssueGroups {
  critical: CollectedIssue[];
  warnings: CollectedIssue[];
  autoRepairs: CollectedIssue[];
}

export class IssueGrouper {
  /**
   * Group issues by root cause
   * Merges duplicate issues that affect multiple steps
   */
  groupIssues(issues: CollectedIssue[]): CollectedIssue[] {
    logger.debug({ issueCount: issues.length }, 'Grouping issues');

    const groups = new Map<string, CollectedIssue>();

    for (const issue of issues) {
      const groupKey = this.getGroupKey(issue);

      if (groups.has(groupKey)) {
        // Merge into existing group
        const existing = groups.get(groupKey)!;

        // Add affected steps (avoid duplicates)
        for (const affectedStep of issue.affectedSteps) {
          const isDuplicate = existing.affectedSteps.some(
            step => step.stepId === affectedStep.stepId
          );

          if (!isDuplicate) {
            existing.affectedSteps.push(affectedStep);
          }
        }

        logger.debug({
          groupKey,
          issueId: issue.id,
          mergedInto: existing.id
        }, 'Merged issue into existing group');
      } else {
        // New group - clone the issue to avoid mutation
        groups.set(groupKey, {
          ...issue,
          affectedSteps: [...issue.affectedSteps]
        });

        logger.debug({
          groupKey,
          issueId: issue.id
        }, 'Created new issue group');
      }
    }

    const groupedIssues = Array.from(groups.values());

    logger.info({
      originalCount: issues.length,
      groupedCount: groupedIssues.length
    }, 'Issues grouped successfully');

    return groupedIssues;
  }

  /**
   * Prioritize issues into three categories:
   * - Critical: Must be fixed to proceed
   * - Warnings: Should be fixed, but not blocking
   * - Auto-repairs: Can be fixed automatically
   */
  prioritizeIssues(issues: CollectedIssue[]): IssueGroups {
    logger.debug({ issueCount: issues.length }, 'Prioritizing issues');

    const critical: CollectedIssue[] = [];
    const warnings: CollectedIssue[] = [];
    const autoRepairs: CollectedIssue[] = [];

    for (const issue of issues) {
      // Auto-repairable issues go into their own category
      if (issue.autoRepairAvailable && issue.autoRepairProposal) {
        autoRepairs.push(issue);
        continue;
      }

      // Critical and high severity issues
      if (issue.severity === 'critical' || issue.severity === 'high') {
        critical.push(issue);
        continue;
      }

      // Everything else is a warning
      warnings.push(issue);
    }

    // Sort each category by estimated impact
    const impactOrder = { high: 0, medium: 1, low: 2 };

    critical.sort((a, b) => {
      const aImpact = impactOrder[a.estimatedImpact];
      const bImpact = impactOrder[b.estimatedImpact];
      return aImpact - bImpact;
    });

    warnings.sort((a, b) => {
      const aImpact = impactOrder[a.estimatedImpact];
      const bImpact = impactOrder[b.estimatedImpact];
      return aImpact - bImpact;
    });

    autoRepairs.sort((a, b) => {
      // Sort auto-repairs by confidence (highest first)
      const aConfidence = a.autoRepairProposal?.confidence || 0;
      const bConfidence = b.autoRepairProposal?.confidence || 0;
      return bConfidence - aConfidence;
    });

    logger.info({
      criticalCount: critical.length,
      warningsCount: warnings.length,
      autoRepairsCount: autoRepairs.length
    }, 'Issues prioritized');

    return {
      critical,
      warnings,
      autoRepairs
    };
  }

  /**
   * Get a unique group key for an issue
   * Issues with the same key will be merged together
   */
  private getGroupKey(issue: CollectedIssue): string {
    const category = issue.category;

    // DO NOT group parameter errors - each step needs individual fixing
    // Different steps with the same parameter name might need different values
    if (category === 'parameter_error' || category === 'execution_error') {
      // Each parameter error is unique per step
      const stepId = issue.affectedSteps[0]?.stepId || issue.id;
      return `param:${stepId}:${issue.id}`;
    }

    // DO NOT group hardcode detections - each step needs individual parameterization
    // Even if the same value appears in multiple steps (e.g., spreadsheet_id),
    // the user might want different parameters (e.g., source_spreadsheet, target_spreadsheet)
    if (category === 'hardcode_detected') {
      // Each hardcode detection is unique - don't merge across steps
      // Use the path to make it unique per step and parameter
      const stepId = issue.affectedSteps[0]?.stepId || 'unknown';
      const paramName = issue.suggestedFix?.action?.paramName || 'value';
      return `hardcode:${stepId}:${paramName}:${issue.id}`;
    }

    // Group data shape mismatches by type
    if (category === 'data_shape_mismatch') {
      // Different data shape errors are usually unique per step
      // But we could group by "array vs object" type
      if (issue.message.includes('list of items') || issue.message.includes('single item')) {
        return `data_shape:array_object`;
      }
      return `data_shape:${issue.id}`; // Unique per step
    }

    // Group data unavailable by message similarity
    if (category === 'data_unavailable') {
      if (issue.message.includes('didn\'t find any data')) {
        return 'data_unavailable:empty_results';
      }
      if (issue.message.includes('missing a required field')) {
        return 'data_unavailable:missing_field';
      }
      return `data_unavailable:${issue.id}`; // Unique per step
    }

    // Default: each issue is unique
    return `unique:${issue.id}`;
  }

  /**
   * Extract parameter name from error message
   * Examples:
   * - "Parameter 'range' not found" → "range"
   * - "Column 'Status' is invalid" → "Status"
   * - "Range 'UrgentEmails' not found in spreadsheet" → "UrgentEmails"
   */
  private extractParameterName(message: string): string | null {
    // Try to extract parameter name from quotes
    const quotedMatch = message.match(/['"]([^'"]+)['"]/);
    if (quotedMatch) {
      return quotedMatch[1];
    }

    // Try to extract from "Parameter X" or "Column X" patterns
    const paramMatch = message.match(/(?:parameter|column|range|field)\s+(\w+)/i);
    if (paramMatch) {
      return paramMatch[1];
    }

    return null;
  }

  /**
   * Deduplicate issues by removing exact duplicates
   * (should rarely be needed after grouping, but included for safety)
   */
  deduplicateIssues(issues: CollectedIssue[]): CollectedIssue[] {
    const seen = new Set<string>();
    const deduplicated: CollectedIssue[] = [];

    for (const issue of issues) {
      const key = `${issue.category}:${issue.title}`;

      if (!seen.has(key)) {
        seen.add(key);
        deduplicated.push(issue);
      } else {
        logger.debug({
          issueId: issue.id,
          key
        }, 'Skipped duplicate issue');
      }
    }

    if (deduplicated.length < issues.length) {
      logger.info({
        originalCount: issues.length,
        deduplicatedCount: deduplicated.length
      }, 'Issues deduplicated');
    }

    return deduplicated;
  }

  /**
   * Get a summary of issue statistics
   */
  getIssueSummary(groups: IssueGroups): {
    total: number;
    critical: number;
    warnings: number;
    autoRepairs: number;
    requiresUserAction: number;
  } {
    const requiresUserAction = groups.critical.length + groups.warnings.length;

    return {
      total: groups.critical.length + groups.warnings.length + groups.autoRepairs.length,
      critical: groups.critical.length,
      warnings: groups.warnings.length,
      autoRepairs: groups.autoRepairs.length,
      requiresUserAction
    };
  }
}
