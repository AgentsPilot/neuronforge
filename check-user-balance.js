// Check user balance and verify it's being deducted
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkBalance() {
  // Get subscriptions directly
  const { data: subscriptions } = await supabase
    .from('user_subscriptions')
    .select('user_id, balance, total_spent, total_earned, monthly_credits, status')
    .limit(5);

  if (!subscriptions || subscriptions.length === 0) {
    console.log('❌ No subscriptions found');
    return;
  }

  console.log('\n📋 User Subscriptions:');
  subscriptions.forEach((s, i) => {
    console.log(`${i + 1}. User: ${s.user_id}`);
    console.log(`   Balance: ${s.balance} tokens (${Math.floor(s.balance / 10)} Pilot Credits)`);
    console.log(`   Total Spent: ${s.total_spent} tokens (${Math.floor(s.total_spent / 10)} Pilot Credits)`);
    console.log(`   Status: ${s.status}\n`);
  });

  // Check first user's subscription
  const userId = subscriptions[0].user_id;
  const sub = subscriptions[0];
  console.log(`\n🔍 Detailed view for user: ${userId}\n`);

  console.log('💰 Subscription Details:');
  console.log(`   Balance (remaining): ${sub.balance} tokens (${Math.floor(sub.balance / 10)} Pilot Credits)`);
  console.log(`   Total Spent: ${sub.total_spent} tokens (${Math.floor(sub.total_spent / 10)} Pilot Credits)`);
  console.log(`   Total Earned: ${sub.total_earned} tokens`);
  console.log(`   Monthly Credits: ${sub.monthly_credits} Pilot Credits`);
  console.log(`   Status: ${sub.status}`);
  console.log(`\n   📊 Total Original: ${sub.balance + sub.total_spent} tokens (${Math.floor((sub.balance + sub.total_spent) / 10)} Pilot Credits)`);

  // Get recent transactions
  const { data: transactions } = await supabase
    .from('credit_transactions')
    .select('created_at, transaction_type, credits_delta, balance_before, balance_after, description')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(5);

  console.log('\n📜 Recent Transactions:');
  transactions.forEach((t, i) => {
    console.log(`${i + 1}. ${new Date(t.created_at).toLocaleString()}`);
    console.log(`   Type: ${t.transaction_type}, Delta: ${t.credits_delta}, Balance: ${t.balance_before} → ${t.balance_after}`);
    console.log(`   Description: ${t.description}`);
  });
}

checkBalance()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
