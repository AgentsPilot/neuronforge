// scripts/create-stripe-transaction.ts
// Create the missing transaction record for the Stripe purchase

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

async function createStripeTransaction() {
  const userEmail = 'offir.omer@gmail.com';

  const { data: authData } = await supabaseAdmin.auth.admin.listUsers();
  const user = authData.users.find(u => u.email === userEmail);

  if (!user) {
    console.error('❌ User not found');
    return;
  }

  const userId = user.id;
  console.log('👤 User ID:', userId);

  // The user purchased 1,000 Pilot Credits = 10,000 tokens
  // Current balance is 10,500 tokens (500 initial + 10,000 from purchase)
  const purchaseCredits = 10000; // 1,000 Pilot Credits in tokens
  const balanceBefore = 500; // After initial reward
  const balanceAfter = 10500; // Current balance

  console.log('\n📝 Creating transaction record for Stripe purchase:');
  console.log('Credits:', purchaseCredits, 'tokens =', purchaseCredits / 10, 'Pilot Credits');
  console.log('Balance before:', balanceBefore, 'tokens');
  console.log('Balance after:', balanceAfter, 'tokens');

  // Create the transaction record
  const { data, error } = await supabaseAdmin
    .from('credit_transactions')
    .insert({
      user_id: userId,
      credits_delta: purchaseCredits,
      balance_before: balanceBefore,
      balance_after: balanceAfter,
      transaction_type: 'allocation',
      activity_type: 'boost_pack_purchase',
      description: 'Subscription purchase: 1,000 Pilot Credits',
      metadata: {
        note: 'Retroactively created transaction for Stripe purchase',
        created_manually: true,
        original_purchase_date: '2025-11-05'
      }
    })
    .select()
    .single();

  if (error) {
    console.error('❌ Error creating transaction:', error);
    return;
  }

  console.log('✅ Transaction created:', data.id);

  // Verify the transaction history now
  const { data: allTxs } = await supabaseAdmin
    .from('credit_transactions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  console.log('\n📊 Complete transaction history:');
  let runningBalance = 0;
  allTxs?.forEach((tx, i) => {
    runningBalance += tx.credits_delta;
    console.log(`${i + 1}. ${tx.activity_type.padEnd(20)} | Delta: ${String(tx.credits_delta).padStart(6)} | Running: ${String(runningBalance).padStart(6)} tokens | ${tx.description}`);
  });

  // Get current balance
  const { data: userSub } = await supabaseAdmin
    .from('user_subscriptions')
    .select('balance, total_earned')
    .eq('user_id', userId)
    .single();

  console.log('\n📊 Final Verification:');
  console.log('Calculated from transactions:', runningBalance, 'tokens =', runningBalance / 10, 'Pilot Credits');
  console.log('Actual in user_subscriptions:', userSub?.balance, 'tokens =', (userSub?.balance || 0) / 10, 'Pilot Credits');

  if (runningBalance === userSub?.balance) {
    console.log('\n✅ Perfect! All balances match!');
  } else {
    console.log('\n⚠️  Warning: Balances don\'t match');
  }
}

createStripeTransaction().then(() => {
  console.log('\n✅ Done!');
  process.exit(0);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
