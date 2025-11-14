// Debug: Check invoice.subscription field
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-10-29.clover'
});

async function debugInvoice() {
  const invoiceId = 'in_1SQcWh56GTXD0wwiN5s8BaRV'; // Latest prorated invoice

  console.log('🔍 Fetching invoice without expansion...');
  const invoice = await stripe.invoices.retrieve(invoiceId);

  console.log('\n📋 Invoice.subscription field:');
  console.log('  Type:', typeof (invoice as any).subscription);
  console.log('  Value:', (invoice as any).subscription);

  console.log('\n📋 Invoice metadata:');
  console.log('  ', JSON.stringify(invoice.metadata, null, 2));

  console.log('\n📋 Invoice customer:');
  console.log('  ', invoice.customer);

  console.log('\n📋 Trying to find subscription from customer...');
  const subscriptions = await stripe.subscriptions.list({
    customer: invoice.customer as string,
    limit: 1
  });

  if (subscriptions.data.length > 0) {
    const subscription = subscriptions.data[0];
    console.log('\n✅ Found subscription:', subscription.id);
    console.log('\n📋 Subscription metadata:');
    console.log('  ', JSON.stringify(subscription.metadata, null, 2));
    console.log('\n  user_id:', subscription.metadata?.user_id);
    console.log('  credits:', subscription.metadata?.credits);
  } else {
    console.log('\n❌ No subscription found for customer!');
  }
}

debugInvoice().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
