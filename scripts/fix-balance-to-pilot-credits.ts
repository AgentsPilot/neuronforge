// scripts/fix-balance-to-pilot-credits.ts
// Fix balance from tokens to Pilot Credits

import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

async function fixBalanceToPilotCredits() {
  const userEmail = 'offir.omer@gmail.com';

  const { data: authData } = await supabaseAdmin.auth.admin.listUsers();
  const user = authData.users.find(u => u.email === userEmail);

  if (!user) {
    console.error('❌ User not found');
    return;
  }

  const userId = user.id;
  console.log('👤 User ID:', userId);

  // Get current balance (stored as tokens)
  const { data: userSub } = await supabaseAdmin
    .from('user_subscriptions')
    .select('balance, total_earned, total_spent')
    .eq('user_id', userId)
    .single();

  console.log('\n📊 Current State (stored as tokens):');
  console.log('Balance:', userSub?.balance, 'tokens');
  console.log('Total earned:', userSub?.total_earned, 'tokens');
  console.log('Total spent:', userSub?.total_spent, 'tokens');

  // Convert from tokens to Pilot Credits (divide by 10)
  const balanceInCredits = Math.floor((userSub?.balance || 0) / 10);
  const earnedInCredits = Math.floor((userSub?.total_earned || 0) / 10);
  const spentInCredits = Math.floor((userSub?.total_spent || 0) / 10);

  console.log('\n✅ Correct State (should be Pilot Credits):');
  console.log('Balance:', balanceInCredits, 'Pilot Credits');
  console.log('Total earned:', earnedInCredits, 'Pilot Credits');
  console.log('Total spent:', spentInCredits, 'Pilot Credits');

  // Update balance to Pilot Credits
  const { error: updateError } = await supabaseAdmin
    .from('user_subscriptions')
    .update({
      balance: balanceInCredits,
      total_earned: earnedInCredits,
      total_spent: spentInCredits
    })
    .eq('user_id', userId);

  if (updateError) {
    console.error('❌ Error updating balance:', updateError);
    return;
  }

  console.log('\n✅ Balance converted to Pilot Credits!');

  // Fix all transactions
  const { data: transactions } = await supabaseAdmin
    .from('credit_transactions')
    .select('*')
    .eq('user_id', userId);

  console.log('\n📝 Fixing', transactions?.length, 'transactions...');

  for (const tx of transactions || []) {
    const newDelta = Math.floor(tx.credits_delta / 10);
    const newBefore = Math.floor(tx.balance_before / 10);
    const newAfter = Math.floor(tx.balance_after / 10);

    console.log(`- ${tx.activity_type}: ${tx.credits_delta} → ${newDelta} Pilot Credits`);

    await supabaseAdmin
      .from('credit_transactions')
      .update({
        credits_delta: newDelta,
        balance_before: newBefore,
        balance_after: newAfter
      })
      .eq('id', tx.id);
  }

  // Verify final state
  const { data: updatedSub } = await supabaseAdmin
    .from('user_subscriptions')
    .select('balance, total_earned, total_spent')
    .eq('user_id', userId)
    .single();

  console.log('\n📊 Final State (Pilot Credits):');
  console.log('Balance:', updatedSub?.balance, 'Pilot Credits');
  console.log('Total earned:', updatedSub?.total_earned, 'Pilot Credits');
  console.log('Total spent:', updatedSub?.total_spent, 'Pilot Credits');
}

fixBalanceToPilotCredits().then(() => {
  console.log('\n✅ Done!');
  process.exit(0);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
