import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { v4 as uuidv4 } from 'uuid'
import { AIAnalyticsService } from '@/lib/analytics/aiAnalytics'
import { AnthropicProvider, ANTHROPIC_MODELS } from '@/lib/ai/providers/anthropicProvider'
import { PromptRequestPayload, PromptResponsePayload, ClarificationQuestionRequestPayload, ClarificationQuestion } from '@/components/agent-creation/types'

// Import PluginManagerV2 for enhanced plugin management
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2'
import { PluginDefinitionContext } from '@/lib/types/plugin-definition-context'

// Import PromptAnalyzer and PromptLoader for prompt analysis
import { PromptAnalyzer } from '@/app/api/types/PromptAnalyzer'
import { PromptLoader } from '@/app/api/types/PromptLoader'
//const aiPrompt = "generate-clarification-questions.txt";
const aiPrompt = "Clarification-Questions-Agent.txt";

interface ClarificationResponse {
  questions: ClarificationQuestion[]
  reasoning: string
  confidence: number
}

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Initialize AI Analytics
const aiAnalytics = new AIAnalyticsService(supabase)

// Helper function to validate UUID format
// function isValidUUID(str: string): boolean {
//   const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
//   return uuidPattern.test(str)
// }

// UPDATED: Only add error handling question if missing - removed all scheduling
function addStandardQuestionsIfMissing(questions: ClarificationQuestion[], promptAnalyzer: PromptAnalyzer): ClarificationQuestion[] {
  const hasErrorHandling = questions.some(q => 
    q.dimension === 'error_handling' ||
    q.question.toLowerCase().includes('error') ||
    q.question.toLowerCase().includes('problem') ||
    q.question.toLowerCase().includes('fail')
  );

  // Only add if missing and not already specified in user prompt
  const userSpecifiedErrorHandling = promptAnalyzer.hasErrorHandlingInPrompt();  

  // Add simple error handling if missing
  if (!hasErrorHandling && !userSpecifiedErrorHandling) {
    questions.push({
      id: 'error_handling_standard',
      question: 'If something goes wrong, how should I be notified?',
      type: 'select',
      required: true,
      dimension: 'error_handling',
      placeholder: 'Choose notification method',
      options: [
        {
          value: 'email_me',
          label: 'Email me',
          description: 'Send an email notification when there\'s an issue'
        },
        {
          value: 'alert_me', 
          label: 'Alert me',
          description: 'Show a dashboard alert when there\'s a problem'
        },
        {
          value: 'retry_once',
          label: 'Retry (one time)',
          description: 'Try the automation once more before stopping'
        }
      ],
      allowCustom: false
    });
  }

  return questions;
}

// UPDATED: System prompt with no scheduling instructions
export function buildClarifySystemPrompt(connectedPluginMetaData?: PluginDefinitionContext[], missingServices?: string[]) {
  //const connectedPluginData = getConnectedPluginsWithMetadata(connectedPlugins);
  // const pluginCapabilities = connectedPluginMetaData.length > 0 
  //   ? JSON.stringify(connectedPluginMetaData.map(p => p.toShortLLMContext()))
  //   : 'No plugins currently connected';
  
  // let pluginInstructions = '';
  // if (missingServices.length > 0) {
  //   const missingDisplayNames = missingServices;
    
  //   pluginInstructions = `
  //   CRITICAL PLUGIN RESTRICTION (Highest Priority Rule): 
  //   The user mentioned these services but they are NOT connected: ${missingDisplayNames.join(', ')}
  //   DO NOT generate any questions or options that reference these missing services.
  //   Focus ONLY on the connected services listed above and their capabilities.
  //   `;
  // }

  const systemPrompt = new PromptLoader(aiPrompt);
  //const promptLoader = new PromptLoader(aiPrompt);
  //const systemPrompt = promptLoader.replaceKeywords({ "PLUGINS_CAPABILITIES": pluginCapabilities, "PLUGINS_INSTRUCTIONS": pluginInstructions });
  // if (process.env.NODE_ENV === 'development') {
  //   console.log('🤖 generate-clarification-questions: AI System Prompt constructed:', systemPrompt);
  // }  
  return systemPrompt.getPrompt();
}

export async function POST(request: NextRequest) {  
  const isDevEnv = process.env.NODE_ENV === 'development';
  
  try {
    const body = await request.json() as ClarificationQuestionRequestPayload;
    const { 
      prompt, 
      agentName, 
      description, 
      connectedPlugins,
      connectedPluginsData,
      userId,
      sessionId: providedSessionId,
      agentId: providedAgentId,
      analysis
    } = body

    console.log('CLARIFICATION API - Received json body:', body);

    const promptAnalyzer = new PromptAnalyzer(prompt);

    if (!promptAnalyzer.hasPrompt()) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const extractIdFromRequest = (id: string | undefined, headerName: string): string => {
      return id || request.headers.get(headerName) || uuidv4();
    }
    const sessionId = extractIdFromRequest(providedSessionId, 'x-session-id');
    const agentId = extractIdFromRequest(providedAgentId, 'x-agent-id');    

    console.log('🆔 CLARIFICATION API - Using CONSISTENT agent ID:', {
      providedAgentId,
      providedSessionId,
      finalAgentId: agentId,
      finalSessionId: sessionId
    })

    // Get connected plugins from multiple sources
    let connectedPluginKeys: string[] = []
    
    if (analysis && analysis.requiredServices && analysis.requiredServices?.length > 0) {
      connectedPluginKeys = analysis.requiredServices.map(service => service.split('.')[0] || '');
      if (isDevEnv) console.log(`🆔 CLARIFICATION API - Load plugins from analysis.requiredServices: ${analysis.requiredServices.join(",")} connectedPlugins: ${connectedPluginKeys}`);
    } else if (connectedPlugins && typeof connectedPlugins === 'object' && connectedPlugins.length > 0) {
      connectedPluginKeys = connectedPlugins;
      if (isDevEnv) console.log('🆔 CLARIFICATION API - Load plugins from connectedPlugins:', connectedPluginKeys);
    } else if (userId) {      
      const pluginManager = await PluginManagerV2.getInstance();
      const userConnectedPlugins = await pluginManager.getUserActionablePlugins(userId);
      connectedPluginKeys = Object.keys(userConnectedPlugins);  
      if (isDevEnv) console.log('🆔 CLARIFICATION API - Load plugins from User Actionable Plugins:', connectedPluginKeys);    
    }     

    const userPrompt = `
      user_prompt: "${promptAnalyzer.getPrompt()}"
      connected_services: ${JSON.stringify(connectedPluginKeys.length > 0 ? connectedPluginKeys.join(',') : ['none'])}
      diagnostic_result: "${JSON.stringify(analysis)}"
      `
    //const systemPrompt = buildClarifySystemPrompt(connectedPluginMetaData, missingServices);
    const systemPrompt = buildClarifySystemPrompt(undefined, []);

    if (isDevEnv) {
        console.log('==================================================================================');
        console.log('🤖 AI System Prompt:', systemPrompt);
        console.log('==================================================================================');
        console.log('🤖 AI User Prompt:', userPrompt);
        console.log('==================================================================================');
      }

    // Call Claude Sonnet 4 to generate clarification questions
    // Use AI Analytics for tracking
    const anthropicProvider = new AnthropicProvider(process.env.ANTHROPIC_API_KEY!, aiAnalytics)

    const anthropicResponse = await anthropicProvider.chatCompletion(
      {
        model: ANTHROPIC_MODELS.CLAUDE_4_SONNET,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        max_tokens: 1500
      },
      {
        userId: userId,
        sessionId: sessionId,
        feature: 'clarification_questions',
        component: 'clarification-api',
        workflow_step: 'question_generation',
        category: 'agent_creation',
        activity_type: 'agent_creation',
        activity_name: 'Generating clarification questions for workflow automation',
        activity_step: 'question_generation',
        agent_id: agentId
      }
    )

    let content = anthropicResponse.choices[0]?.message?.content || '[]'

    // Remove markdown wrapper
    content = content.trim()
    if (content.startsWith('```')) {
      content = content.replace(/```json|```/g, '').trim()
    }

    if (isDevEnv) {
      console.log('Raw Claude response:', content)
    }

    let llmResponse
    try {
      llmResponse = JSON.parse(content)
      if (isDevEnv) {
        console.log('Parsed Claude response:', llmResponse)
      }
    } catch (e) {
      console.error('Claude parse failure:', e)
      llmResponse = []
    }    

    const clarificationResponse = await parseAndValidateLLMResponse(llmResponse, promptAnalyzer);
    if (isDevEnv) {
      console.log('Final Clarification Response:', clarificationResponse);
    }
    // Log analytics
    try {
      await supabase.from('clarification_analytics').insert([{
        userId,
        prompt: promptAnalyzer.getPrompt(),
        agentName,
        description,
        connected_plugins: connectedPluginKeys,
        missing_services: analysis.missingPlugins || [],
        generated_questions: clarificationResponse.questions,
        questions_count: clarificationResponse.questions.length,
        agent_id: agentId,
        session_id: sessionId,
        generated_at: new Date().toISOString()
      }])
    } catch (analyticsError) {
      console.warn('Analytics logging failed:', analyticsError)
    }

    analysis.questionsSequence = clarificationResponse.questions;

    // Build response payload
    const response: PromptResponsePayload = {
      prompt: promptAnalyzer.getPrompt(),
      userId: userId,
      sessionId: sessionId,
      agentId: agentId,
      connectedPlugins: connectedPluginKeys,
      connectedPluginsData: connectedPluginsData?.filter(p => connectedPluginKeys.includes(p.key)) || [],
      analysis: analysis
    };
    return NextResponse.json(response, { status: 200 })

  } catch (error) {
    console.error('Clarification API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function parseAndValidateLLMResponse(llmResponse: any, promptAnalyzer: PromptAnalyzer): Promise<ClarificationResponse> {
  try {
    const isDevEnv = process.env.NODE_ENV === 'development';
    let questionsArray: any[] = []

    if (isDevEnv) {
      console.log('Starting to parse and validate LLM response:', llmResponse);
    }
    
    if (Array.isArray(llmResponse)) {
      questionsArray = llmResponse
    } else if (llmResponse && typeof llmResponse === 'object') {
      if (llmResponse.questionsSequence && Array.isArray(llmResponse.questionsSequence)) {
        questionsArray = llmResponse.questionsSequence
      } else if (llmResponse.questions && Array.isArray(llmResponse.questions)) {
        questionsArray = llmResponse.questions
      } else {
        for (const [key, value] of Object.entries(llmResponse)) {
          if (Array.isArray(value) && value.length > 0) {
            questionsArray = value
            break
          }
        }
      }
    }

    if (isDevEnv) {
      console.log('Parsed LLM response:', questionsArray);
    }

    const questions: ClarificationQuestion[] = questionsArray
      .map((q, i) => {
        if (!q || typeof q !== 'object') {
          return null
        }

        const type = (q.type || 'text').toLowerCase() as ClarificationQuestion['type']
        const structured = ['select', 'enum', 'multiselect'].includes(type)

        if (!q.question?.trim() || !q.type) {
          return null
        }
        
        if (structured && (!Array.isArray(q.options) || q.options.length < 2)) {
          return null
        }

        return {
          id: q.id || `question_${i + 1}`,
          question: q.question.trim(),
          type,
          required: q.required !== false,
          placeholder: q.placeholder || 'Choose from the options above',
          dimension: q.dimension || 'general',
          options: structured ? q.options : undefined,
          allowCustom: q.allowCustom,
          followUpQuestions: q.followUpQuestions
        }
      })
      .filter(Boolean) as ClarificationQuestion[]

    if (isDevEnv) {
      console.log('Validated questions:', questions);
    }

    // UPDATED: Add only error handling if missing - no scheduling
    const finalQuestions = addStandardQuestionsIfMissing(questions, promptAnalyzer);

    if (isDevEnv) {
      console.log('Final questions:', finalQuestions);
    }

    if (finalQuestions.length === 0) {
      return {
        questions: [
          {
            id: 'error_handling_standard',
            question: 'If something goes wrong, how should I be notified?',
            type: 'select',
            required: true,
            dimension: 'error_handling',
            placeholder: 'Choose notification method',
            options: [
              {
                value: 'email_me',
                label: 'Email me',
                description: 'Send an email notification when there\'s an issue'
              },
              {
                value: 'alert_me',
                label: 'Alert me', 
                description: 'Show a dashboard alert when there\'s a problem'
              },
              {
                value: 'retry_once',
                label: 'Retry (one time)',
                description: 'Try the automation once more before stopping'
              }
            ],
            allowCustom: false
          },
          {
            id: 'automation_goal',
            question: 'Could you describe what you want this automation to accomplish?',
            type: 'select',
            required: true,
            dimension: 'processing_logic',
            options: [
              { value: 'process_emails', label: 'Process emails', description: 'Work with email data' },
              { value: 'create_reports', label: 'Create reports', description: 'Generate summaries or analysis' },
              { value: 'monitor_changes', label: 'Monitor for changes', description: 'Watch for updates or alerts' },
              { value: 'organize_files', label: 'Organize files', description: 'Manage documents or data' }
            ],
            allowCustom: true
          }
        ],
        reasoning: 'Using fallback questions focused on execution logic only.',
        confidence: 30
      }
    }

    return {
      questions: finalQuestions.slice(0, 8),
      reasoning: `Generated ${finalQuestions.length} targeted clarification questions focused on execution logic.`,
      confidence: Math.min(95, 70 + (finalQuestions.length * 5))
    }

  } catch (e) {
    console.error('Parse validation error:', e)
    
    return {
      questions: [
        {
          id: 'error_fallback',
          question: 'Could you describe what you want this automation to accomplish?',
          type: 'select',
          required: true,
          dimension: 'processing_logic',
          options: [
            { value: 'process_emails', label: 'Process emails', description: 'Work with email data' },
            { value: 'create_reports', label: 'Create reports', description: 'Generate summaries or analysis' },
            { value: 'monitor_changes', label: 'Monitor for changes', description: 'Watch for updates or alerts' },
            { value: 'organize_files', label: 'Organize files', description: 'Manage documents or data' }
          ],
          allowCustom: true
        }
      ],
      reasoning: 'Unable to parse AI response, using basic fallback questions.',
      confidence: 30
    }
  }
}