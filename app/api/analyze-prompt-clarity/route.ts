import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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
try {
  if (validateEnvironment()) {
    supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    console.log('✅ Supabase client created successfully')
  }
} catch (error) {
  logError('SUPABASE_INIT', error)
}

// Enhanced token tracking with error handling
async function trackTokenUsage(supabase: any, userId: string, tokenData: any) {
  if (!supabase) {
    console.warn('⚠️ Skipping token tracking - Supabase client not available')
    return
  }

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
      logError('TOKEN_TRACKING', error, { userId, tokenData })
    } else {
      console.log('✅ Token usage tracked successfully')
    }
  } catch (error) {
    logError('TOKEN_TRACKING_CATCH', error, { userId })
  }
}

// Enhanced plugin fetching with better error handling
async function getConnectedPlugins(userId: string, connected_plugins?: any): Promise<string[]> {
  let pluginKeys: string[] = []

  // Method 1: From frontend
  if (connected_plugins && typeof connected_plugins === 'object') {
    try {
      pluginKeys = Object.keys(connected_plugins)
      console.log(`✅ Plugins from frontend: ${pluginKeys}`)
    } catch (error) {
      logError('FRONTEND_PLUGINS', error, { connected_plugins })
    }
  }

  // Method 2: From database (with better error handling)
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('plugin_connections')
        .select('plugin_key, status')
        .eq('user_id', userId)
        .eq('status', 'active')

      if (error) {
        logError('DB_PLUGINS_QUERY', error, { userId })
      } else if (data && data.length > 0) {
        const dbPlugins = data.map(connection => connection.plugin_key)
        pluginKeys = [...new Set([...pluginKeys, ...dbPlugins])]
        console.log(`✅ Plugins from database: ${dbPlugins}`)
      } else {
        console.log(`ℹ️ No plugins found in database for user ${userId}`)
      }
    } catch (dbError) {
      logError('DB_PLUGINS_CATCH', dbError, { userId })
    }
  } else {
    console.warn('⚠️ Skipping database plugin lookup - Supabase client not available')
  }

  console.log(`✅ Final connected plugins for user ${userId}:`, pluginKeys)
  return pluginKeys
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

// Smart scheduling question generator
function generateSchedulingQuestions(userPrompt: string): any[] {
  const promptLower = userPrompt.toLowerCase();
  
  // Check if user already specified timing in prompt
  const hasTimingInPrompt = promptLower.includes('daily') || 
                           promptLower.includes('weekly') || 
                           promptLower.includes('monthly') ||
                           promptLower.includes('every') ||
                           promptLower.includes('schedule') ||
                           /\d+\s*(am|pm|hour|minute)/.test(promptLower);
                           
  if (hasTimingInPrompt) {
    console.log('Timing already specified in prompt, skipping scheduling questions');
    return [];
  }
  
  // Email automations
  if (promptLower.includes('email') || promptLower.includes('inbox') || promptLower.includes('gmail')) {
    return [
      {
        id: 'email_schedule',
        dimension: 'timing',
        question: "When should this email automation run?",
        type: 'single_choice',
        options: [
          { value: 'new_emails', label: 'When new emails arrive', description: 'Process emails immediately as they come in (real-time)' },
          { value: 'daily_9am', label: 'Daily at 9:00 AM', description: 'Process all unread emails once per day' },
          { value: 'daily_8am', label: 'Daily at 8:00 AM', description: 'Start of day email processing' },
          { value: 'every_2h_work', label: 'Every 2 hours (9 AM - 5 PM)', description: 'Regular processing during work hours' },
          { value: 'twice_daily', label: 'Twice daily (9 AM & 5 PM)', description: 'Morning and evening processing' },
          { value: 'weekly_monday', label: 'Weekly on Monday 9 AM', description: 'Weekly email summary' }
        ],
        allowCustom: false
      }
    ];
  }
  
  // Default for general automations
  return [
    {
      id: 'automation_schedule',
      dimension: 'timing',
      question: "When should this automation run?",
      type: 'single_choice',
      options: [
        { value: 'daily_9am', label: 'Daily at 9:00 AM', description: 'Once per day at start of work' },
        { value: 'weekly_monday', label: 'Weekly on Monday 9:00 AM', description: 'Once per week at start of work week' },
        { value: 'monthly_1st', label: 'Monthly on 1st at 9:00 AM', description: 'Once per month on first day' },
        { value: 'on_demand', label: 'On-demand only', description: 'Manual trigger when needed' },
        { value: 'twice_daily', label: 'Twice daily (9 AM & 5 PM)', description: 'Start and end of work day' }
      ],
      allowCustom: true
    }
  ];
}

// Enhanced AI system prompt that FORCES JSON response
function buildAISystemPrompt(connectedPlugins: string[], userPrompt: string) {
  return `You are an expert automation analyst. You MUST respond with valid JSON only.

USER REQUEST: "${userPrompt}"
CONNECTED SERVICES: ${connectedPlugins.length > 0 ? connectedPlugins.join(', ') : 'None'}

CRITICAL: You must respond with valid JSON. Do not include any text outside the JSON structure.

REQUIRED AUTOMATION DETAILS - ASK ABOUT ANY THAT ARE MISSING:

1. DATA/WHAT TO MONITOR: What specific thing to track (email criteria, file type, etc.)
2. TRIGGER/THRESHOLD: What condition triggers the action (keyword found, file received, etc.)  
3. OUTPUT/WHAT TO CREATE: What gets generated (alert message, report, summary, notification, etc.)
4. DELIVERY/HOW TO DELIVER: How to send results (email, SMS, save to file, etc.)
5. ERROR HANDLING: What to do when things fail (retry, send error alert, log and continue, etc.)

CRITICAL TIMING REQUIREMENT:
DO NOT include timing/frequency/scheduling questions in your response. The system will automatically add appropriate scheduling questions based on the automation context. Focus only on the other dimensions above.

ANALYSIS RULES:
- Check each dimension: is it clearly specified, partially mentioned, or completely missing?
- Ask about dimensions that are missing or unclear (except timing - that's handled automatically)
- Generate 2-4 content questions, avoiding timing since it's added separately
- Don't assume output format - if unclear, ask what should be created
- Don't assume error handling - if not mentioned, ask how to handle failures
- ONLY use connected services in your questions and suggestions

CLARITY SCORING:
- 90-100: All 6 dimensions clearly specified
- 70-89: 1-2 dimensions missing
- 50-69: 3-4 dimensions missing
- 30-49: Most dimensions missing
- 0-29: Unclear automation intent

You MUST return ONLY this JSON structure:
{
  "needsClarification": boolean,
  "clarityScore": number,
  "questionsSequence": [
    {
      "id": "question_id",
      "dimension": "data|output|delivery|error_handling",
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

// Apply consistency checks and add scheduling questions
function validateConsistency(result: any, userPrompt: string): any {
  const scheduleQuestions = generateSchedulingQuestions(userPrompt)
  console.log(`Generated ${scheduleQuestions.length} scheduling questions for consistency check`)
  
  if (scheduleQuestions.length > 0) {
    result.questionsSequence = [...(result.questionsSequence || []), ...scheduleQuestions]
    console.log(`Added ${scheduleQuestions.length} scheduling questions. Total questions: ${result.questionsSequence.length}`)
  }
  
  const finalQuestionCount = result.questionsSequence?.length || 0
  
  // Adjust clarity score if it doesn't match question count
  if (result.clarityScore > 75 && finalQuestionCount > 2) {
    console.log('Adjusting clarity score due to high question count')
    result.clarityScore = Math.max(55, result.clarityScore - (finalQuestionCount * 10))
  }
  
  // Always need clarification if we have any questions (including scheduling)
  result.needsClarification = finalQuestionCount > 0 || result.clarityScore < 65
  
  return result
}

// Smart fallback for Gmail/Drive automation
const createFallbackResponse = (userPrompt: string = '') => {
  const scheduleQuestions = generateSchedulingQuestions(userPrompt)
  const promptLower = userPrompt.toLowerCase()
  
  // Specific fallback for Gmail/Drive automation
  if (promptLower.includes('gmail') && promptLower.includes('google drive')) {
    return {
      needsClarification: true,
      clarityScore: 40,
      questionsSequence: [
        {
          id: "email_search_criteria",
          dimension: "data",
          question: "How should I identify which emails contain invoices?",
          type: "single_choice",
          options: [
            { value: "attachment_name", label: "Look for files with 'invoice' in filename", description: "Search attachment names for keyword 'invoice'" },
            { value: "email_subject", label: "Check email subject for 'invoice'", description: "Look at email subjects containing 'invoice'" },
            { value: "email_content", label: "Scan email content for invoice keywords", description: "Search email body text for invoice-related terms" },
            { value: "pdf_attachments", label: "Check all PDF attachments", description: "Examine all PDF files attached to emails" },
            { value: "custom", label: "Other criteria", description: "Let me specify different search criteria" }
          ],
          allowCustom: true
        },
        {
          id: "drive_location",
          dimension: "delivery",
          question: "Where in Google Drive should I save the invoice?",
          type: "single_choice",
          options: [
            { value: "root", label: "Main Drive folder", description: "Save directly in the root of Google Drive" },
            { value: "invoices_folder", label: "Create/use 'Invoices' folder", description: "Organize invoices in a dedicated folder" },
            { value: "monthly_folder", label: "Create monthly folders (e.g., '2025-01')", description: "Organize by month automatically" },
            { value: "custom", label: "Specific folder path", description: "Let me specify the exact folder location" }
          ],
          allowCustom: true
        },
        ...scheduleQuestions
      ],
      analysis: {
        data: { status: "partial", detected: "Gmail search, attachment with invoice" },
        timing: { status: "missing", detected: "" },
        output: { status: "partial", detected: "Copy invoice to Google Drive" },
        actions: { status: "partial", detected: "Search, find, copy" },
        delivery: { status: "partial", detected: "Google Drive storage" },
        error_handling: { status: "missing", detected: "" }
      }
    }
  }
  
  // General fallback
  return {
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
      },
      ...scheduleQuestions
    ],
    analysis: {
      data: { status: "missing", detected: "" },
      timing: { status: "missing", detected: "" },
      output: { status: "missing", detected: "" },
      actions: { status: "missing", detected: "" },
      delivery: { status: "missing", detected: "" },
      error_handling: { status: "missing", detected: "" }
    }
  }
}

// Enhanced parsing function that handles OpenAI responses
function parseAIResponse(rawContent: string): any {
  console.log('🔍 Parsing AI response, length:', rawContent.length)
  console.log('📝 Raw content preview:', rawContent.slice(0, 200) + '...')
  
  // Step 1: Try to extract JSON from the response
  let jsonContent = extractJSON(rawContent)
  
  // Step 2: If no JSON found, try to force-parse as JSON anyway
  if (!jsonContent.startsWith('{') && !jsonContent.startsWith('[')) {
    console.log('❌ No valid JSON structure found in response')
    throw new Error('AI_RETURNED_PROSE_NOT_JSON')
  }
  
  // Step 3: Parse the JSON
  try {
    const parsed = JSON.parse(jsonContent)
    console.log('✅ Successfully parsed AI JSON response')
    return parsed
  } catch (parseError) {
    console.log('❌ JSON parsing failed, content was:', jsonContent.slice(0, 300))
    throw new Error('INVALID_JSON_FROM_AI')
  }
}

export async function POST(request: NextRequest) {
  console.log('🚀 API Route called - Enhanced Error Handling')
  
  try {
    // Step 1: Parse request body with enhanced error handling
    let requestBody
    try {
      requestBody = await request.json()
      console.log('✅ Request body parsed successfully')
    } catch (bodyError) {
      logError('REQUEST_PARSING', bodyError)
      return NextResponse.json(
        { 
          error: 'Invalid request body', 
          details: 'Failed to parse JSON',
          ...createFallbackResponse() 
        },
        { status: 400 }
      )
    }

    // Step 2: Extract and validate parameters
    const { prompt, userId, connected_plugins = {}, bypassPluginValidation = false } = requestBody
    const userIdToUse = userId || request.headers.get('x-user-id') || 'anonymous'

    console.log('✅ Request parameters:', { 
      hasPrompt: !!prompt,
      promptLength: prompt?.length || 0,
      userId: userIdToUse,
      bypassPluginValidation,
      connectedPluginsCount: Object.keys(connected_plugins).length
    })

    if (!prompt?.trim()) {
      console.log('⚠️ Empty prompt provided')
      return NextResponse.json(
        { error: 'Prompt is required', ...createFallbackResponse(prompt) },
        { status: 400 }
      )
    }

    // Step 3: Get connected plugins with error handling
    let connectedPlugins: string[] = []
    try {
      connectedPlugins = await getConnectedPlugins(userIdToUse, connected_plugins)
      console.log('✅ Connected plugins retrieved:', connectedPlugins.length)
    } catch (pluginError) {
      logError('PLUGIN_RETRIEVAL', pluginError, { userIdToUse })
      connectedPlugins = []
    }

    // Step 4: Plugin validation
    const finalPrompt = prompt.trim()
    let pluginWarning = null
    let filteredConnectedPlugins = connectedPlugins
    
    if (!bypassPluginValidation) {
      try {
        const pluginValidation = validatePluginRequirements(prompt, connectedPlugins)
        
        if (!pluginValidation.isValid) {
          console.log('⚠️ Missing required plugins:', pluginValidation.missingPlugins)
          
          pluginWarning = {
            missingServices: pluginValidation.missingPlugins,
            message: `Note: Your request mentions ${pluginValidation.missingPlugins.join(', ')} but ${pluginValidation.missingPlugins.length === 1 ? 'this service isn\'t' : 'these services aren\'t'} connected.`
          }
          
          const unconnectedAliases = pluginValidation.missingPlugins.flatMap(service => 
            PLUGIN_REQUIREMENTS[service as keyof typeof PLUGIN_REQUIREMENTS] || [service]
          )
          
          filteredConnectedPlugins = connectedPlugins.filter(plugin => {
            const pluginLower = plugin.toLowerCase()
            return !unconnectedAliases.some(alias => 
              pluginLower.includes(alias.toLowerCase())
            )
          })
          
          console.log('✅ Plugin filtering complete:', {
            original: connectedPlugins.length,
            filtered: filteredConnectedPlugins.length
          })
        }
      } catch (validationError) {
        logError('PLUGIN_VALIDATION', validationError)
      }
    }

    // Step 5: Check OpenAI API key
    if (!process.env.OPENAI_API_KEY) {
      console.error('❌ Missing OpenAI API key, using fallback')
      return NextResponse.json({ 
        ...createFallbackResponse(finalPrompt),
        connectedPlugins: connectedPlugins,
        pluginWarning,
        error: 'OpenAI API key not configured'
      })
    }

    console.log('✅ All validations passed, calling OpenAI...')

    // Step 6: Call OpenAI with enhanced error handling
    let openAIResponse
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => {
        console.log('⏱️ OpenAI request timeout')
        controller.abort()
      }, 25000)

      openAIResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            { 
              role: 'system', 
              content: buildAISystemPrompt(filteredConnectedPlugins, finalPrompt) 
            },
            { 
              role: 'user', 
              content: `Analyze this automation request and respond with JSON only: "${finalPrompt}"` 
            }
          ],
          temperature: 0.1,
          max_tokens: 1000,
          response_format: { type: "json_object" }
        }),
        signal: controller.signal
      })

      clearTimeout(timeoutId)
      console.log('✅ OpenAI API call completed:', openAIResponse.status)
      
    } catch (fetchError: any) {
      logError('OPENAI_FETCH', fetchError)
      return NextResponse.json(
        { 
          error: 'OpenAI API connection failed',
          details: fetchError.message,
          ...createFallbackResponse(finalPrompt),
          connectedPlugins,
          pluginWarning
        },
        { status: 500 }
      )
    }

    if (!openAIResponse.ok) {
      const errorText = await openAIResponse.text().catch(() => 'Unknown error')
      logError('OPENAI_API_ERROR', new Error(`Status ${openAIResponse.status}: ${errorText}`))
      
      return NextResponse.json(
        { 
          error: `OpenAI API error: ${openAIResponse.status}`,
          details: errorText,
          ...createFallbackResponse(finalPrompt),
          connectedPlugins,
          pluginWarning
        },
        { status: 500 }
      )
    }

    // Step 7: Process OpenAI response
    let aiData
    try {
      aiData = await openAIResponse.json()
      console.log('✅ OpenAI response parsed successfully')
    } catch (parseError) {
      logError('OPENAI_RESPONSE_PARSING', parseError)
      return NextResponse.json(
        { 
          error: 'Failed to parse OpenAI response',
          ...createFallbackResponse(finalPrompt),
          connectedPlugins,
          pluginWarning
        },
        { status: 500 }
      )
    }

    const rawContent = aiData.choices?.[0]?.message?.content
    if (!rawContent) {
      console.error('❌ Empty OpenAI response content')
      return NextResponse.json(
        { 
          error: 'Empty AI response',
          ...createFallbackResponse(finalPrompt),
          connectedPlugins,
          pluginWarning
        },
        { status: 500 }
      )
    }

    // Step 8: Parse AI result with enhanced error handling
    let aiResult
    try {
      aiResult = parseAIResponse(rawContent)
      console.log('✅ AI result parsed successfully')
    } catch (aiParseError: any) {
      logError('AI_RESULT_PARSING', aiParseError, { 
        responsePreview: rawContent.slice(0, 300) 
      })
      
      console.log('🔄 Using smart fallback for automation request')
      aiResult = createFallbackResponse(finalPrompt)
      aiResult.aiParsingFailed = true
      aiResult.originalError = aiParseError.message
    }

    // Step 9: Add scheduling questions and validate consistency
    try {
      aiResult = validateConsistency(aiResult, finalPrompt)
    } catch (consistencyError) {
      logError('CONSISTENCY_VALIDATION', consistencyError)
    }

    // Step 10: Build final response
    const finalResult = {
      ...aiResult,
      connectedPlugins,
      filteredPlugins: filteredConnectedPlugins,
      pluginValidationError: false,
      ...(pluginWarning && { pluginWarning })
    }

    // Step 11: Track usage (non-blocking)
    if (userIdToUse !== 'anonymous' && aiData?.usage) {
      try {
        await trackTokenUsage(supabase, userIdToUse, {
          modelName: 'gpt-4o',
          provider: 'openai',
          inputTokens: aiData.usage.prompt_tokens || 0,
          outputTokens: aiData.usage.completion_tokens || 0,
          requestType: 'analysis',
          category: 'smart_prompt_analysis',
          metadata: { 
            clarityScore: finalResult.clarityScore,
            questionsCount: finalResult.questionsSequence?.length || 0,
            aiParsingFailed: finalResult.aiParsingFailed || false
          }
        })
      } catch (trackingError) {
        logError('USAGE_TRACKING', trackingError)
      }
    }

    console.log('✅ Request completed successfully:', {
      clarityScore: finalResult.clarityScore,
      questionsCount: finalResult.questionsSequence?.length || 0,
      needsClarification: finalResult.needsClarification,
      aiParsingFailed: finalResult.aiParsingFailed || false
    })

    return NextResponse.json(finalResult)

  } catch (error: any) {
    logError('UNEXPECTED_ERROR', error)
    
    return NextResponse.json(
      { 
        error: 'Unexpected server error',
        details: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
        ...createFallbackResponse()
      },
      { status: 500 }
    )
  }
}