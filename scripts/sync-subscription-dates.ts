// Sync subscription dates from Stripe to database
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-10-29.clover'
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function syncDates() {
  console.log('🔄 Syncing subscription dates from Stripe...\n');

  // Get all subscriptions with Stripe IDs
  const { data: subscriptions, error } = await supabase
    .from('user_subscriptions')
    .select('*')
    .not('stripe_subscription_id', 'is', null);

  if (error) {
    console.error('❌ Error fetching subscriptions:', error);
    return;
  }

  console.log(`📊 Found ${subscriptions?.length || 0} subscriptions to check\n`);

  for (const sub of subscriptions || []) {
    console.log(`\n--- Processing subscription for user ${sub.user_id.substring(0, 8)}...`);
    console.log(`Stripe ID: ${sub.stripe_subscription_id}`);

    try {
      // Fetch from Stripe
      const stripeSub = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);

      // Get period dates from the first subscription item
      const firstItem = (stripeSub as any).items?.data?.[0];
      const periodStart = firstItem?.current_period_start
        ? new Date(firstItem.current_period_start * 1000).toISOString()
        : null;
      const periodEnd = firstItem?.current_period_end
        ? new Date(firstItem.current_period_end * 1000).toISOString()
        : null;

      console.log(`📅 Stripe dates:`);
      console.log(`   Period Start: ${periodStart}`);
      console.log(`   Period End: ${periodEnd}`);

      // Update database
      const { error: updateError } = await supabase
        .from('user_subscriptions')
        .update({
          current_period_start: periodStart,
          current_period_end: periodEnd,
          status: stripeSub.status
        })
        .eq('user_id', sub.user_id);

      if (updateError) {
        console.error(`❌ Error updating: ${updateError.message}`);
      } else {
        console.log(`✅ Updated successfully`);
      }

    } catch (err: any) {
      console.error(`❌ Error fetching from Stripe: ${err.message}`);
    }
  }

  console.log('\n✨ Sync complete!');
}

syncDates().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
