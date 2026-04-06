// Diagnostic script to check balance tracking issue
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function diagnoseBalance() {
  console.log('🔍 Diagnosing balance tracking issue...\n');

  // Get all subscriptions with recent activity
  const { data: subscriptions } = await supabase
    .from('user_subscriptions')
    .select('user_id, balance, total_spent, total_earned, status, agents_paused')
    .order('balance', { ascending: false });

  if (!subscriptions || subscriptions.length === 0) {
    console.error('❌ No subscriptions found');
    return;
  }

  console.log(`Found ${subscriptions.length} user subscriptions\n`);
  const subscription = subscriptions[0]; // Use first subscription
  const userId = subscription.user_id;

  console.log(`👤 Checking user: ${userId}\n`);

  console.log('📊 Current Subscription State:');
  console.log('================================');
  console.log(`Balance (tokens): ${subscription.balance}`);
  console.log(`Balance (Pilot Credits): ${Math.floor(subscription.balance / 10)}`);
  console.log(`Total Spent (tokens): ${subscription.total_spent}`);
  console.log(`Total Spent (Pilot Credits): ${Math.floor(subscription.total_spent / 10)}`);
  console.log(`Total Earned (tokens): ${subscription.total_earned}`);
  console.log(`Status: ${subscription.status}`);
  console.log(`Agents Paused: ${subscription.agents_paused}\n`);

  // Get recent transactions
  const { data: transactions } = await supabase
    .from('credit_transactions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(10);

  console.log('📝 Recent 10 Transactions:');
  console.log('================================');
  transactions?.forEach((tx, i) => {
    console.log(`\n${i + 1}. ${new Date(tx.created_at).toLocaleString()}`);
    console.log(`   Type: ${tx.transaction_type} - ${tx.activity_type}`);
    console.log(`   Credits Delta (tokens): ${tx.credits_delta}`);
    console.log(`   Credits Delta (Pilot Credits): ${Math.floor(Math.abs(tx.credits_delta) / 10)}`);
    console.log(`   Balance Before: ${tx.balance_before} tokens`);
    console.log(`   Balance After: ${tx.balance_after} tokens`);
    console.log(`   Description: ${tx.description}`);
    if (tx.metadata) {
      console.log(`   Metadata:`, JSON.stringify(tx.metadata, null, 2));
    }
  });

  // Calculate expected balance from transactions
  console.log('\n🧮 Balance Verification:');
  console.log('================================');
  const totalDelta = transactions?.reduce((sum, tx) => sum + tx.credits_delta, 0) || 0;
  console.log(`Total delta from last 10 transactions: ${totalDelta} tokens`);

  // Check if balance field is being updated
  console.log('\n⚠️  CRITICAL CHECK:');
  console.log('================================');
  console.log('The issue is likely here:');
  console.log(`- V2 Header displays: user_subscriptions.balance = ${subscription.balance} tokens (${Math.floor(subscription.balance / 10)} Pilot Credits)`);
  console.log(`- Transactions are logged in: credit_transactions table`);
  console.log(`- Spending is tracked in: user_subscriptions.total_spent = ${subscription.total_spent} tokens`);
  console.log('\n❓ Is the BALANCE field being deducted when agents run?');

  // Check the latest transaction's balance_after vs current balance
  if (transactions && transactions.length > 0) {
    const latestTx = transactions[0];
    console.log(`\n📌 Latest transaction balance_after: ${latestTx.balance_after} tokens`);
    console.log(`📌 Current subscription.balance: ${subscription.balance} tokens`);

    if (latestTx.balance_after !== subscription.balance) {
      console.log('\n🚨 MISMATCH DETECTED!');
      console.log('The balance field in user_subscriptions does NOT match the latest transaction!');
      console.log('This means the balance field is NOT being updated when agents run.');
    } else {
      console.log('\n✅ Balance field matches latest transaction');
    }
  }

  // Check run-agent route.ts logic
  console.log('\n🔧 Fix Required:');
  console.log('================================');
  console.log('In /app/api/run-agent/route.ts around line 485:');
  console.log('Current code only updates total_spent:');
  console.log('  .update({ total_spent: newTotalSpent })');
  console.log('\nShould also update balance:');
  console.log('  .update({ ');
  console.log('    balance: currentBalance - adjustedTokens,');
  console.log('    total_spent: newTotalSpent ');
  console.log('  })');
}

diagnoseBalance().catch(console.error);
