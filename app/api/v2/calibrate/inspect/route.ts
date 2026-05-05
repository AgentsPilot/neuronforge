// app/api/v2/calibrate/inspect/route.ts
// DEPRECATED: This endpoint has been replaced by /api/v2/calibrate/batch
// Kept for backward compatibility

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'InspectAPI', service: 'calibration' });

export const dynamic = 'force-dynamic';

/**
 * POST /api/v2/calibrate/inspect
 * DEPRECATED - Use /api/v2/calibrate/batch instead
 */
export async function POST(request: NextRequest) {
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

    const body = await request.json();
    const agentId = body.agentId;

    requestLogger.warn({ agentId, userId: user.id }, 'DEPRECATED: inspect endpoint called - use /api/v2/calibrate/batch instead');

    return NextResponse.json({
      success: false,
      error: 'This endpoint is deprecated',
      message: 'Please use /api/v2/calibrate/batch for calibration',
      redirectTo: '/api/v2/calibrate/batch'
    }, { status: 410 });

  } catch (error: any) {
    requestLogger.error({ err: error }, 'Inspect request failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Endpoint deprecated',
        message: 'Use /api/v2/calibrate/batch instead'
      },
      { status: 410 }
    );
  }
}
