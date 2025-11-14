/**
 * Memory Consolidation Scheduler
 *
 * Handles periodic consolidation of low-importance memories based on configured frequency
 * Runs as a background job to merge similar memories and reduce database bloat
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { MemoryConfigService } from './MemoryConfigService';
import { MemorySummarizer } from './MemorySummarizer';

export class MemoryConsolidationScheduler {
  private supabase: SupabaseClient;
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /**
   * Start the consolidation scheduler
   * Runs at the configured frequency
   */
  async start(): Promise<void> {
    if (this.intervalId) {
      console.log('[ConsolidationScheduler] Already running');
      return;
    }

    // Load frequency from config
    const retentionConfig = await MemoryConfigService.getRetentionConfig(this.supabase);
    const frequencyMs = retentionConfig.consolidation_frequency_days * 24 * 60 * 60 * 1000;

    console.log(`[ConsolidationScheduler] Starting with frequency: ${retentionConfig.consolidation_frequency_days} days`);

    // Run immediately on start
    await this.runConsolidation();

    // Schedule periodic runs
    this.intervalId = setInterval(async () => {
      await this.runConsolidation();
    }, frequencyMs);

    console.log(`✅ [ConsolidationScheduler] Started successfully`);
  }

  /**
   * Stop the consolidation scheduler
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('[ConsolidationScheduler] Stopped');
    }
  }

  /**
   * Check if scheduler is running
   */
  isSchedulerRunning(): boolean {
    return this.intervalId !== null;
  }

  /**
   * Run consolidation process
   * Consolidates memories when count exceeds threshold
   */
  private async runConsolidation(): Promise<void> {
    if (this.isRunning) {
      console.log('[ConsolidationScheduler] Consolidation already in progress, skipping...');
      return;
    }

    try {
      this.isRunning = true;
      console.log('[ConsolidationScheduler] Starting consolidation run...');

      const retentionConfig = await MemoryConfigService.getRetentionConfig(this.supabase);

      // Get count of low-importance memories
      const { count, error: countError } = await this.supabase
        .from('run_memories')
        .select('*', { count: 'exact', head: true })
        .lt('importance_score', 0.5);

      if (countError) {
        console.error('[ConsolidationScheduler] Error counting memories:', countError);
        return;
      }

      console.log(`[ConsolidationScheduler] Found ${count} low-importance memories`);

      // Only consolidate if threshold is exceeded
      if (!count || count < retentionConfig.consolidation_threshold) {
        console.log(`[ConsolidationScheduler] Threshold not met (${count}/${retentionConfig.consolidation_threshold}), skipping consolidation`);
        return;
      }

      // Fetch low-importance memories for consolidation
      const { data: memories, error: fetchError } = await this.supabase
        .from('run_memories')
        .select('*')
        .lt('importance_score', 0.5)
        .order('created_at', { ascending: true })
        .limit(100); // Consolidate in batches of 100

      if (fetchError || !memories || memories.length === 0) {
        console.error('[ConsolidationScheduler] Error fetching memories:', fetchError);
        return;
      }

      console.log(`[ConsolidationScheduler] Consolidating ${memories.length} memories...`);

      // Group memories by agent
      const byAgent = memories.reduce((acc, mem: any) => {
        if (!acc[mem.agent_id]) {
          acc[mem.agent_id] = [];
        }
        acc[mem.agent_id].push(mem);
        return acc;
      }, {} as Record<string, any[]>);

      let totalConsolidated = 0;

      // Consolidate each agent's memories
      for (const [agentId, agentMemories] of Object.entries(byAgent)) {
        try {
          // Create consolidated memory
          const summaries = (agentMemories as any[]).map((m: any) => m.summary).join(' ');
          const consolidatedSummary = `Consolidated ${(agentMemories as any[]).length} low-importance runs: ${summaries.substring(0, 500)}...`;

          // Calculate average importance
          const avgImportance = (agentMemories as any[]).reduce((sum: number, m: any) => sum + m.importance_score, 0) / (agentMemories as any[]).length;

          // Insert consolidated memory
          const { data: consolidated, error: insertError } = await this.supabase
            .from('run_memories')
            .insert({
              agent_id: agentId,
              user_id: (agentMemories as any[])[0].user_id,
              run_number: (agentMemories as any[])[0].run_number,
              summary: consolidatedSummary,
              sentiment: 'neutral',
              importance_score: avgImportance,
              key_outcomes: {
                success: true,
                items_processed: (agentMemories as any[]).length,
                errors: null,
                warnings: null
              },
              patterns_detected: {
                recurring_error: null,
                success_pattern: null,
                performance_issue: null
              },
              suggestions: {
                improve_prompt: null,
                adjust_schedule: null,
                optimize_config: null
              },
              metadata: {
                consolidated: true,
                original_memory_ids: (agentMemories as any[]).map((m: any) => m.id),
                consolidation_date: new Date().toISOString()
              }
            })
            .select()
            .single();

          if (insertError) {
            console.error(`[ConsolidationScheduler] Error creating consolidated memory:`, insertError);
            continue;
          }

          // Delete original memories
          const memoryIds = (agentMemories as any[]).map((m: any) => m.id);
          const { error: deleteError } = await this.supabase
            .from('run_memories')
            .delete()
            .in('id', memoryIds);

          if (deleteError) {
            console.error(`[ConsolidationScheduler] Error deleting old memories:`, deleteError);
            // Delete the consolidated memory to maintain consistency
            await this.supabase.from('run_memories').delete().eq('id', consolidated!.id);
            continue;
          }

          totalConsolidated += (agentMemories as any[]).length;
          console.log(`✅ [ConsolidationScheduler] Consolidated ${(agentMemories as any[]).length} memories for agent ${agentId}`);

          // Generate embedding for consolidated memory (async, non-blocking)
          const summarizer = new MemorySummarizer(this.supabase);
          summarizer.generateEmbedding(consolidated!.id).catch(err => {
            console.error('[ConsolidationScheduler] Error generating embedding for consolidated memory:', err);
          });

        } catch (error) {
          console.error(`[ConsolidationScheduler] Error consolidating agent ${agentId}:`, error);
        }
      }

      console.log(`✅ [ConsolidationScheduler] Consolidation complete: ${totalConsolidated} memories consolidated`);

    } catch (error) {
      console.error('[ConsolidationScheduler] Fatal error during consolidation:', error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Manually trigger consolidation (for testing or admin actions)
   */
  async triggerConsolidation(): Promise<void> {
    console.log('[ConsolidationScheduler] Manual consolidation triggered');
    await this.runConsolidation();
  }
}
