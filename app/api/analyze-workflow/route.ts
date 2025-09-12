import { NextRequest, NextResponse } from 'next/server';
import { trackUsage } from '@/lib/utils/usageTracker';

interface AnalyzeWorkflowRequest {
  systemPrompt: string;
  userMessage: string;
  userId?: string; // Add userId to the interface
}

interface OpenAIResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export async function POST(request: NextRequest) {
  try {
    const body: AnalyzeWorkflowRequest = await request.json();
    const { systemPrompt, userMessage, userId } = body;
    
    if (!systemPrompt || !userMessage) {
      return NextResponse.json(
        { error: 'Missing required fields: systemPrompt and userMessage' },
        { status: 400 }
      );
    }

    // Get user ID from request headers if not in body (fallback method)
    const userIdToUse = userId || request.headers.get('x-user-id') || 'anonymous';
    
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: 'OpenAI API key not configured in environment variables' },
        { status: 500 }
      );
    }

    console.log('🚀 Processing workflow analysis request for user:', userIdToUse);
    console.log('📝 User message length:', userMessage.length);
    
    console.log('Making OpenAI API call...');
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.1,
        max_tokens: 2000
      })
    });

    console.log('OpenAI response status:', response.status);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('OpenAI API error:', errorData);
      return NextResponse.json(
        { error: `OpenAI API failed: ${response.status} - ${errorData.error?.message || response.statusText}` },
        { status: 500 }
      );
    }

    const data: OpenAIResponse = await response.json();
    const content = data.choices[0]?.message?.content;
    
    if (!content) {
      return NextResponse.json(
        { error: 'No response content from ChatGPT' },
        { status: 500 }
      );
    }

    // Extract usage data from OpenAI response
    const inputTokens = data.usage?.prompt_tokens || 0;
    const outputTokens = data.usage?.completion_tokens || 0;
    const totalTokens = data.usage?.total_tokens || 0;

    console.log('📊 Token usage:', {
      input: inputTokens,
      output: outputTokens,
      total: totalTokens
    });

    console.log('ChatGPT response received, parsing JSON...');

    // Extract JSON from ChatGPT response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('No JSON found in ChatGPT response:', content);
      return NextResponse.json(
        { error: 'ChatGPT did not return valid JSON format' },
        { status: 500 }
      );
    }

    let analysis;
    try {
      analysis = JSON.parse(jsonMatch[0]);
      console.log('Successfully parsed ChatGPT analysis');
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      return NextResponse.json(
        { error: 'Failed to parse ChatGPT JSON response' },
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

    // Track usage in database - only if we have a real user ID
    if (userIdToUse !== 'anonymous') {
      console.log('💾 Tracking usage for user:', userIdToUse);
      
      const trackingSuccess = await trackUsage({
        userId: userIdToUse,
        provider: 'openai',
        modelName: 'gpt-4o',
        inputTokens: inputTokens,
        outputTokens: outputTokens,
        requestType: 'workflow_analysis',
        metadata: {
          originalMessageLength: userMessage.length,
          analysisSteps: analysis.workflowSteps?.length || 0,
          confidence: analysis.confidence || 0,
          timestamp: new Date().toISOString()
        }
      });
      
      if (trackingSuccess) {
        console.log('✅ Usage tracking successful');
      } else {
        console.warn('⚠️ Usage tracking failed, but continuing with response');
      }
    } else {
      console.log('⚠️ Skipping usage tracking - anonymous user');
    }
    
    return NextResponse.json({ 
      analysis,
      usage: {
        provider: 'openai',
        model: 'gpt-4',
        inputTokens: inputTokens,
        outputTokens: outputTokens,
        totalTokens: totalTokens
      }
    });
    
  } catch (error: any) {
    console.error('API route error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to analyze workflow with ChatGPT' },
      { status: 500 }
    );
  }
}