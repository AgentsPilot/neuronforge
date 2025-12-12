import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { v4 as uuidv4 } from 'uuid'
import { EnhancedPromptRequestPayload } from '@/components/agent-creation/types'

// Import AI Analytics System
import { AIAnalyticsService } from '@/lib/analytics/aiAnalytics'
import { AnthropicProvider, ANTHROPIC_MODELS } from '@/lib/ai/providers/anthropicProvider'

// Import PluginManagerV2 for enhanced plugin management
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2'
import { IPluginContext, PluginDefinitionContext } from '@/lib/types/plugin-definition-context'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Initialize AI Analytics
const aiAnalytics = new AIAnalyticsService(supabase, {
  enableRealtime: true,
  enableCostTracking: true,
  enablePerformanceMetrics: true
})

// Helper function to validate UUID format
// function isValidUUID(str: string): boolean {
//   const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
//   return uuidPattern.test(str)
// }

export async function POST(req: NextRequest) {
  try {
    const { 
      prompt, 
      userId, 
      clarificationAnswers,
      connectedPlugins,
      connectedPluginsData,      
      missingPlugins,
      pluginWarning,
      sessionId: providedSessionId,
      agentId: providedAgentId
    } = await req.json() as EnhancedPromptRequestPayload;
    
    const isDevEnv = process.env.NODE_ENV === 'development';
    // Extract missing plugins from pluginWarning if not provided directly (backward compatibility)
    const finalMissingPlugins = missingPlugins && missingPlugins.length > 0 ? missingPlugins : (pluginWarning?.missingServices || [])

    if (!prompt) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 })
    }

    const extractIdFromRequest = (id: string | undefined, headerName: string, def?: string | ''): string => {
      return id || req.headers.get(headerName) || (def !== undefined ? def : uuidv4());
    }
    // Get user ID from request headers if not in body (fallback method)
    const userIdToUse = extractIdFromRequest(userId,'x-user-id','anonymous');

    // Use provided IDs instead of generating new ones - with proper UUID format
    const sessionId = extractIdFromRequest(providedSessionId,'x-session-id');
    const agentId = extractIdFromRequest(providedAgentId,'x-agent-id');    

    if (isDevEnv) {
      console.log('🚀 Processing enhancement request with CONSISTENT agent ID:', {
        userId: userIdToUse,
        providedSessionId,
        providedAgentId,
        finalSessionId: sessionId,
        finalAgentId: agentId,
        agentIdSource: providedAgentId ? 'request_body' : 
                      req.headers.get('x-agent-id') ? 'header' : 'generated',
        sessionIdSource: providedSessionId ? 'request_body' : 
                        req.headers.get('x-session-id') ? 'header' : 'generated',
        promptLength: prompt.length,
        clarificationAnswersCount: Object.keys(clarificationAnswers).length,
        missingPlugins: finalMissingPlugins      
      });
      console.log('🚀 POST!!! Processing enhancement request with additional params:', {
        prompt: prompt,
        clarificationAnswers: clarificationAnswers,
        connectedPlugins: connectedPlugins,
        connectedPluginsData: connectedPluginsData,
        missingPlugins: missingPlugins,
        pluginWarning: pluginWarning
      });
    }
          
    let connectedPluginKeys: string[] = []; 
    let connectedPluginsMetaData: IPluginContext[] = [];   
    // Get connected plugins with enhanced metadata
    if (connectedPlugins && connectedPlugins.length > 0) {
      connectedPluginKeys = connectedPlugins;
      connectedPluginsMetaData = connectedPluginsData || [];      
    } else {            
      const pluginManager = await PluginManagerV2.getInstance();
      const userConnectedPlugins = await pluginManager.getUserActionablePlugins(userId);
      connectedPluginKeys = Object.keys(userConnectedPlugins);
      connectedPluginsMetaData = pluginManager.getPluginsDefinitionContext(connectedPluginKeys).map(p => p.toShortLLMContext());      
    }     
    
    if (isDevEnv) {
      console.log('Enhanced plugin context:', {
        connectedPlugins,
        pluginDataCount: connectedPluginsMetaData.length,
        pluginCapabilities: connectedPluginsMetaData.map(p => ({ key: p.key, capabilities: p.capabilities.join(', ') }))
      })
    }    

    // Build enhanced plugin context using capabilities
    let pluginContext = ''
    
    if (connectedPluginsMetaData.length > 0) {      
      // Group plugins by category for better context
      const pluginsByCategory = connectedPluginsMetaData.reduce((acc, plugin) => {
        const category = plugin.category;
        if (!acc[category]) acc[category] = []
        acc[category].push(plugin)
        return acc
      }, {} as Record<string, IPluginContext[]>)

      pluginContext = `
        CONNECTED SERVICES WITH CAPABILITIES:
        ${Object.entries(pluginsByCategory)
          .map(([category, plugins]) => 
            `${category.toUpperCase()}: ${plugins.map(p => `${p.displayName} (${p.capabilities.join(', ')})`).join('; ')}`
          ).join('\n')}

        ${finalMissingPlugins.length > 0 ? `MISSING SERVICES: User mentioned these unavailable services: ${finalMissingPlugins.join(', ')}` : ''}

        CRITICAL INSTRUCTIONS FOR SERVICE HANDLING:
        - Use SPECIFIC service names and capabilities ONLY when they're relevant AND available to the user
        - Reference actual capabilities like "read_email", "send_email", "send_message" when relevant
        - For unavailable services that the user mentioned, suggest appropriate alternatives from connected services
        - If user mentioned unavailable services, use phrases like "available ${connectedPluginsMetaData.find(p => p.category === 'storage')?.displayName || 'storage service'}" 
        - DO NOT use the specific names of unavailable services in your enhanced prompt
        - Example: If user wants "Notion" but it's unavailable, suggest using "${connectedPluginsMetaData.find(p => p.category === 'documents')?.displayName || 'available note-taking service'}"
        - Only mention services that are actually needed for the task
        - Don't force all connected services into the workflow just because they're available
        - Consider plugin usage types: input and/or output capabilities
        - Use friendly, non-technical language that anyone can understand`
        //- Consider plugin usage types: ${connectedPluginMetaData.map(p => `${p.label} (${p.usage ? p.usage.join('/') : 'general'})`)}`

    } else {
      
      pluginContext = `
        NO CONNECTED SERVICES: User has no specific services connected
        - Use friendly generic terms like "email system", "storage folder", "messaging app"  
        - Don't assume any specific service names
        - Keep instructions generic but actionable`
    }

    if (isDevEnv) {
      console.log('🤖 enhanced-prompt: pluginContext constructed:', pluginContext);
    }

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

    if (isDevEnv) {
      console.log('🤖 enhanced-prompt: clarificationContext constructed:', clarificationContext);
    }

    const enhancementPrompt = `You are an expert at creating clear, structured execution plans for automated workflows that both users and build systems can easily understand.

    Transform this user request: "${prompt}"${clarificationContext}${pluginContext}

    Your goal: Create a structured EXECUTION PLAN with clear bullet points. This makes it easy for users to understand and for smart build systems to process.

    REQUIRED EXECUTION PLAN FORMAT:
    Create a bullet-point execution plan with these sections:

    **Data Source:**
    • What specific information to monitor/read
    ${connectedPluginsMetaData.some(p => p.capabilities.includes('read_email')) ? '• Use email reading capabilities when the user wants to read emails' : ''}

    **Processing Steps:**
    • What actions to take with the data
    • Focus ONLY on the user's stated requirements

    **Output Creation:**
    • What gets generated/created (ONLY what the user asked for)

    **Delivery Method:**
    • How and where to send results (ONLY what the user specified)
    ${connectedPluginsMetaData.some(p => p.capabilities.includes('send_email') || p.capabilities.includes('send_message')) ? '• Use available messaging/email capabilities for sending results' : ''}

    **Error Handling:**
    • What to do if something fails

    CRITICAL CONSTRAINT - DO NOT ADD FEATURES THE USER DIDN'T REQUEST:
    - If user says "send to my manager", ONLY mention sending to manager - don't suggest additional storage
    - If user says "summarize emails", focus ONLY on summarization and sending - don't add file saving
    - If user wants data sent somewhere, don't suggest also saving it elsewhere
    - Only mention storage/file capabilities if the user explicitly wants to save/store something
    - Don't suggest "backup" storage or "also save to" unless user requested it

    LANGUAGE STYLE REQUIREMENTS:
    - Write like you're explaining to a friend, not a computer
    - Use "you" and "your" throughout 
    - Use simple action words: "check", "read", "create", "send"
    - Keep bullet points concise but complete
    - Each bullet point should be one clear action or condition
    - ONLY mention capabilities that are directly relevant to what the user asked for

    IMPORTANT: Your response must be valid JSON. Do not include any markdown formatting or extra text outside the JSON.

    Respond with only a JSON object:
    {
      "enhanced_prompt": "Your structured execution plan focusing ONLY on what the user requested",
      "rationale": "Brief explanation of what you made clearer and more specific"
    }`

    if (isDevEnv) {
      console.log('🤖 enhanced-prompt: enhancementPrompt constructed:', enhancementPrompt);
    }

    const systemPrompt = `You are an expert prompt engineer who specializes in creating structured, user-friendly automation execution plans. You write in simple, conversational language that anyone can understand, completely avoiding technical jargon. You excel at taking vague automation requests and making them specific and actionable while keeping the language friendly and approachable. You ONLY suggest capabilities and services that are directly relevant to what the user asked for - you never add extra features or suggest additional storage/backup unless explicitly requested. You always respond with valid JSON only - no markdown, no extra text, just clean JSON. ${Object.keys(clarificationAnswers).length > 0 
              ? 'You are excellent at incorporating user-provided clarification answers to create specific, actionable prompts using only the details the user actually provided.'
              : 'You avoid making assumptions about specific parameters and use friendly placeholder language instead.'
            } You focus strictly on the user's stated requirements and avoid suggesting additional features they didn't ask for. NOTE: Do not include any scheduling or trigger conditions as these are handled separately by the system.`;
    
    if (isDevEnv) {
      console.log('🤖 enhanced-prompt: systemPrompt constructed:', systemPrompt);
    }

    // Use AI Analytics Anthropic Provider
    const anthropicProvider = new AnthropicProvider(process.env.ANTHROPIC_API_KEY!, aiAnalytics)

    console.log('📊 Making tracked enhancement AI call with CONSISTENT agent ID (Claude Sonnet 4)')

    const anthropicResponse = await anthropicProvider.chatCompletion(
      {
        model: ANTHROPIC_MODELS.CLAUDE_4_SONNET,
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: enhancementPrompt
          }
        ],
        max_tokens: 2000,
        temperature: 0.1
      },
      {
        userId: userIdToUse,
        sessionId: sessionId,
        feature: 'prompt_enhancement',
        component: 'enhance-prompt-api',
        workflow_step: 'prompt_enhancement',
        category: 'agent_creation',
        activity_type: 'agent_creation',
        activity_name: 'Enhancing prompt with clarification details',
        activity_step: 'prompt_enhancement',
        agent_id: agentId
      }
    )

    if (isDevEnv) {
      console.log('✅ Enhancement AI call completed with CONSISTENT agent ID analytics tracking:', {
        agentId,
        sessionId
      })
    }    

    // Parse the response
    let fullResponse = anthropicResponse.choices[0]?.message?.content?.trim()
    if (!fullResponse) {
      throw new Error('Empty response from Claude')
    }

    //console.log('🤖 Raw Claude response:', fullResponse.slice(0, 200) + '...')
    console.log('🤖 Raw Claude response:', fullResponse)
    
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
      
      if (isDevEnv) {
      console.log('🤖 Cleaned response for parsing:', fullResponse);
      } else {
        console.log('🔍 Cleaned response for parsing:', fullResponse.slice(0, 100) + '...')
      }
            
      const parsedResponse = JSON.parse(fullResponse)
      let rawEnhancedPrompt = parsedResponse.enhanced_prompt || parsedResponse.enhancedPrompt || ''
      rationale = parsedResponse.rationale || ''
      
      // Handle both string and object formats for enhanced_prompt
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
        
        // REMOVED: Trigger Conditions section
        
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
        hasStructuredFormat: enhancedPrompt.includes('**Data Source:**'),
        removedTriggerConditions: !enhancedPrompt.includes('**Trigger Conditions:**')
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
        
        // Final fallback: create a basic structured prompt using available plugin capabilities
        const availableCapabilities = connectedPluginsMetaData.flatMap(p => p.capabilities || []);
        const hasEmailCaps = availableCapabilities.some(c => c.includes('email'));
        const hasMessageCaps = availableCapabilities.some(c => c.includes('message'));
        
        enhancedPrompt = `**Data Source:**
        • ${prompt.split('.')[0] || 'Your specified data source'}${hasEmailCaps ? ' (using email capabilities)' : ''}

        **Processing Steps:**
        • Process the data according to your needs
        • Apply the necessary transformations

        **Output Creation:**
        • Generate the required output format

        **Delivery Method:**
        • Send results to your preferred destination${hasMessageCaps ? ' using messaging capabilities' : ''}

        **Error Handling:**
        • Log any errors and retry as needed
        • Send notifications if critical failures occur${hasMessageCaps ? ' via available messaging' : ''}`;
                
        rationale = `Created structured execution plan from your request using available plugin capabilities: ${availableCapabilities.slice(0, 3).join(', ')}.`;
        
        console.log('⚠️ Using enhanced fallback with plugin capabilities');
      }
    }

    // Return enhanced response with plugin metadata
    console.log('🎉 Returning plugin-aware enhanced prompt with CONSISTENT agent ID tracking:', {
      enhancedPromptPreview: typeof enhancedPrompt === 'string' ? enhancedPrompt.substring(0, 100) + '...' : 'Object format converted to string',
      rationalePreview: typeof rationale === 'string' ? rationale.substring(0, 50) + '...' : 'N/A',
      connectedPlugins: connectedPlugins,
      connectedPluginDataCount: connectedPluginsMetaData.length,
      missingPlugins: finalMissingPlugins,
      sessionId: sessionId,
      agentId: agentId,
      agentIdConsistent: providedAgentId === agentId,
      removedScheduling: true
    })

    return NextResponse.json({
      enhancedPrompt,
      rationale,
      originalPrompt: prompt,
      clarificationAnswersUsed: Object.keys(clarificationAnswers).length > 0,
      connectedPluginData: connectedPluginsMetaData,
      sessionId: sessionId,
      agentId: agentId,
      metadata: {
        enhancementType: Object.keys(clarificationAnswers).length > 0 ? 'with_clarification' : 'basic',
        clarificationAnswersCount: Object.keys(clarificationAnswers).length,
        connectedPlugins: connectedPlugins,
        connectedPluginData: connectedPluginsMetaData.map(p => ({ key: p.key, label: p.displayName, category: p.category, capabilities: p.capabilities})),
        pluginCapabilitiesUsed: connectedPluginsMetaData.flatMap(p => p.capabilities || []),
        missingPlugins: finalMissingPlugins,
        hadMissingPlugins: finalMissingPlugins.length > 0,
        isUserFriendly: true,
        isContextAware: true,
        isPluginAware: true,
        analyticsTracked: true,
        activityTracked: true,
        agentIdConsistent: providedAgentId === agentId,
        removedSchedulingFeatures: true,
        focusOnExecutionOnly: true
      }
    })
  } catch (error) {
    console.error('❌ Enhancement error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}