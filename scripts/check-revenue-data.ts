/**
 * Script to check revenue data in the database
 * Helps diagnose why dashboard/reports show 0 for revenue
 *
 * Run with: npx tsx scripts/check-revenue-data.ts
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkRevenueData() {
  console.log('='.repeat(60));
  console.log('REVENUE DATA DIAGNOSTIC');
  console.log('='.repeat(60));

  // Calculate date ranges
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  console.log('\nDate Ranges:');
  console.log(`  Now:             ${now.toISOString()}`);
  console.log(`  7 days ago:      ${sevenDaysAgo}`);
  console.log(`  14 days ago:     ${fourteenDaysAgo}`);
  console.log(`  30 days ago:     ${thirtyDaysAgo}`);

  // 1. Check payment_transactions table
  console.log('\n' + '-'.repeat(60));
  console.log('1. PAYMENT TRANSACTIONS TABLE');
  console.log('-'.repeat(60));

  // Total count
  const { count: totalTransactions } = await supabase
    .from('payment_transactions')
    .select('*', { count: 'exact', head: true });

  console.log(`\nTotal transactions in table: ${totalTransactions || 0}`);

  // By status
  const { data: transactionsByStatus } = await supabase
    .from('payment_transactions')
    .select('status, amount, created_at')
    .order('created_at', { ascending: false })
    .limit(100);

  if (transactionsByStatus && transactionsByStatus.length > 0) {
    const statusCounts: Record<string, { count: number; total: number }> = {};
    transactionsByStatus.forEach((t: any) => {
      if (!statusCounts[t.status]) {
        statusCounts[t.status] = { count: 0, total: 0 };
      }
      statusCounts[t.status].count++;
      statusCounts[t.status].total += t.amount || 0;
    });

    console.log('\nTransactions by status (last 100):');
    Object.entries(statusCounts).forEach(([status, data]) => {
      console.log(`  ${status}: ${data.count} transactions, total: $${data.total.toFixed(2)}`);
    });

    // Show recent transactions
    console.log('\nMost recent transactions:');
    transactionsByStatus.slice(0, 5).forEach((t: any) => {
      console.log(`  ${t.created_at} | ${t.status} | $${t.amount}`);
    });
  } else {
    console.log('\n⚠️  No transactions found in payment_transactions table');
  }

  // Succeeded transactions in date ranges
  const { data: succeededThisWeek } = await supabase
    .from('payment_transactions')
    .select('amount, created_at')
    .eq('status', 'succeeded')
    .gte('created_at', sevenDaysAgo);

  const { data: succeededLastWeek } = await supabase
    .from('payment_transactions')
    .select('amount, created_at')
    .eq('status', 'succeeded')
    .gte('created_at', fourteenDaysAgo)
    .lt('created_at', sevenDaysAgo);

  const { data: succeeded30d } = await supabase
    .from('payment_transactions')
    .select('amount, created_at')
    .eq('status', 'succeeded')
    .gte('created_at', thirtyDaysAgo);

  const thisWeekTotal = (succeededThisWeek || []).reduce((sum: number, t: any) => sum + (t.amount || 0), 0);
  const lastWeekTotal = (succeededLastWeek || []).reduce((sum: number, t: any) => sum + (t.amount || 0), 0);
  const thirtyDayTotal = (succeeded30d || []).reduce((sum: number, t: any) => sum + (t.amount || 0), 0);

  console.log('\nSucceeded transactions by date range:');
  console.log(`  This week (last 7 days):  ${succeededThisWeek?.length || 0} transactions, total: $${thisWeekTotal.toFixed(2)}`);
  console.log(`  Last week (7-14 days):    ${succeededLastWeek?.length || 0} transactions, total: $${lastWeekTotal.toFixed(2)}`);
  console.log(`  Last 30 days:             ${succeeded30d?.length || 0} transactions, total: $${thirtyDayTotal.toFixed(2)}`);

  // 2. Check scheduling_bookings table
  console.log('\n' + '-'.repeat(60));
  console.log('2. SCHEDULING BOOKINGS TABLE');
  console.log('-'.repeat(60));

  // Total count
  const { count: totalBookings } = await supabase
    .from('scheduling_bookings')
    .select('*', { count: 'exact', head: true });

  console.log(`\nTotal bookings in table: ${totalBookings || 0}`);

  // By status
  const { data: bookingsByStatus } = await supabase
    .from('scheduling_bookings')
    .select('status, total_amount, start_time, payment_status')
    .order('start_time', { ascending: false })
    .limit(100);

  if (bookingsByStatus && bookingsByStatus.length > 0) {
    const statusCounts: Record<string, { count: number; total: number }> = {};
    bookingsByStatus.forEach((b: any) => {
      if (!statusCounts[b.status]) {
        statusCounts[b.status] = { count: 0, total: 0 };
      }
      statusCounts[b.status].count++;
      statusCounts[b.status].total += b.total_amount || 0;
    });

    console.log('\nBookings by status (last 100):');
    Object.entries(statusCounts).forEach(([status, data]) => {
      console.log(`  ${status}: ${data.count} bookings, total_amount: $${data.total.toFixed(2)}`);
    });

    // Show recent bookings with amounts
    console.log('\nMost recent bookings with amounts:');
    bookingsByStatus
      .filter((b: any) => b.total_amount && b.total_amount > 0)
      .slice(0, 5)
      .forEach((b: any) => {
        console.log(`  ${b.start_time} | ${b.status} | $${b.total_amount} | payment: ${b.payment_status || 'N/A'}`);
      });
  } else {
    console.log('\n⚠️  No bookings found in scheduling_bookings table');
  }

  // Completed bookings in date ranges
  const { data: completedThisWeek } = await supabase
    .from('scheduling_bookings')
    .select('total_amount, start_time')
    .eq('status', 'completed')
    .gte('start_time', sevenDaysAgo);

  const { data: completedLastWeek } = await supabase
    .from('scheduling_bookings')
    .select('total_amount, start_time')
    .eq('status', 'completed')
    .gte('start_time', fourteenDaysAgo)
    .lt('start_time', sevenDaysAgo);

  const { data: completed30d } = await supabase
    .from('scheduling_bookings')
    .select('total_amount, start_time')
    .eq('status', 'completed')
    .gte('start_time', thirtyDaysAgo);

  const bookingThisWeekTotal = (completedThisWeek || []).reduce((sum: number, b: any) => sum + (b.total_amount || 0), 0);
  const bookingLastWeekTotal = (completedLastWeek || []).reduce((sum: number, b: any) => sum + (b.total_amount || 0), 0);
  const booking30dTotal = (completed30d || []).reduce((sum: number, b: any) => sum + (b.total_amount || 0), 0);

  console.log('\nCompleted bookings by date range:');
  console.log(`  This week (last 7 days):  ${completedThisWeek?.length || 0} bookings, total_amount: $${bookingThisWeekTotal.toFixed(2)}`);
  console.log(`  Last week (7-14 days):    ${completedLastWeek?.length || 0} bookings, total_amount: $${bookingLastWeekTotal.toFixed(2)}`);
  console.log(`  Last 30 days:             ${completed30d?.length || 0} bookings, total_amount: $${booking30dTotal.toFixed(2)}`);

  // 3. Check payment_invoices table
  console.log('\n' + '-'.repeat(60));
  console.log('3. PAYMENT INVOICES TABLE');
  console.log('-'.repeat(60));

  const { count: totalInvoices } = await supabase
    .from('payment_invoices')
    .select('*', { count: 'exact', head: true });

  console.log(`\nTotal invoices in table: ${totalInvoices || 0}`);

  const { data: invoicesByStatus } = await supabase
    .from('payment_invoices')
    .select('status, amount, created_at')
    .order('created_at', { ascending: false })
    .limit(50);

  if (invoicesByStatus && invoicesByStatus.length > 0) {
    const statusCounts: Record<string, { count: number; total: number }> = {};
    invoicesByStatus.forEach((inv: any) => {
      if (!statusCounts[inv.status]) {
        statusCounts[inv.status] = { count: 0, total: 0 };
      }
      statusCounts[inv.status].count++;
      statusCounts[inv.status].total += inv.amount || 0;
    });

    console.log('\nInvoices by status (last 50):');
    Object.entries(statusCounts).forEach(([status, data]) => {
      console.log(`  ${status}: ${data.count} invoices, total: $${data.total.toFixed(2)}`);
    });
  }

  // 4. Check paid invoices by date range
  console.log('\n' + '-'.repeat(60));
  console.log('4. PAID INVOICES BY DATE RANGE');
  console.log('-'.repeat(60));

  const { data: paidInvoicesThisWeek } = await supabase
    .from('payment_invoices')
    .select('amount, paid_at')
    .eq('status', 'paid')
    .gte('paid_at', sevenDaysAgo);

  const { data: paidInvoicesLastWeek } = await supabase
    .from('payment_invoices')
    .select('amount, paid_at')
    .eq('status', 'paid')
    .gte('paid_at', fourteenDaysAgo)
    .lt('paid_at', sevenDaysAgo);

  const { data: paidInvoices30d } = await supabase
    .from('payment_invoices')
    .select('amount, paid_at')
    .eq('status', 'paid')
    .gte('paid_at', thirtyDaysAgo);

  const invoiceThisWeekTotal = (paidInvoicesThisWeek || []).reduce((sum: number, inv: any) => sum + (inv.amount || 0), 0);
  const invoiceLastWeekTotal = (paidInvoicesLastWeek || []).reduce((sum: number, inv: any) => sum + (inv.amount || 0), 0);
  const invoice30dTotal = (paidInvoices30d || []).reduce((sum: number, inv: any) => sum + (inv.amount || 0), 0);

  console.log('\nPaid invoices by date range:');
  console.log(`  This week (last 7 days):  ${paidInvoicesThisWeek?.length || 0} invoices, total: $${invoiceThisWeekTotal.toFixed(2)}`);
  console.log(`  Last week (7-14 days):    ${paidInvoicesLastWeek?.length || 0} invoices, total: $${invoiceLastWeekTotal.toFixed(2)}`);
  console.log(`  Last 30 days:             ${paidInvoices30d?.length || 0} invoices, total: $${invoice30dTotal.toFixed(2)}`);

  // Show recent paid invoices
  if (paidInvoices30d && paidInvoices30d.length > 0) {
    console.log('\nRecent paid invoices:');
    paidInvoices30d.slice(0, 5).forEach((inv: any) => {
      console.log(`  ${inv.paid_at} | $${inv.amount}`);
    });
  }

  // 5. Summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY - EXPECTED VALUES IN DASHBOARD');
  console.log('='.repeat(60));

  const combinedThisWeek = thisWeekTotal + bookingThisWeekTotal + invoiceThisWeekTotal;
  const combinedLastWeek = lastWeekTotal + bookingLastWeekTotal + invoiceLastWeekTotal;
  const combined30d = thirtyDayTotal + booking30dTotal + invoice30dTotal;

  console.log('\nRevenue calculations:');
  console.log(`  revenue_this_week = payment_transactions + booking_revenue + paid_invoices`);
  console.log(`                    = $${thisWeekTotal.toFixed(2)} + $${bookingThisWeekTotal.toFixed(2)} + $${invoiceThisWeekTotal.toFixed(2)} = $${combinedThisWeek.toFixed(2)}`);
  console.log(`  revenue_last_week = payment_transactions + booking_revenue + paid_invoices`);
  console.log(`                    = $${lastWeekTotal.toFixed(2)} + $${bookingLastWeekTotal.toFixed(2)} + $${invoiceLastWeekTotal.toFixed(2)} = $${combinedLastWeek.toFixed(2)}`);
  console.log(`  revenue_30d       = payment_transactions + booking_revenue + paid_invoices`);
  console.log(`                    = $${thirtyDayTotal.toFixed(2)} + $${booking30dTotal.toFixed(2)} + $${invoice30dTotal.toFixed(2)} = $${combined30d.toFixed(2)}`);

  if (combinedThisWeek === 0 && combinedLastWeek === 0 && combined30d === 0) {
    console.log('\n⚠️  ALL REVENUE IS $0 - POSSIBLE CAUSES:');
    console.log('   1. No payment_transactions with status="succeeded" in the date range');
    console.log('   2. No scheduling_bookings with status="completed" in the date range');
    console.log('   3. Bookings exist but total_amount is null/0');
    console.log('   4. Transactions exist but amount is null/0');
    console.log('   5. Data exists but for a different user_id');
  }

  // 6. Check if there's any data at all (any user)
  console.log('\n' + '-'.repeat(60));
  console.log('5. DATA EXISTENCE CHECK (ALL USERS)');
  console.log('-'.repeat(60));

  const { data: anyTransactions } = await supabase
    .from('payment_transactions')
    .select('user_id, amount, status, created_at')
    .eq('status', 'succeeded')
    .limit(5);

  if (anyTransactions && anyTransactions.length > 0) {
    console.log('\nSucceeded transactions exist for users:');
    anyTransactions.forEach((t: any) => {
      console.log(`  user: ${t.user_id.substring(0, 8)}... | $${t.amount} | ${t.created_at}`);
    });
  } else {
    console.log('\n⚠️  No succeeded transactions found for ANY user');
  }

  const { data: anyCompletedBookings } = await supabase
    .from('scheduling_bookings')
    .select('user_id, total_amount, status, start_time')
    .eq('status', 'completed')
    .not('total_amount', 'is', null)
    .gt('total_amount', 0)
    .limit(5);

  if (anyCompletedBookings && anyCompletedBookings.length > 0) {
    console.log('\nCompleted bookings with revenue exist for users:');
    anyCompletedBookings.forEach((b: any) => {
      console.log(`  user: ${b.user_id.substring(0, 8)}... | $${b.total_amount} | ${b.start_time}`);
    });
  } else {
    console.log('\n⚠️  No completed bookings with total_amount > 0 found for ANY user');
  }

  console.log('\n' + '='.repeat(60));
  console.log('DIAGNOSTIC COMPLETE');
  console.log('='.repeat(60));
}

checkRevenueData().catch(console.error);
