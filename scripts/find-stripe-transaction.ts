// scripts/find-stripe-transaction.ts
// Look for any Stripe-related transactions or boost pack purchases

import { createClient } from '@supabase/supabase-js';

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

async function findStripeTransaction() {
  const userEmail = 'offir.omer@gmail.com';

  const { data: authData } = await supabaseAdmin.auth.admin.listUsers();
  const user = authData.users.find(u => u.email === userEmail);

  if (!user) {
    console.error('❌ User not found');
    return;
  }

  const userId = user.id;
  console.log('👤 User ID:', userId);

  // Check boost_pack_purchases
  const { data: purchases } = await supabaseAdmin
    .from('boost_pack_purchases')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  console.log('\n📦 Boost Pack Purchases:', purchases?.length || 0);
  purchases?.forEach(purchase => {
    console.log('---');
    console.log('ID:', purchase.id);
    console.log('Created:', purchase.created_at);
    console.log('Credits:', purchase.credits_purchased);
    console.log('Bonus:', purchase.bonus_credits);
    console.log('Amount:', purchase.amount_paid_cents, 'cents');
    console.log('Stripe Payment Intent:', purchase.stripe_payment_intent_id);
    console.log('Applied:', purchase.credits_applied, 'at', purchase.applied_at);
  });

  // Check subscription_invoices
  const { data: invoices } = await supabaseAdmin
    .from('subscription_invoices')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  console.log('\n📄 Subscription Invoices:', invoices?.length || 0);
  invoices?.forEach(invoice => {
    console.log('---');
    console.log('ID:', invoice.id);
    console.log('Created:', invoice.created_at);
    console.log('Credits allocated:', invoice.credits_allocated);
    console.log('Amount due:', invoice.amount_due);
    console.log('Amount paid:', invoice.amount_paid);
    console.log('Status:', invoice.status);
    console.log('Stripe Invoice ID:', invoice.stripe_invoice_id);
  });

  // Check user_subscriptions
  const { data: subscription } = await supabaseAdmin
    .from('user_subscriptions')
    .select('*')
    .eq('user_id', userId)
    .single();

  console.log('\n💳 User Subscription:');
  console.log('Balance:', subscription?.balance, 'tokens =', (subscription?.balance || 0) / 10, 'Pilot Credits');
  console.log('Total earned:', subscription?.total_earned);
  console.log('Total spent:', subscription?.total_spent);
  console.log('Status:', subscription?.status);
  console.log('Stripe Customer ID:', subscription?.stripe_customer_id);
  console.log('Stripe Subscription ID:', subscription?.stripe_subscription_id);

  // Check billing_events
  const { data: events } = await supabaseAdmin
    .from('billing_events')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  console.log('\n📋 Billing Events:', events?.length || 0);
  events?.forEach(event => {
    console.log('---');
    console.log('Created:', event.created_at);
    console.log('Type:', event.event_type);
    console.log('Description:', event.description);
    console.log('Credits delta:', event.credits_delta);
    console.log('Amount:', event.amount_cents, 'cents');
  });
}

findStripeTransaction().then(() => {
  console.log('\n✅ Done!');
  process.exit(0);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
