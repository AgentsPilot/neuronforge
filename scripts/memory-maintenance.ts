#!/usr/bin/env tsx
/**
 * Memory System Maintenance Script
 *
 * Performs automated cleanup and consolidation of memories:
 * 1. Delete old low-importance memories based on retention policy
 * 2. Delete very old run memories past retention window
 * 3. Consolidate similar memories into pattern summaries
 *
 * Run this script via cron job (recommended: daily at 3 AM)
 * Example crontab: 0 3 * * * cd /path/to/app && npx tsx scripts/memory-maintenance.ts
 */

import { createClient } from '@supabase/supabase-js';
import { MemoryConfigService } from '../lib/memory/MemoryConfigService';
import { MemorySummarizer } from '../lib/memory/MemorySummarizer';
import { AuditTrailService } from '../lib/services/AuditTrailService';
import { AUDIT_EVENTS } from '../lib/audit/events';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const auditTrail = AuditTrailService.getInstance();

/**
 * Clean up old memories based on retention policy
 */
async function cleanupOldMemories(): Promise<{
  deletedCount: number;
  errors: number;
}> {
  console.log('🧹 [Memory Maintenance] Starting cleanup of old memories...');

  try {
    // Load retention config
    const retentionConfig = await MemoryConfigService.getRetentionConfig(supabase);

    // Calculate cutoff dates
    const runMemoriesCutoff = new Date();
    runMemoriesCutoff.setDate(runMemoriesCutoff.getDate() - retentionConfig.run_memories_days);

    const lowImportanceCutoff = new Date();
    lowImportanceCutoff.setDate(lowImportanceCutoff.getDate() - retentionConfig.low_importance_days);

    console.log(`📅 [Memory Maintenance] Retention policy:`);
    console.log(`   - Run memories: Keep ${retentionConfig.run_memories_days} days (before ${runMemoriesCutoff.toISOString()})`);
    console.log(`   - Low importance: Keep ${retentionConfig.low_importance_days} days (before ${lowImportanceCutoff.toISOString()})`);

    // Delete old low-importance memories (importance_score <= 3)
    const { data: lowImpData, error: lowImpError } = await supabase
      .from('run_memories')
      .delete()
      .lt('run_timestamp', lowImportanceCutoff.toISOString())
      .lte('importance_score', 3)
      .select('id, agent_id, run_number, importance_score');

    if (lowImpError) {
      console.error('❌ [Memory Maintenance] Error deleting low-importance memories:', lowImpError);
      return { deletedCount: 0, errors: 1 };
    }

    const lowImpCount = lowImpData?.length || 0;
    console.log(`🗑️  [Memory Maintenance] Deleted ${lowImpCount} low-importance memories (score <= 3)`);

    // Delete very old run memories (regardless of importance)
    const { data: oldData, error: oldError } = await supabase
      .from('run_memories')
      .delete()
      .lt('run_timestamp', runMemoriesCutoff.toISOString())
      .select('id, agent_id, run_number, importance_score');

    if (oldError) {
      console.error('❌ [Memory Maintenance] Error deleting old memories:', oldError);
      return { deletedCount: lowImpCount, errors: 1 };
    }

    const oldCount = oldData?.length || 0;
    console.log(`🗑️  [Memory Maintenance] Deleted ${oldCount} very old run memories`);

    const totalDeleted = lowImpCount + oldCount;

    // Audit: Memory cleanup
    await auditTrail.log({
      action: AUDIT_EVENTS.MEMORY_CLEANUP_COMPLETED,
      entityType: 'system',
      entityId: 'memory-system',
      userId: 'system',
      details: {
        low_importance_deleted: lowImpCount,
        old_memories_deleted: oldCount,
        total_deleted: totalDeleted,
        retention_policy: retentionConfig
      },
      severity: 'info'
    });

    return { deletedCount: totalDeleted, errors: 0 };
  } catch (error) {
    console.error('❌ [Memory Maintenance] Cleanup failed:', error);

    await auditTrail.log({
      action: AUDIT_EVENTS.MEMORY_CLEANUP_FAILED,
      entityType: 'system',
      entityId: 'memory-system',
      userId: 'system',
      details: {
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      severity: 'critical'
    });

    return { deletedCount: 0, errors: 1 };
  }
}

/**
 * Consolidate similar memories into pattern summaries
 */
async function consolidateMemories(): Promise<{
  consolidatedCount: number;
  errors: number;
}> {
  console.log('🔄 [Memory Maintenance] Starting memory consolidation...');

  try {
    // Load retention config
    const retentionConfig = await MemoryConfigService.getRetentionConfig(supabase);

    // Get agents with many memories (above consolidation threshold)
    const { data: agents, error: agentsError } = await supabase
      .from('run_memories')
      .select('agent_id, count:id.count()')
      .gte('importance_score', 5) // Only consolidate important memories
      .group('agent_id')
      .having('count', 'gte', retentionConfig.consolidation_threshold);

    if (agentsError) {
      console.error('❌ [Memory Maintenance] Error fetching agents for consolidation:', agentsError);
      return { consolidatedCount: 0, errors: 1 };
    }

    if (!agents || agents.length === 0) {
      console.log('ℹ️  [Memory Maintenance] No agents need consolidation');
      return { consolidatedCount: 0, errors: 0 };
    }

    console.log(`📊 [Memory Maintenance] Found ${agents.length} agents with memories to consolidate`);

    let consolidatedCount = 0;
    let errors = 0;

    // For each agent, find patterns and consolidate
    for (const agentRow of agents) {
      const agentId = agentRow.agent_id;

      try {
        // Get recent important memories with embeddings
        const { data: memories, error: memoriesError } = await supabase
          .from('run_memories')
          .select('id, summary, patterns_detected, importance_score, embedding')
          .eq('agent_id', agentId)
          .gte('importance_score', 7) // Focus on very important memories
          .not('embedding', 'is', null)
          .order('run_timestamp', { ascending: false })
          .limit(100);

        if (memoriesError || !memories || memories.length < 5) {
          continue; // Skip if not enough memories
        }

        console.log(`  🔍 [Memory Maintenance] Agent ${agentId}: Analyzing ${memories.length} memories for patterns...`);

        // Group by similar patterns (this is a simplified version - could use clustering)
        const patternGroups: Map<string, any[]> = new Map();

        memories.forEach((mem) => {
          const pattern = mem.patterns_detected?.recurring_error || mem.patterns_detected?.success_pattern || 'general';
          if (!patternGroups.has(pattern)) {
            patternGroups.set(pattern, []);
          }
          patternGroups.get(pattern)!.push(mem);
        });

        // Consolidate groups with 3+ similar memories
        for (const [pattern, group] of patternGroups) {
          if (group.length >= 3 && pattern !== 'general') {
            console.log(`  ✨ [Memory Maintenance] Found pattern group: "${pattern}" (${group.length} memories)`);

            // Create consolidated pattern memory
            const consolidatedSummary = `Pattern identified from ${group.length} executions: ${pattern}`;

            // Mark original memories as consolidated (could delete or archive)
            const { error: updateError } = await supabase
              .from('run_memories')
              .update({ memory_type: 'consolidated' })
              .in('id', group.map(m => m.id));

            if (!updateError) {
              consolidatedCount += group.length;
            } else {
              errors++;
            }
          }
        }
      } catch (error) {
        console.error(`  ❌ [Memory Maintenance] Error consolidating for agent ${agentId}:`, error);
        errors++;
      }
    }

    console.log(`✅ [Memory Maintenance] Consolidated ${consolidatedCount} memories`);

    // Audit: Consolidation
    await auditTrail.log({
      action: AUDIT_EVENTS.MEMORY_CONSOLIDATION_COMPLETED,
      entityType: 'system',
      entityId: 'memory-system',
      userId: 'system',
      details: {
        agents_processed: agents.length,
        memories_consolidated: consolidatedCount,
        errors
      },
      severity: 'info'
    });

    return { consolidatedCount, errors };
  } catch (error) {
    console.error('❌ [Memory Maintenance] Consolidation failed:', error);

    await auditTrail.log({
      action: AUDIT_EVENTS.MEMORY_CONSOLIDATION_FAILED,
      entityType: 'system',
      entityId: 'memory-system',
      userId: 'system',
      details: {
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      severity: 'critical'
    });

    return { consolidatedCount: 0, errors: 1 };
  }
}

/**
 * Main execution
 */
async function main() {
  console.log('\n🚀 [Memory Maintenance] Starting memory system maintenance...\n');

  const startTime = Date.now();

  // Step 1: Cleanup old memories
  const cleanupResult = await cleanupOldMemories();

  // Step 2: Consolidate similar memories
  const consolidationResult = await consolidateMemories();

  const duration = Date.now() - startTime;

  console.log(`\n✅ [Memory Maintenance] Maintenance completed in ${(duration / 1000).toFixed(1)}s`);
  console.log(`   - Deleted: ${cleanupResult.deletedCount} old memories`);
  console.log(`   - Consolidated: ${consolidationResult.consolidatedCount} memories`);
  console.log(`   - Errors: ${cleanupResult.errors + consolidationResult.errors}\n`);

  process.exit(cleanupResult.errors + consolidationResult.errors > 0 ? 1 : 0);
}

// Run if called directly
if (require.main === module) {
  main();
}
