import { createClient } from '@supabase/supabase-js';
import { createAuthenticatedServerClient } from '@/lib/supabaseServer';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // Use service role for admin access
);

/**
 * GET /api/onboarding/get-allocation
 * Get the allocated free tier quotas for the current user
 */
export async function GET(request: NextRequest) {
  try {
    console.log('[Get Allocation] Request received');

    // Get user from session using cookies
    const supabase = await createAuthenticatedServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    console.log('[Get Allocation] Auth result:', { user: user?.id, authError: authError?.message });

    if (authError || !user) {
      console.error('[Get Allocation] Authentication failed:', authError);
      return NextResponse.json(
        { success: false, error: 'Unauthorized', details: authError?.message },
        { status: 401 }
      );
    }

    // Fetch user subscription using admin client
    const { data: subscription, error: subError } = await supabaseAdmin
      .from('user_subscriptions')
      .select('balance, total_spent, storage_quota_mb, storage_used_mb, executions_quota, executions_used, free_tier_granted_at, free_tier_expires_at, free_tier_initial_amount, account_frozen')
      .eq('user_id', user.id)
      .single();

    if (subError) {
      console.error('[Get Allocation] Error fetching subscription:', subError);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch allocation' },
        { status: 500 }
      );
    }

    if (!subscription) {
      return NextResponse.json({
        success: true,
        allocation: {
          pilot_tokens: 0,
          raw_tokens: 0,
          tokens_used: 0,
          storage_mb: 0,
          storage_used_mb: 0,
          executions: 0,
          executions_used: 0,
        }
      });
    }

    // Convert raw tokens back to pilot tokens for display
    const pilot_tokens = Math.floor((subscription.balance || 0) / 10);
    const tokens_used = Math.floor((subscription.total_spent || 0) / 10); // Convert spent tokens to Pilot Tokens

    return NextResponse.json({
      success: true,
      allocation: {
        pilot_tokens: pilot_tokens,
        raw_tokens: subscription.balance || 0,
        tokens_used: tokens_used,
        storage_mb: subscription.storage_quota_mb || 0,
        storage_used_mb: subscription.storage_used_mb || 0,
        executions: subscription.executions_quota,
        executions_used: subscription.executions_used || 0,
        free_tier_granted_at: subscription.free_tier_granted_at,
        free_tier_expires_at: subscription.free_tier_expires_at,
        free_tier_initial_amount: subscription.free_tier_initial_amount,
        account_frozen: subscription.account_frozen || false,
      }
    });

  } catch (error) {
    console.error('[Get Allocation] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get allocation'
      },
      { status: 500 }
    );
  }
}
