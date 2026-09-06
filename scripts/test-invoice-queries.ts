import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing env vars');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  // Check payment_invoices for user_ids
  const { data: invoices } = await supabase
    .from('payment_invoices')
    .select('user_id, status, amount, paid_at')
    .eq('status', 'paid')
    .limit(10);

  console.log('Paid invoices:');
  if (invoices && invoices.length > 0) {
    invoices.forEach(inv => {
      console.log('  user:', inv.user_id?.substring(0,8) + '...', '| amount:', inv.amount, '| paid_at:', inv.paid_at);
    });

    // Get unique user_id
    const userId = invoices[0]?.user_id;
    if (userId) {
      console.log('\nTesting with user_id:', userId);

      // Calculate dates
      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

      console.log('\nDate ranges:');
      console.log('  7 days ago:', sevenDaysAgo);
      console.log('  14 days ago:', fourteenDaysAgo);
      console.log('  30 days ago:', thirtyDaysAgo);

      // Query with user_id filter
      const { data: inv30d } = await supabase
        .from('payment_invoices')
        .select('amount, paid_at')
        .eq('user_id', userId)
        .eq('status', 'paid')
        .gte('paid_at', thirtyDaysAgo);

      const total = (inv30d || []).reduce((s: number, i: any) => s + (i.amount || 0), 0);
      console.log('\n30d invoices for this user:', inv30d?.length, 'Total: $' + total);

      const { data: invThisWeek } = await supabase
        .from('payment_invoices')
        .select('amount, paid_at')
        .eq('user_id', userId)
        .eq('status', 'paid')
        .gte('paid_at', sevenDaysAgo);

      const thisWeekTotal = (invThisWeek || []).reduce((s: number, i: any) => s + (i.amount || 0), 0);
      console.log('This week:', invThisWeek?.length, 'Total: $' + thisWeekTotal);

      const { data: invLastWeek } = await supabase
        .from('payment_invoices')
        .select('amount, paid_at')
        .eq('user_id', userId)
        .eq('status', 'paid')
        .gte('paid_at', fourteenDaysAgo)
        .lt('paid_at', sevenDaysAgo);

      const lastWeekTotal = (invLastWeek || []).reduce((s: number, i: any) => s + (i.amount || 0), 0);
      console.log('Last week:', invLastWeek?.length, 'Total: $' + lastWeekTotal);

      console.log('\n=== EXPECTED DASHBOARD VALUES ===');
      console.log('revenue_this_week:', thisWeekTotal);
      console.log('revenue_last_week:', lastWeekTotal);
      console.log('revenue_30d:', total);
    }
  } else {
    console.log('No paid invoices found');
  }
}

check().catch(console.error);
