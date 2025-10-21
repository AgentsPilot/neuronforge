// app/api/llm/context/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';

// GET /api/llm/context?userId={userId}
// Returns LLM context with connected and available plugins for the user
export async function GET(request: NextRequest) {
  try {
    // Get userId from query parameters
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({
        success: false,
        error: 'Missing userId parameter'
      }, { status: 400 });
    }

    console.log(`DEBUG: API - Generating LLM context for user ${userId}`);
    
    // Get plugin manager instance
    const pluginManager = await PluginManagerV2.getInstance();
    
    // Generate LLM context
    const context = await pluginManager.generateLLMContext(userId);
    
    console.log(`DEBUG: API - LLM context generated - Connected: ${Object.keys(context.connected_plugins).length}, Available: ${Object.keys(context.available_plugins).length}`);

    return NextResponse.json({
      success: true,
      user_id: userId,
      context,
      summary: {
        connected_plugins: Object.keys(context.connected_plugins),
        available_plugins: Object.keys(context.available_plugins),
        connected_count: Object.keys(context.connected_plugins).length,
        available_count: Object.keys(context.available_plugins).length
      },
      generated_at: new Date().toISOString()
    });

  } catch (error: any) {
    console.error('DEBUG: API - Error generating LLM context:', error);
    
    return NextResponse.json({
      success: false,
      error: 'Failed to generate LLM context',
      message: error.message
    }, { status: 500 });
  }
}