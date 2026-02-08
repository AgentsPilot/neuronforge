// app/api/calibrate/detect-hardcoded/route.ts
// Detect hardcoded values in a specific failed step during calibration
// Used to determine if we should offer parameterization vs input editing

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedServerClient } from '@/lib/supabaseServerAuth';
import { agentRepository } from '@/lib/repositories';
import { HardcodeDetector } from '@/lib/pilot/shadow/HardcodeDetector';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'API', route: '/api/calibrate/detect-hardcoded' });

export const runtime = 'nodejs';

interface DetectRequest {
  agentId: string;
  stepId: string; // The specific failed step to analyze
}

/**
 * Extract input parameter references from a step
 * Looks for {{input.xxx}} patterns in step configuration
 */
function extractReferencedInputs(step: any): string[] {
  const inputs = new Set<string>();
  const inputPattern = /\{\{input\.(\w+)\}\}/g;

  // Convert step to JSON string to search all nested values
  const stepJson = JSON.stringify(step);

  let match;
  while ((match = inputPattern.exec(stepJson)) !== null) {
    inputs.add(match[1]); // match[1] is the captured parameter name
  }

  return Array.from(inputs);
}

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const supabase = await createAuthenticatedServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      requestLogger.warn('Unauthorized request - missing user');
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = (await request.json()) as DetectRequest;
    const { agentId, stepId } = body;

    if (!agentId || !stepId) {
      return NextResponse.json(
        { success: false, error: 'agentId and stepId are required' },
        { status: 400 }
      );
    }

    // Fetch agent
    const { data: agent, error: agentError } = await agentRepository.findById(agentId, user.id);
    if (agentError || !agent) {
      return NextResponse.json(
        { success: false, error: 'Agent not found' },
        { status: 404 }
      );
    }

    // Get pilot_steps
    const pilotSteps = agent.pilot_steps as any[];
    if (!pilotSteps || !Array.isArray(pilotSteps)) {
      return NextResponse.json(
        { success: false, error: 'Invalid workflow structure' },
        { status: 400 }
      );
    }

    // Find the specific step
    const failedStep = pilotSteps.find(s => s.id === stepId || s.step_id === stepId);
    if (!failedStep) {
      return NextResponse.json(
        { success: false, error: 'Step not found in workflow' },
        { status: 404 }
      );
    }

    requestLogger.info({ stepId, stepType: failedStep.type }, 'Analyzing step for hardcoded values');

    // Run hardcode detection on just this step
    const detector = new HardcodeDetector();

    // Extract resolved_user_inputs from enhanced_prompt if available
    let resolvedUserInputs: Array<{ key: string; value: any }> | undefined;
    if (agent.enhanced_prompt) {
      try {
        const enhancedPrompt = typeof agent.enhanced_prompt === 'string'
          ? JSON.parse(agent.enhanced_prompt)
          : agent.enhanced_prompt;
        resolvedUserInputs = enhancedPrompt?.specifics?.resolved_user_inputs;
      } catch (e) {
        // If parsing fails, continue without resolved inputs
      }
    }

    const detectionResult = detector.detect([failedStep], resolvedUserInputs);

    // Flatten all detected values
    const allDetected = [
      ...detectionResult.resource_ids,
      ...detectionResult.business_logic,
      ...detectionResult.configuration,
    ];

    // Filter to only values from this specific step
    const stepDetected = allDetected.filter(d =>
      d.stepIds.includes(stepId) || d.stepIds.includes(failedStep.id)
    );

    // Extract which input parameters are referenced in this step
    // Look for {{input.xxx}} patterns in the step configuration
    const referencedInputs = extractReferencedInputs(failedStep);

    requestLogger.info({
      detectedCount: stepDetected.length,
      referencedInputCount: referencedInputs.length,
      categories: {
        resource_ids: stepDetected.filter(d => d.category === 'resource_ids').length,
        business_logic: stepDetected.filter(d => d.category === 'business_logic').length,
        configuration: stepDetected.filter(d => d.category === 'configuration').length,
      }
    }, 'Detection complete');

    return NextResponse.json({
      success: true,
      has_hardcoded_values: stepDetected.length > 0,
      detected_values: stepDetected,
      referenced_inputs: referencedInputs, // List of input parameter names used in this step
      step_info: {
        step_id: failedStep.id || failedStep.step_id,
        type: failedStep.type,
        plugin: failedStep.plugin,
        action: failedStep.operation || failedStep.action,
      },
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to detect hardcoded values');
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to detect hardcoded values',
      },
      { status: 500 }
    );
  }
}
