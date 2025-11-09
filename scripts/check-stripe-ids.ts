// Check Stripe subscription and customer IDs
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkStripeIds() {
  const { data, error } = await supabase
    .from('user_subscriptions')
    .select('user_id, stripe_customer_id, stripe_subscription_id, status, monthly_amount_usd')
    .limit(1)
    .single();

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log('\n🔍 Stripe Subscription Details:');
  console.log('User ID:', data.user_id);
  console.log('Stripe Customer ID:', data.stripe_customer_id || '❌ NOT SET');
  console.log('Stripe Subscription ID:', data.stripe_subscription_id || '❌ NOT SET');
  console.log('Status:', data.status);
  console.log('Monthly Amount:', data.monthly_amount_usd);

  if (data.stripe_subscription_id) {
    console.log('\n🔗 Direct Links:');
    console.log('Customer:', `https://dashboard.stripe.com/customers/${data.stripe_customer_id}`);
    console.log('Subscription:', `https://dashboard.stripe.com/subscriptions/${data.stripe_subscription_id}`);
  } else {
    console.log('\n⚠️  No Stripe subscription ID found in database!');
    console.log('This means the subscription was not created in Stripe, only in your local database.');
  }
}

checkStripeIds().then(() => process.exit(0));
