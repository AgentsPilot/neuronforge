// Fix monthly_amount_usd for existing subscription
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

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

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-10-29.clover'
});

async function fixMonthlyAmount() {
  const userId = '08456106-aa50-4810-b12c-7ca84102da31';

  // Get current subscription
  const { data: userSub } = await supabaseAdmin
    .from('user_subscriptions')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (!userSub?.stripe_subscription_id) {
    console.log('❌ No subscription ID found');
    process.exit(1);
  }

  console.log('📋 Current subscription ID:', userSub.stripe_subscription_id);

  // Try to get subscription from Stripe
  try {
    const subscription = await stripe.subscriptions.retrieve(userSub.stripe_subscription_id);
    console.log('✅ Found in Stripe, status:', subscription.status);
    console.log('📝 Metadata:', subscription.metadata);

    const pilotCredits = parseInt(subscription.metadata?.credits || '0');

    if (pilotCredits > 0) {
      // Get pricing config
      const { data: costConfigData } = await supabaseAdmin
        .from('ais_system_config')
        .select('config_value')
        .eq('config_key', 'pilot_credit_cost_usd')
        .single();

      const pilotCreditCostUsd = costConfigData ? parseFloat(costConfigData.config_value) : 0.00048;
      const monthlyAmountUsd = pilotCredits * pilotCreditCostUsd;

      console.log(`\n💵 Calculating: ${pilotCredits} credits × $${pilotCreditCostUsd} = $${monthlyAmountUsd}`);

      // Update database
      await supabaseAdmin
        .from('user_subscriptions')
        .update({
          monthly_amount_usd: monthlyAmountUsd
        })
        .eq('user_id', userId);

      console.log('✅ Updated monthly_amount_usd to:', monthlyAmountUsd);
    } else {
      console.log('⚠️  No credits in metadata, cannot calculate monthly amount');
    }
  } catch (error: any) {
    if (error.code === 'resource_missing') {
      console.log('⚠️  Subscription not found in Stripe (likely canceled)');
      console.log('💡 Setting monthly_amount_usd to 0');

      await supabaseAdmin
        .from('user_subscriptions')
        .update({
          monthly_amount_usd: 0
        })
        .eq('user_id', userId);

      console.log('✅ Updated monthly_amount_usd to 0');
    } else {
      throw error;
    }
  }
}

fixMonthlyAmount().then(() => {
  console.log('\n✅ Done!');
  process.exit(0);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
