// Script to fix duplicate credits caused by webhook duplication issue
// This corrects the user balance by removing the duplicate subscription_renewal

import { createClient } from '@supabase/supabase-js';
import { QuotaAllocationService } from '../lib/services/QuotaAllocationService';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const AFFECTED_USER_ID = 'fdf275b1-17be-41d2-b206-45e62b578260';
const DUPLICATE_CREDITS = 208330; // Amount to deduct

async function fixDuplicateCredits() {
  console.log('🔧 Starting duplicate credits fix...\n');

  try {
    // 1. Get current user subscription data
    const { data: subscription, error: subError } = await supabase
      .from('user_subscriptions')
      .select('*')
      .eq('user_id', AFFECTED_USER_ID)
      .single();

    if (subError || !subscription) {
      console.error('❌ Failed to fetch user subscription:', subError);
      process.exit(1);
    }

    console.log('📊 Current user state:');
    console.log(`   User ID: ${AFFECTED_USER_ID}`);
    console.log(`   Current total_earned: ${subscription.total_earned?.toLocaleString() || 0} LLM tokens`);
    console.log(`   Current balance: ${subscription.balance?.toLocaleString() || 0} LLM tokens`);
    console.log(`   Current storage: ${subscription.storage_quota_mb} MB`);
    console.log(`   Current executions: ${subscription.executions_quota ?? 'unlimited'}\n`);

    // 2. Calculate corrected values
    const currentTotalEarned = subscription.total_earned || 0;
    const currentBalance = subscription.balance || 0;
    const correctedTotalEarned = currentTotalEarned - DUPLICATE_CREDITS;
    const correctedBalance = currentBalance - DUPLICATE_CREDITS;

    console.log('🎯 Proposed corrections:');
    console.log(`   total_earned: ${currentTotalEarned.toLocaleString()} → ${correctedTotalEarned.toLocaleString()} (-${DUPLICATE_CREDITS.toLocaleString()})`);
    console.log(`   balance: ${currentBalance.toLocaleString()} → ${correctedBalance.toLocaleString()} (-${DUPLICATE_CREDITS.toLocaleString()})\n`);

    // 3. Update user_subscriptions
    console.log('💾 Updating user_subscriptions...');
    const { error: updateError } = await supabase
      .from('user_subscriptions')
      .update({
        total_earned: correctedTotalEarned,
        balance: correctedBalance
      })
      .eq('user_id', AFFECTED_USER_ID);

    if (updateError) {
      console.error('❌ Failed to update user_subscriptions:', updateError);
      process.exit(1);
    }
    console.log('✅ user_subscriptions updated\n');

    // 4. Record the correction in credit_transactions
    console.log('📝 Recording correction in credit_transactions...');
    const { error: txError } = await supabase
      .from('credit_transactions')
      .insert({
        user_id: AFFECTED_USER_ID,
        activity_type: 'reward_credit', // Use reward_credit for manual adjustments
        credits_delta: -DUPLICATE_CREDITS,
        description: `Manual correction: Removed duplicate subscription_renewal credits caused by webhook duplication (deducted ${DUPLICATE_CREDITS.toLocaleString()} LLM tokens)`
      });

    if (txError) {
      console.error('❌ Failed to record transaction:', txError);
      console.log('⚠️  Balance was updated but transaction was not logged');
    } else {
      console.log('✅ Correction logged in credit_transactions\n');
    }

    // 5. Record billing event
    console.log('📋 Recording billing event...');
    const { error: billingError } = await supabase
      .from('billing_events')
      .insert({
        user_id: AFFECTED_USER_ID,
        event_type: 'manual_adjustment',
        credits_delta: -DUPLICATE_CREDITS,
        description: `Removed duplicate credits from webhook duplication issue (-${DUPLICATE_CREDITS.toLocaleString()} LLM tokens)`
      });

    if (billingError) {
      console.error('❌ Failed to record billing event:', billingError);
      console.log('⚠️  Continuing anyway...\n');
    } else {
      console.log('✅ Billing event recorded\n');
    }

    // 6. Re-allocate storage and execution quotas based on corrected balance
    console.log('📊 Re-allocating storage and execution quotas...');
    const quotaService = new QuotaAllocationService(supabase);
    const quotaResult = await quotaService.allocateQuotasForUser(AFFECTED_USER_ID);

    if (quotaResult.success) {
      console.log('✅ Quotas re-allocated:');
      console.log(`   Storage: ${subscription.storage_quota_mb} MB → ${quotaResult.storageQuotaMB} MB`);
      console.log(`   Executions: ${subscription.executions_quota ?? 'unlimited'} → ${quotaResult.executionQuota ?? 'unlimited'}\n`);
    } else {
      console.error('❌ Failed to re-allocate quotas:', quotaResult.error);
      process.exit(1);
    }

    // 7. Summary
    console.log('='.repeat(80));
    console.log('✅ Duplicate Credits Fix Complete!');
    console.log('='.repeat(80));
    console.log('Summary:');
    console.log(`  • Deducted ${DUPLICATE_CREDITS.toLocaleString()} LLM tokens from user balance`);
    console.log(`  • Updated total_earned: ${currentTotalEarned.toLocaleString()} → ${correctedTotalEarned.toLocaleString()}`);
    console.log(`  • Updated balance: ${currentBalance.toLocaleString()} → ${correctedBalance.toLocaleString()}`);
    console.log(`  • New storage quota: ${quotaResult.storageQuotaMB} MB`);
    console.log(`  • New execution quota: ${quotaResult.executionQuota ?? 'unlimited'}`);
    console.log(`  • Logged correction in credit_transactions and billing_events`);
    console.log('='.repeat(80));

    process.exit(0);

  } catch (error: any) {
    console.error('\n❌ Fatal error during correction:', error.message);
    process.exit(1);
  }
}

fixDuplicateCredits();
