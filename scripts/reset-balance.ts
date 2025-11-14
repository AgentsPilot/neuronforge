// scripts/reset-balance.ts
// Reset user balance to correct amount (remove duplicate test payment)

import { createClient } from '@supabase/supabase-js';

// Create admin Supabase client (bypasses RLS)
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

async function resetBalance() {
  const userEmail = 'offir.omer@gmail.com';

  // Get user ID
  const { data: authData } = await supabaseAdmin.auth.admin.listUsers();
  const user = authData.users.find(u => u.email === userEmail);

  if (!user) {
    console.error('❌ User not found');
    return;
  }

  const userId = user.id;
  console.log('👤 User ID:', userId);

  // Get current balance
  const { data: userSub } = await supabaseAdmin
    .from('user_subscriptions')
    .select('balance, total_earned')
    .eq('user_id', userId)
    .single();

  console.log('📊 Current balance (tokens):', userSub?.balance);
  console.log('📊 Current balance (Pilot Credits):', (userSub?.balance || 0) / 10);

  // Correct balance should be:
  // - 500 tokens (50 Pilot Credits) initial reward
  // - 10,000 tokens (1,000 Pilot Credits) from one purchase
  // Total: 10,500 tokens (1,050 Pilot Credits)
  const correctBalance = 10500;
  const correctTotalEarned = 10500;

  console.log('🎯 Setting balance to:', correctBalance, 'tokens');
  console.log('🎯 Which equals:', correctBalance / 10, 'Pilot Credits');

  // Update balance
  const { error: updateError } = await supabaseAdmin
    .from('user_subscriptions')
    .update({
      balance: correctBalance,
      total_earned: correctTotalEarned
    })
    .eq('user_id', userId);

  if (updateError) {
    console.error('❌ Error updating balance:', updateError);
    return;
  }

  // Get all test payment transactions
  const { data: transactions } = await supabaseAdmin
    .from('credit_transactions')
    .select('*')
    .eq('user_id', userId)
    .eq('activity_type', 'boost_pack_purchase')
    .order('created_at', { ascending: false });

  console.log('\n📝 Test payment transactions found:', transactions?.length);

  if (transactions && transactions.length > 1) {
    // Delete the duplicate (most recent) test transaction
    const duplicateId = transactions[0].id;
    console.log('🗑️  Removing duplicate transaction:', duplicateId);

    const { error: deleteError } = await supabaseAdmin
      .from('credit_transactions')
      .delete()
      .eq('id', duplicateId);

    if (deleteError) {
      console.error('❌ Error deleting duplicate transaction:', deleteError);
      return;
    }

    console.log('✅ Duplicate transaction removed');
  }

  // Verify new balance
  const { data: updatedSub } = await supabaseAdmin
    .from('user_subscriptions')
    .select('balance, total_earned')
    .eq('user_id', userId)
    .single();

  console.log('\n✅ Balance reset successfully!');
  console.log('📊 New balance (tokens):', updatedSub?.balance);
  console.log('📊 New balance (Pilot Credits):', (updatedSub?.balance || 0) / 10);
  console.log('📊 Total earned (tokens):', updatedSub?.total_earned);
  console.log('📊 Total earned (Pilot Credits):', (updatedSub?.total_earned || 0) / 10);
}

resetBalance().then(() => {
  console.log('\n✅ Done!');
  process.exit(0);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
