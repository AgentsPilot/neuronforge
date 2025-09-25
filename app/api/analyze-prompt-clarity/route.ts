import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Import new plugin registry
import { 
  pluginRegistry,
  getPluginDefinition,
  getConnectedPluginsWithMetadata,
  getPluginCapabilitiesContext,
  getPluginDisplayNames,
  LEGACY_KEY_MAP
} from '@/lib/plugins/pluginRegistry'

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

// Enhanced plugin fetching with new registry integration
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

// Smart scheduling question generator based on plugin capabilities
function generateSchedulingQuestions(userPrompt: string, connectedPluginData: any[]): any[] {
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

  // Check connected plugin capabilities to generate context-aware scheduling
  const hasEmailCapabilities = connectedPluginData.some(plugin => 
    plugin.capabilities?.includes('read_email') || plugin.capabilities?.includes('send_email')
  );
  
  const hasFileCapabilities = connectedPluginData.some(plugin =>
    plugin.capabilities?.includes('upload_files') || plugin.capabilities?.includes('read_files')
  );

  // Email automations
  if (hasEmailCapabilities && (promptLower.includes('email') || promptLower.includes('inbox') || promptLower.includes('google-mail'))) {
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

  // File processing automations
  if (hasFileCapabilities && (promptLower.includes('file') || promptLower.includes('drive') || promptLower.includes('upload'))) {
    return [
      {
        id: 'file_schedule',
        dimension: 'timing',
        question: "When should this file automation run?",
        type: 'single_choice',
        options: [
          { value: 'on_change', label: 'When files change', description: 'Process files immediately when they are added or modified' },
          { value: 'daily_2am', label: 'Daily at 2:00 AM', description: 'Process files during off-hours' },
          { value: 'weekly_sunday', label: 'Weekly on Sunday', description: 'Weekly file processing' },
          { value: 'manual_trigger', label: 'Manual trigger only', description: 'Run only when manually triggered' }
        ],
        allowCustom: true
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

// FIXED: AI system prompt that ONLY works with connected services
function buildAISystemPrompt(connectedPluginData: any[], userPrompt: string) {
  const pluginCapabilitiesContext = getPluginCapabilitiesContext(connectedPluginData.map(p => p.key));
  
  // Create a clear list of connected services for the AI
  const connectedServicesList = connectedPluginData.length > 0 
    ? connectedPluginData.map(p => `- ${p.label} (${p.key}): ${p.capabilities.join(', ')}`).join('\n')
    : '- No connected services available';
  
  return `You are an expert automation analyst. You MUST respond with valid JSON only.

USER REQUEST: "${userPrompt}"

CONNECTED SERVICES AVAILABLE:
${connectedServicesList}

CRITICAL INSTRUCTIONS:
- Generate questions using ONLY the connected services listed above
- Do NOT reference any services not in the connected services list
- Do NOT ask about services mentioned in the user request if they are not connected
- Focus on building workflows using only available connected services
- If user mentioned unconnected services, ignore them completely

REQUIRED AUTOMATION DETAILS - ASK ABOUT ANY THAT ARE MISSING:

1. DATA/WHAT TO MONITOR: What specific thing to track using connected services
2. TRIGGER/THRESHOLD: What condition triggers the action
3. OUTPUT/WHAT TO CREATE: What gets generated (summary, report, etc.)
4. DELIVERY/HOW TO DELIVER: How to send results using ONLY connected services
5. ERROR HANDLING: What to do when things fail

CRITICAL TIMING REQUIREMENT:
DO NOT include timing/frequency/scheduling questions in your response. The system will automatically add appropriate scheduling questions. Focus only on the other dimensions above.

ANALYSIS RULES:
- Check each dimension: is it clearly specified, partially mentioned, or completely missing?
- Ask about dimensions that are missing or unclear (except timing)
- Generate 2-4 content questions, avoiding timing since it's added separately
- Use ONLY the capabilities of connected services listed above
- For delivery questions, only suggest connected services as options
- Don't assume output format - ask what should be created using available services
- Don't assume error handling - ask how to handle failures

CLARITY SCORING:
- 90-100: All 6 dimensions clearly specified using available services
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
      "question": "Specific question using ONLY connected service capabilities?",
      "type": "single_choice",
      "options": [
        { "value": "value", "label": "Label using ONLY connected services", "description": "Description" }
      ],
      "allowCustom": true
    }
  ],
  "analysis": {
    "data": { "status": "clear|partial|missing", "detected": "what was found" },
    "timing": { "status": "clear|partial|missing", "detected": "timing found" },
    "output": { "status": "clear|partial|missing", "detected": "output found" },
    "actions": { "status": "clear|partial|missing", "detected": "actions using connected services" },
    "delivery": { "status": "clear|partial|missing", "detected": "delivery using connected services" },
    "error_handling": { "status": "clear|partial|missing", "detected": "error handling found" }
  }
}`
}

// Apply consistency checks and add scheduling questions
function validateConsistency(result: any, userPrompt: string, connectedPluginData: any[]): any {
  const scheduleQuestions = generateSchedulingQuestions(userPrompt, connectedPluginData)
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

// FIXED: Smart generic fallback that uses plugin metadata instead of hardcoded mappings
const createFallbackResponse = (userPrompt: string = '', connectedPluginData: any[] = []) => {
  const scheduleQuestions = generateSchedulingQuestions(userPrompt, connectedPluginData)
  const promptLower = userPrompt.toLowerCase()
  const hasNoPlugins = connectedPluginData.length === 0
  
  // Use actual plugin metadata for service names
  const serviceNames = getPluginDisplayNames(
    connectedPluginData.map(p => p.key), 
    connectedPluginData
  );
  
  // Analyze prompt for intent clues without making service assumptions
  const promptAnalysis = {
    hasDataWords: /\b(data|analyze|analysis|report|insights|metrics|statistics)\b/.test(promptLower),
    hasContentWords: /\b(content|text|document|write|generate|create|summary)\b/.test(promptLower),
    hasCommWords: /\b(email|message|notify|alert|send|communicate)\b/.test(promptLower),
    hasFileWords: /\b(file|document|pdf|spreadsheet|upload|download)\b/.test(promptLower),
    hasAutoWords: /\b(automate|automation|workflow|process|trigger|schedule)\b/.test(promptLower)
  }
  
  // Build generic automation categories based on intent, not services
  const buildAutomationOptions = () => {
    const options = []
    
    // Always include these fundamental automation types
    if (promptAnalysis.hasDataWords) {
      options.push({ value: "data_analysis", label: "Data analysis and insights", description: "Analyze information and generate reports or insights" })
    }
    if (promptAnalysis.hasContentWords) {
      options.push({ value: "content_processing", label: "Content processing", description: "Process, transform, or generate text and documents" })
    }
    if (promptAnalysis.hasCommWords) {
      options.push({ value: "communication_automation", label: "Communication automation", description: "Automate notifications, alerts, or messaging" })
    }
    if (promptAnalysis.hasFileWords) {
      options.push({ value: "file_management", label: "File and document management", description: "Organize, process, or transform files and documents" })
    }
    
    // Add generic automation types
    options.push(
      { value: "monitoring", label: "Monitoring and alerts", description: "Watch for changes or conditions and notify when they occur" },
      { value: "data_transformation", label: "Data transformation", description: "Convert, format, or restructure information" },
      { value: "workflow_automation", label: "Multi-step workflow", description: "Chain together multiple actions in sequence" },
      { value: "custom_logic", label: "Custom logic and processing", description: "Apply specific rules or calculations to data" }
    )
    
    // Always end with custom option
    options.push({ value: "custom", label: "Something different", description: "Let me describe exactly what I need" })
    
    return options
  }
  
  // FIXED: Build fallback actions using actual plugin metadata
  let fallbackActions = 'No actions possible - connect services first';
  if (connectedPluginData.length > 0) {
    fallbackActions = `Summarize and save to ${serviceNames.join(', ')}`;
  }
  
  // No plugins connected - focus on understanding intent first
  if (hasNoPlugins) {
    return {
      needsClarification: true,
      clarityScore: 25,
      questionsSequence: [
        {
          id: "automation_intent",
          dimension: "data",
          question: "I'm having trouble understanding your automation request automatically. What type of task do you want to automate?",
          type: "single_choice",
          options: buildAutomationOptions(),
          allowCustom: true
        },
        {
          id: "input_source",
          dimension: "data",
          question: "What information or data should this automation work with?",
          type: "single_choice",
          options: [
            { value: "manual_input", label: "Information I provide manually", description: "I'll give the automation specific data to work with" },
            { value: "external_data", label: "Data from external services", description: "Pull information from online services (requires connecting those services)" },
            { value: "files_documents", label: "Files or documents", description: "Process existing files, documents, or datasets" },
            { value: "web_content", label: "Web content or APIs", description: "Gather information from websites or online sources" },
            { value: "custom", label: "Other data source", description: "Let me specify the data source" }
          ],
          allowCustom: true
        },
        {
          id: "output_format",
          dimension: "output",
          question: "What should this automation produce or create?",
          type: "single_choice",
          options: [
            { value: "analysis_report", label: "Analysis or report", description: "Generate insights, summaries, or analytical reports" },
            { value: "notifications", label: "Notifications or alerts", description: "Send messages when conditions are met" },
            { value: "processed_data", label: "Processed or transformed data", description: "Convert, format, or restructure information" },
            { value: "documents", label: "Documents or files", description: "Create or modify files and documents" },
            { value: "actions", label: "Automated actions", description: "Perform specific tasks or operations" },
            { value: "custom", label: "Different output", description: "Let me specify what should be created" }
          ],
          allowCustom: true
        },
        ...scheduleQuestions
      ],
      analysis: {
        data: { status: "missing", detected: "" },
        timing: { status: "missing", detected: "" },
        output: { status: "missing", detected: "" },
        actions: { status: "missing", detected: fallbackActions },
        delivery: { status: "missing", detected: serviceNames.join(', ') },
        error_handling: { status: "missing", detected: "" }
      }
    }
  }
  
  // Has plugins but prompt analysis failed - ask generic clarifying questions
  return {
    needsClarification: true,
    clarityScore: 35,
    questionsSequence: [
      {
        id: "automation_goal",
        dimension: "data",
        question: "Since I'm having trouble analyzing your request automatically, could you clarify what you want this automation to accomplish?",
        type: "single_choice", 
        options: buildAutomationOptions(),
        allowCustom: true
      },
      {
        id: "trigger_condition",
        dimension: "data",
        question: "What should trigger this automation to run?",
        type: "single_choice",
        options: [
          { value: "data_change", label: "When specific data changes", description: "Run when information is updated or modified" },
          { value: "new_content", label: "When new content arrives", description: "Trigger on new emails, files, messages, etc." },
          { value: "condition_met", label: "When a condition is met", description: "Run when specific criteria or thresholds are reached" },
          { value: "manual_trigger", label: "When I manually start it", description: "Run only when I choose to trigger it" },
          { value: "custom", label: "Different trigger", description: "Let me specify the trigger condition" }
        ],
        allowCustom: true
      },
      {
        id: "result_handling",
        dimension: "delivery",
        question: "How should the automation deliver or handle the results?",
        type: "single_choice",
        options: [
          { value: "save_results", label: "Save results somewhere", description: "Store output in a file, database, or service" },
          { value: "send_notifications", label: "Send me notifications", description: "Alert me when complete or when issues occur" },
          { value: "display_results", label: "Show results directly", description: "Present information immediately when complete" },
          { value: "chain_actions", label: "Trigger additional actions", description: "Use results to start other automated processes" },
          { value: "custom", label: "Different handling", description: "Let me specify how to handle results" }
        ],
        allowCustom: true
      },
      ...scheduleQuestions
    ],
    analysis: {
      data: { status: "missing", detected: "" },
      timing: { status: "missing", detected: "" },
      output: { status: "missing", detected: "" },
      actions: { status: "missing", detected: fallbackActions },
      delivery: { status: "missing", detected: serviceNames.join(', ') },
      error_handling: { status: "missing", detected: "" }
    }
  }
}

// FIXED: Enhanced parsing function that handles OpenAI responses
function parseAIResponse(rawContent: string): any {
  console.log('🔍 Parsing AI response, length:', rawContent.length)
  console.log('📝 Raw content preview:', rawContent.slice(0, 200) + '...')
  
  // Step 1: Try to extract JSON from the response
  let jsonContent = extractJSON(rawContent)
  
  // Step 2: If no JSON found, log the full content for debugging
  if (!jsonContent.startsWith('{') && !jsonContent.startsWith('[')) {
    console.error('❌ No valid JSON structure found in response')
    console.error('🔍 Full raw content:', rawContent) // Log everything for debugging
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
  } catch (parseError) {
    console.error('❌ JSON parsing failed')
    console.error('🔍 JSON content was:', jsonContent.slice(0, 500))
    console.error('🔍 Parse error:', parseError.message)
    throw new Error('INVALID_JSON_FROM_AI')
  }
}

// FIXED: Check if user mentioned unconnected services (for warning only)
function checkMentionedUnconnectedServices(userPrompt: string, connectedPlugins: string[]): {
  mentionedServices: string[];
  missingServices: string[];
} {
  const promptLower = userPrompt.toLowerCase();
  const mentionedServices: string[] = [];
  const normalizedConnectedPlugins = connectedPlugins.map(key => LEGACY_KEY_MAP[key] || key);
  
  // Check against plugin registry
  for (const [pluginKey, pluginDef] of Object.entries(pluginRegistry)) {
    const serviceName = pluginDef.label.toLowerCase();
    const keyVariations = [
      pluginKey,
      serviceName,
      serviceName.replace(/\s+/g, ''),
      serviceName.replace(/\s+/g, '_'),
      serviceName.replace(/\s+/g, '-')
    ];
    
    const isDetected = keyVariations.some(variation => 
      promptLower.includes(variation)
    );
    
    if (isDetected && !mentionedServices.includes(pluginKey)) {
      mentionedServices.push(pluginKey);
    }
  }
  
  // Additional common service name mappings
  const additionalServiceKeywords = {
    'notion': ['notion'],
    'slack': ['slack'],
    'google_sheets': ['google sheets', 'sheets', 'spreadsheet'],
    'google_calendar': ['calendar', 'google calendar', 'gcal'],
    'dropbox': ['dropbox'],
    'airtable': ['airtable'],
    'trello': ['trello'],
    'asana': ['asana'],
    'monday': ['monday'],
    'onedrive': ['onedrive']
  };
  
  for (const [serviceKey, keywords] of Object.entries(additionalServiceKeywords)) {
    const isDetected = keywords.some(keyword => promptLower.includes(keyword));
    if (isDetected && !mentionedServices.includes(serviceKey)) {
      mentionedServices.push(serviceKey);
    }
  }
  
  // Find missing services
  const missingServices = mentionedServices.filter(service => 
    !normalizedConnectedPlugins.includes(service)
  );
  
  return { mentionedServices, missingServices };
}

export async function POST(request: NextRequest) {
  console.log('🚀 API Route called - Fixed to only use connected services')
  
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

    // Step 4: Get plugin metadata for LLM context
    const finalPrompt = prompt.trim()
    let connectedPluginData: any[] = []
    try {
      connectedPluginData = getConnectedPluginsWithMetadata(connectedPlugins)
      console.log('✅ Plugin metadata retrieved:', {
        pluginsWithMetadata: connectedPluginData.length,
        capabilities: connectedPluginData.map(p => ({ key: p.key, capabilities: p.capabilities }))
      })
    } catch (metadataError) {
      logError('PLUGIN_METADATA', metadataError)
    }

    // Step 5: Check for mentioned unconnected services (for warning only)
    let pluginWarning = null
    try {
      const { mentionedServices, missingServices } = checkMentionedUnconnectedServices(finalPrompt, connectedPlugins)
      
      if (missingServices.length > 0) {
        console.log('⚠️ User mentioned unconnected services:', missingServices)
        
        const missingDisplayNames = missingServices.map(service => {
          const definition = getPluginDefinition(service);
          return definition?.displayName || definition?.label || service;
        });
        
        pluginWarning = {
          missingServices,
          message: `🚨 MISSING SERVICES: Your request mentions ${missingDisplayNames.join(', ')} but ${missingServices.length === 1 ? 'this service isn\'t' : 'these services aren\'t'} connected. Questions will focus on your connected services only.`
        }
        console.log('✅ Plugin warning created:', pluginWarning.message)
      }
    } catch (warningError) {
      logError('WARNING_CREATION', warningError)
    }

    // Step 6: Check OpenAI API key
    if (!process.env.OPENAI_API_KEY) {
      console.error('❌ Missing OpenAI API key, using fallback')
      return NextResponse.json({ 
        ...createFallbackResponse(finalPrompt, connectedPluginData),
        connectedPlugins: connectedPlugins,
        connectedPluginData: connectedPluginData,
        ...(pluginWarning && { pluginWarning }),
        error: 'OpenAI API key not configured'
      })
    }

    console.log('✅ All validations passed, calling OpenAI with connected services only...')

    // Step 7: Call OpenAI with enhanced error handling and plugin context
    let openAIResponse
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => {
        console.log('⏱️ OpenAI request timeout')
        controller.abort()
      }, 45000)

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
              content: buildAISystemPrompt(connectedPluginData, finalPrompt) 
            },
            { 
              role: 'user', 
              content: `Analyze this automation request and respond with JSON only: "${finalPrompt}"` 
            }
          ],
          temperature: 0.1,
          max_tokens: 1200,
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
          ...createFallbackResponse(finalPrompt, connectedPluginData),
          connectedPlugins,
          connectedPluginData,
          ...(pluginWarning && { pluginWarning })
        },
        { status: 500 }
      )
    }

    // ENHANCED: Better OpenAI error handling
    if (!openAIResponse.ok) {
      let errorText = 'Unknown error'
      let errorDetails: any = {}
      
      try {
        const contentType = openAIResponse.headers.get('content-type')
        
        if (contentType && contentType.includes('application/json')) {
          const errorData = await openAIResponse.json()
          errorDetails = errorData
          errorText = JSON.stringify(errorData)
        } else {
          errorText = await openAIResponse.text()
          errorDetails = { message: errorText }
        }
      } catch (parseError) {
        console.error('❌ Could not parse OpenAI error response:', parseError)
        errorDetails = {
          message: `HTTP ${openAIResponse.status}: ${openAIResponse.statusText}`,
          details: 'Could not parse error response'
        }
      }
      
      return NextResponse.json(
        { 
          error: `OpenAI API error: ${openAIResponse.status}`,
          details: errorText,
          ...createFallbackResponse(finalPrompt, connectedPluginData),
          connectedPlugins,
          connectedPluginData,
          ...(pluginWarning && { pluginWarning })
        },
        { status: 500 }
      )
    }

    // Step 8: Process OpenAI response with enhanced debugging
    let aiData
    try {
      aiData = await openAIResponse.json()
      console.log('✅ OpenAI response parsed successfully')
      
    } catch (parseError) {
      logError('OPENAI_RESPONSE_PARSING', parseError)
      return NextResponse.json(
        { 
          error: 'Failed to parse OpenAI response',
          ...createFallbackResponse(finalPrompt, connectedPluginData),
          connectedPlugins,
          connectedPluginData,
          ...(pluginWarning && { pluginWarning })
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
          ...createFallbackResponse(finalPrompt, connectedPluginData),
          connectedPlugins,
          connectedPluginData,
          ...(pluginWarning && { pluginWarning })
        },
        { status: 500 }
      )
    }

    // Step 9: Parse AI result with enhanced error handling and validation
    let aiResult
    try {
      aiResult = parseAIResponse(rawContent)
      
      // CRITICAL: Validate the parsed result has required structure
      if (!aiResult || Object.keys(aiResult).length === 0) {
        console.error('❌ AI returned empty object, raw content:', rawContent.slice(0, 500))
        throw new Error('AI_RETURNED_EMPTY_OBJECT')
      }

      // Ensure required fields exist
      const requiredFields = ['clarityScore', 'needsClarification', 'analysis']
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

      console.log('✅ AI result validated:', {
        hasClarityScore: 'clarityScore' in aiResult,
        hasQuestions: Array.isArray(aiResult.questionsSequence),
        questionCount: aiResult.questionsSequence?.length || 0
      })
      
    } catch (aiParseError: any) {
      logError('AI_RESULT_PARSING', aiParseError, { 
        responsePreview: rawContent.slice(0, 500),
        fullResponse: rawContent 
      })
      
      console.log('🔄 Using smart fallback for automation request')
      aiResult = createFallbackResponse(finalPrompt, connectedPluginData)
      aiResult.aiParsingFailed = true
      aiResult.originalError = aiParseError.message
    }

    // Step 10: Add scheduling questions and validate consistency
    try {
      aiResult = validateConsistency(aiResult, finalPrompt, connectedPluginData)
    } catch (consistencyError) {
      logError('CONSISTENCY_VALIDATION', consistencyError)
    }

    // Step 11: Build final response with complete plugin metadata
    const finalResult = {
      ...aiResult,
      connectedPlugins,
      connectedPluginData,
      pluginValidationError: false,
      ...(pluginWarning && { pluginWarning })
    }

    // Step 12: Track usage (non-blocking)
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
            aiParsingFailed: finalResult.aiParsingFailed || false,
            connectedPluginsCount: connectedPluginData.length,
            pluginCapabilities: connectedPluginData.map(p => p.capabilities).flat()
          }
        })
      } catch (trackingError) {
        logError('USAGE_TRACKING', trackingError)
      }
    }

    console.log('✅ Request completed successfully - questions only about connected services:', {
      clarityScore: finalResult.clarityScore,
      questionsCount: finalResult.questionsSequence?.length || 0,
      needsClarification: finalResult.needsClarification,
      aiParsingFailed: finalResult.aiParsingFailed || false,
      pluginDataIncluded: finalResult.connectedPluginData?.length || 0,
      pluginWarningCreated: !!pluginWarning
    })

    return NextResponse.json(finalResult)

  } catch (error: any) {
    logError('UNEXPECTED_ERROR', error)
    
    return NextResponse.json(
      { 
        error: 'Unexpected server error',
        details: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
        ...createFallbackResponse(),
        connectedPluginData: []
      },
      { status: 500 }
    )
  }
}