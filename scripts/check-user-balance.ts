// Check user balance and compare with expected total
// Run with: npx tsx scripts/check-user-balance.ts <user-email>

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkBalance(userEmail: string) {
  console.log('\n💰 Checking User Balance\n');
  console.log('='.repeat(60));

  try {
    // Get user
    const { data: { users }, error: authError } = await supabase.auth.admin.listUsers();

    if (authError) {
      console.log('❌ Auth error:', authError.message);
      return;
    }

    const user = users?.find(u => u.email === userEmail);

    if (!user) {
      console.log('❌ User not found');
      console.log('Available users:', users?.map(u => u.email).join(', '));
      return;
    }

    console.log(`✅ User: ${user.email}`);
    console.log(`   ID: ${user.id}\n`);

    // Get subscription data
    const { data: sub } = await supabase
      .from('user_subscriptions')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (!sub) {
      console.log('❌ No subscription found');
      return;
    }

    console.log('📊 Subscription Data:');
    console.log(`   Balance: ${sub.balance.toLocaleString()} tokens`);
    console.log(`   Total Earned: ${sub.total_earned.toLocaleString()} tokens`);
    console.log(`   Total Spent: ${sub.total_spent.toLocaleString()} tokens`);
    console.log(`   Monthly Credits: ${sub.monthly_credits} Pilot Credits`);
    console.log('');

    // Get all credit transactions
    const { data: transactions } = await supabase
      .from('credit_transactions')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (!transactions || transactions.length === 0) {
      console.log('⚠️  No credit transactions found');
      return;
    }

    console.log(`📝 Found ${transactions.length} transactions:\n`);

    // Group by activity type
    const byType: { [key: string]: { count: number; total: number; transactions: any[] } } = {};

    transactions.forEach(tx => {
      const type = tx.activity_type || 'unknown';
      if (!byType[type]) {
        byType[type] = { count: 0, total: 0, transactions: [] };
      }
      byType[type].count++;
      byType[type].total += tx.credits_delta;
      byType[type].transactions.push(tx);
    });

    // Display summary by type
    console.log('Activity Type Summary:');
    console.log('-'.repeat(60));

    let totalAdded = 0;
    let totalSpent = 0;

    Object.entries(byType).forEach(([type, data]) => {
      const sign = data.total >= 0 ? '+' : '';
      console.log(`${type}:`);
      console.log(`   Count: ${data.count}`);
      console.log(`   Total: ${sign}${data.total.toLocaleString()} tokens`);

      if (data.total > 0) {
        totalAdded += data.total;
      } else {
        totalSpent += Math.abs(data.total);
      }
    });

    console.log('\n' + '='.repeat(60));
    console.log('\n💵 Balance Calculation:');
    console.log(`   Total Added: +${totalAdded.toLocaleString()} tokens`);
    console.log(`   Total Spent: -${totalSpent.toLocaleString()} tokens`);
    console.log(`   Expected Balance: ${(totalAdded - totalSpent).toLocaleString()} tokens`);
    console.log(`   Actual Balance: ${sub.balance.toLocaleString()} tokens`);

    const difference = sub.balance - (totalAdded - totalSpent);

    if (difference === 0) {
      console.log('\n✅ Balance is CORRECT!');
    } else {
      console.log(`\n⚠️  Balance MISMATCH: ${difference > 0 ? '+' : ''}${difference.toLocaleString()} tokens`);
      console.log('\nPossible reasons:');
      console.log('1. Missing transactions in credit_transactions table');
      console.log('2. Balance was manually adjusted');
      console.log('3. Transaction was recorded incorrectly');
    }

    // Show recent transactions
    console.log('\n📋 Recent Transactions (last 10):');
    console.log('-'.repeat(60));

    transactions.slice(0, 10).forEach((tx, i) => {
      const sign = tx.credits_delta >= 0 ? '+' : '';
      console.log(`\n${i + 1}. ${tx.created_at}`);
      console.log(`   Type: ${tx.activity_type}`);
      console.log(`   Delta: ${sign}${tx.credits_delta.toLocaleString()} tokens`);
      console.log(`   Balance After: ${tx.balance_after.toLocaleString()} tokens`);
      console.log(`   Description: ${tx.description}`);
    });

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
  }
}

const userEmail = process.argv[2];

if (!userEmail) {
  console.log('\n❌ Usage: npx tsx scripts/check-user-balance.ts <user-email>\n');
  process.exit(1);
}

checkBalance(userEmail);
