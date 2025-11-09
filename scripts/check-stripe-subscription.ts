// scripts/check-stripe-subscription.ts
// Check if subscription exists in Stripe and what metadata it has

import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-10-29.clover'
});

async function checkStripeSubscription() {
  const userEmail = 'offir.omer@gmail.com';

  console.log('🔍 Searching for subscriptions...\n');

  // List all test subscriptions
  const subscriptions = await stripe.subscriptions.list({
    limit: 10,
    status: 'all'
  });

  console.log(`Found ${subscriptions.data.length} subscriptions:\n`);

  for (const sub of subscriptions.data) {
    const customer = await stripe.customers.retrieve(sub.customer as string);
    const customerEmail = (customer as Stripe.Customer).email;

    console.log('---');
    console.log('Subscription ID:', sub.id);
    console.log('Customer:', customerEmail);
    console.log('Status:', sub.status);
    console.log('Amount:', sub.items.data[0]?.price?.unit_amount || 0, 'cents');
    console.log('Interval:', sub.items.data[0]?.price?.recurring?.interval || 'N/A');
    console.log('Metadata:', sub.metadata);
    const periodEnd = (sub as any).current_period_end;
    console.log('Current period end:', periodEnd ? new Date(periodEnd * 1000).toISOString() : 'N/A');

    if (customerEmail === userEmail) {
      console.log('\n✅ THIS IS YOUR SUBSCRIPTION!\n');

      // Get the most recent invoice
      const invoices = await stripe.invoices.list({
        subscription: sub.id,
        limit: 1
      });

      if (invoices.data.length > 0) {
        const invoice = invoices.data[0];
        console.log('📄 Latest Invoice:');
        console.log('  ID:', invoice.id);
        console.log('  Status:', invoice.status);
        console.log('  Amount:', invoice.amount_paid, 'cents');
        console.log('  Metadata:', invoice.metadata);
        console.log('  Created:', new Date(invoice.created * 1000).toISOString());
      }
    }
  }
}

checkStripeSubscription().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
