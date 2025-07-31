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

  const { data: pluginRows, error: pluginError } = await supabase
    .from('plugin_connections')
    .select('plugin_key')
    .eq('user_id', user.id)

  const connectedPlugins = pluginRows?.map((p) => p.plugin_key) || []

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

IMPORTANT: Plugins are already authenticated and connected. Never ask about which account, email address, username, or workspace to use.

Rules for when to ask clarification:
- If the request is vague or missing key details about the task itself
- If the action isn't clear or could be interpreted multiple ways
- If important functional parameters are missing (time ranges, folders, criteria, quantities, etc.)
- If quantitative details are missing (how many, what range, etc.)

Examples that NEED clarification:
- "summarize my emails" (missing: how many, from when, which label)
- "schedule a meeting" (missing: duration, participants, topic)
- "organize my files" (missing: criteria, destination)

Examples that DON'T need clarification:
- "summarize my last 5 emails from Gmail inbox from today"
- "schedule a 30-minute meeting tomorrow at 2pm with John"
- "create a new page in my Notion workspace called 'Project Ideas'"
- "Look at my calendar and find meetings with client Offir"

ONLY respond with valid JSON:
{
  "needs_clarification": true/false,
  "plugin_type": "email|calendar|storage|productivity|crm|communication|general",
  "reasoning": "Brief explanation of why clarification is/isn't needed"
}`.trim(),
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

  try {
    const analysis = JSON.parse(clarificationRaw)
    if (analysis.needs_clarification) {
      let questions = [
        {
          id: 'service_selection',
          question: 'Which connected service should I use?',
          type: 'select',
          required: true,
          options: connectedPlugins.length > 0 ? connectedPlugins : ['No services connected'],
          placeholder: 'Select service',
        },
        {
          id: 'action_description',
          question: 'Please describe what you want this agent to do',
          type: 'textarea',
          required: true,
          placeholder: 'Enter your request in detail',
        },
      ]

      // Remove any questions referring to account identifiers if plugin is connected
      const forbiddenPatterns = ['email', 'account', 'workspace', 'username']
      questions = questions.filter((q) =>
        !forbiddenPatterns.some((pattern) => q.id.toLowerCase().includes(pattern))
      )

      return NextResponse.json({
        questions,
        connected_plugins: connectedPlugins,
        plugin_type: analysis.plugin_type,
        reasoning: analysis.reasoning,
      })
    }
  } catch (e) {
    const fallbackQuestions = [
      {
        id: 'service_selection',
        question: 'Which connected service should I use?',
        type: 'select',
        required: true,
        options: connectedPlugins.length > 0 ? connectedPlugins : ['No services connected'],
        placeholder: 'Select service',
      },
      {
        id: 'action_description',
        question: 'Please describe what you want this agent to do',
        type: 'textarea',
        required: true,
        placeholder: 'Enter your request in detail',
      },
    ]
    return NextResponse.json({
      questions: fallbackQuestions,
      connected_plugins: connectedPlugins,
      plugin_type: 'general',
      error: 'Failed to parse AI response, using fallback questions',
    })
  }

  const completion = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [
      {
        role: 'system',
        content: `You are an AI assistant that creates agent specs for an automation platform.

🚫 ABSOLUTE PROHIBITION LIST - NEVER CREATE THESE FIELDS:
- emailAccount, userEmail, gmailAccount, email, account
- workspaceId, workspace, notionWorkspace, workspaceName
- username, userId, accountId, serviceAccount
- whichAccount, selectAccount, accountSelection
- calendarAccount, googleAccount, outlookAccount
- Any field asking which service/account/email/workspace to use

✅ ONLY CREATE FUNCTIONAL PARAMETERS:
- numberOfEmails, emailLabel, startDate, endDate, searchQuery
- timeRange, eventType, meetingDuration, participants
- pageTitle, databaseName, contentType, fileName
- quantity, category, priority, status, tags

AUTHENTICATION RULE: All plugins are pre-connected to the user's account automatically. Never ask which account to use.

For Gmail agents, ONLY use these field names:
- numberOfEmails (number)
- emailLabel (enum: ["Inbox", "Sent", "Drafts", "Spam"])
- startDate (date)
- endDate (date)
- searchQuery (string)

For Calendar agents, ONLY use these field names:
- timeRange (string)
- eventType (string)  
- numberOfEvents (number)
- startDate (date)
- endDate (date)

For Notion agents, ONLY use these field names:
- pageTitle (string)
- databaseName (string)
- contentType (string)
- numberOfPages (number)

Return JSON with:
- agent_name: Short descriptive name
- user_prompt: Clear instruction for what the agent does  
- system_prompt: Detailed system instructions for the agent
- description: User-friendly description of the agent's purpose
- input_schema: Array of input fields with {name, type, required, enum?, placeholder?}

VALIDATION: Before returning, check that NO field names contain: account, email, workspace, username, userId, service, which`.trim(),
      },
      {
        role: 'user',
        content: `Create an agent for: "${prompt}"

Connected plugins: ${connectedPlugins.join(', ') || 'None'}

🚫 CRITICAL: Do NOT create any fields asking about accounts, emails, workspaces, or usernames. Plugins are pre-authenticated.

✅ ONLY create fields for functional parameters like quantities, dates, labels, search terms, etc.`,
      },
    ],
    temperature: 0.2,
  })

  const raw = completion.choices[0]?.message?.content || ''
  let extracted
  try {
    extracted = JSON.parse(raw)
    
    // Enhanced filtering with more comprehensive patterns
    const forbiddenPatterns = [
      // Direct matches
      'emailaccount', 'email', 'account', 'username', 'userid',
      'workspaceid', 'workspace', 'service', 'which', 'select',
      // Gmail specific
      'gmailaccount', 'gmailusername', 'gmailservice', 'googleaccount',
      // Workspace specific  
      'notionworkspace', 'workspacename', 'workspaceurl',
      // Calendar specific
      'calendaraccount', 'calendarservice', 'outlookaccount',
      // Generic account terms
      'useraccount', 'serviceaccount', 'accountid', 'accountname',
      'whichaccount', 'selectaccount', 'chooseaccount', 'pickaccount',
      // Service selection
      'whichservice', 'selectservice', 'chooseservice', 'serviceselection'
    ]

    // First filter by field name
    extracted.input_schema = (extracted.input_schema || []).filter((field) => {
      const name = field?.name?.toLowerCase?.().replace(/[^a-z]/g, '') || ''
      const isNameBlocked = forbiddenPatterns.some((pattern) => name.includes(pattern))
      
      if (isNameBlocked) {
        console.log(`🚫 Filtered out forbidden field name: ${field.name}`)
        return false
      }
      
      return true
    })

    // Second filter by placeholder text
    extracted.input_schema = extracted.input_schema.filter((field) => {
      const placeholder = (field.placeholder || '').toLowerCase()
      const question = (field.question || '').toLowerCase()
      const combinedText = `${placeholder} ${question}`
      
      const hasAccountReference = forbiddenPatterns.some(pattern => 
        combinedText.includes(pattern.replace(/([a-z])([a-z])/g, '$1 $2'))
      ) || 
      combinedText.includes('which account') ||
      combinedText.includes('select account') ||
      combinedText.includes('email address') ||
      combinedText.includes('workspace') ||
      combinedText.includes('which service') ||
      combinedText.includes('user email') ||
      combinedText.includes('account to use')
      
      if (hasAccountReference) {
        console.log(`🚫 Filtered out field with account reference in text: ${field.name} - "${placeholder}"`)
        return false
      }
      
      return true
    })

    // Third filter - remove any remaining fields that smell like account selection
    extracted.input_schema = extracted.input_schema.filter((field) => {
      // Check if it's an enum asking to select between accounts/services
      if (field.enum && Array.isArray(field.enum)) {
        const enumOptions = field.enum.join(' ').toLowerCase()
        if (enumOptions.includes('gmail') && enumOptions.includes('outlook') ||
            enumOptions.includes('google') && enumOptions.includes('microsoft') ||
            connectedPlugins.some(plugin => enumOptions.includes(plugin.toLowerCase()))) {
          console.log(`🚫 Filtered out service selection enum: ${field.name}`)
          return false
        }
      }
      
      return true
    })

    console.log(`✅ Final input_schema after filtering:`, extracted.input_schema.map(f => f.name))

  } catch (e) {
    return NextResponse.json({ error: 'Failed to parse AI response.', raw }, { status: 500 })
  }

  const detectedPlugins = detectPluginsFromPrompt(prompt)
  .filter((p) => connectedPlugins.includes(p)) // Only include plugins that are actually connected

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