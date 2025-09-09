import { NextRequest, NextResponse } from 'next/server'
import { trackUsage } from '@/lib/utils/usageTracker'

export async function POST(req: NextRequest) {
  try {
    const { prompt, userId } = await req.json()

    if (!prompt) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 })
    }

    // Get user ID from request headers if not in body (fallback method)
    const userIdToUse = userId || req.headers.get('x-user-id') || 'anonymous'

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY

    if (!OPENAI_API_KEY) {
      console.error('OPENAI_API_KEY not found in environment variables')
      return NextResponse.json({ error: 'OpenAI API key not configured' }, { status: 500 })
    }

    console.log('🚀 Processing enhancement request for user:', userIdToUse)
    console.log('📝 Original prompt length:', prompt.length)

    const enhancementPrompt = `You are an expert at writing clear, specific prompts for AI agents and automation workflows.

Your task: Transform the user's basic prompt into a professional, detailed instruction that will work perfectly with downstream automation systems (plugin selection, schema generation, workflow execution).

User's original prompt: "${prompt}"

Enhancement guidelines:
1. Keep the original intent but make it more specific and actionable
2. Add clear input/output specifications and workflow structure
3. Use professional language suitable for business automation
4. Specify the types of data processing and organization needed
5. Keep it concise but comprehensive (aim for 100-200 words)
6. Focus on workflow structure and data processing requirements

CRITICAL: Do NOT add specific parameters, timeframes, or criteria that the user hasn't specified. Leave these as configurable inputs for later steps:
- Don't specify timeframes like "last 7 days" - use "specified timeframe"
- Don't specify file formats or folder names - use "designated folder" 
- Don't specify recipients - use "designated recipient"
- Don't suggest specific plugins or tools - let the system choose later
- Use placeholder language that will be filled in during configuration

Focus on clarifying the workflow structure and data processing requirements without making assumptions about specific tools or parameter values.

Enhanced prompt:`

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are an expert prompt engineer specializing in workflow automation and AI agent instructions. You avoid making assumptions about specific parameters that should be user-configurable.'
          },
          {
            role: 'user', 
            content: enhancementPrompt
          }
        ],
        max_tokens: 300,
        temperature: 0.7,
        presence_penalty: 0.1
      })
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      console.error('OpenAI API Error:', errorData)
      return NextResponse.json({ 
        error: errorData.error?.message || 'OpenAI API call failed' 
      }, { status: response.status })
    }

    const data = await response.json()
    
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      return NextResponse.json({ error: 'Invalid response from OpenAI' }, { status: 500 })
    }

    const enhancedPrompt = data.choices[0].message.content.trim()
    
    // Extract usage data from OpenAI response
    const inputTokens = data.usage?.prompt_tokens || 0
    const outputTokens = data.usage?.completion_tokens || 0
    const totalTokens = data.usage?.total_tokens || 0

    console.log('📊 Token usage:', {
      input: inputTokens,
      output: outputTokens,
      total: totalTokens
    })

    // Track usage in database - only if we have a real user ID
    if (userIdToUse !== 'anonymous') {
      console.log('💾 Tracking usage for user:', userIdToUse)
      
      const trackingSuccess = await trackUsage({
        userId: userIdToUse,
        provider: 'openai',
        modelName: 'gpt-4o-mini',
        inputTokens: inputTokens,
        outputTokens: outputTokens,
        requestType: 'prompt_enhancement',
        metadata: {
          originalPromptLength: prompt.length,
          enhancedPromptLength: enhancedPrompt.length,
          timestamp: new Date().toISOString()
        }
      })
      
      if (trackingSuccess) {
        console.log('✅ Usage tracking successful')
      } else {
        console.warn('⚠️ Usage tracking failed, but continuing with response')
      }
    } else {
      console.log('⚠️ Skipping usage tracking - anonymous user')
    }

    // Return enhanced prompt with usage data for tracking
    return NextResponse.json({ 
      enhancedPrompt,
      usage: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        inputTokens: inputTokens,
        outputTokens: outputTokens,
        totalTokens: totalTokens
      }
    })
  } catch (error) {
    console.error('Enhancement error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}