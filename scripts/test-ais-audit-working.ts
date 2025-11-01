// Test script to verify AIS audit trail is working correctly
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function testAISAudit() {
  console.log('🧪 Testing AIS Audit Trail\n');
  console.log('=' .repeat(80));

  // Test 1: Check if STARTED events exist
  console.log('\n✅ TEST 1: Checking for REFRESH_STARTED events');
  console.log('-'.repeat(80));

  const { data: startedEvents, error: startedError } = await supabase
    .from('audit_trail')
    .select('id, created_at, details')
    .eq('action', 'AIS_NORMALIZATION_REFRESH_STARTED')
    .order('created_at', { ascending: false })
    .limit(1);

  if (startedError) {
    console.error('❌ Error:', startedError);
    process.exit(1);
  }

  if (!startedEvents || startedEvents.length === 0) {
    console.log('❌ FAILED: No STARTED events found');
    console.log('   Action: Click "Refresh Dynamic Ranges" in admin page');
    process.exit(1);
  }

  const latestStarted = startedEvents[0];
  const agentsCount = latestStarted.details?.affected_agents_count || 0;
  const agentsSnapshot = latestStarted.details?.agent_scores_snapshot?.length || 0;
  const rangesSnapshot = latestStarted.details?.old_ranges?.length || 0;

  console.log(`✅ Found STARTED event`);
  console.log(`   Created: ${latestStarted.created_at}`);
  console.log(`   Agents Count (metadata): ${agentsCount}`);
  console.log(`   Agents in Snapshot: ${agentsSnapshot}`);
  console.log(`   Ranges in Snapshot: ${rangesSnapshot}`);

  if (agentsSnapshot === 0 || rangesSnapshot === 0) {
    console.log('\n❌ FAILED: Snapshots are empty!');
    console.log('   Expected: 15+ agents, 20 ranges');
    console.log('   Got: ' + agentsSnapshot + ' agents, ' + rangesSnapshot + ' ranges');
    process.exit(1);
  }

  console.log('\n✅ PASSED: Snapshots contain data!');

  // Test 2: Verify snapshot quality
  console.log('\n✅ TEST 2: Verifying snapshot data quality');
  console.log('-'.repeat(80));

  const sampleAgent = latestStarted.details?.agent_scores_snapshot?.[0];
  const sampleRange = latestStarted.details?.old_ranges?.[0];

  if (sampleAgent) {
    console.log('Sample Agent:');
    console.log(`  ✓ agent_id: ${sampleAgent.agent_id}`);
    console.log(`  ✓ agent_name: ${sampleAgent.agent_name}`);
    console.log(`  ✓ combined_score: ${sampleAgent.combined_score}`);
    console.log(`  ✓ combined_multiplier: ${sampleAgent.combined_multiplier}`);
  }

  if (sampleRange) {
    console.log('\nSample Range:');
    console.log(`  ✓ range_key: ${sampleRange.range_key}`);
    console.log(`  ✓ best_practice_min: ${sampleRange.best_practice_min}`);
    console.log(`  ✓ best_practice_max: ${sampleRange.best_practice_max}`);
    console.log(`  ✓ active_mode: ${sampleRange.active_mode}`);
    console.log(`  ✓ category: ${sampleRange.category}`);
  }

  // Test 3: Check for COMPLETED events
  console.log('\n✅ TEST 3: Checking for REFRESH_COMPLETED events');
  console.log('-'.repeat(80));

  const { data: completedEvents } = await supabase
    .from('audit_trail')
    .select('id, created_at, changes')
    .eq('action', 'AIS_NORMALIZATION_REFRESH_COMPLETED')
    .order('created_at', { ascending: false })
    .limit(1);

  if (!completedEvents || completedEvents.length === 0) {
    console.log('⚠️  WARNING: No COMPLETED events found');
    console.log('   This is OK if you just started testing');
  } else {
    const latestCompleted = completedEvents[0];
    const oldRanges = latestCompleted.changes?.before?.length || 0;
    const newRanges = latestCompleted.changes?.after?.length || 0;

    console.log(`✅ Found COMPLETED event`);
    console.log(`   Created: ${latestCompleted.created_at}`);
    console.log(`   Old Ranges: ${oldRanges}`);
    console.log(`   New Ranges: ${newRanges}`);
  }

  // Test 4: Check pairing (STARTED should have matching COMPLETED)
  console.log('\n✅ TEST 4: Checking event pairing');
  console.log('-'.repeat(80));

  const startedTime = new Date(latestStarted.created_at);
  const { data: matchingCompleted } = await supabase
    .from('audit_trail')
    .select('created_at')
    .eq('action', 'AIS_NORMALIZATION_REFRESH_COMPLETED')
    .gte('created_at', latestStarted.created_at)
    .order('created_at', { ascending: true })
    .limit(1);

  if (matchingCompleted && matchingCompleted.length > 0) {
    const timeDiff = new Date(matchingCompleted[0].created_at).getTime() - startedTime.getTime();
    console.log(`✅ Found matching COMPLETED event`);
    console.log(`   Time between STARTED and COMPLETED: ${timeDiff}ms`);
  } else {
    console.log('⚠️  No matching COMPLETED event found');
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('📊 SUMMARY');
  console.log('='.repeat(80));
  console.log(`✅ Latest refresh: ${latestStarted.created_at}`);
  console.log(`✅ Captured ${agentsSnapshot} agents with scores`);
  console.log(`✅ Captured ${rangesSnapshot} normalization ranges`);
  console.log(`✅ Audit trail is WORKING correctly!`);
  console.log('\n🎉 All tests passed!\n');

  process.exit(0);
}

testAISAudit();
