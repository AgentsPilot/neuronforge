// Check subscription cancellation status in database
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

async function checkCancellation() {
  const userId = '08456106-aa50-4810-b12c-7ca84102da31';

  console.log('🔍 Checking subscription cancellation status for user:', userId);

  const { data, error } = await supabaseAdmin
    .from('user_subscriptions')
    .select('cancel_at_period_end, canceled_at, status, current_period_end, monthly_credits, monthly_amount_usd')
    .eq('user_id', userId)
    .single();

  if (error) {
    console.error('❌ Error:', error);
    return;
  }

  console.log('\n📊 Database Status:');
  console.log('  cancel_at_period_end:', data.cancel_at_period_end);
  console.log('  canceled_at:', data.canceled_at);
  console.log('  status:', data.status);
  console.log('  current_period_end:', data.current_period_end);
  console.log('  monthly_credits:', data.monthly_credits);
  console.log('  monthly_amount_usd:', data.monthly_amount_usd);

  if (data.cancel_at_period_end) {
    console.log('\n✅ Subscription is set to cancel at period end');
    console.log('   User will have access until:', data.current_period_end);
  } else {
    console.log('\n⚠️  Subscription is NOT set to cancel');
  }
}

checkCancellation().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
