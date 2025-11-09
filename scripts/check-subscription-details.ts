// scripts/check-subscription-details.ts
// Check what type of subscription the user has

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

async function checkSubscription() {
  const userEmail = 'offir.omer@gmail.com';

  const { data: authData } = await supabaseAdmin.auth.admin.listUsers();
  const user = authData.users.find((u: any) => u.email === userEmail);

  if (!user) {
    console.error('❌ User not found');
    return;
  }

  const { data: userSub } = await supabaseAdmin
    .from('user_subscriptions')
    .select('*')
    .eq('user_id', user.id)
    .single();

  console.log('📊 User Subscription Details:\n');
  console.log('Balance:', userSub?.balance, 'tokens =', (userSub?.balance || 0) / 10, 'Pilot Credits');
  console.log('Total earned:', userSub?.total_earned, 'tokens');
  console.log('Status:', userSub?.status);
  console.log('Subscription type:', userSub?.subscription_type);

  console.log('\n💳 Stripe Info:');
  console.log('Customer ID:', userSub?.stripe_customer_id || 'None');
  console.log('Subscription ID:', userSub?.stripe_subscription_id || 'None');
  console.log('Monthly credits:', userSub?.monthly_pilot_credits || 'None');
  console.log('Monthly amount USD:', userSub?.monthly_amount_usd || 'None');

  console.log('\n📅 Billing:');
  console.log('Current period start:', userSub?.current_period_start || 'None');
  console.log('Current period end:', userSub?.current_period_end || 'None');
  console.log('Cancel at period end:', userSub?.cancel_at_period_end || false);

  console.log('\n🎯 What you have:');
  if (!userSub?.stripe_subscription_id) {
    console.log('❌ NO RECURRING SUBSCRIPTION');
    console.log('   You made a one-time purchase, not a monthly subscription.');
    console.log('   To test monthly subscription flow, you need to:');
    console.log('   1. Go to Settings → Billing → Subscription tab');
    console.log('   2. Enter amount (e.g., 2000 Pilot Credits)');
    console.log('   3. Click "Subscribe" button');
    console.log('   4. Complete payment with test card: 4242 4242 4242 4242');
  } else {
    console.log('✅ RECURRING MONTHLY SUBSCRIPTION');
    console.log('   Monthly:', (userSub.monthly_pilot_credits || 0) / 10, 'Pilot Credits');
    console.log('   Price: $' + (userSub.monthly_amount_usd || 0).toFixed(2) + '/month');
    console.log('   Next billing:', userSub.current_period_end);
  }
}

checkSubscription().then(() => {
  console.log('\n✅ Done!');
  process.exit(0);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
