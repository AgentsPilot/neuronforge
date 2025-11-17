// scripts/backfill-executions-used.ts
// Backfill executions_used in user_subscriptions from existing workflow_executions

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function backfillExecutionsUsed() {
  console.log('🔄 Starting backfill of executions_used...');

  try {
    // Get all users with subscriptions
    const { data: subscriptions, error: subError } = await supabase
      .from('user_subscriptions')
      .select('user_id');

    if (subError) {
      throw new Error(`Failed to fetch subscriptions: ${subError.message}`);
    }

    if (!subscriptions || subscriptions.length === 0) {
      console.log('⚠️  No subscriptions found');
      return;
    }

    console.log(`📊 Found ${subscriptions.length} user subscriptions`);

    let totalUpdated = 0;
    let totalExecutions = 0;

    // Process each user
    for (const sub of subscriptions) {
      const userId = sub.user_id;

      // Count total workflow executions for this user
      const { count, error: countError } = await supabase
        .from('workflow_executions')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);

      if (countError) {
        console.error(`❌ Error counting executions for user ${userId}:`, countError.message);
        continue;
      }

      const executionCount = count || 0;

      // Update user_subscriptions with the count
      const { error: updateError } = await supabase
        .from('user_subscriptions')
        .update({ executions_used: executionCount })
        .eq('user_id', userId);

      if (updateError) {
        console.error(`❌ Error updating user ${userId}:`, updateError.message);
        continue;
      }

      if (executionCount > 0) {
        console.log(`✅ Updated user ${userId}: ${executionCount} executions`);
        totalUpdated++;
        totalExecutions += executionCount;
      }
    }

    console.log('\n📈 Backfill Summary:');
    console.log(`   Users updated: ${totalUpdated}`);
    console.log(`   Total executions backfilled: ${totalExecutions}`);
    console.log('\n✅ Backfill complete!');

  } catch (error: any) {
    console.error('❌ Backfill failed:', error.message);
    process.exit(1);
  }
}

// Run the backfill
backfillExecutionsUsed()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
