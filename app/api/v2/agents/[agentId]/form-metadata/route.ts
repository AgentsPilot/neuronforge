// app/api/v2/agents/[agentId]/form-metadata/route.ts
// API endpoint to generate form field metadata for dynamic dropdowns

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedServerClient } from '@/lib/supabaseServerAuth';
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';
import { generateFormFieldMetadata } from '@/lib/agentkit/v6/utils/form-field-metadata-generator';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'FormMetadataAPI', service: 'v6-calibration' });

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ agentId: string }> }
) {
  try {
    const { agentId } = await context.params;
    logger.info({ agentId }, 'Fetching form field metadata');

    // Get authenticated user
    const supabasePromise = createAuthenticatedServerClient();
    const supabase = await supabasePromise;
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      logger.warn({ agentId }, 'Unauthorized access to form metadata');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch agent from database
    const { data: agent, error: agentError } = await supabase
      .from('agents')
      .select('id, agent_name, input_schema, pilot_steps')
      .eq('id', agentId)
      .eq('user_id', user.id)
      .single();

    if (agentError || !agent) {
      logger.warn({ agentId, error: agentError }, 'Agent not found');
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    // Validate required fields
    if (!agent.input_schema) {
      logger.info({ agentId }, 'No input schema, returning empty metadata');
      return NextResponse.json({ metadata: [] });
    }

    if (!agent.pilot_steps || !Array.isArray(agent.pilot_steps)) {
      logger.info({ agentId }, 'No pilot steps, returning empty metadata');
      return NextResponse.json({ metadata: [] });
    }

    // Convert input_schema to array format if it's an object
    let inputSchemaArray: Array<{ name: string; type: string; description?: string; required?: boolean }>;

    if (Array.isArray(agent.input_schema)) {
      // Already in array format
      inputSchemaArray = agent.input_schema;
      logger.debug({ agentId }, 'Input schema is already in array format');
    } else if (typeof agent.input_schema === 'object') {
      // Convert object format {key: value} to array format [{name, type, ...}]
      inputSchemaArray = Object.keys(agent.input_schema).map(key => {
        const value = agent.input_schema[key];
        const type = typeof value === 'number' ? 'number' :
                     typeof value === 'boolean' ? 'boolean' :
                     'string';
        return {
          name: key,
          type,
          required: false, // Assume optional for config values
          description: `Configuration parameter: ${key}`
        };
      });
      logger.debug({ agentId, fields: inputSchemaArray.map(f => f.name) }, 'Converted object input_schema to array format');
    } else {
      logger.warn({ agentId, schemaType: typeof agent.input_schema }, 'Unexpected input_schema format');
      return NextResponse.json({ metadata: [] });
    }

    // Get plugin manager instance
    const pluginManager = await PluginManagerV2.getInstance();

    // Generate form field metadata
    const metadata = await generateFormFieldMetadata(
      inputSchemaArray,
      agent.pilot_steps,
      pluginManager
    );

    logger.info({
      agentId,
      metadataCount: metadata.length,
      fields: metadata.map(m => m.name)
    }, 'Form field metadata generated successfully');

    return NextResponse.json({
      metadata,
      timestamp: Date.now()
    });

  } catch (error: any) {
    logger.error({ error: error.toString() }, 'Error generating form field metadata');
    return NextResponse.json(
      { error: 'Failed to generate form field metadata', details: error.toString() },
      { status: 500 }
    );
  }
}
