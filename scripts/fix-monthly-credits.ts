import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function fix() {
  const { data: { users } } = await supabase.auth.admin.listUsers();
  const user = users?.find(u => u.email === 'offir.omer@gmail.com');

  if (!user) {
    console.log('User not found');
    return;
  }

  const { error } = await supabase
    .from('user_subscriptions')
    .update({
      monthly_credits: 0,
      monthly_amount_usd: 0
    })
    .eq('user_id', user.id);

  if (error) {
    console.log('Error:', error);
  } else {
    console.log('✅ Monthly credits and amount reset to 0');
  }
}

fix();
