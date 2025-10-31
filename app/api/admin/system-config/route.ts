import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { SystemConfigService } from '@/lib/services/SystemConfigService';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // Use service role for admin access
);

/**
 * GET /api/admin/system-config
 * Fetch all system configuration settings
 */
export async function GET() {
  try {
    // Fetch all system settings
    const settings = await SystemConfigService.getAll(supabase);

    console.log('[API] Fetched system settings:', settings.length);

    return NextResponse.json({
      success: true,
      data: settings
    });

  } catch (error) {
    console.error('[API] Error fetching system config:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch system configuration'
      },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/admin/system-config
 * Update multiple system configuration settings
 */
export async function PUT(request: NextRequest) {
  try {
    // Parse request body
    const body = await request.json();
    const { updates } = body;

    if (!updates || typeof updates !== 'object') {
      return NextResponse.json(
        { success: false, error: 'Invalid request body. Expected { updates: {...} }' },
        { status: 400 }
      );
    }

    // 🔒 DEPRECATED: routing_min_executions is no longer used
    // Routing now uses min_executions_for_score directly from AIS Config
    if (updates.routing_min_executions !== undefined) {
      console.warn(`⚠️ [System Config] routing_min_executions is deprecated. Routing uses min_executions_for_score from AIS Config instead.`);
    }

    // Update all settings
    await SystemConfigService.setMultiple(supabase, updates);

    console.log(`[API] System config updated:`, Object.keys(updates));

    return NextResponse.json({
      success: true,
      message: 'Configuration updated successfully'
    });

  } catch (error) {
    console.error('[API] Error updating system config:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update system configuration'
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/system-config
 * Create a new system configuration setting
 */
export async function POST(request: NextRequest) {
  try {
    // Parse request body
    const body = await request.json();
    const { key, value, category, description } = body;

    if (!key || value === undefined || !category) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: key, value, category' },
        { status: 400 }
      );
    }

    // Create new setting
    await SystemConfigService.create(supabase, key, value, category, description);

    console.log(`[API] New system config created: ${key}`);

    return NextResponse.json({
      success: true,
      message: 'Configuration created successfully'
    });

  } catch (error) {
    console.error('[API] Error creating system config:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create system configuration'
      },
      { status: 500 }
    );
  }
}
