// Check subscription dates in database
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkDates() {
  const { data, error } = await supabase
    .from('user_subscriptions')
    .select('user_id, stripe_subscription_id, created_at, current_period_start, current_period_end, monthly_amount_usd, status')
    .not('stripe_subscription_id', 'is', null)
    .limit(5);

  console.log('📅 Subscription dates in database:');
  data?.forEach(sub => {
    console.log('\n---');
    console.log('User ID:', sub.user_id);
    console.log('Stripe Subscription ID:', sub.stripe_subscription_id);
    console.log('Status:', sub.status);
    console.log('Created At:', sub.created_at);
    console.log('Current Period Start:', sub.current_period_start);
    console.log('Current Period End:', sub.current_period_end);
    console.log('Monthly Amount USD:', sub.monthly_amount_usd);
  });
  
  if (error) {
    console.error('Error:', error);
  }
}

checkDates().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
