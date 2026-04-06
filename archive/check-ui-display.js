require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkUI() {
  const agentId = '08eb9918-e60f-4179-a5f4-bc83b95fc15c';
  
  // Check insights in database
  const { data: insights, error } = await supabase
    .from('execution_insights')
    .select('*')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) {
    console.log('Error fetching insights:', error);
    return;
  }

  console.log('INSIGHTS IN DATABASE:\n');
  console.log('Total insights found: ' + (insights?.length || 0));
  
  if (insights && insights.length > 0) {
    insights.forEach((insight, i) => {
      console.log('\n#' + (i + 1) + ' - ' + insight.id);
      console.log('  Title: ' + insight.title);
      console.log('  Severity: ' + insight.severity);
      console.log('  Status: ' + insight.status);
      console.log('  Created: ' + insight.created_at);
      console.log('  Viewed: ' + insight.viewed_at);
      console.log('  Category: ' + insight.category);
      console.log('  Type: ' + insight.insight_type);
    });

    console.log('\n\nUI DISPLAY CHECKS:');
    console.log('1. Status: Should be "new" to show in UI');
    console.log('   → ' + (insights[0].status === 'new' ? '✅ PASS' : '❌ FAIL: status is ' + insights[0].status));
    
    console.log('2. Not snoozed: snoozed_until should be null');
    console.log('   → ' + (insights[0].snoozed_until === null ? '✅ PASS' : '❌ FAIL: snoozed until ' + insights[0].snoozed_until));
    
    console.log('3. Recent: Should be within last 7 days');
    const ageHours = (Date.now() - new Date(insights[0].created_at).getTime()) / (1000 * 60 * 60);
    console.log('   → ' + (ageHours < 168 ? '✅ PASS (age: ' + ageHours.toFixed(1) + ' hours)' : '❌ FAIL: too old'));

    console.log('\nWhere to view:');
    console.log('URL: http://localhost:3000/v2/agents/' + agentId);
    console.log('\nLook for an "Insights" section on the agent page');
  } else {
    console.log('No insights found in database!');
  }
}

checkUI();
