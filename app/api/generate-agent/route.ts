// app/api/generate-agent/route.ts

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import OpenAI from 'openai'
import { detectPluginsFromPrompt } from '@/lib/plugins/detectPluginsFromPrompt'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

export async function POST(req: Request) {
  const { prompt } = await req.json()
  const cookieStore = await cookies()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name) => cookieStore.get(name)?.value,
        set: async () => {},
        remove: async () => {},
      },
    }
  )

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // STEP 1 — Get connected plugins
  const { data: pluginRows, error: pluginError } = await supabase
    .from('plugin_connections')
    .select('plugin_key')
    .eq('user_id', user.id)

  console.log('🔍 Raw plugin query result:', { pluginRows, pluginError, userId: user.id })

  const connectedPlugins = pluginRows?.map((p) => p.plugin_key) || []
  
  console.log('🔍 Connected plugins:', connectedPlugins)
  console.log('📝 User prompt:', prompt)

  // STEP 2 — Ask GPT to analyze the prompt and determine if clarification is needed
  const clarificationCompletion = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [
      {
        role: 'system',
        content: `
You are an AI assistant that analyzes user automation requests and determines if clarification is needed.

Your job is to:
1. Determine if the user request is specific enough to build an agent
2. Identify what type of service/plugin the request relates to
3. Decide if clarification questions are needed

Plugin categories:
- email: Email-related tasks (Gmail, Outlook, etc.)
- calendar: Calendar/scheduling tasks (Google Calendar, Outlook Calendar, etc.)
- storage: File storage tasks (Google Drive, Dropbox, etc.)
- productivity: Productivity tools (Notion, Trello, Asana, etc.)
- crm: Customer relationship management (Salesforce, HubSpot, etc.)
- communication: Chat/messaging (Slack, Discord, Teams, etc.)
- general: Other or unclear requests

Rules for when to ask clarification:
- If the request is vague or missing key details
- If multiple plugins of the same type are available and user didn't specify
- If the action isn't clear or could be interpreted multiple ways
- If important parameters are missing (time ranges, folders, criteria, etc.)
- If quantitative details are missing (how many, what range, etc.)

Examples that NEED clarification:
- "summarize my emails" (which service? folder? time range? how many?)
- "schedule a meeting" (which calendar? duration? attendees? when?)
- "organize my files" (which service? what criteria? what action?)
- "update my contacts" (which CRM? what data? what criteria?)
- "Look at my calendar and find meetings with client Offir" (which calendar service? what time range?)

Examples that DON'T need clarification:
- "summarize my last 5 emails from Gmail inbox from today"
- "schedule a 30-minute meeting tomorrow at 2pm with John using Google Calendar"
- "create a new page in my Notion workspace called 'Project Ideas'"

ONLY respond with valid JSON:
{
  "needs_clarification": true/false,
  "plugin_type": "email|calendar|storage|productivity|crm|communication|general",
  "reasoning": "Brief explanation of why clarification is/isn't needed"
}
`.trim(),
      },
      {
        role: 'user',
        content: `Analyze this user request: "${prompt}"

Connected plugins: ${connectedPlugins.join(', ') || 'None'}

Does this request need clarification questions?`,
      },
    ],
    temperature: 0.2,
  })

  const clarificationRaw = clarificationCompletion.choices[0]?.message?.content || ''
  console.log('🤖 GPT clarification response:', clarificationRaw)

  try {
    const analysis = JSON.parse(clarificationRaw)
    console.log('✅ Parsed analysis:', analysis)
    
    if (analysis.needs_clarification) {
      // Generate simple questions based on plugin type
      let questions = []
      
      if (analysis.plugin_type === 'calendar') {
        questions = [
          {
            id: 'calendar_service',
            question: 'Which calendar service should I use?',
            type: 'select',
            required: true,
            options: connectedPlugins.filter(p => 
              p.toLowerCase().includes('calendar') || 
              p.toLowerCase().includes('google-calendar') ||
              p.toLowerCase().includes('outlook')
            ),
            placeholder: 'Select calendar service'
          },
          {
            id: 'time_range',
            question: 'What time range should I look at?',
            type: 'select',
            required: true,
            options: ['Last week', 'Last month', 'Last 3 months', 'Last 6 months', 'This year'],
            placeholder: 'Select time range'
          },
          {
            id: 'meeting_details',
            question: 'What specific details should I focus on in the summary?',
            type: 'multiselect',
            required: true,
            options: ['Meeting titles', 'Attendees', 'Meeting notes', 'Duration', 'Dates and times'],
            placeholder: 'Select details to include'
          }
        ]
      } else if (analysis.plugin_type === 'email') {
        const emailPlugins = connectedPlugins.filter(p => 
          p.toLowerCase().includes('gmail') || 
          p.toLowerCase().includes('google-mail') ||
          p.toLowerCase().includes('outlook') ||
          p.toLowerCase().includes('email') ||
          p.toLowerCase().includes('mail')
        )
        
        questions = [
          {
            id: 'email_service',
            question: 'Which email service should I use?',
            type: 'select',
            required: true,
            options: emailPlugins.length > 0 ? emailPlugins : ['Gmail', 'Outlook', 'Yahoo Mail'],
            placeholder: 'Select email service'
          },
          {
            id: 'email_folder',
            question: 'Which folder should I check?',
            type: 'select',
            required: true,
            options: ['Inbox', 'Sent', 'All Mail', 'Specific folder'],
            placeholder: 'Select folder'
          },
          {
            id: 'time_range',
            question: 'What time range?',
            type: 'select',
            required: true,
            options: ['Last 24 hours', 'Last week', 'Last month', 'Custom range'],
            placeholder: 'Select time range'
          }
        ]
      } else {
        // Generic questions
        questions = [
          {
            id: 'service_selection',
            question: 'Which service should I use?',
            type: 'select',
            required: true,
            options: connectedPlugins,
            placeholder: 'Select service'
          },
          {
            id: 'action_details',
            question: 'What specific action should I perform?',
            type: 'textarea',
            required: true,
            placeholder: 'Describe what you want the agent to do'
          }
        ]
      }
      
      console.log('📋 Generated questions:', JSON.stringify(questions, null, 2))
      
      return NextResponse.json({
        questions: questions,
        connected_plugins: connectedPlugins,
        plugin_type: analysis.plugin_type,
        reasoning: analysis.reasoning
      })
    }
  } catch (e) {
    console.error('❌ Failed to parse clarification response:', e)
    console.error('Raw response was:', clarificationRaw)
    
    // Always return simple fallback questions
    const fallbackQuestions = [
      {
        id: 'service_selection',
        question: 'Which connected service should I use?',
        type: 'select',
        required: true,
        options: connectedPlugins.length > 0 ? connectedPlugins : ['No services connected'],
        placeholder: 'Select service'
      },
      {
        id: 'action_description',
        question: 'Please describe what you want this agent to do',
        type: 'textarea',
        required: true,
        placeholder: 'Enter your request in detail'
      }
    ]
    
    console.log('🔄 Using fallback questions:', JSON.stringify(fallbackQuestions, null, 2))
    
    return NextResponse.json({
      questions: fallbackQuestions,
      connected_plugins: connectedPlugins,
      plugin_type: 'general',
      error: 'Failed to parse AI response, using fallback questions'
    })
  }

  // STEP 3 — Generate the agent directly (only if no questions needed)
  const completion = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [
      {
        role: 'system',
        content: `You are an AI assistant that creates agent specs for an agent-based automation platform.

Given a natural language user request, return a JSON object with the following fields:
- agent_name
- user_prompt
- system_prompt
- description
- input_schema: an array of input fields (each with name, type, required)

Important rules:
- DO NOT include any authentication-related fields (like email, password, access token).
- Only include fields that the user must provide to run the agent (like topic, number of emails, etc).
- If the user prompt already includes a number (like "last 5 emails"), do not include a separate input field for that.
- Keep the prompts clean and professional. Do not repeat the user request verbatim.`,
      },
      {
        role: 'user',
        content: `Create an agent for the following:\n${prompt}`,
      },
    ],
    temperature: 0.4,
  })

  const raw = completion.choices[0]?.message?.content || ''

  let extracted
  try {
    extracted = JSON.parse(raw)
  } catch (e) {
    console.error('❌ Failed to parse LLM response:', raw)
    return NextResponse.json({ error: 'Failed to parse AI response.', raw }, { status: 500 })
  }

  const detectedPlugins = detectPluginsFromPrompt(prompt)

  const { data: newAgent, error } = await supabase
    .from('agents')
    .insert({
      user_id: user.id,
      agent_name: extracted.agent_name || 'Untitled Agent',
      user_prompt: extracted.user_prompt,
      system_prompt: extracted.system_prompt || 'You are a helpful assistant.',
      description: extracted.description || '',
      plugins_required: detectedPlugins,
      input_schema: extracted.input_schema || [],
      output_schema: [],
      status: 'draft',
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ agent: newAgent })
}