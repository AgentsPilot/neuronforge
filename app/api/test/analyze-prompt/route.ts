// app/api/test/analyze-prompt/route.ts
// Test endpoint for analyzePromptDirectAgentKit function
import { NextRequest, NextResponse } from 'next/server';
import {
  analyzePromptDirectAgentKit,
  AIProviderConfig,
  DEFAULT_PROVIDER_CONFIG
} from '@/lib/agentkit/analyzePrompt-v3-direct';
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';
import { ProviderName } from '@/lib/ai/providerFactory';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, prompt, availablePlugins, sessionId, provider, model } = body;

    if (!userId || !prompt) {
      return NextResponse.json(
        { success: false, error: 'userId and prompt are required' },
        { status: 400 }
      );
    }

    // Convert plugin keys to PluginDefinitionContext[]
    const pluginManager = await PluginManagerV2.getInstance();
    const pluginKeys = availablePlugins || [];
    const pluginContexts = pluginManager.getPluginsDefinitionContext(pluginKeys);

    // Build provider config if provider and model are specified
    const providerConfig: AIProviderConfig = (provider && model)
      ? { provider: provider as ProviderName, model }
      : DEFAULT_PROVIDER_CONFIG;

    const result = await analyzePromptDirectAgentKit(
      userId,
      prompt,
      pluginContexts,
      sessionId,
      providerConfig
    );

    return NextResponse.json({
      success: true,
      result,
      // Include provider info in response for debugging
      providerUsed: {
        provider: providerConfig.provider,
        model: providerConfig.model
      }
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}