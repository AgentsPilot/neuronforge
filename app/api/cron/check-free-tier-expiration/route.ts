import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // Use service role for admin access
);

/**
 * GET /api/cron/check-free-tier-expiration
 * Daily cron job to check for expired free tier accounts and freeze them
 *
 * This should be called by a scheduled task (e.g., Vercel Cron, GitHub Actions)
 * Authorization: Bearer token in CRON_SECRET environment variable
 */
export async function GET(request: NextRequest) {
  try {
    // Verify cron secret for security
    const authHeader = request.headers.get('authorization');
    const expectedAuth = `Bearer ${process.env.CRON_SECRET}`;

    if (authHeader !== expectedAuth) {
      console.error('[Free Tier Expiration] Unauthorized cron request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[Free Tier Expiration] Starting expiration check...');

    const now = new Date().toISOString();

    // Find users with expired free tier who never purchased tokens
    // Logic: free_tier_expires_at < now AND balance == total_earned (never bought)
    const { data: expiredUsers, error: fetchError } = await supabase
      .from('user_subscriptions')
      .select('user_id, balance, total_earned, free_tier_expires_at, free_tier_initial_amount, account_frozen')
      .not('free_tier_expires_at', 'is', null)
      .lt('free_tier_expires_at', now)
      .eq('account_frozen', false)
      .gt('balance', 0);

    if (fetchError) {
      console.error('[Free Tier Expiration] Error fetching expired users:', fetchError);
      throw new Error('Failed to fetch expired users');
    }

    if (!expiredUsers || expiredUsers.length === 0) {
      console.log('[Free Tier Expiration] No expired free tier accounts found');
      return NextResponse.json({
        success: true,
        message: 'No expired accounts to process',
        expired_count: 0
      });
    }

    // Filter to only users who never purchased (balance == total_earned)
    const usersToFreeze = expiredUsers.filter(
      user => user.balance === user.total_earned
    );

    if (usersToFreeze.length === 0) {
      console.log('[Free Tier Expiration] Found expired accounts, but all have purchased tokens');
      return NextResponse.json({
        success: true,
        message: 'All expired users have purchased tokens',
        expired_count: 0
      });
    }

    console.log(`[Free Tier Expiration] Found ${usersToFreeze.length} accounts to freeze`);

    // Freeze each account
    const freezeResults = await Promise.allSettled(
      usersToFreeze.map(async (user) => {
        // Set balance to 0 and freeze account
        const { error: updateError } = await supabase
          .from('user_subscriptions')
          .update({
            balance: 0,
            account_frozen: true,
            free_tier_expires_at: null, // Clear expiration date (already processed)
            updated_at: new Date().toISOString()
          })
          .eq('user_id', user.user_id);

        if (updateError) {
          console.error(`[Free Tier Expiration] Failed to freeze user ${user.user_id}:`, updateError);
          throw updateError;
        }

        console.log(`[Free Tier Expiration] Froze account for user ${user.user_id}, cleared ${user.balance} tokens`);

        // TODO: Send expiration email to user
        // await sendExpirationEmail(user.user_id, user.balance);

        return { user_id: user.user_id, tokens_cleared: user.balance };
      })
    );

    const successful = freezeResults.filter(r => r.status === 'fulfilled').length;
    const failed = freezeResults.filter(r => r.status === 'rejected').length;

    console.log(`[Free Tier Expiration] Completed: ${successful} successful, ${failed} failed`);

    return NextResponse.json({
      success: true,
      message: `Processed ${usersToFreeze.length} expired accounts`,
      expired_count: usersToFreeze.length,
      successful,
      failed,
      details: freezeResults.map((r, i) => ({
        user_id: usersToFreeze[i].user_id,
        status: r.status,
        result: r.status === 'fulfilled' ? r.value : (r.reason?.message || 'Unknown error')
      }))
    });

  } catch (error) {
    console.error('[Free Tier Expiration] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to check free tier expiration'
      },
      { status: 500 }
    );
  }
}
