import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { pilotCreditsToTokens } from '@/lib/utils/pricingConfig';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // Use service role for admin access
);

/**
 * POST /api/onboarding/allocate-free-tier
 * Allocate free tier quotas (tokens, storage, executions) to a user after onboarding completion
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId } = body;

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'User ID is required' },
        { status: 400 }
      );
    }

    console.log(`[Free Tier Allocation] Starting allocation for user ${userId}`);

    // 1. Fetch free tier configuration from system_settings_config
    const { data: configData, error: configError } = await supabase
      .from('system_settings_config')
      .select('key, value')
      .in('key', ['free_tier_pilot_tokens', 'free_tier_storage_mb', 'free_tier_executions', 'free_tier_duration_days']);

    if (configError) {
      console.error('[Free Tier Allocation] Failed to fetch config:', configError);
      throw new Error('Failed to fetch free tier configuration');
    }

    const configMap = (configData || []).reduce((acc, { key, value }) => {
      acc[key] = value;
      return acc;
    }, {} as Record<string, any>);

    const free_pilot_tokens = typeof configMap['free_tier_pilot_tokens'] === 'number'
      ? configMap['free_tier_pilot_tokens']
      : parseInt(configMap['free_tier_pilot_tokens'] || '20834');

    const free_storage_mb = typeof configMap['free_tier_storage_mb'] === 'number'
      ? configMap['free_tier_storage_mb']
      : parseInt(configMap['free_tier_storage_mb'] || '1000');

    const free_executions = configMap['free_tier_executions'] === null
      ? null
      : typeof configMap['free_tier_executions'] === 'number'
        ? configMap['free_tier_executions']
        : parseInt(configMap['free_tier_executions'] || '0');

    const free_tier_duration_days = typeof configMap['free_tier_duration_days'] === 'number'
      ? configMap['free_tier_duration_days']
      : parseInt(configMap['free_tier_duration_days'] || '30');

    console.log('[Free Tier Allocation] Configuration loaded:', {
      free_pilot_tokens,
      free_storage_mb,
      free_executions,
      free_tier_duration_days
    });

    // 2. Convert Pilot Tokens to LLM tokens using database config
    const raw_tokens = await pilotCreditsToTokens(free_pilot_tokens, supabase);

    // 2.5. Calculate expiration dates for free tier tracking
    const now = new Date();
    const expiresAt = new Date(now.getTime() + free_tier_duration_days * 24 * 60 * 60 * 1000);

    // 3. Check if user_subscriptions record exists
    const { data: existingSubscription, error: fetchError } = await supabase
      .from('user_subscriptions')
      .select('user_id, balance, storage_quota_mb, executions_quota')
      .eq('user_id', userId)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') { // PGRST116 = no rows returned
      console.error('[Free Tier Allocation] Failed to fetch subscription:', fetchError);
      throw new Error('Failed to fetch user subscription');
    }

    // 4. Create or update user_subscriptions
    if (existingSubscription) {
      // User already has a subscription - add to existing balance
      console.log('[Free Tier Allocation] User has existing subscription, adding to balance');

      const { error: updateError } = await supabase
        .from('user_subscriptions')
        .update({
          balance: (existingSubscription.balance || 0) + raw_tokens,
          total_earned: raw_tokens, // Track that these were earned (free tier)
          storage_quota_mb: free_storage_mb,
          executions_quota: free_executions,
          free_tier_granted_at: now.toISOString(),
          free_tier_expires_at: expiresAt.toISOString(),
          free_tier_initial_amount: raw_tokens,
          account_frozen: false,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId);

      if (updateError) {
        console.error('[Free Tier Allocation] Failed to update subscription:', updateError);
        throw new Error('Failed to update user subscription');
      }

      console.log('[Free Tier Allocation] Successfully updated existing subscription');
    } else {
      // Create new subscription with free tier quotas
      console.log('[Free Tier Allocation] Creating new subscription with free tier quotas');

      const { error: insertError } = await supabase
        .from('user_subscriptions')
        .insert({
          user_id: userId,
          balance: raw_tokens,
          total_earned: raw_tokens, // Track that these were earned (free tier)
          storage_quota_mb: free_storage_mb,
          storage_used_mb: 0,
          executions_quota: free_executions,
          executions_used: 0,
          status: 'active', // Must be 'active' to pass check constraint
          free_tier_granted_at: now.toISOString(),
          free_tier_expires_at: expiresAt.toISOString(),
          free_tier_initial_amount: raw_tokens,
          account_frozen: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

      if (insertError) {
        console.error('[Free Tier Allocation] Failed to create subscription:', insertError);
        throw new Error('Failed to create user subscription');
      }

      console.log('[Free Tier Allocation] Successfully created new subscription');
    }

    // 5. Log allocation to audit trail
    try {
      await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL?.replace('/rest/v1', '')}/api/audit/log`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId
        },
        body: JSON.stringify({
          action: 'FREE_TIER_ALLOCATED',
          entityType: 'subscription',
          entityId: userId,
          resourceName: 'Free Tier Quotas',
          details: {
            pilot_tokens: free_pilot_tokens,
            raw_tokens: raw_tokens,
            storage_mb: free_storage_mb,
            executions: free_executions === null ? 'unlimited' : free_executions,
          },
          severity: 'info'
        })
      });
    } catch (auditError) {
      console.error('[Free Tier Allocation] Failed to log to audit trail:', auditError);
      // Don't fail the allocation if audit log fails
    }

    console.log('[Free Tier Allocation] Allocation completed successfully');

    return NextResponse.json({
      success: true,
      allocation: {
        pilot_tokens: free_pilot_tokens,
        raw_tokens: raw_tokens,
        storage_mb: free_storage_mb,
        executions: free_executions,
      },
      message: 'Free tier quotas allocated successfully'
    });

  } catch (error) {
    console.error('[Free Tier Allocation] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to allocate free tier quotas'
      },
      { status: 500 }
    );
  }
}
