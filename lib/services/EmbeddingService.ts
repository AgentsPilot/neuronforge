/**
 * EmbeddingService
 *
 * Generates vector embeddings for text using OpenAI's embedding models.
 * Supports caching, batch processing, and cost tracking.
 *
 * Features:
 * - Automatic text normalization
 * - Cost estimation and tracking
 * - Batch processing for multiple texts
 * - Integration with SystemConfigService for dynamic model selection
 */

import OpenAI from 'openai'
import { SupabaseClient } from '@supabase/supabase-js'
import { SystemConfigService } from './SystemConfigService'

interface EmbeddingResult {
  embedding: number[]
  tokens: number
  cost: number
  model: string
}

interface BatchEmbeddingResult {
  embeddings: number[][]
  totalTokens: number
  totalCost: number
  model: string
}

export class EmbeddingService {
  private openai: OpenAI
  private supabase: SupabaseClient

  constructor(apiKey: string, supabase: SupabaseClient) {
    this.openai = new OpenAI({ apiKey })
    this.supabase = supabase
  }

  /**
   * Normalize text before embedding generation
   * - Lowercase
   * - Remove extra whitespace
   * - Trim
   */
  private normalizeText(text: string): string {
    return text
      .toLowerCase()
      .replace(/\s+/g, ' ') // Replace multiple spaces with single space
      .trim()
  }

  /**
   * Estimate token count for text (rough approximation)
   * OpenAI's actual tokenizer is more accurate, but this is good enough for cost estimation
   */
  private estimateTokens(text: string): number {
    // Rough estimate: ~4 characters per token
    return Math.ceil(text.length / 4)
  }

  /**
   * Calculate embedding cost based on model and tokens
   */
  private async calculateCost(tokens: number): Promise<number> {
    const costPer1kTokens = await SystemConfigService.getNumber(
      this.supabase,
      'helpbot_embedding_cost_per_1k_tokens',
      0.00002 // Default: OpenAI text-embedding-3-small pricing
    )
    return (tokens / 1000) * costPer1kTokens
  }

  /**
   * Generate embedding for a single text
   */
  async generateEmbedding(text: string): Promise<EmbeddingResult> {
    const normalizedText = this.normalizeText(text)

    // Get model from config
    const model = await SystemConfigService.getString(
      this.supabase,
      'helpbot_embedding_model',
      'text-embedding-3-small'
    )

    try {
      const response = await this.openai.embeddings.create({
        model,
        input: normalizedText,
        encoding_format: 'float',
      })

      const embedding = response.data[0].embedding
      const tokens = response.usage.total_tokens
      const cost = await this.calculateCost(tokens)

      return {
        embedding,
        tokens,
        cost,
        model,
      }
    } catch (error: any) {
      console.error('[EmbeddingService] Error generating embedding:', error)
      throw new Error(`Failed to generate embedding: ${error.message}`)
    }
  }

  /**
   * Generate embeddings for multiple texts in batch
   * More efficient than calling generateEmbedding() multiple times
   */
  async generateBatchEmbeddings(texts: string[]): Promise<BatchEmbeddingResult> {
    if (texts.length === 0) {
      return {
        embeddings: [],
        totalTokens: 0,
        totalCost: 0,
        model: '',
      }
    }

    const normalizedTexts = texts.map((text) => this.normalizeText(text))

    // Get model from config
    const model = await SystemConfigService.getString(
      this.supabase,
      'helpbot_embedding_model',
      'text-embedding-3-small'
    )

    try {
      const response = await this.openai.embeddings.create({
        model,
        input: normalizedTexts,
        encoding_format: 'float',
      })

      const embeddings = response.data.map((item) => item.embedding)
      const totalTokens = response.usage.total_tokens
      const totalCost = await this.calculateCost(totalTokens)

      return {
        embeddings,
        totalTokens,
        totalCost,
        model,
      }
    } catch (error: any) {
      console.error('[EmbeddingService] Error generating batch embeddings:', error)
      throw new Error(`Failed to generate batch embeddings: ${error.message}`)
    }
  }

  /**
   * Generate embedding and update support_cache row
   */
  async generateAndStoreCacheEmbedding(cacheId: string): Promise<void> {
    try {
      // Fetch the cache entry
      const { data: cacheEntry, error: fetchError } = await this.supabase
        .from('support_cache')
        .select('question')
        .eq('id', cacheId)
        .single()

      if (fetchError || !cacheEntry) {
        throw new Error(`Cache entry not found: ${cacheId}`)
      }

      // Generate embedding
      const result = await this.generateEmbedding(cacheEntry.question)

      // Update the cache entry with embedding
      const { error: updateError } = await this.supabase
        .from('support_cache')
        .update({ embedding: result.embedding })
        .eq('id', cacheId)

      if (updateError) {
        throw new Error(`Failed to update cache embedding: ${updateError.message}`)
      }

      console.log(`[EmbeddingService] Generated embedding for cache ${cacheId} (${result.tokens} tokens, $${result.cost.toFixed(6)})`)
    } catch (error: any) {
      console.error('[EmbeddingService] Error in generateAndStoreCacheEmbedding:', error)
      throw error
    }
  }

  /**
   * Generate embedding and update help_articles row
   */
  async generateAndStoreFAQEmbedding(articleId: number): Promise<void> {
    try {
      // Fetch the FAQ article
      const { data: article, error: fetchError } = await this.supabase
        .from('help_articles')
        .select('topic, body')
        .eq('id', articleId)
        .single()

      if (fetchError || !article) {
        throw new Error(`FAQ article not found: ${articleId}`)
      }

      // Combine topic and body for embedding
      const textToEmbed = `${article.topic}\n\n${article.body}`

      // Generate embedding
      const result = await this.generateEmbedding(textToEmbed)

      // Update the article with embedding
      const { error: updateError } = await this.supabase
        .from('help_articles')
        .update({ embedding: result.embedding })
        .eq('id', articleId)

      if (updateError) {
        throw new Error(`Failed to update FAQ embedding: ${updateError.message}`)
      }

      console.log(`[EmbeddingService] Generated embedding for FAQ ${articleId} (${result.tokens} tokens, $${result.cost.toFixed(6)})`)
    } catch (error: any) {
      console.error('[EmbeddingService] Error in generateAndStoreFAQEmbedding:', error)
      throw error
    }
  }

  /**
   * Backfill embeddings for all support_cache entries without embeddings
   */
  async backfillCacheEmbeddings(limit: number = 100): Promise<{ processed: number; totalCost: number }> {
    try {
      // Fetch cache entries without embeddings
      const { data: cacheEntries, error: fetchError } = await this.supabase
        .from('support_cache')
        .select('id, question')
        .is('embedding', null)
        .limit(limit)

      if (fetchError) {
        throw new Error(`Failed to fetch cache entries: ${fetchError.message}`)
      }

      if (!cacheEntries || cacheEntries.length === 0) {
        console.log('[EmbeddingService] No cache entries need embeddings')
        return { processed: 0, totalCost: 0 }
      }

      console.log(`[EmbeddingService] Backfilling embeddings for ${cacheEntries.length} cache entries...`)

      // Generate embeddings in batch
      const questions = cacheEntries.map((entry) => entry.question)
      const batchResult = await this.generateBatchEmbeddings(questions)

      // Update each cache entry
      for (let i = 0; i < cacheEntries.length; i++) {
        const { error: updateError } = await this.supabase
          .from('support_cache')
          .update({ embedding: batchResult.embeddings[i] })
          .eq('id', cacheEntries[i].id)

        if (updateError) {
          console.error(`[EmbeddingService] Failed to update cache ${cacheEntries[i].id}:`, updateError)
        }
      }

      console.log(`[EmbeddingService] Backfill complete: ${cacheEntries.length} embeddings generated ($${batchResult.totalCost.toFixed(6)})`)

      return {
        processed: cacheEntries.length,
        totalCost: batchResult.totalCost,
      }
    } catch (error: any) {
      console.error('[EmbeddingService] Error in backfillCacheEmbeddings:', error)
      throw error
    }
  }

  /**
   * Backfill embeddings for all help_articles without embeddings
   */
  async backfillFAQEmbeddings(): Promise<{ processed: number; totalCost: number }> {
    try {
      // Fetch FAQ articles without embeddings
      const { data: articles, error: fetchError } = await this.supabase
        .from('help_articles')
        .select('id, topic, body')
        .is('embedding', null)

      if (fetchError) {
        throw new Error(`Failed to fetch FAQ articles: ${fetchError.message}`)
      }

      if (!articles || articles.length === 0) {
        console.log('[EmbeddingService] No FAQ articles need embeddings')
        return { processed: 0, totalCost: 0 }
      }

      console.log(`[EmbeddingService] Backfilling embeddings for ${articles.length} FAQ articles...`)

      // Generate embeddings in batch
      const texts = articles.map((article) => `${article.topic}\n\n${article.body}`)
      const batchResult = await this.generateBatchEmbeddings(texts)

      // Update each article
      for (let i = 0; i < articles.length; i++) {
        const { error: updateError } = await this.supabase
          .from('help_articles')
          .update({ embedding: batchResult.embeddings[i] })
          .eq('id', articles[i].id)

        if (updateError) {
          console.error(`[EmbeddingService] Failed to update FAQ ${articles[i].id}:`, updateError)
        }
      }

      console.log(`[EmbeddingService] Backfill complete: ${articles.length} embeddings generated ($${batchResult.totalCost.toFixed(6)})`)

      return {
        processed: articles.length,
        totalCost: batchResult.totalCost,
      }
    } catch (error: any) {
      console.error('[EmbeddingService] Error in backfillFAQEmbeddings:', error)
      throw error
    }
  }
}
