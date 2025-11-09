// scripts/check-transactions.ts
// Check all credit transactions for a user

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

async function checkTransactions() {
  const userEmail = 'offir.omer@gmail.com';

  const { data: authData } = await supabaseAdmin.auth.admin.listUsers();
  const user = authData.users.find(u => u.email === userEmail);

  if (!user) {
    console.error('❌ User not found');
    return;
  }

  const userId = user.id;
  console.log('👤 User ID:', userId);
  console.log('\n📊 Credit Transactions:\n');

  // Get all transactions
  const { data: transactions, error } = await supabaseAdmin
    .from('credit_transactions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('❌ Error fetching transactions:', error);
    return;
  }

  if (!transactions || transactions.length === 0) {
    console.log('No transactions found');
    return;
  }

  // Display transactions in a table format
  console.log('┌──────────────────────────┬────────────┬───────────────┬──────────────┬────────────────┬──────────────────────────────────────┐');
  console.log('│ Created At               │ Delta      │ Before        │ After        │ Type           │ Description                          │');
  console.log('├──────────────────────────┼────────────┼───────────────┼──────────────┼────────────────┼──────────────────────────────────────┤');

  let expectedBalance = 0;
  for (const tx of transactions) {
    const date = new Date(tx.created_at).toISOString().slice(0, 19).replace('T', ' ');
    const delta = tx.credits_delta.toString().padStart(10);
    const before = tx.balance_before.toString().padStart(13);
    const after = tx.balance_after.toString().padStart(12);
    const type = tx.activity_type.padEnd(14).slice(0, 14);
    const desc = (tx.description || '').padEnd(36).slice(0, 36);

    console.log(`│ ${date} │ ${delta} │ ${before} │ ${after} │ ${type} │ ${desc} │`);

    // Calculate expected balance
    expectedBalance = tx.balance_after;
  }

  console.log('└──────────────────────────┴────────────┴───────────────┴──────────────┴────────────────┴──────────────────────────────────────┘');

  // Get current balance
  const { data: userSub } = await supabaseAdmin
    .from('user_subscriptions')
    .select('balance, total_earned')
    .eq('user_id', userId)
    .single();

  console.log('\n📊 Summary:');
  console.log('Total transactions:', transactions.length);
  console.log('Expected balance from transactions:', expectedBalance, 'tokens =', expectedBalance / 10, 'Pilot Credits');
  console.log('Actual balance in user_subscriptions:', userSub?.balance, 'tokens =', (userSub?.balance || 0) / 10, 'Pilot Credits');
  console.log('Total earned:', userSub?.total_earned, 'tokens =', (userSub?.total_earned || 0) / 10, 'Pilot Credits');

  if (expectedBalance !== userSub?.balance) {
    console.log('\n⚠️  WARNING: Balance mismatch!');
  } else {
    console.log('\n✅ Balance matches transaction history');
  }
}

checkTransactions().then(() => {
  console.log('\n✅ Done!');
  process.exit(0);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
