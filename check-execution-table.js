require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  const { data } = await supabase
    .from('workflow_executions')
    .select('*')
    .eq('id', '85e7e3ec-ae7e-4764-bd30-fbe18bfef292')
    .single();

  console.log('Available columns:', Object.keys(data || {}));
  console.log('Sample data keys that might have step output:', Object.keys(data || {}).filter(k => k.includes('result') || k.includes('output') || k.includes('data')));
})();
