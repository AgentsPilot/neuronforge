require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function cleanupForFreshInsights() {
  const agentId = '08eb9918-e60f-4179-a5f4-bc83b95fc15c';

  console.log('\n🧹 CLEANUP FOR FRESH INSIGHTS\n');
  console.log('='.repeat(80));

  // 1. Show what will be deleted
  const { data: insights } = await supabase
    .from('execution_insights')
    .select('id, title, created_at')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false });

  console.log(`\n📋 Found ${insights.length} insights to delete:\n`);
  insights.forEach((ins, i) => {
    console.log(`   ${i+1}. "${ins.title}"`);
    console.log(`      ID: ${ins.id}`);
    console.log(`      Created: ${ins.created_at.slice(0,16)}`);
    console.log('');
  });

  console.log('='.repeat(80));
  console.log('\n⚠️  WARNING: This will DELETE all insights for this agent!');
  console.log('This is recommended to start fresh with accurate data.\n');
  console.log('Press Ctrl+C now to cancel, or wait 3 seconds to continue...\n');

  await new Promise(resolve => setTimeout(resolve, 3000));

  // 2. Delete all insights
  console.log('🗑️  Deleting insights...\n');

  const { error: deleteError } = await supabase
    .from('execution_insights')
    .delete()
    .eq('agent_id', agentId);

  if (deleteError) {
    console.error('❌ Error deleting insights:', deleteError);
    return;
  }

  console.log('✅ Successfully deleted all insights!\n');

  console.log('='.repeat(80));
  console.log('\n📋 NEXT STEPS:\n');
  console.log('1. ✅ DONE - Old misleading insights deleted');
  console.log('');
  console.log('2. 🔄 NEXT - Run a production execution:');
  console.log('   - Go to your agent page in the UI');
  console.log('   - Click "Run" button');
  console.log('   - Or trigger via API/schedule');
  console.log('');
  console.log('3. 💡 RESULT - Fresh insight will generate:');
  console.log('   - MetricsCollector will populate execution_metrics table');
  console.log('   - TrendAnalyzer will calculate trends (needs 7+ executions)');
  console.log('   - BusinessInsightGenerator will create accurate insight');
  console.log('   - New insight will show in UI');
  console.log('');
  console.log('Expected insight title (based on current data):');
  console.log('   "Customer Complaints Remain Near Zero - Excellent Service Quality"');
  console.log('');
  console.log('='.repeat(80));
  console.log('\n✅ Cleanup complete! Ready for fresh insights.\n');
}

cleanupForFreshInsights().catch(console.error);
