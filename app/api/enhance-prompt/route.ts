import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Simple token tracking function - matches your actual schema
async function trackTokenUsage(supabase: any, userId: string, tokenData: any) {
  try {
    const { error } = await supabase
      .from('token_usage')
      .insert({
        user_id: userId,
        model_name: tokenData.modelName,
        provider: tokenData.provider,
        input_tokens: tokenData.inputTokens,
        output_tokens: tokenData.outputTokens,
        cost_usd: 0.0, // You can calculate cost based on model pricing
        request_type: tokenData.requestType || 'chat',
        session_id: null, // Add session tracking if needed
        category: tokenData.category || 'prompt_enhancement',
        metadata: tokenData.metadata || {}
      })
    
    if (error) {
      console.error('Token tracking error:', error)
      throw error
    }
  } catch (error) {
    console.error('Failed to track token usage:', error)
    // Don't throw - let the main request continue
  }
}

// Function to get connected plugins (same as analyze-prompt-clarity)
async function getConnectedPlugins(userId: string, connected_plugins?: any): Promise<string[]> {
  let pluginKeys: string[] = []

  // Method 1: From frontend (fallback to ensure we have plugins)
  if (connected_plugins && typeof connected_plugins === 'object') {
    pluginKeys = Object.keys(connected_plugins)
  }

  // Method 2: From database (if user_id provided and table exists)
  if (userId && userId !== 'anonymous') {
    try {
      const { data: connections, error: pluginError } = await supabase
        .from('plugin_connections')
        .select('plugin_key')
        .eq('user_id', userId)
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
    console.log('⚠️ No connected plugins found for user. Using minimal defaults.');
    pluginKeys = ['email', 'storage'] // Minimal generic defaults
  }

  console.log('Final plugin list for enhancement:', pluginKeys)
  return pluginKeys
}

export async function POST(req: NextRequest) {
  try {
    const { prompt, userId, clarificationAnswers = {}, connected_plugins } = await req.json()

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
    console.log('📋 Clarification answers:', Object.keys(clarificationAnswers).length, 'items')

    // Get connected plugins for context-aware enhancement
    const connectedPlugins = await getConnectedPlugins(userIdToUse, connected_plugins)

    // Generate completely dynamic plugin context
    const pluginContext = connectedPlugins.length > 0 
      ? `

CONNECTED SERVICES: User has these services available: ${connectedPlugins.join(', ')}
- Use SPECIFIC service names ONLY when they're relevant to the user's request
- Don't force all connected services into the workflow just because they're available
- Only mention services that are actually needed for the task
- Use service names naturally where they fit the user's actual needs`
      : `

NO CONNECTED SERVICES: User has no specific services connected
- Use friendly generic terms like "email system", "storage folder", "messaging app"
- Don't assume any specific service names`

    // Build clarification context if answers are provided
    let clarificationContext = ''
    if (Object.keys(clarificationAnswers).length > 0) {
      clarificationContext = `

Based on the user's clarification answers, incorporate these specific requirements:
${Object.entries(clarificationAnswers)
  .map(([key, value]) => `- ${key}: ${value}`)
  .join('\n')}

Use these answers to make the prompt more specific and actionable, filling in details that were previously vague or missing.`
    }

    const enhancementPrompt = `You are an expert at writing clear, user-friendly instructions for automated workflows that regular people can understand.

Transform this user request: "${prompt}"${clarificationContext}${pluginContext}

Your goal: Create an enhanced version that's SPECIFIC but CONCISE. Focus on clarity for smart build processing.

Enhancement Requirements:
1. **What Data**: Be specific about what information to use
2. **What Actions**: Clearly describe core steps
3. **When to Run**: Specify timing (use user's clarification or simple placeholders)
4. **What to Create**: Describe the output
5. **Where to Send**: Be specific about delivery using relevant services only
6. **If Problems**: Brief error handling

CRITICAL WRITING RULES:
${Object.keys(clarificationAnswers).length > 0 
  ? `- Use ONLY the specific details provided by the user
- If user said "daily" but no time specified, write "daily at a time you choose"
- NEVER add specific times like "8:00 AM" unless user provided it
- Keep all user-provided details exactly as they specified`
  : `- Use simple, friendly language
- Use relevant service names when connected (only if needed for the task)
- Avoid any technical jargon or system terminology`
}

LANGUAGE STYLE REQUIREMENTS:
- Write like you're explaining to a friend, not a computer
- Use "you" and "your" throughout 
- Avoid ALL technical jargon
- Use simple action words: "check", "read", "create", "send", "save"
- Keep sentences short and clear
- Focus on ESSENTIAL steps only

STRUCTURE YOUR RESPONSE:
1. What it will check/read (use specific service names only if relevant)
2. What it will do with that information  
3. What it will create
4. How/where it will deliver results (only relevant services)
5. Brief error handling

Keep the enhanced version conversational but CONCISE (100-150 words). Focus on essential information for smart build processing.

Respond with only a JSON object:
{
  "enhanced_prompt": "Your user-friendly enhanced version that anyone can understand",
  "rationale": "Brief explanation of what you made clearer and more specific"
}`

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `You are an expert prompt engineer who specializes in making automation instructions clear and user-friendly for regular people. You write in simple, conversational language that anyone can understand, completely avoiding technical jargon. You excel at taking vague automation requests and making them specific and actionable while keeping the language friendly and approachable. You naturally incorporate available services to make instructions more specific. ${Object.keys(clarificationAnswers).length > 0 
              ? 'You are excellent at incorporating user-provided clarification answers to create specific, actionable prompts using only the details the user actually provided.'
              : 'You avoid making assumptions about specific parameters and use friendly placeholder language instead.'
            }`
          },
          {
            role: 'user', 
            content: enhancementPrompt
          }
        ],
        max_tokens: 400,
        temperature: 0.1,
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

    let fullResponse = data.choices[0].message.content.trim()
    console.log('🤖 Raw OpenAI response:', fullResponse)
    
    // Parse the JSON response with better error handling
    let enhancedPrompt = ''
    let rationale = ''
    
    try {
      // Remove any markdown code blocks if present
      if (fullResponse.startsWith('```')) {
        // Find the start and end of the JSON block
        const startIndex = fullResponse.indexOf('{')
        const endIndex = fullResponse.lastIndexOf('}') + 1
        
        if (startIndex !== -1 && endIndex > startIndex) {
          fullResponse = fullResponse.substring(startIndex, endIndex)
        } else {
          throw new Error('Could not extract JSON from markdown block')
        }
      }
      
      console.log('🔍 Cleaned response for parsing:', fullResponse)
      
      const parsedResponse = JSON.parse(fullResponse)
      enhancedPrompt = parsedResponse.enhanced_prompt || parsedResponse.enhancedPrompt || ''
      rationale = parsedResponse.rationale || ''
      
      console.log('✅ Successfully parsed:', {
        enhancedPromptLength: enhancedPrompt.length,
        rationaleLength: rationale.length
      })
      
    } catch (parseError) {
      console.warn('❌ Failed to parse JSON response:', parseError)
      console.warn('📄 Full response was:', fullResponse)
      
      // Advanced fallback: try to extract JSON from mixed content
      try {
        // Look for JSON pattern in the text
        const jsonMatch = fullResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const extractedJson = jsonMatch[0];
          console.log('🔄 Attempting to parse extracted JSON:', extractedJson);
          
          const parsedResponse = JSON.parse(extractedJson);
          enhancedPrompt = parsedResponse.enhanced_prompt || parsedResponse.enhancedPrompt || '';
          rationale = parsedResponse.rationale || '';
          
          console.log('✅ Successfully parsed extracted JSON');
        } else {
          throw new Error('No JSON pattern found in response');
        }
      } catch (secondParseError) {
        console.error('❌ All parsing attempts failed:', secondParseError);
        
        // Final fallback: treat entire response as enhanced prompt
        enhancedPrompt = fullResponse.replace(/```json|```/g, '').trim();
        rationale = 'Enhanced prompt with improved clarity and user-friendly language.';
        
        console.log('⚠️ Using fallback - treating entire response as enhanced prompt');
      }
    }
    
    // Validate that we have a meaningful enhanced prompt
    if (!enhancedPrompt || enhancedPrompt.length < 10) {
      console.error('❌ Enhanced prompt is too short or empty:', enhancedPrompt);
      return NextResponse.json({ 
        error: 'Failed to generate a valid enhanced prompt' 
      }, { status: 500 });
    }
    
    // Extract usage data from OpenAI response
    const inputTokens = data.usage?.prompt_tokens || 0
    const outputTokens = data.usage?.completion_tokens || 0

    console.log('📊 Token usage:', {
      input: inputTokens,
      output: outputTokens,
      total: inputTokens + outputTokens
    })

    // Track usage in database using the simplified tracking system
    if (userIdToUse !== 'anonymous') {
      console.log('💾 Tracking usage for user:', userIdToUse)
      
      try {
        await trackTokenUsage(supabase, userIdToUse, {
          modelName: 'gpt-4o',
          provider: 'openai',
          inputTokens: inputTokens,
          outputTokens: outputTokens,
          requestType: 'chat',
          category: 'context_aware_prompt_enhancement',
          metadata: {
            originalPromptLength: prompt.length,
            enhancedPromptLength: enhancedPrompt.length,
            clarificationAnswersCount: Object.keys(clarificationAnswers).length,
            clarificationAnswers: clarificationAnswers,
            connectedPlugins: connectedPlugins,
            enhancementType: Object.keys(clarificationAnswers).length > 0 ? 'with_clarification' : 'basic',
            isUserFriendly: true,
            isContextAware: true,
            timestamp: new Date().toISOString()
          }
        })
        console.log('✅ Usage tracking successful')
      } catch (trackingError) {
        console.warn('⚠️ Usage tracking failed, but continuing with response:', trackingError)
      }
    } else {
      console.log('⚠️ Skipping usage tracking - anonymous user')
    }

    // Return clean, parsed response
    console.log('🎉 Returning context-aware enhanced prompt:', {
      enhancedPromptPreview: enhancedPrompt.substring(0, 100) + '...',
      rationalePreview: rationale.substring(0, 50) + '...',
      connectedPlugins: connectedPlugins
    })

    return NextResponse.json({ 
      enhancedPrompt,     // camelCase for frontend consistency
      rationale,          // Available for backend storage/tracking (not shown in UI)
      originalPrompt: prompt,
      clarificationAnswersUsed: Object.keys(clarificationAnswers).length > 0,
      metadata: {
        enhancementType: Object.keys(clarificationAnswers).length > 0 ? 'with_clarification' : 'basic',
        clarificationAnswersCount: Object.keys(clarificationAnswers).length,
        connectedPlugins: connectedPlugins,
        isUserFriendly: true,
        isContextAware: true
      }
    })
  } catch (error) {
    console.error('❌ Enhancement error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}