/**
 * Debug script to check actual Stripe account status
 * Run: npx tsx scripts/check-stripe-account-status.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!stripeSecretKey || !supabaseUrl || !supabaseServiceKey) {
    console.error('Missing required env vars');
    process.exit(1);
  }

  const stripe = new Stripe(stripeSecretKey, { apiVersion: '2025-10-29.clover' as any });
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Get all stripe_connect_accounts
  const { data: accounts, error } = await supabase
    .from('stripe_connect_accounts')
    .select('*');

  if (error) {
    console.error('DB Error:', error);
    process.exit(1);
  }

  console.log('\n=== Database Records ===');
  console.log(JSON.stringify(accounts, null, 2));

  if (!accounts || accounts.length === 0) {
    console.log('\nNo accounts in database');
    return;
  }

  console.log('\n=== Stripe API Status ===');
  for (const acc of accounts) {
    try {
      const stripeAccount = await stripe.accounts.retrieve(acc.stripe_account_id);
      console.log('\nAccount:', acc.stripe_account_id);
      console.log('  charges_enabled:', stripeAccount.charges_enabled);
      console.log('  payouts_enabled:', stripeAccount.payouts_enabled);
      console.log('  details_submitted:', stripeAccount.details_submitted);
      console.log('  requirements.currently_due:', stripeAccount.requirements?.currently_due);
      console.log('  requirements.eventually_due:', stripeAccount.requirements?.eventually_due);
    } catch (err: any) {
      console.log('\nAccount:', acc.stripe_account_id, '- ERROR:', err.message);
    }
  }
}

main().catch(console.error);
