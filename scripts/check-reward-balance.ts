// Check reward credits and balance
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkRewardBalance() {
  try {
    // Get first user for testing
    const { data: users } = await supabase
      .from('user_subscriptions')
      .select('user_id, balance, total_earned, total_spent')
      .limit(1);

    if (!users || users.length === 0) {
      console.log('❌ No users found');
      return;
    }

    const user = users[0];
    console.log('\n📊 Current User Balance:');
    console.log('User ID:', user.user_id);
    console.log('Balance:', user.balance);
    console.log('Total Earned:', user.total_earned);
    console.log('Total Spent:', user.total_spent);

    // Get reward transactions (by activity_type, not transaction_type)
    const { data: rewardTx } = await supabase
      .from('credit_transactions')
      .select('*')
      .eq('user_id', user.user_id)
      .eq('activity_type', 'reward_credit');

    console.log('\n🎁 Reward Transactions:');
    if (rewardTx && rewardTx.length > 0) {
      const totalRewards = rewardTx.reduce((sum, tx) => sum + tx.credits_delta, 0);
      console.log(`Found ${rewardTx.length} reward transaction(s)`);
      console.log('Total reward credits:', totalRewards);

      rewardTx.forEach((tx, i) => {
        console.log(`\n  ${i + 1}. ${tx.description || 'Reward'}`);
        console.log(`     Credits: ${tx.credits_delta}`);
        console.log(`     Date: ${new Date(tx.created_at).toLocaleString()}`);
        console.log(`     Balance before: ${tx.balance_before}`);
        console.log(`     Balance after: ${tx.balance_after}`);
      });
    } else {
      console.log('No reward transactions found');
    }

    // Get all transactions to see balance changes
    const { data: allTx } = await supabase
      .from('credit_transactions')
      .select('transaction_type, credits_delta, balance_after, created_at')
      .eq('user_id', user.user_id)
      .order('created_at', { ascending: false })
      .limit(10);

    console.log('\n📜 Recent Transactions (last 10):');
    allTx?.forEach((tx, i) => {
      const sign = tx.credits_delta > 0 ? '+' : '';
      console.log(`  ${i + 1}. [${tx.transaction_type}] ${sign}${tx.credits_delta} → Balance: ${tx.balance_after}`);
    });

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

checkRewardBalance().then(() => process.exit(0));
