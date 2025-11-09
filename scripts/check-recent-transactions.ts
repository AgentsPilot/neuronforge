// Check recent credit transactions
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
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
  const userId = '08456106-aa50-4810-b12c-7ca84102da31';

  const { data: transactions } = await supabase
    .from('credit_transactions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(10);

  console.log('📝 Recent Transactions:\n');
  transactions?.forEach((t: any, i: number) => {
    console.log(`${i + 1}. ${t.activity_type}`);
    console.log(`   Credits: ${t.credits_delta}`);
    console.log(`   Description: ${t.description}`);
    console.log(`   Manual sync: ${t.metadata?.manual_sync || false}`);
    console.log(`   Sync trigger: ${t.metadata?.sync_trigger || 'N/A'}`);
    console.log(`   Subscription ID: ${t.metadata?.stripe_subscription_id || 'N/A'}`);
    console.log(`   Created: ${t.created_at}`);
    console.log('');
  });
}

checkTransactions().then(() => process.exit(0)).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
