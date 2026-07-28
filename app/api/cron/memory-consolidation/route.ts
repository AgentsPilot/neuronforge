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

/**
 * Verify the request is from Vercel Cron (in production)
 */
function verifyCronRequest(request: NextRequest): boolean {
  // In development, allow all requests
  if (process.env.NODE_ENV !== 'production') {
    return true;
  }

  // Vercel Cron adds this header
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  // If CRON_SECRET is set, verify it
  if (cronSecret) {
    return authHeader === `Bearer ${cronSecret}`;
  }

  // Otherwise, allow (Vercel Cron doesn't require auth by default)
  return true;
}

export async function GET(request: NextRequest) {
  const correlationId = crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  // Verify cron request
  if (!verifyCronRequest(request)) {
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
