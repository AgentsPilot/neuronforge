// Award a test reward of 50 credits
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function awardTestReward() {
  try {
    // Get first user
    const { data: users } = await supabase
      .from('user_subscriptions')
      .select('user_id, balance, total_earned')
      .limit(1);

    if (!users || users.length === 0) {
      console.log('❌ No users found');
      return;
    }

    const userId = users[0].user_id;
    const currentBalance = users[0].balance || 0;
    const currentTotalEarned = users[0].total_earned || 0;

    console.log('\n📊 Current State:');
    console.log('User ID:', userId);
    console.log('Current Balance:', currentBalance);
    console.log('Current Total Earned:', currentTotalEarned);

    // Award 50 reward credits
    const rewardAmount = 50;
    const newBalance = currentBalance + rewardAmount;
    const newTotalEarned = currentTotalEarned + rewardAmount;

    console.log('\n🎁 Awarding Reward:');
    console.log('Reward Amount:', rewardAmount);
    console.log('New Balance:', newBalance);
    console.log('New Total Earned:', newTotalEarned);

    // Update user_subscriptions
    const { error: updateError } = await supabase
      .from('user_subscriptions')
      .update({
        balance: newBalance,
        total_earned: newTotalEarned
      })
      .eq('user_id', userId);

    if (updateError) {
      console.error('❌ Error updating balance:', updateError);
      return;
    }

    // Create credit transaction (using 'credit' type as 'reward' doesn't exist in constraint yet)
    const { error: txError } = await supabase
      .from('credit_transactions')
      .insert({
        user_id: userId,
        credits_delta: rewardAmount,
        balance_before: currentBalance,
        balance_after: newBalance,
        transaction_type: 'credit',
        activity_type: 'reward_credit',
        description: 'Welcome bonus reward',
        metadata: { reward_type: 'welcome_bonus' }
      });

    if (txError) {
      console.error('❌ Error creating transaction:', txError);
      return;
    }

    console.log('\n✅ Successfully awarded 50 reward credits!');
    console.log('New balance:', newBalance);

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

awardTestReward().then(() => process.exit(0));
