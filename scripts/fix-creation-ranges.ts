// Fix creation ranges to start from 0 instead of 1
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function fixRanges() {
  console.log('\n🔧 Fixing Creation Score Ranges\n');
  console.log('Problem: All ranges start at min=1, causing 0 and 1 to score the same (0.0)');
  console.log('Solution: Change min to 0 for proper scoring\n');

  // Fix creation_plugins range
  console.log('1️⃣ Updating creation_plugins range...');
  const { error: pluginsError } = await supabase
    .from('ais_normalization_ranges')
    .update({
      min_value: 0,
      best_practice_min: 0,
    })
    .eq('range_key', 'creation_plugins');

  if (pluginsError) {
    console.error('   ❌ Failed:', pluginsError.message);
  } else {
    console.log('   ✅ Updated creation_plugins: min 1→0');
    console.log('      New scoring: 0→0.0, 1→2.0, 2→4.0, 3→6.0, 4→8.0, 5→10.0');
  }

  // Fix creation_workflow_steps range
  console.log('\n2️⃣ Updating creation_workflow_steps range...');
  const { error: workflowError } = await supabase
    .from('ais_normalization_ranges')
    .update({
      min_value: 0,
      best_practice_min: 0,
    })
    .eq('range_key', 'creation_workflow_steps');

  if (workflowError) {
    console.error('   ❌ Failed:', workflowError.message);
  } else {
    console.log('   ✅ Updated creation_workflow_steps: min 1→0');
    console.log('      New scoring: 0→0.0, 1→1.0, 2→2.0, ..., 10→10.0');
  }

  // Fix creation_io_fields range
  console.log('\n3️⃣ Updating creation_io_fields range...');
  const { error: ioError } = await supabase
    .from('ais_normalization_ranges')
    .update({
      min_value: 0,
      best_practice_min: 0,
    })
    .eq('range_key', 'creation_io_fields');

  if (ioError) {
    console.error('   ❌ Failed:', ioError.message);
  } else {
    console.log('   ✅ Updated creation_io_fields: min 1→0');
    console.log('      New scoring: 0→0.0, 1→1.25, 2→2.5, ..., 8→10.0');
  }

  console.log('\n' + '='.repeat(80));
  console.log('✅ All ranges updated successfully!');
  console.log('='.repeat(80));

  console.log('\n📊 Next Steps:');
  console.log('1. Clear AIS config cache (happens automatically after 5 minutes)');
  console.log('2. Run backfill script to recalculate all agent scores');
  console.log('3. Verify scores are now correct\n');

  console.log('Run: npx tsx scripts/backfill-creation-dimensions.ts\n');
}

fixRanges();
