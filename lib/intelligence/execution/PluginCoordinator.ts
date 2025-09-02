// /lib/intelligence/execution/PluginCoordinator.ts
import { SmartIntentAnalysis, AdaptiveStrategy, ExecutionContext, PluginResult } from '../core/types'
import { pluginRegistry } from '../../plugins/pluginRegistry'

export class PluginCoordinator {
  async executeSmartCoordination(
    requiredPlugins: string[],
    context: ExecutionContext,
    intentAnalysis: SmartIntentAnalysis,
    strategy: AdaptiveStrategy,
    executionId: string
  ): Promise<Record<string, PluginResult>> {
    const pluginContext: Record<string, PluginResult> = {}
    
    // Get user plugin credentials
    const userPlugins = await this.getUserPluginCredentials(context.userId, context.supabase)
    
    // Prioritize plugins based on intent and strategy
    const prioritizedPlugins = this.prioritizePluginsForIntent(requiredPlugins, intentAnalysis)
    
    for (const pluginKey of prioritizedPlugins) {
      const stepStart = Date.now()
      console.log(`🔧 Executing smart plugin: ${pluginKey}`)
      
      const pluginStrategy = pluginRegistry[pluginKey]
      let creds = userPlugins[pluginKey]

      // Special handling for ChatGPT Research
      if (pluginKey === 'chatgpt-research') {
        creds = {
          access_token: 'platform-key',
          refresh_token: null,
          username: 'ChatGPT',
          expires_at: null
        }
      }

      if (!pluginStrategy || !creds) {
        pluginContext[pluginKey] = {
          summary: "Plugin unavailable or not connected",
          error: `${!pluginStrategy ? 'Plugin not found' : 'No credentials'}`,
          confidence: 0,
          smartAnalysis: true
        }
        continue
      }

      try {
        // Smart credential management
        await this.handleCredentialIntelligently(pluginKey, creds, pluginStrategy, context)

        // Execute with advanced retry logic
        const result = await this.executePluginWithSmartRetry(
          pluginStrategy,
          {
            connection: creds,
            userId: context.userId,
            input_variables: context.input_variables,
            intentContext: intentAnalysis
          },
          pluginKey,
          strategy.riskMitigation.includes('high_complexity_failure_risk') ? 5 : 3
        )

        // Advanced result processing
        pluginContext[pluginKey] = await this.enhancePluginResult(
          result,
          pluginKey,
          intentAnalysis,
          stepStart
        )

        console.log(`✅ Smart plugin ${pluginKey} completed`)

      } catch (err: any) {
        console.error(`❌ Smart plugin ${pluginKey} failed:`, err.message)
        
        // Advanced fallback handling
        const fallbackResult = await this.attemptAdvancedPluginFallback(
          pluginKey,
          err,
          context,
          intentAnalysis
        )
        
        pluginContext[pluginKey] = fallbackResult || {
          summary: "Plugin execution failed with advanced recovery attempted",
          error: err.message,
          confidence: 0,
          smartAnalysis: true,
          fallbackAttempted: true
        }
      }
    }

    return pluginContext
  }

  private async getUserPluginCredentials(userId: string, supabase: any): Promise<Record<string, any>> {
    try {
      const { data: pluginConnections, error: pluginError } = await supabase
        .from('plugin_connections')
        .select('*')
        .eq('user_id', userId)

      if (pluginError) throw pluginError

      const plugins: Record<string, any> = {}
      pluginConnections?.forEach((conn) => {
        plugins[conn.plugin_key] = {
          access_token: conn.access_token,
          refresh_token: conn.refresh_token,
          username: conn.username,
          expires_at: conn.expires_at,
        }
      })

      return plugins
    } catch (error) {
      console.warn('Failed to load plugin credentials:', error)
      return {}
    }
  }

  private prioritizePluginsForIntent(plugins: string[], intent: SmartIntentAnalysis): string[] {
    const priorityMap = {
      'financial_analysis': ['google-mail', 'google-drive', 'chatgpt-research'],
      'research_and_analysis': ['chatgpt-research', 'google-drive', 'google-mail'],
      'document_processing': ['google-drive', 'google-mail', 'chatgpt-research'],
      'communication': ['google-mail', 'google-drive', 'chatgpt-research']
    }

    const priority = priorityMap[intent.primaryIntent] || plugins
    
    // Reorder plugins based on priority
    const prioritized = []
    priority.forEach(p => {
      if (plugins.includes(p)) prioritized.push(p)
    })
    
    plugins.forEach(p => {
      if (!prioritized.includes(p)) prioritized.push(p)
    })
    
    return prioritized
  }

  private async enhancePluginResult(
    result: any, 
    pluginKey: string, 
    intent: SmartIntentAnalysis, 
    startTime: number
  ): Promise<PluginResult> {
    const executionTime = Date.now() - startTime
    const confidence = await this.calculateAdvancedConfidence(result, pluginKey, intent)
    const relevanceScore = await this.assessResultRelevance(result, intent)
    
    return {
      ...result,
      confidence,
      relevanceScore,
      smartAnalysis: true,
      executionTime,
      qualityGrade: await this.assessAdvancedQuality(result, pluginKey),
      contextualFit: await this.assessContextualFit(result, intent),
      dataIntegrity: await this.validateDataIntegrity(result)
    }
  }

  private async calculateAdvancedConfidence(result: any, pluginKey: string, intent: SmartIntentAnalysis): Promise<number> {
    let baseConfidence = 0.7
    
    // Plugin-specific confidence
    const pluginConfidenceMap = {
      'google-mail': 0.95,
      'google-drive': 0.90,
      'chatgpt-research': 0.85,
      'notion': 0.80
    }
    
    baseConfidence = pluginConfidenceMap[pluginKey] || 0.7
    
    // Adjust based on data quality
    if (result.error) return 0
    if (!result.data && !result.summary) return 0.3
    
    // Boost confidence for good data
    if (result.data && typeof result.data === 'object') {
      const dataKeys = Object.keys(result.data)
      if (dataKeys.length > 5) baseConfidence += 0.05
      if (result.summary && result.summary.length > 100) baseConfidence += 0.03
    }
    
    // Intent-specific adjustments
    if (intent.complexity === 'simple' && result.data) baseConfidence += 0.05
    if (intent.urgency === 'critical' && result.error) baseConfidence -= 0.2
    
    return Math.min(baseConfidence, 0.98)
  }

  private async assessResultRelevance(result: any, intent: SmartIntentAnalysis): Promise<number> {
    if (!result || result.error) return 0
    
    let relevance = 0.5
    
    // Check if result content matches intent requirements
    const content = JSON.stringify(result).toLowerCase()
    
    intent.dataRequirements.forEach(requirement => {
      if (content.includes(requirement.replace('_', ' '))) {
        relevance += 0.1
      }
    })
    
    // Business context matching
    if (content.includes(intent.businessContext)) {
      relevance += 0.15
    }
    
    return Math.min(relevance, 1.0)
  }

  private async assessAdvancedQuality(result: any, pluginKey: string): Promise<string> {
    if (!result || result.error) return 'F'
    
    let score = 0
    
    // Data completeness
    if (result.data && Object.keys(result.data).length > 0) score += 25
    if (result.summary && result.summary.length > 50) score += 20
    
    // Data structure quality
    if (result.data && Array.isArray(result.data) && result.data.length > 0) score += 15
    if (result.metadata) score += 10
    
    // Plugin-specific quality checks
    if (pluginKey === 'google-mail' && result.data?.some && 
        result.data.some(email => email.from && email.subject)) {
      score += 15
    } else if (pluginKey === 'google-drive' && result.data?.some && 
               result.data.some(file => file.name && file.content)) {
      score += 15
    } else if (pluginKey === 'chatgpt-research' && result.summary && result.summary.length > 200) {
      score += 15
    }
    
    // Freshness and timeliness
    if (result.timestamp || result.lastUpdated) score += 10
    
    // Convert to letter grade
    if (score >= 85) return 'A'
    if (score >= 75) return 'B'
    if (score >= 65) return 'C'
    if (score >= 50) return 'D'
    return 'F'
  }

  private async assessContextualFit(result: any, intent: SmartIntentAnalysis): Promise<number> {
    if (!result || result.error) return 0
    
    const resultStr = JSON.stringify(result).toLowerCase()
    const intentTerms = [
      intent.primaryIntent.replace('_', ' '),
      ...intent.subIntents.map(s => s.replace('_', ' ')),
      intent.businessContext
    ]
    
    let fitScore = 0.3 // Base fit
    
    intentTerms.forEach(term => {
      if (resultStr.includes(term)) {
        fitScore += 0.1
      }
    })
    
    return Math.min(fitScore, 1.0)
  }

  private async validateDataIntegrity(result: any): Promise<boolean> {
    if (!result) return false
    if (result.error) return false
    
    // Basic integrity checks
    if (result.data) {
      if (Array.isArray(result.data)) {
        return result.data.length > 0
      }
      if (typeof result.data === 'object') {
        return Object.keys(result.data).length > 0
      }
    }
    
    if (result.summary && typeof result.summary === 'string') {
      return result.summary.length > 20
    }
    
    return false
  }

  private async handleCredentialIntelligently(
    pluginKey: string,
    creds: any,
    strategy: any,
    context: ExecutionContext
  ): Promise<void> {
    if (pluginKey === 'chatgpt-research') return

    const now = new Date()
    const expires = creds.expires_at ? new Date(creds.expires_at) : null
    const isExpired = expires && expires.getTime() < now.getTime()

    if (isExpired && strategy.refreshToken) {
      console.log(`Auto-refreshing token for ${pluginKey}`)
      try {
        const refreshed = await strategy.refreshToken(creds)
        creds.access_token = refreshed.access_token
        creds.expires_at = refreshed.expires_at

        await context.supabase
          .from('plugin_connections')
          .update({
            access_token: refreshed.access_token,
            expires_at: refreshed.expires_at
          })
          .eq('user_id', context.userId)
          .eq('plugin_key', pluginKey)
          
        console.log(`Token refreshed successfully for ${pluginKey}`)
      } catch (refreshError) {
        console.error(`Token refresh failed for ${pluginKey}:`, refreshError)
        throw new Error(`Authentication failed for ${pluginKey}: ${refreshError.message}`)
      }
    }
  }

  private async executePluginWithSmartRetry(
    strategy: any,
    params: any,
    pluginKey: string,
    maxRetries: number = 3
  ): Promise<any> {
    let lastError: any
    const backoffMultipliers = [1, 2, 4, 8, 16]
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`🔧 Smart execution ${pluginKey} - attempt ${attempt}/${maxRetries}`)
        
        // Add timeout based on attempt
        const timeoutMs = Math.min(30000, 10000 * attempt)
        const executeWithTimeout = Promise.race([
          strategy.run(params),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs)
          )
        ])
        
        const result = await executeWithTimeout
        
        if (attempt > 1) {
          console.log(`✅ Smart retry succeeded for ${pluginKey} on attempt ${attempt}`)
        }
        
        return result
      } catch (error: any) {
        lastError = error
        console.log(`❌ Smart attempt ${attempt} failed for ${pluginKey}:`, error.message)
        
        if (attempt < maxRetries) {
          const baseDelay = 1000
          const backoffDelay = baseDelay * backoffMultipliers[attempt - 1]
          const jitterDelay = backoffDelay + (Math.random() * 1000)
          const finalDelay = Math.min(jitterDelay, 15000)
          
          console.log(`⏳ Smart retry for ${pluginKey} in ${finalDelay}ms...`)
          await new Promise(resolve => setTimeout(resolve, finalDelay))
        }
      }
    }

    throw lastError
  }

  private async attemptAdvancedPluginFallback(
    pluginKey: string,
    error: any,
    context: ExecutionContext,
    intent: SmartIntentAnalysis
  ): Promise<PluginResult | null> {
    console.log(`🔄 Advanced fallback for ${pluginKey}`)
    
    // Intent-based fallback selection
    const fallbackMap = {
      'financial_analysis': ['google-mail', 'google-drive'],
      'research_and_analysis': ['google-drive', 'google-mail'],
      'document_processing': ['google-drive'],
      'communication': ['google-mail']
    }
    
    const potentialFallbacks = fallbackMap[intent.primaryIntent] || ['google-drive']
    
    for (const fallbackPlugin of potentialFallbacks) {
      if (fallbackPlugin !== pluginKey) {
        try {
          const fallbackCreds = await this.getPluginCredentials(fallbackPlugin, context.supabase, context.userId)
          if (fallbackCreds) {
            const fallbackStrategy = pluginRegistry[fallbackPlugin]
            if (fallbackStrategy?.run) {
              console.log(`Attempting fallback to ${fallbackPlugin}`)
              
              const fallbackResult = await fallbackStrategy.run({
                connection: fallbackCreds,
                userId: context.userId,
                input_variables: context.input_variables,
                intentContext: intent
              })
              
              return {
                ...fallbackResult,
                fallback_source: fallbackPlugin,
                fallback_reason: `${pluginKey}_failure`,
                confidence: 0.7,
                smartAnalysis: true,
                recoveryApplied: true,
                originalError: error.message
              }
            }
          }
        } catch (fallbackError) {
          console.log(`Fallback to ${fallbackPlugin} also failed:`, fallbackError.message)
          continue
        }
      }
    }
    
    return null
  }

  private async getPluginCredentials(pluginKey: string, supabase: any, userId: string): Promise<any> {
    const { data: connection } = await supabase
      .from('plugin_connections')
      .select('*')
      .eq('user_id', userId)
      .eq('plugin_key', pluginKey)
      .single()

    return connection ? {
      access_token: connection.access_token,
      refresh_token: connection.refresh_token,
      username: connection.username,
      expires_at: connection.expires_at,
    } : null
  }
}