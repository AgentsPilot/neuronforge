// scripts/check-stripe-connect.ts
// Run with: npx tsx scripts/check-stripe-connect.ts

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function main() {
  console.log('Checking stripe_connect_accounts table...\n');

  // Get all stripe connect accounts
  const { data: accounts, error: accountsError } = await supabase
    .from('stripe_connect_accounts')
    .select('*');

  if (accountsError) {
    console.error('Error fetching accounts:', accountsError);
    return;
  }

  console.log('All Stripe Connect Accounts:');
  console.log(JSON.stringify(accounts, null, 2));
  console.log('\n---\n');

  // Get all users from auth.users
  const { data: users, error: usersError } = await supabase.auth.admin.listUsers();

  if (usersError) {
    console.error('Error fetching users:', usersError);
    return;
  }

  console.log('Users with "offir" in email:');
  for (const user of users?.users || []) {
    if (user.email?.includes('offir')) {
      console.log(`  - ${user.email} (id: ${user.id})`);
    }
  }
  console.log('\n---\n');

  // Check if account user_ids match any users
  if (accounts && accounts.length > 0) {
    for (const account of accounts) {
      const matchingUser = users?.users?.find(u => u.id === account.user_id);
      console.log(`Account ${account.stripe_account_id}:`);
      console.log(`  user_id: ${account.user_id}`);
      console.log(`  matches user: ${matchingUser ? matchingUser.email : 'NO MATCH FOUND!'}`);
    }
  }
}

main().catch(console.error);
