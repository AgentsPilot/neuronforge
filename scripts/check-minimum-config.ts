// Check for minimum subscription configuration
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkConfig() {
  const { data } = await supabase
    .from('ais_system_config')
    .select('*');

  console.log('All config entries:');
  data?.forEach(d => {
    console.log('-', d.config_key, '=', d.config_value);
  });
}

checkConfig().then(() => process.exit(0)).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
