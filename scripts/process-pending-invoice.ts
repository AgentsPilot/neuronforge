// Manually process a pending invoice with the updated proration detection
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-10-29.clover'
});

async function processInvoice() {
  const invoiceId = 'in_1SQc3k56GTXD0wwi8abvjSi5'; // Latest upgrade invoice
  const userEmail = 'offir.omer@gmail.com';

  console.log('🔍 Fetching invoice:', invoiceId);
  const invoice = await stripe.invoices.retrieve(invoiceId, {
    expand: ['lines.data', 'subscription']
  });

  console.log('\n📋 Invoice Details:');
  console.log('Amount paid:', invoice.amount_paid, 'cents = $' + (invoice.amount_paid / 100));
  console.log('Status:', invoice.status);

  // Check for proration using updated logic
  const hasMultipleItems = invoice.lines.data.length > 1;
  const hasProrationDescriptions = invoice.lines.data.some(line =>
    line.description?.includes('Unused time') ||
    line.description?.includes('Remaining time')
  );
  const hasProration = hasMultipleItems && hasProrationDescriptions;

  console.log('\n🔄 Proration Detection (Updated Logic):');
  console.log('   Multiple items:', hasMultipleItems);
  console.log('   Has proration descriptions:', hasProrationDescriptions);
  console.log('   Has Proration:', hasProration);

  if (!hasProration) {
    console.log('\n❌ Not a prorated invoice, exiting');
    return;
  }

  console.log('\n📦 Line Items:');
  invoice.lines.data.forEach((line, i) => {
    console.log(`\nItem ${i + 1}:`);
    console.log('  Description:', line.description);
    console.log('  Amount:', line.amount, 'cents');
  });

  // Calculate credits
  const pilotCreditCostUsd = 0.00048;
  const amountPaidUsd = invoice.amount_paid / 100;
  const pilotCredits = Math.floor(amountPaidUsd / pilotCreditCostUsd);
  const tokens = pilotCredits * 10;

  console.log('\n💰 Prorated Credit Calculation:');
  console.log('   Amount paid: $' + amountPaidUsd.toFixed(2));
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
  console.log('\n✅ Done! Prorated credits allocated.');
  console.log('\n📝 Note: Transactions and billing events were not created due to schema constraints.');
}

processInvoice().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
