// Manually allocate prorated credits for an upgrade
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function allocateCredits() {
  const userEmail = 'offir.omer@gmail.com';
  const proratedAmountUsd = 15.00; // The amount charged for the latest upgrade ($10 → $25)
  const pilotCreditCostUsd = 0.00048;

  // Calculate credits
  const pilotCredits = Math.floor(proratedAmountUsd / pilotCreditCostUsd);
  const tokens = pilotCredits * 10;

  console.log('💰 Prorated Credit Allocation:');
  console.log('   Amount paid: $' + proratedAmountUsd.toFixed(2));
  console.log('   Pilot Credits: ' + pilotCredits.toLocaleString());
  console.log('   Tokens: ' + tokens.toLocaleString());

  // Get user
  const { data: { users } } = await supabase.auth.admin.listUsers();
  const user = users?.find(u => u.email === userEmail);

  if (!user) {
    console.log('❌ User not found');
    return;
  }

  // Get current balance
  const { data: sub } = await supabase
    .from('user_subscriptions')
    .select('balance, total_earned')
    .eq('user_id', user.id)
    .single();

  const currentBalance = sub?.balance || 0;
  const currentTotalEarned = sub?.total_earned || 0;
  const newBalance = currentBalance + tokens;
  const newTotalEarned = currentTotalEarned + tokens;

  console.log('\n📊 Balance Update:');
  console.log('   Current: ' + currentBalance.toLocaleString() + ' tokens');
  console.log('   Adding: ' + tokens.toLocaleString() + ' tokens');
  console.log('   New: ' + newBalance.toLocaleString() + ' tokens');

  // Update balance
  const { error: updateError } = await supabase
    .from('user_subscriptions')
    .update({
      balance: newBalance,
      total_earned: newTotalEarned
    })
    .eq('user_id', user.id);

  if (updateError) {
    console.error('❌ Error updating balance:', updateError);
    return;
  }

  console.log('✅ Balance updated');

  // Create transaction record
  const { error: txError } = await supabase
    .from('credit_transactions')
    .insert({
      user_id: user.id,
      credits_delta: tokens,
      balance_before: currentBalance,
      balance_after: newBalance,
      transaction_type: 'allocation',
      activity_type: 'subscription_upgrade',
      description: `Subscription upgrade (prorated): ${tokens.toLocaleString()} tokens`,
      metadata: {
        stripe_invoice_id: 'in_1SQcBs56GTXD0wwiDy3leMq7',
        amount_paid_cents: proratedAmountUsd * 100,
        is_prorated: true,
        manual_allocation: true
      }
    });

  if (txError) {
    console.error('❌ Error creating transaction:', txError);
  } else {
    console.log('✅ Transaction created');
  }

  // Create billing event
  const { error: billingError } = await supabase
    .from('billing_events')
    .insert({
      user_id: user.id,
      event_type: 'subscription_upgraded',
      credits_delta: tokens,
      description: `Subscription upgraded (prorated): ${tokens.toLocaleString()} tokens awarded`,
      stripe_event_id: 'in_1SQcBs56GTXD0wwiDy3leMq7',
      stripe_invoice_id: 'in_1SQcBs56GTXD0wwiDy3leMq7',
      amount_cents: proratedAmountUsd * 100,
      currency: 'usd'
    });

  if (billingError) {
    console.error('❌ Error creating billing event:', billingError);
  } else {
    console.log('✅ Billing event created');
  }

  console.log('\n✅ Done! Prorated credits allocated.');
}

allocateCredits();
