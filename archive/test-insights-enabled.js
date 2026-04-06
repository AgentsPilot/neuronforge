/**
 * Test script to verify insights_enabled column exists and check agent data
 * Run with: node test-insights-enabled.js
 */

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testInsights() {
  console.log('🔍 Testing insights_enabled column...\n');

  // 1. Check if column exists by querying an agent
  const { data: agents, error } = await supabase
    .from('agents')
    .select('id, agent_name, production_ready, insights_enabled')
    .limit(5);

  if (error) {
    console.error('❌ Error querying agents:', error.message);
    if (error.message.includes('insights_enabled')) {
      console.error('\n⚠️  Column insights_enabled does NOT exist!');
      console.error('Run the migration: supabase/SQL Scripts/20260202_add_insights_enabled_to_agents.sql');
    }
    return;
  }

  console.log('✅ Successfully queried agents with insights_enabled column\n');
  console.log('Sample agents:');
  agents.forEach((agent, i) => {
    console.log(`${i + 1}. ${agent.agent_name}`);
    console.log(`   ID: ${agent.id}`);
    console.log(`   production_ready: ${agent.production_ready}`);
    console.log(`   insights_enabled: ${agent.insights_enabled}`);
    console.log('');
  });

  // 2. Count how many agents have insights enabled
  const { count } = await supabase
    .from('agents')
    .select('*', { count: 'exact', head: true })
    .eq('insights_enabled', true);

  console.log(`📊 Agents with insights_enabled=true: ${count || 0}`);
}

testInsights().then(() => {
  console.log('\n✅ Test complete');
  process.exit(0);
}).catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
