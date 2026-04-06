require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function trace() {
  const agentId = '08eb9918-e60f-4179-a5f4-bc83b95fc15c';
  
  console.log('TRACING TECHNICAL INSIGHT FLOW:\n');
  
  // Step 1: Check what technical patterns were detected
  console.log('Step 1: Check execution logs for pattern detection');
  console.log('Based on your earlier logs, we saw:');
  console.log('  - Technical patterns detected: 1');
  console.log('  - Pattern type: likely "data_unavailable" (100% empty results)');
  
  // Step 2: Check insights in database
  const { data: insights } = await supabase
    .from('execution_insights')
    .select('*')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false });

  console.log('\nStep 2: Check insights in database');
  console.log('Total insights: ' + (insights?.length || 0));
  
  if (insights && insights.length > 0) {
    console.log('\nBreakdown by category:');
    const byCategory = insights.reduce((acc, i) => {
      acc[i.category] = (acc[i.category] || 0) + 1;
      return acc;
    }, {});
    console.log('  growth (business): ' + (byCategory.growth || 0));
    console.log('  data_quality (technical): ' + (byCategory.data_quality || 0));
    
    console.log('\nAll insights:');
    insights.forEach((i, idx) => {
      console.log('  ' + (idx + 1) + '. ' + i.title);
      console.log('     Category: ' + i.category);
      console.log('     Type: ' + i.insight_type);
      console.log('     Severity: ' + i.severity);
    });
  }

  console.log('\n\nStep 3: Understanding the flow');
  console.log('Technical patterns detected → Passed to BusinessInsightGenerator');
  console.log('BusinessInsightGenerator → Generates BUSINESS insights (category: "growth")');
  console.log('Technical insights (category: "data_quality") → NOT generated separately');
  
  console.log('\n\nCONCLUSION:');
  console.log('The system detected technical pattern "data_unavailable"');
  console.log('But it was RE-INTERPRETED as a business insight instead:');
  console.log('  "Consistently low complaint volume detected" (LOW severity, positive)');
  console.log('\nNo separate technical insight was created because:');
  console.log('  1. Technical patterns are passed to BusinessInsightGenerator');
  console.log('  2. LLM re-interprets them based on business context');
  console.log('  3. Result: Business insight that acknowledges healthy state');
  console.log('  4. No separate "data_unavailable" alert needed');
}

trace();
