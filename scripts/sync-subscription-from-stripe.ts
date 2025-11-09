// Sync user subscription data from Stripe to database
// Run with: npx tsx scripts/sync-subscription-from-stripe.ts <user-email>

import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-11-20.acacia'
});

async function getPricingConfig() {
  const { data: config } = await supabase
    .from('ais_system_config')
    .select('pilot_credit_cost_usd')
    .single();

  return config?.pilot_credit_cost_usd || 0.01; // Default $0.01 per Pilot Credit
}

async function syncSubscription(userEmail: string) {
  console.log('\n🔄 Syncing Subscription from Stripe\n');
  console.log('='.repeat(60));

  try {
    // 1. Get user from database
    console.log('\n1️⃣ Finding user...');
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

    console.log(`✅ Found user: ${user.email}`);
    console.log(`   User ID: ${user.id}`);

    // 2. Get current database subscription
    console.log('\n2️⃣ Checking database subscription...');
    const { data: dbSub, error: subError } = await supabase
      .from('user_subscriptions')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (subError || !dbSub) {
      console.log('❌ No subscription found in database');
      return;
    }

    console.log('📊 Current Database Values:');
    console.log(`   Monthly Credits: ${(dbSub.monthly_credits || 0).toLocaleString()} Pilot Credits`);
    console.log(`   Monthly Amount: $${(dbSub.monthly_amount_usd || 0).toFixed(2)}`);
    console.log(`   Balance: ${(dbSub.balance || 0).toLocaleString()} tokens`);
    console.log(`   Stripe Subscription ID: ${dbSub.stripe_subscription_id || 'N/A'}`);

    if (!dbSub.stripe_subscription_id) {
      console.log('\n❌ No Stripe subscription ID found in database');
      return;
    }

    // 3. Get Stripe subscription
    console.log('\n3️⃣ Fetching Stripe subscription...');
    const stripeSub = await stripe.subscriptions.retrieve(dbSub.stripe_subscription_id);

    console.log('✅ Stripe Subscription Found:');
    console.log(`   Status: ${stripeSub.status}`);
    console.log(`   Current Period: ${new Date(stripeSub.current_period_start * 1000).toLocaleDateString()} - ${new Date(stripeSub.current_period_end * 1000).toLocaleDateString()}`);

    // Get the amount from Stripe (in cents)
    const stripeAmountCents = stripeSub.items.data[0]?.price?.unit_amount || 0;
    const stripeAmountUsd = stripeAmountCents / 100;

    console.log(`   Amount: $${stripeAmountUsd.toFixed(2)} USD`);

    // Get metadata to check if credits are stored there
    console.log(`   Metadata:`, JSON.stringify(stripeSub.metadata, null, 2));

    // 4. Get Pilot Credits from Stripe metadata (this is the source of truth)
    console.log('\n4️⃣ Getting Pilot Credits from Stripe metadata...');

    // Check metadata for credits (try both 'credits' and 'pilot_credits' keys)
    const metadataCredits = stripeSub.metadata?.credits
      ? parseInt(stripeSub.metadata.credits)
      : stripeSub.metadata?.pilot_credits
      ? parseInt(stripeSub.metadata.pilot_credits)
      : null;

    if (!metadataCredits) {
      console.log('❌ No credits found in Stripe metadata!');
      console.log('   Cannot sync without metadata. The subscription needs a "credits" or "pilot_credits" field.');

      // Calculate as fallback
      const pricingConfig = await getPricingConfig();
      const calculatedCredits = Math.round(stripeAmountUsd / pricingConfig);
      console.log(`   Calculated from price: ${calculatedCredits.toLocaleString()} Pilot Credits`);
      console.log(`   But this may not be accurate. Please update Stripe metadata.`);
      return;
    }

    console.log(`✅ Stripe Metadata Credits: ${metadataCredits.toLocaleString()} Pilot Credits`);
    const correctPilotCredits = metadataCredits;

    // 5. Compare and show differences
    console.log('\n5️⃣ Comparison:');
    console.log('-'.repeat(60));

    const creditsDiff = correctPilotCredits - (dbSub.monthly_credits || 0);
    const amountDiff = stripeAmountUsd - (dbSub.monthly_amount_usd || 0);

    console.log(`   Monthly Credits:`);
    console.log(`   - Database: ${(dbSub.monthly_credits || 0).toLocaleString()} Pilot Credits`);
    console.log(`   - Stripe: ${correctPilotCredits.toLocaleString()} Pilot Credits`);
    console.log(`   - Difference: ${creditsDiff >= 0 ? '+' : ''}${creditsDiff.toLocaleString()}`);

    console.log(`\n   Monthly Amount:`);
    console.log(`   - Database: $${(dbSub.monthly_amount_usd || 0).toFixed(2)}`);
    console.log(`   - Stripe: $${stripeAmountUsd.toFixed(2)}`);
    console.log(`   - Difference: $${amountDiff.toFixed(2)}`);

    if (creditsDiff === 0 && Math.abs(amountDiff) < 0.01) {
      console.log('\n✅ Database is already in sync with Stripe!');
      return;
    }

    // 6. Update database
    console.log('\n6️⃣ Updating database to match Stripe...');

    const { error: updateError } = await supabase
      .from('user_subscriptions')
      .update({
        monthly_credits: correctPilotCredits,
        monthly_amount_usd: stripeAmountUsd
      })
      .eq('user_id', user.id);

    if (updateError) {
      console.log('❌ Error updating database:', updateError.message);
      return;
    }

    console.log('✅ Database updated successfully!');

    // 7. Log billing event
    console.log('\n7️⃣ Logging sync event...');
    await supabase
      .from('billing_events')
      .insert({
        user_id: user.id,
        event_type: 'subscription_synced',
        description: `Subscription synced from Stripe: ${(dbSub.monthly_credits || 0).toLocaleString()} → ${correctPilotCredits.toLocaleString()} Pilot Credits`,
        amount_cents: Math.round(stripeAmountUsd * 100),
        currency: 'usd'
      });

    console.log('✅ Event logged');

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('\n✅ SYNC COMPLETE!\n');
    console.log(`   User: ${user.email}`);
    console.log(`   Monthly Credits: ${(dbSub.monthly_credits || 0).toLocaleString()} → ${correctPilotCredits.toLocaleString()} Pilot Credits`);
    console.log(`   Monthly Amount: $${(dbSub.monthly_amount_usd || 0).toFixed(2)} → $${stripeAmountUsd.toFixed(2)}`);
    console.log(`\n   Please refresh the billing settings page to see the updated values.\n`);

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    if (error.type === 'StripeInvalidRequestError') {
      console.log('\n⚠️  Stripe subscription not found or invalid subscription ID');
    }
  }
}

const userEmail = process.argv[2];

if (!userEmail) {
  console.log('\n❌ Usage: npx tsx scripts/sync-subscription-from-stripe.ts <user-email>');
  console.log('\nExample:');
  console.log('npx tsx scripts/sync-subscription-from-stripe.ts user@example.com\n');
  process.exit(1);
}

syncSubscription(userEmail);
