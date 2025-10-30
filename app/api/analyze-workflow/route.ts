import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { AIAnalyticsService } from '@/lib/analytics/aiAnalytics';
import { OpenAIProvider } from '@/lib/ai/providers/openaiProvider';
import { v4 as uuidv4 } from 'uuid';

interface AnalyzeWorkflowRequest {
  systemPrompt: string;
  userMessage: string;
  userId?: string;
  sessionId?: string;
}

// Initialize Supabase service client for analytics
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Initialize AI Analytics
const aiAnalytics = new AIAnalyticsService(supabase, {
  enableRealtime: true,
  enableCostTracking: true,
  enablePerformanceMetrics: true
});

export async function POST(request: NextRequest) {
  try {
    const body: AnalyzeWorkflowRequest = await request.json();
    const { systemPrompt, userMessage, userId, sessionId: providedSessionId } = body;

    if (!systemPrompt || !userMessage) {
      return NextResponse.json(
        { error: 'Missing required fields: systemPrompt and userMessage' },
        { status: 400 }
      );
    }

    // Get user ID from request headers if not in body (fallback method)
    const userIdToUse = userId || request.headers.get('x-user-id') || 'anonymous';

    // Get or generate session ID
    const sessionId = providedSessionId || request.headers.get('x-session-id') || uuidv4();

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: 'OpenAI API key not configured in environment variables' },
        { status: 500 }
      );
    }

    console.log('🚀 Processing workflow analysis request for user:', userIdToUse);
    console.log('📝 User message length:', userMessage.length);

    // Initialize OpenAI provider with analytics
    const openaiProvider = new OpenAIProvider(process.env.OPENAI_API_KEY!, aiAnalytics);

    console.log('📊 Making tracked AI call for workflow analysis');

    // Call OpenAI with automatic analytics tracking via BaseProvider
    const response = await openaiProvider.chatCompletion(
      {
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.1,
        max_tokens: 2000
      },
      {
        userId: userIdToUse,
        sessionId: sessionId,
        feature: 'workflow_analysis',
        component: 'analyze-workflow',
        workflow_step: 'ai_analysis',
        category: 'workflow_processing',
        activity_type: 'workflow_analysis',
        activity_name: 'Analyzing workflow structure and steps',
        activity_step: 'analysis'
      }
    );

    const content = response.choices[0]?.message?.content;

    if (!content) {
      return NextResponse.json(
        { error: 'No response content from OpenAI' },
        { status: 500 }
      );
    }

    // Extract usage data from OpenAI response
    const inputTokens = response.usage?.prompt_tokens || 0;
    const outputTokens = response.usage?.completion_tokens || 0;
    const totalTokens = response.usage?.total_tokens || 0;

    console.log('📊 Token usage:', {
      input: inputTokens,
      output: outputTokens,
      total: totalTokens
    });

    console.log('✅ Workflow analysis response received, parsing JSON...');

    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('No JSON found in OpenAI response:', content);
      return NextResponse.json(
        { error: 'OpenAI did not return valid JSON format' },
        { status: 500 }
      );
    }

    let analysis;
    try {
      analysis = JSON.parse(jsonMatch[0]);
      console.log('✅ Successfully parsed workflow analysis');
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      return NextResponse.json(
        { error: 'Failed to parse OpenAI JSON response' },
        { status: 500 }
      );
    }

    // Validate the analysis structure
    if (!analysis.workflowSteps || !Array.isArray(analysis.workflowSteps)) {
      console.error('Invalid analysis structure:', analysis);
      return NextResponse.json(
        { error: 'Invalid analysis format: missing workflowSteps array' },
        { status: 500 }
      );
    }

    // Note: Token tracking happens automatically via openaiProvider.chatCompletion()
    // No manual tracking needed - AIAnalyticsService handles it via BaseProvider

    console.log('✅ Workflow analysis completed successfully');
    console.log('📊 Analysis contains', analysis.workflowSteps?.length || 0, 'workflow steps');

    return NextResponse.json({
      analysis,
      usage: {
        provider: 'openai',
        model: 'gpt-4o',
        inputTokens: inputTokens,
        outputTokens: outputTokens,
        totalTokens: totalTokens
      },
      sessionId: sessionId // Return session ID for tracking
    });

  } catch (error: any) {
    console.error('❌ API route error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to analyze workflow' },
      { status: 500 }
    );
  }
}
