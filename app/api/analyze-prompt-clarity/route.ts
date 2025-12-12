import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { v4 as uuidv4 } from 'uuid'
import { PromptRequestPayload, PromptResponsePayload, ClarityAnalysis } from '@/components/agent-creation/types'

// Import PluginManagerV2 for enhanced plugin management
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2'
import { PluginDefinitionContext, IPluginContext } from '@/lib/types/plugin-definition-context'

// Import PromptAnalyzer and PromptLoader for prompt analysis
import { PromptAnalyzer, PromptAnalyzerSchedulingQuestion } from '@/app/api/types/PromptAnalyzer'
import { PromptLoader, } from '@/app/api/types/PromptLoader'
//const aiAgentPromptTemplate = "analyze-prompt-clarity.txt";
const aiAgentPromptTemplate = "Automation-Design-Diagnostic-Analyst.txt";

// Import AI Analytics System
import { AIAnalyticsService, AICallData } from '@/lib/analytics/aiAnalytics'
import { AnthropicProvider, ANTHROPIC_MODELS } from '@/lib/ai/providers/anthropicProvider'
import { string32 } from 'pdfjs-dist/types/src/shared/util'
import { log } from 'console'

// Helper function to validate UUID format
function isValidUUID(str: string): boolean {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  return uuidPattern.test(str)
}

// Enhanced error logging function
function logError(stage: string, error: any, context?: any) {
  console.error(`❌ [${stage}] Error:`, {
    message: error.message,
    stack: error.stack,
    context
  })
}

// Validate environment variables at startup
function validateEnvironment() {
  const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']
  const missing = required.filter(key => !process.env[key])
  
  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:', missing)
    return false
  }
  
  console.log('✅ Environment variables validated')
  return true
}

// Safe Supabase client creation
let supabase: any = null
let aiAnalytics: AIAnalyticsService | null = null

try {
  if (validateEnvironment()) {
    supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    console.log('✅ Supabase client created successfully')
    
    // Initialize AI Analytics Service
    aiAnalytics = new AIAnalyticsService(supabase, {
      enableRealtime: true,
      enableCostTracking: true,
      enablePerformanceMetrics: true
    })
    console.log('✅ AI Analytics service initialized')
  }
} catch (error) {
  logError('SUPABASE_INIT', error)
}

// Enhanced JSON extraction that handles multiple response formats
function extractJSON(content: string): string {
  console.log('🔍 Extracting JSON from content:', content.slice(0, 100) + '...')
  
  // Method 1: Look for JSON in markdown code blocks
  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (jsonMatch) {
    console.log('✅ Found JSON in markdown code block')
    return jsonMatch[1].trim()
  }
  
  // Method 2: Look for JSON object that starts with {
  const objectMatch = content.match(/\{[\s\S]*\}/)
  if (objectMatch) {
    console.log('✅ Found JSON object in content')
    return objectMatch[0].trim()
  }
  
  // Method 3: Try to find JSON array that starts with [
  const arrayMatch = content.match(/\[[\s\S]*\]/)
  if (arrayMatch) {
    console.log('✅ Found JSON array in content')
    return arrayMatch[0].trim()
  }
  
  console.log('⚠️ No JSON structure found, returning original content')
  return content.trim()
}

// TO REMOVE - do we need this???
// check plugin capabilities (for email and file)
function getPluginsCapabilities(connectedPluginData: PluginDefinitionContext[] = []): 
{ hasEmailCapabilities: boolean, hasFileCapabilities: boolean } {
  return {
    hasEmailCapabilities: connectedPluginData.some(plugin =>
      plugin.someActionsIncludeKeyword('email')
    ),
    hasFileCapabilities: connectedPluginData.some(plugin =>
      plugin.someActionsIncludeKeyword('file')
    )
  };
}

// AI system prompt that ONLY works with connected services
function buildAISystemPrompt(connectedPluginData: PluginDefinitionContext[] = []): string {
  // Create a clear list of connected services for the AI
  const connectedServicesStrList = connectedPluginData.length > 0
    ? JSON.stringify(connectedPluginData.map(p => p.toShortLLMContext()))  
    : '- No connected services available';

  const promptLoader = new PromptLoader(aiAgentPromptTemplate);
  const systemPrompt = promptLoader.replaceKeywords({ "CONNECTED_SERVICES_LIST": connectedServicesStrList }); 
  return systemPrompt;
  }

// Smart generic fallback that uses plugin metadata
const createFallbackResponse = (promptAnalyzer: PromptAnalyzer, connectedPluginData: PluginDefinitionContext[] = []): ClarityAnalysis => {
  const pluginsCapabilities = getPluginsCapabilities(connectedPluginData);
  const hasNoPlugins = connectedPluginData.length === 0
  const scheduleQuestions = promptAnalyzer.generateSchedulingQuestions(pluginsCapabilities.hasEmailCapabilities, pluginsCapabilities.hasFileCapabilities);

  // Use actual plugin metadata for service names
  const serviceNames = connectedPluginData.map(p => p.getDisplayName());
  console.log('Connected service names for fallback:', serviceNames);

  // Build fallback actions using actual plugin metadata
  let fallbackActions = 'No actions possible - connect services first';
  if (!hasNoPlugins) {
    fallbackActions = `Summarize and save to ${serviceNames.join(', ')}`;
  }

  const analysis = promptAnalyzer.analyzeRequirements(30, serviceNames.filter(item => item !== undefined) as string[]);
  
  const responseAnalysis: ClarityAnalysis = {        
    clarityScore: 0,
    questionsCount: scheduleQuestions.length,
    needsClarification: true,
    aiValidationFailed: true,
    bypassedPluginValidation: false,
    hadPluginWarning: false,
    questionsSequence: scheduleQuestions || [],      
    analysis: analysis
  };

  // No plugins connected - focus on understanding intent first
  if (hasNoPlugins) {
    const q1: PromptAnalyzerSchedulingQuestion = {
      id: "automation_intent",
      dimension: "data",
      question: "I'm having trouble understanding your automation request automatically. What type of task do you want to automate?",
      type: "single_choice",
      options: [
        { value: "data_analysis", label: "Data analysis and insights", description: "Analyze information and generate reports or insights" },
        { value: "content_processing", label: "Content processing", description: "Process, transform, or generate text and documents" },
        { value: "communication_automation", label: "Communication automation", description: "Automate notifications, alerts, or messaging" },
        { value: "file_management", label: "File and document management", description: "Organize, process, or transform files and documents" },
        { value: "monitoring", label: "Monitoring and alerts", description: "Watch for changes or conditions and notify when they occur" },
        { value: "custom", label: "Something different", description: "Let me describe exactly what I need" }
      ],
      allowCustom: true
    };
    responseAnalysis.clarityScore = 25;
    responseAnalysis.questionsSequence?.push(q1);
  } else {  // Has plugins but prompt analysis failed - ask generic clarifying questions
    const q2: PromptAnalyzerSchedulingQuestion = {
      id: "automation_goal",
      dimension: "data",
      question: "Since I'm having trouble analyzing your request automatically, could you clarify what you want this automation to accomplish?",
      type: "single_choice",
      options: [
        { value: "data_analysis", label: "Data analysis and insights", description: "Analyze information and generate reports or insights" },
        { value: "content_processing", label: "Content processing", description: "Process, transform, or generate text and documents" },
        { value: "communication_automation", label: "Communication automation", description: "Automate notifications, alerts, or messaging" },
        { value: "workflow_automation", label: "Multi-step workflow", description: "Chain together multiple actions in sequence" },
        { value: "custom", label: "Different goal", description: "Let me specify the automation goal" }
      ],
      allowCustom: true
    };
    responseAnalysis.clarityScore = 35;
    responseAnalysis.questionsSequence?.push(q2);
  }
  return responseAnalysis;    
}    

// Enhanced parsing function that handles OpenAI responses
function parseAIResponse(rawContent: string): ClarityAnalysis {
  console.log('==================================================================================');
  console.log('🔍 Parsing AI response, length:', rawContent.length);
  const isDevEnv = process.env.NODE_ENV === 'development';
  console.log('📝 Raw content preview:', isDevEnv ? rawContent : rawContent.slice(0, 200) + '...');

  // Step 1: Try to extract JSON from the response
  let jsonContent = extractJSON(rawContent)
  
  // Step 2: If no JSON found, log the full content for debugging
  if (!jsonContent.startsWith('{') && !jsonContent.startsWith('[')) {
    console.error('❌ No valid JSON structure found in response')
    console.error('🔍 Full raw content:', rawContent)
    throw new Error('AI_RETURNED_PROSE_NOT_JSON')
  }
  
  // Step 3: Parse the JSON
  try {
    const parsed = JSON.parse(jsonContent)
    
    // CRITICAL: Check if parsed result is empty
    if (!parsed || (typeof parsed === 'object' && Object.keys(parsed).length === 0)) {
      console.error('❌ Parsed JSON is empty object')
      console.error('🔍 JSON content was:', jsonContent)
      throw new Error('AI_RETURNED_EMPTY_JSON_OBJECT')
    }
    
    console.log('✅ Successfully parsed AI JSON response')
    console.log('🔍 Parsed keys:', Object.keys(parsed))
    return parsed
  } catch (parseError: any) {
    console.error('❌ JSON parsing failed')
    console.error('🔍 JSON content was:', jsonContent.slice(0, 500))
    console.error('🔍 Parse error:', parseError.message)
    throw new Error('INVALID_JSON_FROM_AI')
  }
}

export async function POST(request: NextRequest) {
  console.log('🚀 API Route called - Using AI Analytics System with Activity Tracking')
  const isDevEnv = process.env.NODE_ENV === 'development';
  
  const getRequestBody = async (req: NextRequest) => {
    let requestBody;
    try {
      requestBody = await request.json()
      console.log('✅ Request body parsed successfully')
    } catch (bodyError) {
      logError('REQUEST_PARSING', bodyError)
      throw new Error('Invalid request body - Failed to parse JSON', { cause: 400 });      
    }
    return requestBody;
  }

  const validatePromptExists = (promptAnalyzer: PromptAnalyzer) => {
    if (!promptAnalyzer.hasPrompt()) {
      console.log('⚠️ Empty prompt provided')
      throw new Error('Prompt is required', { cause: 400 });       
    }
    return true;
  }  

  const getAnthropicProvider = (): AnthropicProvider => {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error('❌ Missing Anthropic API key, using fallback')
      throw new Error('Anthropic API key not configured', { cause: 400 });
    } else if (!aiAnalytics) {
      throw new Error('AI Analytics service not initialized');
    }
    // Initialize Anthropic provider with analytics
    return new AnthropicProvider(process.env.ANTHROPIC_API_KEY!, aiAnalytics);
  }

  try {
    // Step 1: Parse request body with enhanced error handling
    const requestBody = await getRequestBody(request);    

    // FIXED: Extract agent ID from request body or headers
    const { 
      prompt, 
      userId, 
      connectedPlugins = [], 
      sessionId: providedSessionId, 
      agentId: providedAgentId, // FIXED: Extract agent ID from request body
      bypassPluginValidation = false 
    } = requestBody as PromptRequestPayload;
    
    const userIdToUse = userId || request.headers.get('x-user-id') || 'anonymous'

    // FIXED: Use provided agent ID instead of generating new one
    const sessionId = providedSessionId && isValidUUID(providedSessionId) 
      ? providedSessionId 
      : request.headers.get('x-session-id') || uuidv4()

    // CRITICAL FIX: Use agent ID from request instead of generating new one
    const agentId = providedAgentId && isValidUUID(providedAgentId)
      ? providedAgentId
      : request.headers.get('x-agent-id') || uuidv4()

    console.log('✅ Request parameters with CONSISTENT AGENT ID:', { 
      hasPrompt: !!prompt,
      promptLength: prompt?.length || 0,
      userId: userIdToUse,
      providedSessionId,
      providedAgentId, // FIXED: Log provided agent ID
      sessionId: sessionId,
      agentId: agentId, // FIXED: Log final agent ID
      agentIdSource: providedAgentId ? 'request_body' : 
                     request.headers.get('x-agent-id') ? 'header' : 'generated',
      sessionIdGenerated: providedSessionId !== sessionId,
      agentIdFromRequest: !!providedAgentId, // FIXED: Track if agent ID came from request
      bypassPluginValidation,
      connectedPluginsCount: connectedPlugins.length
    })

    const promptAnalyzer = new PromptAnalyzer(prompt);

    // Step 2: Validate prompt existence
    validatePromptExists(promptAnalyzer);    

    // Step 3: Get connected plugins with error handling
    let connectedPluginsKeys: string[] = []
    let connectedPluginsMetaData: PluginDefinitionContext[] = []    
    let pluginWarning: any = {}
    const pluginManager = await PluginManagerV2.getInstance();

    try {

      // Step 4: Get User Plugins and Plugins Metadata for LLM context
      // TO FIX: call API - /app/api/plugins/user-status
      const userConnectedPlugins = await pluginManager.getUserActionablePlugins(userIdToUse);
      connectedPluginsKeys = Object.keys(userConnectedPlugins);
      console.log('✅ Connected plugins retrieved:', connectedPluginsKeys.length)
      
      connectedPluginsMetaData = pluginManager.convertToPluginDefinitionContext(userConnectedPlugins);      
      console.log('✅ Plugin metadata retrieved:', {
        pluginsWithMetadata: connectedPluginsMetaData.length,
        capabilities: connectedPluginsMetaData.map(p => ({ key: p.key, capabilities: p.capabilities.join(', ') }))
      })    

      // Step 5: Check for mentioned unconnected services (for warning only)      
      // Check for services in registry but not connected
      //const availablePlugins = pluginManager.getAvailablePlugins();            
      //pluginWarning = promptAnalyzer.generateWarningIfMenthodMissingServices(connectedPluginsKeys, Object.keys(availablePlugins));      
    } catch (error: any) {
      logError('UNEXPECTED_ERROR', error)
    }

    // TO REMOVE - do we need this???
    // Step 6: Check OpenAI API key
    // if (!process.env.OPENAI_API_KEY) {
    //   console.error('❌ Missing OpenAI API key, using fallback')

    //   // CRITICAL: Include requirements analysis in fallback
    //   const fallbackWithAnalysis = createFallbackResponse(promptAnalyzer, connectedPluginsMetaData)
      
    //   return NextResponse.json({ 
    //     ...fallbackWithAnalysis,
    //     connectedPlugins: connectedPluginsKeys,
    //     connectedPluginData: connectedPluginsMetaData,
    //     sessionId: sessionId, // FIXED: Return consistent session ID
    //     agentId: agentId, // FIXED: Return consistent agent ID
    //     ...(pluginWarning && { pluginWarning }),
    //     error: 'OpenAI API key not configured'
    //   })
    // }

    console.log('✅ All validations passed, calling Claude Sonnet 4 with CONSISTENT AGENT ID...')

    // Step 7: Call Claude Sonnet 4 with AI Analytics tracking INCLUDING CONSISTENT AGENT ID
    let aiResult: ClarityAnalysis
    let anthropicResponse: any
    
    try {
      // Initialize Anthropic provider with analytics
      const anthropicProvider = getAnthropicProvider()
      
      console.log('==================================================================================');
      console.log('📊 Making tracked AI call with CONSISTENT AGENT ID:', {
        userId: userIdToUse,
        sessionId: sessionId,
        agentId: agentId, // FIXED: Using consistent agent ID
        sessionIdValid: isValidUUID(sessionId),
        agentIdValid: isValidUUID(agentId),
        agentIdSource: providedAgentId ? 'request' : 'generated'
      })
      
      // Make tracked AI call with ACTIVITY TRACKING and CONSISTENT AGENT ID
      const aiSystemPrompt = buildAISystemPrompt(connectedPluginsMetaData);
      const aiUserPrompt = promptAnalyzer.getPrompt();

      if (isDevEnv) {
        console.log('==================================================================================');
        console.log('🤖 AI System Prompt:', aiSystemPrompt);
        console.log('==================================================================================');
        console.log('🤖 AI User Prompt:', aiUserPrompt);
        console.log('==================================================================================');
      }
;
      anthropicResponse = await anthropicProvider.chatCompletion(
        {
          model: ANTHROPIC_MODELS.CLAUDE_4_SONNET,
          messages: [
            {
              role: 'system',
              content:  aiSystemPrompt + "\n\nIMPORTANT: You MUST respond with valid JSON only. No markdown, no explanations, just pure JSON."
            },
            {
              role: 'user',
              //content: `Analyze this automation request and respond with JSON only: "${promptAnalyzer.getPrompt()}"`
              content: aiUserPrompt
            }
          ],
          temperature: 0.1,
          max_tokens: 2000
        },
        {
          userId: userIdToUse,
          sessionId: sessionId, // FIXED: Consistent session ID
          feature: 'prompt_analysis',
          component: 'smart-prompt-analyze',
          workflow_step: 'ai_analysis',
          category: 'agent_creation',
          // Activity tracking fields with CONSISTENT AGENT ID
          activity_type: 'agent_creation',
          activity_name: 'Analyzing prompt clarity for workflow automation',
          activity_step: 'prompt_analysis',
          agent_id: agentId // FIXED: Consistent agent ID for analytics tracking
        }
      )
      
      console.log('✅ Claude API call completed with analytics and CONSISTENT AGENT ID tracking')

    } catch (fetchError: any) {
      logError('CLAUDE_FETCH', fetchError)

      // CRITICAL: Include requirements analysis in error fallback
      const fallbackWithAnalysis = createFallbackResponse(promptAnalyzer, connectedPluginsMetaData)
      
      return NextResponse.json(
        {
          error: 'Claude API connection failed',
          details: fetchError.message,
          ...fallbackWithAnalysis,
          connectedPlugins : connectedPluginsKeys,
          connectedPluginsMetaData,
          sessionId: sessionId, // FIXED: Return consistent session ID
          agentId: agentId, // FIXED: Return consistent agent ID
          ...(pluginWarning && { pluginWarning })
        },
        { status: 500 }
      )
    }

    const rawContent = anthropicResponse.choices?.[0]?.message?.content
    if (!rawContent) {
      console.error('❌ Empty Claude response content')

      // CRITICAL: Include requirements analysis in empty response fallback
      const fallbackWithAnalysis = createFallbackResponse(promptAnalyzer, connectedPluginsMetaData)
      
      return NextResponse.json(
        { 
          error: 'Empty AI response',
          ...fallbackWithAnalysis,
          connectedPlugins: connectedPluginsKeys,
          connectedPluginsMetaData,
          sessionId: sessionId, // FIXED: Return consistent session ID
          agentId: agentId, // FIXED: Return consistent agent ID
          ...(pluginWarning && { pluginWarning })
        },
        { status: 500 }
      )
    }

    // Step 8: Parse AI result with enhanced error handling and validation
    try {
      aiResult = parseAIResponse(rawContent)

      // CRITICAL: Validate the parsed result has required structure
      if (!aiResult || Object.keys(aiResult).length === 0) {
        console.error('❌ AI returned empty object, raw content:', rawContent.slice(0, 500))
        throw new Error('AI_RETURNED_EMPTY_OBJECT')
      } else if (isDevEnv) {
        console.log('==================================================================================');
        console.log('🔍 AI result structure and content:', aiResult);
      }

      // Ensure required fields exist
      const requiredFields = ['clarityScore', 'needsClarification']
      const missingFields = requiredFields.filter(field => !(field in aiResult))
      if (missingFields.length > 0) {
        console.error('❌ AI response missing required fields:', {
          missing: missingFields,
          received: Object.keys(aiResult),
          rawContent: rawContent.slice(0, 300)
        })
        throw new Error(`AI_MISSING_FIELDS: ${missingFields.join(', ')}`)
      }

      // Add defaults for missing optional fields
      if (!aiResult.hasOwnProperty('questionsSequence')) {
        aiResult.questionsSequence = []
      }

      // CRITICAL: If AI didn't return analysis, generate it ourselves
      if (!aiResult.hasOwnProperty('analysis') || !aiResult.analysis) {
        console.log('🔧 AI did not return analysis, generating requirements analysis...')
        aiResult.analysis = promptAnalyzer.analyzeRequirements(aiResult.clarityScore, connectedPluginsKeys);
      }

      console.log('==================================================================================');
      console.log('✅ AI result validated:', {
        hasClarityScore: 'clarityScore' in aiResult,
        hasQuestions: Array.isArray(aiResult.questionsSequence) && aiResult.questionsSequence.length > 0,
        questionCount: aiResult.questionsSequence?.length || 0,
        hasAnalysis: 'analysis' in aiResult,
        analysisKeys: Object.keys(aiResult.analysis || {})
      })
      
    } catch (aiParseError: any) {
      logError('AI_RESULT_PARSING', aiParseError, { 
        responsePreview: rawContent.slice(0, 500),
        fullResponse: rawContent 
      })
      
      console.log('🔄 Using smart fallback for automation request')
      aiResult = createFallbackResponse(promptAnalyzer, connectedPluginsMetaData)
      //aiResult.aiParsingFailed = true
      //aiResult.originalError = aiParseError.message
    }

    // Step 9: Add scheduling questions and validate consistency
    // try {
    //   aiResult = validateConsistency(aiResult, promptAnalyzer, connectedPluginsMetaData)
    // } catch (consistencyError) {
    //   logError('CONSISTENCY_VALIDATION', consistencyError)
    // }

    // Step 10: Build final response with CONSISTENT AGENT ID
    const finalResult: PromptResponsePayload = {
      prompt: promptAnalyzer.getPrompt(),
      userId: userIdToUse,
      sessionId: sessionId,
      agentId: agentId,
      connectedPlugins: connectedPluginsKeys,
      connectedPluginsData: connectedPluginsMetaData.map(p => p.toShortLLMContext()),
      analysis: aiResult
      //pluginValidationError: false,
      //sessionId: sessionId, // FIXED: Return consistent session ID
      //agentId: agentId, // FIXED: Return consistent agent ID
      //...(pluginWarning && { pluginWarning }) // not needed as aiResult has this node
    }

    console.log('==================================================================================');
    console.log('✅ Request completed successfully with CONSISTENT AGENT ID:', {
      clarityScore: finalResult.analysis.clarityScore,
      questionsCount: finalResult.analysis.questionsSequence?.length || 0,
      needsClarification: finalResult.analysis.needsClarification,
      //aiParsingFailed: finalResult.aiParsingFailed || false,
      pluginDataIncluded: finalResult.connectedPluginsData && finalResult.connectedPluginsData.length > 0,
      pluginWarningCreated: !!pluginWarning,
      analyticsTracked: true,
      activityTracked: true,
      sessionId: finalResult.sessionId,
      agentId: finalResult.agentId,
      agentIdConsistent: providedAgentId === finalResult.agentId
    })

    return NextResponse.json(finalResult)

  } catch (error: any) {
    logError('UNEXPECTED_ERROR', error)
    
    return NextResponse.json(
      { 
        error: 'Unexpected server error',
        details: error.message,
        stack: isDevEnv ? error.stack : undefined,
        ...createFallbackResponse(new PromptAnalyzer('')),
        connectedPluginData: []
      },
      { status: (error as any).cause || 500 }
    )
  }
}