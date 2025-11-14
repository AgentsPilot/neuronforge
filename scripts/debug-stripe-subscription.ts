// Debug Stripe subscription
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-10-29.clover'
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function debugSub() {
  // Get the subscription
  const { data: sub } = await supabase
    .from('user_subscriptions')
    .select('*')
    .not('stripe_subscription_id', 'is', null)
    .single();

  if (!sub) {
    console.log('No subscription found');
    return;
  }

  console.log('🔍 Fetching Stripe subscription:', sub.stripe_subscription_id);

  const stripeSub = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);

  console.log('\n📋 Full Stripe Subscription Object:');
  console.log(JSON.stringify(stripeSub, null, 2));
}

debugSub().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
