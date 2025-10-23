// app/api/plugins/execute/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';
import { PluginExecuterV2 } from '@/lib/server/plugin-executer-v2';

// POST /api/plugins/execute
// Executes a plugin action with parameters
// Force dynamic rendering
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    // Parse request body
    const body = await request.json();
    const { userId, pluginName, actionName, parameters } = body;

    // Validate required fields
    if (!userId || !pluginName || !actionName) {
      return NextResponse.json({
        success: false,
        error: 'Missing required fields',
        message: 'userId, pluginName, and actionName are required'
      }, { status: 400 });
    }

    console.log(`DEBUG: API - Executing ${pluginName}.${actionName} for user ${userId}`);

    // Get plugin manager instance
    const pluginManager = await PluginManagerV2.getInstance();
    
    // Verify plugin exists
    const pluginDefinition = pluginManager.getPluginDefinition(pluginName);
    if (!pluginDefinition) {
      return NextResponse.json({
        success: false,
        error: 'Plugin not found',
        message: `Plugin ${pluginName} is not available`
      }, { status: 404 });
    }

    // Verify action exists
    const actionDefinition = pluginManager.getActionDefinition(pluginName, actionName);
    if (!actionDefinition) {
      return NextResponse.json({
        success: false,
        error: 'Action not found',
        message: `Action ${actionName} not found in plugin ${pluginName}`
      }, { status: 404 });
    }

    // Execute action using PluginExecuterV2
    const pluginExecuter = await PluginExecuterV2.getInstance();
    const result = await pluginExecuter.execute(userId, pluginName, actionName, parameters || {});

    // Log execution result
    console.log(`DEBUG: API - Execution result for ${pluginName}.${actionName}:`, {
      success: result.success,
      hasData: !!result.data,
      error: result.error
    });

    // Return result (success or failure)
    const statusCode = result.success ? 200 : 400;
    return NextResponse.json(result, { status: statusCode });

  } catch (error: any) {
    console.error('DEBUG: API - Error executing plugin action:', error);
    
    return NextResponse.json({
      success: false,
      error: 'Execution failed',
      message: error.message
    }, { status: 500 });
  }
}

// GET /api/plugins/execute (for testing - returns available actions)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const pluginName = searchParams.get('plugin');
    
    console.log(`DEBUG: API - Getting available actions${pluginName ? ` for ${pluginName}` : ''}`);

    const pluginManager = await PluginManagerV2.getInstance();
    
    if (pluginName) {
      // Get actions for specific plugin
      const pluginDefinition = pluginManager.getPluginDefinition(pluginName);
      if (!pluginDefinition) {
        return NextResponse.json({
          success: false,
          error: 'Plugin not found'
        }, { status: 404 });
      }

      const actions = Object.entries(pluginDefinition.actions).map(([actionName, action]) => ({
        name: actionName,
        description: action.description,
        usage_context: action.usage_context,
        parameters: action.parameters
      }));

      return NextResponse.json({
        success: true,
        plugin: pluginName,
        actions,
        action_count: actions.length
      });
    } else {
      // Get all available plugins and their actions
      const allPlugins = pluginManager.getAvailablePlugins();
      const pluginActions = Object.entries(allPlugins).map(([pluginKey, definition]) => ({
        plugin: pluginKey,
        name: definition.plugin.name,
        actions: Object.keys(definition.actions),
        action_count: Object.keys(definition.actions).length
      }));

      return NextResponse.json({
        success: true,
        plugins: pluginActions,
        total_plugins: pluginActions.length
      });
    }

  } catch (error: any) {
    console.error('DEBUG: API - Error getting plugin actions:', error);
    
    return NextResponse.json({
      success: false,
      error: 'Failed to get plugin actions',
      message: error.message
    }, { status: 500 });
  }
}