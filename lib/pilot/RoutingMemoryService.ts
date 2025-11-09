/**
 * Routing Memory Service - Learning & Optimization
 *
 * Captures routing decisions and outcomes to enable:
 * - Learning which models work best for specific agents/step types
 * - Adaptive routing based on historical performance
 * - Cost optimization through pattern recognition
 * - Memory injection into agent context for self-awareness
 *
 * @module lib/pilot/RoutingMemoryService
 */

import { createClient } from '@supabase/supabase-js';

// ============================================================================
// INTERFACES
// ============================================================================

/**
 * Routing performance metrics for a specific pattern
 */
export interface RoutingPattern {
  agentId: string;
  stepType: string;
  preferredTier: 'tier1' | 'tier2' | 'tier3';
  confidence: number; // 0-1 (based on sample size and success rate)

  // Performance metrics
  successRate: number; // 0-1
  avgTokens: number;
  avgExecutionTime: number;
  avgCostUsd: number;

  // Sample size
  totalExecutions: number;
  lastUpdated: Date;
}

/**
 * Routing memory entry for agent memory system
 */
export interface RoutingMemoryEntry {
  memoryType: 'routing_pattern';
  memoryKey: string;
  memoryValue: {
    stepType: string;
    preferredTier: string;
    successRate: number;
    avgTokens: number;
    costSavings: number; // Percentage vs. always using tier3
    recommendation: string;
    confidence: 'low' | 'medium' | 'high';
  };
  importance: number; // 1-10
}

/**
 * Routing recommendation based on memory
 */
export interface RoutingRecommendation {
  shouldOverride: boolean;
  recommendedTier?: 'tier1' | 'tier2' | 'tier3';
  reason: string;
  confidence: number;
  historicalData: {
    totalRuns: number;
    successRate: number;
    avgTokens: number;
    estimatedSavings: number; // USD
  };
}

// ============================================================================
// ROUTING MEMORY SERVICE
// ============================================================================

export class RoutingMemoryService {
  private supabase: any;
  private static instance: RoutingMemoryService;

  private constructor() {
    this.supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): RoutingMemoryService {
    if (!RoutingMemoryService.instance) {
      RoutingMemoryService.instance = new RoutingMemoryService();
    }
    return RoutingMemoryService.instance;
  }

  /**
   * Learn from a completed routing decision
   * Called after step execution completes
   */
  async learnFromExecution(
    agentId: string,
    userId: string,
    executionId: string,
    stepIndex: number,
    stepType: string,
    selectedTier: string,
    success: boolean,
    tokensUsed: number,
    executionTimeMs: number,
    costUsd?: number
  ): Promise<void> {
    try {
      console.log(`🧠 [RoutingMemory] Learning from execution: ${stepType} → ${selectedTier} (success: ${success})`);

      // Get current pattern statistics
      const pattern = await this.getRoutingPattern(agentId, stepType);

      // Update pattern with new data
      const updatedPattern = this.updatePattern(pattern, {
        selectedTier: selectedTier as any,
        success,
        tokensUsed,
        executionTimeMs,
        costUsd: costUsd || 0
      });

      // Calculate if this should become a memory entry
      if (updatedPattern.totalExecutions >= 3 && updatedPattern.confidence >= 0.6) {
        await this.storeRoutingMemory(agentId, userId, stepType, updatedPattern);
      }

      console.log(`✅ [RoutingMemory] Updated pattern for ${stepType}: ${updatedPattern.preferredTier} (confidence: ${(updatedPattern.confidence * 100).toFixed(0)}%)`);
    } catch (err) {
      console.error('❌ [RoutingMemory] Failed to learn from execution:', err);
      // Don't throw - memory failure shouldn't break execution
    }
  }

  /**
   * Get routing recommendation based on memory
   * Called before making routing decision
   */
  async getRecommendation(
    agentId: string,
    stepType: string,
    calculatedComplexity: number
  ): Promise<RoutingRecommendation | null> {
    try {
      // Check if we have learned patterns for this agent/step type
      const { data: memories, error } = await this.supabase
        .from('agent_memories')
        .select('*')
        .eq('agent_id', agentId)
        .eq('memory_type', 'routing_pattern')
        .eq('memory_key', `routing_${stepType}`)
        .order('created_at', { ascending: false })
        .limit(1);

      if (error || !memories || memories.length === 0) {
        return null; // No learned pattern yet
      }

      const memory = memories[0];
      const pattern = JSON.parse(memory.memory_value);

      // Only use memory if we have high confidence
      if (pattern.confidence === 'low' || pattern.successRate < 0.85) {
        return null;
      }

      // Calculate if we should override the complexity-based decision
      const shouldOverride = this.shouldOverrideBasedOnMemory(
        pattern,
        calculatedComplexity
      );

      if (!shouldOverride) {
        return null;
      }

      return {
        shouldOverride: true,
        recommendedTier: pattern.preferredTier,
        reason: `Historical data shows ${pattern.preferredTier} performs well for ${stepType} steps (${(pattern.successRate * 100).toFixed(0)}% success, ${pattern.costSavings.toFixed(0)}% savings)`,
        confidence: this.mapConfidence(pattern.confidence),
        historicalData: {
          totalRuns: pattern.totalRuns || 0,
          successRate: pattern.successRate,
          avgTokens: pattern.avgTokens,
          estimatedSavings: pattern.costSavings * 0.01 // Rough estimate
        }
      };
    } catch (err) {
      console.error('❌ [RoutingMemory] Failed to get recommendation:', err);
      return null;
    }
  }

  /**
   * Get routing pattern for an agent/step type
   */
  private async getRoutingPattern(
    agentId: string,
    stepType: string
  ): Promise<RoutingPattern | null> {
    try {
      // Query routing history for this agent/step type
      const { data, error } = await this.supabase
        .from('pilot_step_routing_history')
        .select('*')
        .eq('agent_id', agentId)
        .eq('step_type', stepType)
        .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()) // Last 30 days
        .order('created_at', { ascending: false });

      if (error || !data || data.length === 0) {
        return null;
      }

      // Analyze performance by tier
      const tierStats = this.analyzeTierPerformance(data);

      // Find the best performing tier
      const bestTier = this.selectBestTier(tierStats);

      return {
        agentId,
        stepType,
        preferredTier: bestTier.tier,
        confidence: bestTier.confidence,
        successRate: bestTier.successRate,
        avgTokens: bestTier.avgTokens,
        avgExecutionTime: bestTier.avgExecutionTime,
        avgCostUsd: bestTier.avgCost,
        totalExecutions: data.length,
        lastUpdated: new Date()
      };
    } catch (err) {
      console.error('❌ [RoutingMemory] Failed to get routing pattern:', err);
      return null;
    }
  }

  /**
   * Analyze performance by tier
   */
  private analyzeTierPerformance(history: any[]): Map<string, any> {
    const tierStats = new Map();

    for (const tier of ['tier1', 'tier2', 'tier3']) {
      const tierData = history.filter(h => h.selected_tier === tier);

      if (tierData.length === 0) {
        continue;
      }

      const successful = tierData.filter(h => h.success).length;
      const totalTokens = tierData.reduce((sum, h) => sum + (h.tokens_used || 0), 0);
      const totalTime = tierData.reduce((sum, h) => sum + (h.execution_time_ms || 0), 0);
      const totalCost = tierData.reduce((sum, h) => sum + (h.estimated_cost_usd || 0), 0);

      tierStats.set(tier, {
        tier,
        count: tierData.length,
        successRate: successful / tierData.length,
        avgTokens: totalTokens / tierData.length,
        avgExecutionTime: totalTime / tierData.length,
        avgCost: totalCost / tierData.length,
        confidence: Math.min(tierData.length / 10, 1) // Confidence increases with sample size (max 10 runs)
      });
    }

    return tierStats;
  }

  /**
   * Select the best performing tier
   */
  private selectBestTier(tierStats: Map<string, any>): any {
    let best = { tier: 'tier3', successRate: 0, avgTokens: Infinity, avgExecutionTime: Infinity, avgCost: Infinity, confidence: 0 };

    for (const [tier, stats] of tierStats.entries()) {
      // Only consider tiers with good success rate
      if (stats.successRate < 0.85) continue;

      // Prefer lower tiers if they have good success rate
      // Score = successRate * (1 / avgCost) * confidence
      const currentScore = best.successRate * (1 / (best.avgCost + 0.0001)) * best.confidence;
      const newScore = stats.successRate * (1 / (stats.avgCost + 0.0001)) * stats.confidence;

      if (newScore > currentScore) {
        best = stats;
      }
    }

    return best;
  }

  /**
   * Update pattern with new execution data
   */
  private updatePattern(
    existing: RoutingPattern | null,
    newData: {
      selectedTier: 'tier1' | 'tier2' | 'tier3';
      success: boolean;
      tokensUsed: number;
      executionTimeMs: number;
      costUsd: number;
    }
  ): RoutingPattern {
    if (!existing) {
      return {
        agentId: '',
        stepType: '',
        preferredTier: newData.selectedTier,
        confidence: 0.1, // Low initial confidence
        successRate: newData.success ? 1 : 0,
        avgTokens: newData.tokensUsed,
        avgExecutionTime: newData.executionTimeMs,
        avgCostUsd: newData.costUsd,
        totalExecutions: 1,
        lastUpdated: new Date()
      };
    }

    // Update with exponential moving average
    const alpha = 0.3; // Weight for new data
    return {
      ...existing,
      successRate: existing.successRate * (1 - alpha) + (newData.success ? 1 : 0) * alpha,
      avgTokens: existing.avgTokens * (1 - alpha) + newData.tokensUsed * alpha,
      avgExecutionTime: existing.avgExecutionTime * (1 - alpha) + newData.executionTimeMs * alpha,
      avgCostUsd: existing.avgCostUsd * (1 - alpha) + newData.costUsd * alpha,
      totalExecutions: existing.totalExecutions + 1,
      confidence: Math.min(existing.totalExecutions / 10, 1),
      lastUpdated: new Date()
    };
  }

  /**
   * Store routing pattern as agent memory
   */
  private async storeRoutingMemory(
    agentId: string,
    userId: string,
    stepType: string,
    pattern: RoutingPattern
  ): Promise<void> {
    // Calculate cost savings vs always using tier3
    const tier3Cost = 0.005; // Rough estimate: $5 per 1M tokens
    const currentCost = pattern.avgCostUsd;
    const costSavingsPercent = ((tier3Cost - currentCost) / tier3Cost) * 100;

    const memoryValue = {
      stepType,
      preferredTier: pattern.preferredTier,
      successRate: pattern.successRate,
      avgTokens: pattern.avgTokens,
      costSavings: Math.max(0, costSavingsPercent),
      totalRuns: pattern.totalExecutions,
      recommendation: `Use ${pattern.preferredTier} for ${stepType} steps (${(pattern.successRate * 100).toFixed(0)}% success)`,
      confidence: pattern.confidence >= 0.8 ? 'high' : pattern.confidence >= 0.5 ? 'medium' : 'low'
    };

    // Upsert to agent_memories table
    const { error } = await this.supabase
      .from('agent_memories')
      .upsert({
        agent_id: agentId,
        user_id: userId,
        memory_type: 'routing_pattern',
        memory_key: `routing_${stepType}`,
        memory_value: JSON.stringify(memoryValue),
        importance: Math.floor(pattern.confidence * 10), // 0-10 based on confidence
        last_used_at: new Date().toISOString(),
        usage_count: pattern.totalExecutions
      }, {
        onConflict: 'agent_id,memory_key'
      });

    if (error) {
      console.error('❌ [RoutingMemory] Failed to store memory:', error);
    } else {
      console.log(`💾 [RoutingMemory] Stored memory for ${stepType}: prefer ${pattern.preferredTier}`);
    }
  }

  /**
   * Determine if memory should override complexity-based decision
   */
  private shouldOverrideBasedOnMemory(pattern: any, calculatedComplexity: number): boolean {
    // High confidence + good success rate = override
    if (pattern.confidence === 'high' && pattern.successRate > 0.9) {
      return true;
    }

    // Medium confidence with excellent success rate = override
    if (pattern.confidence === 'medium' && pattern.successRate > 0.95) {
      return true;
    }

    // Don't override if low confidence or poor success rate
    return false;
  }

  /**
   * Map string confidence to numeric
   */
  private mapConfidence(confidence: string): number {
    switch (confidence) {
      case 'high': return 0.9;
      case 'medium': return 0.7;
      case 'low': return 0.4;
      default: return 0.5;
    }
  }

  /**
   * Get routing insights for memory injection
   * Returns formatted text to inject into agent context
   */
  async getRoutingInsights(agentId: string): Promise<string> {
    try {
      const { data: memories, error } = await this.supabase
        .from('agent_memories')
        .select('*')
        .eq('agent_id', agentId)
        .eq('memory_type', 'routing_pattern')
        .gte('importance', 5) // Only high-importance patterns
        .order('importance', { ascending: false })
        .limit(5);

      if (error || !memories || memories.length === 0) {
        return '';
      }

      const insights = memories.map((m: any) => {
        const pattern = JSON.parse(m.memory_value);
        return `- ${pattern.stepType}: ${pattern.recommendation}`;
      }).join('\n');

      return `## Learned Routing Patterns:\n${insights}\n`;
    } catch (err) {
      console.error('❌ [RoutingMemory] Failed to get routing insights:', err);
      return '';
    }
  }
}
