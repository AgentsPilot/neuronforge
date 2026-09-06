/**
 * Script to test the stats API query logic directly
 * Run with: npx tsx scripts/test-stats-api.ts
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function testStatsApi() {
  console.log('Testing Stats API Query Logic\n');

  // Get a user ID to test with
  const { data: users } = await supabase
    .from('profiles')
    .select('id, email')
    .limit(5);

  if (!users || users.length === 0) {
    console.log('No users found');
    return;
  }

  console.log('Available users:');
  users.forEach((u, i) => console.log(`  ${i + 1}. ${u.email} (${u.id})`));

  // Use first user
  const userId = users[0].id;
  console.log(`\nTesting with user: ${users[0].email}\n`);

  // Calculate date ranges
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Test payment transactions query
  console.log('1. Payment Transactions (succeeded):');
  const { data: paymentTx, error: paymentErr } = await supabase
    .from('payment_transactions')
    .select('amount')
    .eq('user_id', userId)
    .eq('status', 'succeeded')
    .gte('created_at', thirtyDaysAgo);

  if (paymentErr) console.log('   Error:', paymentErr.message);
  else {
    const total = (paymentTx || []).reduce((sum, t) => sum + (t.amount || 0), 0);
    console.log(`   Count: ${paymentTx?.length || 0}, Total: $${total}`);
  }

  // Test completed bookings query
  console.log('\n2. Completed Bookings (with total_amount):');
  const { data: bookings, error: bookingsErr } = await supabase
    .from('scheduling_bookings')
    .select('total_amount')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .gte('start_time', thirtyDaysAgo);

  if (bookingsErr) console.log('   Error:', bookingsErr.message);
  else {
    const total = (bookings || []).reduce((sum, b) => sum + (b.total_amount || 0), 0);
    console.log(`   Count: ${bookings?.length || 0}, Total: $${total}`);
  }

  // Test paid invoices query - THIS IS THE KEY ONE
  console.log('\n3. Paid Invoices (using paid_at):');

  // 30 days
  const { data: paidInvoices30d, error: invErr30d } = await supabase
    .from('payment_invoices')
    .select('amount, paid_at')
    .eq('user_id', userId)
    .eq('status', 'paid')
    .gte('paid_at', thirtyDaysAgo);

  if (invErr30d) console.log('   30d Error:', invErr30d.message);
  else {
    const total = (paidInvoices30d || []).reduce((sum, inv) => sum + (inv.amount || 0), 0);
    console.log(`   30d - Count: ${paidInvoices30d?.length || 0}, Total: $${total}`);
  }

  // This week
  const { data: paidInvoicesThisWeek } = await supabase
    .from('payment_invoices')
    .select('amount, paid_at')
    .eq('user_id', userId)
    .eq('status', 'paid')
    .gte('paid_at', sevenDaysAgo);

  const thisWeekTotal = (paidInvoicesThisWeek || []).reduce((sum, inv) => sum + (inv.amount || 0), 0);
  console.log(`   This week - Count: ${paidInvoicesThisWeek?.length || 0}, Total: $${thisWeekTotal}`);

  // Last week
  const { data: paidInvoicesLastWeek } = await supabase
    .from('payment_invoices')
    .select('amount, paid_at')
    .eq('user_id', userId)
    .eq('status', 'paid')
    .gte('paid_at', fourteenDaysAgo)
    .lt('paid_at', sevenDaysAgo);

  const lastWeekTotal = (paidInvoicesLastWeek || []).reduce((sum, inv) => sum + (inv.amount || 0), 0);
  console.log(`   Last week - Count: ${paidInvoicesLastWeek?.length || 0}, Total: $${lastWeekTotal}`);

  // Check if invoices have paid_at field populated
  console.log('\n4. Checking paid invoices data quality:');
  const { data: allPaidInvoices } = await supabase
    .from('payment_invoices')
    .select('id, amount, status, paid_at, created_at')
    .eq('user_id', userId)
    .eq('status', 'paid');

  if (allPaidInvoices && allPaidInvoices.length > 0) {
    console.log(`   Total paid invoices: ${allPaidInvoices.length}`);
    allPaidInvoices.forEach(inv => {
      console.log(`   - $${inv.amount} | paid_at: ${inv.paid_at || 'NULL'} | created_at: ${inv.created_at}`);
    });

    const withPaidAt = allPaidInvoices.filter(inv => inv.paid_at);
    const withoutPaidAt = allPaidInvoices.filter(inv => !inv.paid_at);
    console.log(`\n   With paid_at: ${withPaidAt.length}`);
    console.log(`   Without paid_at (NULL): ${withoutPaidAt.length}`);

    if (withoutPaidAt.length > 0) {
      console.log('\n   ⚠️  Some paid invoices are missing paid_at date!');
      console.log('   The query filters by paid_at, so these invoices are NOT counted.');
    }
  } else {
    console.log('   No paid invoices found for this user');
  }

  // Calculate expected values
  console.log('\n' + '='.repeat(50));
  console.log('EXPECTED VALUES FOR THIS USER:');
  console.log('='.repeat(50));

  const paymentTxTotal = (paymentTx || []).reduce((sum, t) => sum + (t.amount || 0), 0);
  const bookingsTotal = (bookings || []).reduce((sum, b) => sum + (b.total_amount || 0), 0);
  const invoices30dTotal = (paidInvoices30d || []).reduce((sum, inv) => sum + (inv.amount || 0), 0);

  console.log(`\nrevenue_30d = $${paymentTxTotal} + $${bookingsTotal} + $${invoices30dTotal} = $${paymentTxTotal + bookingsTotal + invoices30dTotal}`);
  console.log(`revenue_this_week = $${thisWeekTotal}`);
  console.log(`revenue_last_week = $${lastWeekTotal}`);
}

testStatsApi().catch(console.error);
