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
    const { prompt, userId, clarificationAnswers = {}, connected_plugins, missingPlugins = [], pluginWarning } = await req.json()
    
    // Extract missing plugins from pluginWarning if not provided directly (backward compatibility)
    const finalMissingPlugins = missingPlugins.length > 0 ? missingPlugins : (pluginWarning?.missingServices || [])

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
    console.log('🔌 Missing plugins:', finalMissingPlugins)

    // Get connected plugins for context-aware enhancement
    const connectedPlugins = await getConnectedPlugins(userIdToUse, connected_plugins)

    // FIXED: Intelligent plugin context that handles missing services
    const pluginContext = connectedPlugins.length > 0 
      ? `

CONNECTED SERVICES: User has these services available: ${connectedPlugins.join(', ')}
${finalMissingPlugins.length > 0 ? `MISSING SERVICES: User mentioned these unavailable services: ${finalMissingPlugins.join(', ')}` : ''}

CRITICAL INSTRUCTIONS FOR SERVICE HANDLING:
- Use SPECIFIC service names ONLY when they're relevant AND available to the user
- For unavailable services that the user mentioned, suggest appropriate alternatives from connected services
- If user mentioned unavailable services, use phrases like "available storage service" or "alternative note-taking app"
- DO NOT use the specific names of unavailable services in your enhanced prompt
- Example: If user wants "Notion" but it's unavailable, suggest "note-taking service" or use available alternatives like "Google Drive"
- Only mention services that are actually needed for the task
- Don't force all connected services into the workflow just because they're available`
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

    const enhancementPrompt = `You are an expert at creating clear, structured execution plans for automated workflows that both users and build systems can easily understand.

Transform this user request: "${prompt}"${clarificationContext}${pluginContext}

Your goal: Create a structured EXECUTION PLAN with clear bullet points. This makes it easy for users to understand and for smart build systems to process.

REQUIRED EXECUTION PLAN FORMAT:
Create a bullet-point execution plan with these sections:

**Data Source:**
• What specific information to monitor/read

**Trigger Conditions:**
• When the automation should activate

**Processing Steps:**
• What actions to take with the data

**Output Creation:**
• What gets generated/created

**Delivery Method:**
• How and where to send results

**Error Handling:**
• What to do if something fails

CRITICAL WRITING RULES:
${Object.keys(clarificationAnswers).length > 0 
  ? `- Use ONLY the specific details provided by the user
- If user said "daily" but no time specified, write "daily at a time you choose"
- NEVER add specific times like "8:00 AM" unless user provided it
- Keep all user-provided details exactly as they specified`
  : `- Use simple, friendly language
- Use available service names when connected and relevant
- For unavailable services, use appropriate generic alternatives
- Avoid any technical jargon or system terminology`
}

LANGUAGE STYLE REQUIREMENTS:
- Write like you're explaining to a friend, not a computer
- Use "you" and "your" throughout 
- Use simple action words: "check", "read", "create", "send", "save"
- Keep bullet points concise but complete
- Each bullet point should be one clear action or condition

EXAMPLE FORMAT:
**Data Source:**
• Monitor your Gmail inbox for new emails from clients

**Trigger Conditions:**
• When a new email arrives with "urgent" in the subject line

**Processing Steps:**
• Read the email content and extract key information
• Create a summary of the urgent request

**Output Creation:**
• Generate a brief summary with sender, subject, and main points

**Delivery Method:**
• Send summary via Slack to your team channel
• Save details to your project management tool

**Error Handling:**
• If email can't be read, log the issue and try again in 5 minutes
• If Slack is down, send summary via email instead

IMPORTANT: Your response must be valid JSON. Do not include any markdown formatting or extra text outside the JSON.

Respond with only a JSON object:
{
  "enhanced_prompt": "Your structured execution plan in bullet-point format using the exact format shown above",
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
            content: `You are an expert prompt engineer who specializes in creating structured, user-friendly automation execution plans. You write in simple, conversational language that anyone can understand, completely avoiding technical jargon. You excel at taking vague automation requests and making them specific and actionable while keeping the language friendly and approachable. You naturally incorporate available services to make instructions more specific, and when services aren't available, you suggest appropriate alternatives rather than using unavailable service names. You always respond with valid JSON only - no markdown, no extra text, just clean JSON. ${Object.keys(clarificationAnswers).length > 0 
              ? 'You are excellent at incorporating user-provided clarification answers to create specific, actionable prompts using only the details the user actually provided.'
              : 'You avoid making assumptions about specific parameters and use friendly placeholder language instead.'
            }`
          },
          {
            role: 'user', 
            content: enhancementPrompt
          }
        ],
        max_tokens: 800,
        temperature: 0.1,
        presence_penalty: 0.1
      })
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error('OpenAI API Error:', {
        status: response.status,
        statusText: response.statusText,
        body: errorText
      });
      return NextResponse.json({ 
        error: `OpenAI API call failed: ${response.status} - ${response.statusText}`,
        details: errorText
      }, { status: response.status })
    }

    const data = await response.json()
    
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      console.error('Invalid OpenAI response structure:', data);
      return NextResponse.json({ 
        error: 'Invalid response from OpenAI',
        details: 'Missing choices or message in response'
      }, { status: 500 })
    }

    let fullResponse = data.choices[0].message.content.trim()
    console.log('🤖 Raw OpenAI response:', fullResponse.slice(0, 200) + '...')
    
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
      
      console.log('🔍 Cleaned response for parsing:', fullResponse.slice(0, 100) + '...')
      
      const parsedResponse = JSON.parse(fullResponse)
      let rawEnhancedPrompt = parsedResponse.enhanced_prompt || parsedResponse.enhancedPrompt || ''
      rationale = parsedResponse.rationale || ''
      
      // CRITICAL FIX: Handle both string and object formats for enhanced_prompt
      if (typeof rawEnhancedPrompt === 'object' && rawEnhancedPrompt !== null) {
        // Convert object format to structured string format
        console.log('🔄 Converting object format to structured string');
        const sections = [];
        
        if (rawEnhancedPrompt['Data Source']) {
          sections.push('**Data Source:**');
          const items = Array.isArray(rawEnhancedPrompt['Data Source']) 
            ? rawEnhancedPrompt['Data Source'] 
            : [rawEnhancedPrompt['Data Source']];
          items.forEach(item => sections.push(`• ${item}`));
          sections.push('');
        }
        
        if (rawEnhancedPrompt['Trigger Conditions']) {
          sections.push('**Trigger Conditions:**');
          const items = Array.isArray(rawEnhancedPrompt['Trigger Conditions']) 
            ? rawEnhancedPrompt['Trigger Conditions'] 
            : [rawEnhancedPrompt['Trigger Conditions']];
          items.forEach(item => sections.push(`• ${item}`));
          sections.push('');
        }
        
        if (rawEnhancedPrompt['Processing Steps']) {
          sections.push('**Processing Steps:**');
          const items = Array.isArray(rawEnhancedPrompt['Processing Steps']) 
            ? rawEnhancedPrompt['Processing Steps'] 
            : [rawEnhancedPrompt['Processing Steps']];
          items.forEach(item => sections.push(`• ${item}`));
          sections.push('');
        }
        
        if (rawEnhancedPrompt['Output Creation']) {
          sections.push('**Output Creation:**');
          const items = Array.isArray(rawEnhancedPrompt['Output Creation']) 
            ? rawEnhancedPrompt['Output Creation'] 
            : [rawEnhancedPrompt['Output Creation']];
          items.forEach(item => sections.push(`• ${item}`));
          sections.push('');
        }
        
        if (rawEnhancedPrompt['Delivery Method']) {
          sections.push('**Delivery Method:**');
          const items = Array.isArray(rawEnhancedPrompt['Delivery Method']) 
            ? rawEnhancedPrompt['Delivery Method'] 
            : [rawEnhancedPrompt['Delivery Method']];
          items.forEach(item => sections.push(`• ${item}`));
          sections.push('');
        }
        
        if (rawEnhancedPrompt['Error Handling']) {
          sections.push('**Error Handling:**');
          const items = Array.isArray(rawEnhancedPrompt['Error Handling']) 
            ? rawEnhancedPrompt['Error Handling'] 
            : [rawEnhancedPrompt['Error Handling']];
          items.forEach(item => sections.push(`• ${item}`));
        }
        
        enhancedPrompt = sections.join('\n');
      } else if (typeof rawEnhancedPrompt === 'string') {
        enhancedPrompt = rawEnhancedPrompt;
      } else {
        throw new Error('Enhanced prompt is neither string nor valid object format');
      }
      
      if (!enhancedPrompt || enhancedPrompt.length < 10) {
        throw new Error('Enhanced prompt is too short or empty');
      }
      
      console.log('✅ Successfully parsed:', {
        enhancedPromptLength: enhancedPrompt.length,
        rationaleLength: rationale.length,
        hasStructuredFormat: enhancedPrompt.includes('**Data Source:**')
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
          console.log('🔄 Attempting to parse extracted JSON:', extractedJson.slice(0, 100) + '...');
          
          const parsedResponse = JSON.parse(extractedJson);
          enhancedPrompt = parsedResponse.enhanced_prompt || parsedResponse.enhancedPrompt || '';
          rationale = parsedResponse.rationale || '';
          
          if (!enhancedPrompt || enhancedPrompt.length < 10) {
            throw new Error('Enhanced prompt from extracted JSON is too short');
          }
          
          console.log('✅ Successfully parsed extracted JSON');
        } else {
          throw new Error('No JSON pattern found in response');
        }
      } catch (secondParseError) {
        console.error('❌ All parsing attempts failed:', secondParseError);
        
        // Final fallback: create a basic structured prompt from the raw response
        if (fullResponse.length > 20) {
          enhancedPrompt = `**Data Source:**
• ${prompt.split('.')[0] || 'Your specified data source'}

**Trigger Conditions:**
• Based on your requirements

**Processing Steps:**
• Process the data according to your needs
• Apply the necessary transformations

**Output Creation:**
• Generate the required output format

**Delivery Method:**
• Send results to your preferred destination

**Error Handling:**
• Log any errors and retry as needed
• Send notifications if critical failures occur`;
          rationale = 'Created structured execution plan from your request.';
          
          console.log('⚠️ Using emergency fallback - created basic structured prompt');
        } else {
          console.error('❌ All fallback attempts failed - response too short');
          return NextResponse.json({ 
            error: 'Failed to generate a valid enhanced prompt',
            details: 'All parsing and fallback attempts failed'
          }, { status: 500 });
        }
      }
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
            missingPlugins: finalMissingPlugins,
            enhancementType: Object.keys(clarificationAnswers).length > 0 ? 'with_clarification' : 'basic',
            hadMissingPlugins: finalMissingPlugins.length > 0,
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
      enhancedPromptPreview: typeof enhancedPrompt === 'string' ? enhancedPrompt.substring(0, 100) + '...' : 'Object format converted to string',
      rationalePreview: typeof rationale === 'string' ? rationale.substring(0, 50) + '...' : 'N/A',
      connectedPlugins: connectedPlugins,
      missingPlugins: finalMissingPlugins
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
        missingPlugins: finalMissingPlugins,
        hadMissingPlugins: finalMissingPlugins.length > 0,
        isUserFriendly: true,
        isContextAware: true
      }
    })
  } catch (error) {
    console.error('❌ Enhancement error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}