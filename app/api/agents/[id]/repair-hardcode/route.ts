// app/api/agents/[id]/repair-hardcode/route.ts
// API endpoint for repairing hardcoded values in agent workflows
// Replaces hardcoded values with {{input.X}} template variables
// Updates agent.pilot_steps, agent.input_schema, and agent_configurations

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { createAuthenticatedServerClient } from '@/lib/supabaseServerAuth';
import { agentRepository } from '@/lib/repositories';
import { HardcodeDetector } from '@/lib/pilot/shadow/HardcodeDetector';

const logger = createLogger({ module: 'API', route: '/api/agents/[id]/repair-hardcode' });

export const runtime = 'nodejs';

interface RepairSelection {
  path: string;
  param_name: string;
  value: any;
  original_value: any;
}

interface RepairRequest {
  selections: RepairSelection[];
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const startTime = Date.now();
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const agentId = params.id;

  const requestLogger = logger.child({ correlationId, agentId });
  requestLogger.info('Hardcode repair request received');

  try {
    const supabase = await createAuthenticatedServerClient();

    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      requestLogger.warn('Unauthorized request - missing user');
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = (await request.json()) as RepairRequest;
    const { selections } = body;

    if (!selections || selections.length === 0) {
      requestLogger.warn('No selections provided');
      return NextResponse.json(
        { success: false, error: 'No selections provided' },
        { status: 400 }
      );
    }

    requestLogger.info({ selectionCount: selections.length }, 'Processing repair selections');

    // Fetch agent
    const { data: agent, error: fetchError } = await agentRepository.findById(agentId, user.id);

    if (fetchError || !agent) {
      requestLogger.warn({ err: fetchError }, 'Agent not found');
      return NextResponse.json(
        { success: false, error: 'Agent not found' },
        { status: 404 }
      );
    }

    // Get current pilot_steps
    const pilotSteps = agent.pilot_steps as any[];
    if (!pilotSteps || !Array.isArray(pilotSteps)) {
      requestLogger.warn('Invalid pilot_steps structure');
      return NextResponse.json(
        { success: false, error: 'Invalid workflow structure' },
        { status: 400 }
      );
    }

    // Apply parameterization
    const detector = new HardcodeDetector();
    const repairedSteps = detector.applyParameterization(pilotSteps, selections);

    requestLogger.info('Applied parameterization to workflow');

    // Build new input_schema
    const existingSchema = (agent.input_schema as any[]) || [];
    const newSchemaFields = selections.map(sel => {
      // Infer type from value
      let fieldType = 'text';
      if (typeof sel.value === 'number') {
        fieldType = 'number';
      } else if (typeof sel.value === 'string') {
        const strValue = sel.value as string;
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(strValue)) {
          fieldType = 'email';
        } else if (/^https?:\/\/.+/.test(strValue)) {
          fieldType = 'url';
        }
      }

      return {
        name: sel.param_name,
        type: fieldType,
        label: sel.param_name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        description: `Parameterized from workflow (originally: ${String(sel.original_value).substring(0, 50)}${String(sel.original_value).length > 50 ? '...' : ''})`,
        required: true,
        default_value: sel.value,
      };
    });

    // Merge with existing schema (avoid duplicates)
    const existingParamNames = new Set(existingSchema.map((f: any) => f.name));
    const mergedSchema = [
      ...existingSchema,
      ...newSchemaFields.filter(f => !existingParamNames.has(f.name)),
    ];

    requestLogger.info({ newFieldCount: newSchemaFields.length }, 'Built new input schema');

    // Update agent in database
    const { error: updateError } = await supabase
      .from('agents')
      .update({
        pilot_steps: repairedSteps,
        input_schema: mergedSchema,
        updated_at: new Date().toISOString(),
      })
      .eq('id', agentId)
      .eq('user_id', user.id);

    if (updateError) {
      requestLogger.error({ err: updateError }, 'Failed to update agent');
      return NextResponse.json(
        { success: false, error: 'Failed to update agent' },
        { status: 500 }
      );
    }

    requestLogger.info('Agent updated successfully');

    // Save input values to agent_configurations
    const inputValues: Record<string, any> = {};
    selections.forEach(sel => {
      inputValues[sel.param_name] = sel.value;
    });

    // Check if configuration exists
    const { data: existingConfig } = await supabase
      .from('agent_configurations')
      .select('id, input_values')
      .eq('agent_id', agentId)
      .eq('user_id', user.id)
      .eq('status', 'configured')
      .order('updated_at', { ascending: false })
      .limit(1)
      .single();

    if (existingConfig) {
      // Update existing configuration
      const mergedInputValues = {
        ...(existingConfig.input_values as Record<string, any> || {}),
        ...inputValues,
      };

      const { error: configUpdateError } = await supabase
        .from('agent_configurations')
        .update({
          input_values: mergedInputValues,
          input_schema: mergedSchema,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingConfig.id);

      if (configUpdateError) {
        requestLogger.warn({ err: configUpdateError }, 'Failed to update configuration');
        // Non-fatal - agent is still repaired
      } else {
        requestLogger.info('Configuration updated');
      }
    } else {
      // Create new configuration
      const { error: configInsertError } = await supabase
        .from('agent_configurations')
        .insert({
          agent_id: agentId,
          user_id: user.id,
          input_values: inputValues,
          input_schema: mergedSchema,
          status: 'configured',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

      if (configInsertError) {
        requestLogger.warn({ err: configInsertError }, 'Failed to create configuration');
        // Non-fatal - agent is still repaired
      } else {
        requestLogger.info('Configuration created');
      }
    }

    const duration = Date.now() - startTime;
    requestLogger.info({ duration }, 'Repair completed successfully');

    return NextResponse.json({
      success: true,
      repaired_steps_count: selections.length,
      new_parameters: newSchemaFields.map(f => f.name),
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    requestLogger.error({ err: error, duration }, 'Repair request failed');

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to repair agent',
      },
      { status: 500 }
    );
  }
}
