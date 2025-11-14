// scripts/fix-transactions.ts
// Remove the duplicate test payment transaction

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

async function fixTransactions() {
  const userEmail = 'offir.omer@gmail.com';

  const { data: authData } = await supabaseAdmin.auth.admin.listUsers();
  const user = authData.users.find(u => u.email === userEmail);

  if (!user) {
    console.error('❌ User not found');
    return;
  }

  const userId = user.id;
  console.log('👤 User ID:', userId);

  // Get all transactions
  const { data: transactions } = await supabaseAdmin
    .from('credit_transactions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  console.log('\n📊 Current transactions:');
  transactions?.forEach((tx, i) => {
    console.log(`${i + 1}. ${tx.created_at} - ${tx.activity_type} - Delta: ${tx.credits_delta} - Balance: ${tx.balance_before} → ${tx.balance_after}`);
  });

  // Find the test payment transaction (the one with "Test payment" description)
  const testTx = transactions?.find(tx =>
    tx.description?.includes('Test payment') && tx.activity_type === 'boost_pack_purchase'
  );

  if (testTx) {
    console.log('\n🗑️  Found test payment transaction to remove:');
    console.log('   ID:', testTx.id);
    console.log('   Description:', testTx.description);
    console.log('   Credits delta:', testTx.credits_delta);
    console.log('   Balance before:', testTx.balance_before);
    console.log('   Balance after:', testTx.balance_after);

    // Delete it
    const { error } = await supabaseAdmin
      .from('credit_transactions')
      .delete()
      .eq('id', testTx.id);

    if (error) {
      console.error('❌ Error deleting transaction:', error);
      return;
    }

    console.log('✅ Test transaction deleted');
  } else {
    console.log('\n⚠️  No test payment transaction found');
  }

  // Check remaining transactions
  const { data: remainingTxs } = await supabaseAdmin
    .from('credit_transactions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  console.log('\n📊 Remaining transactions:');
  let calculatedBalance = 0;
  remainingTxs?.forEach((tx, i) => {
    calculatedBalance += tx.credits_delta;
    console.log(`${i + 1}. ${tx.activity_type} - Delta: ${tx.credits_delta} - Calculated balance: ${calculatedBalance}`);
  });

  // Get current balance
  const { data: userSub } = await supabaseAdmin
    .from('user_subscriptions')
    .select('balance, total_earned')
    .eq('user_id', userId)
    .single();

  console.log('\n📊 Final State:');
  console.log('Calculated from transactions:', calculatedBalance, 'tokens =', calculatedBalance / 10, 'Pilot Credits');
  console.log('Actual in user_subscriptions:', userSub?.balance, 'tokens =', (userSub?.balance || 0) / 10, 'Pilot Credits');

  if (calculatedBalance !== userSub?.balance) {
    console.log('\n⚠️  Balances still don\'t match. Expected:', calculatedBalance, 'but have:', userSub?.balance);
  } else {
    console.log('\n✅ All balances match!');
  }
}

fixTransactions().then(() => {
  console.log('\n✅ Done!');
  process.exit(0);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
