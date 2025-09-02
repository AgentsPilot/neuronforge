// /lib/intelligence/analysis/IntentAnalyzer.ts
import { SmartIntentAnalysis, ContextualMemory } from '../core/types'
import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

export class IntentAnalyzer {
  async analyzeIntent(
    query: string, 
    inputVariables: Record<string, any>, 
    userContext: ContextualMemory
  ): Promise<SmartIntentAnalysis> {
    
    const analysisPrompt = `You are an expert intent analyzer. Analyze the user's request and provide a structured analysis.

User Request: "${query}"
Available Input Variables: ${JSON.stringify(Object.keys(inputVariables), null, 2)}
User Context: ${JSON.stringify({
  domains: Object.keys(userContext.domainKnowledge || {}),
  recentPatterns: userContext.executionHistory?.slice(-3)?.map(h => h.intent) || []
}, null, 2)}

Analyze and return a JSON object with:
{
  "primaryIntent": "string - main action (retrieve, analyze, transform, monitor, communicate, extract, summarize, etc.)",
  "dataSource": "string - what data to work with (emails, documents, web, database, files, etc.)",
  "actionType": "string - type of processing (filter, aggregate, compare, extract, generate, validate, etc.)",
  "outputExpectation": "string - expected result format (summary, report, data, alert, communication, etc.)",
  "scope": "string - data scope (all, recent, filtered, specific, etc.)",
  "urgency": "low|medium|high|critical - based on language used",
  "complexity": "simple|moderate|complex|expert - based on requirements",
  "timeframe": "string - any time constraints mentioned (daily, weekly, real-time, etc.)",
  "businessContext": "string - domain context (financial, sales, operations, general, etc.)",
  "requiredCapabilities": ["array of needed capabilities like data_processing, text_analysis, etc."],
  "confidence": "number 0-1 - confidence in analysis"
}

Be specific and avoid generic classifications. Extract the actual intent from the user's words.`

    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: analysisPrompt }],
        temperature: 0.1,
        max_tokens: 1000
      })

      const content = response.choices[0]?.message?.content || '{}'
      const llmAnalysis = this.parseJSONSafely(content)
      
      return this.buildSmartIntentAnalysis(llmAnalysis, query, inputVariables)
      
    } catch (error) {
      console.error('LLM intent analysis failed, using fallback:', error)
      return this.buildFallbackAnalysis(query, inputVariables, userContext)
    }
  }

  private parseJSONSafely(content: string): any {
    try {
      // Try to extract JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0])
      }
      return {}
    } catch (error) {
      console.error('Failed to parse LLM JSON response:', error)
      return {}
    }
  }

  private buildSmartIntentAnalysis(
    llmAnalysis: any, 
    query: string, 
    inputVariables: Record<string, any>
  ): SmartIntentAnalysis {
    
    // Map LLM analysis to our interface
    return {
      primaryIntent: llmAnalysis.primaryIntent || this.inferPrimaryIntent(query),
      subIntents: this.extractSubIntents(llmAnalysis, query),
      urgency: llmAnalysis.urgency || 'medium',
      complexity: llmAnalysis.complexity || this.assessComplexity(query, inputVariables),
      businessContext: llmAnalysis.businessContext || 'general',
      requiredCapabilities: llmAnalysis.requiredCapabilities || this.inferCapabilities(llmAnalysis),
      dataRequirements: this.inferDataRequirements(llmAnalysis, inputVariables),
      expectedOutputFormat: this.mapOutputFormat(llmAnalysis.outputExpectation),
      qualityThreshold: this.calculateQualityThreshold(llmAnalysis.complexity || 'moderate', llmAnalysis.urgency || 'medium'),
      confidenceLevel: llmAnalysis.confidence || 0.7,
      // Additional fields for universal handling
      dataSource: llmAnalysis.dataSource || 'unknown',
      actionType: llmAnalysis.actionType || 'analyze',
      scope: llmAnalysis.scope || 'all',
      timeframe: llmAnalysis.timeframe || null
    }
  }

  private extractSubIntents(llmAnalysis: any, query: string): string[] {
    const subIntents = []
    
    // Only use LLM analysis - no hardcoded patterns
    if (llmAnalysis.actionType) subIntents.push(llmAnalysis.actionType)
    if (llmAnalysis.scope && llmAnalysis.scope !== 'all') subIntents.push(llmAnalysis.scope)
    if (llmAnalysis.timeframe) subIntents.push('time_bounded')
    
    return [...new Set(subIntents)]
  }

  private inferPrimaryIntent(query: string): string {
    // Pure fallback - let LLM handle all classification
    return 'general_request'
  }

  private assessComplexity(query: string, inputVariables: Record<string, any>): 'simple' | 'moderate' | 'complex' | 'expert' {
    let score = 0
    
    if (query.length > 200) score += 1
    if ((query.match(/\b(and|or|but|however|then|after)\b/gi) || []).length > 2) score += 1
    if (Object.keys(inputVariables).length > 5) score += 1
    if (/\b(analyze|complex|detailed|comprehensive|advanced)\b/i.test(query)) score += 2
    if (query.split(' ').length > 20) score += 1
    
    if (score <= 1) return 'simple'
    if (score <= 3) return 'moderate'
    if (score <= 5) return 'complex'
    return 'expert'
  }

  private inferCapabilities(llmAnalysis: any): string[] {
    // Only use LLM analysis - no hardcoded mappings
    return llmAnalysis.requiredCapabilities || ['data_processing']
  }

  private inferDataRequirements(llmAnalysis: any, inputVariables: Record<string, any>): string[] {
    const requirements = []
    
    if (llmAnalysis.dataSource) requirements.push(llmAnalysis.dataSource)
    if (llmAnalysis.timeframe) requirements.push('temporal_data')
    if (Object.keys(inputVariables).some(k => k.includes('file'))) requirements.push('file_content')
    if (llmAnalysis.actionType === 'compare') requirements.push('comparative_data')
    
    return requirements
  }

  private mapOutputFormat(outputExpectation: string): string {
    const formatMap: Record<string, string> = {
      'summary': 'executive_summary',
      'report': 'detailed_report',
      'data': 'structured_data',
      'alert': 'notification',
      'communication': 'email_draft',
      'list': 'structured_list',
      'table': 'tabular_data'
    }
    
    return formatMap[outputExpectation] || 'structured_analysis'
  }

  private calculateQualityThreshold(complexity: string, urgency: string): number {
    const complexityScore = { simple: 0.7, moderate: 0.8, complex: 0.85, expert: 0.9 }
    const urgencyScore = { low: 0.7, medium: 0.8, high: 0.85, critical: 0.9 }
    
    return Math.max(complexityScore[complexity], urgencyScore[urgency])
  }

  private buildFallbackAnalysis(
    query: string, 
    inputVariables: Record<string, any>, 
    userContext: ContextualMemory
  ): SmartIntentAnalysis {
    return {
      primaryIntent: this.inferPrimaryIntent(query),
      subIntents: ['fallback_analysis'],
      urgency: 'medium',
      complexity: this.assessComplexity(query, inputVariables),
      businessContext: 'general',
      requiredCapabilities: ['data_processing', 'text_analysis'],
      dataRequirements: ['user_input'],
      expectedOutputFormat: 'structured_analysis',
      qualityThreshold: 0.8,
      confidenceLevel: 0.6,
      dataSource: 'unknown',
      actionType: 'analyze',
      scope: 'all',
      timeframe: null
    }
  }
}