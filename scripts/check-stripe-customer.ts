// Check if customer exists in Stripe and their subscriptions
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-10-29.clover'
});

async function checkCustomer() {
  const customerId = 'cus_TMzIi4IjkeeJvx';

  try {
    console.log('🔍 Checking Stripe customer...\n');

    // Check if customer exists
    const customer = await stripe.customers.retrieve(customerId);
    console.log('✅ Customer exists in Stripe:');
    console.log('   ID:', customer.id);
    console.log('   Email:', (customer as any).email);
    console.log('   Created:', new Date((customer as any).created * 1000).toISOString());

    // List all subscriptions for this customer
    console.log('\n📋 Subscriptions for this customer:');
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      limit: 10
    });

    if (subscriptions.data.length === 0) {
      console.log('   ❌ No subscriptions found');
    } else {
      subscriptions.data.forEach((sub, i) => {
        console.log(`\n   ${i + 1}. Subscription ${sub.id}`);
        console.log(`      Status: ${sub.status}`);
        console.log(`      Amount: $${(sub.items.data[0]?.price.unit_amount || 0) / 100}`);
        console.log(`      Created: ${new Date(sub.created * 1000).toISOString()}`);
        console.log(`      Link: https://dashboard.stripe.com/subscriptions/${sub.id}`);
      });
    }

    // Check invoices
    console.log('\n💰 Recent invoices:');
    const invoices = await stripe.invoices.list({
      customer: customerId,
      limit: 5
    });

    if (invoices.data.length === 0) {
      console.log('   ❌ No invoices found');
    } else {
      invoices.data.forEach((inv, i) => {
        console.log(`\n   ${i + 1}. Invoice ${inv.id}`);
        console.log(`      Status: ${inv.status}`);
        console.log(`      Amount: $${(inv.amount_due || 0) / 100}`);
        console.log(`      Created: ${new Date(inv.created * 1000).toISOString()}`);
      });
    }

  } catch (error: any) {
    if (error.code === 'resource_missing') {
      console.error('❌ Customer does not exist in Stripe!');
      console.error('   The customer ID in your database is invalid.');
    } else {
      console.error('❌ Error:', error.message);
    }
  }
}

checkCustomer().then(() => process.exit(0));
