require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function deleteSingleInsight() {
  const agentId = '08eb9918-e60f-4179-a5f4-bc83b95fc15c';

  const { error } = await supabase
    .from('execution_insights')
    .delete()
    .eq('agent_id', agentId);

  if (error) {
    console.error('Error:', error);
  } else {
    console.log('✅ All insights deleted');
  }
}

deleteSingleInsight();
