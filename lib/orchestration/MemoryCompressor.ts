/**
 * MemoryCompressor
 *
 * Integrates CompressionService with Memory system
 * Compresses memory context to fit within token budgets while preserving key information
 *
 * Integration points:
 * - MemoryInjector: Compress formatted memory context before injection
 * - MemorySummarizer: Compress summaries for storage
 */

import { supabase as defaultSupabase } from '@/lib/supabaseClient';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CompressionService } from './CompressionService';
import type { CompressionPolicy, CompressionResult } from './types';

export interface MemoryCompressionConfig {
  enabled: boolean;
  targetRatio: number; // Target compression ratio (0.3 = 30% reduction)
  minQualityScore: number; // Minimum quality threshold
  preserveUserContext: boolean; // Always preserve user context
  preserveRecentRuns: number; // Number of recent runs to never compress
  strategy: 'semantic' | 'structural' | 'template' | 'none';
}

export interface CompressedMemoryContext {
  original: string;
  compressed: string;
  compressionResult: CompressionResult;
  tokensSaved: number;
  preservedSections: string[];
}

export class MemoryCompressor {
  private supabase: SupabaseClient;
  private compressionService: CompressionService;
  private config: MemoryCompressionConfig | null = null;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || defaultSupabase;
    this.compressionService = new CompressionService(this.supabase);
  }

  /**
   * Compress memory context for injection
   * Main entry point for memory compression
   */
  async compressMemoryContext(
    memoryContext: string,
    targetTokens?: number
  ): Promise<CompressedMemoryContext> {
    console.log('[MemoryCompressor] Starting memory context compression');

    try {
      // Load configuration
      const config = await this.loadConfig();

      // If compression disabled, return original
      if (!config.enabled) {
        return {
          original: memoryContext,
          compressed: memoryContext,
          compressionResult: {
            original: memoryContext,
            compressed: memoryContext,
            originalTokens: this.estimateTokens(memoryContext),
            compressedTokens: this.estimateTokens(memoryContext),
            ratio: 1.0,
            qualityScore: 1.0,
            strategy: 'none',
          },
          tokensSaved: 0,
          preservedSections: [],
        };
      }

      // Parse memory context into sections
      const sections = this.parseMemorySections(memoryContext);

      // Identify sections to preserve
      const preservedSections: string[] = [];
      let sectionsToCompress: string[] = [];

      // Always preserve user context if configured
      if (config.preserveUserContext && sections.userContext) {
        preservedSections.push(sections.userContext);
      } else if (sections.userContext) {
        sectionsToCompress.push(sections.userContext);
      }

      // Preserve configured number of recent runs
      if (sections.recentRuns && sections.recentRuns.length > 0) {
        const toPreserve = sections.recentRuns.slice(0, config.preserveRecentRuns);
        const toCompress = sections.recentRuns.slice(config.preserveRecentRuns);

        if (toPreserve.length > 0) {
          preservedSections.push(toPreserve.join('\n'));
        }
        if (toCompress.length > 0) {
          sectionsToCompress.push(toCompress.join('\n'));
        }
      }

      // Add remaining sections to compression
      if (sections.patterns) {
        sectionsToCompress.push(sections.patterns);
      }

      // Compress the compressible sections
      const contentToCompress = sectionsToCompress.join('\n\n');

      if (!contentToCompress || contentToCompress.trim().length === 0) {
        // Nothing to compress, return original
        return {
          original: memoryContext,
          compressed: memoryContext,
          compressionResult: {
            original: memoryContext,
            compressed: memoryContext,
            originalTokens: this.estimateTokens(memoryContext),
            compressedTokens: this.estimateTokens(memoryContext),
            ratio: 1.0,
            qualityScore: 1.0,
            strategy: 'none',
          },
          tokensSaved: 0,
          preservedSections: preservedSections,
        };
      }

      // Create compression policy
      const policy: CompressionPolicy = {
        enabled: true,
        strategy: config.strategy,
        targetRatio: targetTokens
          ? this.calculateTargetRatio(contentToCompress, targetTokens, preservedSections)
          : config.targetRatio,
        minQualityScore: config.minQualityScore,
        aggressiveness: 'medium',
      };

      console.log(
        `[MemoryCompressor] Compressing ${this.estimateTokens(contentToCompress)} tokens ` +
        `(target ratio: ${(policy.targetRatio * 100).toFixed(0)}%)`
      );

      // Compress content
      const compressionResult = await this.compressionService.compress(
        contentToCompress,
        policy,
        'summarize' // Memory is essentially summarization
      );

      // Reconstruct compressed memory context
      const compressedContext = this.reconstructMemoryContext(
        preservedSections,
        compressionResult.compressed,
        sections
      );

      const tokensSaved =
        this.estimateTokens(memoryContext) - this.estimateTokens(compressedContext);

      console.log(
        `[MemoryCompressor] Compression complete: ${tokensSaved} tokens saved ` +
        `(${((tokensSaved / this.estimateTokens(memoryContext)) * 100).toFixed(1)}% reduction)`
      );

      return {
        original: memoryContext,
        compressed: compressedContext,
        compressionResult,
        tokensSaved,
        preservedSections: preservedSections,
      };
    } catch (error) {
      console.error('[MemoryCompressor] Error during compression:', error);
      // Return original on error
      return {
        original: memoryContext,
        compressed: memoryContext,
        compressionResult: {
          original: memoryContext,
          compressed: memoryContext,
          originalTokens: this.estimateTokens(memoryContext),
          compressedTokens: this.estimateTokens(memoryContext),
          ratio: 1.0,
          qualityScore: 1.0,
          strategy: 'none',
          metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
        },
        tokensSaved: 0,
        preservedSections: [],
      };
    }
  }

  /**
   * Compress memory summary for storage
   * Used by MemorySummarizer
   */
  async compressSummary(
    summary: string,
    maxTokens: number = 500
  ): Promise<CompressionResult> {
    const config = await this.loadConfig();

    const policy: CompressionPolicy = {
      enabled: config.enabled,
      strategy: 'semantic', // Always use semantic for summaries
      targetRatio: this.calculateTargetRatioForSummary(summary, maxTokens),
      minQualityScore: 0.85, // High quality for summaries
      aggressiveness: 'medium',
    };

    return await this.compressionService.compress(summary, policy, 'summarize');
  }

  /**
   * Parse memory context into sections
   */
  private parseMemorySections(memoryContext: string): {
    userContext?: string;
    recentRuns?: string[];
    patterns?: string;
  } {
    const sections: any = {};

    // Split by section headers
    const userContextMatch = memoryContext.match(
      /👤 USER PROFILE:([\s\S]*?)(?=📊|🎯|$)/
    );
    if (userContextMatch) {
      sections.userContext = userContextMatch[0];
    }

    const recentRunsMatch = memoryContext.match(
      /📊 RECENT HISTORY:([\s\S]*?)(?=🎯|$)/
    );
    if (recentRunsMatch) {
      // Split individual runs
      const runsText = recentRunsMatch[1];
      const runLines = runsText.split(/(?=  [✅❌➖⚠️])/);
      sections.recentRuns = runLines.filter((line) => line.trim().length > 0);
    }

    const patternsMatch = memoryContext.match(/🎯 LEARNED PATTERNS:([\s\S]*?)$/);
    if (patternsMatch) {
      sections.patterns = patternsMatch[0];
    }

    return sections;
  }

  /**
   * Reconstruct memory context from compressed sections
   */
  private reconstructMemoryContext(
    preservedSections: string[],
    compressedContent: string,
    originalSections: any
  ): string {
    let reconstructed = '\n--- 🧠 AGENT MEMORY CONTEXT (Compressed) ---\n\n';

    // Add preserved sections first
    if (preservedSections.length > 0) {
      reconstructed += preservedSections.join('\n\n') + '\n\n';
    }

    // Add compressed content
    if (compressedContent && compressedContent.trim().length > 0) {
      // If compressed content doesn't have section headers, add a generic one
      if (!compressedContent.includes('📊') && !compressedContent.includes('🎯')) {
        reconstructed += '📝 ADDITIONAL CONTEXT:\n';
      }
      reconstructed += compressedContent;
    }

    reconstructed += '\n\n--- END MEMORY CONTEXT ---\n';

    return reconstructed;
  }

  /**
   * Calculate target compression ratio based on desired token count
   */
  private calculateTargetRatio(
    content: string,
    targetTokens: number,
    preservedSections: string[]
  ): number {
    const contentTokens = this.estimateTokens(content);
    const preservedTokens = preservedSections.reduce(
      (sum, section) => sum + this.estimateTokens(section),
      0
    );

    const availableTokens = Math.max(0, targetTokens - preservedTokens);
    const ratio = Math.max(0.1, Math.min(0.9, 1 - availableTokens / contentTokens));

    return ratio;
  }

  /**
   * Calculate target ratio for summary compression
   */
  private calculateTargetRatioForSummary(summary: string, maxTokens: number): number {
    const currentTokens = this.estimateTokens(summary);
    if (currentTokens <= maxTokens) {
      return 0.1; // Minimal compression needed
    }

    const ratio = 1 - maxTokens / currentTokens;
    return Math.max(0.1, Math.min(0.9, ratio));
  }

  /**
   * Estimate token count (rough approximation)
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Load compression configuration from database
   */
  private async loadConfig(): Promise<MemoryCompressionConfig> {
    // Check cache
    if (this.config) {
      return this.config;
    }

    try {
      const { data, error } = await this.supabase
        .from('system_settings_config')
        .select('key, value')
        .in('key', [
          'orchestration_compression_enabled',
          'orchestration_compression_memory_target_ratio',
          'orchestration_compression_memory_min_quality',
          'orchestration_compression_memory_preserve_user',
          'orchestration_compression_memory_preserve_runs',
          'orchestration_compression_memory_strategy',
        ]);

      if (error || !data) {
        console.warn(
          '[MemoryCompressor] Failed to load config from database, using defaults'
        );
        return this.getDefaultConfig();
      }

      // Parse configuration
      const config: Record<string, any> = {};
      data.forEach((item) => {
        config[item.key] = item.value;
      });

      this.config = {
        enabled: config['orchestration_compression_enabled'] === true,
        targetRatio: parseFloat(
          config['orchestration_compression_memory_target_ratio'] || '0.3'
        ),
        minQualityScore: parseFloat(
          config['orchestration_compression_memory_min_quality'] || '0.8'
        ),
        preserveUserContext:
          config['orchestration_compression_memory_preserve_user'] !== false,
        preserveRecentRuns: parseInt(
          config['orchestration_compression_memory_preserve_runs'] || '2'
        ),
        strategy:
          (config['orchestration_compression_memory_strategy'] as any) || 'semantic',
      };

      console.log('[MemoryCompressor] Configuration loaded:', this.config);

      return this.config;
    } catch (error) {
      console.error('[MemoryCompressor] Error loading config:', error);
      return this.getDefaultConfig();
    }
  }

  /**
   * Get default configuration
   */
  private getDefaultConfig(): MemoryCompressionConfig {
    return {
      enabled: false, // Disabled by default
      targetRatio: 0.3, // 30% reduction
      minQualityScore: 0.8,
      preserveUserContext: true,
      preserveRecentRuns: 2, // Preserve 2 most recent runs
      strategy: 'semantic',
    };
  }

  /**
   * Clear configuration cache
   */
  clearCache(): void {
    this.config = null;
    this.compressionService.clearCache();
  }

  /**
   * Reload configuration from database
   */
  async reloadConfig(): Promise<void> {
    this.clearCache();
    await this.loadConfig();
  }
}

/**
 * Singleton instance for convenient access
 */
export const memoryCompressor = new MemoryCompressor();
