// Manually process a boost pack purchase from a Stripe checkout session
// Run with: npx tsx scripts/manually-process-boost-purchase.ts <session-id>

import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-11-20.acacia'
});

async function pilotCreditsToTokens(pilotCredits: number): Promise<number> {
  // Get the conversion rate from database
  const { data: config } = await supabase
    .from('ais_system_config')
    .select('tokens_per_pilot_credit')
    .single();

  const tokensPerCredit = config?.tokens_per_pilot_credit || 10;
  return pilotCredits * tokensPerCredit;
}

async function processBoostPurchase(sessionId: string) {
  console.log('\n💳 Processing Boost Pack Purchase\n');
  console.log('='.repeat(60));

  try {
    // 1. Fetch the checkout session from Stripe
    console.log('\n1️⃣ Fetching checkout session from Stripe...');
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    console.log(`✅ Found session: ${session.id}`);
    console.log(`   Status: ${session.status}`);
    console.log(`   Payment Status: ${session.payment_status}`);
    console.log(`   Mode: ${session.mode}`);
    console.log(`   Amount: $${((session.amount_total || 0) / 100).toFixed(2)}`);

    // 2. Validate session
    if (session.status !== 'complete') {
      console.log('❌ Session is not complete. Cannot process.');
      return;
    }

    if (session.payment_status !== 'paid') {
      console.log('❌ Payment not completed. Cannot process.');
      return;
    }

    if (session.mode !== 'payment') {
      console.log('❌ This is not a one-time payment session. Skipping.');
      return;
    }

    const userId = session.metadata?.user_id;
    const purchaseType = session.metadata?.purchase_type;
    const boostPackId = session.metadata?.boost_pack_id;
    const pilotCredits = parseInt(session.metadata?.credits || '0');

    console.log('\n2️⃣ Session Metadata:');
    console.log(`   User ID: ${userId || 'MISSING!'}`);
    console.log(`   Purchase Type: ${purchaseType || 'MISSING!'}`);
    console.log(`   Boost Pack ID: ${boostPackId || 'MISSING!'}`);
    console.log(`   Credits: ${pilotCredits || 'MISSING!'}`);

    if (!userId) {
      console.log('\n❌ No user_id in session metadata. Cannot process.');
      return;
    }

    if (purchaseType !== 'boost_pack') {
      console.log('\n❌ This is not a boost pack purchase. Skipping.');
      return;
    }

    if (!boostPackId) {
      console.log('\n❌ No boost_pack_id in session metadata. Cannot process.');
      return;
    }

    if (!pilotCredits) {
      console.log('\n❌ No credits in session metadata. Cannot process.');
      return;
    }

    // 3. Check if already processed
    console.log('\n3️⃣ Checking if already processed...');
    const { data: existingPurchase } = await supabase
      .from('boost_pack_purchases')
      .select('id')
      .eq('stripe_payment_intent_id', session.payment_intent as string)
      .single();

    if (existingPurchase) {
      console.log('⚠️  This purchase has already been processed!');
      console.log(`   Purchase ID: ${existingPurchase.id}`);
      return;
    }

    console.log('✅ Purchase has not been processed yet');

    // 4. Convert Pilot Credits to tokens
    const credits = await pilotCreditsToTokens(pilotCredits);
    console.log(`\n4️⃣ Converting credits:`);
    console.log(`   ${pilotCredits} Pilot Credits → ${credits.toLocaleString()} tokens`);

    // 5. Get current balance
    console.log('\n5️⃣ Getting current user balance...');
    const { data: userSub } = await supabase
      .from('user_subscriptions')
      .select('balance, total_earned')
      .eq('user_id', userId)
      .single();

    if (!userSub) {
      console.log('❌ User subscription not found');
      return;
    }

    const currentBalance = userSub.balance || 0;
    const currentTotalEarned = userSub.total_earned || 0;
    const newBalance = currentBalance + credits;
    const newTotalEarned = currentTotalEarned + credits;

    console.log(`   Current Balance: ${currentBalance.toLocaleString()} tokens`);
    console.log(`   New Balance: ${newBalance.toLocaleString()} tokens (+${credits.toLocaleString()})`);

    // 6. Update balance
    console.log('\n6️⃣ Updating user balance...');
    const { error: updateError } = await supabase
      .from('user_subscriptions')
      .update({
        balance: newBalance,
        total_earned: newTotalEarned
      })
      .eq('user_id', userId);

    if (updateError) {
      console.log('❌ Error updating balance:', updateError.message);
      return;
    }

    console.log('✅ Balance updated successfully');

    // 7. Create credit transaction
    console.log('\n7️⃣ Creating credit transaction record...');
    const { error: txError } = await supabase
      .from('credit_transactions')
      .insert({
        user_id: userId,
        credits_delta: credits,
        balance_before: currentBalance,
        balance_after: newBalance,
        transaction_type: 'allocation',
        activity_type: 'boost_pack_purchase',
        description: `Boost pack purchase: ${credits.toLocaleString()} tokens`,
        metadata: {
          stripe_session_id: session.id,
          stripe_payment_intent_id: session.payment_intent,
          boost_pack_id: boostPackId,
          amount_paid_cents: session.amount_total,
          manually_processed: true,
          processed_at: new Date().toISOString()
        }
      });

    if (txError) {
      console.log('❌ Error creating transaction:', txError.message);
      return;
    }

    console.log('✅ Credit transaction created');

    // 8. Record boost pack purchase
    console.log('\n8️⃣ Creating boost pack purchase record...');
    const { error: purchaseError } = await supabase
      .from('boost_pack_purchases')
      .insert({
        user_id: userId,
        boost_pack_id: boostPackId,
        credits_purchased: credits,
        bonus_credits: 0, // Bonus already included in credits
        price_paid_usd: ((session.amount_total || 0) / 100).toFixed(2),
        stripe_payment_intent_id: session.payment_intent as string,
        payment_status: 'succeeded'
      });

    if (purchaseError) {
      console.log('❌ Error creating purchase record:', purchaseError.message);
      return;
    }

    console.log('✅ Boost pack purchase record created');

    // Success summary
    console.log('\n' + '='.repeat(60));
    console.log('\n✅ SUCCESS! Boost pack purchase processed manually\n');
    console.log(`   User ID: ${userId}`);
    console.log(`   Credits Added: ${credits.toLocaleString()} tokens`);
    console.log(`   New Balance: ${newBalance.toLocaleString()} tokens`);
    console.log(`   Amount Paid: $${((session.amount_total || 0) / 100).toFixed(2)}`);
    console.log(`   Stripe Session: ${session.id}`);
    console.log(`   Stripe Payment Intent: ${session.payment_intent}\n`);

  } catch (error: any) {
    console.error('\n❌ Error processing purchase:', error.message);
    if (error.type === 'StripeInvalidRequestError') {
      console.log('\n⚠️  Session not found. Please check the session ID.');
    }
  }
}

// Get session ID from command line
const sessionId = process.argv[2];

if (!sessionId) {
  console.log('\n❌ Usage: npx tsx scripts/manually-process-boost-purchase.ts <session-id>');
  console.log('\nExample:');
  console.log('npx tsx scripts/manually-process-boost-purchase.ts cs_test_a1ELp5OWntURNbqwxjbmfGwBKpZZ3HX2KybzdhxaxLxMdw34QSuW2DCN57\n');
  process.exit(1);
}

processBoostPurchase(sessionId);
