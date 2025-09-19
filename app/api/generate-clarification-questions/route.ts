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

**Execution Context**
- When/how often should this run?
- What triggers should initiate the agent?
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

Avoid questions about:
- Information already provided in the prompt
- Implementation details the system can infer
- Overly granular configuration options
- Generic preferences without automation impact

OUTPUT FORMAT:

Return a JSON array of questions directly. Each question should have this structure:

[
  {
    "id": "unique_id",
    "dimension": "data_input | processing_logic | output_actions | execution_context | integration_requirements",
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

Instead of "How often should this run?" ask:
"What should trigger this automation? (e.g., daily at 9 AM, when new emails arrive, weekly on Fridays)"

Remember: Your goal is to gather the minimum information needed to build a functional automation, not to collect every possible configuration detail.

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
}

interface ClarificationResponse {
  questions: ClarificationQuestion[]
  reasoning: string
  confidence: number
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

CRITICAL: Only ask questions about services in the connected_plugins list above. Do not reference any other services.

Please analyze this automation request and return clarifying questions as a JSON array.
`

    console.log('17. Context message sent to AI:', contextMessage)

    const { response: llmResponse, usage } = await callOpenAI(buildClarifySystemPrompt(pluginKeys), contextMessage)
    const clarificationData = await parseAndValidateLLMResponse(llmResponse)

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

async function parseAndValidateLLMResponse(llmResponse: any): Promise<ClarificationResponse> {
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
        console.log('LLM says no clarification needed')
        return {
          questions: [],
          reasoning: llmResponse.reasoning || 'Prompt contains sufficient detail for implementation',
          confidence: llmResponse.confidence || 90
        }
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
          options: structured ? q.options : undefined
        }
      })
      .filter(Boolean) as ClarificationQuestion[]

    console.log(`Parsed ${questions.length} valid questions from ${questionsArray.length} raw questions`)

    if (questions.length === 0) {
      console.log('No valid questions generated, using enhanced fallback')
      return {
        questions: [
          { 
            id: 'fallback_1', 
            question: 'What specific task should this automation perform?', 
            type: 'textarea',
            required: true,
            placeholder: 'e.g. "Summarize important emails", "Track project updates", "Monitor customer feedback"'
          },
          {
            id: 'fallback_2',
            question: 'How often should this automation run?',
            type: 'select',
            required: true,
            placeholder: 'Choose timing',
            options: ['One-time only', 'Daily at 9 AM', 'Weekly on Monday', 'When new items arrive', 'Every hour during work days']
          },
          {
            id: 'fallback_3',
            question: 'How would you like to receive the results?',
            type: 'select',
            required: true,
            placeholder: 'Choose delivery method',
            options: ['Email me the results', 'Show on screen only', 'Save to Google Drive', 'Post in Slack channel', 'Send via Teams message']
          }
        ],
        reasoning: 'Generated comprehensive fallback questions to capture essential automation requirements.',
        confidence: 55
      }
    }

    return {
      questions: questions.slice(0, 5),
      reasoning: `Generated ${questions.length} targeted clarification question${questions.length === 1 ? '' : 's'} to refine your automation requirements.`,
      confidence: Math.min(95, 70 + (questions.length * 5))
    }

  } catch (e) {
    console.error('Parse validation error:', e)
    console.error('LLM Response that caused error:', llmResponse)
    
    return {
      questions: [
        {
          id: 'error_fallback',
          question: 'Could you describe what you want this automation to accomplish?',
          type: 'textarea',
          required: true,
          placeholder: 'Please provide more details about your automation goals...'
        }
      ],
      reasoning: 'Unable to parse AI response, using basic fallback question.',
      confidence: 30
    }
  }
}