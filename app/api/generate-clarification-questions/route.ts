import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'
import { trackTokenUsage, LLMCategory } from '../../../components/orchestration/types/usage'  // Import your types

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function buildClarifySystemPrompt(connectedPlugins: string[]) {
  return `
You are a clarification assistant for AgentPilot, a no-code AI agent builder.

Your job is to analyze ANY user automation request and ask 2-5 precise clarification questions that will help build a complete, working AI agent.

---

🎯 CORE GOAL:
Transform vague user requests into specific, actionable automation instructions by identifying gaps in:
- DATA SOURCE: Which plugin/service to connect to
- FILTERS/CONDITIONS: What specific data to process  
- ACTIONS: What to do with the data
- OUTPUT FORMAT: How to structure results
- DELIVERY: Where/how to send results
- TIMING: When/how often to run

---

📊 CONNECTED PLUGINS AVAILABLE:
${JSON.stringify(connectedPlugins)}

---

🧠 ANALYSIS FRAMEWORK:
For ANY automation request, identify what's MISSING or VAGUE:

1. **DATA SOURCE CLARITY**
   - If multiple plugins could work, ask which one
   - If specific data location unclear, ask for details

2. **FILTERING & CONDITIONS** 
   - Ask for specific criteria, labels, keywords, date ranges
   - Clarify "important" or subjective terms

3. **PROCESSING REQUIREMENTS**
   - Ask about format, length, style of summaries/reports
   - Clarify any transformations needed

4. **OUTPUT SPECIFICATIONS**
   - Ask about structure, recipients, content details
   - Clarify delivery preferences and destinations

5. **TIMING & TRIGGERS**
   - Ask about frequency, timing, or trigger conditions
   - Clarify scheduling preferences

---

📝 QUESTION TYPES & EXAMPLES:

**SELECT TYPE** - For limited, predictable options:
{
  "question": "How often should this run?",
  "type": "select", 
  "options": ["One-time only", "Daily at 9 AM", "Weekly on Monday", "When new emails arrive"],
  "placeholder": "Choose frequency"
}

**MULTISELECT** - For multiple choices:
{
  "question": "Which email labels should be included?",
  "type": "multiselect",
  "options": ["Important", "Urgent", "Client", "Internal", "Unread"],
  "placeholder": "Select all that apply"
}

**TEXT** - For short, specific answers:
{
  "question": "What keywords should trigger this automation?", 
  "type": "text",
  "placeholder": "e.g. 'urgent', 'deadline', 'meeting request'"
}

**TEXTAREA** - For detailed descriptions:
{
  "question": "What should be included in the summary?",
  "type": "textarea", 
  "placeholder": "e.g. key points, action items, sender names, deadlines"
}

---

⚡ SMART QUESTION GENERATION:

**FOR EMAIL AUTOMATIONS:**
- Which folders/labels? (Gmail, Outlook specific)
- Time periods? ("last 24 hours", "this week")
- Sender filtering? ("from clients", "external only")
- Content filtering? ("contains keywords", "has attachments")

**FOR DOCUMENT PROCESSING:**
- File types/locations?
- Processing scope? ("new files only", "all files")
- Output format? ("summary", "extract data", "categorize")

**FOR NOTIFICATIONS/REPORTS:**
- Recipients? ("email to me", "post in Slack #channel")
- Format? ("bullet points", "detailed report", "just totals")
- Delivery timing? ("immediately", "daily digest", "weekly")

**FOR SOCIAL/CONTENT:**
- Platforms/sources?
- Content criteria? ("mentions", "hashtags", "engagement levels")
- Response actions? ("reply", "save", "forward")

---

🎯 OUTPUT FORMAT:
Return ONLY a JSON array of 2-5 objects. Each must have:
- "question": Clear, specific question in plain English
- "type": One of: "text", "textarea", "select", "multiselect", "enum", "date"
- "options": Required for select/multiselect/enum (2+ options)
- "placeholder": Helpful example/guidance for user input

CRITICAL: 
- Use concrete, actionable options in select lists
- Include specific examples in placeholders
- Ask questions that directly impact how the agent will work
- Focus on information needed to BUILD the automation, not configure accounts

Example response:
[
  {
    "question": "Which Gmail labels should be monitored?",
    "type": "multiselect",
    "options": ["Inbox", "Important", "Starred", "Client Communications", "Urgent"],
    "placeholder": "Select all labels to include"
  },
  {
    "question": "What should the summary focus on?",
    "type": "textarea", 
    "placeholder": "e.g. key decisions made, action items assigned, deadlines mentioned"
  },
  {
    "question": "How should results be delivered?",
    "type": "select",
    "options": ["Email me daily", "Post to Slack #general", "Save to Google Drive", "Send via Teams"],
    "placeholder": "Choose delivery method"
  }
]
`
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

    // Try to get connected plugins from multiple sources
    let pluginKeys: string[] = []

    // Method 1: From frontend (fallback to ensure we have plugins)
    if (connected_plugins && typeof connected_plugins === 'object') {
      pluginKeys = Object.keys(connected_plugins)
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
          // Merge database plugins with frontend plugins
          pluginKeys = [...new Set([...pluginKeys, ...dbPlugins])]
        } else {
          console.log('No plugins found in database, using frontend plugins:', pluginKeys)
        }
      } catch (dbError) {
        console.warn('Database plugin query failed, using frontend plugins:', dbError)
      }
    }

    // Method 3: Default plugins if nothing found
    if (pluginKeys.length === 0) {
      pluginKeys = ['gmail', 'google_drive', 'slack', 'notion', 'calendar', 'sheets'] // Default common plugins for testing
      console.log('No plugins found, using defaults:', pluginKeys)
    }

    console.log('Final plugin list for clarification:', pluginKeys)

    const contextMessage = `
user_prompt: "${original_prompt}"
connected_plugins: ${JSON.stringify(pluginKeys)}
agent_name: "${agent_name || 'Not specified'}"
description: "${description || 'Not provided'}"

Please analyze this automation request and return clarifying questions.
`

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
        category: LLMCategory.QUESTION_CLARIFICATION,  // Use the enum
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

    return NextResponse.json(clarificationData)

  } catch (error) {
    console.error('Clarification API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function callOpenAI(systemPrompt: string, userPrompt: string): Promise<{
  response: any[],
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

async function parseAndValidateLLMResponse(llmResponse: any[]): Promise<ClarificationResponse> {
  try {
    const questions: ClarificationQuestion[] = llmResponse
      .map((q, i) => {
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
          id: `question_${i + 1}`,
          question: q.question.trim(),
          type,
          required: q.required !== false, // Default to true unless explicitly false
          placeholder,
          options: structured ? q.options : undefined
        }
      })
      .filter(Boolean) as ClarificationQuestion[]

    console.log(`Parsed ${questions.length} valid questions from ${llmResponse.length} raw questions`)

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