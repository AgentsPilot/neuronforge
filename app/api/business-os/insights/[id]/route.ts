/**
 * Business OS Insight Detail API
 *
 * Endpoints for a single insight:
 * - GET: Fetch insight details with projection
 *
 * @see docs/INSIGHT_SYSTEM_PLAN.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { InsightRepository } from '@/lib/business-os/insight/repository';
import { ImpactProjector } from '@/lib/business-os/insight/projection';
import { getProcessForDetector } from '@/lib/business-os/insight/kernel';

const logger = createLogger({ module: 'InsightDetailAPI' });

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, context: RouteParams) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { id } = await context.params;

    const repository = new InsightRepository(supabaseServer);
    const result = await repository.findById(id, user.id);

    if (!result.data) {
      return NextResponse.json(
        { success: false, error: 'Insight not found' },
        { status: 404 }
      );
    }

    const insight = result.data;

    // Get impact projection
    const projector = new ImpactProjector(supabaseServer);
    const projection = await projector.project(insight);

    // Get process details if available
    const process = insight.paired_process_id
      ? getProcessForDetector(insight.detector_id)
      : null;

    // Mark as surfaced
    await repository.markSurfaced(id, user.id);

    requestLogger.info(
      { userId: user.id, insightId: id },
      'Fetched insight detail'
    );

    return NextResponse.json({
      success: true,
      data: {
        insight,
        projection,
        process: process
          ? {
              id: process.processId,
              name: process.processName,
              description: process.description,
              parameters: process.ownerParameters,
              eligibleForAutomation: process.eligibleForAutomation,
              estimatedTimeSaved: process.estimatedTimeSavedMinutes,
            }
          : null,
      },
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to fetch insight detail');

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch insight',
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined,
      },
      { status: 500 }
    );
  }
}
