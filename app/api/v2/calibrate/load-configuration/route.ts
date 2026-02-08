/**
 * Load Calibration Configuration API - Load saved input values
 *
 * This endpoint retrieves the saved input values from agent_configuration
 * for pre-filling in calibration runs.
 *
 * @endpoint GET /api/v2/calibrate/load-configuration?agentId=xxx
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedServerClient } from '@/lib/supabaseServerAuth';
import { AgentConfigurationRepository } from '@/lib/repositories/AgentConfigurationRepository';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'LoadCalibrationConfigAPI', service: 'api' });

export async function GET(req: NextRequest) {
  try {
    // 1. Authenticate user
    const supabase = await createAuthenticatedServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      logger.warn({ error: authError }, 'Unauthorized load configuration attempt');
      return NextResponse.json(
        { error: 'Unauthorized', message: 'You must be logged in to load configuration' },
        { status: 401 }
      );
    }

    // 2. Get agentId from query params
    const { searchParams } = new URL(req.url);
    const agentId = searchParams.get('agentId');

    if (!agentId) {
      logger.warn({ userId: user.id }, 'Missing agentId in load configuration request');
      return NextResponse.json(
        { error: 'Missing agentId', message: 'agentId is required' },
        { status: 400 }
      );
    }

    logger.info({ agentId, userId: user.id }, 'Loading calibration configuration');

    // 3. Verify agent exists and user has access
    const { data: agent, error: agentError } = await supabase
      .from('agents')
      .select('id, user_id')
      .eq('id', agentId)
      .single();

    if (agentError || !agent) {
      logger.error({ agentId, error: agentError }, 'Agent not found');
      return NextResponse.json(
        { error: 'Agent not found', message: 'The requested agent does not exist' },
        { status: 404 }
      );
    }

    if (agent.user_id !== user.id) {
      logger.warn({ agentId, userId: user.id, ownerId: agent.user_id }, 'Unauthorized agent access');
      return NextResponse.json(
        { error: 'Forbidden', message: 'You do not have permission to load configuration for this agent' },
        { status: 403 }
      );
    }

    // 4. Load configuration
    const configRepo = new AgentConfigurationRepository(supabase);
    const { data: config, error: loadError } = await configRepo.getInputValues(agentId, user.id);

    if (loadError) {
      logger.error({ agentId, error: loadError }, 'Failed to load configuration');
      return NextResponse.json(
        { error: 'Load failed', message: 'Could not load calibration configuration' },
        { status: 500 }
      );
    }

    if (!config) {
      logger.info({ agentId }, 'No saved configuration found');
      return NextResponse.json({
        success: true,
        inputValues: null,
        inputSchema: null,
        message: 'No saved configuration found'
      });
    }

    logger.info({ agentId, inputCount: Object.keys(config.input_values).length }, 'Configuration loaded successfully');

    // 5. Return configuration
    return NextResponse.json({
      success: true,
      inputValues: config.input_values,
      inputSchema: config.input_schema
    });

  } catch (error: any) {
    logger.error({
      error: error.message,
      stack: error.stack
    }, 'Load configuration failed with exception');

    return NextResponse.json(
      {
        error: 'Load configuration failed',
        message: error.message || 'An unexpected error occurred while loading configuration',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      },
      { status: 500 }
    );
  }
}
