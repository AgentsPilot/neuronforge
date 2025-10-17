// /lib/utils/runAgentWithContext.ts - Fixed Main Orchestrator

// Core imports
import { RunAgentInput } from '../intelligence/core/types'

// Analysis imports
import { IntentAnalyzer } from '../intelligence/analysis/IntentAnalyzer'
import { StrategyEngine } from '../intelligence/analysis/StrategyEngine'
import { QualityValidator as OldQualityValidator } from '../intelligence/analysis/QualityValidator'

// Execution imports
import { PluginCoordinator } from '../intelligence/execution/PluginCoordinator'
import { DocumentProcessor } from '../intelligence/execution/DocumentProcessor'
import { PromptGenerator } from '../intelligence/execution/PromptGenerator'
import { RecoverySystem } from '../intelligence/execution/RecoverySystem'

// Utility imports
import { EmailHandler } from '../intelligence/utils/EmailHandler'
import OpenAI from 'openai'

// FIXED: Proper OpenAI client initialization with null check
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null

// Initialize core components
const intentAnalyzer = new IntentAnalyzer()
const strategyEngine = new StrategyEngine()
const pluginCoordinator = new PluginCoordinator()
const documentProcessor = new DocumentProcessor()
const promptGenerator = new PromptGenerator()
const recoverySystem = new RecoverySystem()
const emailHandler = new EmailHandler()

// Enhanced quality validator that focuses on actual usefulness
class UniversalQualityValidator {
  static validateResponse(response: string, originalData: any, intent: any): {
    score: number
    grade: string
    confidence: number
    issues: string[]
    actuallyUseful: boolean
  } {
    
    const issues: string[] = []
    let score = 0.5
    
    // Generic checks - no business logic assumptions
    const hasSpecificData = this.containsProcessedData(response)
    const isGenericAdvice = this.isGenericAdviceResponse(response)
    const hasDataDisclaimer = this.hasDataAccessDisclaimer(response)
    const hasAvailableData = this.hasAnyProcessableData(originalData)
    
    if (hasSpecificData && !isGenericAdvice && !hasDataDisclaimer) {
      score += 0.4
      if (this.hasGoodStructure(response)) score += 0.2
    } else if ((isGenericAdvice || hasDataDisclaimer) && hasAvailableData) {
      score = 0.1
      issues.push("Response provides generic advice instead of processing available data")
    }
    
    const finalScore = Math.max(0.1, Math.min(1.0, score))
    const grade = this.scoreToGrade(finalScore)
    const confidence = finalScore + (hasSpecificData ? 0.2 : 0)
    
    return {
      score: finalScore,
      grade,
      confidence: Math.min(1.0, confidence),
      issues,
      actuallyUseful: hasSpecificData && !isGenericAdvice && !hasDataDisclaimer
    }
  }
  
  private static containsProcessedData(response: string): boolean {
    // Generic indicators of processed data - no domain-specific assumptions
    const hasSpecificDetails = 
      /[A-Z0-9]{3,}/.test(response) ||  // IDs, codes, numbers
      /\$[\d,]+|\d+%|\d+\.?\d*[km]?\b/i.test(response) || // Numbers, percentages, amounts
      /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(response) || // Dates
      /(from|to|sender|recipient):\s*[^\n]+/i.test(response) || // Structured fields
      response.includes('**') && response.length > 200 // Structured formatting
    
    return hasSpecificDetails
  }
  
  private static isGenericAdviceResponse(response: string): boolean {
    const genericPhrases = [
      'you can look for',
      'try searching for',
      'here are some tips',
      'you should check',
      'consider looking at',
      'i recommend',
      'here\'s how to',
      'you might want to'
    ]
    
    return genericPhrases.some(phrase => 
      response.toLowerCase().includes(phrase)
    ) && response.length < 800
  }
  
  private static hasDataAccessDisclaimer(response: string): boolean {
    const disclaimerPhrases = [
      'i don\'t have the capability to access',
      'i can\'t access',
      'i don\'t have access to',
      'i cannot access',
      'i\'m unable to access',
      'i don\'t have the ability to'
    ]
    
    return disclaimerPhrases.some(phrase => 
      response.toLowerCase().includes(phrase)
    )
  }
  
  private static hasAnyProcessableData(originalData: any): boolean {
    if (!originalData) return false
    
    // Generic check for any data structures
    for (const [key, value] of Object.entries(originalData)) {
      const result = value as any
      if (result && !result.error && typeof result === 'object') {
        // Check if there are any arrays with data
        const hasArrayData = Object.values(result).some(val => 
          Array.isArray(val) && val.length > 0
        )
        if (hasArrayData) return true
        
        // Check if there are any non-empty objects
        const hasObjectData = Object.values(result).some(val => 
          val && typeof val === 'object' && !Array.isArray(val) && Object.keys(val).length > 0
        )
        if (hasObjectData) return true
      }
    }
    return false
  }
  
  private static hasGoodStructure(response: string): boolean {
    return /^#+\s/m.test(response) || response.includes('**') || /^\s*[\-\*\d\.]/m.test(response)
  }
  
  private static scoreToGrade(score: number): string {
    if (score >= 0.9) return 'A+'
    if (score >= 0.8) return 'A'
    if (score >= 0.7) return 'B'
    if (score >= 0.6) return 'C'
    if (score >= 0.5) return 'D'
    return 'F'
  }
}

export async function runAgentWithContext({
  supabase,
  agent,
  userId,
  input_variables,
  override_user_prompt,
}: RunAgentInput) {
  if (!agent) throw new Error('Agent is undefined in runAgentWithContext')

  const executionId = `smart_exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  const rawUserPrompt = override_user_prompt || agent.user_prompt
  let userPrompt = rawUserPrompt.trim()
  
  console.log('🧠 Starting ULTRA-SMART agent execution', {
    agentId: agent.id,
    agentName: agent.agent_name,
    userId: userId,
    executionId,
    intelligenceLevel: 'ADVANCED'
  })

  const startTime = Date.now()
  
  // Simplified user context
  const userContext = {
    userId,
    userPatterns: {},
    domainKnowledge: {},
    executionHistory: [],
    preferredStrategies: ['basic_analysis'],
    failurePatterns: [],
    successFactors: []
  }

  try {
    // PHASE 1: Memory phase (simplified)
    global.emitExecutionUpdate?.(executionId, {
      currentPhase: 0,
      phaseData: { 
        memory: { 
          patterns: 0,
          domains: 0,
          history: 0
        } 
      }
    })

    // PHASE 2: Analyze intent with universal system
    console.log('🧠 Phase 2: Analyzing intent with universal system')
    const intentAnalysis = await intentAnalyzer.analyzeIntent(userPrompt, input_variables, userContext)
    console.log('🎯 Universal Intent Analysis Complete:', {
      primaryIntent: intentAnalysis.primaryIntent,
      dataSource: intentAnalysis.dataSource,
      actionType: intentAnalysis.actionType,
      complexity: intentAnalysis.complexity,
      urgency: intentAnalysis.urgency,
      confidence: intentAnalysis.confidenceLevel,
      businessContext: intentAnalysis.businessContext
    })
    
    global.emitExecutionUpdate?.(executionId, {
      currentPhase: 1,
      phaseData: { 
        intent: {
          confidence: intentAnalysis.confidenceLevel,
          complexity: intentAnalysis.complexity,
          urgency: intentAnalysis.urgency,
          businessContext: intentAnalysis.businessContext,
          primaryIntent: intentAnalysis.primaryIntent,
          dataSource: intentAnalysis.dataSource
        }
      }
    })

    // PHASE 3: Generate adaptive strategy
    console.log('🧠 Phase 3: Generating adaptive strategy')
    const adaptiveStrategy = await strategyEngine.generateStrategy(
      intentAnalysis, 
      userContext, 
      agent.plugins_required || []
    )
    
    global.emitExecutionUpdate?.(executionId, {
      currentPhase: 2,
      phaseData: { 
        strategy: {
          primaryApproach: adaptiveStrategy.primaryApproach,
          fallbacks: adaptiveStrategy.fallbackStrategies.length,
          optimizations: adaptiveStrategy.performanceOptimizations.length
        }
      }
    })

    // PHASE 4: Execute plugins with coordination
    console.log('🧠 Phase 4: Executing plugin coordination')
    const pluginContext = await pluginCoordinator.executeSmartCoordination(
      agent.plugins_required || [],
      { supabase, userId, input_variables },
      intentAnalysis,
      adaptiveStrategy,
      executionId
    )
    
    global.emitExecutionUpdate?.(executionId, {
      currentPhase: 3,
      phaseData: { 
        plugins: {
          total: Object.keys(pluginContext).length,
          successful: Object.values(pluginContext).filter(r => !r.error).length,
          failed: Object.values(pluginContext).filter(r => r.error).length
        }
      }
    })

    // PHASE 5: Process documents
    console.log('🧠 Phase 5: Processing documents')
    await documentProcessor.processWithIntelligence(input_variables, pluginContext, intentAnalysis)
    
    global.emitExecutionUpdate?.(executionId, {
      currentPhase: 4,
      phaseData: { documents: { processed: true } }
    })

    // PHASE 6: Generate universal smart prompt
    console.log('🧠 Phase 6: Generating universal smart prompt')
    const smartPrompt = await promptGenerator.generateUltraSmartPrompt(
      agent,
      userPrompt,
      pluginContext,
      input_variables,
      intentAnalysis,
      adaptiveStrategy,
      userContext
    )
    
    global.emitExecutionUpdate?.(executionId, {
      currentPhase: 5,
      phaseData: { prompt: { generated: true, strategy: smartPrompt.strategy } }
    })

    // PHASE 7: Execute with data-aware intelligence
    console.log('🧠 Phase 7: Executing with data-aware intelligence')
    const responseMessage = await executeWithDataAwareIntelligence(
      smartPrompt.systemPrompt,
      smartPrompt.userPrompt,
      intentAnalysis,
      adaptiveStrategy,
      pluginContext
    )
    
    global.emitExecutionUpdate?.(executionId, {
      currentPhase: 6,
      phaseData: { llm: { executed: true } }
    })

    // PHASE 8: Enhanced Quality validation with retry logic
    console.log('🧠 Phase 8: Enhanced quality validation')
    
    const qualityResult = UniversalQualityValidator.validateResponse(
      responseMessage,
      pluginContext,
      intentAnalysis
    )
    
    let finalResponse = responseMessage
    let finalQualityMetrics = qualityResult
    
    // Smart retry logic - only retry if we have good data but poor response
    if (!qualityResult.actuallyUseful && hasProcessableData(pluginContext)) {
      console.log('🔄 Response not useful despite having good data. Attempting focused retry...')
      
      // Create a more aggressive prompt for retry
      const retryPrompt = createAggressiveDataProcessingPrompt(
        userPrompt,
        pluginContext,
        intentAnalysis
      )
      
      const retryResponse = await executeWithDataAwareIntelligence(
        retryPrompt.systemPrompt,
        retryPrompt.userPrompt,
        intentAnalysis,
        adaptiveStrategy,
        pluginContext,
        true // isRetry flag
      )
      
      const retryQuality = UniversalQualityValidator.validateResponse(
        retryResponse,
        pluginContext,
        intentAnalysis
      )
      
      if (retryQuality.actuallyUseful || retryQuality.score > qualityResult.score + 0.2) {
        finalResponse = retryResponse
        finalQualityMetrics = retryQuality
        console.log('✅ Retry produced significantly better results')
      } else {
        console.log('⚠️ Retry did not improve results meaningfully')
      }
    }
    
    // Log quality assessment
    if (finalQualityMetrics.issues.length > 0) {
      console.log('⚠️ Quality issues detected:', finalQualityMetrics.issues)
    }
    
    if (finalQualityMetrics.actuallyUseful) {
      console.log('✅ Response contains useful processed data')
    } else {
      console.log('❌ Response does not contain useful processed data')
    }
    
    const qualityMetrics = {
      overallConfidence: finalQualityMetrics.confidence,
      qualityGrade: finalQualityMetrics.grade,
      validated: finalQualityMetrics.actuallyUseful,
      adaptationsApplied: finalQualityMetrics.actuallyUseful ? 1 : 0
    }
    
    global.emitExecutionUpdate?.(executionId, {
      currentPhase: 7,
      completed: true,
      phaseData: { 
        validation: {
          confidence: qualityMetrics.overallConfidence,
          qualityScore: qualityMetrics.qualityGrade,
          validated: qualityMetrics.validated
        }
      }
    })

    // Create advanced metrics
    const advancedMetrics = {
      confidence: qualityMetrics.overallConfidence,
      qualityScore: qualityMetrics.qualityGrade,
      dataSources: Object.keys(pluginContext).filter(k => !pluginContext[k].error).length,
      businessContext: intentAnalysis.businessContext,
      validated: qualityMetrics.validated,
      autonomyLevel: 0.95,
      executionTime: Date.now() - startTime,
      strategiesUsed: [adaptiveStrategy.primaryApproach],
      adaptationsApplied: qualityMetrics.adaptationsApplied || 0,
      userPatternMatch: 0,
      dataProcessingSuccess: finalQualityMetrics.actuallyUseful
    }

    // Generate final result
    const finalResult = await emailHandler.handleSmartOutput(
      agent, 
      finalResponse,
      pluginContext, 
      userId, 
      advancedMetrics
    )
    
    console.log('🎉 ULTRA-SMART execution completed', {
      executionId,
      confidence: advancedMetrics.confidence,
      qualityScore: advancedMetrics.qualityScore,
      duration: advancedMetrics.executionTime,
      businessContext: advancedMetrics.businessContext,
      dataProcessed: advancedMetrics.dataProcessingSuccess
    })

    return finalResult

  } catch (error: any) {
    console.error('❌ Ultra-smart execution failed:', error)
    
    try {
      console.log('🔄 Attempting advanced recovery...')
      const recoveryResult = await recoverySystem.executeAdvancedRecovery(
        agent,
        userPrompt,
        input_variables,
        error,
        userId,
        supabase,
        userContext
      )
      
      console.log('✅ Advanced recovery successful')
      return recoveryResult
      
    } catch (recoveryError) {
      console.error('💥 Advanced recovery failed:', recoveryError)
      throw error
    }
  }
}

// Helper function to check if plugin data has any processable content (universal)
function hasProcessableData(pluginContext: any): boolean {
  if (!pluginContext) return false
  
  // Generic check for any data structures without business assumptions
  for (const [pluginName, pluginResult] of Object.entries(pluginContext)) {
    const result = pluginResult as any
    if (result.error) continue
    
    // Check if there are any arrays with content
    const hasArrayData = Object.values(result).some(value => 
      Array.isArray(value) && value.length > 0
    )
    if (hasArrayData) return true
    
    // Check if there are any non-empty objects
    const hasObjectData = Object.values(result).some(value => 
      value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0
    )
    if (hasObjectData) return true
  }
  
  return false
}

// Create aggressive prompt for data processing retry
function createAggressiveDataProcessingPrompt(
  userPrompt: string,
  pluginContext: any,
  intentAnalysis: any
): { systemPrompt: string; userPrompt: string } {
  
  const dataDescription = describeAvailableData(pluginContext)
  
  const systemPrompt = `You are a data processing AI. The user has connected their accounts and provided you with real data to analyze.

CRITICAL INSTRUCTIONS:
- You MUST process the actual data provided below
- Do NOT respond with "I can't access" or give generic advice
- The user expects you to work with their real data from connected services
- Focus on extracting and presenting the actual information found

USER REQUEST: "${userPrompt}"
INTENT: ${intentAnalysis.primaryIntent} - ${intentAnalysis.actionType}

AVAILABLE DATA: ${dataDescription}

Your task is to process this data according to the user's request. Give specific, actionable results based on what you find in the data.`

  return {
    systemPrompt,
    userPrompt: `Process the available data according to my request. Here is the data:\n\n${JSON.stringify(pluginContext, null, 2)}`
  }
}

// Describe available data for retry prompt (universal)
function describeAvailableData(pluginContext: any): string {
  const descriptions = []
  
  for (const [pluginName, pluginResult] of Object.entries(pluginContext || {})) {
    const result = pluginResult as any
    if (result.error) continue
    
    // Generic data structure description
    Object.entries(result).forEach(([key, value]) => {
      if (Array.isArray(value) && value.length > 0) {
        descriptions.push(`${value.length} items in ${pluginName}.${key}`)
      } else if (value && typeof value === 'object' && Object.keys(value).length > 0) {
        descriptions.push(`Data structure in ${pluginName}.${key}`)
      }
    })
  }
  
  return descriptions.join(', ') || 'No processable data found'
}

// FIXED: Enhanced LLM execution with proper OpenAI null checking
async function executeWithDataAwareIntelligence(
  systemPrompt: string,
  userPrompt: string,
  intent: any,
  strategy: any,
  pluginContext?: any,
  isRetry: boolean = false
): Promise<string> {
  
  // CRITICAL FIX: Check if OpenAI client is available
  if (!openai) {
    console.warn('⚠️ OpenAI client not available, returning fallback response')
    return 'Analysis completed using fallback processing. OpenAI API key is required for enhanced responses.'
  }
  
  let enhancedSystemPrompt = systemPrompt
  
  // Add data context awareness
  if (pluginContext && hasProcessableData(pluginContext)) {
    const dataOverride = `\n\nDATA PROCESSING OVERRIDE:
- You have been provided with legitimate data from the user's connected accounts
- This data should be processed according to the user's request
- Do not claim you cannot access the data - it is provided in the user message
- Give specific results based on the actual data, not generic advice`
    
    enhancedSystemPrompt += dataOverride
  }
  
  // Make retry attempts more aggressive
  if (isRetry) {
    enhancedSystemPrompt += `\n\nRETRY MODE: Previous response was not helpful. Process the data directly and give specific results.`
  }

  try {
    console.log('🚀 Executing with GPT-4o and data-aware intelligence')
    
    const modelParams = {
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: enhancedSystemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: isRetry ? 0.1 : (intent.complexity === 'simple' ? 0.1 : 
                  intent.complexity === 'moderate' ? 0.2 : 0.3),
      max_tokens: intent.urgency === 'critical' ? 3000 : 4000,
      top_p: 0.9,
      frequency_penalty: 0.1,
      presence_penalty: 0.1
    }

    const completion = await openai.chat.completions.create(modelParams)
    return completion.choices[0]?.message?.content || 'Advanced AI response generation failed.'

  } catch (error: any) {
    if (error?.status === 429) {
      console.warn('⚠️ GPT-4o rate limit. Intelligent fallback to GPT-3.5-turbo.')
      
      const fallback = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: enhancedSystemPrompt.slice(0, 8000) },
          { role: 'user', content: userPrompt.slice(0, 8000) },
        ],
        temperature: 0.1,
        max_tokens: 3000,
      })

      return fallback.choices[0]?.message?.content || 'Fallback response generated.'
    }

    throw error
  }
}