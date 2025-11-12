/**
 * CompressionService
 *
 * Implements content compression strategies for token optimization:
 * - Semantic: LLM-based summarization preserving meaning
 * - Structural: Remove redundant structure and formatting
 * - Template: Template-based compression for common patterns
 * - Truncate: Simple truncation with smart boundary detection
 *
 * Integrates with Memory system for context compression
 * Configurable via system_settings_config table
 */

import { supabase as defaultSupabase } from '@/lib/supabaseClient';
import type { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import type {
  CompressionPolicy,
  CompressionResult,
  CompressionStrategy,
  IntentType,
  ICompressionService,
} from './types';

// Token estimation (rough approximation: 1 token ≈ 4 characters)
const estimateTokens = (text: string): number => {
  return Math.ceil(text.length / 4);
};

export class CompressionService implements ICompressionService {
  private supabase: SupabaseClient;
  private anthropic: Anthropic;
  private policyCache: Map<IntentType, CompressionPolicy> = new Map();
  private configCache: Map<string, any> = new Map();

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || defaultSupabase;
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }

  /**
   * Compress content using specified policy
   */
  async compress(
    content: string,
    policy: CompressionPolicy,
    intent: IntentType
  ): Promise<CompressionResult> {
    const startTime = Date.now();

    // If compression disabled, return original
    if (!policy.enabled) {
      const tokens = estimateTokens(content);
      return {
        original: content,
        compressed: content,
        originalTokens: tokens,
        compressedTokens: tokens,
        ratio: 1.0,
        qualityScore: 1.0,
        strategy: 'none',
        metadata: { compressionTime: 0 }
      };
    }

    console.log(`[Compression] Compressing ${estimateTokens(content)} tokens with ${policy.strategy} strategy`);

    let result: CompressionResult;

    try {
      switch (policy.strategy) {
        case 'semantic':
          result = await this.semanticCompression(content, policy, intent);
          break;
        case 'structural':
          result = await this.structuralCompression(content, policy);
          break;
        case 'template':
          result = await this.templateCompression(content, policy, intent);
          break;
        case 'truncate':
          result = await this.truncateCompression(content, policy);
          break;
        case 'none':
        default:
          const tokens = estimateTokens(content);
          result = {
            original: content,
            compressed: content,
            originalTokens: tokens,
            compressedTokens: tokens,
            ratio: 1.0,
            qualityScore: 1.0,
            strategy: 'none'
          };
      }

      // Add compression time to metadata
      result.metadata = {
        ...result.metadata,
        compressionTime: Date.now() - startTime
      };

      // Check quality threshold
      if (result.qualityScore < policy.minQualityScore) {
        console.warn(
          `[Compression] Quality score ${result.qualityScore.toFixed(2)} below minimum ${policy.minQualityScore}. Using original.`
        );
        const tokens = estimateTokens(content);
        return {
          original: content,
          compressed: content,
          originalTokens: tokens,
          compressedTokens: tokens,
          ratio: 1.0,
          qualityScore: 1.0,
          strategy: 'none',
          metadata: {
            ...result.metadata,
            qualityCheckFailed: true
          }
        };
      }

      console.log(
        `[Compression] Reduced from ${result.originalTokens} to ${result.compressedTokens} tokens ` +
        `(${(result.ratio * 100).toFixed(1)}% reduction, quality: ${result.qualityScore.toFixed(2)})`
      );

      return result;
    } catch (error) {
      console.error('[Compression] Error during compression:', error);
      // Return original on error
      const tokens = estimateTokens(content);
      return {
        original: content,
        compressed: content,
        originalTokens: tokens,
        compressedTokens: tokens,
        ratio: 1.0,
        qualityScore: 1.0,
        strategy: 'none',
        metadata: {
          error: error instanceof Error ? error.message : 'Unknown error',
          compressionTime: Date.now() - startTime
        }
      };
    }
  }

  /**
   * Get compression policy for specific intent
   */
  async getPolicy(intent: IntentType): Promise<CompressionPolicy> {
    // Check cache
    const cached = this.policyCache.get(intent);
    if (cached) {
      return cached;
    }

    try {
      // Load policy configuration from database
      const { data, error } = await this.supabase
        .from('system_settings_config')
        .select('key, value')
        .in('key', [
          'orchestration_compression_enabled',
          `orchestration_compression_strategy_${intent}`,
          `orchestration_compression_target_ratio_${intent}`,
          `orchestration_compression_min_quality_${intent}`,
          `orchestration_compression_aggressiveness_${intent}`,
        ]);

      if (error || !data) {
        console.warn('[Compression] Failed to load policy from database, using defaults');
        return this.getDefaultPolicy(intent);
      }

      // Parse configuration
      const config: Record<string, any> = {};
      data.forEach((item) => {
        config[item.key] = item.value;
      });

      const enabled = config['orchestration_compression_enabled'] === true;
      const strategy = (config[`orchestration_compression_strategy_${intent}`] || 'semantic') as CompressionStrategy;
      const targetRatio = parseFloat(config[`orchestration_compression_target_ratio_${intent}`] || '0.5');
      const minQualityScore = parseFloat(config[`orchestration_compression_min_quality_${intent}`] || '0.8');
      const aggressiveness = (config[`orchestration_compression_aggressiveness_${intent}`] || 'medium') as 'low' | 'medium' | 'high';

      const policy: CompressionPolicy = {
        enabled,
        strategy,
        targetRatio,
        minQualityScore,
        aggressiveness,
      };

      // Cache policy
      this.policyCache.set(intent, policy);

      return policy;
    } catch (error) {
      console.error('[Compression] Error loading policy:', error);
      return this.getDefaultPolicy(intent);
    }
  }

  /**
   * Semantic compression using LLM summarization
   * Preserves meaning while reducing token count
   */
  private async semanticCompression(
    content: string,
    policy: CompressionPolicy,
    intent: IntentType
  ): Promise<CompressionResult> {
    const originalTokens = estimateTokens(content);
    const targetTokens = Math.floor(originalTokens * (1 - policy.targetRatio));

    try {
      // Build compression prompt based on intent and aggressiveness
      const systemPrompt = this.buildSemanticPrompt(intent, policy.aggressiveness, targetTokens);

      // Use Haiku for fast, cost-effective compression
      const response = await this.anthropic.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: targetTokens + 100, // Allow some buffer
        temperature: 0.3, // Lower temperature for more consistent compression
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: content,
          },
        ],
      });

      const compressed = response.content[0].type === 'text' ? response.content[0].text : content;
      const compressedTokens = estimateTokens(compressed);
      const actualRatio = 1 - (compressedTokens / originalTokens);

      // Estimate quality based on compression ratio and intent
      // More aggressive compression = lower quality score
      const qualityScore = this.estimateSemanticQuality(
        originalTokens,
        compressedTokens,
        policy.targetRatio,
        policy.aggressiveness
      );

      return {
        original: content,
        compressed,
        originalTokens,
        compressedTokens,
        ratio: actualRatio,
        qualityScore,
        strategy: 'semantic',
        metadata: {
          model: 'claude-3-haiku-20240307',
          targetTokens,
          intent,
          aggressiveness: policy.aggressiveness,
        },
      };
    } catch (error) {
      console.error('[Compression] Semantic compression error:', error);
      throw error;
    }
  }

  /**
   * Structural compression by removing redundant structure
   * Removes whitespace, formatting, and structural redundancy
   */
  private async structuralCompression(
    content: string,
    policy: CompressionPolicy
  ): Promise<CompressionResult> {
    const originalTokens = estimateTokens(content);

    let compressed = content;

    // Apply structural optimizations based on aggressiveness
    if (policy.aggressiveness === 'low') {
      // Conservative: only remove excessive whitespace
      compressed = content
        .replace(/\n\n+/g, '\n\n') // Multiple newlines → double newline
        .replace(/  +/g, ' ') // Multiple spaces → single space
        .trim();
    } else if (policy.aggressiveness === 'medium') {
      // Moderate: remove most formatting
      compressed = content
        .replace(/\n\n+/g, '\n') // Multiple newlines → single newline
        .replace(/\n/g, ' ') // Newlines → spaces
        .replace(/  +/g, ' ') // Multiple spaces → single space
        .replace(/([.,!?;:]) /g, '$1 ') // Normalize punctuation spacing
        .trim();
    } else {
      // Aggressive: minimal formatting
      compressed = content
        .replace(/\s+/g, ' ') // All whitespace → single space
        .replace(/([.,!?;:]) /g, '$1') // Remove spaces after punctuation
        .replace(/\s*([{}()\[\]])\s*/g, '$1') // Remove spaces around brackets
        .trim();
    }

    const compressedTokens = estimateTokens(compressed);
    const actualRatio = 1 - (compressedTokens / originalTokens);

    // Quality score: structural compression preserves all content
    // Quality mainly depends on readability (higher aggressiveness = lower readability)
    const qualityScore = policy.aggressiveness === 'low' ? 0.95 :
                         policy.aggressiveness === 'medium' ? 0.85 : 0.75;

    return {
      original: content,
      compressed,
      originalTokens,
      compressedTokens,
      ratio: actualRatio,
      qualityScore,
      strategy: 'structural',
      metadata: {
        aggressiveness: policy.aggressiveness,
      },
    };
  }

  /**
   * Template-based compression for common patterns
   * Uses templates to compress repeated structures
   */
  private async templateCompression(
    content: string,
    policy: CompressionPolicy,
    intent: IntentType
  ): Promise<CompressionResult> {
    const originalTokens = estimateTokens(content);

    let compressed = content;

    // Apply intent-specific template patterns
    switch (intent) {
      case 'extract':
        // Compress data extraction patterns
        compressed = compressed
          .replace(/Extract the following:\s*/gi, 'Extract: ')
          .replace(/Please extract:\s*/gi, 'Extract: ')
          .replace(/I need you to extract:\s*/gi, 'Extract: ')
          .replace(/from the following (data|text|content|source):\s*/gi, 'from: ');
        break;

      case 'summarize':
        // Compress summarization patterns
        compressed = compressed
          .replace(/Please summarize:\s*/gi, 'Summarize: ')
          .replace(/Provide a summary of:\s*/gi, 'Summarize: ')
          .replace(/Can you summarize:\s*/gi, 'Summarize: ')
          .replace(/in (\d+) words or less/gi, '(max $1w)');
        break;

      case 'validate':
        // Compress validation patterns
        compressed = compressed
          .replace(/Please validate:\s*/gi, 'Validate: ')
          .replace(/Check if the following is valid:\s*/gi, 'Validate: ')
          .replace(/according to the following (rules|schema|requirements):\s*/gi, 'per: ');
        break;

      case 'transform':
        // Compress transformation patterns
        compressed = compressed
          .replace(/Transform the following:\s*/gi, 'Transform: ')
          .replace(/Convert the following:\s*/gi, 'Convert: ')
          .replace(/from (\w+) to (\w+)/gi, '$1→$2');
        break;

      case 'conditional':
        // Compress conditional patterns
        compressed = compressed
          .replace(/if and only if/gi, 'iff')
          .replace(/otherwise/gi, 'else')
          .replace(/in the case that/gi, 'if');
        break;
    }

    // Apply common compression patterns
    compressed = compressed
      .replace(/for example/gi, 'e.g.')
      .replace(/such as/gi, 'e.g.')
      .replace(/that is/gi, 'i.e.')
      .replace(/in other words/gi, 'i.e.')
      .replace(/and so on/gi, 'etc.')
      .replace(/et cetera/gi, 'etc.');

    const compressedTokens = estimateTokens(compressed);
    const actualRatio = 1 - (compressedTokens / originalTokens);

    // Quality score: template compression preserves meaning
    const qualityScore = 0.9;

    return {
      original: content,
      compressed,
      originalTokens,
      compressedTokens,
      ratio: actualRatio,
      qualityScore,
      strategy: 'template',
      metadata: {
        intent,
        patternsApplied: originalTokens - compressedTokens,
      },
    };
  }

  /**
   * Truncate compression with smart boundary detection
   * Truncates content while preserving sentence boundaries
   */
  private async truncateCompression(
    content: string,
    policy: CompressionPolicy
  ): Promise<CompressionResult> {
    const originalTokens = estimateTokens(content);
    const targetTokens = Math.floor(originalTokens * (1 - policy.targetRatio));
    const targetChars = targetTokens * 4;

    let compressed = content;

    if (content.length > targetChars) {
      // Find good truncation point (sentence boundary)
      const truncatePoint = this.findTruncationPoint(content, targetChars, policy.aggressiveness);
      compressed = content.substring(0, truncatePoint);

      // Add ellipsis if truncated
      if (compressed.length < content.length) {
        compressed += '...';
      }
    }

    const compressedTokens = estimateTokens(compressed);
    const actualRatio = 1 - (compressedTokens / originalTokens);

    // Quality score: truncation loses information
    // Quality depends on how much was preserved
    const preservedRatio = compressedTokens / originalTokens;
    const qualityScore = Math.min(0.9, preservedRatio * 1.1);

    return {
      original: content,
      compressed,
      originalTokens,
      compressedTokens,
      ratio: actualRatio,
      qualityScore,
      strategy: 'truncate',
      metadata: {
        truncatedChars: content.length - compressed.length,
        preservedRatio,
      },
    };
  }

  /**
   * Build semantic compression prompt based on intent
   */
  private buildSemanticPrompt(intent: IntentType, aggressiveness: string, targetTokens: number): string {
    const intentInstructions = {
      extract: 'Focus on preserving data points, entities, and key facts. Maintain structure.',
      summarize: 'Preserve main ideas and key points. Remove examples and elaborations.',
      generate: 'Keep the core requirements and constraints. Remove verbose explanations.',
      validate: 'Preserve validation rules and criteria. Remove examples.',
      send: 'Keep the core message and recipients. Remove pleasantries if aggressive.',
      transform: 'Preserve transformation logic and mappings. Remove explanations.',
      conditional: 'Keep conditions and logic. Use concise boolean expressions.',
      aggregate: 'Preserve aggregation functions and groupings. Remove explanations.',
      filter: 'Keep filter criteria and conditions. Remove verbose descriptions.',
      enrich: 'Preserve enrichment sources and mappings. Remove examples.',
    };

    const aggressivenessInstructions = {
      low: 'Be conservative. Preserve as much detail as possible while reducing redundancy.',
      medium: 'Balance brevity with completeness. Remove redundancy and verbose explanations.',
      high: 'Be maximally concise. Keep only essential information. Use abbreviations.',
    };

    return `You are a content compression assistant. Compress the following content while preserving its essential meaning and utility.

INTENT: ${intent}
${intentInstructions[intent]}

AGGRESSIVENESS: ${aggressiveness}
${aggressivenessInstructions[aggressiveness]}

TARGET LENGTH: ~${targetTokens} tokens

RULES:
- Preserve all critical information for the task
- Remove redundancy, verbose explanations, and filler words
- Maintain clarity and coherence
- Do not add new information
- Return only the compressed content, no preamble

Compress the following content:`;
  }

  /**
   * Estimate semantic compression quality
   */
  private estimateSemanticQuality(
    originalTokens: number,
    compressedTokens: number,
    targetRatio: number,
    aggressiveness: string
  ): number {
    const actualRatio = 1 - (compressedTokens / originalTokens);
    const targetMet = Math.abs(actualRatio - targetRatio) < 0.1;

    // Base quality on aggressiveness
    let baseQuality = aggressiveness === 'low' ? 0.9 :
                     aggressiveness === 'medium' ? 0.85 : 0.8;

    // Adjust for target ratio achievement
    if (targetMet) {
      baseQuality += 0.05;
    }

    // Penalize excessive compression
    if (actualRatio > targetRatio + 0.2) {
      baseQuality -= 0.1;
    }

    return Math.max(0.5, Math.min(1.0, baseQuality));
  }

  /**
   * Find smart truncation point (sentence boundary)
   */
  private findTruncationPoint(content: string, targetChars: number, aggressiveness: string): number {
    if (aggressiveness === 'high') {
      // High: just truncate at target
      return targetChars;
    }

    // Find sentence boundaries near target
    const searchStart = Math.max(0, targetChars - 100);
    const searchEnd = Math.min(content.length, targetChars + 100);
    const searchRegion = content.substring(searchStart, searchEnd);

    // Look for sentence endings
    const sentenceEndings = ['. ', '! ', '? ', '.\n', '!\n', '?\n'];
    let bestPoint = targetChars;
    let minDistance = Infinity;

    for (const ending of sentenceEndings) {
      let index = searchRegion.lastIndexOf(ending, targetChars - searchStart);
      if (index !== -1) {
        const actualPoint = searchStart + index + ending.length;
        const distance = Math.abs(actualPoint - targetChars);
        if (distance < minDistance) {
          minDistance = distance;
          bestPoint = actualPoint;
        }
      }
    }

    return bestPoint;
  }

  /**
   * Get default policy for intent (fallback when database unavailable)
   */
  private getDefaultPolicy(intent: IntentType): CompressionPolicy {
    // Default policies per intent type
    const defaults: Record<IntentType, Partial<CompressionPolicy>> = {
      extract: { strategy: 'structural', targetRatio: 0.3, aggressiveness: 'low' },
      summarize: { strategy: 'semantic', targetRatio: 0.5, aggressiveness: 'medium' },
      generate: { strategy: 'template', targetRatio: 0.2, aggressiveness: 'low' },
      validate: { strategy: 'structural', targetRatio: 0.3, aggressiveness: 'medium' },
      send: { strategy: 'template', targetRatio: 0.2, aggressiveness: 'low' },
      transform: { strategy: 'structural', targetRatio: 0.3, aggressiveness: 'medium' },
      conditional: { strategy: 'structural', targetRatio: 0.4, aggressiveness: 'high' },
      aggregate: { strategy: 'structural', targetRatio: 0.3, aggressiveness: 'medium' },
      filter: { strategy: 'structural', targetRatio: 0.4, aggressiveness: 'medium' },
      enrich: { strategy: 'structural', targetRatio: 0.3, aggressiveness: 'low' },
    };

    return {
      enabled: false, // Disabled by default
      strategy: defaults[intent].strategy || 'semantic',
      targetRatio: defaults[intent].targetRatio || 0.3,
      minQualityScore: 0.8,
      aggressiveness: defaults[intent].aggressiveness || 'medium',
    };
  }

  /**
   * Clear policy cache (for testing or config reload)
   */
  clearCache(): void {
    this.policyCache.clear();
    this.configCache.clear();
  }

  /**
   * Reload configuration from database
   */
  async reloadConfig(): Promise<void> {
    this.clearCache();
  }
}

/**
 * Singleton instance for convenient access
 */
export const compressionService = new CompressionService();
