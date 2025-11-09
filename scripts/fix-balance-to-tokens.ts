// scripts/fix-balance-to-tokens.ts
// Fix balance from Pilot Credits back to tokens (correct architecture)

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

async function fixBalanceToTokens() {
  const userEmail = 'offir.omer@gmail.com';

  const { data: authData } = await supabaseAdmin.auth.admin.listUsers();
  const user = authData.users.find(u => u.email === userEmail);

  if (!user) {
    console.error('❌ User not found');
    return;
  }

  const userId = user.id;
  console.log('👤 User ID:', userId);

  // Get current balance (stored as Pilot Credits)
  const { data: userSub } = await supabaseAdmin
    .from('user_subscriptions')
    .select('balance, total_earned, total_spent')
    .eq('user_id', userId)
    .single();

  console.log('\n📊 Current State (stored as Pilot Credits):');
  console.log('Balance:', userSub?.balance, 'Pilot Credits');
  console.log('Total earned:', userSub?.total_earned, 'Pilot Credits');
  console.log('Total spent:', userSub?.total_spent, 'Pilot Credits');

  // Convert from Pilot Credits to tokens (multiply by 10)
  const balanceInTokens = (userSub?.balance || 0) * 10;
  const earnedInTokens = (userSub?.total_earned || 0) * 10;
  const spentInTokens = (userSub?.total_spent || 0) * 10;

  console.log('\n✅ Correct State (should be tokens):');
  console.log('Balance:', balanceInTokens, 'tokens =', balanceInTokens / 10, 'Pilot Credits');
  console.log('Total earned:', earnedInTokens, 'tokens =', earnedInTokens / 10, 'Pilot Credits');
  console.log('Total spent:', spentInTokens, 'tokens =', spentInTokens / 10, 'Pilot Credits');

  // Update balance to tokens
  const { error: updateError } = await supabaseAdmin
    .from('user_subscriptions')
    .update({
      balance: balanceInTokens,
      total_earned: earnedInTokens,
      total_spent: spentInTokens
    })
    .eq('user_id', userId);

  if (updateError) {
    console.error('❌ Error updating balance:', updateError);
    return;
  }

  console.log('\n✅ Balance converted to tokens!');

  // Fix all transactions
  const { data: transactions } = await supabaseAdmin
    .from('credit_transactions')
    .select('*')
    .eq('user_id', userId);

  console.log('\n📝 Fixing', transactions?.length, 'transactions...');

  for (const tx of transactions || []) {
    const newDelta = tx.credits_delta * 10;
    const newBefore = tx.balance_before * 10;
    const newAfter = tx.balance_after * 10;

    console.log(`- ${tx.activity_type}: ${tx.credits_delta} → ${newDelta} tokens (${newDelta / 10} Pilot Credits)`);

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

  console.log('\n📊 Final State:');
  console.log('Balance:', updatedSub?.balance, 'tokens =', (updatedSub?.balance || 0) / 10, 'Pilot Credits');
  console.log('Total earned:', updatedSub?.total_earned, 'tokens =', (updatedSub?.total_earned || 0) / 10, 'Pilot Credits');
  console.log('Total spent:', updatedSub?.total_spent, 'tokens =', (updatedSub?.total_spent || 0) / 10, 'Pilot Credits');
}

fixBalanceToTokens().then(() => {
  console.log('\n✅ Done!');
  process.exit(0);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
