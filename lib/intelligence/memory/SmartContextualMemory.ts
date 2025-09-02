// /lib/intelligence/memory/SmartContextualMemory.ts
import { ContextualMemory } from '../core/types'

export class SmartContextualMemory {
  private memory: Map<string, ContextualMemory> = new Map()
  
  async getOrCreateUserContext(userId: string, supabase: any): Promise<ContextualMemory> {
    if (this.memory.has(userId)) {
      return this.memory.get(userId)!
    }
    
    // Load from database or create new
    const context: ContextualMemory = {
      userPatterns: await this.loadUserPatterns(userId, supabase),
      domainKnowledge: await this.loadDomainKnowledge(userId, supabase),
      executionHistory: await this.loadExecutionHistory(userId, supabase),
      preferredStrategies: ['contextual_analysis', 'data_validation', 'adaptive_execution'],
      failurePatterns: [],
      successFactors: []
    }
    
    this.memory.set(userId, context)
    return context
  }
  
  private async loadUserPatterns(userId: string, supabase: any): Promise<Record<string, any>> {
    try {
      const { data: patterns } = await supabase
        .from('user_behavior_patterns')
        .select('*')
        .eq('user_id', userId)
        .limit(50)
      
      return this.analyzePatterns(patterns || [])
    } catch (error) {
      console.warn('Could not load user patterns:', error)
      return {}
    }
  }
  
  private async loadDomainKnowledge(userId: string, supabase: any): Promise<Record<string, any>> {
    try {
      const { data: knowledge } = await supabase
        .from('domain_knowledge')
        .select('*')
        .eq('user_id', userId)
        .order('relevance', { ascending: false })
        .limit(20)
      
      return this.processDomainKnowledge(knowledge || [])
    } catch (error) {
      console.warn('Could not load domain knowledge:', error)
      return {}
    }
  }
  
  private async loadExecutionHistory(userId: string, supabase: any): Promise<any[]> {
    try {
      const { data: history } = await supabase
        .from('agent_execution_history')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(10)
      
      return history || []
    } catch (error) {
      console.warn('Could not load execution history:', error)
      return []
    }
  }
  
  private analyzePatterns(patterns: any[]): Record<string, any> {
    return patterns.reduce((acc, pattern) => {
      acc[pattern.pattern_type] = {
        frequency: pattern.frequency,
        success_rate: pattern.success_rate,
        preferred_approach: pattern.preferred_approach,
        common_parameters: pattern.common_parameters
      }
      return acc
    }, {})
  }
  
  private processDomainKnowledge(knowledge: any[]): Record<string, any> {
    return knowledge.reduce((acc, item) => {
      acc[item.domain] = {
        expertise_level: item.expertise_level,
        key_concepts: item.key_concepts,
        business_rules: item.business_rules,
        data_sources: item.data_sources
      }
      return acc
    }, {})
  }

  // Update user context with new information
  async updateUserContext(userId: string, updates: Partial<ContextualMemory>): Promise<void> {
    const existing = this.memory.get(userId)
    if (existing) {
      this.memory.set(userId, { ...existing, ...updates })
    }
  }

  // Clear user context (for privacy/logout)
  clearUserContext(userId: string): void {
    this.memory.delete(userId)
  }
}