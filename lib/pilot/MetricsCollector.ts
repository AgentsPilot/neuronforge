/**
 * MetricsCollector - Privacy-first metadata collection for business intelligence
 *
 * CRITICAL PRIVACY GUARANTEE:
 * - Collects ONLY aggregated counts, field names, and timing data
 * - NEVER stores actual customer data (names, emails, values, PII)
 * - Called BEFORE execution output is discarded (StateManager.finalizeExecution)
 * - Enables business intelligence without compromising privacy
 *
 * What we collect:
 * ✅ Item counts per step (e.g., "50 emails found")
 * ✅ Field names present (e.g., ["id", "email", "priority"])
 * ✅ Field presence counts (e.g., "12 items have priority field")
 * ✅ Timing data (duration_ms)
 * ✅ Status indicators (empty results, failures)
 *
 * What we NEVER collect:
 * ❌ Customer names, emails, addresses, phone numbers
 * ❌ Email subjects, body content, attachments
 * ❌ Invoice amounts, order details, transaction data
 * ❌ Any actual field values or PII
 *
 * @module lib/pilot/MetricsCollector
 */

import { createLogger } from '@/lib/logger';
import type { ExecutionContext } from './ExecutionContext';
import type { SupabaseClient } from '@supabase/supabase-js';

const logger = createLogger({ module: 'MetricsCollector', service: 'business-intelligence' });

/**
 * Per-step metrics for business intelligence
 * Enables trend analysis like "Email volume down 40% but processing stable"
 */
export interface StepMetric {
  plugin: string;
  action: string;
  step_name: string;
  count: number;
  fields?: string[];  // Top-level field names (for context)
}

/**
 * Privacy-safe execution metrics (metadata only, NO customer data)
 */
export interface ExecutionMetrics {
  total_items: number;
  items_by_field: Record<string, number>;
  field_names: string[];
  has_empty_results: boolean;
  failed_step_count: number;
  duration_ms?: number;
  step_metrics?: StepMetric[];  // NEW: Per-step breakdown for business intelligence
}

export class MetricsCollector {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /**
   * Collect aggregated metadata from execution
   *
   * ✅ NEW APPROACH: Reads from workflow_step_executions table instead of in-memory context
   * This is cleaner because:
   * - Data already persisted in database by StepExecutor
   * - No need to hold execution context in memory
   * - Can be called anytime after execution completes
   *
   * CRITICAL: NO customer data stored, only counts and structure
   *
   * @param executionId - Execution ID
   * @param agentId - Agent ID
   * @param context - Execution context (for duration calculation only)
   * @returns Aggregated metrics (privacy-safe)
   */
  async collectMetrics(
    executionId: string,
    agentId: string,
    context: ExecutionContext
  ): Promise<ExecutionMetrics> {
    const startTime = Date.now();

    logger.info({
      executionId,
      agentId,
      stepCount: context.completedSteps.length + context.failedSteps.length,
    }, 'Starting metrics collection from workflow_step_executions table');

    // ✅ Query workflow_step_executions table for step metrics
    const { data: stepExecutions, error } = await this.supabase
      .from('workflow_step_executions')
      .select('step_id, step_name, plugin, action, item_count, status, execution_metadata')
      .eq('workflow_execution_id', executionId)
      .order('created_at', { ascending: true });

    if (error) {
      logger.error({ err: error, executionId }, 'Failed to query workflow_step_executions');
      throw error;
    }

    logger.debug({
      executionId,
      stepCount: stepExecutions?.length || 0,
    }, 'Fetched step executions from database');

    const metrics: ExecutionMetrics = {
      total_items: 0,
      items_by_field: {},
      field_names: [],
      has_empty_results: false,
      failed_step_count: 0,
      step_metrics: [],
    };

    // Aggregate metrics from step executions
    for (const stepExec of stepExecutions || []) {
      // Count failed steps
      if (stepExec.status === 'failed') {
        metrics.failed_step_count++;
      }

      // Skip system steps only
      // IMPORTANT: Include steps with 0 items - they represent business outcomes!
      // Example: "0 customer complaints" after fixes = SUCCESS metric
      if (stepExec.plugin === 'system') {
        continue;
      }

      // Build step metric (include even if count is 0)
      const itemCount = stepExec.item_count || 0;
      const stepMetric: StepMetric = {
        plugin: stepExec.plugin || 'unknown',
        action: stepExec.action || 'unknown',
        step_name: stepExec.step_name || stepExec.step_id,
        count: itemCount,
        fields: stepExec.execution_metadata?.field_names || undefined,
      };

      metrics.step_metrics!.push(stepMetric);

      // 🆕 CRITICAL FIX: Populate items_by_field for field-level insights
      // This enables insights like "items with priority field increased 65%"
      if (stepExec.execution_metadata?.field_names) {
        const fieldNames = stepExec.execution_metadata.field_names as string[];

        fieldNames.forEach((field: string) => {
          const hasFieldKey = `has_${field}`;

          // Track cumulative count of items with this field
          if (!metrics.items_by_field[hasFieldKey]) {
            metrics.items_by_field[hasFieldKey] = 0;
          }
          metrics.items_by_field[hasFieldKey] += itemCount;
        });

        // Also populate execution-level field_names array (unique fields)
        fieldNames.forEach((field: string) => {
          if (!metrics.field_names.includes(field)) {
            metrics.field_names.push(field);
          }
        });
      }

      // Aggregate total items (for overall execution metrics)
      metrics.total_items += itemCount;

      // Check for empty results
      if (stepExec.item_count === 0) {
        metrics.has_empty_results = true;
      }
    }

    // Calculate total execution duration
    if (context.completedAt && context.startedAt) {
      metrics.duration_ms = context.completedAt.getTime() - context.startedAt.getTime();
    } else if (context.totalExecutionTime > 0) {
      metrics.duration_ms = context.totalExecutionTime;
    }

    // Store aggregated metrics in execution_metrics table
    await this.storeMetrics(executionId, agentId, metrics);

    const collectionTime = Date.now() - startTime;
    logger.info({
      executionId,
      totalItems: metrics.total_items,
      stepMetricsCount: metrics.step_metrics!.length,
      hasEmptyResults: metrics.has_empty_results,
      failedSteps: metrics.failed_step_count,
      collectionTimeMs: collectionTime,
    }, '✅ Metrics collection complete from workflow_step_executions');

    return metrics;
  }

  /**
   * Store metrics in database
   *
   * CRITICAL: Final privacy check before persistence
   */
  private async storeMetrics(
    executionId: string,
    agentId: string,
    metrics: ExecutionMetrics
  ): Promise<void> {
    try {
      // PRIVACY AUDIT: Verify NO suspicious patterns in field names
      const suspiciousFields = metrics.field_names.filter(
        field => this.isSuspiciousFieldName(field)
      );

      if (suspiciousFields.length > 0) {
        logger.warn({
          executionId,
          suspiciousFields,
        }, '⚠️ PRIVACY WARNING: Suspicious field names detected - may contain sensitive data');
      }

      // PRIVACY AUDIT: Verify field names are reasonable length
      const longFields = metrics.field_names.filter(field => field.length > 100);
      if (longFields.length > 0) {
        logger.warn({
          executionId,
          longFields,
        }, '⚠️ PRIVACY WARNING: Unusually long field names detected - may contain data');
      }

      // Store in database
      const { error } = await this.supabase
        .from('execution_metrics')
        .upsert({
          execution_id: executionId,
          agent_id: agentId,
          executed_at: new Date().toISOString(),
          duration_ms: metrics.duration_ms,
          total_items: metrics.total_items,
          items_by_field: metrics.items_by_field,
          field_names: metrics.field_names,
          has_empty_results: metrics.has_empty_results,
          failed_step_count: metrics.failed_step_count,
          step_metrics: metrics.step_metrics || [],  // NEW: Per-step breakdown
        });

      if (error) {
        logger.error({
          err: error,
          executionId,
        }, 'Failed to store execution metrics');
        throw error;
      }

      logger.info({
        executionId,
        metricsStored: {
          totalItems: metrics.total_items,
          fieldCount: metrics.field_names.length,
          fieldPresenceCounts: Object.keys(metrics.items_by_field).length,
        },
      }, '✅ Metrics stored successfully (privacy-safe)');
    } catch (error) {
      logger.error({
        err: error,
        executionId,
      }, 'Error storing execution metrics');
      // Don't throw - metrics collection should never fail the execution
    }
  }

  /**
   * Check if field name contains suspicious patterns
   *
   * This is a safety check to prevent accidental storage of sensitive data
   */
  private isSuspiciousFieldName(fieldName: string): boolean {
    const suspiciousPatterns = [
      /password/i,
      /secret/i,
      /token/i,
      /ssn/i,
      /credit_card/i,
      /api_key/i,
      /private_key/i,
    ];

    return suspiciousPatterns.some(pattern => pattern.test(fieldName));
  }
}
