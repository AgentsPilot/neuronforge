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

  const rangesToFix = [
    { key: 'creation_plugins', oldMin: 1, newMin: 0, max: 5 },
    { key: 'creation_workflow_steps', oldMin: 1, newMin: 0, max: 10 },
    { key: 'creation_io_fields', oldMin: 1, newMin: 0, max: 8 },
  ];

  for (const range of rangesToFix) {
    console.log(`\n📝 Updating ${range.key}...`);

    // First, check current value
    const { data: current, error: fetchError } = await supabase
      .from('ais_normalization_ranges')
      .select('*')
      .eq('range_key', range.key)
      .single();

    if (fetchError) {
      console.error(`   ❌ Failed to fetch: ${fetchError.message}`);
      continue;
    }

    console.log(`   Current: min=${current.min_value}, max=${current.max_value}`);

    // Update the range
    const { error: updateError } = await supabase
      .from('ais_normalization_ranges')
      .update({
        min_value: range.newMin,
        best_practice_min: range.newMin,
      })
      .eq('range_key', range.key);

    if (updateError) {
      console.error(`   ❌ Failed to update: ${updateError.message}`);
    } else {
      console.log(`   ✅ Updated: min ${range.oldMin}→${range.newMin}`);

      // Show new scoring
      const scoringExamples = [];
      for (let i = 0; i <= Math.min(range.max, 5); i++) {
        const score = ((i - range.newMin) / (range.max - range.newMin)) * 10;
        const clampedScore = Math.max(0, Math.min(10, score));
        scoringExamples.push(`${i}→${clampedScore.toFixed(1)}`);
      }
      console.log(`   New scoring: ${scoringExamples.join(', ')}`);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('✅ Range updates complete!');
  console.log('='.repeat(80));

  console.log('\n📊 Impact:');
  console.log('  Before: Agents with 1 plugin/step/field scored 0.0 (same as 0)');
  console.log('  After:  Agents with 1 plugin/step/field get proper credit');
  console.log('\n  Example (plugins):');
  console.log('    0 plugins: 0.0/10 → 0.0/10 (no change)');
  console.log('    1 plugin:  0.0/10 → 2.0/10 (FIXED! ✅)');
  console.log('    2 plugins: 2.5/10 → 4.0/10');
  console.log('    5 plugins: 10.0/10 → 10.0/10 (no change)');

  console.log('\n🔄 Next Steps:');
  console.log('1. Backfill all agents with new scores:');
  console.log('   npx tsx scripts/backfill-creation-dimensions.ts');
  console.log('\n2. Verify the fix worked:');
  console.log('   npx tsx scripts/check-all-creation-ranges.ts\n');
}

fixRanges();
