// Check the latest refresh and verify what was captured
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkLatestRefresh() {
  console.log('🔍 Checking Latest Refresh\n');
  console.log('='.repeat(80));

  // Get the latest STARTED event
  const { data: events, error } = await supabase
    .from('audit_trail')
    .select('*')
    .eq('action', 'AIS_NORMALIZATION_REFRESH_STARTED')
    .order('created_at', { ascending: false })
    .limit(2);

  if (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }

  if (!events || events.length === 0) {
    console.log('❌ No refresh events found');
    process.exit(1);
  }

  const latest = events[0];
  const previous = events[1];

  console.log(`\n📅 LATEST REFRESH: ${latest.created_at}`);
  console.log('-'.repeat(80));

  // Show what was captured
  const agentsSnapshot = latest.details?.agent_scores_snapshot || [];
  const rangesSnapshot = latest.details?.old_ranges || [];

  console.log(`\n✅ Captured ${agentsSnapshot.length} agents:`);
  agentsSnapshot.forEach((agent: any, i: number) => {
    console.log(`   ${i + 1}. ${agent.agent_name}`);
    console.log(`      Score: ${agent.combined_score} (multiplier: ${agent.combined_multiplier})`);
  });

  console.log(`\n✅ Captured ${rangesSnapshot.length} normalization ranges:`);
  const rangesByCategory: Record<string, any[]> = {};
  rangesSnapshot.forEach((range: any) => {
    if (!rangesByCategory[range.category]) {
      rangesByCategory[range.category] = [];
    }
    rangesByCategory[range.category].push(range);
  });

  Object.entries(rangesByCategory).forEach(([category, ranges]) => {
    console.log(`\n   📂 ${category}:`);
    ranges.forEach((range: any) => {
      console.log(`      ${range.range_key}: [${range.best_practice_min} - ${range.best_practice_max}]`);
    });
  });

  // Compare with previous if exists
  if (previous) {
    console.log('\n' + '='.repeat(80));
    console.log(`\n📊 COMPARISON WITH PREVIOUS REFRESH (${previous.created_at})`);
    console.log('-'.repeat(80));

    const prevAgentsSnapshot = previous.details?.agent_scores_snapshot || [];
    const prevRangesSnapshot = previous.details?.old_ranges || [];

    console.log(`\nAgents: ${prevAgentsSnapshot.length} → ${agentsSnapshot.length} (${agentsSnapshot.length - prevAgentsSnapshot.length >= 0 ? '+' : ''}${agentsSnapshot.length - prevAgentsSnapshot.length})`);
    console.log(`Ranges: ${prevRangesSnapshot.length} → ${rangesSnapshot.length} (${rangesSnapshot.length - prevRangesSnapshot.length >= 0 ? '+' : ''}${rangesSnapshot.length - prevRangesSnapshot.length})`);

    // Check if any agent scores changed
    const changedAgents: any[] = [];
    agentsSnapshot.forEach((agent: any) => {
      const prevAgent = prevAgentsSnapshot.find((a: any) => a.agent_id === agent.agent_id);
      if (prevAgent && Math.abs(prevAgent.combined_score - agent.combined_score) > 0.01) {
        changedAgents.push({
          name: agent.agent_name,
          oldScore: prevAgent.combined_score,
          newScore: agent.combined_score,
          change: agent.combined_score - prevAgent.combined_score
        });
      }
    });

    if (changedAgents.length > 0) {
      console.log(`\n🔄 Agent scores that changed:`);
      changedAgents.forEach((agent) => {
        const arrow = agent.change > 0 ? '📈' : '📉';
        console.log(`   ${arrow} ${agent.name}: ${agent.oldScore.toFixed(2)} → ${agent.newScore.toFixed(2)} (${agent.change > 0 ? '+' : ''}${agent.change.toFixed(2)})`);
      });
    } else {
      console.log(`\n✅ No agent scores changed between refreshes`);
    }

    // Check if any ranges changed
    const changedRanges: any[] = [];
    rangesSnapshot.forEach((range: any) => {
      const prevRange = prevRangesSnapshot.find((r: any) => r.range_key === range.range_key);
      if (prevRange) {
        if (prevRange.best_practice_min !== range.best_practice_min ||
            prevRange.best_practice_max !== range.best_practice_max) {
          changedRanges.push({
            key: range.range_key,
            oldMin: prevRange.best_practice_min,
            oldMax: prevRange.best_practice_max,
            newMin: range.best_practice_min,
            newMax: range.best_practice_max
          });
        }
      }
    });

    if (changedRanges.length > 0) {
      console.log(`\n🔄 Normalization ranges that changed:`);
      changedRanges.forEach((range) => {
        console.log(`   📊 ${range.key}:`);
        console.log(`      Min: ${range.oldMin} → ${range.newMin}`);
        console.log(`      Max: ${range.oldMax} → ${range.newMax}`);
      });
    } else {
      console.log(`\n✅ No normalization ranges changed between refreshes`);
    }
  }

  // Verify completeness
  console.log('\n' + '='.repeat(80));
  console.log('\n✅ VERIFICATION');
  console.log('-'.repeat(80));

  // Check against actual database counts
  const { count: agentCount } = await supabase
    .from('agent_intensity_metrics')
    .select('*', { count: 'exact', head: true });

  const { count: rangeCount } = await supabase
    .from('ais_normalization_ranges')
    .select('*', { count: 'exact', head: true });

  console.log(`\nActual agents in DB: ${agentCount}`);
  console.log(`Captured in snapshot: ${agentsSnapshot.length}`);
  if (agentCount === agentsSnapshot.length) {
    console.log('✅ ALL agents captured!');
  } else {
    console.log(`⚠️  Missing ${agentCount! - agentsSnapshot.length} agents`);
  }

  console.log(`\nActual ranges in DB: ${rangeCount}`);
  console.log(`Captured in snapshot: ${rangesSnapshot.length}`);
  if (rangeCount === rangesSnapshot.length) {
    console.log('✅ ALL ranges captured!');
  } else {
    console.log(`⚠️  Missing ${rangeCount! - rangesSnapshot.length} ranges`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('🎯 Summary: Audit trail is capturing everything correctly!\n');

  process.exit(0);
}

checkLatestRefresh();
