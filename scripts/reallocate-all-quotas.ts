// Script to re-allocate storage and execution quotas for all users based on database configuration
import { createClient } from '@supabase/supabase-js';
import { QuotaAllocationService } from '../lib/services/QuotaAllocationService';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function reallocateAllQuotas() {
  console.log('🔄 Starting quota re-allocation for all users...\n');

  try {
    // Get all user subscriptions
    const { data: subscriptions, error } = await supabase
      .from('user_subscriptions')
      .select('user_id, total_earned, storage_quota_mb, executions_quota');

    if (error) {
      console.error('❌ Failed to fetch user subscriptions:', error);
      process.exit(1);
    }

    if (!subscriptions || subscriptions.length === 0) {
      console.log('ℹ️  No user subscriptions found');
      process.exit(0);
    }

    console.log(`📊 Found ${subscriptions.length} user subscriptions to process\n`);

    const quotaService = new QuotaAllocationService(supabase);
    let processed = 0;
    let updated = 0;
    let errors = 0;

    for (const subscription of subscriptions) {
      try {
        console.log(`\n👤 Processing user: ${subscription.user_id}`);
        console.log(`   Current: ${subscription.total_earned?.toLocaleString() || 0} LLM tokens`);
        console.log(`   Current Storage: ${subscription.storage_quota_mb} MB`);
        console.log(`   Current Executions: ${subscription.executions_quota ?? 'unlimited'}`);

        const result = await quotaService.allocateQuotasForUser(subscription.user_id);

        if (result.success) {
          const storageChanged = result.storageQuotaMB !== subscription.storage_quota_mb;
          const executionChanged = result.executionQuota !== subscription.executions_quota;

          if (storageChanged || executionChanged) {
            console.log(`   ✅ Updated quotas:`);
            if (storageChanged) {
              console.log(`      Storage: ${subscription.storage_quota_mb} MB → ${result.storageQuotaMB} MB`);
            }
            if (executionChanged) {
              console.log(`      Executions: ${subscription.executions_quota ?? 'unlimited'} → ${result.executionQuota ?? 'unlimited'}`);
            }
            updated++;
          } else {
            console.log(`   ✓ Quotas already correct (no changes needed)`);
          }
          processed++;
        } else {
          console.error(`   ❌ Failed: ${result.error}`);
          errors++;
        }
      } catch (err: any) {
        console.error(`   ❌ Error: ${err.message}`);
        errors++;
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('📊 Re-allocation Summary:');
    console.log('='.repeat(80));
    console.log(`Total subscriptions: ${subscriptions.length}`);
    console.log(`Successfully processed: ${processed}`);
    console.log(`Quotas updated: ${updated}`);
    console.log(`Errors: ${errors}`);
    console.log('='.repeat(80));

    if (errors > 0) {
      console.log('\n⚠️  Some users encountered errors during re-allocation');
      process.exit(1);
    } else {
      console.log('\n✅ Re-allocation completed successfully!');
      process.exit(0);
    }
  } catch (error: any) {
    console.error('\n❌ Fatal error during re-allocation:', error.message);
    process.exit(1);
  }
}

reallocateAllQuotas();
