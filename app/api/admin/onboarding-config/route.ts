import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // Use service role for admin access
);

/**
 * GET /api/admin/onboarding-config
 * Fetch onboarding/free tier configuration
 */
export async function GET() {
  try {
    const { data, error } = await supabase
      .from('system_settings_config')
      .select('key, value')
      .in('key', ['free_tier_pilot_tokens', 'free_tier_storage_mb', 'free_tier_executions', 'free_tier_duration_days']);

    if (error) throw error;

    const configMap = (data || []).reduce((acc, { key, value }) => {
      acc[key] = value;
      return acc;
    }, {} as Record<string, any>);

    const config = {
      free_pilot_tokens: typeof configMap['free_tier_pilot_tokens'] === 'number'
        ? configMap['free_tier_pilot_tokens']
        : parseInt(configMap['free_tier_pilot_tokens'] || '20834'),
      free_storage_mb: typeof configMap['free_tier_storage_mb'] === 'number'
        ? configMap['free_tier_storage_mb']
        : parseInt(configMap['free_tier_storage_mb'] || '1000'),
      free_executions: configMap['free_tier_executions'] === null
        ? null
        : typeof configMap['free_tier_executions'] === 'number'
          ? configMap['free_tier_executions']
          : parseInt(configMap['free_tier_executions'] || '0'),
      free_tier_duration_days: typeof configMap['free_tier_duration_days'] === 'number'
        ? configMap['free_tier_duration_days']
        : parseInt(configMap['free_tier_duration_days'] || '30'),
    };

    return NextResponse.json({
      success: true,
      data: config
    });

  } catch (error) {
    console.error('[API] Error fetching onboarding config:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch onboarding configuration'
      },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/admin/onboarding-config
 * Update onboarding/free tier configuration
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { free_pilot_tokens, free_storage_mb, free_executions, free_tier_duration_days } = body;

    // Validate inputs
    if (typeof free_pilot_tokens !== 'number' || free_pilot_tokens < 0) {
      return NextResponse.json(
        { success: false, error: 'Invalid free_pilot_tokens' },
        { status: 400 }
      );
    }

    if (typeof free_storage_mb !== 'number' || free_storage_mb < 0) {
      return NextResponse.json(
        { success: false, error: 'Invalid free_storage_mb' },
        { status: 400 }
      );
    }

    if (free_executions !== null && (typeof free_executions !== 'number' || free_executions < 0)) {
      return NextResponse.json(
        { success: false, error: 'Invalid free_executions' },
        { status: 400 }
      );
    }

    if (typeof free_tier_duration_days !== 'number' || free_tier_duration_days < 1 || free_tier_duration_days > 365) {
      return NextResponse.json(
        { success: false, error: 'Invalid free_tier_duration_days (must be 1-365)' },
        { status: 400 }
      );
    }

    // Get current admin user (optional - for audit trail)
    const authHeader = request.headers.get('authorization');
    let currentUserId = null;
    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      const { data: { user } } = await supabase.auth.getUser(token);
      currentUserId = user?.id;
    }

    const configEntries = [
      {
        key: 'free_tier_pilot_tokens',
        value: free_pilot_tokens,
        description: 'Number of free Pilot Tokens granted on signup',
        category: 'free_tier',
        updated_by: currentUserId,
      },
      {
        key: 'free_tier_storage_mb',
        value: free_storage_mb,
        description: 'Free storage quota in MB',
        category: 'free_tier',
        updated_by: currentUserId,
      },
      {
        key: 'free_tier_executions',
        value: free_executions,
        description: 'Free execution quota (null = unlimited)',
        category: 'free_tier',
        updated_by: currentUserId,
      },
      {
        key: 'free_tier_duration_days',
        value: free_tier_duration_days,
        description: 'Number of days before free tier expires',
        category: 'free_tier',
        updated_by: currentUserId,
      },
    ];

    const { error } = await supabase
      .from('system_settings_config')
      .upsert(configEntries, { onConflict: 'key' });

    if (error) throw error;

    console.log('[API] Onboarding config updated:', {
      free_pilot_tokens,
      free_storage_mb,
      free_executions,
      free_tier_duration_days
    });

    return NextResponse.json({
      success: true,
      message: 'Onboarding configuration saved successfully'
    });

  } catch (error) {
    console.error('[API] Error updating onboarding config:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update onboarding configuration'
      },
      { status: 500 }
    );
  }
}
