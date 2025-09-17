import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Token tracking function
async function trackTokenUsage(supabase: any, userId: string, tokenData: any) {
  try {
    const { error } = await supabase
      .from('token_usage')
      .insert({
        user_id: userId,
        model_name: tokenData.modelName,
        provider: tokenData.provider,
        input_tokens: tokenData.inputTokens,
        output_tokens: tokenData.outputTokens,
        cost_usd: 0.0,
        request_type: tokenData.requestType || 'chat',
        session_id: null,
        category: tokenData.category || 'prompt_analysis',
        metadata: tokenData.metadata || {}
      })
    
    if (error) {
      console.error('Token tracking error:', error)
      throw error
    }
  } catch (error) {
    console.error('Failed to track token usage:', error)
  }
}

// Extract JSON from markdown code blocks
function extractJSON(content: string): string {
  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (jsonMatch) {
    return jsonMatch[1].trim()
  }
  return content.trim()
}

// Plugin requirements for validation
const PLUGIN_REQUIREMENTS = {
  'google drive': ['googledrive', 'google_drive', 'drive', 'google-drive'],
  'google sheets': ['googlesheets', 'google_sheets', 'sheets'],
  'gmail': ['gmail', 'email', 'google_email', 'google-mail'],
  'dropbox': ['dropbox'],
  'slack': ['slack'],
  'notion': ['notion'],
  'airtable': ['airtable'],
  'calendar': ['calendar', 'google_calendar', 'gcal'],
  'onedrive': ['onedrive', 'microsoft_onedrive'],
  'trello': ['trello'],
  'asana': ['asana'],
  'monday': ['monday', 'monday_com']
}

// Detect required plugins from user prompt
function detectRequiredPlugins(prompt: string): string[] {
  const lowerPrompt = prompt.toLowerCase()
  const requiredPlugins: string[] = []
  
  for (const [service, aliases] of Object.entries(PLUGIN_REQUIREMENTS)) {
    if (aliases.some(alias => lowerPrompt.includes(alias))) {
      requiredPlugins.push(service)
    }
  }
  
  console.log(`Detected required plugins: ${requiredPlugins}`)
  return requiredPlugins
}

// Validate plugin requirements (simplified)
function validatePluginRequirements(prompt: string, connectedPlugins: string[]): { 
  isValid: boolean, 
  missingPlugins: string[],
  requiredServices: string[]
} {
  const requiredPlugins = detectRequiredPlugins(prompt)
  const missingPlugins: string[] = []
  
  for (const required of requiredPlugins) {
    const aliases = PLUGIN_REQUIREMENTS[required as keyof typeof PLUGIN_REQUIREMENTS] || [required]
    const isConnected = aliases.some(alias => 
      connectedPlugins.some(connected => 
        connected.toLowerCase().includes(alias.toLowerCase())
      )
    )
    
    if (!isConnected) {
      missingPlugins.push(required)
    }
  }
  
  return {
    isValid: missingPlugins.length === 0,
    missingPlugins,
    requiredServices: requiredPlugins
  }
}

// Get connected plugins
async function getConnectedPlugins(userId: string, connected_plugins?: any): Promise<string[]> {
  let pluginKeys: string[] = []

  // Method 1: From frontend
  if (connected_plugins && typeof connected_plugins === 'object') {
    pluginKeys = Object.keys(connected_plugins)
    console.log(`Plugins from frontend: ${pluginKeys}`)
  }

  // Method 2: From database
  try {
    const { data, error } = await supabase
      .from('plugin_connections')
      .select('plugin_key, status')
      .eq('user_id', userId)
      .eq('status', 'active')

    if (!error && data && data.length > 0) {
      const dbPlugins = data.map(connection => connection.plugin_key)
      pluginKeys = [...new Set([...pluginKeys, ...dbPlugins])]
      console.log(`Plugins from database: ${dbPlugins}`)
    } else {
      console.log(`No plugins found in database for user ${userId}`)
    }
  } catch (dbError) {
    console.warn('Could not fetch plugins from database:', dbError)
  }

  console.log(`Final connected plugins for user ${userId}:`, pluginKeys)
  return pluginKeys
}

// AI system prompt for analyzing automation requests
function buildAISystemPrompt(connectedPlugins: string[], userPrompt: string) {
  return `You are an expert automation analyst. Analyze the user's request and identify ALL missing critical details needed for implementation.

USER REQUEST: "${userPrompt}"
CONNECTED SERVICES: ${connectedPlugins.length > 0 ? connectedPlugins.join(', ') : 'None'}

REQUIRED AUTOMATION DETAILS - ASK ABOUT ANY THAT ARE MISSING:

1. DATA/WHAT TO MONITOR: What specific thing to track (stock symbol, file type, email criteria, etc.)
2. TRIGGER/THRESHOLD: What condition triggers the action (price level, file size, keyword, etc.)  
3. TIMING/WHEN TO RUN: How often to check (every 5 minutes, hourly, daily, real-time, etc.)
4. OUTPUT/WHAT TO CREATE: What gets generated (alert message, report, summary, notification, etc.)
5. DELIVERY/HOW TO DELIVER: How to send results (email, SMS, push notification, save to file, etc.)
6. ERROR HANDLING: What to do when things fail (retry X times, send error alert, log and continue, etc.)

ANALYSIS RULES:
- Check each dimension: is it clearly specified, partially mentioned, or completely missing?
- Ask about EVERY dimension that is missing or unclear - don't limit questions
- Generate 4-6 questions to cover all missing essential details
- Don't assume timing - if not specified, ask about frequency/schedule
- Don't assume output format - if unclear, ask what should be created
- Don't assume error handling - if not mentioned, ask how to handle failures

FOR STOCK MONITORING EXAMPLE:
From "I want to monitor stock and send alert once reach to certain number":
- Data: "stock" mentioned but which symbol? → ASK
- Trigger: "certain number" mentioned but what price? → ASK  
- Timing: Not mentioned - how often to check? → ASK
- Output: "alert" mentioned but what should it contain? → ASK
- Delivery: "send" mentioned but how (email/SMS/notification)? → ASK
- Error Handling: Not mentioned - what if stock API fails? → ASK

EXPECTED QUESTIONS FOR STOCK MONITORING:
1. Which stock symbol would you like to monitor?
2. What price should trigger the alert?
3. How often should I check the stock price?
4. What information should the alert contain?
5. How should I deliver the alert to you?
6. How should I handle errors if stock data is unavailable?

CLARITY SCORING:
- 90-100: All 6 dimensions clearly specified
- 70-89: 1-2 dimensions missing
- 50-69: 3-4 dimensions missing
- 30-49: Most dimensions missing
- 0-29: Unclear automation intent

Return JSON:
{
  "needsClarification": boolean,
  "clarityScore": number,
  "questionsSequence": [
    {
      "id": "question_id",
      "dimension": "data|timing|delivery|output|error_handling",
      "question": "Specific question?",
      "type": "single_choice",
      "options": [
        { "value": "value", "label": "Label", "description": "Description" }
      ],
      "allowCustom": true
    }
  ],
  "analysis": {
    "data": { "status": "clear|partial|missing", "detected": "what was found" },
    "timing": { "status": "clear|partial|missing", "detected": "timing found" },
    "output": { "status": "clear|partial|missing", "detected": "output found" },
    "actions": { "status": "clear|partial|missing", "detected": "actions found" },
    "delivery": { "status": "clear|partial|missing", "detected": "delivery found" },
    "error_handling": { "status": "clear|partial|missing", "detected": "error handling found" }
  }
}`
}

// Validate AI response for quality
function validateAIResponse(aiResult: any, prompt: string): { isValid: boolean, reason?: string } {
  const promptLower = prompt.toLowerCase()
  
  if (!aiResult.clarityScore || !Array.isArray(aiResult.questionsSequence)) {
    return { isValid: false, reason: 'Invalid response structure' }
  }
  
  // Check for irrelevant questions
  if (aiResult.questionsSequence.length > 0) {
    for (const question of aiResult.questionsSequence) {
      const qLower = question.question.toLowerCase()
      
      // Stock monitoring shouldn't have file/email scope questions
      if ((promptLower.includes('stock') || promptLower.includes('price')) && 
          !promptLower.includes('email') && !promptLower.includes('file')) {
        if (qLower.includes('file') || qLower.includes('document') || 
            qLower.includes('email scope') || qLower.includes('which emails')) {
          return { isValid: false, reason: 'Irrelevant questions for stock monitoring' }
        }
      }
      
      // File processing shouldn't have stock questions
      if ((promptLower.includes('file') || promptLower.includes('document')) && 
          !promptLower.includes('stock') && !promptLower.includes('price')) {
        if (qLower.includes('stock') || qLower.includes('price') || qLower.includes('ticker')) {
          return { isValid: false, reason: 'Stock questions for file processing' }
        }
      }
      
      // Check for generic questions
      if (qLower.includes('provide more details') || qLower.includes('tell me more')) {
        return { isValid: false, reason: 'Generic questions detected' }
      }
    }
  }
  
  return { isValid: true }
}

// Apply consistency checks
function validateConsistency(result: any): any {
  const questionCount = result.questionsSequence?.length || 0
  
  // Adjust clarity score if it doesn't match question count
  if (result.clarityScore > 75 && questionCount > 2) {
    console.log('Adjusting clarity score due to high question count')
    result.clarityScore = Math.max(55, result.clarityScore - (questionCount * 12))
  }
  
  // Force clarification if score is low but no questions
  if (result.clarityScore < 65 && questionCount === 0) {
    console.log('Low clarity but no questions - forcing clarification')
    result.needsClarification = true
  }
  
  result.needsClarification = questionCount > 0 || result.clarityScore < 65
  
  return result
}

// Fallback response
const createFallbackResponse = () => ({
  needsClarification: true,
  clarityScore: 30,
  questionsSequence: [
    {
      id: "automation_type",
      dimension: "data",
      question: "What type of automation would you like to create?",
      type: "single_choice",
      options: [
        { value: "stock_monitoring", label: "Stock price monitoring", description: "Monitor stock prices and get alerts" },
        { value: "file_processing", label: "File processing", description: "Analyze or process files automatically" },
        { value: "email_automation", label: "Email automation", description: "Automate email tasks" },
        { value: "data_monitoring", label: "Data monitoring", description: "Monitor data changes" },
        { value: "custom", label: "Something else", description: "Different type of automation" }
      ],
      allowCustom: true
    }
  ],
  analysis: {
    data: { status: "missing", detected: "" },
    timing: { status: "missing", detected: "" },
    output: { status: "missing", detected: "" },
    actions: { status: "missing", detected: "" },
    delivery: { status: "missing", detected: "" },
    error_handling: { status: "missing", detected: "" }
  }
})

// Request cache for deduplication
const requestCache = new Map<string, { 
  timestamp: number, 
  promise: Promise<any>,
  result?: any 
}>()

const CACHE_DURATION = 5 * 60 * 1000

const cleanupCache = () => {
  const now = Date.now()
  for (const [key, value] of requestCache.entries()) {
    if (now - value.timestamp > CACHE_DURATION) {
      requestCache.delete(key)
    }
  }
}
setInterval(cleanupCache, 60 * 1000)

export async function POST(request: NextRequest) {
  console.log('API Route called - Simplified Prompt Analysis')
  
  try {
    let requestBody
    try {
      requestBody = await request.json()
    } catch (bodyError) {
      console.error('Failed to parse request body:', bodyError)
      return NextResponse.json(
        { error: 'Invalid request body', ...createFallbackResponse() },
        { status: 400 }
      )
    }

    const { prompt, userId, connected_plugins = {}, bypassPluginValidation = false } = requestBody
    const userIdToUse = userId || request.headers.get('x-user-id') || 'anonymous'

    console.log('Received:', { 
      prompt: prompt?.slice(0, 100), 
      userId: userIdToUse,
      bypassPluginValidation: bypassPluginValidation
    })

    if (!prompt?.trim()) {
      console.log('Empty prompt provided')
      return NextResponse.json(
        { error: 'Prompt is required', ...createFallbackResponse() },
        { status: 400 }
      )
    }

    // Get connected plugins once, reuse throughout
    const connectedPlugins = await getConnectedPlugins(userIdToUse, connected_plugins)

    // FIXED: Keep original prompt, only create warning if needed
    const finalPrompt = prompt.trim() // Use original prompt unchanged
    let pluginWarning = null
    
    if (!bypassPluginValidation) {
      const pluginValidation = validatePluginRequirements(prompt, connectedPlugins)
      
      if (!pluginValidation.isValid) {
        console.log('Missing required plugins:', pluginValidation.missingPlugins)
        
        // Create warning message - but don't modify the prompt
        pluginWarning = {
          missingServices: pluginValidation.missingPlugins,
          message: `Note: Your request mentions ${pluginValidation.missingPlugins.join(', ')} but ${pluginValidation.missingPlugins.length === 1 ? 'this service isn\'t' : 'these services aren\'t'} connected. I'll help you create the automation using your available services instead.`
        }
        
        console.log('Plugin validation warning created, but keeping original prompt intact')
      }
    }

    if (!process.env.OPENAI_API_KEY) {
      console.error('Missing OpenAI API key, using fallback')
      return NextResponse.json({ 
        ...createFallbackResponse(),
        connectedPlugins: connectedPlugins,
        pluginWarning
      })
    }

    const cacheKey = `${userIdToUse}-${finalPrompt}-${connectedPlugins.join(',')}-${bypassPluginValidation ? 'bypass' : 'normal'}-v6`
    const now = Date.now()

    const cached = requestCache.get(cacheKey)
    if (cached && (now - cached.timestamp) < CACHE_DURATION) {
      console.log('Returning cached result')
      if (cached.result) {
        return NextResponse.json(cached.result)
      } else {
        try {
          const result = await cached.promise
          return NextResponse.json(result)
        } catch (error) {
          requestCache.delete(cacheKey)
        }
      }
    }

    const systemPrompt = buildAISystemPrompt(connectedPlugins, finalPrompt)
    console.log('Calling OpenAI for analysis...')

    const processingPromise = async () => {
      let response
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 25000)

        response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: `Analyze this automation request: "${finalPrompt}"` }
            ],
            temperature: 0.1,
            max_tokens: 1000
          }),
          signal: controller.signal
        })

        clearTimeout(timeoutId)
      } catch (fetchError: any) {
        console.error('OpenAI API fetch failed:', fetchError.message)
        throw new Error(`Failed to connect to OpenAI API: ${fetchError.message}`)
      }

      if (!response.ok) {
        console.error(`OpenAI API error: ${response.status}`)
        const errorText = await response.text().catch(() => 'Unknown error')
        throw new Error(`OpenAI API request failed: ${response.status} - ${errorText}`)
      }

      const data = await response.json()
      const rawContent = data.choices?.[0]?.message?.content

      if (!rawContent) {
        throw new Error('Empty response from OpenAI')
      }

      const cleanedContent = extractJSON(rawContent)
      let aiResult
      
      try {
        aiResult = JSON.parse(cleanedContent)
      } catch (parseError) {
        console.error('Failed to parse AI response:', cleanedContent.slice(0, 200))
        throw new Error('Invalid JSON response from AI')
      }

      const validation = validateAIResponse(aiResult, finalPrompt)
      if (!validation.isValid) {
        console.log(`AI response validation failed: ${validation.reason}`)
        aiResult = createFallbackResponse()
        aiResult.aiValidationFailed = true
        aiResult.validationFailureReason = validation.reason
      }

      aiResult = validateConsistency(aiResult)

      const finalResult = {
        ...aiResult,
        connectedPlugins: connectedPlugins,
        pluginValidationError: false,
        ...(pluginWarning && { pluginWarning })
      }

      if (userIdToUse !== 'anonymous') {
        try {
          await trackTokenUsage(supabase, userIdToUse, {
            modelName: 'gpt-4o',
            provider: 'openai',
            inputTokens: data.usage?.prompt_tokens || 0,
            outputTokens: data.usage?.completion_tokens || 0,
            requestType: 'analysis',
            category: 'smart_prompt_analysis',
            metadata: {
              clarityScore: finalResult.clarityScore,
              questionsCount: finalResult.questionsSequence?.length || 0,
              connectedPlugins,
              aiValidationFailed: finalResult.aiValidationFailed || false,
              validationFailureReason: finalResult.validationFailureReason,
              bypassPluginValidation: bypassPluginValidation || false,
              hadPluginWarning: !!pluginWarning,
              missingServices: pluginWarning?.missingServices || []
            }
          })
        } catch (trackingError) {
          console.warn('Usage tracking failed:', trackingError)
        }
      }

      return finalResult
    }

    requestCache.set(cacheKey, {
      timestamp: now,
      promise: processingPromise()
    })

    try {
      const result = await requestCache.get(cacheKey)!.promise
      
      const cachedEntry = requestCache.get(cacheKey)
      if (cachedEntry) {
        cachedEntry.result = result
      }

      console.log('AI analysis complete:', {
        clarityScore: result.clarityScore,
        questionsCount: result.questionsSequence?.length || 0,
        needsClarification: result.needsClarification,
        aiValidationFailed: result.aiValidationFailed || false,
        bypassedPluginValidation: bypassPluginValidation || false,
        hadPluginWarning: !!result.pluginWarning
      })

      return NextResponse.json(result)

    } catch (processingError: any) {
      requestCache.delete(cacheKey)
      console.error('Processing error:', processingError.message)
      
      return NextResponse.json(
        { 
          error: 'AI analysis failed',
          details: processingError.message,
          ...createFallbackResponse(),
          connectedPlugins: connectedPlugins || [],
          ...(pluginWarning && { pluginWarning })
        },
        { status: 500 }
      )
    }

  } catch (error: any) {
    console.error('Unexpected error in AI analysis:', error.message)
    
    return NextResponse.json(
      { 
        error: 'Unexpected server error',
        details: error.message,
        ...createFallbackResponse()
      },
      { status: 500 }
    )
  }
}