// app/api/agents/[id]/fix-hardcode/route.ts
// API endpoint for fixing wrong hardcoded values in agent workflows
// Updates the hardcoded value directly in pilot_steps (does NOT parameterize)

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { createAuthenticatedServerClient } from '@/lib/supabaseServerAuth';
import { agentRepository } from '@/lib/repositories';

const logger = createLogger({ module: 'API', route: '/api/agents/[id]/fix-hardcode' });

export const runtime = 'nodejs';

interface FixHardcodeRequest {
  stepId: string;
  path: string;          // JSONPath to the value (e.g., "params.range")
  newValue: any;         // The corrected value
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const startTime = Date.now();
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const agentId = params.id;

  const requestLogger = logger.child({ correlationId, agentId });
  requestLogger.info('Fix hardcode request received');

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

    const body = (await request.json()) as FixHardcodeRequest;
    const { stepId, path, newValue } = body;

    if (!stepId || !path || newValue === undefined) {
      requestLogger.warn('Missing required fields');
      return NextResponse.json(
        { success: false, error: 'stepId, path, and newValue are required' },
        { status: 400 }
      );
    }

    requestLogger.info({ stepId, path, newValue }, 'Processing hardcode fix');

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

    // DEBUGGING: Log array structure to detect duplicates
    const stepIds = pilotSteps.map((s, idx) => ({
      index: idx,
      id: s.id,
      step_id: s.step_id,
      name: s.name,
      hasRange: !!(s.params?.range || s.config?.range || s.range),
    }));
    requestLogger.info({ stepIds, totalSteps: pilotSteps.length }, 'Full pilot_steps structure');

    // Find the step
    const stepIndex = pilotSteps.findIndex(s => s.id === stepId || s.step_id === stepId);
    if (stepIndex === -1) {
      requestLogger.warn({ stepId }, 'Step not found in workflow');
      return NextResponse.json(
        { success: false, error: 'Step not found in workflow' },
        { status: 404 }
      );
    }

    // Update the value at the specified path
    const updatedSteps = [...pilotSteps];
    const step = { ...updatedSteps[stepIndex] };

    // DEBUGGING: Log COMPLETE step object
    requestLogger.info({
      stepId,
      stepIndex,
      fullStep: JSON.stringify(step, null, 2),
      stepIdField: step.id,
      stepStepIdField: step.step_id,
    }, 'Complete step object found');

    // Log step structure for debugging
    requestLogger.info({
      stepId,
      stepKeys: Object.keys(step),
      hasParams: !!step.params,
      hasConfig: !!step.config,
      paramsKeys: step.params ? Object.keys(step.params) : [],
      configKeys: step.config ? Object.keys(step.config) : [],
    }, 'Step structure before update');

    // DEBUGGING: Recursively search for ALL occurrences of the old value
    function findAllOccurrences(obj: any, searchValue: any, path = ''): string[] {
      const found: string[] = [];
      if (obj === searchValue) {
        found.push(path || 'root');
      }
      if (obj && typeof obj === 'object') {
        for (const [key, value] of Object.entries(obj)) {
          found.push(...findAllOccurrences(value, searchValue, path ? `${path}.${key}` : key));
        }
      }
      return found;
    }

    // Parse path (e.g., "params.range" -> ["params", "range"])
    const pathParts = path.split('.');

    // If path is just a parameter name (e.g., "range"), search for it in the step structure
    let actualPath = path;
    if (pathParts.length === 1) {
      const paramName = pathParts[0];
      // Search common locations: params, config, data
      if (step.params && step.params[paramName] !== undefined) {
        actualPath = `params.${paramName}`;
        requestLogger.info({ paramName, location: 'params', currentValue: step.params[paramName] }, 'Found in params');
      } else if (step.config && step.config[paramName] !== undefined) {
        actualPath = `config.${paramName}`;
        requestLogger.info({ paramName, location: 'config', currentValue: step.config[paramName] }, 'Found in config');
      } else if (step[paramName] !== undefined) {
        actualPath = paramName;
        requestLogger.info({ paramName, location: 'root', currentValue: step[paramName] }, 'Found in root');
      } else {
        // Not found - try params as default
        actualPath = `params.${paramName}`;
        requestLogger.warn({ paramName, actualPath }, 'Parameter not found in step - defaulting to params');
      }
      requestLogger.info({ paramName, actualPath }, 'Resolved parameter path');
    }

    const resolvedPathParts = actualPath.split('.');

    // Navigate to the parent object
    let current: any = step;
    for (let i = 0; i < resolvedPathParts.length - 1; i++) {
      const part = resolvedPathParts[i];
      if (!current[part]) {
        current[part] = {};
      } else {
        current[part] = { ...current[part] };
      }
      current = current[part];
    }

    // Set the new value
    const lastPart = resolvedPathParts[resolvedPathParts.length - 1];
    const oldValue = current[lastPart];

    // DEBUGGING: Find all occurrences of the old value in the step before updating
    const allOccurrences = findAllOccurrences(step, oldValue);
    requestLogger.info({ allOccurrences, searchValue: oldValue }, 'All value occurrences in step before update');

    current[lastPart] = newValue;

    updatedSteps[stepIndex] = step;

    // Verify the update was applied
    const verifyPath = resolvedPathParts.slice();
    let verifyValue: any = step;
    for (const part of verifyPath) {
      verifyValue = verifyValue?.[part];
    }

    requestLogger.info({
      oldValue,
      newValue,
      resolvedPath: actualPath,
      verifiedValue: verifyValue,
      updateApplied: verifyValue === newValue,
    }, 'Updated hardcoded value in workflow');

    // Save updated steps to BOTH pilot_steps AND workflow_steps
    // CRITICAL: WorkflowPilot uses workflow_steps for execution, so we MUST update both!
    requestLogger.info('Attempting to update agent with new pilot_steps AND workflow_steps');

    // CRITICAL: Also update updated_at to bust any caching layers
    const { error: updateError } = await supabase
      .from('agents')
      .update({
        pilot_steps: updatedSteps,
        workflow_steps: updatedSteps,  // CRITICAL: Also update workflow_steps for execution
        updated_at: new Date().toISOString()  // CRITICAL: Bust cache by updating timestamp
      })
      .eq('id', agentId)
      .eq('user_id', user.id);

    if (updateError) {
      requestLogger.error({ err: updateError, errorMessage: updateError.message, errorDetails: JSON.stringify(updateError) }, 'Failed to update agent');
      return NextResponse.json(
        { success: false, error: `Failed to update agent workflow: ${updateError.message || JSON.stringify(updateError)}` },
        { status: 500 }
      );
    }

    // DEBUGGING: Re-fetch the agent to confirm update persisted in BOTH fields
    const { data: verifyAgent, error: verifyError } = await supabase
      .from('agents')
      .select('pilot_steps, workflow_steps')
      .eq('id', agentId)
      .single();

    if (!verifyError && verifyAgent) {
      const verifiedPilotSteps = verifyAgent.pilot_steps as any[];
      const verifiedWorkflowSteps = verifyAgent.workflow_steps as any[];

      const verifiedPilotStep = verifiedPilotSteps[stepIndex];
      const verifiedWorkflowStep = verifiedWorkflowSteps[stepIndex];

      const pilotValue = verifiedPilotStep?.params?.[lastPart] || verifiedPilotStep?.config?.[lastPart] || verifiedPilotStep?.[lastPart];
      const workflowValue = verifiedWorkflowStep?.params?.[lastPart] || verifiedWorkflowStep?.config?.[lastPart] || verifiedWorkflowStep?.[lastPart];

      requestLogger.info({
        pilotValue,
        workflowValue,
        expectedValue: newValue,
        pilotMatches: pilotValue === newValue,
        workflowMatches: workflowValue === newValue,
      }, 'Database verification after update - BOTH fields');

      if (pilotValue !== newValue) {
        requestLogger.error({
          pilotValue,
          expectedValue: newValue,
        }, '❌ pilot_steps update did NOT persist! Value mismatch after re-fetch');
      }

      if (workflowValue !== newValue) {
        requestLogger.error({
          workflowValue,
          expectedValue: newValue,
        }, '❌ workflow_steps update did NOT persist! Value mismatch after re-fetch');
      }
    } else {
      requestLogger.warn({ err: verifyError }, 'Could not verify database update');
    }

    const duration = Date.now() - startTime;
    requestLogger.info({ duration }, 'Hardcode fix completed successfully');

    return NextResponse.json({
      success: true,
      message: 'Hardcoded value updated successfully',
      updatedStep: {
        stepId,
        path,
        oldValue,
        newValue,
      },
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    requestLogger.error({ err: error, duration }, 'Fix hardcode request failed');

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fix hardcoded value',
      },
      { status: 500 }
    );
  }
}
