// Check pricing configuration
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkConfig() {
  const { data } = await supabase
    .from('ais_system_config')
    .select('config_key, config_value')
    .in('config_key', ['pilot_credit_cost_usd', 'tokens_per_pilot_credit']);

  console.log('📊 Current pricing configuration in database:\n');
  data?.forEach(d => {
    console.log(`${d.config_key}: ${d.config_value}`);
  });

  // Show what it should be
  const tokenCost = parseFloat(data?.find(d => d.config_key === 'pilot_credit_cost_usd')?.config_value || '0');
  const tokensPerCredit = parseInt(data?.find(d => d.config_key === 'tokens_per_pilot_credit')?.config_value || '10');

  console.log('\n💡 Analysis:');
  console.log(`- Current "pilot_credit_cost_usd" value: $${tokenCost}`);
  console.log(`- Tokens per Pilot Credit: ${tokensPerCredit}`);
  console.log(`- Actual cost per Pilot Credit: $${tokenCost} × ${tokensPerCredit} = $${tokenCost * tokensPerCredit}`);

  if (tokenCost === 0.00048) {
    console.log('\n⚠️  ISSUE FOUND:');
    console.log('The "pilot_credit_cost_usd" config contains the cost per TOKEN ($0.00048)');
    console.log('But the name suggests it should be cost per PILOT CREDIT ($0.0048)');
    console.log('\nThis causes the UI to display $0 when showing price per Pilot Credit.');
  }
}

checkConfig().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
