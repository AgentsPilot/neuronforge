// app/api/v2/calibrate/preview/route.ts
// API endpoint for workflow preview with mock data (no real execution)

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AgentRepository } from '@/lib/repositories/AgentRepository';
import { MockDataGenerator, StepPreview } from '@/lib/pilot/validation/MockDataGenerator';
import { DataFlowAnalyzer } from '@/lib/pilot/validation/DataFlowAnalyzer';
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';
import { z } from 'zod';

const logger = createLogger({ module: 'PreviewAPI', service: 'calibration' });

// Request validation schema
const PreviewRequestSchema = z.object({
  agentId: z.string().uuid('Invalid agent ID format')
});

export const dynamic = 'force-dynamic';

/**
 * POST /api/v2/calibrate/preview
 *
 * Generate workflow preview with mock data for non-technical users.
 * Shows what each step will do WITHOUT executing real API calls.
 *
 * Request body:
 * {
 *   "agentId": "uuid"
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "preview": [
 *     {
 *       "stepId": "...",
 *       "stepName": "...",
 *       "plugin": "...",
 *       "action": "...",
 *       "mockOutput": { ... },
 *       "fieldsProduced": ["field1", "field2"]
 *     }
 *   ],
 *   "dataFlows": {
 *     "flows": [...],
 *     "orphanedVariables": [...],
 *     "missingProducers": [...]
 *   }
 * }
 */
export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // 1. Authenticate
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // 2. Validate input
    const body = await request.json();
    const validated = PreviewRequestSchema.parse(body);
    const { agentId } = validated;

    requestLogger.info({ userId: user.id, agentId }, 'Preview request received');

    // 3. Fetch agent
    const agentRepository = new AgentRepository();
    const agentResult = await agentRepository.findById(agentId, user.id);

    if (agentResult.error || !agentResult.data) {
      requestLogger.warn({ agentId, userId: user.id }, 'Agent not found');
      return NextResponse.json(
        { success: false, error: 'Agent not found' },
        { status: 404 }
      );
    }

    const agent = agentResult.data;

    // 4. Validate agent has workflow steps
    if (!agent.pilot_steps || agent.pilot_steps.length === 0) {
      requestLogger.warn({ agentId }, 'Agent has no workflow steps');
      return NextResponse.json(
        {
          success: false,
          error: 'Agent has no workflow steps to preview'
        },
        { status: 400 }
      );
    }

    // 5. Initialize generators
    const pluginManager = await PluginManagerV2.getInstance();
    const mockGenerator = new MockDataGenerator(pluginManager);
    const dataFlowAnalyzer = new DataFlowAnalyzer();

    requestLogger.info({
      agentId,
      totalSteps: agent.pilot_steps.length
    }, 'Generating workflow preview');

    // 6. Extract data schema from agent workflow (V6 IR)
    let dataSchema = null;
    if (agent.agent_workflow?.data_schema) {
      dataSchema = agent.agent_workflow.data_schema;
      requestLogger.debug({ agentId }, 'Using V6 data_schema for preview');
    } else {
      requestLogger.warn({ agentId }, 'No data_schema found in agent_workflow');
    }

    // 7. Generate preview with mock data
    const preview: StepPreview[] = await mockGenerator.generateWorkflowPreview(
      agent.pilot_steps,
      dataSchema
    );

    // 8. Analyze data flows
    const dataFlows = dataFlowAnalyzer.analyze(dataSchema, agent.pilot_steps);

    requestLogger.info({
      agentId,
      previewSteps: preview.length,
      dataFlowsCount: dataFlows.flows.length,
      orphanedVariables: dataFlows.orphanedVariables.length,
      missingProducers: dataFlows.missingProducers.length
    }, 'Preview generated successfully');

    // 9. Return preview
    return NextResponse.json({
      success: true,
      preview,
      dataFlows,
      metadata: {
        agentId,
        agentName: agent.agent_name,
        totalSteps: preview.length,
        generatedAt: new Date().toISOString()
      }
    });

  } catch (error: any) {
    // Handle validation errors
    if (error instanceof z.ZodError) {
      requestLogger.warn({ errors: error.errors }, 'Invalid request format');
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request format',
          details: process.env.NODE_ENV === 'development' ? error.errors : undefined
        },
        { status: 400 }
      );
    }

    // Handle unexpected errors
    requestLogger.error({
      err: error,
      message: error.message,
      stack: error.stack
    }, 'Preview request failed');

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to generate workflow preview',
        message: error.message,
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      },
      { status: 500 }
    );
  }
}
