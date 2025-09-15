// app/api/generate-agent/route.ts
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import OpenAI from 'openai'
import { detectPluginsFromPrompt } from '@/lib/plugins/detectPluginsFromPrompt'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

export async function POST(req: Request) {
  try {
    const { prompt, clarificationAnswers } = await req.json()
    console.log('🚀 Agent generation API called with:', { 
      prompt: prompt?.slice(0, 100) + '...',
      answersCount: Object.keys(clarificationAnswers || {}).length 
    })

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

    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      console.log('❌ Authentication error:', authError)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get connected plugins
    const { data: pluginRows } = await supabase
      .from('plugin_connections')
      .select('plugin_key')
      .eq('user_id', user.id)

    const connectedPlugins = pluginRows?.map((p) => p.plugin_key) || []
    console.log('🔌 Connected plugins:', connectedPlugins)

    // Build enhanced prompt with clarification answers
    let fullPrompt = prompt
    if (clarificationAnswers && Object.keys(clarificationAnswers).length > 0) {
      fullPrompt += '\n\nAdditional details:\n' + 
        Object.entries(clarificationAnswers)
          .map(([key, value]) => `${key}: ${value}`)
          .join('\n')
    }

    console.log('📝 Full prompt for agent generation:', fullPrompt)

    // Enhanced system prompt for better agent generation
    const enhancedSystemPrompt = `You are an AI assistant that creates comprehensive agent specifications from user prompts.

You MUST respond with valid JSON only. No markdown, no explanations, just pure JSON.

COMPREHENSIVE ANALYSIS APPROACH:

1. IDENTIFY ALL USER INPUTS: Scan for any values that users would need to customize:
   - Email addresses (senders, recipients, contacts)
   - Times and schedules ("daily at X time", "every X hours", "at a time you choose")
   - File paths, folder names, drive locations
   - Database/workspace IDs (Notion pages, Slack channels, etc.)
   - Search terms, keywords, filters
   - Threshold values, limits, quantities
   - URLs, API endpoints, service names
   - Names of people, companies, projects
   - Any "specific" or customizable references

2. DETERMINE INPUT TYPES: For each identified input, determine the most appropriate type:
   - "email" for email addresses
   - "time" for time selections
   - "date" for date selections  
   - "string" for text inputs (names, IDs, paths)
   - "number" for quantities, limits, thresholds
   - "select" with enum for predefined choices
   - "boolean" for yes/no options
   - "file" for file uploads

3. EXTRACT SCHEDULING REQUIREMENTS: Look for any temporal patterns and ALWAYS consider timing boundaries:
   - Frequency indicators (daily, hourly, weekly, monthly)
   - Time specifications (morning, evening, specific times)
   - Conditional timing (when X happens, after Y occurs) 
   - User choice indicators ("at a time you choose", "when convenient")
   - CRITICAL: For recurring schedules like "every hour/daily", ALWAYS include time boundary inputs:
     * "every hour" = needs start_time and end_time inputs (business hours vs 24/7)
     * "daily" = needs specific time input
     * "weekly" = needs day and time inputs
     * Consider user's likely intent (most users want business hours, not 3AM notifications)

4. IDENTIFY INTEGRATION POINTS: Find all external services mentioned:
   - Email services (Gmail, Outlook)
   - Storage services (Google Drive, Dropbox, OneDrive)
   - Communication tools (Slack, Teams, Discord)
   - Productivity tools (Notion, Trello, Asana)
   - Any API or service integrations

5. WORKFLOW DECOMPOSITION: Break down the task into logical steps:
   - Data collection/input steps
   - Processing/transformation steps
   - Output/delivery steps
   - Error handling steps

Available plugins: ${connectedPlugins.join(', ') || 'None'}

Required JSON structure:
{
  "agent_name": "string - descriptive name reflecting the agent's purpose",
  "user_prompt": "string - cleaned and enhanced version of user request", 
  "system_prompt": "string - detailed instructions for the agent including workflow steps, error handling, and output requirements",
  "description": "string - clear summary of what the agent does and its value",
  "schedule": "string - cron expression or schedule description if applicable",
  "input_schema": [
    {
      "name": "string - descriptive field name",
      "type": "string|number|boolean|date|time|email|file|select",
      "required": true|false,
      "placeholder": "string - helpful example or instruction",
      "description": "string - what this input is for and how it's used",
      "enum": ["option1", "option2"] // for select type only
    }
  ],
  "workflow_steps": [
    {
      "step": "number",
      "action": "string - what happens in this step",
      "plugin": "string - plugin needed for this step (if applicable)",
      "error_handling": "string - what to do if this step fails"
    }
  ],
  "error_notifications": {
    "enabled": true|false,
    "method": "email|slack|both",
    "description": "string - how errors are reported"
  },
  "output_format": "string - description of expected outputs"
}

CRITICAL: Extract EVERY customizable parameter mentioned in the prompt. If the user says "specific sender", create an input for sender email. If they say "at a time you choose", create a time input. If they mention Google Drive, create folder path inputs. 

SCHEDULING INTELLIGENCE: For any recurring schedule (hourly, daily, weekly):
- "every hour" REQUIRES start_time and end_time inputs (default: business hours 9-17)
- "daily" REQUIRES execution_time input 
- "weekly" REQUIRES day_of_week and execution_time inputs
- Always consider practical boundaries - users rarely want 24/7 notifications

EXAMPLES:
- "Every hour" → needs start_time (09:00), end_time (17:00), days_active (weekdays)
- "Daily at 9am" → needs execution_time (09:00), days_active (optional)
- "Check emails hourly" → needs active_hours_start, active_hours_end

Miss nothing - be comprehensive and practical.

Respond with valid JSON only.`

    // Generate agent using OpenAI with enhanced prompting
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: enhancedSystemPrompt
        },
        {
          role: 'user',
          content: `Analyze this user request and create a comprehensive agent specification:

"${fullPrompt}"

Pay special attention to:
- Any time-based triggers or scheduling requirements (if "every hour", include start/end time inputs)
- Multi-step workflows and data transformations
- Integration points with external services
- Error handling and notification requirements
- Input parameters the user might want to customize
- Practical scheduling boundaries (business hours vs 24/7)

SCHEDULING RULES:
- "every hour" = add start_time, end_time, and optionally days_active inputs
- "daily" = add execution_time input
- "weekly" = add day_of_week and execution_time inputs
- Always consider user's practical needs (avoid 3AM notifications unless specified)

Return only valid JSON with no additional text or formatting.`
        },
      ],
      temperature: 0.1,
      max_tokens: 2000,
    })

    const raw = completion.choices[0]?.message?.content || ''
    console.log('🤖 Raw OpenAI response:', raw)

    let extracted
    try {
      // Try to extract JSON from markdown code blocks if present
      const jsonMatch = raw.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/)
      const jsonString = jsonMatch ? jsonMatch[1] : raw.trim()
      
      console.log('📝 Attempting to parse JSON:', jsonString)
      extracted = JSON.parse(jsonString)
      console.log('✅ Successfully parsed:', extracted)
      
    } catch (e) {
      console.error('❌ JSON parsing failed:', e)
      console.error('❌ Raw content that failed to parse:', raw)
      
      // Attempt to clean and retry parsing
      try {
        const cleaned = raw
          .replace(/```json\n?/g, '')
          .replace(/```\n?/g, '')
          .replace(/^\s*[\r\n]/gm, '')
          .trim()
        
        extracted = JSON.parse(cleaned)
        console.log('✅ Parsing succeeded after cleaning')
      } catch (e2) {
        return NextResponse.json({ 
          error: 'Failed to parse AI response',
          details: e instanceof Error ? e.message : 'Unknown parsing error',
          raw_response: raw.slice(0, 500)
        }, { status: 500 })
      }
    }

    // Validate extracted data has required fields
    if (!extracted.agent_name || !extracted.user_prompt) {
      console.error('❌ Missing required fields in extracted data:', extracted)
      return NextResponse.json({ 
        error: 'AI response missing required fields',
        extracted
      }, { status: 500 })
    }

    // Enhanced plugin detection - combine prompt analysis with workflow steps
    let detectedPlugins = detectPluginsFromPrompt(fullPrompt)
    
    // Also detect plugins from workflow steps if present
    if (extracted.workflow_steps && Array.isArray(extracted.workflow_steps)) {
      const workflowPlugins = extracted.workflow_steps
        .map(step => step.plugin)
        .filter(plugin => plugin && connectedPlugins.includes(plugin))
      
      detectedPlugins = [...new Set([...detectedPlugins, ...workflowPlugins])]
    }
    
    // Filter to only connected plugins
    detectedPlugins = detectedPlugins.filter((p) => connectedPlugins.includes(p))

    console.log('🔍 Detected plugins:', detectedPlugins)

    // ENHANCED: Generate intelligent output schema
    const { enhanceOutputInference } = await import('@/lib/outputInference')
    const outputInference = enhanceOutputInference(
      fullPrompt,
      clarificationAnswers || {},
      connectedPlugins
    )
    
    console.log('🎯 Output inference results:', {
      outputCount: outputInference.outputs.length,
      confidence: outputInference.confidence,
      reasoning: outputInference.reasoning
    })

    // Prepare agent data using standard fields
    const agentData = {
      user_id: user.id,
      agent_name: extracted.agent_name || 'Untitled Agent',
      user_prompt: extracted.user_prompt,
      system_prompt: extracted.system_prompt || 'You are a helpful assistant.',
      description: extracted.description || '',
      plugins_required: detectedPlugins,
      input_schema: extracted.input_schema || [],
      output_schema: outputInference.outputs, // ENHANCED: Use intelligent output schema
      status: 'draft'
    }

    // Save agent to database
    const { data: newAgent, error } = await supabase
      .from('agents')
      .insert(agentData)
      .select()
      .single()

    if (error) {
      console.error('❌ Database error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    console.log('✅ Agent created successfully:', newAgent.id)
    
    // Log the enhanced extraction for debugging
    console.log('📊 Enhanced extraction captured:', {
      hasSchedule: !!extracted.schedule,
      schedule: extracted.schedule,
      workflowSteps: extracted.workflow_steps?.length || 0,
      errorHandling: extracted.error_notifications?.enabled || false,
      outputFormat: extracted.output_format || null
    })
    
    return NextResponse.json({ 
      agent: newAgent,
      // Return the enhanced data for frontend processing (not stored in DB)
      extraction_details: {
        detected_plugins: detectedPlugins,
        has_schedule: !!extracted.schedule,
        schedule: extracted.schedule,
        workflow_step_count: extracted.workflow_steps?.length || 0,
        workflow_steps: extracted.workflow_steps || [],
        error_handling_enabled: extracted.error_notifications?.enabled || false,
        error_notifications: extracted.error_notifications || null,
        output_format: extracted.output_format || null,
        // ENHANCED: Include output inference results
        output_inference: {
          outputs: outputInference.outputs,
          reasoning: outputInference.reasoning,
          confidence: outputInference.confidence,
          human_facing_count: outputInference.outputs.filter(o => o.category === 'human-facing').length,
          machine_facing_count: outputInference.outputs.filter(o => o.category === 'machine-facing').length
        }
      }
    })

  } catch (error) {
    console.error('❌ Unexpected error in agent generation:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 })
  }
}