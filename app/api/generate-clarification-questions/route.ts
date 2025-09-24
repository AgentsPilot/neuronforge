import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'
import { trackTokenUsage, LLMCategory } from '../../../components/orchestration/types/usage'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Plugin requirements mapping
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

// Smart scheduling question generator based on context
function generateDefaultSchedulingQuestions(userPrompt: string): ClarificationQuestion[] {
  const promptLower = userPrompt.toLowerCase();
  
  // Check if user already specified timing in prompt
  const hasTimingInPrompt = promptLower.includes('daily') || 
                           promptLower.includes('weekly') || 
                           promptLower.includes('monthly') ||
                           promptLower.includes('every') ||
                           promptLower.includes('schedule') ||
                           promptLower.includes('when') ||
                           /\d+\s*(am|pm|hour|minute)/.test(promptLower);
                           
  if (hasTimingInPrompt) {
    console.log('Timing already specified in prompt, skipping default scheduling questions');
    return [];
  }
  
  // Determine context-appropriate frequency options
  let frequencyOptions = [];
  let timeOptions = [];
  let frequencyQuestion = "How often should this automation run?";
  let timeQuestion = "What time should it execute?";
  
  if (promptLower.includes('email') || promptLower.includes('inbox') || promptLower.includes('gmail')) {
    frequencyOptions = ['Daily', 'Every 2 hours during work days', 'Weekly on Monday', 'When new emails arrive', 'Twice daily'];
    timeOptions = ['8:00 AM', '9:00 AM', '1:00 PM', '5:00 PM', 'Every 2 hours 9AM-5PM'];
    frequencyQuestion = "When should email processing occur?";
    timeQuestion = "What time works best for email processing?";
  } else if (promptLower.includes('report') || promptLower.includes('summary') || promptLower.includes('analyze')) {
    frequencyOptions = ['Daily', 'Weekly', 'Monthly', 'End of each work day', 'Bi-weekly'];
    timeOptions = ['8:00 AM', '6:00 PM', 'End of work day', 'Monday 9:00 AM', 'Friday 5:00 PM'];
    frequencyQuestion = "When should the report be generated?";
    timeQuestion = "What time should the report be created?";
  } else if (promptLower.includes('monitor') || promptLower.includes('check') || promptLower.includes('track')) {
    frequencyOptions = ['Every hour', 'Every 4 hours', 'Daily', 'When changes occur', 'Every 30 minutes'];
    timeOptions = ['Every hour 9-5', 'Every 2 hours', 'Continuously during work hours', '9:00 AM daily'];
    frequencyQuestion = "How frequently should we check for updates?";
    timeQuestion = "During what hours should monitoring occur?";
  } else if (promptLower.includes('backup') || promptLower.includes('sync') || promptLower.includes('copy')) {
    frequencyOptions = ['Daily', 'Weekly', 'Monthly', 'After each change', 'Twice weekly'];
    timeOptions = ['2:00 AM', '11:00 PM', 'Sunday 2:00 AM', 'Immediately after changes', '6:00 PM'];
    frequencyQuestion = "When should synchronization occur?";
    timeQuestion = "What time is best for data operations?";
  } else if (promptLower.includes('social') || promptLower.includes('post') || promptLower.includes('publish')) {
    frequencyOptions = ['Daily', 'Weekly', 'Multiple times per day', 'Every few hours', 'Custom schedule'];
    timeOptions = ['9:00 AM', '12:00 PM', '3:00 PM', '6:00 PM', 'Optimal engagement times'];
    frequencyQuestion = "When should content be published?";
    timeQuestion = "What time maximizes engagement?";
  } else {
    // General automation
    frequencyOptions = ['Daily', 'Weekly', 'Monthly', 'On-demand only', 'Custom frequency'];
    timeOptions = ['9:00 AM', '12:00 PM', '6:00 PM', 'Monday 9:00 AM', 'End of work day'];
  }
  
  return [
    {
      id: 'default_schedule_frequency',
      question: frequencyQuestion,
      type: 'select',
      required: true,
      dimension: 'scheduling_timing',
      placeholder: 'Choose frequency',
      options: frequencyOptions
    },
    {
      id: 'default_schedule_time',
      question: timeQuestion,
      type: 'select',
      required: true,
      dimension: 'scheduling_timing',
      placeholder: 'Choose timing',
      options: timeOptions
    }
  ];
}

export function buildClarifySystemPrompt(connectedPlugins: string[]) {
  return `
You are the Clarification Engine for AgentPilot, a no-code AI agent platform.

Your role is to analyze user automation requests and identify what additional information is needed to build a complete, actionable agent configuration.

INPUTS:
- userPrompt: The user's description of their desired automation
- connectedPlugins: List of currently authenticated integrations

CORE PRINCIPLES:
1. Ask only essential questions needed to build the automation
2. Prioritize clarity over completeness - better to ask fewer, more targeted questions
3. Consider workflows that span multiple steps and plugins
4. Handle both simple tasks and complex multi-stage automations
5. Support conditional logic and decision-making workflows

CRITICAL SCHEDULING REQUIREMENT:
DO NOT include scheduling/timing questions in your response. The system will automatically add appropriate scheduling questions based on the automation context. Focus only on:

ANALYSIS DIMENSIONS:

Evaluate these aspects and ask clarifying questions only when information is missing or ambiguous:

**Data & Input Sources**
- What data does the agent need to access?
- Which plugins/sources contain this data?
- Are there specific filters, criteria, or timeframes?
- How should the agent handle multiple data sources?

**Processing & Logic**
- What operations should be performed on the data?
- Are there conditional rules or decision points?
- Should different actions happen based on data content?
- Are there multi-step processing requirements?

**Output & Actions**
- What should the agent produce or do?
- What format should outputs take?
- Where should results be delivered or stored?
- Should multiple actions happen simultaneously or sequentially?

**Error Handling & Edge Cases**
- How should errors or edge cases be handled?
- Are there approval steps or human checkpoints needed?

**Integration Requirements**
- Which plugins are needed for this automation?
- How should data flow between different tools?
- Are there authentication or permission considerations?

PLUGIN HANDLING:

Connected Plugins: ${JSON.stringify(connectedPlugins)}

IMPORTANT: Only ask questions about connected plugins. If the user mentions a service that isn't connected, do NOT generate questions about it. Focus on alternatives using connected plugins or suggest they connect the required service first.

For plugin references:
- If a plugin is connected: Use it in your questions and automation planning
- If a plugin is mentioned but not connected: Do NOT ask questions about it - instead suggest connecting it first
- Focus questions only on plugins that are actually available

QUESTION GENERATION RULES:

Ask questions that are:
- Specific and actionable
- Focused on missing information that affects implementation
- Grouped logically when related
- Limited to what's truly necessary (ideally 3-5 questions maximum)
- DO NOT include scheduling/timing questions (these are added automatically)

Avoid questions about:
- Information already provided in the prompt
- Implementation details the system can infer
- Overly granular configuration options
- Generic preferences without automation impact
- Scheduling or timing (handled by the system automatically)

OUTPUT FORMAT:

Return a JSON array of questions directly. Each question should have this structure:

[
  {
    "id": "unique_id",
    "dimension": "data_input | processing_logic | output_actions | integration_requirements",
    "question": "Clear, specific question text",
    "type": "text | textarea | select | multiselect | date",
    "options": ["option1", "option2"], // only for select/multiselect
    "placeholder": "Helpful example or guidance text",
    "allowCustom": true, // for select/multiselect if custom options allowed
    "required": true
  }
]

If no clarification is needed, return an empty array: []

EXAMPLES OF GOOD QUESTIONS:

Instead of "What should be included in the summary?" ask:
"What key information should the summary highlight? (e.g., action items, deadlines, decisions made)"

Instead of "Where should results be stored?" ask:
"Should the analysis be sent as an email, saved to a specific folder, or posted in a channel?"

Remember: Your goal is to gather the minimum information needed to build a functional automation, excluding scheduling details which are handled separately.

Return ONLY the JSON array, no markdown formatting, code blocks, or explanatory text.
`.trim()
}

// Validate mentioned plugins are connected
function validateConnectedPlugins(prompt: string, connectedPlugins: string[]): string[] {
  const promptLower = prompt.toLowerCase()
  const mentionedButNotConnected: string[] = []
  
  for (const [service, aliases] of Object.entries(PLUGIN_REQUIREMENTS)) {
    const isMentioned = aliases.some(alias => promptLower.includes(alias))
    const isConnected = aliases.some(alias => 
      connectedPlugins.some(connected => 
        connected.toLowerCase().includes(alias.toLowerCase())
      )
    )
    
    if (isMentioned && !isConnected) {
      mentionedButNotConnected.push(service)
    }
  }
  
  return mentionedButNotConnected
}

interface ClarificationQuestion {
  id: string
  question: string
  placeholder?: string
  required?: boolean
  type: 'text' | 'textarea' | 'select' | 'multiselect' | 'enum' | 'date'
  options?: string[]
  dimension?: string
}

interface ClarificationResponse {
  questions: ClarificationQuestion[]
  reasoning: string
  confidence: number
}

// Updated scheduling question generator that avoids duplicates
function generateSchedulingQuestions(userPrompt: string, existingQuestions: ClarificationQuestion[]): ClarificationQuestion[] {
  const promptLower = userPrompt.toLowerCase();
  
  // Skip if scheduling already exists in existing questions
  const hasScheduling = existingQuestions.some(q => 
    q.question.toLowerCase().includes('when') || 
    q.question.toLowerCase().includes('schedule') ||
    q.question.toLowerCase().includes('frequency') ||
    q.question.toLowerCase().includes('time') ||
    q.dimension === 'scheduling_timing'
  );
  
  if (hasScheduling) {
    console.log('Scheduling questions already exist, skipping generation');
    return [];
  }
  
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
  
  return generateDefaultSchedulingQuestions(userPrompt);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { original_prompt, agent_name, description, connected_plugins, user_id } = body

    if (!original_prompt?.trim()) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    console.log('=== DEBUGGING PLUGIN VALIDATION ===')
    console.log('1. Original prompt:', original_prompt)
    console.log('2. Raw connected_plugins from request:', connected_plugins)
    console.log('3. Initial pluginKeys from frontend:', Object.keys(connected_plugins || {}))
    
    // Try to get connected plugins from multiple sources
    let pluginKeys: string[] = []

    // Method 1: From frontend (fallback to ensure we have plugins)
    if (connected_plugins && typeof connected_plugins === 'object') {
      pluginKeys = Object.keys(connected_plugins)
      console.log('4. PluginKeys after frontend:', pluginKeys)
    }

    // Method 2: From database (if user_id provided and table exists)
    if (user_id) {
      try {
        const { data: connections, error: pluginError } = await supabase
          .from('plugin_connections')
          .select('plugin_key')
          .eq('user_id', user_id)
          .eq('status', 'active')

        if (!pluginError && connections && connections.length > 0) {
          const dbPlugins = connections.map(c => c.plugin_key)
          console.log('5. Database plugins found:', dbPlugins)
          // Merge database plugins with frontend plugins
          pluginKeys = [...new Set([...pluginKeys, ...dbPlugins])]
          console.log('6. PluginKeys after database merge:', pluginKeys)
        } else {
          console.log('5. No plugins found in database, using frontend plugins:', pluginKeys)
        }
      } catch (dbError) {
        console.warn('Database plugin query failed, using frontend plugins:', dbError)
      }
    }

    // Method 3: Default plugins if nothing found
    if (pluginKeys.length === 0) {
      pluginKeys = ['gmail', 'google-drive', 'slack', 'calendar', 'google-sheets']
      console.log('7. No plugins found, using defaults:', pluginKeys)
    }

    console.log('8. Final plugin list BEFORE validation:', pluginKeys)

    // Validate mentioned plugins are connected
    const missingPlugins = validateConnectedPlugins(original_prompt, pluginKeys)
    console.log('9. Missing plugins detected:', missingPlugins)
    let pluginWarning = null
    
    if (missingPlugins.length > 0) {
      console.log('10. User mentioned unconnected plugins:', missingPlugins)
      
      // Create a warning about missing plugins
      pluginWarning = {
        missingServices: missingPlugins,
        message: `Note: Your request mentions ${missingPlugins.join(', ')} but ${missingPlugins.length === 1 ? 'this service isn\'t' : 'these services aren\'t'} connected. Questions will focus on your available services instead.`
      }
      console.log('11. Plugin validation warning:', pluginWarning.message)
      
      // CRITICAL FIX: Remove mentioned but unconnected plugins from the list we send to AI
      const unconnectedAliases = missingPlugins.flatMap(service => 
        PLUGIN_REQUIREMENTS[service as keyof typeof PLUGIN_REQUIREMENTS] || [service]
      )
      
      console.log('12. Unconnected aliases to filter out:', unconnectedAliases)
      
      const originalPluginKeys = [...pluginKeys]
      pluginKeys = pluginKeys.filter(plugin => {
        const pluginLower = plugin.toLowerCase()
        const shouldRemove = unconnectedAliases.some(alias => 
          pluginLower.includes(alias.toLowerCase())
        )
        if (shouldRemove) {
          console.log(`13. Removing unconnected plugin from AI context: ${plugin}`)
        }
        return !shouldRemove
      })
      
      console.log('14. Original plugins:', originalPluginKeys)
      console.log('15. Filtered plugin list (unconnected removed):', pluginKeys)
    } else {
      console.log('10. No missing plugins detected')
    }

    console.log('16. FINAL plugin list sent to AI:', pluginKeys)
    console.log('=== END DEBUGGING ===')

    const contextMessage = `
user_prompt: "${original_prompt}"
connected_plugins: ${JSON.stringify(pluginKeys)}
agent_name: "${agent_name || 'Not specified'}"
description: "${description || 'Not provided'}"

CRITICAL: Only ask questions about services in the connected_plugins list above. Do not reference any other services. Do not include scheduling/timing questions.

Please analyze this automation request and return clarifying questions as a JSON array. The system will automatically add appropriate scheduling questions.
`

    console.log('17. Context message sent to AI:', contextMessage)

    const { response: llmResponse, usage } = await callOpenAI(buildClarifySystemPrompt(pluginKeys), contextMessage)
    const clarificationData = await parseAndValidateLLMResponse(llmResponse, original_prompt)

    // Track token usage using your utility function
    if (user_id) {
      await trackTokenUsage(supabase, user_id, {
        modelName: 'gpt-4o',
        provider: 'openai',
        inputTokens: usage.prompt_tokens,
        outputTokens: usage.completion_tokens,
        requestType: 'chat',
        category: LLMCategory.QUESTION_CLARIFICATION,
        metadata: {
          agent_name,
          original_prompt,
          questions_generated: clarificationData.questions.length,
          connected_plugins: pluginKeys,
          confidence: clarificationData.confidence
        }
      })
    }

    // Log analytics (but don't fail if this errors)
    try {
      await supabase.from('clarification_analytics').insert([{
        user_id,
        original_prompt,
        agent_name,
        description,
        connected_plugins: pluginKeys,
        generated_questions: clarificationData.questions,
        questions_count: clarificationData.questions.length,
        generated_at: new Date().toISOString()
      }])
    } catch (analyticsError) {
      console.warn('Analytics logging failed:', analyticsError)
    }

    console.log('🔍 SIMPLE DEBUG - Final data being returned:', { 
      pluginKeys, 
      hasNotionInPlugins: pluginKeys.includes('notion'),
      clarificationQuestions: clarificationData.questions.map(q => q.question)
    })

    return NextResponse.json({
      ...clarificationData,
      ...(pluginWarning && { pluginWarning })
    })

  } catch (error) {
    console.error('Clarification API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function callOpenAI(systemPrompt: string, userPrompt: string): Promise<{
  response: any,
  usage: {
    prompt_tokens: number,
    completion_tokens: number,
    total_tokens: number
  }
}> {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3,
      max_tokens: 1500
    })

    let content = completion.choices[0]?.message?.content || '[]'

    // Remove markdown wrapper (```json ... ```)
    content = content.trim()
    if (content.startsWith('```')) {
      content = content.replace(/```json|```/g, '').trim()
    }

    console.log('Raw GPT response:', content)
    
    return {
      response: JSON.parse(content),
      usage: completion.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    }

  } catch (e) {
    console.error('GPT parse failure:', e)
    return {
      response: [],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    }
  }
}

async function parseAndValidateLLMResponse(llmResponse: any, originalPrompt: string): Promise<ClarificationResponse> {
  try {
    console.log('Raw LLM response type:', typeof llmResponse)
    console.log('Raw LLM response:', JSON.stringify(llmResponse, null, 2))
    
    let questionsArray: any[] = []
    
    // The LLM should now return a direct array based on the updated system prompt
    if (Array.isArray(llmResponse)) {
      questionsArray = llmResponse
      console.log('LLM returned direct array format')
    }
    // Fallback: handle legacy structured formats if they still occur
    else if (llmResponse && typeof llmResponse === 'object') {
      if (llmResponse.questionsSequence && Array.isArray(llmResponse.questionsSequence)) {
        questionsArray = llmResponse.questionsSequence
        console.log('Using legacy questionsSequence format')
      }
      else if (llmResponse.questions && Array.isArray(llmResponse.questions)) {
        questionsArray = llmResponse.questions
        console.log('Using legacy questions array format')
      }
      else if (llmResponse.needsClarification === false) {
        console.log('LLM says no clarification needed, but will add default scheduling questions')
        questionsArray = []
      }
      else {
        console.log('Unexpected object format, trying to find questions')
        // Try to find any array property that might contain questions
        for (const [key, value] of Object.entries(llmResponse)) {
          if (Array.isArray(value) && value.length > 0) {
            questionsArray = value
            console.log(`Found questions in property: ${key}`)
            break
          }
        }
      }
    }
    
    console.log('Questions array to process:', questionsArray.length, 'items')

    const questions: ClarificationQuestion[] = questionsArray
      .map((q, i) => {
        if (!q || typeof q !== 'object') {
          console.log(`Skipping question ${i + 1}: Invalid question object`)
          return null
        }

        const type = (q.type || 'text').toLowerCase() as ClarificationQuestion['type']
        const structured = ['select', 'enum', 'multiselect'].includes(type)

        if (!q.question?.trim()) {
          console.log(`Skipping question ${i + 1}: No question text`)
          return null
        }
        
        if (!q.type) {
          console.log(`Skipping question ${i + 1}: No type specified`)
          return null
        }
        
        if (structured && (!Array.isArray(q.options) || q.options.length < 2)) {
          console.log(`Skipping question ${i + 1}: Structured type but invalid options:`, q.options)
          return null
        }

        // Generate better placeholder if not provided
        let placeholder = q.placeholder || 'Enter your answer...'
        
        if (!q.placeholder) {
          switch (type) {
            case 'text':
              placeholder = 'Enter a short answer...'
              break
            case 'textarea':
              placeholder = 'Provide detailed information...'
              break
            case 'date':
              placeholder = 'Select a date'
              break
            case 'select':
            case 'multiselect':
            case 'enum':
              placeholder = structured ? 'Choose from the options above' : 'Select an option...'
              break
          }
        }

        return {
          id: q.id || `question_${i + 1}`,
          question: q.question.trim(),
          type,
          required: q.required !== false, // Default to true unless explicitly false
          placeholder,
          dimension: q.dimension || 'general',
          options: structured ? q.options : undefined
        }
      })
      .filter(Boolean) as ClarificationQuestion[]

    console.log(`Parsed ${questions.length} valid questions from ${questionsArray.length} raw questions`)

    // CRITICAL FIX: Always add scheduling questions if none exist
    const scheduleQuestions = generateSchedulingQuestions(originalPrompt, questions)
    
    // If no scheduling questions were added (because they already exist or timing is in prompt), 
    // but we have no questions at all, add default scheduling questions anyway
    if (scheduleQuestions.length === 0 && questions.length === 0) {
      console.log('No questions at all, adding default scheduling questions anyway')
      const defaultScheduleQuestions = generateDefaultSchedulingQuestions(originalPrompt)
      questions.push(...defaultScheduleQuestions)
      console.log(`Added ${defaultScheduleQuestions.length} default scheduling questions`)
    } else {
      questions.push(...scheduleQuestions)
      console.log(`Added ${scheduleQuestions.length} scheduling questions. Total: ${questions.length}`)
    }

    if (questions.length === 0) {
      console.log('Still no questions generated, using enhanced fallback with scheduling')
      return {
        questions: [
          { 
            id: 'fallback_task', 
            question: 'What specific task should this automation perform?', 
            type: 'textarea',
            required: true,
            dimension: 'processing_logic',
            placeholder: 'e.g. "Summarize important emails", "Track project updates", "Monitor customer feedback"'
          },
          {
            id: 'fallback_frequency',
            question: 'How often should this automation run?',
            type: 'select',
            required: true,
            dimension: 'scheduling_timing',
            placeholder: 'Choose frequency',
            options: ['Daily', 'Weekly', 'Monthly', 'On-demand only']
          },
          {
            id: 'fallback_time',
            question: 'What time should it execute?',
            type: 'select',
            required: true,
            dimension: 'scheduling_timing',
            placeholder: 'Choose timing',
            options: ['9:00 AM', '12:00 PM', '6:00 PM', 'End of work day']
          }
        ],
        reasoning: 'Generated comprehensive fallback questions including essential scheduling requirements.',
        confidence: 55
      }
    }

    return {
      questions: questions.slice(0, 7), // Increased limit to accommodate scheduling
      reasoning: `Generated ${questions.length} targeted clarification question${questions.length === 1 ? '' : 's'} to refine your automation requirements, including scheduling details.`,
      confidence: Math.min(95, 70 + (questions.length * 5))
    }

  } catch (e) {
    console.error('Parse validation error:', e)
    console.error('LLM Response that caused error:', llmResponse)
    
    // Generate default scheduling questions even in error case
    const defaultScheduleQuestions = generateDefaultSchedulingQuestions(originalPrompt)
    
    return {
      questions: [
        {
          id: 'error_fallback',
          question: 'Could you describe what you want this automation to accomplish?',
          type: 'textarea',
          required: true,
          dimension: 'processing_logic',
          placeholder: 'Please provide more details about your automation goals...'
        },
        ...defaultScheduleQuestions
      ],
      reasoning: 'Unable to parse AI response, using basic fallback questions with scheduling.',
      confidence: 30
    }
  }
}