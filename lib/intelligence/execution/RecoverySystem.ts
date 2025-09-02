// /lib/intelligence/execution/RecoverySystem.ts
import { ContextualMemory, RecoveryResult } from '../core/types'
import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

export class RecoverySystem {
  async executeAdvancedRecovery(
    agent: any,
    userPrompt: string,
    input_variables: Record<string, any>,
    originalError: any,
    userId: string,
    supabase: any,
    userContext: ContextualMemory
  ): Promise<RecoveryResult> {
    console.log('🔄 Executing advanced recovery protocol')
    
    // Analyze error type and determine recovery strategy
    const errorType = this.classifyError(originalError)
    const recoveryStrategy = this.selectRecoveryStrategy(errorType, userContext)
    
    console.log(`Recovery strategy selected: ${recoveryStrategy}`)
    
    try {
      // Simplified context for recovery
      const recoveryContext = {
        userPrompt: userPrompt.slice(0, 1000),
        inputSummary: Object.keys(input_variables).join(', '),
        errorType,
        userPatterns: Object.keys(userContext.userPatterns).slice(0, 3)
      }
      
      const recoverySystemPrompt = `You are an ADVANCED AI RECOVERY AGENT operating in emergency mode.

RECOVERY SITUATION:
• Original Error: ${originalError.message}
• Error Classification: ${errorType}
• Recovery Strategy: ${recoveryStrategy}

RECOVERY OBJECTIVES:
1. Complete the requested business operation using available context
2. Provide maximum value despite system limitations  
3. Generate professional, executive-level output
4. Clearly indicate recovery mode and any limitations

USER CONTEXT:
${userContext.userPatterns ? `• User patterns: ${Object.keys(userContext.userPatterns).slice(0, 2).join(', ')}` : ''}
${userContext.successFactors.length > 0 ? `• Previous success factors: ${userContext.successFactors[0]}` : ''}

RECOVERY EXECUTION:
Apply advanced reasoning to complete the request despite the technical failure.
Focus on delivering business value and actionable insights.`

      const recoveryUserPrompt = `${userPrompt}

RECOVERY CONTEXT: ${JSON.stringify(recoveryContext, null, 2)}

[ADVANCED RECOVERY MODE: Execute with available resources and provide executive-level analysis]`

      const recoveryCompletion = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo-16k',
        messages: [
          { role: 'system', content: recoverySystemPrompt },
          { role: 'user', content: recoveryUserPrompt },
        ],
        temperature: 0.3,
        max_tokens: 3000,
      })

      const recoveryResponse = recoveryCompletion.choices[0]?.message?.content || 
                             'Advanced recovery response generated with limited context.'

      const advancedRecoveryMetrics = {
        confidence: 0.65,
        qualityScore: 'B-',
        recoveryMode: true,
        recoveryStrategy,
        errorType,
        autonomyLevel: 0.7,
        executionTime: 15000,
        businessContext: 'general',
        validated: false,
        adaptationsApplied: 1
      }

      return {
        message: recoveryResponse,
        pluginContext: {},
        parsed_output: {
          summary: recoveryResponse,
          recoveryMode: true,
          confidence: advancedRecoveryMetrics.confidence,
          qualityScore: advancedRecoveryMetrics.qualityScore,
          originalError: originalError.message,
          recoveryStrategy
        },
        send_status: `Advanced recovery completed using ${recoveryStrategy} strategy`,
        intelligence_metrics: advancedRecoveryMetrics
      }
      
    } catch (recoveryError) {
      console.error('💥 Advanced recovery failed:', recoveryError)
      
      // Final fallback
      return {
        message: `I encountered a system error but attempted to process your request. The issue was: ${originalError.message}. Please try again or provide additional context for better results.`,
        pluginContext: {},
        parsed_output: {
          summary: "System recovery attempted but failed",
          recoveryMode: true,
          confidence: 0.3,
          qualityScore: 'D',
          criticalFailure: true,
          originalError: originalError.message
        },
        send_status: 'Critical system recovery attempted',
        intelligence_metrics: {
          confidence: 0.3,
          recoveryMode: true,
          criticalFailure: true
        }
      }
    }
  }

  private classifyError(error: any): string {
    const message = error.message?.toLowerCase() || ''
    
    if (message.includes('token') || message.includes('limit')) {
      return 'token_limit_exceeded'
    }
    if (message.includes('rate') || message.includes('429')) {
      return 'rate_limit_exceeded'
    }
    if (message.includes('network') || message.includes('timeout')) {
      return 'network_failure'
    }
    if (message.includes('auth') || message.includes('credential')) {
      return 'authentication_failure'
    }
    if (message.includes('plugin') || message.includes('connection')) {
      return 'plugin_failure'
    }
    
    return 'general_system_failure'
  }

  private selectRecoveryStrategy(errorType: string, userContext: ContextualMemory): string {
    const strategyMap = {
      'token_limit_exceeded': 'aggressive_summarization',
      'rate_limit_exceeded': 'simplified_processing',
      'network_failure': 'offline_analysis',
      'authentication_failure': 'alternative_data_sources',
      'plugin_failure': 'manual_processing',
      'general_system_failure': 'best_effort_analysis'
    }
    
    const baseStrategy = strategyMap[errorType] || 'best_effort_analysis'
    
    // Adapt based on user context
    if (userContext.preferredStrategies.length > 0) {
      return `${baseStrategy}_with_user_preferences`
    }
    
    return baseStrategy
  }

  // Diagnostic methods for different error types
  async diagnoseSystemHealth(): Promise<any> {
    const healthCheck = {
      timestamp: new Date().toISOString(),
      openai_available: await this.checkOpenAIHealth(),
      memory_usage: this.getMemoryUsage(),
      system_load: 'normal', // Placeholder for actual system monitoring
      active_connections: 'stable'
    }
    
    return healthCheck
  }

  private async checkOpenAIHealth(): Promise<boolean> {
    try {
      const testCompletion = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'Health check' }],
        max_tokens: 5,
      })
      
      return !!testCompletion.choices[0]?.message?.content
    } catch (error) {
      console.warn('OpenAI health check failed:', error)
      return false
    }
  }

  private getMemoryUsage(): string {
    if (typeof process !== 'undefined' && process.memoryUsage) {
      const usage = process.memoryUsage()
      const usedMB = Math.round(usage.heapUsed / 1024 / 1024)
      return `${usedMB}MB`
    }
    return 'unknown'
  }

  // Recovery strategy implementations
  async executeAggressiveSummarization(data: any): Promise<string> {
    // Drastically reduce data size while preserving key information
    if (typeof data === 'string') {
      return data.slice(0, 500) + '...[aggressively summarized due to system constraints]'
    }
    
    if (typeof data === 'object' && data !== null) {
      const keys = Object.keys(data)
      const criticalKeys = keys.slice(0, 3) // Keep only first 3 keys
      const summarized = {}
      
      criticalKeys.forEach(key => {
        summarized[key] = typeof data[key] === 'string' ? 
                         data[key].slice(0, 100) + '...' : 
                         data[key]
      })
      
      return JSON.stringify(summarized)
    }
    
    return String(data).slice(0, 200)
  }

  async executeSimplifiedProcessing(prompt: string): Promise<string> {
    // Use minimal processing to avoid resource constraints
    const simplifiedPrompt = prompt.slice(0, 1000)
    
    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          { 
            role: 'system', 
            content: 'You are a business assistant operating in simplified mode due to system constraints. Provide concise, practical responses.' 
          },
          { role: 'user', content: simplifiedPrompt }
        ],
        temperature: 0.1,
        max_tokens: 1000,
      })
      
      return completion.choices[0]?.message?.content || 'Simplified processing completed.'
    } catch (error) {
      return 'System operating in minimal mode. Please retry with a simpler request.'
    }
  }

  async executeOfflineAnalysis(context: any): Promise<string> {
    // Provide analysis based only on available local context
    const analysis = `OFFLINE ANALYSIS MODE:

Based on available context, here's what I can determine:
• Request type: ${context.intentContext?.primaryIntent || 'General inquiry'}
• Business context: ${context.intentContext?.businessContext || 'General'}
• Available data sources: ${Object.keys(context.pluginContext || {}).length}

Due to network limitations, this analysis is based on cached and local data only. For complete results, please retry when connectivity is restored.

Recommendations:
1. Save this partial analysis
2. Retry the request when network is available
3. Consider simplifying the request if issues persist`

    return analysis
  }

  // Recovery learning - track what recovery strategies work
  async recordRecoveryOutcome(
    errorType: string,
    recoveryStrategy: string,
    success: boolean,
    userFeedback?: string
  ): Promise<void> {
    const recoveryRecord = {
      error_type: errorType,
      recovery_strategy: recoveryStrategy,
      success: success,
      user_feedback: userFeedback,
      timestamp: new Date().toISOString()
    }
    
    // In production, this would be saved to a recovery learning database
    console.log('Recovery outcome recorded:', recoveryRecord)
  }

  // Get recovery recommendations based on error patterns
  async getRecoveryRecommendations(errorHistory: any[]): Promise<string[]> {
    const recommendations = []
    
    // Analyze error patterns
    const errorTypes = errorHistory.map(e => e.error_type)
    const mostCommonError = this.getMostFrequent(errorTypes)
    
    if (mostCommonError === 'rate_limit_exceeded') {
      recommendations.push('Consider implementing request queuing')
      recommendations.push('Add exponential backoff delays')
    }
    
    if (mostCommonError === 'token_limit_exceeded') {
      recommendations.push('Implement more aggressive data truncation')
      recommendations.push('Use data preprocessing to reduce input size')
    }
    
    if (mostCommonError === 'plugin_failure') {
      recommendations.push('Implement plugin health monitoring')
      recommendations.push('Add more robust fallback mechanisms')
    }
    
    return recommendations
  }

  private getMostFrequent(array: string[]): string {
    const frequency = {}
    let maxCount = 0
    let mostFrequent = ''
    
    array.forEach(item => {
      frequency[item] = (frequency[item] || 0) + 1
      if (frequency[item] > maxCount) {
        maxCount = frequency[item]
        mostFrequent = item
      }
    })
    
    return mostFrequent
  }
}