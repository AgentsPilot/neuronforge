// Test script to verify AIS snapshot functions
import { createClient } from '@supabase/supabase-js';
import { snapshotAllAgentScores, snapshotNormalizationRanges } from '../lib/audit/ais-helpers';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function testSnapshots() {
  console.log('🧪 Testing AIS Snapshot Functions...\n');

  console.log('1️⃣ Testing snapshotAllAgentScores...');
  const scores = await snapshotAllAgentScores(supabase);
  console.log(`   ✅ Found ${scores.length} agents with intensity metrics`);
  if (scores.length > 0) {
    console.log('   Sample:', JSON.stringify(scores[0], null, 2));
  }

  console.log('\n2️⃣ Testing snapshotNormalizationRanges...');
  const ranges = await snapshotNormalizationRanges(supabase);
  console.log(`   ✅ Found ${ranges.length} normalization ranges`);
  if (ranges.length > 0) {
    console.log('   Sample:', JSON.stringify(ranges[0], null, 2));
  }

  console.log('\n✅ Test complete!');
  process.exit(0);
}

testSnapshots().catch((error) => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
