// app/api/v2/calibrate/auto-fix/route.ts
// DEPRECATED: This endpoint has been replaced by /api/v2/calibrate/batch
// Kept for backward compatibility - redirects to batch calibration

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'AutoFixAPI', service: 'calibration' });

export const dynamic = 'force-dynamic';

/**
 * POST /api/v2/calibrate/auto-fix
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

    requestLogger.warn({ agentId, userId: user.id }, 'DEPRECATED: auto-fix endpoint called - use /api/v2/calibrate/batch instead');

    return NextResponse.json({
      success: false,
      error: 'This endpoint is deprecated',
      message: 'Please use /api/v2/calibrate/batch for calibration',
      redirectTo: '/api/v2/calibrate/batch'
    }, { status: 410 }); // 410 Gone

  } catch (error: any) {
    requestLogger.error({ err: error }, 'Auto-fix request failed');
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
