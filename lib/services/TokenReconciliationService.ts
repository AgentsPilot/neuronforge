/**
 * TokenReconciliationService
 *
 * ✅ P0 FIX: Ensures token tracking accuracy by reconciling multiple sources
 *
 * PURPOSE:
 * Verify that token_usage table records match agent_executions.logs.tokensUsed totals
 * Detect and log discrepancies for debugging and revenue protection
 *
 * USAGE:
 * - Called automatically after execution completion
 * - Can be run as batch job for historical data audit
 * - Logs discrepancies to audit trail for investigation
 *
 * @module lib/services/TokenReconciliationService
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { AuditTrailService } from './AuditTrailService';

export interface ReconciliationResult {
  executionId: string;
  agentId: string;
  userId: string;

  // Token counts from different sources
  tokenUsageTableTotal: number;
  agentExecutionsLogTotal: number;

  // Breakdown from token_usage table
  tokenUsageBreakdown: {
    llmTokens: number;
    memoryTokens: number;
    classificationTokens: number;
    pluginTokens: number;  // ✅ Changed from pluginCalls to pluginTokens
  };

  // Reconciliation status
  isReconciled: boolean;
  discrepancy: number;  // Difference (should be 0)
  discrepancyPercentage: number;

  // Timestamp
  reconciledAt: string;
}

export interface ReconciliationBatchResult {
  totalExecutions: number;
  reconciled: number;
  discrepancies: number;
  results: ReconciliationResult[];
}

export class TokenReconciliationService {
  private supabase: SupabaseClient;
  private auditTrail: AuditTrailService;
  private readonly DISCREPANCY_THRESHOLD = 0.05; // 5% tolerance for rounding

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
    this.auditTrail = AuditTrailService.getInstance();
  }

  /**
   * Reconcile token counts for a single execution
   *
   * ✅ P0: Called automatically after execution to verify accuracy
   */
  async reconcileExecution(executionId: string): Promise<ReconciliationResult> {
    console.log(`🔍 [TokenReconciliation] Reconciling execution: ${executionId}`);

    try {
      // 1. Get total from token_usage table (sum all records for this execution)
      const { data: tokenUsageRecords, error: tokenUsageError } = await this.supabase
        .from('token_usage')
        .select('input_tokens, output_tokens, activity_type, component')
        .eq('execution_id', executionId);

      if (tokenUsageError) {
        throw new Error(`Failed to fetch token_usage records: ${tokenUsageError.message}`);
      }

      // Calculate breakdown by activity type
      let llmTokens = 0;
      let memoryTokens = 0;
      let classificationTokens = 0;
      let pluginTokens = 0;  // ✅ Track plugin token costs

      const tokenUsageTotal = (tokenUsageRecords || []).reduce((sum, record) => {
        const recordTotal = (record.input_tokens || 0) + (record.output_tokens || 0);

        // Categorize by activity type
        if (record.activity_type === 'memory_summarization') {
          memoryTokens += recordTotal;
        } else if (record.component === 'intent_classifier') {
          classificationTokens += recordTotal;
        } else if (record.activity_type === 'plugin_call') {
          pluginTokens += recordTotal;  // ✅ Include plugin token costs in total
        } else {
          llmTokens += recordTotal;  // Step execution LLM calls
        }

        return sum + recordTotal;
      }, 0);

      // 2. Get total from agent_executions.logs.tokensUsed
      const { data: execution, error: executionError } = await this.supabase
        .from('agent_executions')
        .select('agent_id, user_id, logs')
        .eq('id', executionId)
        .maybeSingle();

      if (executionError) {
        throw new Error(`Failed to fetch agent_executions record: ${executionError.message}`);
      }

      if (!execution) {
        throw new Error(`Execution ${executionId} not found in agent_executions table`);
      }

      const logs = execution.logs as any;
      const agentExecutionsTotal = logs?.tokensUsed?.total || logs?.tokensUsed || 0;

      // 3. Calculate discrepancy
      const discrepancy = Math.abs(tokenUsageTotal - agentExecutionsTotal);
      const discrepancyPercentage = agentExecutionsTotal > 0
        ? (discrepancy / agentExecutionsTotal) * 100
        : 0;

      const isReconciled = discrepancyPercentage <= (this.DISCREPANCY_THRESHOLD * 100);

      const result: ReconciliationResult = {
        executionId,
        agentId: execution.agent_id,
        userId: execution.user_id,
        tokenUsageTableTotal: tokenUsageTotal,
        agentExecutionsLogTotal: agentExecutionsTotal,
        tokenUsageBreakdown: {
          llmTokens,
          memoryTokens,
          classificationTokens,
          pluginTokens,  // ✅ Changed from pluginCalls to pluginTokens
        },
        isReconciled,
        discrepancy,
        discrepancyPercentage,
        reconciledAt: new Date().toISOString(),
      };

      // 4. Log result
      if (isReconciled) {
        console.log(`✅ [TokenReconciliation] Execution ${executionId} reconciled successfully`);
        console.log(`   token_usage: ${tokenUsageTotal}, agent_executions: ${agentExecutionsTotal}, diff: ${discrepancy}`);
      } else {
        console.error(`❌ [TokenReconciliation] Discrepancy detected for execution ${executionId}`);
        console.error(`   token_usage: ${tokenUsageTotal}, agent_executions: ${agentExecutionsTotal}, diff: ${discrepancy} (${discrepancyPercentage.toFixed(2)}%)`);
        console.error(`   Breakdown: LLM=${llmTokens}, Memory=${memoryTokens}, Classification=${classificationTokens}, Plugin=${pluginTokens}`);

        // Log to audit trail for investigation
        await this.auditTrail.log({
          action: 'TOKEN_DISCREPANCY_DETECTED',
          entityType: 'execution',
          entityId: executionId,
          userId: execution.user_id,
          resourceName: `Execution ${executionId}`,
          details: {
            token_usage_total: tokenUsageTotal,
            agent_executions_total: agentExecutionsTotal,
            discrepancy,
            discrepancy_percentage: discrepancyPercentage,
            breakdown: result.tokenUsageBreakdown,
          },
          severity: 'critical',
          complianceFlags: ['REVENUE_INTEGRITY'],
        });
      }

      return result;
    } catch (error: any) {
      console.error(`❌ [TokenReconciliation] Reconciliation failed for ${executionId}:`, error);
      throw error;
    }
  }

  /**
   * Reconcile all executions in a date range (batch audit)
   *
   * ✅ P1: Run as scheduled job to audit historical data
   */
  async reconcileBatch(
    startDate: Date,
    endDate: Date,
    limit: number = 100
  ): Promise<ReconciliationBatchResult> {
    console.log(`🔍 [TokenReconciliation] Batch reconciliation from ${startDate.toISOString()} to ${endDate.toISOString()}`);

    try {
      // Get all executions in date range
      const { data: executions, error } = await this.supabase
        .from('agent_executions')
        .select('execution_id')
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString())
        .limit(limit);

      if (error) {
        throw new Error(`Failed to fetch executions: ${error.message}`);
      }

      const results: ReconciliationResult[] = [];
      let reconciledCount = 0;
      let discrepancyCount = 0;

      for (const execution of executions || []) {
        try {
          const result = await this.reconcileExecution(execution.execution_id);
          results.push(result);

          if (result.isReconciled) {
            reconciledCount++;
          } else {
            discrepancyCount++;
          }
        } catch (error: any) {
          console.error(`Failed to reconcile ${execution.execution_id}:`, error.message);
        }
      }

      console.log(`✅ [TokenReconciliation] Batch complete: ${reconciledCount} reconciled, ${discrepancyCount} discrepancies`);

      return {
        totalExecutions: results.length,
        reconciled: reconciledCount,
        discrepancies: discrepancyCount,
        results,
      };
    } catch (error: any) {
      console.error(`❌ [TokenReconciliation] Batch reconciliation failed:`, error);
      throw error;
    }
  }

  /**
   * Get reconciliation statistics for monitoring
   */
  async getStats(days: number = 7): Promise<{
    totalExecutions: number;
    reconciledExecutions: number;
    discrepancyRate: number;
    averageDiscrepancy: number;
  }> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const batch = await this.reconcileBatch(startDate, new Date(), 1000);

    const averageDiscrepancy = batch.results.length > 0
      ? batch.results.reduce((sum, r) => sum + r.discrepancy, 0) / batch.results.length
      : 0;

    const discrepancyRate = batch.totalExecutions > 0
      ? (batch.discrepancies / batch.totalExecutions) * 100
      : 0;

    return {
      totalExecutions: batch.totalExecutions,
      reconciledExecutions: batch.reconciled,
      discrepancyRate,
      averageDiscrepancy,
    };
  }
}
