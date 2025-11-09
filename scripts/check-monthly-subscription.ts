// Check monthly subscription amount
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkMonthly() {
  const { data, error } = await supabase
    .from('user_subscriptions')
    .select('user_id, monthly_amount_usd, monthly_credits, balance')
    .limit(1)
    .single();

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log('\n📊 Monthly Subscription Info:');
  console.log('User ID:', data.user_id);
  console.log('Monthly Amount (USD):', data.monthly_amount_usd);
  console.log('Monthly Credits:', data.monthly_credits);
  console.log('Current Balance:', data.balance);
}

checkMonthly().then(() => process.exit(0));
