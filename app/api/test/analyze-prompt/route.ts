// app/api/test/analyze-prompt/route.ts
// Test endpoint for analyzePromptDirectAgentKit function
import { NextRequest, NextResponse } from 'next/server';
import { analyzePromptDirectAgentKit } from '@/lib/agentkit/analyzePrompt-v3-direct';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, prompt, availablePlugins } = body;

    if (!userId || !prompt) {
      return NextResponse.json(
        { success: false, error: 'userId and prompt are required' },
        { status: 400 }
      );
    }

    const pluginKeys = availablePlugins || [];

    const result = await analyzePromptDirectAgentKit(
      userId,
      prompt,
      pluginKeys
    );

    return NextResponse.json({
      success: true,
      result
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}