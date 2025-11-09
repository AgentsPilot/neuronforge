// Script to check Stripe webhook status and recent events
// Run with: npx tsx scripts/check-stripe-webhook-status.ts

import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-11-20.acacia'
});

async function checkWebhookStatus() {
  console.log('\n🔍 Stripe Webhook Status Check\n');
  console.log('='.repeat(60));

  try {
    // 1. Check recent payment intents
    console.log('\n1️⃣ Recent Payment Intents (last 5):');
    const paymentIntents = await stripe.paymentIntents.list({
      limit: 5
    });

    if (paymentIntents.data.length === 0) {
      console.log('❌ No payment intents found');
    } else {
      console.log(`✅ Found ${paymentIntents.data.length} payment intent(s):\n`);
      paymentIntents.data.forEach((pi, i) => {
        console.log(`   Payment #${i + 1}:`);
        console.log(`   - ID: ${pi.id}`);
        console.log(`   - Amount: $${(pi.amount / 100).toFixed(2)} ${pi.currency.toUpperCase()}`);
        console.log(`   - Status: ${pi.status}`);
        console.log(`   - Created: ${new Date(pi.created * 1000).toISOString()}`);
        console.log(`   - Metadata:`, JSON.stringify(pi.metadata, null, 2));
        console.log('');
      });
    }

    // 2. Check recent checkout sessions
    console.log('\n2️⃣ Recent Checkout Sessions (last 5):');
    const sessions = await stripe.checkout.sessions.list({
      limit: 5
    });

    if (sessions.data.length === 0) {
      console.log('❌ No checkout sessions found');
    } else {
      console.log(`✅ Found ${sessions.data.length} checkout session(s):\n`);
      sessions.data.forEach((session, i) => {
        console.log(`   Session #${i + 1}:`);
        console.log(`   - ID: ${session.id}`);
        console.log(`   - Status: ${session.status}`);
        console.log(`   - Payment Status: ${session.payment_status}`);
        console.log(`   - Mode: ${session.mode}`);
        console.log(`   - Amount: $${((session.amount_total || 0) / 100).toFixed(2)}`);
        console.log(`   - Created: ${new Date(session.created * 1000).toISOString()}`);
        console.log(`   - Payment Intent: ${session.payment_intent || 'N/A'}`);
        console.log(`   - Metadata:`);
        console.log(`     - user_id: ${session.metadata?.user_id || 'MISSING!'}`);
        console.log(`     - boost_pack_id: ${session.metadata?.boost_pack_id || 'MISSING!'}`);
        console.log(`     - credits: ${session.metadata?.credits || 'MISSING!'}`);
        console.log(`     - purchase_type: ${session.metadata?.purchase_type || 'MISSING!'}`);
        console.log('');
      });
    }

    // 3. Check recent webhook events
    console.log('\n3️⃣ Recent Webhook Events (last 10):');
    const events = await stripe.events.list({
      limit: 10,
      types: ['checkout.session.completed']
    });

    if (events.data.length === 0) {
      console.log('❌ No checkout.session.completed events found');
      console.log('   This means webhook events are not being created!');
    } else {
      console.log(`✅ Found ${events.data.length} checkout.session.completed event(s):\n`);
      events.data.forEach((event, i) => {
        const session = event.data.object as Stripe.Checkout.Session;
        console.log(`   Event #${i + 1}:`);
        console.log(`   - Event ID: ${event.id}`);
        console.log(`   - Created: ${new Date(event.created * 1000).toISOString()}`);
        console.log(`   - Session ID: ${session.id}`);
        console.log(`   - Payment Status: ${session.payment_status}`);
        console.log(`   - Mode: ${session.mode}`);
        console.log(`   - Amount: $${((session.amount_total || 0) / 100).toFixed(2)}`);
        console.log(`   - Metadata:`);
        console.log(`     - user_id: ${session.metadata?.user_id || 'MISSING!'}`);
        console.log(`     - boost_pack_id: ${session.metadata?.boost_pack_id || 'MISSING!'}`);
        console.log(`     - credits: ${session.metadata?.credits || 'MISSING!'}`);
        console.log(`     - purchase_type: ${session.metadata?.purchase_type || 'MISSING!'}`);
        console.log('');
      });
    }

    // 4. Get webhook endpoints
    console.log('\n4️⃣ Configured Webhook Endpoints:');
    const webhooks = await stripe.webhookEndpoints.list({
      limit: 10
    });

    if (webhooks.data.length === 0) {
      console.log('❌ No webhook endpoints configured!');
      console.log('   This is the problem! You need to configure a webhook endpoint.');
      console.log('\n   Steps to fix:');
      console.log('   1. Go to: https://dashboard.stripe.com/webhooks');
      console.log('   2. Click "Add endpoint"');
      console.log('   3. Set URL to: https://your-domain.com/api/stripe/webhook');
      console.log('   4. Select events: checkout.session.completed');
      console.log('   5. Copy the webhook signing secret to .env as STRIPE_WEBHOOK_SECRET');
    } else {
      console.log(`✅ Found ${webhooks.data.length} webhook endpoint(s):\n`);
      webhooks.data.forEach((webhook, i) => {
        console.log(`   Webhook #${i + 1}:`);
        console.log(`   - ID: ${webhook.id}`);
        console.log(`   - URL: ${webhook.url}`);
        console.log(`   - Status: ${webhook.status}`);
        console.log(`   - Enabled Events: ${webhook.enabled_events.join(', ')}`);
        console.log(`   - API Version: ${webhook.api_version || 'N/A'}`);
        console.log('');
      });
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('\n📋 DIAGNOSIS:\n');

    const hasPayments = paymentIntents.data.length > 0;
    const hasSessions = sessions.data.length > 0;
    const hasEvents = events.data.length > 0;
    const hasWebhooks = webhooks.data.length > 0;

    if (!hasWebhooks) {
      console.log('❌ CRITICAL: No webhook endpoints configured in Stripe!');
      console.log('\n   This is why payments are not being processed.');
      console.log('   Your app cannot receive notifications about completed checkouts.');
      console.log('\n   Action Required:');
      console.log('   1. Configure webhook endpoint in Stripe Dashboard');
      console.log('   2. Set STRIPE_WEBHOOK_SECRET in your .env file');
      console.log('   3. Restart your application');
    } else if (!hasEvents) {
      console.log('⚠️  Webhook is configured but no events received yet');
      console.log('\n   This could mean:');
      console.log('   - Recent purchases were made before webhook was configured');
      console.log('   - Webhook is not receiving events (check URL is correct)');
      console.log('   - Events are being filtered out');
    } else {
      console.log('✅ Webhooks are configured and events are being created');
      console.log('\n   Next step: Check if your webhook endpoint is responding correctly');
      console.log('   - Check application logs for webhook processing');
      console.log('   - Verify STRIPE_WEBHOOK_SECRET matches Stripe Dashboard');
      console.log('   - Test webhook endpoint is accessible from internet');
    }

    if (hasSessions) {
      const latestSession = sessions.data[0];
      const missingMetadata =
        !latestSession.metadata?.user_id ||
        !latestSession.metadata?.boost_pack_id ||
        !latestSession.metadata?.purchase_type;

      if (missingMetadata) {
        console.log('\n⚠️  WARNING: Latest checkout session is missing required metadata!');
        console.log('   Missing fields:');
        if (!latestSession.metadata?.user_id) console.log('   - user_id');
        if (!latestSession.metadata?.boost_pack_id) console.log('   - boost_pack_id');
        if (!latestSession.metadata?.purchase_type) console.log('   - purchase_type');
        console.log('\n   This will cause webhook processing to fail.');
      }
    }

    console.log('\n📖 For more debugging info, see: docs/DEBUG_BOOST_PACK_PURCHASE.md\n');

  } catch (error: any) {
    console.error('\n❌ Error checking Stripe:', error.message);
    if (error.type === 'StripeAuthenticationError') {
      console.log('\n⚠️  Authentication failed. Check your STRIPE_SECRET_KEY in .env');
    }
  }
}

checkWebhookStatus();
