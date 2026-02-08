/**
 * ExecutionOutputCache - Database-based cache for step outputs during calibration
 *
 * CRITICAL: Stores step outputs in workflow_executions.execution_trace.cached_outputs
 *
 * Why we need caching:
 * 1. Privacy-first: Cannot store client data permanently in PostgreSQL
 * 2. Resume flow: When user fixes hardcoded value and retries, new HTTP request = new ExecutionContext
 * 3. Data dependencies: Failed step needs outputs from completed steps (e.g., {{step1.emails}})
 * 4. Solution: Cache outputs in execution_trace JSONB field, clear on completion
 *
 * Trade-offs:
 * - Temporary storage: Data stored in execution_trace.cached_outputs (cleared when execution completes)
 * - JSONB size limit: ~1GB per row (sufficient for calibration runs)
 * - Auto-cleanup: Cleared when execution status becomes 'completed' or 'failed' permanently
 *
 * @module lib/pilot/ExecutionOutputCache
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

interface CachedOutput {
  stepId: string;
  data: any;
  metadata: any;
  cachedAt: number;
}

class ExecutionOutputCache {
  /**
   * Store step output in execution_trace.cached_outputs
   */
  async setStepOutput(executionId: string, stepId: string, data: any, metadata: any): Promise<void> {
    console.log(`[ExecutionOutputCache] 🔄 Starting cache for ${executionId}/${stepId}...`);
    try {
      // Get current execution_trace
      console.log(`[ExecutionOutputCache] 📥 Fetching execution_trace for ${executionId}...`);
      const { data: execution, error: fetchError } = await supabaseAdmin
        .from('workflow_executions')
        .select('execution_trace')
        .eq('id', executionId)
        .single();

      if (fetchError) {
        console.error(`[ExecutionOutputCache] ❌ Failed to fetch execution ${executionId}:`, fetchError);
        return;
      }

      console.log(`[ExecutionOutputCache] 📝 Updating execution_trace for ${executionId}...`);
      const currentTrace = execution?.execution_trace || {};
      const cachedOutputs = currentTrace.cached_outputs || {};

      // Add this step's output to cached_outputs
      cachedOutputs[stepId] = {
        stepId,
        data,
        metadata,
        cachedAt: Date.now(),
      };

      // Update execution_trace with new cached_outputs
      const { error: updateError } = await supabaseAdmin
        .from('workflow_executions')
        .update({
          execution_trace: {
            ...currentTrace,
            cached_outputs: cachedOutputs,
          },
        })
        .eq('id', executionId);

      if (updateError) {
        console.error(`[ExecutionOutputCache] ❌ Failed to cache step ${stepId}:`, updateError);
      } else {
        console.log(`[ExecutionOutputCache] ✅ Cached output for ${executionId}/${stepId} in database`);
      }
    } catch (err) {
      console.error(`[ExecutionOutputCache] ❌ Failed to cache step ${stepId}:`, err);
    }
  }

  /**
   * Get all step outputs from execution_trace.cached_outputs
   */
  async getAllOutputs(executionId: string): Promise<Map<string, { data: any; metadata: any }> | null> {
    try {
      const { data: execution, error } = await supabaseAdmin
        .from('workflow_executions')
        .select('execution_trace')
        .eq('id', executionId)
        .single();

      if (error) {
        console.error(`[ExecutionOutputCache] ❌ Failed to fetch execution ${executionId}:`, error);
        return null;
      }

      const cachedOutputs = execution?.execution_trace?.cached_outputs;

      if (!cachedOutputs || Object.keys(cachedOutputs).length === 0) {
        console.log(`[ExecutionOutputCache] ❌ No cached outputs for execution ${executionId}`);
        return null;
      }

      // Convert object to Map
      const outputs = new Map<string, { data: any; metadata: any }>();
      for (const [stepId, cached] of Object.entries(cachedOutputs)) {
        const cachedOutput = cached as CachedOutput;
        outputs.set(stepId, {
          data: cachedOutput.data,
          metadata: cachedOutput.metadata,
        });
      }

      console.log(`[ExecutionOutputCache] ✅ Retrieved ${outputs.size} cached outputs for ${executionId} from database`);
      return outputs;
    } catch (err) {
      console.error(`[ExecutionOutputCache] ❌ Failed to retrieve outputs for ${executionId}:`, err);
      return null;
    }
  }

  /**
   * Clear cached_outputs from execution_trace (call when execution completes/fails permanently)
   */
  async clearExecution(executionId: string): Promise<void> {
    try {
      // Get current execution_trace
      const { data: execution, error: fetchError } = await supabaseAdmin
        .from('workflow_executions')
        .select('execution_trace')
        .eq('id', executionId)
        .single();

      if (fetchError) {
        console.warn(`[ExecutionOutputCache] Failed to fetch execution for cleanup:`, fetchError);
        return;
      }

      const currentTrace = execution?.execution_trace || {};
      const cachedCount = Object.keys(currentTrace.cached_outputs || {}).length;

      if (cachedCount === 0) {
        return; // Nothing to clear
      }

      // Remove cached_outputs from execution_trace
      const { cached_outputs, ...traceWithoutCache } = currentTrace;

      const { error: updateError } = await supabaseAdmin
        .from('workflow_executions')
        .update({
          execution_trace: traceWithoutCache,
        })
        .eq('id', executionId);

      if (updateError) {
        console.error(`[ExecutionOutputCache] ❌ Failed to clear cache for ${executionId}:`, updateError);
      } else {
        console.log(`[ExecutionOutputCache] 🗑️  Cleared cached outputs for ${executionId} (${cachedCount} steps)`);
      }
    } catch (err) {
      console.error(`[ExecutionOutputCache] ❌ Failed to clear cache for ${executionId}:`, err);
    }
  }
}

// Global singleton instance
export const executionOutputCache = new ExecutionOutputCache();
