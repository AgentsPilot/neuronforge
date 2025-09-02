// /lib/intelligence/memory/LearningModule.ts
import { SmartIntentAnalysis, AdaptiveStrategy, ContextualMemory } from '../core/types'

export class LearningModule {
  async recordExecutionEvent(
    executionId: string,
    agentName: string,
    userPrompt: string,
    strategy: string,
    outcome: {
      success: boolean
      partial: boolean
      pluginsUsed: string[]
      dataQuality: string
      confidenceLevel: number
    },
    metrics: {
      accuracy: number
      speed: number
      reliability: number
      userSatisfaction: number
      resourceEfficiency: number
      adaptability: number
      autonomy_level: number
    }
  ): Promise<void> {
    try {
      console.log(`📚 Recording execution event: ${executionId}`)
      
      const learningRecord = {
        execution_id: executionId,
        agent_name: agentName,
        user_prompt_hash: this.hashPrompt(userPrompt),
        strategy_used: strategy,
        success: outcome.success,
        partial_success: outcome.partial,
        plugins_used: outcome.pluginsUsed,
        data_quality: outcome.dataQuality,
        confidence_level: outcome.confidenceLevel,
        performance_metrics: metrics,
        timestamp: new Date().toISOString()
      }
      
      console.log('Learning record created:', learningRecord)
      
    } catch (error) {
      console.warn('Failed to record learning event:', error)
    }
  }

  async updateAdvancedSystem(
    executionId: string,
    agent: any,
    userPrompt: string,
    intentAnalysis: any,
    strategy: any,
    qualityMetrics: any,
    userContext: any,
    userId: string,
    supabase: any
  ): Promise<void> {
    try {
      console.log('📚 Updating advanced learning system')
      
      // Update user behavior patterns
      await this.updateUserBehaviorPatterns(userId, intentAnalysis, qualityMetrics, supabase)
      
      // Update domain knowledge
      await this.updateDomainKnowledge(userId, intentAnalysis, qualityMetrics, supabase)
      
      // Record strategy effectiveness
      await this.recordStrategyEffectiveness(strategy, qualityMetrics, supabase)
      
      console.log('✅ Learning system updated successfully')
      
    } catch (error) {
      console.warn('⚠️ Learning system update failed:', error)
    }
  }

  private async updateUserBehaviorPatterns(
    userId: string,
    intent: any,
    quality: any,
    supabase: any
  ): Promise<void> {
    try {
      const pattern = {
        user_id: userId,
        pattern_type: intent.primaryIntent || 'general_inquiry',
        frequency: 1,
        success_rate: quality.overallConfidence || 0.8,
        preferred_approach: intent.expectedOutputFormat || 'structured_analysis',
        business_context: intent.businessContext || 'general',
        complexity_level: intent.complexity || 'moderate',
        quality_threshold: intent.qualityThreshold || 0.75,
        common_parameters: {
          urgency: intent.urgency || 'medium',
          capabilities: intent.requiredCapabilities || [],
          data_requirements: intent.dataRequirements || []
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
      
      const { error } = await supabase
        .from('user_behavior_patterns')
        .upsert(pattern, {
          onConflict: 'user_id,pattern_type',
          ignoreDuplicates: false
        })
      
      if (error) {
        console.warn('Pattern update failed:', error)
      }
      
    } catch (error) {
      console.warn('User pattern update error:', error)
    }
  }

  private async updateDomainKnowledge(
    userId: string,
    intent: any,
    quality: any,
    supabase: any
  ): Promise<void> {
    try {
      const knowledge = {
        user_id: userId,
        domain: intent.businessContext || 'general',
        expertise_level: quality.qualityGrade || 'B',
        relevance: quality.qualityMetrics?.relevance || 0.7,
        key_concepts: intent.requiredCapabilities || [],
        business_rules: [],
        data_sources: intent.dataRequirements || [],
        success_indicators: quality.qualityMetrics || {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
      
      const { error } = await supabase
        .from('domain_knowledge')
        .upsert(knowledge, {
          onConflict: 'user_id,domain',
          ignoreDuplicates: false
        })
      
      if (error) {
        console.warn('Domain knowledge update failed:', error)
      }
      
    } catch (error) {
      console.warn('Domain knowledge update error:', error)
    }
  }

  private async recordStrategyEffectiveness(
    strategy: any,
    qualityMetrics: any,
    supabase: any
  ): Promise<void> {
    try {
      const effectiveness = {
        strategy_name: strategy.primaryApproach || 'default_strategy',
        success_rate: qualityMetrics.overallConfidence || 0.8,
        quality_score: qualityMetrics.qualityGrade || 'B',
        fallback_count: strategy.fallbackStrategies?.length || 0,
        optimization_count: strategy.performanceOptimizations?.length || 0,
        timestamp: new Date().toISOString()
      }
      
      console.log('Strategy effectiveness recorded:', effectiveness)
      
    } catch (error) {
      console.warn('Strategy effectiveness recording failed:', error)
    }
  }

  // Generate insights from learning data
  async generateLearningInsights(userId: string, supabase: any): Promise<any> {
    try {
      // Get user patterns
      const { data: patterns } = await supabase
        .from('user_behavior_patterns')
        .select('*')
        .eq('user_id', userId)
      
      // Get domain knowledge
      const { data: domains } = await supabase
        .from('domain_knowledge')
        .select('*')
        .eq('user_id', userId)
      
      return {
        most_common_intents: this.extractTopPatterns(patterns || []),
        domain_expertise: this.assessDomainExpertise(domains || []),
        success_patterns: this.identifySuccessPatterns(patterns || []),
        improvement_areas: this.identifyImprovementAreas(patterns || [])
      }
    } catch (error) {
      console.warn('Failed to generate learning insights:', error)
      return null
    }
  }

  private extractTopPatterns(patterns: any[]): string[] {
    return patterns
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 5)
      .map(p => p.pattern_type)
  }

  private assessDomainExpertise(domains: any[]): Record<string, string> {
    return domains.reduce((acc, domain) => {
      acc[domain.domain] = domain.expertise_level
      return acc
    }, {})
  }

  private identifySuccessPatterns(patterns: any[]): any[] {
    return patterns
      .filter(p => p.success_rate > 0.8)
      .map(p => ({
        pattern: p.pattern_type,
        success_rate: p.success_rate,
        preferred_approach: p.preferred_approach
      }))
  }

  private identifyImprovementAreas(patterns: any[]): string[] {
    return patterns
      .filter(p => p.success_rate < 0.7)
      .map(p => p.pattern_type)
  }

  private hashPrompt(prompt: string): string {
    // Simple hash function for privacy
    let hash = 0
    for (let i = 0; i < prompt.length; i++) {
      const char = prompt.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash
    }
    return hash.toString()
  }
}