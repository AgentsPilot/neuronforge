import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { MemoryConsolidationScheduler } from '@/lib/memory/MemoryConsolidationScheduler';

// Initialize Supabase client with Service Role Key
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Global scheduler instance (singleton)
let globalScheduler: MemoryConsolidationScheduler | null = null;

/**
 * GET /api/admin/memory-consolidation
 * Get consolidation scheduler status
 */
export async function GET() {
  try {

    return NextResponse.json({
      success: true,
      status: {
        running: globalScheduler?.isSchedulerRunning() || false,
        message: globalScheduler?.isSchedulerRunning()
          ? 'Consolidation scheduler is running'
          : 'Consolidation scheduler is stopped'
      }
    });
  } catch (error) {
    console.error('[API] Error getting consolidation status:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get status'
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/memory-consolidation
 * Start/stop/trigger consolidation scheduler
 *
 * Body: { action: 'start' | 'stop' | 'trigger' }
 */
export async function POST(request: Request) {
  try {
    const { action } = await request.json();

    if (!action || !['start', 'stop', 'trigger'].includes(action)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid action. Must be: start, stop, or trigger'
        },
        { status: 400 }
      );
    }

    // Initialize scheduler if needed
    if (!globalScheduler) {
      globalScheduler = new MemoryConsolidationScheduler(supabase);
    }

    switch (action) {
      case 'start':
        if (globalScheduler.isSchedulerRunning()) {
          return NextResponse.json({
            success: false,
            error: 'Scheduler is already running'
          });
        }
        await globalScheduler.start();
        return NextResponse.json({
          success: true,
          message: 'Consolidation scheduler started successfully'
        });

      case 'stop':
        if (!globalScheduler.isSchedulerRunning()) {
          return NextResponse.json({
            success: false,
            error: 'Scheduler is not running'
          });
        }
        globalScheduler.stop();
        return NextResponse.json({
          success: true,
          message: 'Consolidation scheduler stopped successfully'
        });

      case 'trigger':
        await globalScheduler.triggerConsolidation();
        return NextResponse.json({
          success: true,
          message: 'Manual consolidation triggered successfully'
        });

      default:
        return NextResponse.json(
          {
            success: false,
            error: 'Unknown action'
          },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('[API] Error controlling consolidation scheduler:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to control scheduler'
      },
      { status: 500 }
    );
  }
}
