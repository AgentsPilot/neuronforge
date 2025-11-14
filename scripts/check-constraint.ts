import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function check() {
  const { data, error } = await supabase.rpc('get_table_constraints', { 
    table_name: 'user_subscriptions' 
  });
  
  console.log('Constraints:', data || error);
}

check();
