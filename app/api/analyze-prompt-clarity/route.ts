import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { v4 as uuidv4 } from 'uuid'

// Import new plugin registry
import { 
  pluginRegistry,
  getPluginDefinition,
  getConnectedPluginsWithMetadata,
  getPluginCapabilitiesContext,
  getPluginDisplayNames,
} from '@/lib/plugins/pluginRegistry'

// Import AI Analytics System
import { AIAnalyticsService, AICallData } from '@/lib/analytics/aiAnalytics'
import { OpenAIProvider } from '@/lib/ai/providers/openaiProvider'

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

// NEW: Analyze requirements from prompt - THIS WAS MISSING!
function analyzeRequirements(prompt: string, clarityScore: number, connectedPlugins: string[]): any {
  const promptLower = prompt.toLowerCase();
  
  console.log('🔍 Analyzing requirements for prompt:', prompt.slice(0, 100));
  console.log('🔍 Connected plugins for analysis:', connectedPlugins);
  
  // Get service display names for actions
  const connectedPluginData = getConnectedPluginsWithMetadata(connectedPlugins);
  const serviceDisplayNames = getPluginDisplayNames(connectedPlugins, connectedPluginData);
  
  const analysis = {
    data: analyzeDataRequirement(promptLower),
    timing: analyzeTimingRequirement(promptLower), 
    output: analyzeOutputRequirement(promptLower),
    actions: analyzeActionsRequirement(promptLower, connectedPlugins, serviceDisplayNames),
    delivery: analyzeDeliveryRequirement(promptLower, serviceDisplayNames),
    error_handling: analyzeErrorHandlingRequirement(promptLower)
  };
  
  console.log('✅ Requirements analysis completed:', analysis);
  return analysis;
}

function analyzeDataRequirement(promptLower: string): { status: string, detected: string } {
  // Look for data sources
  if (promptLower.includes('email') || promptLower.includes('inbox')) {
    if (promptLower.includes('last 10') || promptLower.includes('recent 10')) {
      return { status: 'clear', detected: 'Last 10 emails' };
    }
    if (promptLower.includes('unread')) {
      return { status: 'clear', detected: 'Unread emails' };
    }
    if (promptLower.includes('all emails')) {
      return { status: 'clear', detected: 'All emails' };
    }
    return { status: 'partial', detected: 'Emails (criteria unclear)' };
  }
  
  if (promptLower.includes('file') || promptLower.includes('document')) {
    return { status: 'partial', detected: 'Files/documents' };
  }
  
  if (promptLower.includes('calendar') || promptLower.includes('meeting')) {
    return { status: 'partial', detected: 'Calendar data' };
  }
  
  if (promptLower.includes('spreadsheet') || promptLower.includes('sheet')) {
    return { status: 'partial', detected: 'Spreadsheet data' };
  }
  
  return { status: 'missing', detected: '' };
}

function analyzeTimingRequirement(promptLower: string): { status: string, detected: string } {
  // Look for timing indicators
  if (promptLower.includes('daily')) {
    return { status: 'clear', detected: 'Daily' };
  }
  if (promptLower.includes('weekly')) {
    if (promptLower.includes('monday')) {
      return { status: 'clear', detected: 'Weekly on Monday' };
    }
    return { status: 'clear', detected: 'Weekly' };
  }
  if (promptLower.includes('monthly')) {
    return { status: 'clear', detected: 'Monthly' };
  }
  if (promptLower.includes('every')) {
    if (promptLower.includes('hour')) {
      return { status: 'clear', detected: 'Every hour' };
    }
    return { status: 'partial', detected: 'Recurring schedule' };
  }
  if (promptLower.includes('hourly') || promptLower.includes('hour')) {
    return { status: 'clear', detected: 'Hourly' };
  }
  
  return { status: 'missing', detected: '' };
}

function analyzeOutputRequirement(promptLower: string): { status: string, detected: string } {
  // Look for output types
  if (promptLower.includes('summary') || promptLower.includes('summarize')) {
    if (promptLower.includes('email summary')) {
      return { status: 'clear', detected: 'Email summary document' };
    }
    return { status: 'clear', detected: 'Summary document' };
  }
  
  if (promptLower.includes('report')) {
    return { status: 'clear', detected: 'Report' };
  }
  
  if (promptLower.includes('alert') || promptLower.includes('notification')) {
    return { status: 'clear', detected: 'Alert/notification' };
  }
  
  if (promptLower.includes('create') || promptLower.includes('generate')) {
    return { status: 'partial', detected: 'Generated content' };
  }
  
  if (promptLower.includes('document')) {
    return { status: 'partial', detected: 'Document' };
  }
  
  return { status: 'missing', detected: '' };
}

function analyzeActionsRequirement(promptLower: string, connectedPlugins: string[], serviceDisplayNames: string[]): { status: string, detected: string } {
  const actions = [];
  
  // Detect specific actions
  if (promptLower.includes('read') && promptLower.includes('email')) {
    actions.push('Read emails');
  }
  if (promptLower.includes('summarize') || promptLower.includes('summary')) {
    actions.push('Summarize content');
  }
  if (promptLower.includes('save') || promptLower.includes('store')) {
    actions.push('Save data');
  }
  if (promptLower.includes('send') && promptLower.includes('email')) {
    actions.push('Send email');
  }
  if (promptLower.includes('upload') || promptLower.includes('drive')) {
    actions.push('Upload to Drive');
  }
  if (promptLower.includes('analyze') || promptLower.includes('analysis')) {
    actions.push('Analyze data');
  }
  
  // Build actions string with connected services
  if (actions.length > 0 && serviceDisplayNames.length > 0) {
    return { 
      status: 'clear', 
      detected: `${actions.join(', ')} using ${serviceDisplayNames.join(', ')}` 
    };
  }
  
  if (actions.length > 0) {
    return { status: 'partial', detected: actions.join(', ') };
  }
  
  // Fallback based on connected services
  if (serviceDisplayNames.length > 0) {
    return { 
      status: 'partial', 
      detected: `Summarize and save to ${serviceDisplayNames.join(', ')}` 
    };
  }
  
  return { status: 'missing', detected: '' };
}

function analyzeDeliveryRequirement(promptLower: string, serviceDisplayNames: string[]): { status: string, detected: string } {
  // Look for delivery methods
  if (promptLower.includes('send to') && promptLower.includes('manager')) {
    return { status: 'clear', detected: 'Send to manager' };
  }
  
  if (promptLower.includes('email') && (promptLower.includes('send') || promptLower.includes('to'))) {
    return { status: 'partial', detected: 'Send via email' };
  }
  
  if (promptLower.includes('save to') || promptLower.includes('upload to')) {
    return { status: 'partial', detected: 'Save/upload to service' };
  }
  
  if (promptLower.includes('notification') || promptLower.includes('alert')) {
    return { status: 'partial', detected: 'Send notification' };
  }
  
  // Use connected services for delivery
  if (serviceDisplayNames.length > 0) {
    return { 
      status: 'partial', 
      detected: `Deliver via ${serviceDisplayNames.join(', ')}` 
    };
  }
  
  return { status: 'missing', detected: '' };
}

function analyzeErrorHandlingRequirement(promptLower: string): { status: string, detected: string } {
  // Look for error handling mentions
  if (promptLower.includes('error') || promptLower.includes('fail')) {
    return { status: 'clear', detected: 'Error handling specified' };
  }
  
  if (promptLower.includes('retry') || promptLower.includes('try again')) {
    return { status: 'clear', detected: 'Retry on failure' };
  }
  
  if (promptLower.includes('if') && (promptLower.includes('problem') || promptLower.includes('issue'))) {
    return { status: 'partial', detected: 'Basic error handling' };
  }
  
  // Most users don't specify error handling - this is expected
  return { status: 'missing', detected: '' };
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

// AI system prompt that ONLY works with connected services
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

// Smart generic fallback that uses plugin metadata
const createFallbackResponse = (userPrompt: string = '', connectedPluginData: any[] = []) => {
  const scheduleQuestions = generateSchedulingQuestions(userPrompt, connectedPluginData)
  const promptLower = userPrompt.toLowerCase()
  const hasNoPlugins = connectedPluginData.length === 0
  
  // Use actual plugin metadata for service names
  const serviceNames = getPluginDisplayNames(
    connectedPluginData.map(p => p.key), 
    connectedPluginData
  );
  
  // Build fallback actions using actual plugin metadata
  let fallbackActions = 'No actions possible - connect services first';
  if (connectedPluginData.length > 0) {
    fallbackActions = `Summarize and save to ${serviceNames.join(', ')}`;
  }
  
  // CRITICAL: Add requirements analysis to fallback
  const analysis = userPrompt ? 
    analyzeRequirements(userPrompt, 30, connectedPluginData.map(p => p.key)) : 
    {
      data: { status: "missing", detected: "" },
      timing: { status: "missing", detected: "" },
      output: { status: "missing", detected: "" },
      actions: { status: "missing", detected: fallbackActions },
      delivery: { status: "missing", detected: serviceNames.join(', ') },
      error_handling: { status: "missing", detected: "" }
    };
  
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
          options: [
            { value: "data_analysis", label: "Data analysis and insights", description: "Analyze information and generate reports or insights" },
            { value: "content_processing", label: "Content processing", description: "Process, transform, or generate text and documents" },
            { value: "communication_automation", label: "Communication automation", description: "Automate notifications, alerts, or messaging" },
            { value: "file_management", label: "File and document management", description: "Organize, process, or transform files and documents" },
            { value: "monitoring", label: "Monitoring and alerts", description: "Watch for changes or conditions and notify when they occur" },
            { value: "custom", label: "Something different", description: "Let me describe exactly what I need" }
          ],
          allowCustom: true
        },
        ...scheduleQuestions
      ],
      analysis
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
        options: [
          { value: "data_analysis", label: "Data analysis and insights", description: "Analyze information and generate reports or insights" },
          { value: "content_processing", label: "Content processing", description: "Process, transform, or generate text and documents" },
          { value: "communication_automation", label: "Communication automation", description: "Automate notifications, alerts, or messaging" },
          { value: "workflow_automation", label: "Multi-step workflow", description: "Chain together multiple actions in sequence" },
          { value: "custom", label: "Different goal", description: "Let me specify the automation goal" }
        ],
        allowCustom: true
      },
      ...scheduleQuestions
    ],
    analysis
  }
}

// Enhanced parsing function that handles OpenAI responses
function parseAIResponse(rawContent: string): any {
  console.log('🔍 Parsing AI response, length:', rawContent.length)
  console.log('📝 Raw content preview:', rawContent.slice(0, 200) + '...')
  
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

// Check if user mentioned unconnected services (for warning only)
function checkMentionedUnconnectedServices(userPrompt: string, connectedPlugins: string[]): {
  mentionedServices: string[];
  missingServices: string[];
} {
  const promptLower = userPrompt.toLowerCase();
  const mentionedServices: string[] = [];
  
  console.log('🔍 Connected plugins:', connectedPlugins);
  
  // Check against plugin registry (supported services)
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
  
  // Also check for commonly mentioned services NOT in registry yet
  const commonServices: Record<string, string[]> = {
    'notion': ['notion'],
    'slack': ['slack'],
    'airtable': ['airtable'],
    'trello': ['trello'],
    'asana': ['asana'],
    'monday': ['monday.com', 'monday'],
    'dropbox': ['dropbox'],
    'onedrive': ['onedrive'],
  };
  
  for (const [serviceKey, keywords] of Object.entries(commonServices)) {
    const isDetected = keywords.some(keyword => promptLower.includes(keyword));
    if (isDetected && !mentionedServices.includes(serviceKey)) {
      mentionedServices.push(serviceKey);
    }
  }
  
  console.log('🔍 Detected mentioned services:', mentionedServices);
  
  // Find missing services - services mentioned but not connected
  const missingServices = mentionedServices.filter(service => 
    !connectedPlugins.includes(service)
  );
  
  console.log('🔍 Missing services:', missingServices);
  
  return { mentionedServices, missingServices };
}

export async function POST(request: NextRequest) {
  console.log('🚀 API Route called - Using AI Analytics System with Activity Tracking')
  
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

    // FIXED: Extract agent ID from request body or headers
    const { 
      prompt, 
      userId, 
      connected_plugins = {}, 
      sessionId: providedSessionId, 
      agentId: providedAgentId, // FIXED: Extract agent ID from request body
      bypassPluginValidation = false 
    } = requestBody
    
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
          message: `Note: Your request mentions ${missingDisplayNames.join(', ')} but ${missingServices.length === 1 ? 'this service isn\'t' : 'these services aren\'t'} connected. Questions will focus on your connected services only.`
        }
        console.log('✅ Plugin warning created:', pluginWarning.message)
      }
    } catch (warningError) {
      logError('WARNING_CREATION', warningError)
    }

    // Step 6: Check OpenAI API key
    if (!process.env.OPENAI_API_KEY) {
      console.error('❌ Missing OpenAI API key, using fallback')
      
      // CRITICAL: Include requirements analysis in fallback
      const fallbackWithAnalysis = createFallbackResponse(finalPrompt, connectedPluginData)
      
      return NextResponse.json({ 
        ...fallbackWithAnalysis,
        connectedPlugins: connectedPlugins,
        connectedPluginData: connectedPluginData,
        sessionId: sessionId, // FIXED: Return consistent session ID
        agentId: agentId, // FIXED: Return consistent agent ID
        ...(pluginWarning && { pluginWarning }),
        error: 'OpenAI API key not configured'
      })
    }

    console.log('✅ All validations passed, calling OpenAI with CONSISTENT AGENT ID...')

    // Step 7: Call OpenAI with AI Analytics tracking INCLUDING CONSISTENT AGENT ID
    let aiResult: any
    let openAIResponse: any
    
    try {
      if (!aiAnalytics) {
        throw new Error('AI Analytics service not initialized')
      }

      // Initialize OpenAI provider with analytics
      const openaiProvider = new OpenAIProvider(process.env.OPENAI_API_KEY!, aiAnalytics)
      
      console.log('📊 Making tracked AI call with CONSISTENT AGENT ID:', {
        userId: userIdToUse,
        sessionId: sessionId,
        agentId: agentId, // FIXED: Using consistent agent ID
        sessionIdValid: isValidUUID(sessionId),
        agentIdValid: isValidUUID(agentId),
        agentIdSource: providedAgentId ? 'request' : 'generated'
      })
      
      // Make tracked AI call with ACTIVITY TRACKING and CONSISTENT AGENT ID
      openAIResponse = await openaiProvider.chatCompletion(
        {
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
      
      console.log('✅ OpenAI API call completed with analytics and CONSISTENT AGENT ID tracking')
      
    } catch (fetchError: any) {
      logError('OPENAI_FETCH', fetchError)
      
      // CRITICAL: Include requirements analysis in error fallback
      const fallbackWithAnalysis = createFallbackResponse(finalPrompt, connectedPluginData)
      
      return NextResponse.json(
        { 
          error: 'OpenAI API connection failed',
          details: fetchError.message,
          ...fallbackWithAnalysis,
          connectedPlugins,
          connectedPluginData,
          sessionId: sessionId, // FIXED: Return consistent session ID
          agentId: agentId, // FIXED: Return consistent agent ID
          ...(pluginWarning && { pluginWarning })
        },
        { status: 500 }
      )
    }

    const rawContent = openAIResponse.choices?.[0]?.message?.content
    if (!rawContent) {
      console.error('❌ Empty OpenAI response content')
      
      // CRITICAL: Include requirements analysis in empty response fallback
      const fallbackWithAnalysis = createFallbackResponse(finalPrompt, connectedPluginData)
      
      return NextResponse.json(
        { 
          error: 'Empty AI response',
          ...fallbackWithAnalysis,
          connectedPlugins,
          connectedPluginData,
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
        aiResult.analysis = analyzeRequirements(finalPrompt, aiResult.clarityScore, connectedPlugins)
      }

      console.log('✅ AI result validated:', {
        hasClarityScore: 'clarityScore' in aiResult,
        hasQuestions: Array.isArray(aiResult.questionsSequence),
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
      aiResult = createFallbackResponse(finalPrompt, connectedPluginData)
      aiResult.aiParsingFailed = true
      aiResult.originalError = aiParseError.message
    }

    // Step 9: Add scheduling questions and validate consistency
    try {
      aiResult = validateConsistency(aiResult, finalPrompt, connectedPluginData)
    } catch (consistencyError) {
      logError('CONSISTENCY_VALIDATION', consistencyError)
    }

    // Step 10: Build final response with CONSISTENT AGENT ID
    const finalResult = {
      ...aiResult,
      connectedPlugins,
      connectedPluginData,
      pluginValidationError: false,
      sessionId: sessionId, // FIXED: Return consistent session ID
      agentId: agentId, // FIXED: Return consistent agent ID
      ...(pluginWarning && { pluginWarning })
    }

    console.log('✅ Request completed successfully with CONSISTENT AGENT ID:', {
      clarityScore: finalResult.clarityScore,
      questionsCount: finalResult.questionsSequence?.length || 0,
      needsClarification: finalResult.needsClarification,
      aiParsingFailed: finalResult.aiParsingFailed || false,
      pluginDataIncluded: finalResult.connectedPluginData?.length || 0,
      pluginWarningCreated: !!pluginWarning,
      analyticsTracked: true,
      activityTracked: true,
      sessionId: finalResult.sessionId,
      agentId: finalResult.agentId, // FIXED: Log consistent agent ID
      agentIdConsistent: providedAgentId === finalResult.agentId // FIXED: Verify consistency
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