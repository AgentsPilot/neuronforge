// app/api/v2/calibrate/auto-fix/route.ts
// API endpoint for automatic workflow validation and error correction

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AgentRepository } from '@/lib/repositories/AgentRepository';
import { AutoFixEngine } from '@/lib/pilot/validation/AutoFixEngine';
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';
import { z } from 'zod';

const logger = createLogger({ module: 'AutoFixAPI', service: 'calibration' });

// Request validation schema
const AutoFixRequestSchema = z.object({
  agentId: z.string().uuid('Invalid agent ID format')
});

export const dynamic = 'force-dynamic';

/**
 * POST /api/v2/calibrate/auto-fix
 *
 * Automatically validates and fixes workflow errors for non-technical users.
 *
 * Request body:
 * {
 *   "agentId": "uuid"
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "fixesApplied": [
 *     { "issue": "...", "fix": "...", "automatic": true }
 *   ],
 *   "unfixableIssues": [
 *     { "id": "...", "userQuestion": "...", "options": [...] }
 *   ],
 *   "finalAgent": { ... },
 *   "message": "..."
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
    const validated = AutoFixRequestSchema.parse(body);
    const { agentId } = validated;

    requestLogger.info({ userId: user.id, agentId }, 'Auto-fix request received');

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

    // 4. Initialize auto-fix engine
    const pluginManager = await PluginManagerV2.getInstance();
    const autoFixEngine = new AutoFixEngine(pluginManager);

    requestLogger.info({ agentId }, 'Starting auto-fix validation');

    // 5. Run auto-fix
    const result = await autoFixEngine.validateAndAutoFix(agent);

    requestLogger.info({
      agentId,
      success: result.success,
      fixesApplied: result.fixesApplied.length,
      unfixableIssues: result.unfixableIssues?.length || 0
    }, 'Auto-fix completed');

    // 6. If fixes were applied, update agent in database
    if (result.success && result.finalAgent) {
      const updateResult = await agentRepository.update(
        agentId,
        user.id,
        {
          pilot_steps: result.finalAgent.pilot_steps,
          agent_workflow: result.finalAgent.agent_workflow
        }
      );

      if (updateResult.error) {
        requestLogger.error({
          err: updateResult.error,
          agentId
        }, 'Failed to save auto-fixed agent');

        return NextResponse.json({
          success: false,
          error: 'Failed to save auto-fixes',
          details: process.env.NODE_ENV === 'development' ? updateResult.error.message : undefined
        }, { status: 500 });
      }

      requestLogger.info({ agentId }, 'Auto-fixed agent saved successfully');
    }

    // 7. Return result
    return NextResponse.json({
      success: result.success,
      fixesApplied: result.fixesApplied,
      unfixableIssues: result.unfixableIssues || [],
      finalAgent: result.finalAgent,
      partialAgent: result.partialAgent,
      message: result.message
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
    }, 'Auto-fix request failed');

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to auto-fix workflow',
        message: error.message,
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      },
      { status: 500 }
    );
  }
}
