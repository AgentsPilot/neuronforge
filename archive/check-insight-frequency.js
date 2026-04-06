require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkInsightFrequency() {
  const agentId = '08eb9918-e60f-4179-a5f4-bc83b95fc15c';

  console.log('\n🔍 Checking Insight Generation Frequency\n');
  console.log('='.repeat(80));

  // Get execution count
  const { data: executions, error: execError } = await supabase
    .from('workflow_executions')
    .select('id, started_at, status')
    .eq('agent_id', agentId)
    .eq('run_mode', 'production')
    .order('started_at', { ascending: false })
    .limit(30);

  if (execError) {
    console.error('Error fetching executions:', execError);
    return;
  }

  const oldestExec = executions[executions.length - 1];
  const newestExec = executions[0];

  console.log('\n📊 Recent Executions:');
  console.log('   Total:', executions.length);
  console.log('   Oldest:', oldestExec?.started_at);
  console.log('   Newest:', newestExec?.started_at);

  // Get insights count
  const { data: insights, error: insightError } = await supabase
    .from('execution_insights')
    .select('id, created_at, title, category, insight_type, execution_ids')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false })
    .limit(30);

  if (insightError) {
    console.error('Error fetching insights:', insightError);
    return;
  }

  const oldestInsight = insights[insights.length - 1];
  const newestInsight = insights[0];

  console.log('\n💡 Insights Generated:');
  console.log('   Total:', insights.length);
  console.log('   Oldest:', oldestInsight?.created_at);
  console.log('   Newest:', newestInsight?.created_at);

  console.log('\n' + '='.repeat(80));
  console.log('\n📈 ANALYSIS:\n');

  // Check if insight per execution
  const insightPerExecution = insights.length / executions.length;
  console.log('   Ratio:', insights.length, 'insights /', executions.length, 'executions =', insightPerExecution.toFixed(2));

  if (insightPerExecution >= 0.9) {
    console.log('\n   🚨 WARNING: Nearly 1 insight per execution!');
    console.log('   This suggests LLM is being called on EVERY execution.');
    console.log('   Expected: ~1 insight per 7+ executions (with caching)');
  } else if (insightPerExecution >= 0.5) {
    console.log('\n   ⚠️  CONCERN: High insight generation rate');
    console.log('   Caching may not be working optimally.');
  } else {
    console.log('\n   ✅ Normal: Reasonable insight generation rate');
    console.log('   Caching appears to be working.');
  }

  // Show recent insights
  console.log('\n\nRecent Insights (last 10):\n');
  insights.slice(0, 10).forEach((insight, i) => {
    const executionCount = Array.isArray(insight.execution_ids) ? insight.execution_ids.length : 0;
    console.log(i + 1 + '.', insight.created_at);
    console.log('   Title: "' + insight.title + '"');
    console.log('   Type:', insight.insight_type, '| Category:', insight.category);
    console.log('   Covers:', executionCount, 'executions');
    console.log('');
  });

  // Check for pattern: are insights linked to same execution?
  console.log('='.repeat(80));
  console.log('\n🔍 Checking if each insight covers multiple executions:\n');

  const singleExecutionInsights = insights.filter(i =>
    Array.isArray(i.execution_ids) && i.execution_ids.length === 1
  );

  const multiExecutionInsights = insights.filter(i =>
    Array.isArray(i.execution_ids) && i.execution_ids.length > 1
  );

  console.log('   Single execution insights:', singleExecutionInsights.length);
  console.log('   Multi execution insights:', multiExecutionInsights.length);

  if (singleExecutionInsights.length > insights.length * 0.5) {
    console.log('\n   🚨 PROBLEM:', singleExecutionInsights.length + '/' + insights.length, 'insights cover only 1 execution');
    console.log('   Expected: Each insight should cover 7-30 executions (trend analysis)');
    console.log('   This indicates insights are being generated per execution, not per trend period.');
  } else {
    console.log('\n   ✅ Good: Most insights cover multiple executions');
  }
}

checkInsightFrequency().catch(console.error);
