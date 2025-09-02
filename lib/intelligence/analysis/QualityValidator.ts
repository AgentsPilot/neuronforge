// /lib/intelligence/analysis/QualityValidator.ts
import { SmartIntentAnalysis, AdaptiveStrategy, QualityMetrics } from '../core/types'

export class QualityValidator {
  async validateAndAssess(
    response: string,
    pluginContext: Record<string, any>,
    intent: SmartIntentAnalysis,
    strategy: AdaptiveStrategy
  ): Promise<any> {
    console.log('🔍 Validating response quality with advanced metrics')
    
    const qualityMetrics = {
      completeness: await this.assessCompleteness(response, intent),
      accuracy: await this.assessAccuracy(response, pluginContext),
      relevance: await this.assessRelevance(response, intent),
      clarity: await this.assessClarity(response),
      actionability: await this.assessActionability(response, intent),
      businessValue: await this.assessBusinessValue(response, intent)
    }
    
    // Calculate overall confidence
    const weights = {
      completeness: 0.2,
      accuracy: 0.25,
      relevance: 0.2,
      clarity: 0.15,
      actionability: 0.1,
      businessValue: 0.1
    }
    
    const overallConfidence = Object.entries(qualityMetrics).reduce(
      (sum, [metric, score]) => sum + (score * weights[metric]),
      0
    )
    
    // Determine quality grade
    const qualityGrade = this.calculateQualityGrade(overallConfidence)
    
    // Validation status
    const validated = overallConfidence >= intent.qualityThreshold
    
    // Count adaptations applied
    const adaptationsApplied = strategy.performanceOptimizations.length + 
                             (strategy.fallbackStrategies.length > 0 ? 1 : 0)
    
    return {
      qualityMetrics,
      overallConfidence,
      qualityGrade,
      validated,
      adaptationsApplied,
      recommendations: await this.generateQualityRecommendations(qualityMetrics, intent)
    }
  }

  private async assessCompleteness(response: string, intent: SmartIntentAnalysis): Promise<number> {
    let completenessScore = 0.5
    
    // Check if response addresses primary intent
    if (response.toLowerCase().includes(intent.primaryIntent.replace('_', ' '))) {
      completenessScore += 0.2
    }
    
    // Check for sub-intents
    intent.subIntents.forEach(subIntent => {
      if (response.toLowerCase().includes(subIntent.replace('_', ' '))) {
        completenessScore += 0.1
      }
    })
    
    // Check for business context relevance
    if (response.toLowerCase().includes(intent.businessContext)) {
      completenessScore += 0.1
    }
    
    // Length and structure assessment
    if (response.length > 200) completenessScore += 0.05
    if (response.includes('Summary:') || response.includes('Executive Summary')) completenessScore += 0.05
    if (response.includes('Recommendation') || response.includes('Action')) completenessScore += 0.1
    
    return Math.min(completenessScore, 1.0)
  }

  private async assessAccuracy(response: string, pluginContext: Record<string, any>): Promise<number> {
    let accuracyScore = 0.7 // Base assumption of accuracy
    
    // Check if response mentions available data sources
    Object.keys(pluginContext).forEach(plugin => {
      if (!pluginContext[plugin].error && response.toLowerCase().includes(plugin.replace('-', ' '))) {
        accuracyScore += 0.05
      }
    })
    
    // Check for confidence indicators in response
    if (response.includes('confidence') || response.includes('certainty') || response.includes('likely')) {
      accuracyScore += 0.1
    }
    
    // Check for data validation mentions
    if (response.includes('validated') || response.includes('verified') || response.includes('confirmed')) {
      accuracyScore += 0.05
    }
    
    return Math.min(accuracyScore, 1.0)
  }

  private async assessRelevance(response: string, intent: SmartIntentAnalysis): Promise<number> {
    const responseLower = response.toLowerCase()
    let relevanceScore = 0.5
    
    // Check alignment with expected output format
    const formatKeywords = {
      'structured_table': ['table', 'columns', 'rows', 'data'],
      'executive_summary': ['summary', 'overview', 'key points', 'highlights'],
      'detailed_report': ['analysis', 'findings', 'detailed', 'comprehensive'],
      'communication': ['email', 'message', 'contact', 'send']
    }
    
    const expectedFormat = intent.expectedOutputFormat
    if (formatKeywords[expectedFormat]) {
      formatKeywords[expectedFormat].forEach(keyword => {
        if (responseLower.includes(keyword)) relevanceScore += 0.1
      })
    }
    
    // Check for business domain relevance
    const domainKeywords = {
      'finance': ['financial', 'revenue', 'cost', 'budget', 'profit', 'invoice'],
      'sales': ['customer', 'lead', 'deal', 'pipeline', 'conversion'],
      'operations': ['process', 'efficiency', 'workflow', 'productivity']
    }
    
    if (domainKeywords[intent.businessContext]) {
      domainKeywords[intent.businessContext].forEach(keyword => {
        if (responseLower.includes(keyword)) relevanceScore += 0.05
      })
    }
    
    return Math.min(relevanceScore, 1.0)
  }

  private async assessClarity(response: string): Promise<number> {
    let clarityScore = 0.6
    
    // Structure assessment
    const hasHeaders = /^#{1,6}|^\*\*.*\*\*|\d+\.|•/.test(response.split('\n').join('|'))
    if (hasHeaders) clarityScore += 0.1
    
    // Sentence structure
    const sentences = response.split(/[.!?]+/).filter(s => s.trim().length > 10)
    if (sentences.length > 0) {
      const avgSentenceLength = sentences.reduce((sum, s) => sum + s.length, 0) / sentences.length
      
      if (avgSentenceLength > 15 && avgSentenceLength < 150) clarityScore += 0.15
    }
    
    // Professional language indicators
    const professionalTerms = ['analysis', 'recommendation', 'findings', 'assessment', 'evaluation']
    professionalTerms.forEach(term => {
      if (response.toLowerCase().includes(term)) clarityScore += 0.02
    })
    
    // Readability (simple heuristic)
    const readabilityScore = sentences.length > 3 ? 0.1 : 0.05
    clarityScore += readabilityScore
    
    return Math.min(clarityScore, 1.0)
  }

  private async assessActionability(response: string, intent: SmartIntentAnalysis): Promise<number> {
    let actionabilityScore = 0.4
    
    // Action-oriented language
    const actionWords = ['recommend', 'suggest', 'should', 'need to', 'next steps', 'action', 'implement']
    actionWords.forEach(word => {
      if (response.toLowerCase().includes(word)) actionabilityScore += 0.08
    })
    
    // Specific recommendations
    if (response.includes('1.') || response.includes('•') || response.includes('-')) {
      actionabilityScore += 0.1
    }
    
    // Urgency alignment
    if (intent.urgency === 'critical' && response.toLowerCase().includes('immediate')) {
      actionabilityScore += 0.1
    }
    
    return Math.min(actionabilityScore, 1.0)
  }

  private async assessBusinessValue(response: string, intent: SmartIntentAnalysis): Promise<number> {
    let businessValueScore = 0.5
    
    // Business impact indicators
    const businessTerms = ['roi', 'return', 'value', 'benefit', 'impact', 'efficiency', 'cost', 'revenue']
    businessTerms.forEach(term => {
      if (response.toLowerCase().includes(term)) businessValueScore += 0.05
    })
    
    // Quantitative elements
    if (response.match(/\$[\d,]+|\d+%|\d+\.\d+/)) {
      businessValueScore += 0.15
    }
    
    // Strategic thinking
    const strategicTerms = ['strategy', 'opportunity', 'competitive', 'market', 'growth']
    strategicTerms.forEach(term => {
      if (response.toLowerCase().includes(term)) businessValueScore += 0.03
    })
    
    return Math.min(businessValueScore, 1.0)
  }

  private calculateQualityGrade(overallConfidence: number): string {
    if (overallConfidence >= 0.9) return 'A+'
    if (overallConfidence >= 0.85) return 'A'
    if (overallConfidence >= 0.8) return 'B+'
    if (overallConfidence >= 0.75) return 'B'
    if (overallConfidence >= 0.7) return 'C+'
    if (overallConfidence >= 0.65) return 'C'
    return 'D'
  }

  private async generateQualityRecommendations(metrics: QualityMetrics, intent: SmartIntentAnalysis): Promise<string[]> {
    const recommendations = []
    
    if (metrics.completeness < 0.8) {
      recommendations.push('Enhance completeness by addressing all sub-intents')
    }
    
    if (metrics.accuracy < 0.85) {
      recommendations.push('Improve accuracy through better data validation')
    }
    
    if (metrics.actionability < 0.7) {
      recommendations.push('Add more specific, actionable recommendations')
    }
    
    if (metrics.businessValue < 0.7) {
      recommendations.push('Strengthen business impact and ROI considerations')
    }
    
    return recommendations
  }
}