require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function showBusinessInsightTrend() {
  const agentId = '08eb9918-e60f-4179-a5f4-bc83b95fc15c';

  console.log('\n📊 BUSINESS INSIGHT TREND ANALYSIS\n');
  console.log('='.repeat(90));
  console.log('\nAgent: Test V6 (Email Complaint Tracking)');
  console.log('Business Goal: Track customer service complaint emails from Gmail');
  console.log('');

  // 1. Fetch agent details
  const { data: agent } = await supabase
    .from('agents')
    .select('agent_name, description, created_from_prompt')
    .eq('id', agentId)
    .single();

  console.log('📋 Workflow Context:\n');
  if (agent.created_from_prompt) {
    console.log(`   "${agent.created_from_prompt}"`);
  } else {
    console.log(`   "${agent.description}"`);
  }

  console.log('\n' + '='.repeat(90));

  // 2. Fetch execution metrics with step details
  const { data: executions } = await supabase
    .from('workflow_executions')
    .select(`
      id,
      started_at,
      status,
      run_mode
    `)
    .eq('agent_id', agentId)
    .eq('run_mode', 'production')
    .order('started_at', { ascending: false })
    .limit(30);

  console.log('\n\n📈 EXECUTION HISTORY (Last 30 Runs)\n');
  console.log('-'.repeat(90));

  // For each execution, get the business metric step count
  const executionData = [];

  for (const exec of executions) {
    // Fetch step executions to find the business metric
    const { data: steps } = await supabase
      .from('workflow_step_executions')
      .select('step_id, step_name, item_count, status')
      .eq('workflow_execution_id', exec.id)
      .order('created_at', { ascending: true });

    // Find the business metric step (Filter Group 1 = customer service emails)
    const businessMetricStep = steps?.find(s =>
      s.step_name?.toLowerCase().includes('filter group') ||
      s.step_name?.toLowerCase().includes('group 1')
    );

    // Fallback: Find "Filter New Items" step
    const fallbackStep = steps?.find(s =>
      s.step_name?.toLowerCase().includes('filter new')
    );

    const metricStep = businessMetricStep || fallbackStep;
    const complaintCount = metricStep?.item_count || 0;
    const stepName = metricStep?.step_name || 'Unknown';

    executionData.push({
      date: new Date(exec.started_at),
      count: complaintCount,
      stepName: stepName,
      executionId: exec.id,
      status: exec.status
    });
  }

  // Sort by date (oldest first for trend display)
  executionData.sort((a, b) => a.date - b.date);

  // Display timeline
  console.log('Date & Time          | Complaints | Step Tracked              | Status');
  console.log('-'.repeat(90));

  executionData.forEach((exec, idx) => {
    const dateStr = exec.date.toISOString().slice(0, 16).replace('T', ' ');
    const countStr = String(exec.count).padStart(10, ' ');
    const stepStr = exec.stepName.slice(0, 24).padEnd(24, ' ');
    const statusIcon = exec.status === 'completed' ? '✅' : '❌';

    console.log(`${dateStr} | ${countStr} | ${stepStr} | ${statusIcon}`);
  });

  console.log('\n' + '='.repeat(90));

  // 3. Calculate trend metrics
  console.log('\n\n📊 TREND ANALYSIS\n');
  console.log('-'.repeat(90));

  const counts = executionData.map(e => e.count);
  const recentCounts = counts.slice(-7);  // Last 7 executions
  const historicalCounts = counts.slice(0, -7);  // Everything before last 7

  const recentAvg = recentCounts.reduce((a, b) => a + b, 0) / recentCounts.length;
  const historicalAvg = historicalCounts.length > 0
    ? historicalCounts.reduce((a, b) => a + b, 0) / historicalCounts.length
    : recentAvg;

  const percentChange = historicalAvg > 0
    ? ((recentAvg - historicalAvg) / historicalAvg * 100)
    : 0;

  const min = Math.min(...counts);
  const max = Math.max(...counts);
  const overallAvg = counts.reduce((a, b) => a + b, 0) / counts.length;

  // Calculate standard deviation
  const variance = counts.reduce((sum, val) => sum + Math.pow(val - overallAvg, 2), 0) / counts.length;
  const stdDev = Math.sqrt(variance);

  // Detect anomalies (2+ standard deviations)
  const isSpike = recentAvg > historicalAvg + (2 * stdDev);
  const isDrop = recentAvg < historicalAvg - (2 * stdDev);

  console.log(`\n📌 Overall Statistics (${counts.length} executions):\n`);
  console.log(`   Min complaints:        ${min.toFixed(1)}`);
  console.log(`   Max complaints:        ${max.toFixed(1)}`);
  console.log(`   Average:               ${overallAvg.toFixed(1)}`);
  console.log(`   Standard deviation:    ${stdDev.toFixed(1)}`);

  console.log(`\n📌 Historical Baseline (first ${historicalCounts.length} executions):\n`);
  console.log(`   Average complaints:    ${historicalAvg.toFixed(1)} per execution`);

  console.log(`\n📌 Recent Period (last ${recentCounts.length} executions):\n`);
  console.log(`   Average complaints:    ${recentAvg.toFixed(1)} per execution`);
  console.log(`   Change from baseline:  ${percentChange > 0 ? '+' : ''}${percentChange.toFixed(1)}%`);

  if (isSpike) {
    console.log(`   ⚠️  SPIKE DETECTED: +${((recentAvg - historicalAvg) / stdDev).toFixed(1)} standard deviations`);
  } else if (isDrop) {
    console.log(`   ✅ DROP DETECTED: -${((historicalAvg - recentAvg) / stdDev).toFixed(1)} standard deviations`);
  } else {
    console.log(`   ℹ️  Normal variation (within 2 std deviations)`);
  }

  console.log('\n' + '='.repeat(90));

  // 4. Show what LLM would see
  console.log('\n\n🤖 WHAT THE LLM RECEIVES FOR INSIGHT GENERATION\n');
  console.log('-'.repeat(90));

  const llmContext = {
    workflow_purpose: agent.created_from_prompt || agent.description,
    business_metric: {
      name: 'Customer Complaints',
      tracked_in_step: 'Filter Group 1'
    },
    recent_data: {
      last_7_executions: recentCounts,
      average: recentAvg.toFixed(1),
      range: `${Math.min(...recentCounts)} - ${Math.max(...recentCounts)}`
    },
    historical_baseline: {
      average: historicalAvg.toFixed(1),
      sample_size: historicalCounts.length
    },
    trend: {
      percent_change: `${percentChange > 0 ? '+' : ''}${percentChange.toFixed(1)}%`,
      is_spike: isSpike,
      is_drop: isDrop,
      direction: percentChange > 5 ? 'increasing' : percentChange < -5 ? 'decreasing' : 'stable'
    }
  };

  console.log('\n' + JSON.stringify(llmContext, null, 2));

  console.log('\n' + '='.repeat(90));

  // 5. Generate sample business insight
  console.log('\n\n💡 BUSINESS INSIGHT (What User Should See)\n');
  console.log('-'.repeat(90));

  let insightTitle, insightDescription, insightImpact, insightRecommendation, severity;

  if (percentChange > 50) {
    // Major increase
    severity = 'high';
    insightTitle = `Customer Complaints Surged ${Math.abs(percentChange).toFixed(0)}%`;
    insightDescription = `Complaint volume increased significantly from ${historicalAvg.toFixed(1)} to ${recentAvg.toFixed(1)} per execution. This ${Math.abs(percentChange).toFixed(0)}% surge suggests potential product issues or increased customer activity.`;
    insightImpact = 'Higher complaint volume may indicate quality issues, service disruptions, or gaps in customer experience that need immediate attention.';
    insightRecommendation = 'Review recent complaints for common themes. Check if a recent product update or service change correlates with the spike. Consider increasing support capacity.';
  } else if (percentChange > 20) {
    // Moderate increase
    severity = 'medium';
    insightTitle = `Customer Complaints Increased ${Math.abs(percentChange).toFixed(0)}%`;
    insightDescription = `Complaint volume rose from ${historicalAvg.toFixed(1)} to ${recentAvg.toFixed(1)} per execution (${Math.abs(percentChange).toFixed(0)}% increase). This trend warrants monitoring.`;
    insightImpact = 'Moderate increase in complaints suggests emerging issues that could escalate if not addressed.';
    insightRecommendation = 'Monitor complaint trends closely. Analyze complaint content for patterns. Prepare support team for potential increase in workload.';
  } else if (percentChange < -50) {
    // Major decrease (SUCCESS!)
    severity = 'low';
    insightTitle = `Customer Complaints Dropped ${Math.abs(percentChange).toFixed(0)}% - Great Progress!`;
    insightDescription = `Complaint volume decreased significantly from ${historicalAvg.toFixed(1)} to ${recentAvg.toFixed(1)} per execution. This ${Math.abs(percentChange).toFixed(0)}% drop suggests successful issue resolution.`;
    insightImpact = 'Dramatic reduction in complaints indicates effective problem-solving and improved customer satisfaction.';
    insightRecommendation = 'Document what changes led to this improvement for future reference. Continue monitoring to ensure complaint detection is still working correctly.';
  } else if (percentChange < -20) {
    // Moderate decrease (positive)
    severity = 'low';
    insightTitle = `Customer Complaints Decreased ${Math.abs(percentChange).toFixed(0)}%`;
    insightDescription = `Complaint volume dropped from ${historicalAvg.toFixed(1)} to ${recentAvg.toFixed(1)} per execution (${Math.abs(percentChange).toFixed(0)}% reduction). This positive trend suggests improvements are working.`;
    insightImpact = 'Reduced complaints indicate better product quality or customer service effectiveness.';
    insightRecommendation = 'Review what changed to drive this improvement. Share successful strategies with the team.';
  } else {
    // Stable
    severity = 'low';
    insightTitle = 'Customer Complaint Volume Stable';
    insightDescription = `Complaint volume remains consistent around ${overallAvg.toFixed(1)} per execution. Recent average (${recentAvg.toFixed(1)}) shows minimal change from baseline (${historicalAvg.toFixed(1)}).`;
    insightImpact = 'Stable complaint volume indicates predictable customer support needs.';
    insightRecommendation = 'Maintain current service quality standards. Use this stable period to improve processes and prepare for potential future spikes.';
  }

  console.log(`\n📌 Insight Card:\n`);
  console.log(`   Severity:      ${severity.toUpperCase()}`);
  console.log(`   Title:         ${insightTitle}`);
  console.log(`\n   Description:\n   ${insightDescription}\n`);
  console.log(`   Impact:\n   ${insightImpact}\n`);
  console.log(`   Recommendation:\n   ${insightRecommendation}\n`);

  console.log('\n' + '='.repeat(90));

  // 6. Show caching behavior
  console.log('\n\n🔄 CACHING BEHAVIOR\n');
  console.log('-'.repeat(90));

  // Check if there's a recent insight
  const { data: recentInsight } = await supabase
    .from('execution_insights')
    .select('id, created_at, title, insight_type, pattern_data')
    .eq('agent_id', agentId)
    .eq('category', 'growth')
    .in('status', ['new', 'viewed'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (recentInsight) {
    const insightAge = Math.floor((Date.now() - new Date(recentInsight.created_at).getTime()) / (1000 * 60 * 60 * 24));

    console.log(`\n📌 Cached Insight Found:\n`);
    console.log(`   Created:       ${new Date(recentInsight.created_at).toISOString().slice(0, 16).replace('T', ' ')}`);
    console.log(`   Age:           ${insightAge} days (cache expires after 7 days)`);
    console.log(`   Title:         "${recentInsight.title}"`);
    console.log(`   Type:          ${recentInsight.insight_type}`);

    // Calculate if trends changed enough to trigger LLM
    const cachedTrends = recentInsight.pattern_data;
    if (cachedTrends && cachedTrends.metric_value_recent) {
      const cachedValue = cachedTrends.metric_value_recent;
      const currentValue = recentAvg;
      const trendDelta = Math.abs(currentValue - cachedValue) / (cachedValue || 1);

      console.log(`\n📌 Trend Comparison:\n`);
      console.log(`   Cached metric:    ${cachedValue.toFixed(1)} complaints/execution`);
      console.log(`   Current metric:   ${currentValue.toFixed(1)} complaints/execution`);
      console.log(`   Delta:            ${(trendDelta * 100).toFixed(1)}% change`);
      console.log(`   Threshold:        10% (LLM called if exceeded)`);

      if (trendDelta >= 0.10) {
        console.log(`\n   ✅ Next execution will CALL LLM (trends changed ${(trendDelta * 100).toFixed(1)}%)`);
      } else if (insightAge >= 7) {
        console.log(`\n   ✅ Next execution will CALL LLM (cache expired after ${insightAge} days)`);
      } else {
        console.log(`\n   ❌ Next execution will REUSE CACHE (trends stable, cache fresh)`);
        console.log(`   💰 LLM cost saved: $0.02`);
      }
    }
  } else {
    console.log(`\n📌 No Cached Insight Found\n`);
    console.log(`   Next execution will CALL LLM (first time generating insight)`);
  }

  console.log('\n' + '='.repeat(90));

  // 7. Visualization
  console.log('\n\n📉 VISUAL TREND (Last 20 Executions)\n');
  console.log('-'.repeat(90));

  const visualData = executionData.slice(-20);
  const maxCount = Math.max(...visualData.map(e => e.count), 1);
  const scale = 50;  // Max bar width

  console.log('\nComplaints per execution:\n');
  visualData.forEach((exec, idx) => {
    const barWidth = Math.floor((exec.count / maxCount) * scale);
    const bar = '█'.repeat(barWidth);
    const dateStr = exec.date.toISOString().slice(5, 10);  // MM-DD
    const countStr = String(exec.count).padStart(2, ' ');

    console.log(`${dateStr} (${countStr}) ${bar}`);
  });

  console.log(`\nScale: Each █ ≈ ${(maxCount / scale).toFixed(1)} complaints\n`);

  console.log('='.repeat(90));
  console.log('\n✅ ANALYSIS COMPLETE\n');
  console.log('This shows exactly how business insights work:');
  console.log('  1. Track business metric (complaints in Filter Group 1)');
  console.log('  2. Calculate trends (recent vs historical)');
  console.log('  3. Detect anomalies (spikes/drops)');
  console.log('  4. Generate context-aware insights (LLM)');
  console.log('  5. Cache results (reuse if trends stable)');
  console.log('\n');
}

showBusinessInsightTrend().catch(console.error);
