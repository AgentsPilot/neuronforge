// Test complete reactivation flow
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

async function testReactivationFlow() {
  const userId = '08456106-aa50-4810-b12c-7ca84102da31';

  console.log('🔍 Testing Reactivation Flow for user:', userId);
  console.log('='.repeat(60));

  // Check current subscription status
  const { data: beforeSub, error: beforeError } = await supabaseAdmin
    .from('user_subscriptions')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (beforeError) {
    console.error('❌ Error fetching subscription:', beforeError);
    return;
  }

  console.log('\n📊 Current Subscription Status:');
  console.log('  Status:', beforeSub.status);
  console.log('  cancel_at_period_end:', beforeSub.cancel_at_period_end);
  console.log('  canceled_at:', beforeSub.canceled_at);
  console.log('  current_period_end:', beforeSub.current_period_end);
  console.log('  monthly_credits:', beforeSub.monthly_credits);
  console.log('  monthly_amount_usd:', beforeSub.monthly_amount_usd);

  if (beforeSub.cancel_at_period_end) {
    console.log('\n✅ Subscription is currently set to cancel - ready to test reactivation');
    console.log('   Access ends:', beforeSub.current_period_end);
  } else {
    console.log('\n⚠️  Subscription is NOT set to cancel - cancel it first to test reactivation');
    console.log('   Use: http://localhost:3000/settings (Billing tab -> Cancel button)');
  }

  // Check UI features that should be affected
  console.log('\n🎨 UI Elements to Verify:');
  console.log('  1. Status Cards:');
  if (beforeSub.cancel_at_period_end) {
    console.log('     ✓ "Next Billing" should show as RED "Ends On"');
    console.log('     ✓ "Next Cycle Credits" should be grayed out with strikethrough');
    console.log('     ✓ "Next Cycle Cost" should be grayed out with strikethrough');
  } else {
    console.log('     ✓ "Next Billing" should show as GREEN');
    console.log('     ✓ "Next Cycle Credits" should be ORANGE (active)');
    console.log('     ✓ "Next Cycle Cost" should be ORANGE (active)');
  }

  console.log('  2. Warning Banner:');
  if (beforeSub.cancel_at_period_end) {
    console.log('     ✓ ORANGE warning banner should be visible');
    console.log('     ✓ "Reactivate Subscription" button should be present');
  } else {
    console.log('     ✓ No warning banner (subscription is active)');
  }

  console.log('  3. Credits Tab:');
  if (beforeSub.cancel_at_period_end) {
    console.log('     ✓ Tab should be DISABLED with overlay');
    console.log('     ✓ Overlay shows "Subscription Canceling" message');
    console.log('     ✓ "Reactivate Subscription" button in overlay');
  } else {
    console.log('     ✓ Tab should be ENABLED (no overlay)');
  }

  console.log('  4. Subscription Tab Buttons:');
  if (beforeSub.cancel_at_period_end) {
    console.log('     ✓ "Cancel" button should NOT be visible');
    console.log('     ✓ "Update Payment" button should still be visible');
  } else {
    console.log('     ✓ RED "Cancel" button should be visible');
    console.log('     ✓ "Update Payment" button should be visible');
  }

  // Instructions for testing
  console.log('\n📋 Test Steps:');
  console.log('  1. Open http://localhost:3000/settings (Billing tab)');
  if (beforeSub.cancel_at_period_end) {
    console.log('  2. Click "Reactivate Subscription" button (in warning banner or Credits tab)');
    console.log('  3. Review reactivation modal:');
    console.log(`     - Monthly Credits: ${beforeSub.monthly_credits?.toLocaleString() || 0} credits`);
    console.log(`     - Next Billing Date: ${beforeSub.current_period_end}`);
    console.log(`     - Monthly Amount: $${beforeSub.monthly_amount_usd?.toFixed(2) || '0.00'}/mo`);
    console.log('  4. Click "Yes, Reactivate" button');
    console.log('  5. Verify all UI elements update:');
    console.log('     - Status cards change back to active (green/orange)');
    console.log('     - Orange warning banner disappears');
    console.log('     - Credits tab overlay disappears (tab is enabled)');
    console.log('     - "Cancel" button reappears in Subscription tab');
  } else {
    console.log('  2. First, cancel the subscription to test reactivation');
    console.log('  3. Then run this script again');
  }

  console.log('\n🔧 API Endpoints Used:');
  console.log('  POST /api/stripe/reactivate-subscription');
  console.log('    - Updates Stripe: cancel_at_period_end = false');
  console.log('    - Updates DB: cancel_at_period_end = false, canceled_at = null');
  console.log('    - Logs audit trail: SUBSCRIPTION_REACTIVATED');

  console.log('\n🪝 Webhook Handling:');
  console.log('  Event: customer.subscription.updated');
  console.log('  Syncs: cancel_at_period_end, canceled_at, status, monthly_credits, monthly_amount_usd');

  console.log('\n' + '='.repeat(60));
  console.log('✅ Reactivation flow is ready to test!');
}

testReactivationFlow().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
