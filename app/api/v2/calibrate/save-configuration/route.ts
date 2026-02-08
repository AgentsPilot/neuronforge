/**
 * Save Calibration Configuration API - Save input values for reuse
 *
 * This endpoint saves the input values from a calibration run to agent_configuration
 * so they can be pre-filled in subsequent calibration runs.
 *
 * @endpoint POST /api/v2/calibrate/save-configuration
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedServerClient } from '@/lib/supabaseServerAuth';
import { AgentConfigurationRepository } from '@/lib/repositories/AgentConfigurationRepository';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'SaveCalibrationConfigAPI', service: 'api' });

export async function POST(req: NextRequest) {
  try {
    // 1. Authenticate user
    const supabase = await createAuthenticatedServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      logger.warn({ error: authError }, 'Unauthorized save configuration attempt');
      return NextResponse.json(
        { error: 'Unauthorized', message: 'You must be logged in to save configuration' },
        { status: 401 }
      );
    }

    // 2. Parse request body
    const { agentId, inputValues, inputSchema } = await req.json();

    if (!agentId) {
      logger.warn({ userId: user.id }, 'Missing agentId in save configuration request');
      return NextResponse.json(
        { error: 'Missing agentId', message: 'agentId is required' },
        { status: 400 }
      );
    }

    if (!inputValues || typeof inputValues !== 'object') {
      logger.warn({ userId: user.id, agentId }, 'Invalid inputValues in save configuration request');
      return NextResponse.json(
        { error: 'Invalid inputValues', message: 'inputValues must be an object' },
        { status: 400 }
      );
    }

    logger.info({ agentId, userId: user.id, inputCount: Object.keys(inputValues).length }, 'Saving calibration configuration');

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
        { error: 'Forbidden', message: 'You do not have permission to save configuration for this agent' },
        { status: 403 }
      );
    }

    // 4. Save configuration
    const configRepo = new AgentConfigurationRepository(supabase);
    const { data: savedConfig, error: saveError } = await configRepo.saveInputValues(
      agentId,
      user.id,
      inputValues,
      inputSchema
    );

    if (saveError || !savedConfig) {
      logger.error({ agentId, error: saveError }, 'Failed to save configuration');
      return NextResponse.json(
        { error: 'Save failed', message: 'Could not save calibration configuration' },
        { status: 500 }
      );
    }

    logger.info({ agentId, configId: savedConfig.id }, 'Configuration saved successfully');

    // 5. Return success
    return NextResponse.json({
      success: true,
      configId: savedConfig.id,
      message: 'Configuration saved successfully'
    });

  } catch (error: any) {
    logger.error({
      error: error.message,
      stack: error.stack
    }, 'Save configuration failed with exception');

    return NextResponse.json(
      {
        error: 'Save configuration failed',
        message: error.message || 'An unexpected error occurred while saving configuration',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      },
      { status: 500 }
    );
  }
}
