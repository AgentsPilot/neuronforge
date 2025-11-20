// app/api/onboarding/generate-prompt-ideas/route.ts
// Backend endpoint for generating personalized agent prompt ideas based on user's onboarding context

import { NextRequest, NextResponse } from 'next/server'
import { createAuthenticatedServerClient } from '@/lib/supabaseServer'
import OpenAI from 'openai'
import { AIAnalyticsService } from '@/lib/analytics/aiAnalytics'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

interface PromptIdea {
  title: string
  description: string
  prompt: string
  category: 'analytics' | 'automation' | 'communication' | 'data' | 'scheduling'
  estimatedTokens: number
  complexity: 'simple' | 'moderate' | 'advanced'
}

export async function POST(request: NextRequest) {
  try {
    console.log('[Generate Ideas] Request received');

    const supabase = await createAuthenticatedServerClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    console.log('[Generate Ideas] Auth result:', { user: user?.id, authError: authError?.message });

    if (authError || !user) {
      console.error('[Generate Ideas] Auth error:', authError);
      return NextResponse.json({
        success: false,
        error: 'Unauthorized',
        details: authError?.message || 'No user found'
      }, { status: 401 })
    }

    const { goal, mode, role } = await request.json()

    if (!goal || !mode) {
      return NextResponse.json(
        { error: 'Missing required fields: goal, mode' },
        { status: 400 }
      )
    }

    // Check if ideas already exist for this user
    // Use admin client to bypass RLS
    const { createClient } = await import('@supabase/supabase-js')
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data: existingIdeas, error: fetchError } = await supabaseAdmin
      .from('onboarding_prompt_ideas')
      .select('ideas, tokens_used, cost_usd, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle() // Use maybeSingle to avoid error when no rows

    if (fetchError) {
      console.error('[Generate Ideas] Error fetching existing ideas:', fetchError);
    }

    if (existingIdeas) {
      console.log(`✅ Returning cached prompt ideas for user ${user.id}`)
      return NextResponse.json({
        success: true,
        ideas: existingIdeas.ideas,
        tokensUsed: existingIdeas.tokens_used,
        costUsd: existingIdeas.cost_usd,
        cached: true,
        metadata: {
          cachedAt: existingIdeas.created_at
        }
      })
    }

    console.log(`[Generate Ideas] No cached ideas found for user ${user.id}, generating new ones...`);

    // Generate prompt ideas using GPT-4o-mini for cost efficiency
    const systemPrompt = `You are an AI agent creation assistant for NeuronForge, a platform where users create autonomous AI agents for business automation.

User Context:
- Goal: ${goal}
- Preferred Mode: ${mode} (on-demand = user triggers manually, scheduled = runs automatically on schedule)
- Role: ${role}

Generate 5-7 practical, achievable agent ideas that align with the user's goal. Return ONLY a valid JSON object with this EXACT structure:

{
  "ideas": [
    {
      "title": "Clear, action-oriented title (max 60 chars)",
      "description": "Brief description of what the agent does (max 150 chars)",
      "prompt": "Complete, detailed prompt ready to paste into agent creation. Should be 200-400 characters and include: what data to fetch, what analysis/processing to do, what output to generate, and where to send/store results.",
      "category": "analytics|automation|communication|data|scheduling",
      "estimatedTokens": 3000-8000,
      "complexity": "simple|moderate|advanced"
    }
  ]
}

Guidelines:
- Make prompts specific and actionable (not vague)
- Focus on practical business/productivity use cases
- Vary complexity: mostly simple and moderate, max 1 advanced
- Ensure prompts work well with ${mode} mode
- Consider the user's stated goal when generating ideas
- Include variety across categories (don't repeat similar ideas)
- Each prompt should be self-contained and clear about inputs, processing, and outputs
- Avoid technical jargon - write for business users

Categories:
- analytics: Data analysis, reporting, insights generation
- automation: Workflow automation, task execution
- communication: Email, Slack, notifications, messaging
- data: Data collection, enrichment, transformation
- scheduling: Time-based tasks, recurring operations`

    const startTime = Date.now()

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Generate 5-7 diverse agent ideas for my goal: "${goal}"` }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.8, // Higher creativity for diverse ideas
      max_tokens: 2500
    })

    const executionTimeMs = Date.now() - startTime

    const responseContent = completion.choices[0].message.content || '{}'
    let ideas: PromptIdea[]

    try {
      const parsed = JSON.parse(responseContent)
      ideas = parsed.ideas || parsed.prompts || []

      if (!Array.isArray(ideas) || ideas.length === 0) {
        throw new Error('No ideas generated')
      }
    } catch (parseError) {
      console.error('Failed to parse LLM response:', parseError)
      console.error('Response content:', responseContent)
      return NextResponse.json(
        { error: 'Failed to generate prompt ideas. Please try again.' },
        { status: 500 }
      )
    }

    // Track token usage in ai_analytics
    const aiAnalytics = new AIAnalyticsService(supabaseAdmin)
    const inputTokens = completion.usage?.prompt_tokens || 0
    const outputTokens = completion.usage?.completion_tokens || 0

    // GPT-4o-mini pricing: $0.150 per 1M input tokens, $0.600 per 1M output tokens
    const costUsd = (inputTokens * 0.00015 / 1000) + (outputTokens * 0.0006 / 1000)

    await aiAnalytics.trackAICall({
      call_id: `prompt_ideas_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      user_id: user.id,
      session_id: `onboarding_${user.id}_${Date.now()}`,
      provider: 'openai',
      model_name: 'gpt-4o-mini',
      feature: 'onboarding',
      component: 'generate-prompt-ideas',
      workflow_step: 'idea_generation',
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd: costUsd,
      activity_type: 'onboarding_prompt_ideas',
      activity_name: 'Generate Prompt Ideas',
      activity_step: 'generation',
      metadata: {
        user_goal: goal,
        user_mode: mode,
        user_role: role,
        ideas_generated: ideas.length,
        execution_time_ms: executionTimeMs
      }
    })

    // Store generated ideas in database to prevent regeneration
    // Map 'on_demand' to 'scheduled' due to DB constraint (both are user-triggered modes)
    const dbMode = mode === 'on_demand' ? 'scheduled' : mode

    const { error: storeError } = await supabaseAdmin.from('onboarding_prompt_ideas').insert({
      user_id: user.id,
      user_goal: goal,
      user_mode: dbMode,
      user_role: role,
      ideas: ideas,
      tokens_used: inputTokens + outputTokens,
      cost_usd: costUsd
    })

    if (storeError) {
      console.error('Failed to store prompt ideas:', storeError)
      // Don't fail the request if storage fails
    } else {
      console.log('✅ Stored prompt ideas in database')
    }

    console.log(`✅ Generated ${ideas.length} prompt ideas for user ${user.id} in ${executionTimeMs}ms`)

    return NextResponse.json({
      success: true,
      ideas,
      tokensUsed: inputTokens + outputTokens,
      costUsd,
      metadata: {
        executionTimeMs,
        model: 'gpt-4o-mini'
      }
    })

  } catch (error) {
    console.error('Error generating prompt ideas:', error)
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
