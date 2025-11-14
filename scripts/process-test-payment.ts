// scripts/process-test-payment.ts
// Manually process a test payment to award credits

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

async function processTestPayment() {
  // Get your user ID
  const userEmail = 'offir.omer@gmail.com'; // Your email from the subscription

  const { data: authData } = await supabaseAdmin.auth.admin.listUsers();
  const user = authData.users.find(u => u.email === userEmail);

  if (!user) {
    console.error('❌ User not found');
    return;
  }

  const userId = user.id;
  const credits = 10000; // 1,000 Pilot Credits from your subscription

  console.log('👤 User ID:', userId);
  console.log('💰 Credits to award:', credits);

  // Get current balance
  const { data: userSub } = await supabaseAdmin
    .from('user_subscriptions')
    .select('balance, total_earned')
    .eq('user_id', userId)
    .single();

  const currentBalance = userSub?.balance || 0;
  const currentTotalEarned = userSub?.total_earned || 0;
  const newBalance = currentBalance + credits;
  const newTotalEarned = currentTotalEarned + credits;

  console.log('📊 Current balance:', currentBalance);
  console.log('📊 New balance:', newBalance);

  // Update balance
  const { error: updateError } = await supabaseAdmin
    .from('user_subscriptions')
    .update({
      balance: newBalance,
      total_earned: newTotalEarned,
      status: 'active'
    })
    .eq('user_id', userId);

  if (updateError) {
    console.error('❌ Error updating balance:', updateError);
    return;
  }

  // Create credit transaction
  const { error: txError } = await supabaseAdmin
    .from('credit_transactions')
    .insert({
      user_id: userId,
      credits_delta: credits,
      balance_before: currentBalance,
      balance_after: newBalance,
      transaction_type: 'allocation',
      activity_type: 'boost_pack_purchase',
      description: `Test payment: ${credits.toLocaleString()} Pilot Credits`,
      metadata: {
        test_payment: true,
        processed_at: new Date().toISOString()
      }
    });

  if (txError) {
    console.error('❌ Error creating transaction:', txError);
    return;
  }

  console.log('✅ Credits awarded successfully!');
  console.log('✅ New balance:', newBalance);
}

processTestPayment().then(() => {
  console.log('Done!');
  process.exit(0);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
