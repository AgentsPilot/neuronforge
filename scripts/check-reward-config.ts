// Check reward configurations
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkRewardConfig() {
  try {
    const { data: configs, error } = await supabase
      .from('reward_config')
      .select('*')
      .eq('is_active', true);

    if (error) {
      console.error('❌ Error fetching reward configs:', error);
      return;
    }

    console.log('\n🎁 Active Reward Configurations:\n');
    if (configs && configs.length > 0) {
      configs.forEach((config, i) => {
        console.log(`${i + 1}. ${config.reward_name} (${config.reward_key})`);
        console.log(`   Credits: ${config.credits_amount}`);
        console.log(`   Description: ${config.description}`);
        console.log(`   Max per user: ${config.max_per_user || 'Unlimited'}`);
        console.log('');
      });
    } else {
      console.log('No active reward configurations found');
    }
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

checkRewardConfig().then(() => process.exit(0));
