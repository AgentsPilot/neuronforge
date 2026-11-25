/**
 * Memory Consolidation Cron Endpoint
 *
 * Triggered by Vercel Cron to consolidate low-importance memories.
 * Runs weekly to merge similar memories and reduce database bloat.
 *
 * @see lib/memory/MemoryConsolidationScheduler.ts
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { MemoryConsolidationScheduler } from '@/lib/memory/MemoryConsolidationScheduler';
import { createLogger } from '@/lib/logger';
import { isAuthorizedCronRequest } from '@/lib/cron/cronAuth';

const logger = createLogger({ module: 'MemoryConsolidationCron' });

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes max for consolidation

// Create Supabase client with service role for background job
function createSupabaseClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: {
        get: () => undefined,
        set: () => {},
        remove: () => {},
      },
    }
  );
}

// Cron auth: lib/cron/cronAuth.ts, fail-closed (PROD-1b, A5). This route used
// to run for anyone when CRON_SECRET was unset, and for anyone at all wherever
// NODE_ENV was not 'production'.

export async function GET(request: NextRequest) {
  const correlationId = crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  // Verify cron request
  if (!isAuthorizedCronRequest(request, logger)) {
    requestLogger.warn('Unauthorized cron request attempt');
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    );
  }

  const startTime = Date.now();
  requestLogger.info('Starting memory consolidation cron job');

  try {
    const supabase = createSupabaseClient();
    const scheduler = new MemoryConsolidationScheduler(supabase);

    // Trigger consolidation (uses the existing runConsolidation logic)
    await scheduler.triggerConsolidation();

    const duration = Date.now() - startTime;
    requestLogger.info({ duration }, 'Memory consolidation completed');

    return NextResponse.json({
      success: true,
      message: 'Memory consolidation completed',
      duration_ms: duration,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    requestLogger.error(
      { err: error, duration },
      'Memory consolidation failed'
    );

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration_ms: duration,
      },
      { status: 500 }
    );
  }
}

// POST also supported for manual triggering via API
export async function POST(request: NextRequest) {
  return GET(request);
}
