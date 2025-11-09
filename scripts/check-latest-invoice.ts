// Check the latest invoice for a user to debug proration detection
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-10-29.clover'
});

async function checkLatestInvoice() {
  const userEmail = 'offir.omer@gmail.com';

  // Get user
  const { data: { users } } = await supabase.auth.admin.listUsers();
  const user = users?.find(u => u.email === userEmail);

  if (!user) {
    console.log('❌ User not found');
    return;
  }

  // Get subscription
  const { data: sub } = await supabase
    .from('user_subscriptions')
    .select('stripe_customer_id, balance, monthly_credits')
    .eq('user_id', user.id)
    .single();

  console.log('📊 Current Database State:');
  console.log('   Balance:', sub?.balance, 'tokens =', (sub?.balance || 0) / 10, 'Pilot Credits');
  console.log('   Monthly Credits:', sub?.monthly_credits);

  if (!sub?.stripe_customer_id) {
    console.log('❌ No Stripe customer found');
    return;
  }

  // Get latest invoices
  console.log('\n🔍 Fetching latest invoices from Stripe...');
  const invoices = await stripe.invoices.list({
    customer: sub.stripe_customer_id,
    limit: 3,
    expand: ['data.lines.data']
  });

  console.log(`\nFound ${invoices.data.length} invoice(s):\n`);

  invoices.data.forEach((invoice, i) => {
    console.log(`Invoice ${i + 1}: ${invoice.id}`);
    console.log('  Created:', new Date(invoice.created * 1000).toLocaleString());
    console.log('  Amount paid: $' + (invoice.amount_paid / 100).toFixed(2));
    console.log('  Status:', invoice.status);
    console.log('  Line items:', invoice.lines.data.length);

    // Check proration detection logic
    const hasMultipleItems = invoice.lines.data.length > 1;
    const hasProrationDescriptions = invoice.lines.data.some(line =>
      line.description?.includes('Unused time') ||
      line.description?.includes('Remaining time')
    );
    const hasProration = hasMultipleItems && hasProrationDescriptions;

    console.log('  Proration Detection:');
    console.log('    Multiple items:', hasMultipleItems);
    console.log('    Has proration descriptions:', hasProrationDescriptions);
    console.log('    ➡️  Is Prorated:', hasProration ? '✅ YES' : '❌ NO');

    console.log('  Line item details:');
    invoice.lines.data.forEach((line, j) => {
      console.log(`    Item ${j + 1}:`);
      console.log('      Description:', line.description);
      console.log('      Amount:', line.amount, 'cents = $' + (line.amount / 100).toFixed(2));
    });

    if (hasProration) {
      const pilotCreditCostUsd = 0.00048;
      const amountPaidUsd = invoice.amount_paid / 100;
      const pilotCredits = Math.floor(amountPaidUsd / pilotCreditCostUsd);
      const tokens = pilotCredits * 10;

      console.log('\n  💰 What Should Be Allocated:');
      console.log('     Amount paid: $' + amountPaidUsd.toFixed(2));
      console.log('     Pilot Credits:', pilotCredits.toLocaleString());
      console.log('     Tokens:', tokens.toLocaleString());
    }

    console.log('\n' + '-'.repeat(80) + '\n');
  });
}

checkLatestInvoice().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
