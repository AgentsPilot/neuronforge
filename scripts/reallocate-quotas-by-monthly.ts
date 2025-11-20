// Script to re-allocate quotas based on monthly_credits instead of total_earned
import { createClient } from '@supabase/supabase-js';
import { QuotaAllocationService } from '../lib/services/QuotaAllocationService';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function reallocateQuotas() {
  const userId = 'fdf275b1-17be-41d2-b206-45e62b578260';

  console.log('🔄 Re-allocating quotas based on monthly subscription tier...\n');

  // Check current state
  const { data: before } = await supabase
    .from('user_subscriptions')
    .select('monthly_credits, storage_quota_mb, executions_quota')
    .eq('user_id', userId)
    .single();

  if (!before) {
    console.error('❌ User not found');
    process.exit(1);
  }

  console.log('Before:');
  console.log(`  monthly_credits: ${before.monthly_credits} Pilot Credits (${before.monthly_credits! * 10} LLM tokens)`);
  console.log(`  storage_quota_mb: ${before.storage_quota_mb} MB`);
  console.log(`  executions_quota: ${before.executions_quota}`);
  console.log();

  // Re-allocate
  const quotaService = new QuotaAllocationService(supabase);
  const result = await quotaService.allocateQuotasForUser(userId);

  if (!result.success) {
    console.error('❌ Failed:', result.error);
    process.exit(1);
  }

  // Verify
  const { data: after } = await supabase
    .from('user_subscriptions')
    .select('monthly_credits, storage_quota_mb, executions_quota')
    .eq('user_id', userId)
    .single();

  if (!after) {
    console.error('❌ Failed to verify');
    process.exit(1);
  }

  console.log('After:');
  console.log(`  monthly_credits: ${after.monthly_credits} Pilot Credits (${after.monthly_credits! * 10} LLM tokens)`);
  console.log(`  storage_quota_mb: ${after.storage_quota_mb} MB`);
  console.log(`  executions_quota: ${after.executions_quota}`);
  console.log();

  console.log('Changes:');
  console.log(`  Storage: ${before.storage_quota_mb} MB → ${after.storage_quota_mb} MB`);
  console.log(`  Executions: ${before.executions_quota} → ${after.executions_quota}`);
  console.log();
  console.log('✅ Quotas re-allocated successfully!');

  process.exit(0);
}

reallocateQuotas();
