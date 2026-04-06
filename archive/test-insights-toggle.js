// Test script to verify insights_enabled column exists and works
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing environment variables');
  console.log('NEXT_PUBLIC_SUPABASE_URL:', !!process.env.NEXT_PUBLIC_SUPABASE_URL);
  console.log('SUPABASE_SERVICE_ROLE_KEY:', !!process.env.SUPABASE_SERVICE_ROLE_KEY);
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testInsightsToggle() {
  console.log('🔍 Testing insights_enabled column...\n');

  // Get first agent
  const { data: agents, error: fetchError } = await supabase
    .from('agents')
    .select('id, agent_name, insights_enabled')
    .limit(1);

  if (fetchError) {
    console.error('❌ Error fetching agent:', fetchError);
    return;
  }

  if (!agents || agents.length === 0) {
    console.log('❌ No agents found');
    return;
  }

  const agent = agents[0];
  console.log('📋 Agent:', {
    id: agent.id,
    name: agent.agent_name,
    insights_enabled: agent.insights_enabled
  });

  // Try to toggle it
  const newValue = !agent.insights_enabled;
  console.log(`\n🔄 Toggling insights_enabled from ${agent.insights_enabled} to ${newValue}...`);

  const { data: updated, error: updateError } = await supabase
    .from('agents')
    .update({ insights_enabled: newValue })
    .eq('id', agent.id)
    .select('id, agent_name, insights_enabled')
    .single();

  if (updateError) {
    console.error('❌ Error updating:', updateError);
    return;
  }

  console.log('✅ Update successful:', {
    id: updated.id,
    name: updated.agent_name,
    insights_enabled: updated.insights_enabled
  });

  // Verify the change persisted
  const { data: verified, error: verifyError } = await supabase
    .from('agents')
    .select('id, agent_name, insights_enabled')
    .eq('id', agent.id)
    .single();

  if (verifyError) {
    console.error('❌ Error verifying:', verifyError);
    return;
  }

  console.log('\n✅ Verification successful:', {
    id: verified.id,
    name: verified.agent_name,
    insights_enabled: verified.insights_enabled
  });

  if (verified.insights_enabled === newValue) {
    console.log('\n🎉 insights_enabled column is working correctly!');
  } else {
    console.log('\n❌ Value did not persist correctly');
  }
}

testInsightsToggle().catch(console.error);
